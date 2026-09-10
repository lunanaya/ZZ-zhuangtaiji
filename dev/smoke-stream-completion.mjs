import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.getRequestHeaders = () => ({});
globalThis.WorldStateMachine = { Settings: { get: () => ({ useTavernApi: false, endpoint: 'https://example.invalid/v1', model: 'test', maxTokens: 5000 }) } };
globalThis.SillyTavern = { getContext: () => ({ getRequestHeaders: () => ({}) }) };
await import('../src/api.js');
const api = WorldStateMachine.Api;
const run = () => api.withCallBudget(1, 'test', () => api.complete('test', { task: 'SOURCE_READ_SEQUENTIAL_BATCH' }, { stream: true, jsonContract: 'evidence' }));
const chunk = value => new TextEncoder().encode(value);
const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
let cancelled = false;
globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
        controller.enqueue(chunk(event({ choices: [{ delta: { content: '{"evidence":{"canon":[]}}' } }] })));
        controller.enqueue(chunk('data: [DO'));
        controller.enqueue(chunk('NE]\n\n'));
        // Deliberately keep HTTP open, as some proxies do.
    },
    cancel() { cancelled = true; },
}));
const result = await run();
assert.deepEqual(result, { evidence: { canon: [] } });
assert.equal(cancelled, true, 'DONE must finish without waiting for the HTTP socket');
const interrupted = api._test.parseSseResponse(event({ choices: [{ delta: { reasoning_content: 'thinking' } }] }), true);
assert.equal(interrupted.choices[0].finish_reason, '', 'interruption must not be mislabeled as token exhaustion');
assert.equal(interrupted.reasoningChars, 8);
const failureAfterContent = api._test.parseSseResponse(event({ choices: [{ delta: { content: '{}' } }] }) + event({ error: { message: 'Gateway Timeout' } }));
assert.equal(failureAfterContent.error.message, 'Gateway Timeout');
const responsesStyle = api._test.parseSseResponse(
    event({ type: 'response.output_text.delta', delta: '{"evidence":{"canon":[]}}' })
    + event({ type: 'response.completed', response: { status: 'completed' } }),
);
assert.equal(responsesStyle.choices[0].message.content, '{"evidence":{"canon":[]}}', 'Responses风格SSE正文不得被误判为0字');
const anthropicStyle = api._test.parseSseResponse(
    event({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } })
    + event({ type: 'content_block_delta', delta: { type: 'text_delta', text: '{"evidence":{"canon":[]}}' } })
    + event({ type: 'message_stop' }),
);
assert.equal(anthropicStyle.choices[0].message.content, '{"evidence":{"canon":[]}}', 'Anthropic风格SSE正文不得被误判为0字');
assert.equal(anthropicStyle.reasoningChars, 6);
globalThis.fetch = async () => new Response(event({ choices: [{ delta: { content: '{"evidence":{"canon":[]}}' }, finish_reason: 'length' }] }));
const lengthRecovered = await run();
assert.deepEqual(lengthRecovered, { evidence: { canon: [] } }, '输出上限之前已闭合的证据必须安全保留');
console.log('Stream termination, interruption classification and error propagation tests passed');

const nativeSetTimeout = globalThis.setTimeout;
let calls = 0;
const sentenceRun = (signal) => api.withCallBudget(1,'sentence-stream',() => api.complete('test',{task:'PLAIN_MEMORY_READ'}, {stream:true,singleAttempt:true,jsonContract:'sentences',signal}));
const sentence = '{"module":"characters","text":"张三位于城门"}\n';
const streamText = content => event({choices:[{delta:{content}}]});
// The model receipt can arrive across byte chunks without a transport terminator.
let receiptCancelled = false;
globalThis.fetch = async () => {
    calls++;
    return new Response(new ReadableStream({
        start(controller) {
            const bytes=chunk(streamText(sentence+'{"end":true}').trimEnd());
            for (let offset=0;offset<bytes.length;offset+=7) controller.enqueue(bytes.slice(offset,offset+7));
        },
        cancel() { receiptCancelled=true; },
    }));
};
const receiptSignal = new AbortController();
const watchdog=nativeSetTimeout(()=>receiptSignal.abort(),1000);
try { assert.equal((await sentenceRun(receiptSignal.signal)).factStream.end,true); }
finally { clearTimeout(watchdog); }
assert.equal(receiptCancelled,true,'complete model receipt closes a hanging stream');
assert.equal(calls,1,'receipt recovery sends no additional request');

// A dropped stream without a receipt saves complete sentences but stays incomplete.
globalThis.fetch = async () => {
    calls++;
    let sent=false;
    return new Response(new ReadableStream({pull(controller) {
        if (!sent) { sent=true; controller.enqueue(chunk(streamText(sentence+'{"end":tr'))); }
        else controller.error(new TypeError('Load failed'));
    }}));
};
const partial=await sentenceRun();
assert.equal(partial.factStream.end,false);
assert.equal(partial.factStream.facts.length,1);
assert.equal(calls,2,'partial network failure is not retried');
globalThis.fetch = async () => { calls++; throw new TypeError('Load failed'); };
await assert.rejects(sentenceRun(),/连接中断.*已有状态保留.*不会自动重试/);
assert.equal(calls,3);

// A quoted end marker in a sentence is not a receipt; ping-only activity cannot
// keep extending the idle deadline. Fake only the API timer, not stream reads.
let idleCallback, timerArms=0;
globalThis.setTimeout = callback => { idleCallback=callback; timerArms++; return 0; };
globalThis.fetch = async (_url,options) => {
    calls++;
    return new Response(new ReadableStream({start(controller) {
        options.signal.addEventListener('abort',()=>controller.error(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});
        controller.enqueue(chunk(streamText(JSON.stringify({module:'world',text:'示例：{"end":true}'})+'\n')));
        nativeSetTimeout(()=>{
            controller.enqueue(chunk(': heartbeat\n\ndata: {"type":"ping"}\n\n'));
            nativeSetTimeout(()=>idleCallback(),10);
        },10);
    }}));
};
try {
    const stalled=await sentenceRun();
    assert.equal(stalled.factStream.end,false,'quoted end marker must not complete the task');
    assert.equal(timerArms,2,'one initial timer and one content reset; no ping reset');
} finally { globalThis.setTimeout=nativeSetTimeout; }
assert.equal(calls,4);
console.log('Sentence stream receipt, partial Load failed, idle heartbeats and single-call limits passed. Real API calls: 0.');
