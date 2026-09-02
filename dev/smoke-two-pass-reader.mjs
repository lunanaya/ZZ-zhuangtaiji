import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
};
globalThis.dispatchEvent = () => {};
const storage = new Map();
globalThis.localStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, String(value)); },
};

await import('../src/defaults.js');

const calls = [];
const auditedModules = ['world','worldRules','factAnchors','resourceConstraints','organizations','map','characters','npcActivities','relationships','knowledge','schedules','tasks','events','triggers','threads','progression','processes','causalEffects','timeline'];
const completeEvidence = (value = {}) => ({
    sourceRefs: [], canon: [], worldRules: [], chronology: [], timeline: [], anchors: [], resourceConstraints: [], organizations: [], characters: [], npcActivities: [], relationships: [], knowledge: [], schedules: [], locations: [], tasks: [], events: [], triggers: [], threads: [], processes: [], causal: [], progression: [], currentScene: [], uncertainties: [], matchedRules: [], derivedFacts: [], conflicts: [], staleStates: [], actorFeasibility: [], causalCandidates: [],
    moduleCoverage: auditedModules.map((module) => ({ module, status: 'empty_confirmed', basis: '测试已检查' })),
    moduleDecisions: auditedModules.map((module) => ({ module, operation: 'KEEP', reason: '测试已检查' })),
    ...value,
});
WorldStateMachine.Api = {
    async complete(_prompt, payload, options) {
        calls.push({ payload, options });
        if (payload.task === 'SOURCE_READ_COMPLETE') {
            return {
                evidence: completeEvidence({
                    sourceRefs: ['chat:1','worldbook:test:1'], canon: [],
                    worldRules: [{ statement: '进入资料室必须登记', sourceRefs: ['worldbook:test:1'] }],
                    chronology: [{ time: '夜晚', summary: '资料室发生重大事故并被永久封锁', sourceRefs: ['chat:1'] }],
                    timeline: [{ summary: '资料室发生重大事故并被永久封锁', sourceRefs: ['chat:1'] }],
                    characters: [{ id: 'test-char', name: '测试角色', identity: '资料管理员', location: '资料室', situation: '正在整理资料' }],
                    relationships: [], npcActivities: [{ characterId: '测试角色', action: '整理资料', sourceRefs: ['chat:1'] }],
                    knowledge: [], locations: [{ name: '资料室' }], tasks: [],
                    events: [{ title: '资料室重大事故', summary: '资料室发生重大事故并被永久封锁', sourceRefs: ['chat:1'] }],
                    triggers: [], threads: [], processes: [{ title: '资料整理', currentDirection: '整理持续进行' }],
                    causal: [], progression: [{ direction: '继续整理资料', currentMovement: '已经开始整理' }],
                    currentScene: [{ time: '夜晚', location: '资料室', weather: '炎热', environment: '空调开启', presentCharacterIds: [] }], uncertainties: [],
                }),
            };
        }
        if (payload.task === 'SOURCE_READ_SEQUENTIAL_BATCH' && payload.sourceBatchIndex === 1) {
            return {
                evidence: completeEvidence({
                    sourceRefs: payload.sourceRecords.map((item) => item.ref),
                    canon: ['请求 A 已逐项读取'],
                    worldRules: [{ statement: '进入测试地点必须持有通行许可', scope: ['测试地点'], conditions: ['进入时'], exceptions: [], sourceRefs: ['worldbook:test:1'] }],
                    chronology: [], characters: [{ id: 'test-char', name: '测试角色', identity: '资料管理员', situation: '前段人物资料' }], relationships: [],
                    npcActivities: [{ characterId: 'test-char', action: '在后台整理资料', location: '资料室' }],
                    knowledge: [], locations: [], tasks: [], events: [], triggers: [], threads: [], processes: [], timeline: [], causal: [], currentScene: [], uncertainties: [],
                }),
            };
        }
        if (payload.task === 'SOURCE_READ_SEQUENTIAL_BATCH' && payload.sourceBatchIndex === payload.sourceBatchCount) {
            return {
                evidence: completeEvidence({
                    sourceRefs: payload.sourceRecords.map((item) => item.ref),
                    canon: ['请求 A 已逐项读取', '请求 B 已逐项读取'],
                    chronology: [{ time: '测试时刻', summary: '全部资料时间线' }],
                    timeline: [{ summary: '公司管理权完成正式交替', granularity: 'phase', sourceRefs: ['chat:80'] }],
                    characters: [{ id: 'test-char', name: '测试角色', identity: '资料管理员', location: '资料室', situation: '核心角色正在处理资料' }],
                    npcActivities: [{ characterId: 'test-char', action: '继续在后台整理资料', location: '资料室', sourceRefs: ['chat:80'] }],
                    relationships: [], knowledge: [], locations: [{ name: '测试地点' }], tasks: [], events: [],
                    triggers: [{ title: '等待来电', conditions: ['对方完成核实'], status: 'armed', userVisible: true, sourceRefs: ['chat:80'] }],
                    threads: [{ title: '旧约仍未说开', status: 'open', stakes: '双方关系' }],
                    processes: [{ title: '公司权力调整', status: 'active', currentDirection: '管理权继续集中' }], causal: [],
                    currentScene: [{ location: '测试地点', environment: '当前场景', presentCharacterIds: [] }], uncertainties: [],
                }),
            };
        }
        if (payload.task === 'SOURCE_READ_SEQUENTIAL_BATCH') {
            return { evidence: { sourceRefs: payload.sourceRecords.map((item) => item.ref) } };
        }
        throw new Error(`unexpected task ${payload.task}`);
    },
};
await import('../src/engine.js');

