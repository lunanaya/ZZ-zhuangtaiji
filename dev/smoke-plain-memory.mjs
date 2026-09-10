import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } };
globalThis.dispatchEvent = () => {};
const local = new Map();
globalThis.localStorage = {getItem:key => local.get(key) || null, setItem:(key,value) => local.set(key,String(value)), removeItem:key => local.delete(key)};
const chats = {a:{}, b:{}};
let active = 'a';
const messages = [];
const context = () => ({chatId:active, characterId:0, chatMetadata:chats[active], chat:messages, name1:'李四', name2:'张三', saveChat:async () => {}});
globalThis.SillyTavern = {getContext:context};
await import('../src/defaults.js');
await import('../src/storage.js');
await import('../src/state-logic.js');
await import('../src/worldbook-memory.js');
await import('../src/plain-memory.js');
await import('../src/memory-view.js');
await import('../src/api.js');
const WSM = WorldStateMachine;
const settings = {enabled:true, injectionMaxChars:3500, injectionModules:structuredClone(WSM.Defaults.INJECTION_MODULES), worldbookCompiler:{enabled:false}};
WSM.Settings = {get:() => settings};
WSM.Context = {context, identityNames:() => ({user:'李四',char:'张三'}), latestUserMessage:() => ({id:'u',content:'张三现在在哪里？'}),
    latestAssistantMessage:() => ({id:'a',index:1,content:'张三已经搬到杭州。'}), buildSource:async () => ({chat:[],worldbooks:[]})};
await import('../src/injection.js');
const old = WSM.Defaults.createState();
old.initialized = true;
old.identities = {user:'李四',char:'张三'};
old.characters = [{id:'npc-7',name:'张三',location:'京城',truthStatus:'confirmed',sourceRefs:['chat:19'],basis:['第19层已说明'],priority:'L2',activity:'HOT',updatedRevision:5}];
old.worldRules = [{id:'rule-1',statement:'进入内院必须持有许可',conditions:['先经守卫核验'],exceptions:['持有皇帝特许者除外'],truthStatus:'confirmed'}];
old.knowledge = [{id:'secret-1',information:'密道通往城外',knownBy:['npc-7'],unknownTo:['user'],truthStatus:'confirmed'}];
old.relationships = [{id:'rel-1',from:'npc-7',to:'user',currentPerception:'张三怀疑李四隐瞒了消息',truthStatus:'suspected'}];
const original = structuredClone(old);
const readFacts = () => Object.entries(WSM.PlainMemory.normalize(original).memory).flatMap(([module,values]) => values.map(text => ({module,text})));
let saved = await WSM.Storage.save(old, 'test');
assert.deepEqual(old, original, '迁移不得修改传入的旧状态对象');
const box = chats.a.worldStateMachine.chatStores.a;
assert.deepEqual(box.state.memory.characters, ['张三当前所在地是京城']);
assert.ok(Object.values(box.state.memory).flat().every(value => typeof value === 'string'));
assert.equal(box.state.characters, undefined, '不得在另一个字段保存结构化事实副本');
assert.doesNotMatch(JSON.stringify(box.state.memory), /sourceRefs|truthStatus|updatedRevision|"id"|npc-7|chat:19|"activity"/);
assert.match(box.state.memory.worldRules[0], /守卫核验/);
assert.match(box.state.memory.worldRules[0], /皇帝特许/);
assert.match(box.state.memory.knowledge[0], /确认知情者：张三/);
assert.match(box.state.memory.knowledge[0], /尚不知情者：李四/);
assert.match(box.state.memory.relationships[0], /尚待证实/);
assert.match(box.state.memory.relationships[0], /关系起点：张三；关系终点：李四/);
assert.ok(Object.values(WSM.PlainMemory.normalize(WSM.Defaults.createState()).memory).every(values => !values.length), '空状态不能被默认值填成事实');
assert.deepEqual(WSM.PlainMemory.normalize({characters:[{summary:'张三现在住在京城'}]}).memory.characters,['张三现在住在京城'],'已有事实句原样保存');
assert.match(WSM.PlainMemory.normalize({characters:[{summary:'张三在京城',certainty:'uncertain'}]}).memory.characters[0],/尚不确定/);
assert.match(WSM.PlainMemory.normalize({characters:[{name:'张三',location:'京城',locationMeta:{truthStatus:'suspected'}}]}).memory.characters[0],/尚待证实/);
const locked = WSM.PlainMemory.normalize({...original,lockedPaths:['characters.0.location']});
assert.equal(WSM.PlainMemory.apply(locked,[{module:'characters',text:'张三在别处'}]).errors.length,1,'迁移后的锁仍能阻止模型修改');

