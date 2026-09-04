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
await import('../src/context.js');

const calls = [];
const auditedModules = ['world','worldRules','factAnchors','resourceConstraints','organizations','map','characters','npcActivities','relationships','knowledge','schedules','tasks','triggers','threads','progression','processes','causalEffects','timeline'];
const completeEvidence = (value = {}) => ({
    sourceRefs: [], canon: [], worldRules: [], chronology: [], timeline: [], anchors: [], resourceConstraints: [], organizations: [], characters: [], npcActivities: [], relationships: [], knowledge: [], schedules: [], locations: [], tasks: [], triggers: [], threads: [], processes: [], causal: [], progression: [], currentScene: [], uncertainties: [], matchedRules: [], derivedFacts: [], conflicts: [], staleStates: [], actorFeasibility: [], causalCandidates: [],
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
                    characters: [{ id: 'user', name: '测试用户', identity: '测试用户' }, { id: 'test-char', name: '测试角色', identity: '资料管理员', location: '资料室', situation: '正在整理资料' }],
                    relationships: [], npcActivities: [{ characterId: '测试角色', action: '整理资料', sourceRefs: ['chat:1'] }],
                    knowledge: [], locations: [{ name: '资料室' }], tasks: [],
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
                    knowledge: [], locations: [], tasks: [], triggers: [], threads: [], processes: [], timeline: [], causal: [], currentScene: [], uncertainties: [],
                }),
            };
        }
        if (payload.task === 'SOURCE_READ_SEQUENTIAL_BATCH' && payload.sourceBatchIndex === payload.sourceBatchCount && payload.completeCoverage?.originalChars < 50000) {
            return {
                evidence: completeEvidence({
                    sourceRefs: ['chat:1','worldbook:test:1'],
                    worldRules: [{ statement: '进入资料室必须登记', sourceRefs: ['worldbook:test:1'] }],
                    chronology: [{ time: '夜晚', summary: '资料室发生重大事故并被永久封锁', sourceRefs: ['chat:1'] }],
                    timeline: [{ summary: '资料室发生重大事故并被永久封锁', sourceRefs: ['chat:1'] }],
                    characters: [{ id: 'user', name: '测试用户', identity: '测试用户' }, { id: 'test-char', name: '测试角色', identity: '资料管理员', location: '资料室', situation: '正在整理资料' }],
                    npcActivities: [{ characterId: '测试角色', action: '整理资料', sourceRefs: ['chat:1'] }],
                    locations: [{ name: '资料室' }],
                    currentScene: [{ time: '夜晚', location: '资料室', weather: '炎热', environment: '空调开启', presentCharacterIds: [] }],
                }),
            };
        }
        if (payload.task === 'SOURCE_READ_SEQUENTIAL_BATCH' && payload.sourceBatchIndex === payload.sourceBatchCount) {
            return {
                evidence: completeEvidence({
                    sourceRefs: payload.sourceRecords.map((item) => item.ref),
                    canon: ['请求 A 已逐项读取', '请求 B 已逐项读取'],
                    worldRules: [{ statement: '进入测试地点必须持有通行许可', scope: ['测试地点'], conditions: ['进入时'], exceptions: [], sourceRefs: ['worldbook:test:1'] }],
                    chronology: [],
                    timeline: [{ summary: '公司管理权完成正式交替', granularity: 'phase', sourceRefs: ['chat:80'] }],
                    characters: [{ id: 'user', name: '测试用户', identity: '测试用户' }, { id: 'test-char', name: '测试角色', identity: '资料管理员', location: '资料室', situation: '核心角色正在处理资料' }],
                    npcActivities: [{ characterId: 'test-char', action: '继续在后台整理资料', location: '资料室', sourceRefs: ['chat:80'] }],
                    relationships: [], knowledge: [], locations: [{ name: '测试地点' }], tasks: [],
                    triggers: [{ title: '等待来电', conditions: ['对方完成核实'], status: 'armed', userVisible: true, sourceRefs: ['chat:80'] }],
                    threads: [{ title: '旧约仍未说开', status: 'open', stakes: '双方关系' }],
                    processes: [{ title: '公司权力调整', status: 'active', currentDirection: '管理权继续集中' }], causal: [],
                    currentScene: [{ location: '测试地点', environment: '当前场景', presentCharacterIds: [] }], uncertainties: [],
                }),
            };
        }
        if (payload.task === 'SOURCE_READ_SEQUENTIAL_BATCH') {
            return { evidence: completeEvidence({ sourceRefs: payload.sourceRecords.map((item) => item.ref) }) };
        }
        throw new Error(`unexpected task ${payload.task}`);
    },
};
await import('../src/engine.js');

assert.deepEqual(WorldStateMachine.Engine._test.ordinaryTurnCallPolicy(), {
    apiCallsPerUserMessage: 1,
    postGenerationApiCalls: 0,
}, '普通轮次必须固定为每条用户消息一次状态机API，正文后不得追加第二次');