const previousStorage = WorldStateMachine.Storage;
WorldStateMachine.Storage = {
    readSourceReadArchive: () => [{
        anchors: ['旧读取锚点'], resourceConstraints: ['仍有效的行动限制'],
        relationships: ['甲与乙：长期盟友。'], knowledge: ['甲知晓密道位置。'], threads: ['尚未解决的旧约。'],
    }],
};
const supplementedEvidence = WorldStateMachine.Engine._test.supplementMissingEvidenceFromArchive({
    anchors: ['本次锚点'], resourceConstraints: [], relationships: [], knowledge: [], threads: [],
});
assert.deepEqual(supplementedEvidence.anchors, ['本次锚点'], '本次非空证据必须优先于档案');
assert.deepEqual(supplementedEvidence.relationships, ['甲与乙：长期盟友。'], '本次漏报的持久栏目必须从同存档证据档案回填');
WorldStateMachine.Storage = previousStorage;

const malformedDirectState = WorldStateMachine.Engine._test.normalizeStateResult({
    state: {
        characters: { hero: { name: '单对象人物' }, ally: { summary: '对象表人物' } },
        events: '已发生的重要事件',
        tasks: '{"main":{"title":"对象字符串任务"}}',
        processes: { title: '单个世界进程', currentDirection: '持续演变' },
    },
}, WorldStateMachine.Defaults.createState()).state;
assert.ok(Array.isArray(malformedDirectState.characters));
assert.equal(malformedDirectState.characters.length, 2);
assert.equal(malformedDirectState.characters[1].name, 'ally', 'object-map keys must be retained when an item omits its name');
assert.equal(malformedDirectState.events[0].summary, '已发生的重要事件');
assert.equal(malformedDirectState.tasks[0].title, '对象字符串任务');
assert.equal(malformedDirectState.processes[0].currentDirection, '持续演变');

