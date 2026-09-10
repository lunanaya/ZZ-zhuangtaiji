import assert from 'node:assert/strict';
globalThis.window=globalThis;
globalThis.WorldStateMachine={};
await import('../src/defaults.js');
await import('../src/storage.js');
await import('../src/state-logic.js');
await import('../src/worldbook-memory.js');
await import('../src/plain-memory.js');
const W=WorldStateMachine;
const settings={enabled:true,injectionModules:structuredClone(W.Defaults.INJECTION_MODULES)};
W.Settings={get:()=>settings};
W.Context={latestUserMessage:()=>({content:'继续。'}),identityNames:()=>({user:'访客',char:'守卫'})};
const restriction='访客｜允许：书房、小院｜禁止：出院门｜解除条件：守卫收到放行令';
const conduct='守卫已安排两人跟随访客，并要求报告其出行路线。';
const intent='守卫说希望访客留下；访客尚未同意。';
const original='守卫被设定为占有欲较强，但是否采取行动需符合当前条件。';
const state=W.PlainMemory.normalize({storageFormat:'sentences-v1',initialized:true,memory:{resourceConstraints:[restriction],npcActivities:[conduct],relationships:[intent]},runtime:{}});
W.WorldbookMemory.retain(state,{worldbooks:[{name:'测试设定',entries:[{id:'0',content:original}]}]});
const before=JSON.stringify(state);
let last='';
for(let i=0;i<10;i++) {
    const injection=Object.values(W.PlainMemory.composeByDepth(state)).join('\n');
    assert.equal(injection.split('【状态使用边界】').length-1,1,'one fixed guidance block, not one per record or turn');
    assert.ok(injection.includes('主观标签不代表行为强度'));
    assert.ok(injection.includes('无新证据则保持当前尺度'));
    assert.ok(injection.includes('不得预定玩家的感受、选择或关系结局'));
    assert.ok(injection.includes(restriction),'neutral wording must not erase actual movement restrictions');
    assert.ok(injection.includes(conduct),'specific following/reporting behavior remains factual');
    assert.ok(injection.includes(intent),'wishes must retain attribution and lack of consent');
    assert.ok(injection.includes(original),'source is preserved, accompanied by interpretation limits');
    if(last) assert.equal(injection,last,'unchanged state does not gain stronger instructions or extra blocks');
    last=injection;
}
assert.equal(JSON.stringify(state),before,'no blind adjective replacement or rewrite without reading sources');
state.runtime.finalInjectionOverride='本轮仍在讨论出行安排。';
const override=Object.values(W.PlainMemory.composeByDepth(state)).join('\n');
assert.ok(override.includes('【状态使用边界】'));
assert.ok(override.includes(original));
settings.enabled=false;
assert.deepEqual(W.PlainMemory.composeByDepth(state),{});
settings.enabled=true;
const prompts=[];
W.Api={complete:async(system,payload)=>{prompts.push({system,payload});return{factStream:{facts:[],end:true}};}};
for(const task of ['PLAIN_MEMORY_READ','PLAIN_MEMORY_REASON','PLAIN_MEMORY_SETTLE','PLAIN_MEMORY_ORGANIZE']) {
    await W.PlainMemory._test.request('任务说明',{task,memory:state.memory,source:{worldbooks:[]}});
}
for(const {system,payload} of prompts) {
    assert.ok(system.includes('全栏目客观记录规则'),payload.task);
    assert.ok(system.includes('不能换个栏目继续保存带方向的强化叙事'));
    assert.ok(system.includes('不能因旧条未变就KEEP错误解释'));
    assert.ok(system.includes('不能用温和词把限制改成同意或普通照顾'));
    assert.ok(system.includes('全栏目必填不授权编造因果'));
    assert.ok(system.includes('用before逐字替换或删除错误部分'));
    assert.equal(payload.memory.resourceConstraints[0],restriction);
}
console.log('Objective framing passed: all read stages and generation paths, persistent no-escalation instructions, player agency, factual restrictions, source preservation, no automatic euphemism and no growing blocks. Real API calls: 0.');