const queuedTurns = WorldStateMachine.Engine._test.pendingTurnReads([
    { turnKey: 'turn-1', previousAssistantMessage: { id: 1, content: '上一轮正文' }, currentUserAction: { id: 2, content: '用户行动' } },
    { turnKey: 'turn-1', previousAssistantMessage: { id: 1, content: '重复正文' } },
    { turnKey: 'turn-2', currentUserAction: { id: 3, content: '下一轮行动' } },
]);
assert.deepEqual(queuedTurns.map((item) => item.turnKey), ['turn-1', 'turn-2'], '超时补账队列必须按轮次去重，避免下一次API重复结算');
assert.equal(queuedTurns[0].previousAssistantMessage?.content, '上一轮正文', '未成功读取的助手正文必须保留到下一次单调用补账');
const alreadyReadQueue = WorldStateMachine.Engine._test.pendingTurnReads([
    { turnKey: 'turn-19', previousAssistantMessage: { id: 19, content: '已读取正文' }, previousAssistantFloor: 19, currentUserAction: { id: 20, content: '用户行动' } },
], 19);
assert.equal(alreadyReadQueue[0].previousAssistantMessage, null, '达到楼层高水位后不得自动重复读取同一助手正文');
assert.equal(WorldStateMachine.Engine._test.shouldReuseTurnPlan('regenerate'), true, '重新回复必须复用同一轮计划，不得再次调用状态API');
assert.equal(WorldStateMachine.Engine._test.shouldReuseTurnPlan('swipe'), true, '切换回复候选必须复用同一轮计划');
assert.equal(WorldStateMachine.Engine._test.shouldReuseTurnPlan('normal'), false);
const interceptedUser = WorldStateMachine.Engine._test.interceptorTurnUserMessage([
    { is_user: false, mes: '上一轮助手正文', send_date: 'assistant-1', index: 8 },
    { is_user: true, mes: '刚刚发送、尚未进入全局上下文的新消息', send_date: 'user-2', index: 9 },
]);
assert.equal(interceptedUser.id, 'user-2', '生成拦截器必须直接读取传入 chat 里的新用户消息');
assert.equal(interceptedUser.content, '刚刚发送、尚未进入全局上下文的新消息', '自动读取不能依赖可能仍滞后的 getContext().chat');
const previousBodyReceipt = WorldStateMachine.Engine._test.previousBodyReceipt({ id: 'assistant-9', index: 18, content: '上一轮正文' });
assert.equal(previousBodyReceipt.floor, 19, '手动读取必须保存可见楼层的一基编号');
assert.equal(previousBodyReceipt.messageId, 'assistant-9', '手动读取必须保存助手消息ID');
assert.match(previousBodyReceipt.messageKey, /^assistant-9:/, '楼层记录必须绑定正文哈希，避免把不同正文误认为同一份');
assert.equal(WorldStateMachine.Engine._test.readFloorHighWater({ runtime: { lastReadFloor: 19, lastPreviousBodyFloor: 18, sourceSummary: { chatMessages: 17 } } }), 19, '自动读取去重必须使用已保存的最高楼层');
assert.equal(WorldStateMachine.Engine._test.readReceiptRuntime({ runtime: { lastReadFloor: 19 } }, { ...previousBodyReceipt, floor: 18 }).lastReadFloor, 19, '手动重读较低楼层不得降低自动读取高水位');
const compactTurn = WorldStateMachine.Engine._test.compactTurnState({
    identities: { user: '用户' }, organizations: [{ id: 'org', name: '组织', situation: '仍在活动', basis: ['原文'], sourceRefs: ['chat:1'], truthStatus: 'confirmed' }],
    reasoningAudit: { moduleDecisions: ['技术审计'] }, moduleCoverage: { organizations: { status: 'has_records' } },
    runtime: { sourceSummary: '很大的技术缓存' }, planner: { injection: '重复注入' },
});
assert.equal(compactTurn.organizations[0].name, '组织');
assert.equal(compactTurn.organizations[0].sourceRefs, undefined, '普通轮次不得重复发送来源索引');
assert.equal(compactTurn.reasoningAudit, undefined, '普通轮次不得重复发送审计表');
assert.equal(compactTurn.runtime, undefined);
const directSettlement = WorldStateMachine.Engine._test.normalizeSettlementResult({
    stateDelta: { world: { location: { current: '第七层新地点' } }, characters: [{ id: 'hero', name: '新人物' }] },
    actualChanges: ['地点与人物已更新'],
});
assert.equal(directSettlement.delta.statePatch.world.location.current, '第七层新地点', '直接写在 stateDelta 下的状态模块必须被应用，不得假成功');
assert.equal(directSettlement.delta.statePatch.characters[0].name, '新人物');
const directWorldSettlement = WorldStateMachine.Engine._test.normalizeSettlementResult({
    time: { display: '昭国四年 秋 第十四日☆24:00-01:00' },
    season: '秋',
    seasonMeta: { truthStatus: 'confirmed' },
    location: { current: '揽月轩' },
    environment: '夜间室内',
    weather: '多云',
});
assert.equal(directWorldSettlement.delta.statePatch.world.location.current, '揽月轩', '接口直接返回 world 栏目内容时必须包装为 world 增量');
const nestedSettlement = WorldStateMachine.Engine._test.normalizeSettlementResult({
    output: { stateDelta: { statePatch: { sceneState: { location: '新场景' } } }, actualChanges: ['进入新场景'] },
});
assert.equal(nestedSettlement.delta.statePatch.sceneState.location, '新场景', '接口的 output 包装层不得导致状态丢失');
assert.deepEqual(WorldStateMachine.Engine._test.normalizeSettlementResult({ stateDelta: {} }).delta, {}, '显式空增量才可以作为无变化的成功结果');
assert.deepEqual(WorldStateMachine.Engine._test.normalizeSettlementResult({ stateDelta: 'KEEP' }).delta, {}, '模型返回 KEEP 时应识别为无变化');
assert.deepEqual(WorldStateMachine.Engine._test.normalizeSettlementResult({ stateDelta: { statePatch: null, collectionOps: null } }).delta.collectionOps, [], '兼容模型以 null 表示空增量字段');
assert.equal(WorldStateMachine.Engine._test.normalizeSettlementResult({ stateDelta: [{ module: 'characters', op: 'remove', id: 'old' }] }).delta.collectionOps[0].id, 'old', '兼容直接返回操作数组');
assert.throws(
    () => WorldStateMachine.Engine._test.normalizeSettlementResult({ timelineEntry: {}, actualChanges: [] }),
    /缺少可应用的 stateDelta/,
    '缺少状态增量的普通对象不得更新楼层标记并报成功',
);
const storageBeforeIncrementalReconcile = WorldStateMachine.Storage;
WorldStateMachine.Storage = {
    ...(storageBeforeIncrementalReconcile || {}),
    clone: (value) => structuredClone(value),
    enforceTruthTransition: (_previous, value) => value,
};
const reconciledLists = WorldStateMachine.Engine._test.applyStateDelta({
    revision: 3,
    world: { location: {} },
    characters: [
        { id: 'changed', name: '旧姓名', situation: '旧状态' },
        { id: 'kept', name: '未变人物', situation: '未变状态' },
        { id: 'removed', name: '已离开人物', situation: '旧场景' },
    ],
    tasks: [],
}, {
    collectionOps: [
        { module: 'characters', op: 'update', id: 'changed', value: { id: 'changed', name: '新姓名', situation: '新状态' } },
        { module: 'characters', op: 'remove', id: 'removed' },
    ],
});
assert.equal(reconciledLists.characters.find((item) => item.id === 'changed')?.situation, '新状态', '正文明确变化的列表条目必须更新');
assert.equal(reconciledLists.characters.find((item) => item.id === 'kept')?.situation, '未变状态', '正文未改变的列表条目必须保留');
assert.equal(reconciledLists.characters.some((item) => item.id === 'removed'), false, '正文明确失效的列表条目必须删除');
const sceneUpdated = WorldStateMachine.Engine._test.applyAssistantSceneFacts({
    world: { time: { display: '旧时间' }, location: { current: '旧地点' } },
}, 'time:昭国四年 秋 第十四日☆24:00-01:00\nscene:兴州行宫·漱玉园至揽月轩');
assert.equal(sceneUpdated.world.time.display, '昭国四年 秋 第十四日☆24:00-01:00', '正文末尾 time 必须覆盖列表的旧时间');
assert.equal(sceneUpdated.world.location.current, '揽月轩', '场景发生迁移时必须保存最终地点');
WorldStateMachine.Storage = storageBeforeIncrementalReconcile;
assert.equal(WorldStateMachine.Engine._test.deletedAssistantCount([
    { signature: 'u1', role: 'user' }, { signature: 'a1', role: 'assistant' }, { signature: 'u2', role: 'user' }, { signature: 'a2', role: 'assistant' }, { signature: 'a3', role: 'assistant' },
], [{ signature: 'u1', role: 'user' }, { signature: 'a1', role: 'assistant' }]), 2, '删除五层中的多条助手回复时必须按助手数量回滚');