const localFallbackEvidence = WorldStateMachine.Engine._test.localEvidenceFromSource({
    identities: { user: '测试用户', char: '' }, character: { name: '测试角色', description: '角色卡背景' },
    worldbooks: [{ name: '规则书', entries: [{ id: 1, content: '进入内城必须持有通行许可。任何人不得冒用他人的身份进入内城。' }] }],
    chat: [{ id: 9, role: 'assistant', name: '测试角色', content: '<meow_FM>\ntime:夜晚\nscene:内城资料室\nplot:测试角色进入资料室并开始调查。\nseeds:调查完成后会收到回信。\n</meow_FM><INDRS>\n当前进度:整理证据\n待办事项:核对登记簿\n</INDRS>' }],
});
assert.ok(localFallbackEvidence.characters.some((item) => item.id === 'user' && item.name === '测试用户'), '用户必须始终按当前用户名以第三人称建档');
assert.equal(localFallbackEvidence.characters.some((item) => item.name === '测试角色'), false, '角色卡标题不得自动当作人物姓名');
assert.equal(localFallbackEvidence.worldRules.length, 2);
assert.equal(localFallbackEvidence.events.length, 0, '普通进入房间和调查不得被本地解析成世界事件');
assert.equal(localFallbackEvidence.timeline.length, 0, '普通逐轮行动不得被本地解析成阶段时间线');
assert.equal(localFallbackEvidence.currentScene[0].location, '内城资料室');
assert.equal(localFallbackEvidence.tasks[0].title, '核对登记簿');
assert.equal(localFallbackEvidence.progression[0].direction, '整理证据');

const localMajorEvidence = WorldStateMachine.Engine._test.localEvidenceFromSource({
    chat: [{ id: 820, role: 'assistant', content: '<meow_FM><time>昭国四年秋第十四日</time><scene>兴州行宫</scene><plot>最终，夏启行选择自裁以保全家人，并当场血溅宫殿。夏以昼随即宣告此案了结。</plot></meow_FM>' }],
});
assert.equal(localMajorEvidence.events.length, 1, '本地扫描必须从历史 plot 重建客观重大事件');
assert.match(localMajorEvidence.events[0].summary, /夏启行选择自裁/);
assert.ok(localMajorEvidence.anchors.some((item) => /夏启行选择自裁/.test(item.fact)), '死亡等不可逆重要事实必须同时进入事实锚点候选');
assert.equal(localMajorEvidence.causal.length, 0, '只有事件先后而没有持续传播路径时不得硬造因果影响');

