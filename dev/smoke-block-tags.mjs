import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.localStorage = {getItem:()=>null};
for (const name of ['defaults','facts','storage','state-logic','worldbook-memory','plain-memory','worldbook-semantic','dice','injection']) await import(`../src/${name}.js`);
const W = WorldStateMachine;
const settings = {enabled:true, injectionMaxChars:3500, injectionModules:structuredClone(W.Defaults.INJECTION_MODULES), worldbookCompiler:{enabled:false}, storyPacing:{mode:'off'}};
W.Settings = {get:()=>settings};
W.Context = {identityNames:()=>({user:'访客',char:'医师'}), latestUserMessage:()=>({content:'医师现在有哪些安排和任务？回顾以前的结果。'})};
const strip = value => value.replace(/<\/?(?:世界|人物|事务|系统|场景地图|世界书补充)>/g,'');
const tag = W.Defaults.tagInjectionBody;
const sample = '原有规则\r\n【人物关系】医师→访客：保持距离\r\n【知识 / 秘密】访客不知道暗门\n【已有安排】明日复诊\n【场景地图】诊室\n【世界书补充】背景\n【世界状态】现在是清晨\n【状态使用边界】原有边界';
const tagged = tag(sample);
assert.equal(strip(tagged),sample);
for (const name of ['世界','人物','事务','系统','场景地图','世界书补充']) assert.ok(tagged.includes(`<${name}>`));
assert.match(tagged, /<人物>【人物关系】[\s\S]*【知识 \/ 秘密】[\s\S]*<\/人物>/);
assert.doesNotMatch(tagged, /<人物关系>|<知识/);

function compare(state) {
    const before = JSON.stringify(state);
    let original, originalFlat, receipt;
    W.Defaults.tagInjectionBody = value => value;
    try {
        original = W.Injection.composeByDepth(state);
        originalFlat = W.Injection.compose(state);
        receipt = W.Injection.createDeliveryReceipt(state,original);
    } finally { W.Defaults.tagInjectionBody = tag; }
    const actual = W.Injection.composeByDepth(state);
    assert.deepEqual(Object.keys(actual),Object.keys(original),'注入位置不变');
    for (const key of Object.keys(actual)) assert.equal(strip(actual[key]),original[key],`深度 ${key} 的内容和顺序不变`);
    assert.equal(strip(W.Injection.compose(state)),originalFlat);
    assert.deepEqual(W.Injection.createDeliveryReceipt(state,actual),receipt,'送达账本不变');
    assert.equal(JSON.stringify(state),before,'不修改存档');
    return actual;
}
const legacy = W.Defaults.createState();
legacy.initialized = true;
legacy.world.location.current = '诊室';
legacy.characters = [{id:'doctor',name:'医师',present:true,location:'诊室',situation:'正在问诊'}];
legacy.relationships = [{from:'doctor',to:'user',currentPerception:'保持礼貌距离'}];
compare(legacy);
const plain = W.PlainMemory.normalize(legacy);
plain.memory.world = ['当前地点：诊室'];
plain.memory.relationships = ['医师→访客：仅为医患关系'];
plain.memory.knowledge = ['暗门位置｜确认知情者：医师｜尚不知情者：访客'];
plain.memory.schedules = ['医师复诊安排｜时间：明日'];
plain.memory.worldbook = ['医师所在诊室有两扇窗'];
plain.planner.notes = ['可能继续问诊，尚未发生'];
const prompts = compare(plain);
assert.match(prompts.worldbook, /<世界书补充>【世界书补充】/);
assert.match(Object.values(prompts).join('\n'), /<人物>【知识 \/ 秘密】/);
assert.match(Object.values(prompts).join('\n'), /<事务>【已有安排】/);
plain.runtime.finalInjectionOverride = '用户原样手动注入';
compare(plain);
settings.enabled = false;
assert.deepEqual(W.Injection.composeByDepth(plain),{});
console.log('Block tags: unchanged payloads, depths, delivery receipts, storage and manual overrides; six categories, no small-module tags. API calls: 0.');