const malformedFilledEvidence = completeEvidence({ tasks: ['把同一段剧情当任务摘要'] });
assert.throws(() => WorldStateMachine.Engine._test.validateFilledEvidence(malformedFilledEvidence, '测试填表'), /未按模块表格填写/, '状态模块不得接受字符串摘要卡');

const previousStorage = WorldStateMachine.Storage;
WorldStateMachine.Storage = {
    readSourceReadArchive: () => [{
        anchors: ['旧读取锚点'], resourceConstraints: ['仍有效的行动限制'],
        relationships: ['甲与乙：长期盟友。'], knowledge: ['甲知晓密道位置。'], threads: ['尚未解决的旧约。'],
    }],
};
const supplementedEvidence = WorldStateMachine.Engine._test.supplementMissingEvidenceFromArchive({
    anchors: ['本次锚点'], resourceConstraints: [], relationships: [], knowledge: [], threads: [],
    moduleCoverage: [{ module: 'relationships', status: 'empty_confirmed', basis: '本次确认没有关系记录' }],
});
assert.deepEqual(supplementedEvidence.anchors, ['本次锚点'], '本次非空证据必须优先于档案');
assert.deepEqual(supplementedEvidence.relationships, [], '本次明确判空的栏目不得被旧档案重新填回');
const failedSupplement = WorldStateMachine.Engine._test.supplementMissingEvidenceFromArchive({
    relationships: [], moduleCoverage: [{ module: 'relationships', status: 'retrieval_failed', basis: '本次漏读' }],
});
assert.deepEqual(failedSupplement.relationships, ['甲与乙：长期盟友。'], '只有明确读取失败时才允许旧档案安全回填');
WorldStateMachine.Storage = previousStorage;