const localConstraintEvidence = WorldStateMachine.Engine._test.localEvidenceFromSource({
    identities: { user: '鹿鹿', char: '' },
    character: { name: '陌生版皇兄夏以昼' },
    chat: [{ id: 900, role: 'assistant', content: '[response]\n【夏以昼服饰：玄色朝服 夏寻樨服饰：海棠红宫装】\n夏以昼以昭国皇帝身份处理兴州政务。这几天，你就留在揽月轩里，哪儿也别去。林曳的人还在城里搜捕余党。给朕三天时间，三天后朕处理完兴州政务便带你启程。你现在是朕正式册封的寻曦贵妃。\n<meow_FM>\nplot:鹿鹿与夏以昼约定三天后离开兴州前往江南。\n</meow_FM>' }],
});
assert.ok(localConstraintEvidence.resourceConstraints.some((item) => /揽月轩/.test(item.condition)), '最近正文明确给出的行动限制不得因模型漏报而整栏为空');
assert.ok(localConstraintEvidence.schedules.some((item) => /三天后.*江南/.test(item.title)), '明确时间和承诺的未来事项必须进入已有安排');
assert.ok(localConstraintEvidence.resourceConstraints.every((item) => !/[“”"']|\b(?:朕|我)\b/.test(item.condition)), '资源约束必须是客观状态摘要，不能复制角色原话');
assert.ok(localConstraintEvidence.resourceConstraints.every((item) => item.sourceRefs?.includes('chat:900')), '本地约束必须绑定原文楼层');
assert.ok(localConstraintEvidence.npcActivities.some((item) => item.characterId === '林曳' && /搜捕余党/.test(item.action)), '最近正文明确写出的NPC行动不得整栏遗漏');
assert.equal(localConstraintEvidence.characters.some((item) => /皇帝|贵妃/.test(item.identity || '')), false, '本地兜底不得把某个案例的称谓硬编码成人物身份');

const normalizedIdentities = WorldStateMachine.Engine._test.normalizeGptIdentityAliases({
    identities: { user: '<user>', char: '陌生版皇兄夏以昼' },
    characters: [
        { id: 'user', name: '夏寻樨', summary: '夏寻樨：你正在兴州行宫' },
        { id: 'char', name: '陌生版皇兄夏以昼', summary: '夏以昼：昭国现任皇帝' },
        { id: 'card-alias', name: '皇兄夏以昼', summary: '角色卡显示标签' },
        { id: 'legacy-char', name: '<char>' },
    ],
}, '陌生版皇兄夏以昼');
assert.equal(normalizedIdentities.identities.user, '<USER>');
assert.equal(normalizedIdentities.identities.char, '');
assert.ok(normalizedIdentities.characters.some((item) => item.id === 'user' && item.name === '<USER>'));
assert.equal(normalizedIdentities.characters.find((item) => item.id === 'user').summary, '<USER>：<USER>正在兴州行宫');
assert.ok(normalizedIdentities.characters.some((item) => item.name === '夏以昼'), '只允许从正文明确前缀提取真实人名');
assert.equal(normalizedIdentities.characters.some((item) => /(?:<char>|陌生版皇兄|皇兄夏以昼)/i.test(item.name)), false);

const staleCurrentOnly = WorldStateMachine.Defaults.createState();
staleCurrentOnly.triggers = [{ id: 'old-block-trigger', title: '已经完成的权力交替', conditions: ['权力交替即将完成'], sourceRefs: ['chat-block:1'], status: 'armed' }];
WorldStateMachine.Engine._test.sanitizeGptHydratedState(staleCurrentOnly, { gptRecentRefs: ['chat:900'] });
assert.equal(staleCurrentOnly.triggers.length, 0, '覆盖大量旧楼层的压缩块不得被误当成当前触发器的近期证据');

const textEvidenceState = WorldStateMachine.Engine._test.stateFromEvidence({
    anchors: [{ description: '夏以昼是昭国现任皇帝', sourceRefs: ['chat:1'], truthStatus: 'confirmed' }],
    characters: [{ id: 'char-a', name: '夏以昼' }, { id: 'user', name: '夏寻樨' }, { id: 'npc-b', name: '林曳' }],
    npcActivities: [{ characterId: 'npc-b', action: '林曳接管兴州防务并开始清查王府余党。' }],
    resourceConstraints: ['夏寻樨的行动自由受到夏以昼严格限制。'],
    relationships: [{ from: 'char-a', to: 'user', identityRelation: '帝王与贵妃关系' }],
    knowledge: ['夏以昼已知晓夏寻樨母亲的真实身份。'],
    progression: ['夏寻樨与夏以昼围绕自由、保护与控制的矛盾仍在持续发展。'],
    causal: ['因为夏启行谋逆，导致夏以昼逼其自裁。'],
    currentScene: [{ location: '兴州行宫·漱玉园', environment: '夏以昼答应三天后带夏寻樨前往江南。', sourceRefs: ['chat:827'] }],
}, {}, WorldStateMachine.Defaults.createState()).state;
assert.equal(textEvidenceState.factAnchors[0].fact, '夏以昼是昭国现任皇帝');
assert.ok(textEvidenceState.npcActivities.some((item) => /林曳接管兴州防务/.test(item.action)), '纯文本NPC活动必须识别对应人物');
assert.equal(textEvidenceState.npcActivities.some((item) => item.action.includes('三天后带夏寻樨前往江南')), false, '当前场景人物不得被补造成NPC后台活动');
assert.equal(textEvidenceState.resourceConstraints.length, 1, '纯文本资源约束证据不得被运行态筛选丢弃');
assert.equal(textEvidenceState.relationships.length, 1, '纯文本关系证据必须识别双方人物');
assert.equal(textEvidenceState.knowledge.length, 1, '纯文本知识证据不得被运行态筛选丢弃');
assert.equal(textEvidenceState.threads.length, 1, '模型漏报线程时应从持续剧情推进线补建');
assert.equal(textEvidenceState.causalEffects[0].cause, '夏启行谋逆');
assert.equal(textEvidenceState.causalEffects[0].result, '夏以昼逼其自裁。');

const irreversibleEventFallback = WorldStateMachine.Engine._test.stateFromEvidence({
    events: ['兴州王夏启行在漱玉殿自裁身亡。'],
}, {}, WorldStateMachine.Defaults.createState()).state;
assert.match(irreversibleEventFallback.factAnchors[0]?.fact || '', /自裁.*身亡/, '模型漏报事实锚点时应从不可逆事件补建');

const gptAdmissionFixture = WorldStateMachine.Engine._test.sanitizeGptEvidence({
    events: [
        { summary: '夏寻樨对夏以昼的话表示不信，并在心里吐槽。夏以昼继续逗弄她，还安排了旁边的营帐。', sourceRefs: ['chat:826'] },
        { summary: '兴州王夏启行自裁身亡，兴州权力完成交替。', sourceRefs: ['chat:810'] },
    ],
    timeline: [
        { summary: '夏寻樨进帐后与夏以昼闲聊。', sourceRefs: ['chat:826'] },
        { summary: '兴州王夏启行自裁身亡，兴州权力完成交替。', sourceRefs: ['chat:810'] },
    ],
    tasks: [
        { title: '已经结束的即时事项', status: 'completed', sourceRefs: ['chat:826'] },
        { title: '核对当前清单', status: 'active', sourceRefs: ['chat:827'] },
    ],
    triggers: [{ title: '可能联想到旧事', conditions: ['也许会想起什么'], status: 'armed', sourceRefs: ['chat:827'] }],
    knowledge: [{ information: '夏以昼最终是否会同意她离开仍未知', sourceRefs: ['chat:827'] }],
    processes: [
        { title: '夏寻樨心理防线逐渐瓦解', currentDirection: '感情依赖加深', sourceRefs: ['chat:827'] },
        { title: '兴州权力格局重组', currentDirection: '地方防务正在被中央接管', sourceRefs: ['chat:827'] },
    ],
    relationships: [{ summary: '夏以昼对夏寻樨有强烈控制欲与占有欲', sourceRefs: ['chat:827'] }],
    characters: [{ name: '夏以昼', summary: '占有欲强烈且深爱夏寻樨', sourceRefs: ['chat:827'] }],
    causal: [{ cause: '夏寻樨持续寄信', result: '夏以昼无法忍受相思与控制欲，发兵西域将其抓回', sourceRefs: ['chat:700'] }],
}, {
    gptRecentRefs: ['chat:826', 'chat:827'],
    gptScene: { location: '兴州行宫·漱玉园', currentConditions: ['三日后离开兴州前往江南。'], sourceRefs: ['chat:827'] },
});
assert.equal(gptAdmissionFixture.events.length, 1, '日常吐槽、逗弄和营帐安排不得进入 GPT 世界事件');
assert.match(gptAdmissionFixture.events[0].summary, /自裁.*身亡/);
assert.equal(gptAdmissionFixture.timeline.length, 1, '日常进帐闲聊不得进入阶段时间线');
assert.equal(gptAdmissionFixture.tasks.length, 1, '已完成的即时待办不得保留');
assert.equal(gptAdmissionFixture.triggers.length, 0, '没有具体满足条件的猜测不得成为触发器');
assert.equal(gptAdmissionFixture.knowledge.length, 0, '未来问题不得伪装成角色知识');
assert.equal(gptAdmissionFixture.processes.length, 1, '个人心理变化不得伪装成世界进程');
assert.match(gptAdmissionFixture.processes[0].title, /权力格局/);
assert.equal(gptAdmissionFixture.relationships.length, 0, '控制欲、占有欲等心理臆测不得进入客观关系栏目');
assert.equal(gptAdmissionFixture.characters[0].summary, '', '人物摘要中的主观情感标签必须被清除');
assert.equal(gptAdmissionFixture.causal.length, 0, '带有相思、控制欲等臆测动机的因果记录必须被删除');

const source = {
    identities: { user: '测试用户', char: '测试角色' },
    character: { name: '测试角色', description: '角色卡完整内容。'.repeat(1200) },
    persona: 'Persona完整内容。'.repeat(700),
    worldbooks: [{
        name: '测试世界书',
        entries: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, comment: `规则${index + 1}`, content: `世界规则${index + 1}。`.repeat(260) })),
    }],
    chat: Array.from({ length: 80 }, (_, index) => ({ id: index + 1, role: index % 2 ? 'assistant' : 'user', name: index % 2 ? '测试角色' : '测试用户', content: `聊天第${index + 1}条完整原文。`.repeat(85) })),
    tavernTextContext: { totalMessages: 80, includedMessages: 80, truncated: false },
    currentUserAction: null,
    latestAssistantText: null,
};
source.currentUserAction = { ...source.chat[78] };
source.latestAssistantText = { ...source.chat[79] };
const payload = {
    phase: 'INITIALIZE_WORLD',
    source,
    currentState: WorldStateMachine.Defaults.createState(),
    stateSchema: WorldStateMachine.Defaults.STATE_SCHEMA,
    moduleOwnership: WorldStateMachine.Defaults.MODULE_OWNERSHIP,
    modulePrompts: WorldStateMachine.Defaults.MODULE_PROMPTS,
};
const settings = { model: '[按次]gpt-5.5', endpoint: 'https://example.test/v1', useTavernApi: false };
const plannerPrompt = WorldStateMachine.Defaults.PLANNER_PROMPT;
const prepared = WorldStateMachine.Engine._test.prepareSourceForStateRequests(source, { plannerPrompt, payload });
assert.equal(prepared.large, true);
assert.ok(prepared.originalChars > 100000, `expected a genuinely large source, got ${prepared.originalChars}`);
assert.ok(prepared.batches.length >= 2 && prepared.batches.every((batch) => batch.length > 0));
assert.ok(prepared.batches.length <= 2, 'Gemini/default complete read must stay within two requests');
assert.equal(prepared.deduplicatedRecords, 2);
assert.deepEqual(prepared.deduplicatedRefs.sort(), ['currentUserAction', 'latestAssistantText']);
assert.equal(prepared.batches.flat().length, prepared.sentRecords);
const allRecordParts = WorldStateMachine.Engine._test.completeSourceRecords(source).map((item) => `${item.ref}:${item.part || 1}:${item.serializedJson}`);
const sentRecordParts = prepared.batches.flat().map((item) => `${item.ref}:${item.part || 1}:${item.serializedJson}`);
const uniqueRecordParts = allRecordParts.filter((item) => !item.startsWith('currentUserAction:') && !item.startsWith('latestAssistantText:'));
assert.deepEqual(sentRecordParts, uniqueRecordParts, 'two-pass preparation must preserve all unique source records in order');
assert.ok(prepared.batchChars.every((chars) => chars > 0), 'every sequential batch must contain source text');