const moved = WSM.PlainMemory.apply(saved, [{module:'characters',before:'张三当前所在地是京城',text:'张三已搬到杭州'}]);
assert.equal(moved.errors.length,0);
saved = await WSM.Storage.save(moved.state, 'planner', {snapshot:true,snapshotKind:'generation',snapshotTurnKey:'u:a'});
assert.deepEqual(WSM.Storage.load().memory.characters,['张三已搬到杭州']);
assert.deepEqual(WSM.PlainMemory.apply(saved,[{module:'characters',before:'张三当前所在地是京城',text:'张三已搬到杭州'}]).state.memory.characters,['张三已搬到杭州'], '完整替换可幂等重放');
const invalid = WSM.PlainMemory.apply(saved,[{module:'characters',before:'李四住在京城',text:'张三去了海外'}]);
assert.equal(invalid.errors.length,1);
assert.deepEqual(invalid.state.memory.characters,['张三已搬到杭州'], '不能用相似名字或错误旧句误替换');
saved = await WSM.Storage.rollbackPreviousGeneration();
assert.deepEqual(saved.memory.characters,['张三当前所在地是京城']);
active = 'b';
assert.deepEqual(WSM.Storage.load().memory.characters,[]);
await assert.rejects(() => WSM.Storage.save(saved), /已阻止把旧聊天/);
active = 'a';

const parse = raw => WSM.Api._test.extractJson(raw,{jsonContract:'sentences'}).factStream;
const partial = parse('{"module":"characters","text":"张三当前所在地是京城"}\n{"module":"characters","text":"未闭合');
assert.equal(partial.facts.length,1);
assert.equal(partial.end,false);
assert.equal(parse('{"module":"worldRules","text":"括号 { 与 } 是原文"}\n{"end":true}').end,true);
assert.throws(() => parse('{"end":true}\n{"module":"characters","text":"尾部未完成'),/没有返回完整/);
assert.equal(parse('{"module":"characters","text":"完整句"}\n{"text":"{\\"module\\":\\"characters\\",\\"text\\":\\"不能捡出内层对象\\"}').facts.length,1);
assert.deepEqual(parse('{"module":"characters","text":"完整句","sourceRefs":["chat:1"]}\n{"end":true}').facts,[{module:'characters',text:'完整句'}], 'extra fields are stripped instead of discarding usable sentences');
assert.equal(parse('{"records":[{"module":"characters","text":"完整句"}],"end":true}').facts.length,1);
assert.equal(parse('{"memory":{"characters":["完整句"]},"end":true}').end,true);
const payload = WSM.Injection.compose(saved);
assert.match(payload,/张三当前所在地是京城/);
settings.injectionModules.characters.enabled = false;
assert.doesNotMatch(WSM.Injection.compose(saved),/张三当前所在地是京城/);
settings.injectionModules.characters.enabled = true;
assert.equal(WSM.Injection.compose(saved),Object.values(WSM.Injection.composeByDepth(saved)).join('\n\n'));

