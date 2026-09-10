import assert from 'node:assert/strict';
globalThis.window=globalThis;
globalThis.WorldStateMachine={};
for(const name of ['defaults','storage','state-logic','plain-memory','injection']) await import(`../src/${name}.js`);
const W=WorldStateMachine, P=W.PlainMemory, L=W.StateLogic;
let user='继续';
W.Settings={get:()=>({enabled:true,injectionModules:W.Defaults.INJECTION_MODULES})};
W.Context={latestUserMessage:()=>({content:user}),identityNames:()=>({user:'访客',char:'守卫'})};
const fresh=()=>P.normalize({storageFormat:P.FORMAT,initialized:true});
const save=(old,next,id='')=>P.prepareSave(old,next,'test',{snapshotReadReceipt:{messageKey:id},receiptConfirmed:true});
const inject=s=>Object.values(P.composeByDepth(s)).join('\n');
const deliver=s=>{const prompts=P.composeByDepth(s);s.runtime.sentenceDelivery=P.commitDeliveryReceipt(s,P.createDeliveryReceipt(s,prompts));};
const key=P._test.sentenceKey;

let state=fresh(); state.memory.world=['时间：2026-09-10 10:00'];
state.memory.schedules=['送信｜时间：2026-09-10 10:00｜状态：已约定'];
state=save(fresh(),state,'body-1');
assert.match(inject(state),/送信/); deliver(state);
user='送信安排是什么？'; assert.match(inject(state),/送信/); deliver(state);
user='继续'; assert.doesNotMatch(inject(state),/送信/,'query cannot erase due receipt');
let before=state.memory.schedules[0];
let next=P.apply(state,[{module:'schedules',before,text:before+'｜补充：带好文书'}]).state;
state=save(state,next,'body-2');
assert.doesNotMatch(inject(state),/送信/,'before replacement preserves due history');
next=structuredClone(state); next.memory.schedules=[state.memory.schedules[0]+'｜参与：访客'];
state=save(state,next,'body-3');
assert.doesNotMatch(inject(state),/送信/,'unique named manual replacement preserves history');
next=P.apply(state,[{module:'schedules',before:state.memory.schedules[0],text:'送信｜时间：2026-09-11 10:00｜状态：已约定'}]).state;
state=save(state,next,'body-4'); assert.doesNotMatch(inject(state),/送信/);
next=structuredClone(state); next.memory.world=['时间：2026-09-11 10:00'];
state=save(state,next,'body-5'); assert.match(inject(state),/送信/,'reschedule permits a new due notice');
deliver(state); state=P.normalize(P.pack(state)); assert.doesNotMatch(inject(state),/送信/);

state=fresh(); state.memory.world=['时间：2026-09-10 10:00'];
state.memory.schedules=['赴宴｜时间：2026-09-10 10:00']; state=save(fresh(),state);
user='赴宴安排是什么？'; deliver(state); user='继续';
assert.doesNotMatch(inject(state),/赴宴/,'query at deadline counts as its due delivery');
state.runtime.sentenceDelivery={[key('schedules',state.memory.schedules[0])]:{reason:`due:${W.Storage.storyTimestamp('2026-09-10 10:00')}`,turn:0}};
assert.doesNotMatch(inject(state),/赴宴/,'legacy due format is recognized');
state=fresh(); state.memory.schedules=['灵隐寺出行｜时间：2026-09-20 10:00'];
user='灵隐寺的风景真好'; assert.match(inject(state),/灵隐寺出行/); deliver(state);
for(let i=0;i<40;i++){state=save(state,state,`related-${i}`);assert.doesNotMatch(inject(state),/灵隐寺出行/);}
user='灵隐寺出行什么时候？'; assert.match(inject(state),/灵隐寺出行/); user='继续';

state=fresh(); before='巡夜事件｜实施者：守卫｜条件：夜间开放'; state.memory.triggers=[before]; deliver(state);
const reordered='巡夜事件｜条件：夜间开放｜实施者：守卫';
assert.equal(P.apply(state,[{module:'triggers',before,text:reordered}]).changed,0);
assert.deepEqual(P.apply(state,[{module:'triggers',text:reordered}]).state.memory.triggers,[before]);
assert.doesNotMatch(inject(state),/巡夜事件/);
next=P.apply(state,[{module:'triggers',before,text:before.replace('夜间开放','警报已响')}]).state;
state=save(state,next); assert.match(inject(state),/巡夜事件/,'changed risk conditions can notify');
assert.equal(P._test.lines(['门禁｜允许：出门','门禁｜禁止：出门']).length,2);

// Independent, overlapping actors and affairs survive each other's updates.
state=fresh(); for(const module of P.MODULES) if(module!=='worldbook')state.memory[module]=[`${module}现有记录`];
state.memory.npcActivities=['甲｜活动地点：驿站｜行动：整理包裹'];
state.memory.schedules=['送信｜状态：进行中','值班｜状态：已约定'];
next=P.apply(state,[{module:'npcActivities',text:'乙｜活动地点：城门｜行动：巡查（推测，依据轮值职责）'},
    {module:'schedules',text:'清点物资｜状态：候选｜依据：推测，月底盘点职责'}]).state;
