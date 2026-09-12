import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class {};
globalThis.dispatchEvent = () => {};
globalThis.localStorage = {getItem:() => null, setItem:() => {}};
const chatMetadata = {};
globalThis.SillyTavern = {getContext:() => ({chatId:'resume', characterId:0, chatMetadata, chat:[]})};
globalThis.getRequestHeaders = () => ({});
await import('../src/defaults.js');
await import('../src/storage.js');
await import('../src/state-logic.js');
await import('../src/plain-memory.js');
await import('../src/api.js');
const W = WorldStateMachine;
W.Settings = {get:() => ({useTavernApi:false, endpoint:'https://fixture.invalid/v1', model:'fixture', maxTokens:16384})};
W.Context = {identityNames:() => ({user:'玩家', char:'守卫'})};
const progress = [];
W.Engine = {reportProgress:(...args) => progress.push(args)};
const initial = W.PlainMemory.normalize(W.Defaults.createState());
const source = {worldbooks:[{name:'原书', entries:[{title:'全本',text:'设定'.repeat(20000) + '末尾唯一例外：持特许者除外。'}]}],
    character:{description:'守卫职责完整'}, persona:'玩家资料', chat:[{role:'assistant',text:'正文'.repeat(10000) + '末尾：守卫尚未到城门。'}]};
const payload = {task:'PLAIN_MEMORY_REASON', memory:initial.memory, source, missingModules:W.PlainMemory.MODULES,
    localState:W.StateLogic.context(initial)};
const a = {module:'characters',text:'守卫｜位置：卫所'};
const b = {module:'characters',before:a.text,text:'守卫｜位置：城门'};
const world = {module:'world',text:'当前时间：清晨'};
let calls, mode;
const encode = rows => rows.map(row => JSON.stringify(row)).join('\n');
const packet = (text, reason) => `data: ${JSON.stringify({choices:[{delta:{content:text}, ...(reason ? {finish_reason:reason} : {})}]})}\n\n`;
const response = (rows, reason='stop') => new Response(packet(encode(rows), reason), {headers:{'Content-Type':'text/event-stream'}});
globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content);
    calls.push(input);
    assert.deepEqual(input.source,source,'every continuation retains all original source characters, including the unique tail');
    assert.equal(body.reasoning_effort,'low');
    assert.equal(body.max_tokens,16384,'continuation does not lower the user output allowance');
    const step = calls.length;
    if (mode === 'network' && step === 1) throw new TypeError('Failed to fetch');
    if (mode === 'auth') return new Response('invalid API key',{status:401});
    if (mode === 'model-unavailable' || mode === 'partial-model-unavailable' && step > 1) return new Response(JSON.stringify({error:{code:'model_not_found',message:'No available channel for model fixture under group default (distributor)'}}),{status:503});
    if (mode === 'busy' && step === 1) return new Response('Service temporarily unavailable',{status:503});
    if (mode === 'partial-auth' && step > 1) return new Response('invalid API key',{status:401});
    if (mode === 'empty-tail') return new Response(packet('{"module":"characters","text":"unfinished', 'stop'));
    if (step > 1) {
        assert.equal(input.continuation.attempt,step - 1);
        assert.match(input.continuation.instruction,/不是新一轮世界推演/);
        if (!['network','busy'].includes(mode)) assert.deepEqual(input.memory.characters,[a.text],'resume uses accepted complete records as its baseline');
        assert.ok(input.localState.checks);
    }
    if (['persistent','partial-auth','partial-model-unavailable'].includes(mode)) return response([a]);
    if (mode === 'length' && step === 1) return response([a], 'length');
    if (mode === 'drop' && step === 1) {
        let reads = 0;
        return {ok:true,status:200,body:{getReader:() => ({
            async read() {
                if (reads++) throw new TypeError('Load failed');
                return {done:false,value:new TextEncoder().encode(packet(encode([a,world]) + '\n{"module":"characters","text":"未完成'))};
            }, cancel:async () => {},
        })}};
    }
    return response([a,b,{end:true}]);
};
const run = (hooks={}, signal) => W.Api.withCallBudget(3,'continuation-test',() => W.PlainMemory._test.request('核对剩余内容',payload,signal,hooks));

calls=[]; mode='drop';
const streamed=[];
let result=await run({onSentence:rows => streamed.push(...rows)});
assert.equal(calls.length,2);
assert.equal(result.complete,true);
assert.deepEqual(result.records,[a,world,b],'replayed prefix is deduplicated and the unfinished row is regenerated');
assert.deepEqual(streamed,result.records,'only unique complete records reach checkpoints');
assert.deepEqual(W.PlainMemory.apply(initial,result.records).state.memory.characters,[b.text]);
assert.equal(W.Api.getDiagnostics().requests.at(-2).failure,'stream');
assert.equal(W.Api.getDiagnostics().requests.at(-1).continuationAttempt,1);