// Run real engine entry points through the real API, SSE decoder and sentence
// parser. Only the HTTP provider is simulated; no pre-parsed response shortcuts.
globalThis.getRequestHeaders = () => ({'Content-Type':'application/json'});
globalThis.addEventListener = () => {};
Object.assign(settings,{useTavernApi:false, endpoint:'https://provider.invalid/v1', model:'test', maxTokens:6000});
let userText = '张三现在在哪里？';
let assistantText = '张三仍住在京城。';
let assistantId = 'body-2';
const realSource = {character:{name:'张三',description:'张三住在京城，担任城门守卫，每日下午巡查。'},persona:'李四是访客',
    worldbooks:[{name:'城规',entries:[{comment:'城门',content:'入内院须经守卫核验许可；皇帝特许者除外。'}]}],
    chat:[{role:'user',content:'今天是2026-09-10 10:00，我在城门。'},{role:'assistant',content:'张三向李四解释许可规则。'}]};
const sourceReads=[];
let originalBooksEnabled = true;
WSM.Context.buildSource = async options => { sourceReads.push(options); return {...structuredClone(realSource),worldbooks:originalBooksEnabled ? structuredClone(realSource.worldbooks) : []}; };
WSM.Context.latestUserMessage = () => ({id:'user-1',content:userText});
WSM.Context.latestAssistantMessage = () => ({id:assistantId,index:messages.length-1,content:assistantText});
messages.push({is_user:true,mes:userText},{is_user:false,mes:assistantText});
const samples = {
    world:'当前时间2026-09-10 10:00，李四位于京城城门。',
    resourceConstraints:'李四进入内院前须取得许可。', organizations:'城门守卫隶属京城卫所。', map:'京城城门通向城内街道。',
    npcActivities:'张三正在城门核验入城文书，并按职责安排午后巡查。', schedules:'张三明天18:00赴宴。', tasks:'李四需要向守卫申请内院通行许可。',
    triggers:'出示有效许可后，守卫可以放行。', threads:'李四的内院访问手续仍待完成。', progression:'李四正在了解内院通行要求，是否申请由李四决定。',
    processes:'卫所正按日常班次维护城门秩序。', causalEffects:'内院许可制度限制未经核验的进入行为。', timeline:'张三已经向李四说明通行规则。', worldbook:'京城按卫所制度管理城门。',
};
const requests = [];
let mode = 'normal';
let delayedResolve;
let truncatedRead = false;
const encode = rows => rows.map(row => JSON.stringify(row)).join('\n');
globalThis.fetch = async (url, options) => {
    assert.equal(url,'/api/backends/chat-completions/generate');
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.messages[1].content);
    requests.push({input,body});
    assert.equal(body.json_schema,undefined);
    assert.equal(body.response_format,undefined);
    assert.doesNotMatch(body.messages[0].content,/STATE_GC|truthStatus|priority|moduleDecisions/);
    assert.equal(body.max_tokens,6000,'sentence requests respect the configured output allowance');
    assert.match(body.messages[0].content,/正文已写的地点必须落到对应人物概况和活动记录/);
    assert.match(body.messages[0].content,/推演阶段才.*标明“推测”/);
    assert.match(body.messages[0].content,/所有栏目必须读取并填写，不允许空栏目/);
    assert.match(body.messages[0].content,/知识\/秘密栏以“不知道的边界”为重点/);
    assert.match(body.messages[0].content,/告诉甲不自动告诉乙/);
    assert.match(body.messages[0].content,/全栏目客观记录规则/);
    assert.match(body.messages[0].content,/不能因旧条未变就KEEP错误解释/);
    assert.doesNotMatch(body.messages[0].content,/可保持空栏|不要求凑满栏目|列为空不表示资料读取失败/);
    if (mode === 'stale') await new Promise(resolve => { delayedResolve = resolve; });
    if (mode === 'fail-second' && input.task === 'PLAIN_MEMORY_REASON') return new Response('{"error":{"message":"simulated provider failure"}}',{status:500});
    let rows;
    if (input.task === 'PLAIN_MEMORY_READ') {
        rows = [
            {module:'characters',before:input.memory.characters[0],text:'张三现在住在京城'},
            {module:'world',text:samples.world},
        ];
    } else if (input.task === 'PLAIN_MEMORY_REASON') {
        assert.match(body.messages[0].content,/NPC活动轨迹必须.*生成合理的当前自主活动/);
        assert.ok(input.source.character.description.includes('城门守卫'),'second call has original premises for autonomous simulation');
        rows = input.missingModules.map(module => ({module,text:samples[module] || `${WSM.PlainMemory.LABELS[module]}已有当前有效记录。`}));
        rows.push({module:'planner',text:'李四尚未取得许可，不能直接进入内院。'});
        if (mode === 'missing-required') rows=[];
        if (mode === 'invalid-before') rows.push({module:'characters',before:'不存在的旧句',text:'不能覆盖'});
    } else if (input.task === 'PLAIN_MEMORY_SETTLE') {
        assert.match(body.messages[0].content,/先结算.*再按既有状态推进NPC自主活动/);
        assert.ok(input.localState?.checks,'local validation is included in the existing single request');
        assert.match(body.messages[0].content,/玩家明确接受/);
        rows = [{module:'characters',before:input.memory.characters[0],text:mode === 'stale' ? '过期响应不应覆盖用户编辑' : '张三已搬到杭州'},
            ...input.missingModules.map(module => ({module,text:samples[module] || `${WSM.PlainMemory.LABELS[module]}已有当前有效记录。`})),
            {module:'planner',text:'仍需遵守通行许可制度。'}];
        if (mode === 'settle-empty') rows.push({module:'schedules',before:input.memory.schedules[0],text:''});
        if (mode === 'settle-terminal') rows.push({module:'schedules',before:input.memory.schedules[0],text:'赴宴｜状态：已完成'});
        if (mode === 'settle-reword') rows.push({module:'schedules',before:input.memory.schedules[0],text:'张三将于明天18:00赴宴。'});
        if (mode === 'settle-parallel') rows.push({module:'schedules',text:'清点物资｜状态：候选｜依据：推测，守卫的盘点职责'});
    } else if (input.task === 'PLAIN_MEMORY_ORGANIZE') {
        assert.ok(input.source.worldbooks[0].entries[0].text.includes('守卫核验'),'organizing can read the original source to fill columns');
        assert.match(body.messages[0].content,/不推进世界/);
        assert.match(body.messages[0].content,/本次允许将冗余或散乱旧句压缩/);
        rows = mode === 'organize-noop' ? [] : [
            {module:'characters',before:'张三住在京城',text:'张三｜身份：守卫｜位置：京城'},
            {module:'characters',before:'张三在京城居住',text:''},
            {module:'organizations',before:'张三是京城守卫',text:'京城卫所｜职责：守卫城门'},
            {module:'map',before:'京城包含城门',text:'京城 > 城门'},
            {module:'relationships',before:'张三信任李四',text:'张三 → 李四｜态度：信任'},
        ];
        if (mode === 'organize-invalid') rows.push({module:'world',before:'不存在的旧句',text:'不能写入'});
        if (mode === 'organize-locked') rows.push({module:'worldRules',text:'不能改锁定规则'});
        if (mode === 'organize-empty') rows.push({module:'schedules',before:input.memory.schedules[0],text:''});
    } else throw new Error(`Unexpected task ${input.task}`);
    let output = encode([...rows,{end:true}]);
    if (mode === 'truncated' || (truncatedRead && input.task === 'PLAIN_MEMORY_READ')) output = encode(rows) + '\n{"module":"characters","text":"unfinished';
    const sse = `data: ${JSON.stringify({choices:[{delta:{content:output},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`;
    return new Response(sse,{headers:{'Content-Type':'text/event-stream'}});
};
await import('../src/engine.js');
await import('../src/ui.js');
assert.equal(WSM.PlainMemory.canInitialize(WSM.Storage.load()),false,'existing memory cannot be initialized again');
const protectedCalls=requests.length;
await assert.rejects(WSM.Engine.plan({initialize:true}),/先清空读取/);
await assert.rejects(WSM.Engine.plan({force:true,readFullChat:true}),/先清空读取/);
assert.equal(requests.length,protectedCalls,'blocked initialization costs no API');
await WSM.Storage.clearAll();
assert.equal(WSM.PlainMemory.canInitialize(WSM.Storage.load()),true);
let result = await WSM.Engine.plan({initialize:true});
assert.equal(result.error,'');
assert.deepEqual(requests.map(item => item.input.task),['PLAIN_MEMORY_READ','PLAIN_MEMORY_REASON']);
saved = WSM.Storage.load();
assert.equal(saved.initialized,true);
assert.equal(WSM.WorldbookMemory.originals(saved).length,1,'initial read persists complete adopted worldbooks');
assert.equal(saved.runtime.plainReadIncomplete,false);
assert.equal(saved.runtime.initializationStarted,true);
assert.equal(WSM.PlainMemory.canInitialize(saved),false);
assert.ok(WSM.PlainMemory.MODULES.filter(module => module !== 'worldbook').every(module => saved.memory[module].length > 0),'required columns filled after second call; worldbook supplement may be empty');
assert.deepEqual(saved.memory.characters,['张三现在住在京城']);
assert.match(saved.memory.npcActivities[0],/安排午后巡查/,'second call generates NPC activity beyond explicit prose');
assert.match(WSM.UI._test.renderSectionForTest(saved,'characters'),/张三现在住在京城/);
assert.match(WSM.UI._test.renderSectionForTest(saved,'activities'),/安排午后巡查/);
assert.match(WSM.UI._test.renderSectionForTest(saved,'overview'),/2026-09-10/);
assert.match(WSM.UI._test.renderSectionForTest(saved,'planner'),/不能直接进入内院/);
assert.ok(Object.values(chats.a.worldStateMachine.chatStores.a.state.memory).flat().every(row => typeof row === 'string'));
assert.equal(chats.a.worldStateMachine.chatStores.a.state.characters,undefined);
assert.doesNotMatch(JSON.stringify(saved.memory),/updatedTurn|sourceRefs|priority|activity|truthStatus|"id"/);
const dueState=structuredClone(saved);
const sentenceKey=WSM.PlainMemory._test.sentenceKey('schedules',samples.schedules);
assert.equal(dueState.runtime.sentenceTimes[sentenceKey],WSM.Storage.storyTimestamp('2026-09-11 18:00'));
assert.doesNotMatch(WSM.Injection.preview(dueState),/赴宴/,'future agenda stays quiet before its trigger');
dueState.memory.world=['当前时间2026-09-11 17:40，李四位于京城城门。'];
const duePrompts=WSM.Injection.composeByDepth(dueState);
assert.match(Object.values(duePrompts).join('\n'),/赴宴/);
assert.equal(dueState.runtime.sentenceDelivery[sentenceKey],undefined,'preview does not consume reminders');
dueState.runtime.sentenceDelivery=WSM.Injection.commitDeliveryReceipt(dueState,WSM.Injection.createDeliveryReceipt(dueState,duePrompts));
assert.doesNotMatch(WSM.Injection.preview(dueState),/赴宴/,'same unchanged due reminder does not repeat');
userText='接下来有什么安排？';
assert.match(WSM.Injection.preview(dueState),/赴宴/,'explicit request bypasses reminder suppression');
userText='张三现在在哪里？';
await WSM.Engine.plan({force:true});
await WSM.Engine.interceptor(messages,32000,() => {},'normal');
assert.equal(requests.length,2,'no API call before normal正文');
saved.memory.npcActivities = [];
await WSM.Storage.save(saved,'manual-edit');
messages.push({is_user:true,mes:'张三搬家了。'},{is_user:false,mes:'张三已搬到杭州。'});
assistantId='body-4'; assistantText='张三已搬到杭州。';
originalBooksEnabled = false;
result = await WSM.Engine.settle({force:true,latestOnly:true});
assert.ok(result);
assert.equal(requests.length,3,'subsequent reconciliation, fill and simulation share one call');
assert.deepEqual(requests[2].input.source.worldbooks,[],'normal update excludes originals after their native books close');
originalBooksEnabled = true;
assert.ok(requests[2].input.missingModules.includes('npcActivities'));
assert.match(result.memory.npcActivities[0],/巡查/);
assert.deepEqual(result.memory.characters,['张三已搬到杭州']);
assert.equal(result.runtime.memoryTurn,1);
assert.equal(result.runtime.lastReadFloor,4);

