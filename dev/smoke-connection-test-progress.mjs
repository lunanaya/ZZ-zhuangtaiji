import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

globalThis.window=globalThis;
globalThis.WorldStateMachine={};
const W=WorldStateMachine;
const native={now:Date.now,setTimeout,clearTimeout,setInterval,clearInterval};
let now=1000,id=0,calls=0,transport;
const timers=new Map(),intervals=new Map(),uiErrors=[];
Date.now=()=>now;
globalThis.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{fn,at:now+ms});return key;};
globalThis.clearTimeout=key=>timers.delete(key);
globalThis.setInterval=fn=>{const key=++id;intervals.set(key,fn);return key;};
globalThis.clearInterval=key=>intervals.delete(key);
globalThis.CustomEvent=class {constructor(type,{detail}) {this.type=type;this.detail=detail;}};
globalThis.dispatchEvent=event=>{
    if(event.type==='wsm-operation-progress' && W.UI) {
        try {W.UI._test.renderOperationStatus(event.detail,state);} catch(error) {uiErrors.push(error);}
    }
};
globalThis.getRequestHeaders=()=>({});
await import('../src/defaults.js');
const state={initialized:true,revision:5,runtime:{plainReadIncomplete:true,plainInitIncomplete:true},
    planner:{error:'Planner API 后端转发失败 503: model_not_found No available channel'}};
const savedBefore=JSON.stringify(state);
W.Settings={get:()=>({enabled:true,useTavernApi:false,endpoint:'https://fixture.invalid/v1',model:'fixture',maxTokens:1000})};
W.Storage={load:()=>state,currentChatKey:()=>'chat-a'};
W.Context={context:()=>({chat:[]})};
W.PlainMemory={isPlain:()=>true,canInitialize:()=>true};
await import('../src/api.js');
await import('../src/engine.js');

const nodes=new Map();
const node=selector=>{
    if(!nodes.has(selector)) nodes.set(selector,{dataset:{},textContent:'',innerHTML:'',hidden:false,disabled:false,querySelector:node});
    return nodes.get(selector);
};
globalThis.connectionTestRoot={querySelector:node};
// Bind only the DOM root and expose the existing render function. The API,
// engine, progress rendering and button-enable logic all run unchanged.
const uiSource=(await readFile(new URL('../src/ui.js',import.meta.url),'utf8'))
    .replace('    let root;','    let root = window.connectionTestRoot;')
    .replace('_test: { modalHtml','_test: { renderOperationStatus, modalHtml');