const malformedDirectState = WorldStateMachine.Engine._test.normalizeStateResult({
    state: {
        characters: { hero: { name: '单对象人物' }, ally: { summary: '对象表人物' } },
        timeline: '已发生的重要事件',
        tasks: '{"main":{"title":"对象字符串任务"}}',
        processes: { title: '单个世界进程', currentDirection: '持续演变' },
        organizations: [
            { id: 'truthStatus', name: 'truthStatus', kind: 'other', situation: 'truthStatus: confirmed' },
            { id: 'basis', name: 'basis', kind: 'other', situation: 'basis: 测试依据' },
        ],
    },
}, WorldStateMachine.Defaults.createState()).state;
assert.ok(Array.isArray(malformedDirectState.characters));
assert.equal(malformedDirectState.characters.length, 2);
assert.equal(malformedDirectState.characters[1].name, 'ally', 'object-map keys must be retained when an item omits its name');
assert.equal(malformedDirectState.timeline[0].summary, '已发生的重要事件');
assert.equal(malformedDirectState.tasks[0].title, '对象字符串任务');
assert.equal(malformedDirectState.processes[0].currentDirection, '持续演变');
assert.deepEqual(malformedDirectState.organizations, [], '通用证据字段不得被拆成组织名称卡片');
const metadataOnlyOrganization = WorldStateMachine.Engine._test.normalizeStateCollection({
    truthStatus: 'confirmed', basis: ['测试依据'], sourceRefs: ['worldbook:test:12'], priority: 'L2', activity: 'HOT',
}, 'organizations');
assert.equal(metadataOnlyOrganization.length, 1, '通用证据单对象必须保持为一个对象，不能按键拆成五张卡');
assert.equal(metadataOnlyOrganization[0].name, undefined, '缺少必填名称的组织不得由技术字段伪造名称');
const repairedOrganizationEvidence = {
    organizations: [{ truthStatus: 'confirmed', basis: ['露贵妃代为执掌六宫'], sourceRefs: ['worldbook:test:12'], priority: 'L2', activity: 'HOT' }],
};
WorldStateMachine.Engine._test.repairFinalFillFromSourceCompile(repairedOrganizationEvidence, {
    organizations: [{ id: 'rear-palace', name: '昭国后宫', kind: 'political', leaderIds: ['露贵妃'], jurisdiction: '六宫', situation: '露贵妃代为执掌六宫', sourceRefs: ['worldbook:test:12'] }],
});
assert.equal(repairedOrganizationEvidence.organizations.length, 1);
assert.equal(repairedOrganizationEvidence.organizations[0].name, '昭国后宫', '第二遍只回传证据元数据时必须按唯一来源补回第一遍的专属字段');
assert.equal(repairedOrganizationEvidence.organizations[0].truthStatus, 'confirmed');
const namedOrganizationState = WorldStateMachine.Engine._test.stateFromEvidence(completeEvidence({
    organizations: [
        { id: 'generic-family-clause', name: '不同家族', kind: 'dynastic', situation: '不同家族程度不同', sourceRefs: ['worldbook:test:generic'] },
        { id: 'generic-modern-family', name: '现代家族', kind: 'dynastic', situation: '现代家族通常使用家庭压力', sourceRefs: ['worldbook:test:generic'] },
        { id: 'generic-private-clause', name: '不是私人势力', kind: 'faction', situation: '警方不是私人势力', sourceRefs: ['worldbook:test:generic'] },
        { id: 'real-court', name: '昭国朝廷', kind: 'government', situation: '负责全国政务', sourceRefs: ['worldbook:test:court'] },
    ],
}), {}, WorldStateMachine.Defaults.createState()).state;
assert.deepEqual(namedOrganizationState.organizations.map((item) => item.name), ['昭国朝廷'], '组织栏目只能保留明确命名实体，社会规则中的泛称短语不得建卡');
const genericOrganizationState = WorldStateMachine.Engine._test.stateFromEvidence(completeEvidence({
    organizations: [{ id: 'generic-modern-family', name: '现代家族', kind: 'dynastic', situation: '现代家族通常使用家庭压力', sourceRefs: ['worldbook:test:generic'] }],
}), {}, WorldStateMachine.Defaults.createState()).state;
assert.equal(genericOrganizationState.moduleCoverage.organizations.status, 'empty_confirmed', '全部组织候选都是规则泛称时应明确判空，而不是留下矛盾的has_records覆盖状态');
const keptCompiledEvidence = WorldStateMachine.Engine._test.mergeAdjudicatedEvidence(
    completeEvidence({
        organizations: [{ id: 'court', name: '昭国朝廷', kind: 'government', sourceRefs: ['worldbook:test:court'] }],
        timeline: [{ id: 'enthronement', summary: '新帝已经正式登基', sourceRefs: ['worldbook:test:history'] }],
    }),
    completeEvidence({
        organizations: [], timeline: [],
        moduleDecisions: auditedModules.map((module) => ({ module, operation: 'KEEP', reason: '本轮没有新变化' })),
    }),
);
assert.equal(keptCompiledEvidence.organizations[0].name, '昭国朝廷', '请求B的KEEP空数组不得清空请求A读到的组织');
assert.equal(keptCompiledEvidence.timeline[0].summary, '新帝已经正式登基', '请求B的KEEP空数组不得清空请求A读到的历史节点');
const removedCompiledEvidence = WorldStateMachine.Engine._test.mergeAdjudicatedEvidence(
    completeEvidence({ organizations: [{ id: 'defunct', name: '已解散组织' }] }),
    completeEvidence({
        organizations: [],
        moduleDecisions: auditedModules.map((module) => ({ module, operation: module === 'organizations' ? 'ARCHIVE' : 'KEEP', reason: '原文明示该组织已经解散' })),
    }),
);
assert.deepEqual(removedCompiledEvidence.organizations, [], '请求B明确ARCHIVE时仍可清空请求A的对应模块');
const tolerantEvidence = completeEvidence({
    organizations: { '昭国朝廷': { kind: 'government', situation: '仍在运行', sourceRefs: ['worldbook:test:government'] } },
    timeline: [{ summary: '兴州发生了已经明确写出的重大变故。', sourceRefs: ['chat:810'] }],
});
WorldStateMachine.Engine._test.normalizeEvidenceFillShapes(tolerantEvidence);
assert.equal(tolerantEvidence.organizations[0].name, '昭国朝廷', '以组织名为键的对象表必须安全转换为组织卡');
assert.equal(tolerantEvidence.timeline[0].summary, '兴州发生了已经明确写出的重大变故。', '只有summary的历史节点必须保留');
const partlyMalformed = completeEvidence({
    organizations: [
        { name: '有效组织', kind: 'government', sourceRefs: ['worldbook:test:valid'] },
        { truthStatus: 'confirmed', sourceRefs: ['worldbook:test:broken'] },
    ],
});
const partlyFilled = WorldStateMachine.Engine._test.validateFilledEvidence(partlyMalformed, '部分坏卡', { allowPartial: true });
assert.equal(partlyFilled.complete, true, '一张坏卡不能把同栏目其他合格卡整体标成读取失败');
assert.equal(partlyMalformed.organizations.length, 1);
assert.equal(partlyMalformed.organizations[0].name, '有效组织');

