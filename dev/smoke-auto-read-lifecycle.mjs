import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class {constructor(type, options={}) {this.type=type;this.detail=options.detail;}};
globalThis.dispatchEvent = () => {};
globalThis.addEventListener = () => {};
const local = new Map();
globalThis.localStorage = {getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)};
// SillyTavern awaits each listener, including synchronous listeners.
const listeners = new Map();
const eventSource = {on(name,fn) {if(!listeners.has(name)) listeners.set(name,[]);listeners.get(name).push(fn);},
    async emit(name,...args) {for(const fn of listeners.get(name)||[]) await fn(...args);}};
const ctx = {chatId:'auto-read',characterId:0,chatMetadata:{},name1:'访客',name2:'医师',chat:[],
    saveChat:async()=>{},setExtensionPrompt:async()=>{},eventSource,
    event_types:{MESSAGE_RECEIVED:'received',MESSAGE_SWIPED:'swiped',MESSAGE_DELETED:'deleted',CHAT_CHANGED:'chat-changed'}};
globalThis.SillyTavern = {getContext:()=>ctx};
for(const name of ['defaults','storage','state-logic','plain-memory','context','injection']) await import(`../src/${name}.js`);
const W=WorldStateMachine;
W.Settings={get:()=>({enabled:true,injectionModules:W.Defaults.INJECTION_MODULES,worldbookCompiler:{enabled:false}})};
let calls=0, duringRequest=async()=>{}, receivedContent='';
const settlements=[];
W.Api={withCallBudget:async(_n,_label,run)=>run(),recordValidation:()=>{},
    recordSettlement:row=>settlements.push(row),
    async complete(_prompt,payload) {calls++;receivedContent=payload.assistantMessage.content;await duringRequest();return {factStream:{end:true,facts:[]}};}};
await import('../src/engine.js');
await W.Engine.init();
async function reset() {
    ctx.chatId='auto-read';ctx.chatMetadata={};
    ctx.chat=[{is_user:true,name:'访客',send_date:'u',mes:'我来复诊。'},
        {is_user:false,name:'医师',send_date:'a',mes:'医师请访客坐下。',swipe_id:0,extra:{}}];
    const state=W.PlainMemory.normalize(W.Defaults.createState());
    state.initialized=true;
    for(const module of W.PlainMemory.MODULES) state.memory[module]=[`${W.PlainMemory.LABELS[module]}已有当前有效记录。`];
    await W.Storage.save(state,'fixture',{snapshot:false});
    calls=0;duringRequest=async()=>{};receivedContent='';
}
await reset();
await W.Engine.readPreviousBody();
assert.equal(W.Engine.getProgress().state,'success','稳定消息手动读取成功');
assert.equal(settlements.at(-1).background,undefined);
assert.equal(settlements.at(-1).outcome,'complete');
await reset();
duringRequest=async()=>{
    const message=ctx.chat.at(-1);
    message.extra.token_count=123;message.extra.reasoning_duration=800;
    message.gen_finished=123456;message.swipes=[message.mes];
    message.swipe_info=[{extra:{token_count:123}}];
};
await eventSource.emit('received',1,'normal');
await W.Engine._test.waitForPostGenerationReads();
assert.equal(W.Engine.getProgress().state,'success',`仅统计/渲染元数据变化不能使自动读取失败：${W.Engine.getProgress().details}`);
assert.equal(calls,1);assert.equal(W.Storage.load().runtime.lastPreviousBodyFloor,2);
assert.equal(settlements.at(-1).background,true);
assert.equal(settlements.at(-1).saved,true);
await eventSource.emit('received',1,'normal');await W.Engine._test.waitForPostGenerationReads();
assert.equal(calls,1,'重复完成事件不重复请求');

// Later message listeners finish cleanup before the automatic request starts.
await reset();
ctx.chat.at(-1).mes='尚未完成整理的正文';
let cleanup=true;
eventSource.on('received',async()=>{if(cleanup){for(let i=0;i<20;i++) await Promise.resolve();ctx.chat.at(-1).mes='整理完成的正文';}});
await eventSource.emit('received',1,'normal');await W.Engine._test.waitForPostGenerationReads();cleanup=false;
assert.equal(receivedContent,'整理完成的正文');assert.equal(W.Engine.getProgress().state,'success');

await reset();
const incomplete=W.Storage.load();incomplete.memory.schedules=[];
await W.Storage.save(incomplete,'empty-schedules',{snapshot:false});
await eventSource.emit('received',1,'normal');await W.Engine._test.waitForPostGenerationReads();
assert.equal(settlements.at(-1).outcome,'incomplete');
assert.equal(settlements.at(-1).reason,'missing_modules');
assert.equal(settlements.at(-1).saved,true,'空栏校验与写入保护失败必须分开记录');

await reset();
ctx.setExtensionPrompt=async()=>{throw new Error('fixture prompt failure');};
await eventSource.emit('received',1,'normal');await W.Engine._test.waitForPostGenerationReads();
ctx.setExtensionPrompt=async()=>{};
assert.equal(settlements.at(-1).stage,'injection');
assert.equal(settlements.at(-1).saved,true);
assert.match(W.Engine.getProgress().message,/正文已保存/,'保存之后的失败不能误称旧状态保留');

for(const [name,mutate,error] of [
    ['正文编辑',()=>{ctx.chat.at(-1).mes='用户修改后的正文';},/正文/],
    ['隐藏楼层',()=>{ctx.chat.at(-1).is_system=true;},/正文/],
    ['切换候选',()=>{ctx.chat.at(-1).swipe_id=1;},/正文/],
    ['新增空楼层',()=>{ctx.chat.push({is_user:false,mes:''});},/正文/],
    ['删除楼层',()=>{ctx.chat.pop();},/正文/],
    ['聊天切换',()=>{ctx.chatId='different';},/聊天已切换/],
    ['状态更新',async()=>{await W.Storage.save(W.Storage.load(),'concurrent',{snapshot:false});},/状态/],
]) {
    await reset();const before=W.Storage.load().revision;
    duringRequest=mutate;
    await eventSource.emit('received',1,'normal');await W.Engine._test.waitForPostGenerationReads();
    assert.equal(W.Engine.getProgress().state,'error',name);
    assert.match(W.Engine.getProgress().details,error,name);
    assert.equal(settlements.at(-1).stage,'guard_after_request');
    assert.equal(settlements.at(-1).saved,false);
    assert.equal(settlements.at(-1).reason,name==='聊天切换'?'chat_changed':name==='状态更新'?'state_changed':'body_changed');
    if(!['聊天切换','状态更新'].includes(name)) assert.equal(W.Storage.load().revision,before,`${name}的旧结果不得写入`);
}
console.log('PASS automatic/manual reads: metadata-only updates, event cleanup, deduplication; real edits, swipes, hidden/empty/deleted floors, chat and revision changes remain protected. API calls are mocked.');