// Truncation preserves complete rows, but cannot falsely advance read position.
mode='truncated'; assistantId='body-6';
messages.push({is_user:true,mes:'继续。'},{is_user:false,mes:'完整片段。'});
const floor = result.runtime.lastReadFloor;
assert.equal(await WSM.Engine.settle({force:true,latestOnly:true}),null);
assert.equal(WSM.Storage.load().runtime.lastReadFloor,floor);
assert.equal(WSM.Storage.load().runtime.memoryTurn,1);
assert.equal(WSM.Storage.load().runtime.plainReadIncomplete,true);
assert.deepEqual(WSM.Storage.load().memory.characters,['张三已搬到杭州']);
assert.equal(requests.length,4,'no automatic paid retry for truncation');
mode='normal';
await WSM.Engine.settle({force:true,latestOnly:true});
assert.equal(WSM.Storage.history().filter(item=>item.readReceipt?.messageId==='body-6').length,1,'partial retry keeps a single original rollback snapshot');
await WSM.Storage.rollbackPreviousGeneration();
assert.equal(WSM.Storage.load().runtime.plainReadIncomplete,false);

// A failed second call cannot erase the first call's visible results.
mode='fail-second';
await WSM.Storage.clearAll();
const beforeFailureCalls=requests.length;
result = await WSM.Engine.plan({initialize:true});
assert.match(result.error,/500|failure/);
assert.equal(requests.length-beforeFailureCalls,2);
assert.deepEqual(WSM.Storage.load().memory.characters,['张三现在住在京城']);
assert.equal(WSM.Storage.load().initialized,true);
assert.match(WSM.UI._test.renderSectionForTest(WSM.Storage.load(),'characters'),/张三现在住在京城/);
await assert.rejects(WSM.Engine.plan({initialize:true}),/先清空读取/);
await WSM.Storage.clearAll();
mode='normal'; truncatedRead=true;
const beforeRecoveryCalls=requests.length;
await WSM.Engine.plan({initialize:true});
assert.equal(requests.length-beforeRecoveryCalls,2,'second planned call recovers first-call truncation without a third request');
assert.equal(WSM.Storage.load().runtime.plainReadIncomplete,false);
truncatedRead=false;