const hugeChat = Array.from({ length: 823 }, (_, index) => ({
    id: `huge-${index + 1}`,
    role: index % 2 ? 'assistant' : 'user',
    name: index % 2 ? '测试角色' : '测试用户',
    content: index % 2
        ? `<thinking>${'重复推理。'.repeat(6800)}</thinking><content>${'长篇正文。'.repeat(500)}</content><meow_FM><serial>No.${index}</serial><time>第${index}日</time><scene>测试地点</scene><plot>第${index}轮发生了会影响连续性的事件，并形成当前结果。</plot><seeds>保留一条后续种子。</seeds></meow_FM>`
        : `第${index}轮用户行动：${'明确表达当前行动。'.repeat(30)}`,
}));
const hugeSource = {
    ...source,
    chat: hugeChat,
    tavernTextContext: { totalMessages: hugeChat.length, includedMessages: hugeChat.length, truncated: false },
    currentUserAction: hugeChat.at(-1)?.role === 'user' ? hugeChat.at(-1) : hugeChat.at(-2),
    latestAssistantText: hugeChat.at(-1)?.role === 'assistant' ? hugeChat.at(-1) : hugeChat.at(-2),
};
const hugePrepared = WorldStateMachine.Engine._test.prepareSourceForStateRequests(hugeSource, { plannerPrompt, payload: { ...payload, source: hugeSource } });
assert.ok(hugePrepared.originalChars > 15_000_000, `expected a 15MB-class chat, got ${hugePrepared.originalChars}`);
assert.equal(hugePrepared.semanticCompaction, true);
assert.equal(hugePrepared.coveredChatMessages, 823);
assert.ok(hugePrepared.batches.length <= 2, 'Gemini/default 15MB-class read must stay within two requests');
assert.equal(hugePrepared.batches.length, 2, 'even a 15MB-class source must be locally packed into exactly two sequential API batches');
const hugePreparedGpt = WorldStateMachine.Engine._test.prepareSourceForStateRequests(hugeSource, { plannerPrompt, payload: { ...payload, source: hugeSource }, gptMode: true });
assert.equal(hugePreparedGpt.batches.length, 2, 'GPT mode must keep a huge complete read within two batches');
assert.equal(hugePreparedGpt.coveredChatMessages, 823, 'GPT hierarchy must report every locally scanned chat message');
assert.ok(hugePreparedGpt.includedChars < hugePrepared.includedChars, 'GPT mode must compact the included source more aggressively than default mode');
const representedHugeMessages = hugePrepared.batches.flat().reduce((sum, item) => sum
    + (item.kind === 'chat-chronicle-block' ? Number(item.messageCount || 0) : item.kind === 'chat-message' ? 1 : 0), 0);