state=save(state,next,'parallel-1');
assert.equal(state.memory.npcActivities.length,2);
assert.equal(state.memory.schedules.length,3,'new candidates are allowed in nonempty columns');
next=P.apply(state,[{module:'schedules',before:state.memory.schedules[0],text:'送信｜状态：已完成｜结果：已交付'}]).state;
assert.ok(!P._test.missingAfterCleanup(state,next).includes('schedules'));
state=save(state,next,'parallel-2'); assert.equal(state.memory.schedules.length,2);
assert.match(JSON.stringify(L.context(state).recentResults),/已交付/);
next=P.apply(state,state.memory.schedules.map(before=>({module:'schedules',before,text:''}))).state;
assert.ok(P._test.missingAfterCleanup(state,next).includes('schedules'),'empty column still requires completion');
const successor='修缮库房｜状态：候选｜依据：推测，雨后检查职责｜条件：有空闲且工具齐备';
next=P.apply(next,[{module:'schedules',text:successor}]).state;
assert.ok(!P._test.missingAfterCleanup(state,next).includes('schedules'));
state=save(state,next,'parallel-3'); deliver(state);
const count=state.runtime.sentenceArchive.length;
for(let i=0;i<80;i++){state=save(state,state,`stable-${i}`);deliver(state);assert.equal(state.runtime.sentenceArchive.length,count);}
assert.deepEqual(state.memory.schedules,[successor]);
assert.equal(L.evaluate('状态(送信)=已完成',state).status,'met','old results remain usable');
assert.equal(L.context(state).recentResults.length,0,'unrelated old results stay out of current context');

state=fresh(); state.memory.factAnchors=['道路已经修复'];
state.memory.causalEffects=['运输延误｜状态：逐渐减弱｜消退条件：事实(道路已经修复)｜结束条件：全部积压已送达'];
state=save(fresh(),state);
assert.equal(state.memory.causalEffects.length,1,'decay condition does not delete an ongoing effect');
assert.match(L.context(state).checks.join('\n'),/本地消退条件核验：已满足/);
assert.match(L.context(state).checks.join('\n'),/本地结束条件核验：待核实/);
next=P.apply(state,[{module:'causalEffects',before:state.memory.causalEffects[0],text:'运输延误｜状态：已结束｜结果：积压已全部送达'}]).state;
state=save(state,next); assert.equal(state.memory.causalEffects.length,0);
next=fresh(); next.memory.npcActivities=['巡查｜依据：推测，例行轮值｜状态：已结束'];
next=save(fresh(),next); assert.equal(next.memory.npcActivities.length,0);
assert.match(next.runtime.sentenceArchive[0].reason,/推测记录退出/);
assert.equal(L.evaluate('状态(巡查)=已结束',next).status,'unknown','retired speculation is not confirmed history');

state=fresh(); state.memory.world=['位置：书房']; state.memory.worldbook=['书房窗格采用松木','沙漠王国的节庆在秋季'];
state.memory.worldRules=['未获许可不能通行']; state.memory.resourceConstraints=['门锁未解除']; state.memory.knowledge=['密道｜尚不知情者：访客'];
for(let i=0;i<80;i++){state=save(state,state,`time-${i}`);deliver(state);}
for(const module of ['worldRules','resourceConstraints','knowledge'])assert.ok(inject(state).includes(state.memory[module][0]));
assert.match(inject(state),/书房窗格/,'still relevant background does not expire by turn count');
assert.doesNotMatch(inject(state),/沙漠王国/);
user='沙漠王国的节庆是什么时候？'; assert.match(inject(state),/节庆在秋季/); user='继续';
assert.equal(state.memory.worldbook.length,2);

const prompts=[];
W.Api={complete:async(system,payload)=>{prompts.push({system,payload});return{factStream:{facts:[],end:true}};}};
for(const task of ['PLAIN_MEMORY_READ','PLAIN_MEMORY_REASON','PLAIN_MEMORY_SETTLE','PLAIN_MEMORY_ORGANIZE'])await P._test.request('测试',{task,memory:state.memory});
assert.doesNotMatch(prompts[0].system,/新活动的生成独立于空栏检查/,'first pass extracts source facts before simulation');
for(const {system} of prompts.slice(1)){
    assert.match(system,/新活动的生成独立于空栏检查/);
    assert.match(system,/衰退依据世界内的变化/);
    assert.match(system,/同一正文重复读取不能重新抽签/);
    assert.doesNotMatch(system,/只有整栏在清理后为空时|事务类栏目没有仍有效事项时允许为空/);
}
assert.match(W.Injection.pacingBlock({storyPacing:{mode:'slow'}}),/各人物与组织仍可.*并行活动/);
console.log('Flowing world passed: concurrent actors/affairs, continuous additions, empty-column fallback, causal decay, retired speculation, 80-turn stability, reminder histories, rewrites, reschedules, persistence, safe deduplication and contextual recall. Real API calls: 0.');