// A valid end with an invalid replacement is not mislabeled as a missing end.
await WSM.Storage.clearAll();
mode='invalid-before';
const badBeforeCalls=requests.length;
result=await WSM.Engine.plan({initialize:true});
assert.equal(requests.length-badBeforeCalls,2);
assert.match(result.error,/找不到要替换的旧句/);
assert.doesNotMatch(result.error,/等待完整结束回执|未返回有效结束标记/);
assert.ok(WSM.Storage.load().runtime.plainReadIssues.some(issue=>issue.includes('找不到')));
await WSM.Storage.clearAll();
mode='truncated';
result=await WSM.Engine.plan({initialize:true});
assert.match(result.error,/模型未返回有效结束标记/);
assert.match(result.error,/不会继续等待或自动重试/);
await WSM.Storage.clearAll();
mode='normal';
await WSM.Engine.plan({initialize:true});

// Late output must not overwrite manual edits or another chat.
mode='stale';
const stale = WSM.Engine.settle({force:true,latestOnly:true});
while(!delayedResolve) await new Promise(resolve => setTimeout(resolve,0));
const edited=WSM.Storage.load(); edited.memory.characters=['用户手动修改的句子'];
await WSM.Storage.save(edited,'manual-edit');
delayedResolve();
assert.equal(await stale,null);
assert.deepEqual(WSM.Storage.load().memory.characters,['用户手动修改的句子']);