assert.equal(representedHugeMessages, 823, 'every large-chat message must remain represented in the semantic chronicle blocks');

const result = await WorldStateMachine.Engine._test.buildStateWithinLimit(plannerPrompt, { ...payload, source: null }, payload.currentState, settings, undefined, prepared);
assert.equal(result.state.world.location.current, '测试地点');
assert.equal(result.state.map.rootLabel, '大地图', 'omitted default modules must be filled locally');
const mergedTestCharacter = result.state.characters.find((item) => item.name === '测试角色');
assert.ok(result.state.characters.some((item) => item.name === '测试用户'));
assert.equal(result.state.characters.length, 2, 'A/B evidence for the same named character must merge locally beside the current user entity');
assert.equal(mergedTestCharacter.identity, '资料管理员');
assert.equal(mergedTestCharacter.location, '资料室');
assert.equal(mergedTestCharacter.situation, '核心角色正在处理资料', 'later B evidence must update the earlier character snapshot');
assert.equal(mergedTestCharacter.notes, '', '人物姓名不得复制成连续性摘要');
assert.equal(result.state.worldRules[0].statement, '进入测试地点必须持有通行许可', 'explicit worldRules evidence must populate the hard-rule module instead of a placeholder');
assert.equal(result.state.npcActivities[0].action, '继续在后台整理资料');
assert.ok(result.state.events.some((item) => item.summary === '公司管理权完成正式交替'), '重大时间线证据必须安全回填世界事件');
assert.equal(result.state.triggers[0].title, '等待来电');
assert.equal(result.state.threads[0].title, '旧约仍未说开');
assert.equal(result.state.processes[0].title, '公司权力调整');
assert.ok(result.state.timeline.some((item) => item.summary === '公司管理权完成正式交替'));
assert.equal(result.state.timeline.some((item) => item.summary === '全部资料时间线'), false, '无具体阶段含义的泛化时间线不得保留');
assert.deepEqual(result.state.tasks, [], 'omitted arrays must be filled locally');
assert.equal(calls.length, prepared.batches.length);
assert.ok(calls.every((call) => call.payload.task === 'SOURCE_READ_SEQUENTIAL_BATCH'));
assert.equal(calls[0].options.jsonContract, 'evidence');
assert.equal(calls[1].options.jsonContract, 'evidence');
assert.equal(calls[1].options.maxTokens, 9000);
assert.equal(calls[1].options.reasoningEffort, undefined);
assert.equal(calls[1].payload.modulePrompts, undefined, 'request B must not resend local module prompt text');