const localFallbackEvidence = WorldStateMachine.Engine._test.localEvidenceFromSource({
    identities: { user: '测试用户', char: '' }, character: { name: '测试角色', description: '角色卡背景' },
    worldbooks: [{ name: '规则书', entries: [{ id: 1, content: '进入内城必须持有通行许可。任何人不得冒用他人的身份进入内城。' }] }],
    chat: [{ id: 9, role: 'assistant', name: '测试角色', content: '<meow_FM>\ntime:夜晚\nscene:内城资料室\nplot:测试角色进入资料室并开始调查。\nseeds:调查完成后会收到回信。\n</meow_FM><INDRS>\n当前进度:整理证据\n待办事项:核对登记簿\n</INDRS>' }],
});
assert.ok(localFallbackEvidence.characters.some((item) => item.id === 'user' && item.name === '测试用户'), '用户必须始终按当前用户名以第三人称建档');
assert.equal(localFallbackEvidence.characters.some((item) => item.name === '测试角色'), false, '角色卡标题不得自动当作人物姓名');
assert.equal(localFallbackEvidence.worldRules.length, 2);
assert.equal(localFallbackEvidence.timeline.length, 0, '普通逐轮行动不得被本地解析成阶段时间线');
assert.equal(localFallbackEvidence.currentScene[0].location, '内城资料室');
assert.equal(localFallbackEvidence.tasks[0].title, '核对登记簿');
assert.equal(localFallbackEvidence.progression[0].direction, '整理证据');
assert.ok(localFallbackEvidence.processes.some((item) => /开始调查/.test(item.currentDirection)), '近期 meow_FM 明确写出的进行中调查必须进入进程');
assert.equal(localFallbackEvidence.moduleCoverage.find((item) => item.module === 'factAnchors')?.status, 'empty_confirmed', '本地完整扫描确认没有独立锚点时必须形成可验证的空栏审计');
assert.equal(localFallbackEvidence.moduleCoverage.find((item) => item.module === 'npcActivities')?.status, 'empty_confirmed', '最近正文没有离场NPC活动时必须明确判空，不能永久保持读取失败');

const emptyTodoEvidence = WorldStateMachine.Engine._test.localEvidenceFromSource({
    chat: [{ id: 10, role: 'assistant', content: '<INDRS>\n待办事项:无。\n当前进度:暂无。\n</INDRS>' }],
});
assert.deepEqual(emptyTodoEvidence.tasks, [], '带中文句号的“无。”不得被误读成当前任务');

const localKnowledgeEvidence = WorldStateMachine.Engine._test.localEvidenceFromSource({
    identities: { user: '鹿鹿', char: '' }, character: { name: '陌生版皇兄夏以昼' },
    chat: [{ id: 255, role: 'assistant', content: '<meow_FM><plot>鹿鹿向父母隐瞒了自己曾逃亡的真相。父母尚不知晓你已落入夏以昼手中。夏以昼向你揭示了过去两年一直秘密监视你的事实。夏以昼对鹿鹿母亲的真实身份产生了怀疑。</plot><seeds>夏以昼已经知道鹿鹿来自异世。</seeds></meow_FM>' }],
});
assert.ok(localKnowledgeEvidence.knowledge.some((item) => item.knownBy.includes('user') && item.unknownTo.includes('父母') && /逃亡的真相/.test(item.information)), '明确隐瞒必须保留隐瞒者与未知者');
assert.ok(localKnowledgeEvidence.knowledge.some((item) => item.unknownTo.includes('父母') && /落入夏以昼手中/.test(item.information)), '明确不知情必须形成知识边界');
assert.ok(localKnowledgeEvidence.knowledge.some((item) => item.knownBy.includes('user') && /秘密监视/.test(item.information)), '秘密被揭示后接收者必须进入确认知情名单');
assert.ok(localKnowledgeEvidence.knowledge.some((item) => item.suspectedBy.includes('夏以昼') && /母亲的真实身份/.test(item.information)), '人物的怀疑必须作为已确认的认知状态保存，而不能把怀疑内容冒充事实');
const diagnosticOnlyKnowledge = WorldStateMachine.Engine._test.stateFromEvidence(
    completeEvidence({ uncertainties: [{ information: '两批资料读取存在未返回栏目', status: 'retrieval_failed' }] }),
    completeEvidence(), WorldStateMachine.Defaults.createState(),
).state.knowledge;
assert.deepEqual(diagnosticOnlyKnowledge, [], '读取失败诊断绝不能再伪装成知识或秘密卡片');

const crowdedRuleSource = WorldStateMachine.Engine._test.localEvidenceFromSource({
    worldbooks: [{ name: '制度书', entries: [
        { id: 1, content: Array.from({ length: 24 }, (_value, index) => `礼法规则${index + 1}：所有人在公开场合必须遵守第${index + 1}项礼制。`).join('\n') },
        { id: 11, content: '<皇权礼法>\n帝王之束（若{{char}}为皇帝）：\n礼法规制：皇帝受礼部典章、言官清议、史官直笔监督。\n朝堂制衡：诏令需经中书草拟、门下审核、尚书执行。\n王侯之限（若{{char}}为藩王）：无诏不得离开封地。\n朝会议事：重大政事需经朝会辩论，最终由皇帝裁夺。\n</皇权礼法>' },
    ] }],
    chat: [],
});
assert.ok(crowdedRuleSource.worldRules.some((item) => item.sourceRefs?.includes('worldbook:制度书:11') && /皇帝|诏令/.test(item.statement)), '前一世界书条目再长也不能挤掉后续条目的皇权规则');
assert.ok(crowdedRuleSource.resourceConstraints.some((item) => item.subjectId === 'role:皇帝' && /中书草拟/.test(item.condition)), '世界书明确写出的帝王制度限制必须形成可实例化资源约束');
const roleResolvedState = { identities: { user: '测试用户' }, world: { location: { current: '' } }, sceneState: {}, characters: [
    { id: 'user', name: '测试用户', identity: '贵妃' },
    { id: 'char-emperor', name: '夏以昼', identity: '昭国皇帝' },
], relationships: [], resourceConstraints: [{ subjectId: 'role:皇帝', condition: '诏令需经中书草拟、门下审核、尚书执行' }] };
WorldStateMachine.Engine._test.reconcileEntityReferences(roleResolvedState);
assert.equal(roleResolvedState.resourceConstraints[0].subjectId, 'char-emperor', '角色身份唯一匹配皇帝时必须把制度约束绑定到当前人物');