// Organizing is one semantic call, applied atomically without advancing the story.
const organizeInput = WSM.Storage.load();
organizeInput.memory.characters = ['张三住在京城','张三在京城居住'];
organizeInput.memory.organizations = ['张三是京城守卫'];
organizeInput.memory.map = ['京城包含城门'];
organizeInput.memory.relationships = ['张三信任李四'];
organizeInput.lockedPaths = ['memory.worldRules'];
await WSM.Storage.save(organizeInput,'manual-edit');
const beforeOrganize = WSM.Storage.load();
const beforeOrganizeCalls = requests.length;
mode = 'normal';
const organized = await WSM.Storage.organizeState('smart');
assert.equal(requests.length-beforeOrganizeCalls,1);
assert.equal(organized.apiCalls,1);
assert.equal(organized.beforeItems-organized.afterItems,1);
assert.deepEqual(organized.changedModules,['organizations','map','characters','relationships']);
assert.deepEqual(organized.state.memory.characters,['张三｜身份：守卫｜位置：京城']);
assert.deepEqual(organized.state.memory.organizations,['京城卫所｜职责：守卫城门']);
assert.deepEqual(organized.state.memory.worldRules,beforeOrganize.memory.worldRules);
assert.deepEqual(organized.state.planner.notes,beforeOrganize.planner.notes);
assert.equal(organized.state.runtime.lastReadFloor,beforeOrganize.runtime.lastReadFloor);
assert.equal(organized.state.runtime.memoryTurn,beforeOrganize.runtime.memoryTurn);
assert.equal(organized.state.runtime.plainReadIncomplete,beforeOrganize.runtime.plainReadIncomplete);
mode = 'organize-noop';
const unchangedRevision = WSM.Storage.load().revision;
assert.equal((await WSM.Engine.organizeState()).changedModules.length,0);
assert.equal(WSM.Storage.load().revision,unchangedRevision,'noop does not create an empty revision');
await WSM.Storage.rollbackPreviousGeneration();
assert.deepEqual(WSM.Storage.load().memory.characters,beforeOrganize.memory.characters);
for (const failureMode of ['truncated','organize-invalid','organize-locked','organize-empty']) {
    mode = failureMode;
    const before = WSM.Storage.load();
    const calls = requests.length;
    await assert.rejects(WSM.Engine.organizeState(), /未完整结束|校验失败/);
    assert.equal(requests.length-calls,1,'failed organization never retries');
    assert.deepEqual(WSM.Storage.load().memory,before.memory,'invalid output cannot partially delete or move facts');
    assert.equal(WSM.Storage.load().revision,before.revision);
}
mode = 'normal';
active='b';
assert.deepEqual(WSM.Storage.load().memory.characters,[]);
active='a';
await WSM.Storage.clearAll();
mode='missing-required';
const emptyCalls=requests.length;
await WSM.Engine.plan({initialize:true});
assert.equal(requests.length-emptyCalls,2);
assert.equal(WSM.Storage.load().runtime.plainReadIncomplete,true,'empty required columns must make initialization incomplete');
assert.match(WSM.Storage.load().planner.error,/待补栏目.*资源/);
assert.equal(WSM.Storage.load().runtime.lastReadFloor,0,'missing columns cannot advance the read receipt');
assert.deepEqual(WSM.Storage.load().memory.resourceConstraints,[],'code cannot fabricate filler to claim complete coverage');
mode='normal';
const repairCalls=requests.length;
assert.ok(await WSM.Engine.settle({force:true,latestOnly:true}),'missing initialization can be repaired without clearing saved facts');
assert.equal(requests.length-repairCalls,1);
assert.equal(sourceReads.at(-1).fullChat,true,'repair rereads available source context');
assert.equal(sourceReads.at(-1).preserveFull,true,'repair source is not cut by the source character budget');
assert.equal(WSM.Storage.load().runtime.plainInitIncomplete,false);
assert.equal(WSM.Storage.load().runtime.plainReadIncomplete,false);
await WSM.Storage.clearAll();
mode='normal'; await WSM.Engine.plan({initialize:true});
for (const failureMode of ['settle-empty','settle-terminal']) {
    mode=failureMode;
    const before=WSM.Storage.load(), calls=requests.length;
    assert.equal(await WSM.Engine.settle({force:true,latestOnly:true}),null);
    assert.equal(requests.length-calls,1,'missing column does not add a second API call');
    assert.equal(WSM.Storage.load().runtime.plainReadIncomplete,true);
    assert.equal(WSM.Storage.load().runtime.lastReadFloor,before.runtime.lastReadFloor);
    assert.match(WSM.Storage.load().planner.error,/已有安排/,'coverage is checked after lifecycle cleanup');
    mode='normal';
    assert.ok(await WSM.Engine.settle({force:true,latestOnly:true}),'the next single read can fill missing columns');
    assert.ok(WSM.PlainMemory.MODULES.filter(module=>module !== 'worldbook').every(module=>WSM.Storage.load().memory[module].length));
}
// A nonempty column can gain an independent AI-generated affair in the usual single call.
mode='settle-parallel';
const beforeParallel=WSM.Storage.load(), parallelCalls=requests.length;
assert.ok(await WSM.Engine.settle({force:true,latestOnly:true}));
assert.equal(requests.length-parallelCalls,1);
assert.equal(WSM.Storage.load().memory.schedules.length,beforeParallel.memory.schedules.length+1);
assert.ok(WSM.Storage.load().memory.schedules.includes(beforeParallel.memory.schedules[0]));
assert.match(requests.at(-1).body.messages[0].content,/新活动的生成独立于空栏检查/);