calls.length = 0;
const gptResult = await WorldStateMachine.Engine._test.buildStateWithinLimit(
    plannerPrompt,
    { ...payload, source: null },
    payload.currentState,
    { ...settings, gptMode: true },
    undefined,
    hugePreparedGpt,
);
assert.equal(calls.length, 2, 'GPT complete read must remain capped at two calls');
assert.equal(calls[0].options.stream, true, 'GPT request A must stream through timeout-prone reverse proxies');
assert.equal(calls[1].options.stream, true, 'GPT request B must stream through timeout-prone reverse proxies');
assert.equal(calls[1].options.maxTokens, 9000);
assert.equal(calls[1].options.reasoningEffort, 'low');
assert.ok(calls[1].payload.firstHalfEvidence?.canon?.includes('请求 A 已逐项读取'), 'GPT request B must receive request A evidence for an ordered overwrite merge');
assert.equal(gptResult.state.world.location.current, '测试地点', 'latest GPT scene must override stale chronology');
assert.match(gptResult.state.world.time.display, /第821日/, 'GPT current time must come from the latest assistant memory');
assert.equal(gptResult.state.characters.some((item) => /^[{["']/.test(item.name)), false, 'malformed structured strings must not create pseudo-character names');
assert.equal(calls[1].payload.stateSchema, undefined, 'request B must not resend the verbose state schema');
assert.equal(calls[1].payload.stateShape, undefined, 'request B only returns merged evidence; state hydration is local');
assert.equal(calls[1].payload.currentState, undefined, 'request B must not resend current state');
assert.ok(calls.every((call) => call.options.singleAttempt === true));
assert.equal(calls.reduce((sum, call) => sum + call.payload.sourceRecords.length, 0), hugePreparedGpt.sentRecords);
const progress = WorldStateMachine.Engine.getProgress();
assert.match(progress.steps.map((step) => `${step.message} ${step.details}`).join('\n'), /批次 1\/\d+.*API 1 次/);
assert.match(progress.steps.map((step) => `${step.message} ${step.details}`).join('\n'), /全部资料批次读取完成.*严格串行/);

calls.length = 0;
const preparedAgain = WorldStateMachine.Engine._test.prepareSourceForStateRequests(source, { plannerPrompt, payload });
await WorldStateMachine.Engine._test.buildStateWithinLimit(plannerPrompt, { ...payload, source: null }, payload.currentState, settings, undefined, preparedAgain);
assert.equal(calls.length, 0, 'all completed sequential batches should be reusable without another API call');
assert.equal(preparedAgain.cacheHits, preparedAgain.batches.length);
assert.equal(preparedAgain.requestAttempts, 0);

calls.length = 0;
const smallSource = {
    identities: { user: '测试用户', char: '测试角色' },
    character: { name: '测试角色', description: '进入资料室必须登记。' },
    persona: '测试用户', worldbooks: [],
    chat: [{ id: 1, role: 'assistant', name: '测试角色', content: '夜晚天气炎热，我进入资料室打开空调整理资料。' }],
    tavernTextContext: { totalMessages: 1, includedMessages: 1, truncated: false },
};
const smallPayload = { ...payload, source: smallSource };
const smallPrepared = WorldStateMachine.Engine._test.prepareSourceForStateRequests(smallSource, { plannerPrompt, payload: smallPayload });
assert.equal(smallPrepared.large, false);
const smallResult = await WorldStateMachine.Engine._test.buildStateWithinLimit(plannerPrompt, smallPayload, payload.currentState, settings, undefined, smallPrepared);
assert.equal(calls.length, 1, 'a small source must use exactly one evidence request');
assert.equal(calls[0].payload.task, 'SOURCE_READ_COMPLETE');
assert.equal(calls[0].options.jsonContract, 'evidence');
assert.equal(smallResult.state.world.location.current, '资料室');
assert.equal(smallResult.state.world.location.weather, '炎热');
assert.equal(smallResult.state.worldRules[0].statement, '进入资料室必须登记');
assert.ok(smallResult.state.events.some((item) => /资料室.*重大事故/.test(item.title)), 'Gemini/default 模式必须保留合格重大事件');
assert.equal(smallResult.state.processes.length, 0, '个人整理动作不得从剧情推进线回填成世界进程');

console.log('Two-pass large-source smoke tests passed');