const localMajorEvidence = WorldStateMachine.Engine._test.localEvidenceFromSource({
    chat: [{ id: 820, role: 'assistant', content: '<meow_FM><time>昭国四年秋第十四日</time><scene>兴州行宫</scene><plot>最终，夏启行选择自裁以保全家人，并当场血溅宫殿。夏以昼随即宣告此案了结。</plot><seeds>兴州权力核心完成交替，夏以昼势力得到巩固。<br>林曳将正式接管兴州防务，并开始清查王府余党。<br>王露笙的密信将很快送往昭宁，成为下一阶段查办朝中势力的关键证据。</seeds></meow_FM>' }],
});
assert.equal(localMajorEvidence.timeline.length, 1, '本地扫描必须从历史 plot 重建客观重大节点');
assert.match(localMajorEvidence.timeline[0].summary, /夏启行选择自裁/);
assert.ok(localMajorEvidence.anchors.some((item) => /夏启行已经死亡/.test(item.fact)), '不可逆死亡结果必须建立长期事实锚点，防止人物以后被当作存活状态继续行动');
assert.ok(localMajorEvidence.processes.some((item) => /清查王府余党/.test(item.currentDirection)), 'seeds 中明确仍在进行的全局行动必须进入进程');
assert.ok(localMajorEvidence.threads.some((item) => /密信/.test(item.stakes)), 'seeds 中明确跨阶段延续的线索必须进入未决事项');
assert.ok(localMajorEvidence.causal.some((item) => /权力核心完成交替/.test(item.cause) && /势力得到巩固/.test(item.result)), '同一句明确陈述的状态变化与持续结果必须进入因果影响');

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
assert.equal(localConstraintEvidence.moduleCoverage.find((item) => item.module === 'npcActivities')?.status, 'has_records', '本地找到NPC活动时覆盖审计必须同步为有记录');
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
assert.equal(textEvidenceState.threads.length, 0, '模型漏报线程时不得把剧情推进复制成长线');
assert.equal(textEvidenceState.causalEffects[0].cause, '夏启行谋逆');
assert.equal(textEvidenceState.causalEffects[0].result, '夏以昼逼其自裁。');

const irreversibleEventFallback = WorldStateMachine.Engine._test.stateFromEvidence({
    timeline: ['兴州王夏启行在漱玉殿自裁身亡。'],
}, {}, WorldStateMachine.Defaults.createState()).state;
assert.equal(irreversibleEventFallback.factAnchors.length, 0, '时间线不得被代码自动复制为事实锚点；是否需要锚点由唯一归属填表决定');

const scheduleOnlyState = WorldStateMachine.Engine._test.stateFromEvidence(completeEvidence({
    schedules: [{ id: 'trip', title: '三日后前往江南', participantIds: ['user','char'], expectedTime: '三日后', preconditions: ['兴州政务完成'], status: 'agreed' }],
    progression: [], threads: [], tasks: [],
}), {}, WorldStateMachine.Defaults.createState()).state;
assert.equal(scheduleOnlyState.schedules.length, 1);
assert.equal(scheduleOnlyState.tasks.length, 0);
assert.equal(scheduleOnlyState.threads.length, 0);
assert.equal(scheduleOnlyState.progression.direction, '', '安排不得被代码复制到任务、事件、线程或剧情推进');

