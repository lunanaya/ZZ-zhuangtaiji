import assert from 'node:assert/strict';

const nativeNow = Date.now;
let now = 1000, id = 0, calls = 0, transport;
const timers = new Map(), intervals = new Map(), progress = [];
Date.now = () => now;
globalThis.window = {
    setTimeout(fn, ms) { const key = ++id; timers.set(key, {fn, at:now + ms}); return key; },
    clearTimeout(key) { timers.delete(key); },
    setInterval(fn) { const key = ++id; intervals.set(key, fn); return key; },
    clearInterval(key) { intervals.delete(key); },
    getRequestHeaders: () => ({}),
    WorldStateMachine: {
        Settings: {get: () => ({useTavernApi:false, endpoint:'https://example.invalid/v1', maxTokens:16384})},
        Engine: {reportProgress: (...args) => progress.push(args)},
    },
};
await import('../src/api.js');
const api = window.WorldStateMachine.Api;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
async function advance(ms) {
    const target = now + ms;
    while (true) {
        const due = [...timers].filter(([,t]) => t.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
    }
    now = target; await flush();
}
const packet = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
const text = value => ({choices:[{delta:{content:value}}]});
const thinking = value => ({choices:[{delta:{reasoning_content:value}}]});
const sentence = '{"module":"world","text":"城门已经关闭"}\n';
function streamFetch() {
    globalThis.fetch = async (_url, options) => {
        calls++;
        let controller;
        transport = {signal:options.signal, cancels:0};
        const body = new ReadableStream({
            start(value) { controller = value; },
            cancel() { transport.cancels++; return new Promise(() => {}); },
        });
        transport.emit = value => controller.enqueue(packet(value));
        // Deliberately ignore AbortSignal. Local timeout must release read().
        return new Response(body);
    };
}
async function start(signal, options = {}) {
    let settled = false;
    const promise = api.withCallBudget(1, 'watchdog', () => api.complete('test', {task:'PLAIN_MEMORY_READ'},
        {stream:true, singleAttempt:true, jsonContract:'sentences', timeoutMs:300000, signal, ...options}))
        .then(value => { settled = true; return {value}; }, error => { settled = true; return {error}; });
    await flush();
    return {promise, settled:() => settled};
}
const row = () => api.getDiagnostics().requests.at(-1);
function released() {
    assert.equal(timers.size, 0, 'deadline timer removed');
    assert.equal(intervals.size, 0, 'progress timer removed');
}

try {
    // Silent fetch must be bounded even when the implementation ignores abort.
    globalThis.fetch = (_url, options) => { calls++; transport = {signal:options.signal}; return new Promise(() => {}); };
    let run = await start();
    await advance(72000);
    assert.equal(run.settled(), false, 'a 72-second first-text delay remains allowed');
    for (const fn of intervals.values()) fn();
    assert.match(progress.at(-1)[2], /已等待 72 秒/);
    await advance(108000);
    assert.match((await run.promise).error.message, /180 秒内未收到首条正文/);
    assert.equal(row().timeoutKind, 'first_text');
    assert.equal(transport.signal.aborted, true);
    released();

    // Reproduce the reported 9.818s reasoning / 69.822s idle failure:
    // sparse reasoning must not consume the allowance for the first text.
    streamFetch(); run = await start();
    await advance(9818);
    transport.emit(thinking('推'.repeat(869))); await flush();
    await advance(60004);
    assert.equal(run.settled(), false, 'reasoning-only silence cannot trigger the post-text idle timeout');
    assert.equal(row().reasoningChars, 869);
    assert.equal(row().timeoutKind, '');
    for (const fn of intervals.values()) fn();
    assert.match(progress.at(-1)[2], /正文到达后启用停流计时/);
    await advance(30178);
    transport.emit(text(sentence)); await flush();
    assert.equal(row().firstTextMs, 100000, 'late first text is accepted');
    await advance(59999);
    assert.equal(run.settled(), false, 'first text starts a fresh idle allowance');
    await advance(1);
    assert.equal((await run.promise).value.factStream.facts.length, 1);
    assert.equal(row().timeoutKind, 'idle');
    released();

    // A single reasoning burst followed by silence still ends at 180s.
    streamFetch(); run = await start();
    await advance(9818);
    transport.emit(thinking('推'.repeat(869))); await flush();
    await advance(170181);
    assert.equal(run.settled(), false);
    await advance(1);
    const noText = (await run.promise).error;
    assert.match(noText.message, /首条正文等待超时/);
    assert.match(noText.message, /正文 0 字，推理 869 字/);
    assert.match(noText.message, /完整JSONL记录；本批未写入，此前已保存内容保留/);
    assert.equal(row().timeoutKind, 'first_text');
    assert.equal(row().durationMs, 180000);
    released();

    // Continuous reasoning cannot extend the fixed first-text deadline.
    streamFetch(); run = await start();
    for (let i = 0; i < 6; i++) { transport.emit(thinking('推理中')); await flush(); await advance(29000); }
    assert.equal(row().reasoningChars, 18, 'reasoning counts are live before completion');
    assert.equal(row().firstTextMs, null);
    for (const fn of intervals.values()) fn();
    assert.match(progress.at(-1)[0], /模型正在推理/);
    await advance(6000);
    assert.match((await run.promise).error.message, /首条正文等待超时/);
    assert.equal(row().failure, 'timeout');
    assert.equal(row().timeoutKind, 'first_text');
    assert.equal(transport.cancels, 1, 'hung cancellation must not block settlement');
    released();

    // Empty choice envelopes do not reset idle; complete records survive.
    streamFetch(); run = await start();
    transport.emit(text(sentence)); await flush();
    const activityAt = row().lastActivityMs;
    for (let i = 0; i < 5; i++) {
        await advance(10000); transport.emit({choices:[{delta:{}, index:0}], type:'response.in_progress'}); await flush();
    }
    assert.equal(row().lastActivityMs, activityAt);
    assert.equal(row().visibleChars, sentence.length);
    await advance(10000);
    const partial = (await run.promise).value;
    assert.equal(partial.factStream.end, false);
    assert.equal(partial.factStream.facts.length, 1);
    assert.equal(row().timeoutKind, 'idle');
    assert.equal(row().outcome, 'partial');
    released();

    // Even real text arriving forever cannot extend the fixed total limit.
    streamFetch(); run = await start();
    for (let i = 0; i < 10; i++) { transport.emit(text(sentence)); await flush(); await advance(29000); }
    assert.equal(run.settled(), false);
    await advance(10000);
    assert.equal((await run.promise).value.factStream.end, false);
    assert.equal(row().timeoutKind, 'total');
    released();

    // User cancellation propagates immediately, without returning partial data.
    streamFetch(); const abort = new AbortController(); run = await start(abort.signal);
    transport.emit(text(sentence)); await flush(); abort.abort(); await flush();
    assert.match((await run.promise).error.message, /用户取消/);
    assert.equal(row().outcome, 'cancelled');
    released();

    // A subsequent request succeeds: the operation budget is not left locked.
    streamFetch(); run = await start();
    transport.emit(text(sentence + '{"end":true}')); await flush();
    assert.equal((await run.promise).value.factStream.end, true);
    assert.equal(row().timeoutKind, '');
    released();
    assert.equal(calls, 8, 'exactly one transport call per operation; no retries');
    // Memory reads opt into activity deadlines: real progress can outlive
    // both the old first-text limit and the old five-minute total limit.
    streamFetch(); run = await start(undefined, {progressTimeout:true});
    for (let i = 0; i < 3; i++) {
        transport.emit(thinking('仍在读取完整资料')); await flush(); await advance(170000);
    }
    assert.equal(run.settled(), false, 'active reasoning survives 510 seconds');
    transport.emit(text(sentence)); await flush();
    await advance(90000);
    assert.equal(run.settled(), false, 'a 90-second provider pause does not cut the body');
    transport.emit(text('{"end":true}')); await flush();
    assert.equal((await run.promise).value.factStream.end, true);
    assert.equal(row().timeoutPolicy, 'activity');
    assert.equal(row().timeoutKind, '');
    released();

    streamFetch(); run = await start(undefined, {progressTimeout:true});
    transport.emit(text(sentence)); await flush();
    for (let i = 0; i < 3; i++) {
        await advance(30000); transport.emit({choices:[{delta:{}}]}); await flush();
    }
    await advance(30000);
    assert.equal((await run.promise).value.factStream.end, false, 'dead streams remain bounded despite heartbeat packets');
    assert.equal(row().timeoutKind, 'idle');
    assert.equal(row().idleTimeoutMs, 120000);
    released();

    streamFetch(); const activeAbort = new AbortController(); run = await start(activeAbort.signal, {progressTimeout:true});
    transport.emit(thinking('读原文')); await flush(); activeAbort.abort(); await flush();
    assert.match((await run.promise).error.message, /取消/);
    released();
    console.log('PASS stream watchdog: silent fetch, reasoning-only, empty packets, idle recovery, total limit, live progress, cancel and lock release. Real API calls: 0.');
} finally { Date.now = nativeNow; }
