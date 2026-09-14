import assert from 'node:assert/strict';
globalThis.window=globalThis;
globalThis.WorldStateMachine={};
for (const file of ['defaults','storage','state-logic','plain-memory','injection','memory-view']) await import(`../src/${file}.js`);
const W=WorldStateMachine, P=W.PlainMemory;
let user='你怎么知道我出来了？', body='沈舟在二楼走廊递给林夏一杯温水。';
const settings={enabled:true,injectionModules:structuredClone(W.Defaults.INJECTION_MODULES),storyPacing:{mode:'off'}};
W.Settings={get:()=>settings};
W.Context={latestUserMessage:()=>({content:user}),latestAssistantMessage:()=>({content:body}),identityNames:()=>({user:'林夏',char:'沈舟'})};
let state=P.normalize({storageFormat:P.FORMAT,initialized:true,identities:{user:'林夏',char:'沈舟'},memory:{
 world:['时间：2026-09-14 02:25｜位置：临空市 > 别墅 > 二楼走廊'],
 characters:['沈舟｜身份：工程师｜位置：别墅 > 二楼走廊｜性格：细心｜目标：明天按时交付','林夏｜位置：别墅 > 二楼走廊'],
 npcActivities:['沈舟｜活动地点：二楼走廊｜行动：递温水给林夏'],
 knowledge:['监控疑问｜怀疑：林夏怀疑房间装了监控，尚未证实'],
 worldRules:['无授权不可获取私人监控。'],
},planner:{notes:['必须保持纵容基调，最后让林夏回房睡觉。']}});
const inject=s=>Object.values(P.composeByDepth(s)).join('\n');
const short=inject(state);
assert.doesNotMatch(short,/必须保持纵容基调|本轮AI判断/);
assert.match(W.MemoryView.render(state,'planner'),/必须保持纵容基调/,'existing local notes are preserved');
assert.ok(P.composeByDepth(state)[2].includes('【状态使用边界】'));
assert.ok(!(P.composeByDepth(state)[0] || '').includes('【状态使用边界】'));
assert.match(short,/监控疑问/);
assert.match(short,/无授权不可获取私人监控/,'complete rule survives recall filtering');

// Long archives do not automatically flood the current scene just because their records are new.
for(let i=0;i<500;i++) {
 state.memory.characters.push(`远方人物${i}｜身份：职员｜位置：异地办公室${i}`);
 state.memory.npcActivities.push(`远方人物${i}｜活动地点：异地办公室${i}｜行动：核对账目`);
}
state.memory.triggers=['山谷风险｜条件：连续暴雨｜影响：河道可能漫溢'];
state.memory.processes=['异地工程｜动力：当地修缮｜当前：修补院墙'];
const packed=JSON.stringify(P.pack(state));
assert.equal(inject(state),short,'unrelated roster and background risks stay out of current narration');
for(let i=0;i<80;i++) {
 const prompts=P.composeByDepth(state);
 state.runtime.sentenceDelivery=P.commitDeliveryReceipt(state,P.createDeliveryReceipt(state,prompts));
 state=P.normalize(P.pack(state));
 assert.equal(inject(state),short,'no growing instructions across 80 delivery cycles');
}
assert.equal(state.memory.characters.length,502);
user='远方人物321现在在哪里？';
assert.match(inject(state),/远方人物321.*异地办公室321/,'an old absent NPC can be recalled');
assert.doesNotMatch(inject(state),/远方人物320｜/);
user='山谷风险的条件是什么？';assert.match(inject(state),/连续暴雨/,'saved risks remain retrievable');
user='继续';body='林夏在走廊打开了周宁发来的消息。';
state.memory.characters.push('周宁｜身份：林夏的同事｜位置：办公室');
state.memory.npcActivities.push('周宁｜活动地点：办公室｜行动：想邀请林夏午休吃饭（推测，依据同事关系与午休安排）');
assert.match(inject(state),/想邀请林夏午休吃饭/,'contact through an established channel can reach the foreground');
assert.doesNotMatch(inject(state),/远方人物321｜/,'recall is not made permanently resident');

const before=state.memory.npcActivities[0];
const next=P.apply(state,[{module:'npcActivities',before,text:'沈舟｜活动地点：卧室｜行动：收好水杯后休息'},
 {module:'characters',before:state.memory.characters[0],text:'沈舟｜身份：工程师｜位置：卧室｜性格：细心｜目标：明天按时交付'}]);
assert.deepEqual(next.errors,[]);
assert.ok(!next.state.memory.npcActivities.includes(before));
assert.equal(next.state.memory.npcActivities.filter(row=>row.startsWith('沈舟｜')).length,1);
assert.equal(next.state.memory.npcActivities.length,state.memory.npcActivities.length,'other NPCs survive an update');
assert.match(next.state.memory.characters[0],/细心.*明天按时交付/);
const noTasks=P.apply(next.state,[{module:'tasks',text:'午休安排｜状态：已完成｜结果：已结束'}]).state;
const settled=P.prepareSave(next.state,noTasks,'test');
assert.deepEqual(settled.memory.tasks,[]);
assert.deepEqual(P._test.missingAfterCleanup(next.state,settled),[],'no task does not require inventing one');
assert.match(W.MemoryView.render(settled,'tasks'),/暂无/);
assert.doesNotMatch(inject(settled),/暂无/,'empty-panel UI is not a memory fact');
assert.equal(Object.keys(settled.memory).length,P.MODULES.length,'all original columns still exist');
assert.ok(packed.includes('远方人物499'),'original memory survives filtering');

const requests=[];
W.Api={complete:async(system,payload)=>{requests.push({system,payload});return {factStream:{facts:[],end:true}};}};
await P._test.request('',{task:'PLAIN_MEMORY_SETTLE',memory:state.memory,assistantMessage:{content:body},source:{shouldNotSend:true}});
assert.equal(requests.length,1);
assert.equal(requests[0].payload.source,undefined);
assert.match(requests[0].system,/变化规模综合世界设定、故事类型、当前处境和已有因果/);
assert.match(requests[0].system,/日常主动联系、邀约、合作、小摩擦或继续休息/);
assert.match(requests[0].system,/不要求每轮新增事件/);
assert.match(requests[0].system,/全部栏目都要检查/);
assert.doesNotMatch(requests[0].system,/所有栏目必须读取并填写，不允许空栏目|moduleDecisions|truthStatus/);
assert.ok(requests[0].system.length<4096,'ordinary rules remain compact');
settings.storyPacing={mode:'slow'};
assert.match(P.composeByDepth(state)[0],/推进/,'explicit pacing remains effective');
settings.injectionModules.characters.depth=4;
assert.ok(P.composeByDepth(state)[4].includes('沈舟'),'configured module depths remain honored');
console.log(`Light autonomy passed: 502-person memory, 80 delivery cycles, recall, contact, updates, natural empty columns, local notes, pacing and unchanged short JSONL. Settlement prompt: ${requests[0].system.length} chars. Real API calls: 0.`);