const gptAdmissionFixture = WorldStateMachine.Engine._test.sanitizeGptEvidence({
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
assert.equal(gptAdmissionFixture.timeline.length, 2, '成功的第二阶段时间线不得再被本地关键词表二次裁剪');
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
const gptCompactedSource = WorldStateMachine.Engine._test.compactGptSourceChronicle(source).source;
assert.equal(gptCompactedSource.character.description, source.character.description, 'GPT读取不得截短char资料卡');
assert.equal(gptCompactedSource.persona, source.persona, 'GPT读取不得截短user资料卡');
assert.equal(gptCompactedSource.worldbooks[0].entries[0].content, source.worldbooks[0].entries[0].content, 'GPT读取不得截短世界书正文');
const prepared = WorldStateMachine.Engine._test.prepareSourceForStateRequests(source, { plannerPrompt, payload });
assert.equal(prepared.large, true);
assert.ok(prepared.originalChars > 100000, `expected a genuinely large source, got ${prepared.originalChars}`);
assert.ok(prepared.batches.length >= 2 && prepared.batches.every((batch) => batch.length > 0));
assert.ok(prepared.batches.length <= 2, 'Gemini/default complete read must stay within two requests');
assert.equal(prepared.batches[0].some((item) => ['chat-message','chat-chronicle-block'].includes(item.kind)), false, 'request A must contain only worldbook/cards/static sources');
assert.equal(prepared.batches[1].some((item) => ['chat-message','chat-chronicle-block'].includes(item.kind)), true, 'request B must own the meow_FM chronology');
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
assert.ok(calls[0].payload.outputForm.modules.schedules.fields.includes('preconditions[]'), '实际API请求必须携带逐模块填空合同');
assert.match(calls[0].payload.moduleOwnership.schedules, /明确承诺|约定/, '实际API请求必须携带模块唯一归属规则');
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
assert.equal(result.state.events.length, 0, '时间线不得被代码自动复制为世界事件');
assert.equal(result.state.triggers[0].title, '等待来电');
assert.equal(result.state.threads[0].title, '旧约仍未说开');
assert.equal(result.state.processes[0].title, '公司权力调整');
assert.ok(result.state.timeline.some((item) => item.summary === '公司管理权完成正式交替'));
assert.equal(result.state.timeline.some((item) => item.summary === '全部资料时间线'), false, '无具体阶段含义的泛化时间线不得保留');
assert.deepEqual(result.state.tasks, [], 'omitted arrays must be filled locally');
assert.equal(calls.length, prepared.batches.length);
assert.ok(calls.every((call) => call.payload.task === 'SOURCE_READ_SEQUENTIAL_BATCH'));
assert.equal(calls[0].payload.semanticStage, 'SOURCE_COMPILE_EXACT');
assert.equal(calls[1].payload.semanticStage, 'INDEPENDENT_REASONING_AND_SIMULATION');
assert.equal(calls[0].payload.sourceRecords.some((item) => ['chat-message','chat-chronicle-block'].includes(item.kind)), true, '请求A必须一次拿到全部聊天与稳定资料');
assert.equal(calls[1].payload.sourceRecords.length, 0, '请求B只基于请求A结果推演，不重读原文');
assert.ok(calls[1].payload.sourceCompile?.worldRules?.length, 'Gemini/default request B must receive request A as a source compile table');
assert.ok(calls[1].payload.currentState, 'Gemini/default request B must receive the pre-tick state');
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
assert.ok(calls[1].payload.sourceCompile?.canon?.includes('请求 A 已逐项读取'), 'GPT request B must receive request A as a source compile table');
assert.equal(calls[0].payload.semanticStage, 'SOURCE_COMPILE_EXACT');
assert.equal(calls[1].payload.semanticStage, 'INDEPENDENT_REASONING_AND_SIMULATION');
assert.equal(gptResult.state.world.location.current, '测试地点', 'latest GPT scene must override stale chronology');
assert.match(gptResult.state.world.time.display, /第821日/, 'GPT current time must come from the latest assistant memory');
assert.equal(gptResult.state.characters.some((item) => /^[{["']/.test(item.name)), false, 'malformed structured strings must not create pseudo-character names');
assert.equal(calls[1].payload.stateSchema, undefined, 'request B must not resend the verbose state schema');
assert.equal(calls[1].payload.stateShape, undefined, 'request B only returns merged evidence; state hydration is local');
assert.ok(calls[1].payload.currentState, 'request B must receive the pre-tick state for lifecycle adjudication');
assert.ok(calls.every((call) => call.options.singleAttempt === true));
assert.equal(calls.reduce((sum, call) => sum + call.payload.sourceRecords.length, 0), hugePreparedGpt.sentRecords);
const progress = WorldStateMachine.Engine.getProgress();
assert.match(progress.steps.map((step) => `${step.message} ${step.details}`).join('\n'), /第一步：一次性提取全部资料栏目.*API 1 次/);
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
assert.equal(calls.length, 2, 'a small source must also use compile + tick as exactly two semantic requests');
assert.equal(calls[0].payload.semanticStage, 'SOURCE_COMPILE_EXACT');
assert.equal(calls[1].payload.semanticStage, 'INDEPENDENT_REASONING_AND_SIMULATION');
assert.equal(calls[0].options.jsonContract, 'evidence');
assert.equal(smallResult.state.world.location.current, '资料室');
assert.equal(smallResult.state.world.location.weather, '炎热');
assert.equal(smallResult.state.worldRules[0].statement, '进入资料室必须登记');
assert.ok(smallResult.state.timeline.some((item) => /资料室.*重大事故/.test(item.summary)), 'Gemini/default 模式必须保留合格重大历史节点');
assert.equal(smallResult.state.processes.length, 0, '个人整理动作不得从剧情推进线回填成世界进程');

const normalComplete = WorldStateMachine.Api.complete;
const recoveryCalls = [];
WorldStateMachine.Api.complete = async (_prompt, request) => {
    recoveryCalls.push(request);
    if (request.sourceBatchIndex === 1) throw new Error('Planner API 后端转发失败 502');
    return { evidence: completeEvidence({
        sourceRefs: request.sourceRecords.map((item) => item.ref),
        canon: ['恢复请求已读取第一批与第二批'],
        characters: [{ id: 'recovered', name: '恢复人物', identity: '完整身份', sourceRefs: ['recover-a'] }],
        currentScene: [{ location: '恢复地点', sourceRefs: ['recover-b'] }],
    }) };
};
const recoveryPrepared = {
    large: true, gptMode: true, localEvidence: completeEvidence(), originalChars: 64123, includedChars: 32123,
    records: 2, sentRecords: 2, batches: [
        [{ ref: 'recover-a', kind: 'test', serializedJson: '{"half":"A"}' }],
        [{ ref: 'recover-b', kind: 'test', serializedJson: '{"half":"B"}' }],
    ],
    batchChars: [32, 32], progressFragments: [1, 1], gptRecentRefs: ['recover-a','recover-b'], gptLatestRefs: ['recover-b'],
};
await assert.rejects(() => WorldStateMachine.Engine._test.buildStateWithinLimit(
    plannerPrompt, { ...payload, source: null }, payload.currentState,
    { ...settings, gptMode: true }, undefined, recoveryPrepared,
), /502/);
assert.equal(recoveryCalls.length, 1, '第一次全量提取失败必须立即终止');
assert.equal(recoveryPrepared.requestAttempts, 1);

const geminiRecoveryCalls = [];
WorldStateMachine.Api.complete = async (_prompt, request) => {
    geminiRecoveryCalls.push(request);
    if (request.sourceBatchIndex === 1) throw new Error('Planner API 后端转发失败 502');
    return { evidence: completeEvidence({
        sourceRefs: request.sourceRecords.map((item) => item.ref),
        canon: ['Gemini 恢复请求已读取两批'],
        characters: [{ id: 'gemini-recovered', name: 'Gemini恢复人物', identity: '完整身份', sourceRefs: ['gemini-a'] }],
        currentScene: [{ location: 'Gemini恢复地点', sourceRefs: ['gemini-b'] }],
    }) };
};
const geminiRecoveryPrepared = {
    ...recoveryPrepared, gptMode: false, originalChars: 74123, includedChars: 42123,
    batches: [
        [{ ref: 'gemini-a', kind: 'test', serializedJson: '{"half":"A"}' }],
        [{ ref: 'gemini-b', kind: 'test', serializedJson: '{"half":"B"}' }],
    ],
};
await assert.rejects(() => WorldStateMachine.Engine._test.buildStateWithinLimit(
    plannerPrompt, { ...payload, source: null }, payload.currentState,
    { ...settings, gptMode: false }, undefined, geminiRecoveryPrepared,
), /502/);
assert.equal(geminiRecoveryCalls.length, 1, '第一次全量提取失败必须立即终止，不能让推演请求兼任补读');

const partialCalls = [];
WorldStateMachine.Api.complete = async (_prompt, request) => {
    partialCalls.push(request);
    if (request.sourceBatchIndex === 1) return { evidence: completeEvidence({
        sourceRefs: ['partial-a'], canon: ['第一批完整'],
        worldRules: [{ id: 'compiled-rule', statement: '进入内城必须持有通行许可', sourceRefs: ['partial-a'], truthStatus: 'confirmed' }],
    }) };
    return { evidence: { sourceRefs: ['partial-b'], currentScene: [{ location: '新场景', sourceRefs: ['partial-b'] }] } };
};
const partialBase = WorldStateMachine.Defaults.createState();
partialBase.initialized = true;
partialBase.tasks = [{ id: 'keep-task', title: '必须保留的旧任务', status: 'active' }];
partialBase.organizations = [{ id: 'old-org', name: '旧组织', kind: 'faction', situation: '仍在活动' }];
const storageBeforePartial = WorldStateMachine.Storage;
WorldStateMachine.Storage = { ...(storageBeforePartial || {}), clone: (value) => JSON.parse(JSON.stringify(value)) };
const partialPrepared = {
    large: true, gptMode: true, localEvidence: completeEvidence({
        tasks: [{ id: 'local-task', title: '原文可确定的新任务', description: '前往新场景核验线索', status: 'active', sourceRefs: ['partial-b'], truthStatus: 'confirmed' }],
        organizations: [{ id: 'local-org', name: '兴州王府', kind: 'dynastic', situation: '被禁军接管', sourceRefs: ['partial-b'], truthStatus: 'confirmed', priority: 'L2', activity: 'WARM' }],
    }), originalChars: 65124, includedChars: 33124,
    records: 2, sentRecords: 2, batches: [
        [{ ref: 'partial-a', kind: 'test', serializedJson: '{"half":"A"}' }],
        [{ ref: 'partial-b', kind: 'test', serializedJson: '{"half":"B"}' }],
    ],
    batchChars: [33, 33], progressFragments: [1, 1], gptRecentRefs: ['partial-a','partial-b'], gptLatestRefs: ['partial-b'],
};
const partialResult = await WorldStateMachine.Engine._test.buildStateWithinLimit(
    plannerPrompt, { ...payload, source: null }, partialBase,
    { ...settings, gptMode: true }, undefined, partialPrepared,
);
assert.equal(partialCalls.length, 2, '第二步漏栏也不得产生第三次调用');
assert.ok(partialResult.state.tasks.some((item) => item.title === '必须保留的旧任务'), 'an unreturned final module must retain the previous state instead of becoming empty');
assert.ok(partialResult.state.tasks.some((item) => item.title === '原文可确定的新任务'), 'an unreturned final module must also retain deterministic local evidence');
assert.ok(partialResult.state.organizations.some((item) => item.name === '旧组织'), 'an unreturned organization module must retain old state');
assert.ok(partialResult.state.organizations.some((item) => item.name === '兴州王府'), 'an unreturned organization module must retain deterministic local extraction');
assert.ok(partialResult.state.worldRules.some((item) => item.statement === '进入内城必须持有通行许可'), 'a field omitted by final request B must fall back to request A source compilation');
assert.equal(partialPrepared.incompleteEvidenceKeys.includes('tasks'), true);
assert.equal(partialPrepared.reportedIncompleteEvidenceKeys.includes('processes'), false, 'request A explicitly audited an empty module, so request B may omit its empty array without a false retrieval-failed warning');
WorldStateMachine.Storage = storageBeforePartial;
WorldStateMachine.Api.complete = normalComplete;

const oversizedPreviousBodyState = WorldStateMachine.Defaults.createState();
oversizedPreviousBodyState.worldRules = Array.from({ length: 30 }, (_, index) => ({ id: `rule-${index}`, statement: `稳定规则${index}${'很长'.repeat(240)}` }));
oversizedPreviousBodyState.characters = Array.from({ length: 30 }, (_, index) => ({ id: `person-${index}`, name: `人物${index}`, situation: `旧处境${'很长'.repeat(180)}`, activity: index < 2 ? 'HOT' : 'COLD' }));
oversizedPreviousBodyState.map = { locations: Array.from({ length: 30 }, (_, index) => ({ id: `place-${index}`, name: `地点${index}` })), routes: Array.from({ length: 30 }, (_, index) => ({ from: `place-${index}`, to: `place-${index + 1}` })) };
const compactPreviousBody = WorldStateMachine.Engine._test.compactPreviousBodyState(oversizedPreviousBodyState, { content: '人物1来到地点1。' });
assert.equal(compactPreviousBody.worldRules, undefined, 'one-floor reads must not resend stable world rules');
assert.equal(compactPreviousBody.map.routes, undefined, 'one-floor reads must not resend the complete route graph');
assert.ok(compactPreviousBody.characters.length <= 12, 'one-floor reads must cap relevant character context');
assert.ok(JSON.stringify(compactPreviousBody).length < JSON.stringify(oversizedPreviousBodyState).length / 3, 'one-floor read state should be substantially smaller than the stored state');
assert.equal(oversizedPreviousBodyState.worldRules.length, 30, 'payload compaction must not mutate stored state');

console.log('Two-pass large-source smoke tests passed');