calls=[]; mode='length'; result=await run();
assert.equal(result.complete,true);
assert.equal(calls.length,2,'token-limit interruption resumes without dropping the rest');
assert.deepEqual(result.records,[a,b]);

calls=[]; mode='network'; result=await run();
assert.equal(result.complete,true);
assert.equal(calls.length,2,'transient failure before any data has a bounded retry');

calls=[]; mode='persistent'; result=await run();
assert.equal(result.complete,false,'exhausted continuation never fabricates a completion receipt');
assert.equal(calls.length,3);
assert.deepEqual(result.records,[a],'complete records survive all unsuccessful continuations');

calls=[]; mode='auth'; await assert.rejects(run(),/401/);
assert.equal(calls.length,1,'authentication failures do not trigger automatic retries');
calls=[]; mode='model-unavailable'; await assert.rejects(run(),/当前 API 分组没有可用通道.*不自动重试.*model_not_found/);
assert.equal(calls.length,1,'model_not_found is terminal even under HTTP 503');
calls=[]; mode='partial-model-unavailable'; result=await run();
assert.equal(calls.length,2,'a missing channel stops after the failed continuation');
assert.equal(result.complete,false);
assert.deepEqual(result.records,[a],'records received before channel failure remain intact');
calls=[]; mode='busy'; result=await run();
assert.equal(result.complete,true);
assert.equal(calls.length,2,'ordinary transient 503 remains recoverable');
calls=[]; mode='empty-tail'; await assert.rejects(run(),/完整的事实句子/);
assert.equal(calls.length,3,'a response containing only an unfinished row is also recoverable');
calls=[]; mode='partial-auth'; result=await run();
assert.equal(calls.length,2);
assert.equal(result.complete,false);
assert.deepEqual(result.records,[a],'terminal failure after partial output does not erase it');

calls=[]; mode='persistent'; const cancel = new AbortController();
await assert.rejects(run({onSentence:() => cancel.abort()},cancel.signal),/取消/);
assert.equal(calls.length,1,'cancellation stops continuation immediately');
calls=[]; let checks=0;
await assert.rejects(run({beforeAttempt:() => {if (++checks > 1) throw new Error('聊天已切换');}}),/聊天已切换/);
assert.equal(calls.length,1,'a changed chat cannot start a continuation');
assert.ok(progress.some(row => row[0].includes('接续读取')));
// Ordinary reads must not regain raw sources through retries or extra caller
// fields. Keep the complete selected body and every compact memory module.
const compactMemory = structuredClone(initial.memory);
compactMemory.worldbook = ['城门制度：持令牌可通行，紧急特许者除外。'];
const fullBody = '上一轮正文'.repeat(6000) + '末尾独有事实：守卫已抵达城门。';
const incrementalPayload = {...payload, task:'PLAIN_MEMORY_SETTLE', memory:compactMemory,
    assistantMessage:{content:fullBody}, userMessage:'MUST_NOT_SEND_NEW_USER_MESSAGE',
    worldbooks:source.worldbooks, character:source.character, persona:source.persona, history:source.chat};
let bodyCalls=0;
globalThis.fetch = async (_url, options) => {
    const body=JSON.parse(options.body), input=JSON.parse(body.messages[1].content);
    bodyCalls++;
    for (const key of ['source','worldbooks','character','persona','history','userMessage']) assert.equal(input[key],undefined,`${key} cannot enter incremental reads`);
    assert.equal(input.assistantMessage.content,fullBody,'body tail remains intact in the original request and continuation');
    assert.deepEqual(input.memory.worldbook,compactMemory.worldbook,'the plugin worldbook supplement is retained');
    assert.doesNotMatch(options.body,/MUST_NOT_SEND_NEW_USER_MESSAGE|末尾唯一例外/,'raw sources cannot leak through another field');
    assert.ok(body.messages[0].content.length < 4096,'ordinary reads cannot silently inherit the full initialization/recompression prompt');
    if (bodyCalls === 1) return response([a],'length');
    assert.deepEqual(input.memory.characters,[a.text]);
    assert.match(input.continuation.instruction,/仍只依据精简memory及完整assistantMessage/);
    assert.doesNotMatch(input.continuation.instruction,/完整source仍在/);
    return response([b,{end:true}]);
};
result=await W.Api.withCallBudget(3,'incremental-body',() => W.PlainMemory._test.request('ignored',incrementalPayload));
assert.equal(bodyCalls,2);
assert.equal(result.complete,true);
assert.deepEqual(result.records,[a,b]);
console.log('PASS read continuation: real SSE disconnect, output cap, transient network failure, exact source retention, ordered deduplication, auth, cancellation, chat guard and bounded retries. Real API calls: 0.');