// Generation receipts refer to the pre-settlement prose, even on the first notice.
const pending=WSM.Storage.load();
pending.memory.world=['时间：2026-09-11 17:40'];
pending.memory.schedules=[samples.schedules];
pending.runtime.sentenceTimes={[WSM.PlainMemory._test.sentenceKey('schedules',samples.schedules)]:WSM.Storage.storyTimestamp('2026-09-11 18:00')};
pending.runtime.sentenceDelivery={};
await WSM.Storage.save(pending,'test-reset');
userText='继续';
assert.match(WSM.Injection.preview(WSM.Storage.load()),/赴宴/);
await WSM.Engine.interceptor(messages,32000,() => {},'normal');
mode='settle-reword'; assistantId='body-reword';
assert.ok(await WSM.Engine.settle({force:true,latestOnly:true}));
assert.equal(WSM.Storage.load().memory.schedules[0],'张三将于明天18:00赴宴。');
assert.doesNotMatch(WSM.Injection.preview(WSM.Storage.load()),/赴宴/,'committed notice follows the new wording');
const bytes = value => Buffer.byteLength(JSON.stringify(value),'utf8');
console.log(JSON.stringify({recordBytesBefore:bytes(original.characters[0]),recordBytesAfter:bytes('张三现在住在京城'),
    initializationCalls:2, normalUpdateCalls:1, allColumnsVisible:true},null,2));
console.log('Sentence memory integration passed: HTTP/SSE parsing, persistence, visible columns, two-phase initialization, autonomous simulation, single-call updates, partial recovery, rollback and isolation.');