vm.runInThisContext(uiSource);
const flush=async()=>{for(let i=0;i<50;i++) await Promise.resolve();};
async function advance(ms) {
    const target=now+ms;
    while(true) {
        const due=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!due) break;
        now=due[1].at;timers.delete(due[0]);due[1].fn();await flush();
    }
    now=target;await flush();
}
function streaming() {
    globalThis.fetch=async(_url,options)=>{
        calls++;
        let controller;
        const body=new ReadableStream({start(c){controller=c;},cancel(){return new Promise(()=>{});}});
        transport={signal:options.signal,emit:text=>controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\n`))};
        return new Response(body);
    };
}
async function start(options={}) {
    const promise=W.Api.test(options).then(value=>({value}),error=>({error}));
    await flush();return {promise};
}
function released(expected) {
    assert.equal(W.Engine.getProgress().state,expected);
    assert.equal(W.Engine.getProgress().operationKind,'connection-test');
    assert.deepEqual(uiErrors,[],'progress updates render successfully');
    for(const selector of ['#wsm-read-current','#wsm-read-previous','#wsm-clear-read','[data-action="organize"]']) {
        assert.equal(node(selector).disabled,false,`${selector} is unlocked after testing`);
    }
    assert.equal(timers.size,0,'request deadline is removed');
    assert.equal(intervals.size,0,'stream progress interval is removed');
    assert.equal(JSON.stringify(state),savedBefore,'testing cannot mark incomplete memory complete or modify it');
}
try {
    W.Engine.reportProgress('正在准备读取当前聊天','running');
    await advance(467000);
    W.Engine.reportProgress('初始化未完成','error','old error');
    streaming(); const startedAt=now; let run=await start();
    assert.equal(W.Engine.getProgress().startedAt,startedAt,'connection testing starts its own clock');
    assert.equal(W.Engine.getProgress().steps.length,1,'old initialization steps are not inherited');
    assert.equal(node('#wsm-read-previous').disabled,true,'reads stay blocked during a real active request');
    await advance(5000); for(const fn of intervals.values()) fn();
    assert.match(W.Engine.getProgress().details,/已等待 5 秒/);
    const activeProgress=W.Engine.getProgress();
    await assert.rejects(W.Api.test(),/已有 API 任务/);
    assert.deepEqual(W.Engine.getProgress(),activeProgress,'rejected duplicate test cannot reset active progress');
    transport.emit('{"ok":true}'); await flush();
    assert.equal((await run.promise).value,true);
    released('success');
    assert.equal(node('.wsm-operation-current>b').textContent,'API 连接测试成功','old memory errors do not replace the test result');
    assert.equal(node('.wsm-operation-steps').hidden,true,'completed test has no endless running trail');
    assert.equal(W.Engine.getProgress().elapsedMs,5000);
    await advance(600000);
    assert.equal(W.Engine.getProgress().elapsedMs,5000,'completed elapsed time stays frozen');
    await W.Api.withCallBudget(0,'after-test',async()=>true);

    streaming(); run=await start({forceExternal:true}); transport.emit('{"ok":false}'); await flush();
    assert.match((await run.promise).error.message,/没有收到有效.*ok:true/);
    released('error');

    globalThis.fetch=async()=>{calls++;return new Response('{"error":{"code":"model_not_found","message":"No available channel"}}',{status:503});};
    run=await start(); assert.match((await run.promise).error.message,/没有可用通道/);
    released('error');
    assert.equal(node('.wsm-operation-current>b').textContent,'API 连接测试失败');

    globalThis.fetch=async()=>{calls++;throw new TypeError('Failed to fetch');};
    run=await start();assert.match((await run.promise).error.message,/连接中断/);released('error');

    // A hung fetch that ignores cancellation must still release the UI on timeout.
    globalThis.fetch=()=>{calls++;return new Promise(()=>{});};
    run=await start();await advance(180000);
    assert.match((await run.promise).error.message,/超时/);released('error');

    streaming();const abort=new AbortController();run=await start({signal:abort.signal});
    abort.abort();await flush();assert.match((await run.promise).error.message,/取消/);released('cancelled');
    assert.equal(transport.signal.aborted,true);

    W.Engine.reportProgress('依据精简记忆读取上一轮正文并推理','running');
    assert.equal(W.Engine.getProgress().operationKind,'','a subsequent reader cannot inherit connection-test ownership');
    assert.equal(W.Engine.getProgress().startedAt,now);
    assert.equal(W.Engine.getProgress().steps.length,1);
    const readerProgress=W.Engine.getProgress();
    await W.Api.withCallBudget(1,'active-reader',async()=>{
        await assert.rejects(W.Api.test(),/已有 API 任务/);
        assert.deepEqual(W.Engine.getProgress(),readerProgress,'a rejected test cannot unlock another reader');
    });
    assert.equal(calls,6,'one API per test and no requests for rejected overlapping tests');
    console.log('PASS connection test lifecycle: real API/engine/UI, fresh clock and steps, success, negative receipt, HTTP/network errors, timeout, cancel, button release, budget isolation and unchanged memory. Real API calls: 0.');
} finally {
    Date.now=native.now;
    for(const name of ['setTimeout','clearTimeout','setInterval','clearInterval']) globalThis[name]=native[name];
}
