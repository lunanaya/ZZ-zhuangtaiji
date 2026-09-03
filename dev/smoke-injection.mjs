import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.extension_settings = {
    worldStateMachine: {
        plannerPrompt: '旧规则包含因果链与延迟因果',
        reconcilerPrompt: '旧结算规则',
        modulePrompts: { causalLinks: '旧因果链', causalSeeds: '旧延迟因果' },
    },
};
globalThis.CustomEvent = class CustomEvent {
    constructor(type) { this.type = type; }
};
globalThis.dispatchEvent = () => {};
const localValues = new Map();
globalThis.localStorage = {
    getItem(key) { return localValues.has(key) ? localValues.get(key) : null; },
    setItem(key, value) { localValues.set(key, String(value)); },
    removeItem(key) { localValues.delete(key); },
};
const testContext = { extensionSettings: globalThis.extension_settings, chatMetadata: {}, name1: '林知夏' };
globalThis.SillyTavern = {
    getContext() {
        return testContext;
    },
};

await import('../src/defaults.js');
await import('../src/facts.js');
await import('../src/settings.js');
await import('../src/storage.js');
await import('../src/dice.js');
await import('../src/context.js');
await import('../src/worldbook-compiler.js');
await import('../src/source-reader.js');
await import('../src/injection.js');
await import('../src/engine.js');
await import('../src/ui.js');

const runningTurnPopup = WorldStateMachine.UI._test.turnReadPopupView({ state: 'running', message: '正在读取上一轮正文' });
assert.equal(runningTurnPopup.status, '读取状态：进行中 · API 1/1');
assert.equal(runningTurnPopup.closeDelay, null, '读取进行中弹窗不得自动关闭');
const completedTurnPopup = WorldStateMachine.UI._test.turnReadPopupView({ state: 'success', message: '读取完成' });
assert.equal(completedTurnPopup.closeDelay, 450, '读取完成后弹窗必须自动关闭');

const activeChatStore = () => {
    const root = testContext.chatMetadata.worldStateMachine;
    return root?.chatStores?.[WorldStateMachine.Storage._test.currentChatKey()] || root;
};

const state = WorldStateMachine.Defaults.createState();
state.identities.user = '林知夏';
assert.equal(WorldStateMachine.UI._test.userKnowsKnowledge(state, { knownBy: ['user'] }), true);
assert.equal(WorldStateMachine.UI._test.userKnowsKnowledge(state, { knownBy: ['林知夏'] }), true, '当前用户名必须作为用户身份别名');
assert.equal(WorldStateMachine.UI._test.userKnowsKnowledge(state, { knownBy: ['char'], unknownTo: ['user'] }), false);
const hiddenActivityIntent = WorldStateMachine.UI._test.buildIntentMessage(state, 'activities', { characterId: 'char', action: '秘密前往公司', location: '秘密地点' }, 'investigate');
assert.match(hiddenActivityIntent, /尝试.*了解/);
assert.doesNotMatch(hiddenActivityIntent, /秘密前往公司|秘密地点/, 'NPC轨迹交互不得发送后台活动原文');
assert.match(hiddenActivityIntent, /不代表我已经知道状态栏中的后台信息/);
assert.equal(Object.prototype.hasOwnProperty.call(WorldStateMachine.UI._test.interactionActions, 'world'), false, '世界状态必须保持只读');
assert.equal(Object.prototype.hasOwnProperty.call(WorldStateMachine.UI._test.interactionActions, 'progression'), false, '剧情推进后台快照必须保持只读');
assert.equal(Object.keys(WorldStateMachine.Settings.get().modulePrompts).length, Object.keys(WorldStateMachine.Defaults.MODULE_PROMPTS).length);
assert.equal(WorldStateMachine.Settings.get().rulesVersion, 28);
assert.equal(Object.prototype.hasOwnProperty.call(WorldStateMachine.UI._test.interactionActions, 'map'), false, '场景地图必须保持纯本地只读展示');
assert.equal(WorldStateMachine.Settings.get().injectionModules.knowledge.enabled, true, '秘密知识边界必须能够参与统一注入');
assert.equal(WorldStateMachine.Settings.get().injectionModules.worldRules.enabled, true, '硬规则库必须默认启用');
assert.equal(WorldStateMachine.Settings.get().injectionModules.resourceConstraints.enabled, true, '资源与硬约束必须默认参与行动可行性检查');
assert.match(WorldStateMachine.Settings.get().modulePrompts.resourceConstraints, /不得凭空生成钱、人手、交通、门卡、许可或物品/);
assert.equal(WorldStateMachine.UI._test.intentPanel('map', { id: 'hq', name: '夏氏集团总部' }, ['travel']), '', '地图不得生成发送给正文AI的交互按钮');
const questOptions = WorldStateMachine.UI._test.dynamicIntentOptions('tasks', {
    id: 'restore-crown', title: '复兴皇权', questType: 'main', actionOptions: [
        { id: 'court-support', label: '争取朝臣支持', intent: '我准备先与能够接触的朝臣商议复兴皇权。', description: '从现有政治关系入手' },
    ],
});
assert.equal(questOptions[0].label, '争取朝臣支持');
assert.match(WorldStateMachine.UI._test.buildIntentMessage(state, 'tasks', { id: 'restore-crown', title: '复兴皇权', actionOptions: questOptions }, 'court-support'), /与能够接触的朝臣商议/);
assert.equal(WorldStateMachine.UI._test.interactionActions.tasks.length, 0, '任务不得再使用固定关注/介入/调查模板');
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /时间线、世界进程与因果影响/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /实际 user\/assistant 正文/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /剧情压力与空转侦测器/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /Phantasm 世界运作逻辑（最高优先级）/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /LOAD → PARSE → ADJUDICATE → ADVANCE → COMMIT/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /有效变化点/);
assert.match(WorldStateMachine.Settings.get().reconcilerPrompt, /Phantasm 世界运作逻辑（最高优先级）/);
assert.match(WorldStateMachine.Settings.get().reconcilerPrompt, /不是可选择的模式/);
assert.match(WorldStateMachine.Settings.get().promptMigrationBackup.plannerPrompt, /因果链与延迟因果/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.relationships, /禁止.*评分/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.characters, /persistentConditions.*恢复逻辑/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.npcActivities, /每人只保留一条/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.knowledge, /L1普通、L2重要、L3核心/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.tasks, /主线与支线目标/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.triggers, /剧情扣子/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.threads, /世界不依赖用户也会演变.*process/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.processes, /即使用户角色不参与/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /同一条信息只能有一个“主归属模块”/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.causalEffects, /动机、能力、机会/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.planner, /停滞/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.planner, /sourceType/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.planner, /一轮最多一个变化点/);
assert.equal('scenePressure' in WorldStateMachine.Settings.get().modulePrompts, false);
assert.equal('actorCausality' in WorldStateMachine.Settings.get().modulePrompts, false);
assert.equal('backgroundQueue' in WorldStateMachine.Settings.get().modulePrompts, false);
assert.equal('advanceScheduler' in WorldStateMachine.Settings.get().modulePrompts, false);
assert.equal(state.world.time.display, '');
assert.equal(state.world.season, '');
assert.deepEqual(state.world.currentConditions, []);
assert.deepEqual(state.factAnchors, []);
assert.deepEqual(state.resourceConstraints, []);
assert.equal(state.world.location.current, '');
assert.deepEqual(state.characters, []);
assert.deepEqual(state.npcActivities, []);
const retentionState = WorldStateMachine.Defaults.createState();
retentionState.resourceConstraints = [
    { id: 'gate-card', subjectId: 'user', kind: 'access', condition: '当前没有禁区门卡', status: 'active', consequence: '不能直接进入禁区', priority: 'L2', activity: 'HOT', truthStatus: 'confirmed', sourceRefs: ['chat:gate-card'] },
    { id: 'old-blockade', subjectId: 'palace', kind: 'blockade', condition: '旧封锁', status: 'expired', priority: 'L1', activity: 'COLD' },
];
retentionState.knowledge = [
    ...Array.from({ length: 45 }, (_, index) => ({ id: `core-knowledge-${index}`, information: `核心知识${index}`, priority: 'L3', truthStatus: 'confirmed', sourceRefs: [`worldbook:core:${index}`] })),
    ...Array.from({ length: 10 }, (_, index) => ({ id: `ordinary-knowledge-${index}`, information: `普通知识${index}`, priority: 'L1' })),
];
retentionState.npcActivities = [
    { id: 'old-activity', characterId: 'char', action: '旧活动' },
    { id: 'current-activity', characterId: 'char', action: '当前活动' },
    { id: 'json-activity', characterId: 'emperor', action: '{"location":"漱玉殿","participants":["夏寻樨","夏以昼"],"time":"戌初","activity":"步入宴会厅"}' },
];
WorldStateMachine.Storage._test.compactState(retentionState);
assert.equal(retentionState.resourceConstraints.length, 1, '失效约束必须移除，只保留当前版本');
assert.match(WorldStateMachine.Injection.fallbackBlocks(retentionState).resourceConstraints, /没有禁区门卡.*不能直接进入禁区/);
assert.equal(retentionState.knowledge.filter((item) => item.priority === 'L3').length, 45, 'L3核心知识不得因容量自动删除');
assert.equal(retentionState.npcActivities.find((item) => item.characterId === 'char')?.action, '当前活动', '每个NPC只保留当前活动快照');
const invalidCardState = WorldStateMachine.Defaults.createState();
invalidCardState.tasks = [{ id: 'empty-task', title: '无。', ownerIds: ['user'], status: 'active' }];
invalidCardState.relationships = [
    { id: 'blank-relation', from: '', to: '', status: '', priority: 'L3', activity: 'HOT' },
    { id: 'valid-relation', from: 'user', to: 'char', status: '彼此信任但仍有分歧', priority: 'L2', activity: 'HOT' },
    { id: 'duplicate-relation', from: 'user', to: 'char', status: '彼此信任但仍有分歧（当前版本）', priority: 'L2', activity: 'HOT' },
];
invalidCardState.npcActivities = [{ id: 'blank-activity', characterId: 'char', action: '' }];
WorldStateMachine.Storage._test.compactState(invalidCardState);
assert.deepEqual(invalidCardState.tasks, [], '“无。”不得被保存成当前任务卡');
assert.equal(invalidCardState.relationships.length, 1, '初始化或更新产生的空关系卡与同对象旧版本必须被程序清理');
assert.equal(invalidCardState.relationships[0].id, 'duplicate-relation');
assert.deepEqual(invalidCardState.npcActivities, [], '缺少实际活动的半成品不得形成卡片');
assert.match(WorldStateMachine.UI._test.displayValue('{"location":"漱玉殿","participants":["夏寻樨","夏以昼"],"time":"戌初","activity":"步入宴会厅"}{"location":"漱玉园","activity":"提前离席"}'), /地点：漱玉殿.*相关人物：夏寻樨、夏以昼.*发生的事：步入宴会厅.*地点：漱玉园.*发生的事：提前离席/);
assert.doesNotMatch(WorldStateMachine.UI._test.displayValue('{"location":"漱玉殿","activity":"步入宴会厅"}'), /[{}\[\]"]/);
const deltaBase = WorldStateMachine.Defaults.createState();
deltaBase.revision = 7;
deltaBase.tasks = [{ id: 'gallery', title: '开设画廊', priority: 'L2', status: 'active', progress: '寻找铺面' }];
deltaBase.relationships = [{ id: 'rel', from: 'user', to: 'char', priority: 'L3', status: '长期亲密' }];
deltaBase.timeline = [{ id: 'temporary', priority: 'L1', summary: '已结束' }];
const keptDelta = WorldStateMachine.Engine._test.applyStateDelta(deltaBase, { statePatch: {}, collectionOps: [] });
assert.deepEqual(keptDelta.tasks, deltaBase.tasks, '空增量必须完整KEEP');
const changedDelta = WorldStateMachine.Engine._test.applyStateDelta(deltaBase, {
    statePatch: {
        world: { location: { current: '临江路铺面' } },
        progression: { direction: '画廊线从取得铺面转向实际筹备', currentMovement: '铺面问题已经解决', nextRequiredChanges: ['由用户决定是否开始装修'], basedOnRefs: ['task:gallery'], blockedByDecision: '是否开始装修' },
    },
    collectionOps: [
        { module: 'tasks', op: 'update', id: 'gallery', value: { progress: '已取得铺面，计划书已提交' } },
        { module: 'timeline', op: 'remove', id: 'temporary' },
    ],
});
assert.equal(changedDelta.tasks.length, 1);
assert.equal(changedDelta.tasks[0].progress, '已取得铺面，计划书已提交');
assert.equal(changedDelta.tasks[0].title, '开设画廊');
assert.equal(changedDelta.relationships[0].status, '长期亲密', '未变化模块不得被重写');
assert.equal(changedDelta.timeline.length, 0);
assert.equal(changedDelta.world.location.current, '临江路铺面');
assert.equal(changedDelta.progression.direction, '画廊线从取得铺面转向实际筹备');
assert.equal(changedDelta.progression.activity, 'HOT', '剧情推进发生实质变化时应自动升温');
assert.equal(changedDelta.progression.updatedRevision, 8, '剧情推进只保存本次更新版本');
const progressionBlocks = WorldStateMachine.Injection.fallbackBlocks(changedDelta);
assert.match(progressionBlocks.progression, /当前方向：画廊线从取得铺面转向实际筹备/);
assert.match(progressionBlocks.progression, /必须停在用户决策点：是否开始装修/);
const gradedInitialization = WorldStateMachine.Engine._test.stateFromEvidence({}, {
    canon: ['庞大的原始世界书设定不应复制到世界状态'],
    currentScene: [{ location: '当前客厅', summary: '当前正在客厅交谈' }, '早餐吃了面包'],
    knowledge: [
        ...Array.from({ length: 60 }, (_, index) => ({ information: `普通日常细节${index}`, priority: 'L1', activity: 'WARM' })),
        ...Array.from({ length: 50 }, (_, index) => ({ information: `核心秘密${index}`, priority: 'L3', activity: 'COLD' })),
        { information: '本轮直接提及的重要线索', priority: 'L2', activity: 'HOT' },
    ],
}, WorldStateMachine.Defaults.createState()).state;
assert.ok(gradedInitialization.knowledge.length <= 24, '大资料初始化必须在进入运行态前限量分级');
assert.equal(gradedInitialization.knowledge.some((item) => item.priority === 'L1' && item.activity === 'WARM'), false, '普通非活跃细节不进入初始化运行态');
assert.equal(gradedInitialization.knowledge.some((item) => item.information === '本轮直接提及的重要线索'), true);
assert.doesNotMatch(gradedInitialization.world.currentConditions.join('\n'), /庞大的原始世界书|早餐吃了面包/, '原始设定与饮食细节不得复制到当前客观状态');
assert.equal(gradedInitialization.world.currentConditions.some((item) => String(item).includes('当前正在客厅交谈')), false, '场景摘要不得复制到世界客观状态');
const mapFallbackInitialization = WorldStateMachine.Engine._test.stateFromEvidence({}, {
    locations: [{ id: 'zhao', name: '昭国', type: 'country', origin: '世界设定' }],
    chronology: [
        { location: '兴州行宫·漱玉殿殿前广场', participants: ['夏寻樨', '夏以昼'], activity: '两人步入宴会厅。' },
        { location: '兴州行宫·漱玉园', participants: ['夏寻樨', '夏以昼'], activity: '两人提前离开庆功宴。' },
    ],
}, WorldStateMachine.Defaults.createState()).state;
assert.equal(mapFallbackInitialization.world.location.current, '兴州行宫·漱玉园', 'currentScene缺失时应从最新明确历史地点恢复当前位置');
const normalizedMapFallback = await WorldStateMachine.Storage.save(mapFallbackInitialization, 'map-fallback-smoke');
const fallbackCountry = normalizedMapFallback.map.locations.find((item) => item.name === '昭国');
const fallbackPalace = normalizedMapFallback.map.locations.find((item) => item.name === '兴州行宫');
const fallbackGarden = normalizedMapFallback.map.locations.find((item) => item.name === '漱玉园');
assert.ok(fallbackCountry && fallbackPalace && fallbackGarden, '专用locations缺失时应从结构化历史地点补建地图');
assert.equal(fallbackPalace.parentId, fallbackCountry.id, '补建地点应归入唯一国家根节点');
assert.equal(fallbackGarden.parentId, fallbackPalace.id, '复合地点应建立建筑到内部空间的真实层级');
assert.equal(normalizedMapFallback.map.currentLocationId, fallbackGarden.id, '补建地图应同步当前地点节点');
const repairedHierarchy = [
    { id: 'country', name: '昭国', type: 'country', parentId: '' },
    { id: 'city', name: '兴州城', type: 'city', parentId: '' },
    { id: 'landmark', name: '兴州行宫', type: 'landmark', parentId: '' },
    { id: 'building', name: '漱玉殿', type: 'building', parentId: '' },
    { id: 'room', name: '宴会厅', type: 'room', parentId: '' },
];
WorldStateMachine.Storage._test.normalizeMapHierarchy(repairedHierarchy);
assert.equal(repairedHierarchy.find((item) => item.id === 'city').parentId, 'country', '城市孤儿节点应归入唯一国家');
assert.equal(repairedHierarchy.find((item) => item.id === 'landmark').parentId, 'city', '城市地标应归入城市');
assert.equal(repairedHierarchy.find((item) => item.id === 'building').parentId, 'landmark', '建筑应归入城市地标或城区');
assert.equal(repairedHierarchy.find((item) => item.id === 'room').parentId, 'building', '室内空间应归入建筑');
const gcState = WorldStateMachine.Defaults.createState();
gcState.revision = 20;
gcState.relationships = [
    { id: 'old-rel', from: 'user', to: 'char', priority: 'L2', status: '旧摘要' },
    { id: 'new-rel', from: 'user', to: 'char', priority: 'L2', status: '当前摘要' },
    { id: 'expired-rel', from: 'char', to: 'npc', priority: 'L1', status: '临时印象', updatedRevision: 2 },
    ...Array.from({ length: 35 }, (_, index) => ({ id: `l3-rel-${index}`, from: `a${index}`, to: `b${index}`, priority: 'L3', status: '核心关系', truthStatus: 'confirmed', sourceRefs: [`chat:core-rel-${index}`] })),
];
gcState.timeline = Array.from({ length: 48 }, (_, index) => ({ id: `history-${index}`, summary: `历史节点${index}`, priority: 'L1' }));
WorldStateMachine.Storage._test.compactState(gcState);
assert.equal(gcState.relationships.some((item) => item.status === '旧摘要'), false, '同一关系只能保留当前摘要');
assert.equal(gcState.relationships.some((item) => item.id === 'expired-rel'), false, '长期未更新的L1应被消费');
assert.equal(gcState.relationships.filter((item) => item.priority === 'L3').length, 35, 'L3不得被硬上限删除');
assert.ok(gcState.timeline.length <= 24);
assert.ok(gcState.timeline.some((item) => item.granularity === 'phase'), '较早时间线应降低分辨率');
const heatState = WorldStateMachine.Defaults.createState();
heatState.revision = 20;
heatState.characters = [{ id: 'user', name: '用户', present: true, priority: 'L3', activity: 'HOT', updatedRevision: 20 }];
heatState.knowledge = [
    { id: 'cold-core', information: '某人的真实身份是卧底', priority: 'L3', activity: 'COLD', knownBy: ['user'], updatedRevision: 1, truthStatus: 'confirmed', sourceRefs: ['worldbook:cold-core'] },
    { id: 'aged-core', information: '久未调用的核心秘密', priority: 'L3', activity: 'HOT', knownBy: ['other'], updatedRevision: 1, truthStatus: 'confirmed', sourceRefs: ['worldbook:aged-core'] },
    { id: 'warm-core', information: '与当前人物有关的重要旧事实', priority: 'L3', activity: 'WARM', knownBy: ['user'], updatedRevision: 18, truthStatus: 'confirmed', sourceRefs: ['worldbook:warm-core'] },
    { id: 'temporary-breakfast', information: '早餐吃了面包', priority: 'L1', activity: 'COLD', updatedRevision: 1 },
];
WorldStateMachine.Storage._test.compactState(heatState);
assert.equal(heatState.knowledge.some((item) => item.id === 'cold-core'), true, 'L3+COLD必须保留在记忆中');
assert.equal(heatState.knowledge.find((item) => item.id === 'aged-core')?.activity, 'COLD', '长期未命中的HOT应自然降温');
assert.equal(heatState.knowledge.some((item) => item.id === 'temporary-breakfast'), false, 'L1+COLD应快速淘汰');
const heatBlocks = WorldStateMachine.Injection.fallbackBlocks(heatState);
assert.doesNotMatch(heatBlocks.knowledge, /卧底|久未调用/, 'COLD核心记忆不得常驻注入');
assert.match(heatBlocks.knowledge, /与当前人物有关的重要旧事实/, '少量与当前人物直接相关的WARM核心记忆可以注入');
const reheated = WorldStateMachine.Engine._test.applyStateDelta(heatState, {
    collectionOps: [{ module: 'knowledge', op: 'update', id: 'cold-core', value: { source: '本轮正文重新提及' } }],
});
assert.equal(reheated.knowledge.find((item) => item.id === 'cold-core')?.activity, 'HOT', '正文更新条目时应自动升温');
const taskBase = { ...heatState, tasks: [{ id: 'audit-task', title: '核验档案', status: 'active', completionConditions: ['取得档案', '核验来源'], completedConditions: [] }] };
const prematureDone = WorldStateMachine.Engine._test.applyStateDelta(taskBase, {
    collectionOps: [{ module: 'tasks', op: 'update', id: 'audit-task', value: { status: 'done', completedConditions: ['取得档案'] } }],
});
assert.equal(prematureDone.tasks[0].status, 'active', '完成条件未逐项满足时程序必须拒绝任务done');
const verifiedDone = WorldStateMachine.Engine._test.applyStateDelta(taskBase, {
    collectionOps: [{ module: 'tasks', op: 'replace', id: 'audit-task', value: { id: 'audit-task', title: '核验档案', status: 'done', completionConditions: ['取得档案', '核验来源'], completedConditions: ['取得档案', '核验来源'] } }],
});
assert.equal(verifiedDone.tasks[0].status, 'done', '所有完成条件逐项核验后才允许任务done');
assert.equal(WorldStateMachine.Defaults.INJECTION_MODULES.ambient.enabled, true);
assert.equal(WorldStateMachine.Settings.get().blockOnPlannerError, false);
assert.equal(WorldStateMachine.Settings.get().apiProfiles.length, 1);
assert.equal(WorldStateMachine.Settings.get().activeApiProfileId, 'api-default');
assert.equal(WorldStateMachine.Settings.get().followTavernFont, true);
assert.equal(WorldStateMachine.Settings.get().fontScale, 0.9);
assert.deepEqual(WorldStateMachine.Settings.get().storyPacing, { mode: 'off', allowSceneTransition: false, allowTimeSkip: false });
assert.equal(WorldStateMachine.Engine._test.plannerAvailable({ useTavernApi: true }), false);
testContext.generateRaw = async () => '{"ok":true}';
assert.equal(WorldStateMachine.Engine._test.plannerAvailable({ useTavernApi: true }), true);
delete testContext.generateRaw;
assert.equal(WorldStateMachine.Engine._test.plannerAvailable({ useTavernApi: false, endpoint: 'https://example.test/v1' }), true);
assert.equal(WorldStateMachine.Engine._test.activeChatAvailable(), false);
let registeredPromptArgs = null;
let registeredPromptCalls = [];
testContext.setExtensionPrompt = (...args) => { registeredPromptArgs = args; registeredPromptCalls.push(args); };
WorldStateMachine.Settings.update({ enabled: true, useTavernApi: true });
await WorldStateMachine.Engine._test.setPrompt({ 0: 'DEPTH-0-MARKER', 4: 'DEPTH-4-MARKER' });
assert.ok(registeredPromptCalls.some((args) => args[0] === 'WORLD_STATE_MACHINE_CONTEXT_DEPTH_0' && args[1] === 'DEPTH-0-MARKER' && args[3] === 0));
assert.ok(registeredPromptCalls.some((args) => args[0] === 'WORLD_STATE_MACHINE_CONTEXT_DEPTH_4' && args[1] === 'DEPTH-4-MARKER' && args[3] === 4));
const outboundChat = [{ role: 'user', content: '本轮正文请求' }];
await WorldStateMachine.Engine.interceptor(outboundChat, 8192, () => {}, 'normal');
assert.equal(outboundChat.length, 1);
assert.doesNotMatch(JSON.stringify(outboundChat), /<WORLD_STATE>/);
assert.equal(registeredPromptArgs[1], '');
const quotedTagChat = [{ role: 'user', content: '正文只是引用 <WORLD_STATE> 标签' }];
registeredPromptArgs = null;
await WorldStateMachine.Engine.interceptor(quotedTagChat, 8192, () => {}, 'normal');
assert.equal(quotedTagChat.length, 1);
assert.equal(registeredPromptArgs[1], '');
assert.equal(WorldStateMachine.Settings.get().autoInitialize, false);
WorldStateMachine.Settings.update({ enabled: false });
await WorldStateMachine.Engine.interceptor(outboundChat, 8192, () => {}, 'normal');
assert.equal(registeredPromptArgs[1], '');
WorldStateMachine.Settings.update({ enabled: true });
state.identities = { user: '林知夏', char: '夏以昼' };
state.world.time.display = '周二 14:30';
state.world.time.truthStatus = 'confirmed';
state.world.location.current = '夏家·客厅';
state.world.location.currentMeta = { truthStatus: 'confirmed', basis: ['测试正文'], sourceRefs: ['chat:now'] };
state.world.currentConditions = ['双方的交流仍然平稳'];
state.world.currentConditionDetails = [{ value: '双方的交流仍然平稳', truthStatus: 'confirmed', basis: ['测试正文'], sourceRefs: ['chat:now'] }];
state.map = {
    currentLocationId: 'living',
    locations: [{ id: 'living', name: '夏家·客厅', area: '夏家', status: 'visited' }, { id: 'entry', name: '夏家·玄关', area: '夏家', status: 'known' }],
    routes: [{ from: 'living', to: 'entry', description: '穿过短廊', status: 'open' }],
};
state.characters = [
    { id: 'user', name: 'user', present: true, location: '夏家·客厅' },
    { id: 'char', name: 'char', present: true, location: '夏家·客厅' },
];
state.relationships = [{ from: 'user', to: 'char', status: '相互试探' }];
state.npcActivities = [{ characterId: 'char', movement: '从书房前往客厅', location: '夏家·客厅', action: '整理会议文件，准备16:00公司会议' }];
state.factAnchors = [
    { id: 'anchor-cold', fact: '夏砚知已经取得临江路商铺', priority: 'L3', activity: 'COLD', truthStatus: 'confirmed', sourceRefs: ['chat:anchor-cold'] },
    { id: 'anchor-hot', fact: '夏以昼已经回国并接管集团总部事务', priority: 'L3', activity: 'HOT', truthStatus: 'confirmed', sourceRefs: ['chat:anchor-hot'] },
];

const result = WorldStateMachine.Injection.compose(state);
const mapMarkup = WorldStateMachine.UI._test.renderMapForTest(state);
assert.match(mapMarkup, /wsm-map-list/, '地图应只渲染纯文字层级');
assert.match(mapMarkup, /wsm-map-tree-branch/, '有下级的文字地点应使用可点击展开框');
assert.doesNotMatch(mapMarkup, /wsm-map-viewport|wsm-map-canvas|data-map-view|图例地图/, '不得再渲染图例画布或视图切换按钮');
assert.doesNotMatch(mapMarkup, /data-wsm-intent-module="map"|<button[^>]+wsm-map-node/, '地图节点必须保持只读且不生成AI交互');
assert.match(result, /\[外置状态权威\]/);
assert.match(result, /不得另行输出 <INDRS>/);
assert.equal(result.match(/16:00公司会议/g)?.length, 1);
assert.match(result, /夏以昼已经回国并接管集团总部事务/);
assert.doesNotMatch(result, /夏砚知已经取得临江路商铺/, 'COLD 事实锚点应长期保存但不常驻注入');
assert.match(result, /林知夏｜核心人物；位置：夏家·客厅（在场）/);
assert.match(result, /相关人物｜核心人物；位置：夏家·客厅（在场）/);
assert.match(result, /林知夏 → 相关人物/);
assert.match(result, /当前关系认知：相互试探/);
assert.doesNotMatch(result, /林知夏↔相关人物/, '人物关系内容必须逐方向维护，不得合并为对称关系');
assert.match(result, /相关人物：从书房前往客厅｜夏家·客厅｜整理会议文件，准备16:00公司会议/);
assert.doesNotMatch(result, /夏家·客厅 → 夏家·玄关：可通行；穿过短廊/, '地图路线不得发送给正文AI');
assert.doesNotMatch(result, /\[场景地图\]/, '场景地图必须完全留在本地');
assert.doesNotMatch(result, /\bchar→|(?:：|>)\s*char\b/i);
const depthPrompts = WorldStateMachine.Injection.composeByDepth(state, { ambientResponses: [{ actor: '邻座乘客', response: '短暂看了一眼' }] });
assert.match(depthPrompts[0], /\[外置状态权威\]/);
assert.match(depthPrompts[0], /\[环境与路人反应\]/);
assert.match(depthPrompts[1], /\[世界状态\]/);
assert.match(depthPrompts[1], /\[人物概况\]/);
assert.match(depthPrompts[2], /\[人物关系\]/);
assert.doesNotMatch(Object.values(depthPrompts).join('\n'), /\[场景地图\]/, '所有注入深度都必须排除场景地图');
assert.equal(depthPrompts[3], undefined, '没有对应内容时不应占用注入深度');
assert.match(depthPrompts[4], /\[NPC活动轨迹\]/);
assert.doesNotMatch(result, /\[剧情节奏\]/, '剧情节奏默认关闭时不得注入');
WorldStateMachine.Settings.update({ storyPacing: { mode: 'verySlow', allowSceneTransition: false, allowTimeSkip: false } });
const verySlowPacing = WorldStateMachine.Injection.compose(state);
assert.match(verySlowPacing, /\[剧情节奏\]/);
assert.match(verySlowPacing, /推进速度：极慢/);
assert.match(verySlowPacing, /速度只控制推进幅度，不控制事件强度/);
assert.match(verySlowPacing, /任何速度都不得越过用户决策点/);
assert.match(verySlowPacing, /场景切换：禁止自动切换/);
assert.match(verySlowPacing, /时间跳跃：禁止自动跳时/);
WorldStateMachine.Settings.update({ storyPacing: { mode: 'fast', allowSceneTransition: true, allowTimeSkip: true } });
const fastPacing = WorldStateMachine.Injection.compose(state);
assert.match(fastPacing, /推进速度：快速/);
assert.match(fastPacing, /场景切换：允许/);
assert.match(fastPacing, /时间跳跃：允许/);
assert.match(fastPacing, /不得替用户选择/);
assert.match(fastPacing, /不得越过用户决策点/);
WorldStateMachine.Settings.update({ storyPacing: { mode: 'off', allowSceneTransition: false, allowTimeSkip: false } });

const plannerNamed = WorldStateMachine.Injection.compose(state, {}, { planner: 'user可以继续与<char>交流' });
assert.match(plannerNamed, /林知夏可以继续与相关人物交流/);
assert.doesNotMatch(plannerNamed, /<char>|\bchar\b/i);

const renamedState = structuredClone(state);
renamedState.characters[0].name = '林知夏';
renamedState.timeline.push({ id: 'rename-check', summary: '林知夏已经完成登记' });
testContext.name1 = '夏寻樨';
WorldStateMachine.Engine._test.syncIdentities(renamedState);
assert.equal(renamedState.identities.user, '夏寻樨');
assert.equal(renamedState.characters.find((item) => item.id === 'user').name, '夏寻樨');
assert.match(renamedState.timeline.find((item) => item.id === 'rename-check').summary, /夏寻樨已经完成登记/);
assert.doesNotMatch(JSON.stringify(renamedState), /林知夏|<char>/i, '改名后旧用户名与角色占位符不得残留');
assert.equal(WorldStateMachine.Injection._test.replaceIdentityTokens('user与<char>交谈', renamedState), '夏寻樨与相关人物交谈');
testContext.name1 = '林知夏';

const fourModulePlan = WorldStateMachine.Injection.compose(state, {
    sceneAssessment: { status: 'quiet', shouldAdvance: false, intensity: 'none', evidence: ['交流仍有新内容'] },
    actorDecisions: [{ characterId: 'char', action: '继续整理文件', allowed: true }],
    backgroundQueue: [{ sourceType: 'task', sourceId: 'meeting', decision: 'carry', reason: '尚未到时间' }],
    advanceDecision: { mode: 'continue', intensity: 'none', direction: '继续当前交流', reason: '无需制造额外事件' },
});
assert.match(fourModulePlan, /本轮方向：继续当前交流/);
assert.match(fourModulePlan, /推进方式：continue；强度：none/);
assert.doesNotMatch(fourModulePlan, /尚未到时间/);

const ratingFree = WorldStateMachine.Injection.compose(state, {}, { relationships: '林知夏→夏以昼：熟悉但谨慎\n亲密度：38\ntrust=42\n紧张 31%' });
assert.match(ratingFree, /相互试探/, '结构化状态模块不得被自由文本覆盖');
assert.doesNotMatch(ratingFree, /熟悉但谨慎/);
assert.doesNotMatch(ratingFree, /38|42|31%|trust=/i);

const ambient = WorldStateMachine.Injection.compose(state, {
    ambientResponses: [{ actor: '邻座乘客', response: '因两人的打闹回头看了一眼，随后继续看书' }],
});
assert.match(ambient, /\[环境与路人反应\]/);
assert.match(ambient, /邻座乘客：因两人的打闹回头看了一眼/);
assert.equal(state.characters.some((item) => item.name === '邻座乘客'), false);

const timelinePrivate = WorldStateMachine.Injection.compose(state, {}, { timeline: '不应发送给正文模型的历史记录' });
assert.doesNotMatch(timelinePrivate, /不应发送给正文模型的历史记录/);
assert.equal(Object.prototype.hasOwnProperty.call(WorldStateMachine.Defaults.INJECTION_MODULES, 'timeline'), false);

const allModulesEnabled = Object.fromEntries(Object.entries(WorldStateMachine.Defaults.INJECTION_MODULES)
    .map(([id, config]) => [id, { ...config, enabled: true }]));
WorldStateMachine.Settings.update({ injectionModules: allModulesEnabled, injectionMaxChars: 3500 });
const crowdedBlocks = Object.fromEntries(Object.keys(WorldStateMachine.Defaults.INJECTION_MODULES)
    .map((id, index) => [id, `${id}-UNIQUE-${String(index).padStart(2, '0')}-` + '内容'.repeat(180)]));
const crowdedInjection = WorldStateMachine.Injection.compose(state, {}, crowdedBlocks);
const generatedCrowded = WorldStateMachine.Injection.fallbackBlocks(state);
Object.entries(WorldStateMachine.Defaults.INJECTION_MODULES).filter(([id]) => id !== 'map' && (generatedCrowded[id] || ['ambient','planner'].includes(id))).forEach(([, config]) => {
    assert.match(crowdedInjection, new RegExp(`\\[${config.label}\\]`));
});
assert.doesNotMatch(crowdedInjection, /knowledge-UNIQUE|tasks-UNIQUE|threads-UNIQUE|processes-UNIQUE/, '空状态模块不得被自由文本强行填满');
assert.ok(crowdedInjection.length <= 3500 + '<WORLD_STATE>\n\n</WORLD_STATE>'.length);
WorldStateMachine.Settings.update({ injectionMaxChars: 500 });
const tightState = structuredClone(state);
tightState.worldRules = [{ id: 'rule-gate', factId: 'rule-gate', owner: 'worldRules', statement: '进入上层必须持有银色通行证', scope: ['黑塔上层'], conditions: ['准备进入黑塔上层'], exceptions: ['获得塔主明确许可'], delivery: 'resident', precedence: 90, truthStatus: 'confirmed', sourceRefs: ['worldbook:black-tower:p2'] }];
const tightInjection = WorldStateMachine.Injection.compose(tightState, {}, crowdedBlocks);
assert.match(tightInjection, /进入上层必须持有银色通行证/);
assert.match(tightInjection, /条件：准备进入黑塔上层/);
assert.match(tightInjection, /例外：获得塔主明确许可/);
assert.doesNotMatch(tightInjection, /进入上层必须持有银色通行证.*本模块已按预算压缩/, '硬规则、条件和例外不得按预算截断');
WorldStateMachine.Settings.update({ injectionMaxChars: 3500 });
const referencedRuleState = structuredClone(state);
referencedRuleState.worldRules = [{ id: 'rule-task-access', factId: 'rule-task-access', owner: 'worldRules', statement: '进入档案馆需要馆长许可', delivery: 'lookup', activity: 'COLD', truthStatus: 'confirmed', sourceRefs: ['worldbook:archive:p1'] }];
referencedRuleState.tasks = [{ id: 'archive-task', title: '查阅档案', status: 'active', ruleRefs: ['rule-task-access'], completionConditions: ['取得许可'] }];
assert.match(WorldStateMachine.Injection.fallbackBlocks(referencedRuleState).worldRules, /进入档案馆需要馆长许可/, '任务显式引用的COLD/lookup硬规则必须被依赖召回');

const originalStaticCatalog = WorldStateMachine.WorldbookCompiler.getStaticCatalog;
const originalActiveFacts = WorldStateMachine.WorldbookCompiler.getActiveFacts;
WorldStateMachine.WorldbookCompiler.getStaticCatalog = () => ({ facts: [
    { factId: 'knowledge-tower-key', owner: 'knowledge', statement: '银色通行证藏在旧站保险柜', delivery: 'lookup', dependencyFactIds: ['rule-tower-access'], knowledgeBoundary: { knownBy: [], believedBy: [], suspectedBy: [], misunderstoodBy: [], unknownTo: ['user'], discoveryPaths: ['调查旧站'], maturityConditions: ['找到保险柜线索'] }, sourceRefs: ['worldbook:tower:p3'] },
    { factId: 'rule-tower-access', owner: 'worldRules', statement: '进入黑塔上层需要银色通行证', delivery: 'lookup', conditions: ['准备进入上层'], exceptions: ['塔主明确许可'], sourceRefs: ['worldbook:tower:p2'] },
] });
WorldStateMachine.WorldbookCompiler.getActiveFacts = () => [];
const dependencyState = structuredClone(state);
dependencyState.tasks = [{ id: 'tower-task', title: '调查黑塔', status: 'active', knowledgeRefs: ['knowledge-tower-key'] }];
const dependencyInjection = WorldStateMachine.Injection.compose(dependencyState);
assert.match(dependencyInjection, /银色通行证藏在旧站保险柜/);
assert.match(dependencyInjection, /未知者：林知夏/);
assert.match(dependencyInjection, /进入黑塔上层需要银色通行证/);
assert.match(dependencyInjection, /例外：塔主明确许可/);
const withoutRuleOwner = { ...allModulesEnabled, worldRules: { ...allModulesEnabled.worldRules, enabled: false } };
WorldStateMachine.Settings.update({ injectionModules: withoutRuleOwner });
const fallbackOwnerInjection = WorldStateMachine.Injection.compose(dependencyState);
assert.doesNotMatch(fallbackOwnerInjection, /\[硬规则 \/ 世界秩序\]/);
assert.match(fallbackOwnerInjection, /\[世界书剩余背景\][\s\S]*进入黑塔上层需要银色通行证/, 'owner模块关闭时，必需事实必须回退到世界书而不是静默丢失');
WorldStateMachine.WorldbookCompiler.getStaticCatalog = originalStaticCatalog;
WorldStateMachine.WorldbookCompiler.getActiveFacts = originalActiveFacts;
WorldStateMachine.Settings.update({ injectionModules: allModulesEnabled });

const customModulePrompts = { ...WorldStateMachine.Settings.get().modulePrompts, world: 'WORLD-EDITABLE-PROMPT-UNIQUE' };
WorldStateMachine.Settings.update({ modulePrompts: customModulePrompts, injectionMaxChars: 12000 });
const editablePromptInjection = WorldStateMachine.Injection.compose(state);
assert.match(editablePromptInjection, /WORLD-EDITABLE-PROMPT-UNIQUE/);
WorldStateMachine.Settings.update({ injectionMaxChars: 3500 });

assert.match(WorldStateMachine.Engine._test.generationBlockReason({ blockOnPlannerError: true }, { error: 'timeout' }), /timeout/);
assert.equal(WorldStateMachine.Engine._test.generationBlockReason({ blockOnPlannerError: false }, { error: 'timeout' }), '');

assert.equal(WorldStateMachine.Settings.get().diceEnabled, false);
const diceRound = WorldStateMachine.Dice.createRound('test-turn');
assert.equal(diceRound.version, 2);
assert.equal(diceRound.shared, true);
assert.ok(diceRound.seed >= 1 && diceRound.seed <= 100);
assert.ok(diceRound.checkPool.length >= 1 && diceRound.checkPool.length <= 3);
assert.equal('intensity' in diceRound, false, '骰子不再生成剧情推进强度');
assert.equal('direction' in diceRound, false, '骰子不再生成剧情方向');
assert.equal(WorldStateMachine.Dice.outcome(1), 'critical-failure');
assert.equal(WorldStateMachine.Dice.outcome(10), 'failure');
assert.equal(WorldStateMachine.Dice.outcome(11), 'success');
assert.equal(WorldStateMachine.Dice.outcome(20), 'critical-success');
assert.doesNotMatch(WorldStateMachine.Injection.compose(state, { diceRound }), /\[共享骰池/);
WorldStateMachine.Settings.update({ diceEnabled: true });
const diceInjection = WorldStateMachine.Injection.compose(state, { diceRound });
assert.match(diceInjection, /^<WORLD_STATE>\n\[共享骰池｜可选随机源\]/);
assert.match(diceInjection, /骰子不决定剧情是否推进/);
assert.match(diceInjection, /人物关系升级、知识获得、世界状态、时间线、因果影响/);
assert.doesNotMatch(diceInjection, /剧情强度|剧情方向/);
assert.match(diceInjection, /1=大失败.*2–10=失败.*11–19=成功.*20=大成功/);
assert.match(diceInjection, /<check>\[姓名\|结果\|数字\|/);
WorldStateMachine.Settings.update({ diceEnabled: false });

testContext.chat = [
    { is_user: true, name: '林知夏', mes: '我和他在飞机上闹起来了。', send_date: 'u1' },
    { is_user: false, name: '夏以昼', mes: '<thinking>不可发送的思考</thinking><content>他笑着伸手挡住我的反击。</content><meow_FM><time>当日下午</time><plot>两人在飞机上发生争执。</plot></meow_FM><small_theater>不可发送的小剧场</small_theater>', send_date: 'a1' },
];
globalThis.selected_world_info = ['分析世界书'];
testContext.getWorldInfo = async (name) => name === '分析世界书' ? {
    entries: {
        0: { uid: 0, comment: '公共场所规则', content: '公共场所允许合乎比例的旁观者反应。', depth: 3, disable: false },
        1: { uid: 1, comment: '未勾选规则', content: '这条未勾选原文应保持原样。', disable: false },
    },
} : { entries: {} };
const source = await WorldStateMachine.Context.buildSource();
assert.equal(source.tavernTextContext.source, 'SillyTavern.getContext().chat');
assert.equal(source.tavernTextContext.includedMessages, 2);
assert.equal(source.tavernTextContext.scannedMessages, 2);
assert.equal(source.tavernTextContext.skippedWithoutMeow, 0);
assert.equal(source.tavernTextContext.readMode, 'hybrid-summary-tail');
assert.match(source.tavernTextContext.scope, /hybrid:meow_FM:latest-5-full-text/);
assert.match(source.chat[0].content, /飞机上闹起来了/);
assert.match(source.chat[1].content, /伸手挡住我的反击/);
assert.doesNotMatch(source.chat[1].content, /不可发送|small_theater|thinking|两人在飞机上发生争执/);
assert.equal(source.currentUserAction.role, 'user');
assert.match(source.latestAssistantText.content, /伸手挡住/);
assert.deepEqual(source.worldbookDiagnostics.loadedNames, ['分析世界书']);
assert.equal(source.worldbookDiagnostics.entryCounts['分析世界书'], 2);
assert.match(source.worldbooks[0].entries[0].content, /旁观者反应/);

WorldStateMachine.Settings.update({ summaryTag: 'abstract' });
testContext.chat = [
    { is_user: true, name: '林知夏', mes: '这是没有标签的用户正文。', send_date: 'u2' },
    { is_user: false, name: '夏以昼', mes: '<abstract><time>傍晚</time><plot>两人离开机场。</plot></abstract><meow_FM><plot>不应读取这一个标签。</plot></meow_FM>', send_date: 'a2' },
];
const customTagSource = await WorldStateMachine.Context.buildSource();
assert.equal(customTagSource.tavernTextContext.summaryTag, 'abstract');
assert.equal(customTagSource.tavernTextContext.readMode, 'hybrid-summary-tail');
assert.equal(customTagSource.chat.length, 2);
assert.match(customTagSource.chat[0].content, /没有标签的用户正文/);
assert.match(customTagSource.chat[1].content, /两人离开机场/);
assert.doesNotMatch(customTagSource.chat[1].content, /不应读取/);

WorldStateMachine.Settings.update({ summaryTag: 'meow_FM', recentMessages: 12, recentFullTextMessages: 5 });
testContext.chat = Array.from({ length: 8 }, (_value, index) => ({
    is_user: index % 2 === 0,
    name: index % 2 === 0 ? '林知夏' : '夏以昼',
    mes: `第${index + 1}层可见正文<meow_FM><plot>第${index + 1}层总结</plot></meow_FM>`,
    send_date: `hybrid-${index + 1}`,
}));
const hybridSource = await WorldStateMachine.Context.buildSource();
assert.equal(hybridSource.chat.length, 8);
hybridSource.chat.slice(0, 3).forEach((message, index) => {
    assert.equal(message.memoryOnly, true, `第${index + 1}个旧楼层必须只读取总结`);
    assert.match(message.content, /总结/);
    assert.doesNotMatch(message.content, /可见正文/);
});
hybridSource.chat.slice(-5).forEach((message, index) => {
    assert.equal(message.memoryOnly, false, `最近第${index + 1}个楼层必须读取正文`);
    assert.match(message.content, /可见正文/);
    assert.doesNotMatch(message.content, /总结/);
});

WorldStateMachine.Settings.update({ summaryTag: '' });
testContext.chat = [
    { is_user: true, name: '林知夏', mes: '这是没有标签的用户正文。', send_date: 'u2' },
    { is_user: false, name: '夏以昼', mes: '<abstract><time>傍晚</time><plot>两人离开机场。</plot></abstract><meow_FM><plot>不应读取这一个标签。</plot></meow_FM>', send_date: 'a2' },
];
const fullTextSource = await WorldStateMachine.Context.buildSource();
assert.equal(fullTextSource.tavernTextContext.readMode, 'full-text');
assert.equal(fullTextSource.chat.length, 2);
assert.match(fullTextSource.chat[0].content, /没有标签的用户正文/);
assert.match(fullTextSource.chat[1].content, /不应读取这一个标签/);
assert.equal(fullTextSource.currentUserAction.role, 'user');
WorldStateMachine.Settings.update({ summaryTag: 'meow_FM' });

const selectedKey = WorldStateMachine.Context.worldbookEntryKey('分析世界书', '0');
WorldStateMachine.Settings.update({ worldbookCompiler: { enabled: true, entryKeys: [selectedKey], budget: 300, contextMessages: 8, failClosed: true } });
let worldbookRouteCalls = 0;
WorldStateMachine.Api = {
    async withCallBudget(_max, _label, operation) { return operation(); },
    async complete(_system, payload) {
        if (payload.task === 'WORLDBOOK_COMPILE_ONCE') return { entries: payload.entries.map((entry) => ({ key: entry.key, core: ['公共场景中只允许合乎比例的旁观者反应'], triggers: ['公共场景'], rules: [], background: [] })) };
        if (payload.task === 'WORLDBOOK_ROUTE_ONCE') { worldbookRouteCalls += 1; return { text: '公共场景中只允许合乎比例的旁观者反应', byDepth: { 3: '公共场景中只允许合乎比例的旁观者反应' } }; }
        throw new Error('unexpected task');
    },
};
const plannerSource = structuredClone(source);
const compiledSource = await WorldStateMachine.WorldbookCompiler.processSource(plannerSource);
assert.equal(compiledSource.blocked, undefined);
assert.equal(compiledSource.report.entries[0].label, '公共场所规则');
assert.equal(compiledSource.report.entries[0].depth, 3);
assert.match(compiledSource.report.routedText, /合乎比例/);
assert.match(JSON.stringify(compiledSource.report), /公共场所允许合乎比例的旁观者反应。/);
assert.match(plannerSource.compiledWorldbookRules.text, /合乎比例/);
assert.equal(plannerSource.worldbooks.flatMap((book) => book.entries).some((entry) => entry.key === selectedKey), true);
assert.equal(plannerSource.worldbooks.flatMap((book) => book.entries).some((entry) => entry.content === '这条未勾选原文应保持原样。'), true);
assert.match(JSON.stringify(plannerSource), /公共场所允许合乎比例的旁观者反应。/);

const foregroundChat = [
    { role: 'system', content: `角色设定\n${source.worldbooks[0].entries[0].content}\n这条未勾选原文应保持原样。` },
    { role: 'user', content: '我和他在飞机上闹起来了。' },
];
registeredPromptCalls = [];
const foregroundResult = await WorldStateMachine.WorldbookCompiler.processChat(foregroundChat);
assert.equal(foregroundResult.blocked, undefined);
assert.equal(foregroundChat.some((message) => String(message.content || '').includes(source.worldbooks[0].entries[0].content)), false);
assert.equal(foregroundChat.some((message) => String(message.content || '').includes('这条未勾选原文应保持原样。')), true);
assert.equal(foregroundChat.some((message) => String(message.content || '').includes('【本轮世界书拆解规则】')), false);
assert.equal(registeredPromptCalls.some((args) => String(args[1]).includes('合乎比例')), false, '世界书不得通过第二套独立提示词重复注入');
assert.match(WorldStateMachine.Injection.preview(state), /公共场所允许合乎比例的旁观者反应/);
const injectionReport = WorldStateMachine.WorldbookCompiler.getReport();
assert.equal(injectionReport.delivery.injected, true);
assert.equal(injectionReport.delivery.removedOriginalOccurrences, 1);
assert.match(injectionReport.routedText, /合乎比例/);
assert.equal(worldbookRouteCalls, 1, '同一 user 轮次的世界书路由只能调用一次 API');
WorldStateMachine.WorldbookCompiler.updateCompiledEntry(selectedKey, { core: ['人工修改后的核心规则'], triggers: ['新触发情境'], rules: [], background: [] });
const editedReport = WorldStateMachine.WorldbookCompiler.getReport();
assert.equal(editedReport.status.state, 'edited');
assert.equal(editedReport.routedText, '');
assert.deepEqual(editedReport.entries[0].core, ['人工修改后的核心规则']);
assert.equal(editedReport.delivery, null);

testContext.chatMetadata.worldStateMachine = { state: {
    ...state,
    schemaVersion: 5,
    initialized: true,
    world: { time: { display: '2025年6月9日 15:20', iso: '', timezone: '', elapsedMinutes: 0 }, location: { current: '临空市·夏氏集团总部·总裁办公室', environment: '办公室内', weather: '' }, facts: ['夏砚知已经取得临江路商铺'] },
    map: {
        currentLocationId: 'living',
        locations: [
            { id: 'living', name: '夏家·客厅', area: '夏家', status: 'visited', description: '位于夏家一层，是当前冲突的主要发生地', origin: '夏砚知回家时首次进入。' },
            { id: 'living-copy', name: '夏家·客厅', area: '夏家', status: 'known', description: '夏家一层会客空间', origin: '重复的剧情来源不应追加。' },
            { id: 'orphan-room', name: '密谈室', parentId: '兴州行宫', status: 'known', description: '行宫内用于密谈的房间' },
        ],
        routes: [],
    },
    characters: [{ id: 'char', name: '夏以昼', status: '行动受限', injuries: ['左腿骨折'], heldItems: ['白玉佩'], lastUpdatedElapsedMinutes: 30 }],
    npcActivities: [{ characterId: 'char', at: '14:30', location: '公司', action: '开会' }],
    knowledge: [{ id: 'secret', information: '真实身份', knownBy: ['char'], concealedBy: ['char'] }],
    events: [{ id: 'legacy-event', title: '旧董事会事件', status: 'resolved', developments: ['董事公开反对投资方案'] }],
    causalEffects: [{ id: 'legacy-impact', causeRef: 'legacy-event', cause: '董事会分裂', result: '投资计划暂缓', status: 'arrived', affectedIds: ['char'] }],
    tasks: [{ id: 'pickup', title: '接机', ownerIds: ['user'], choices: ['立即接机', { id: 'later', label: '稍后接机', message: '我稍后再去接机。' }] }],
    triggers: [{ id: 'leave', conditions: [], earliestAt: '15:35', choices: [{ label: '先观察', prompt: '我先观察情况。' }] }],
    timeline: [
        { id: 'old', at: '14:20', summary: '谈话开始' },
        { id: 'palace-history', summary: '两人提前离开庆功宴', location: '兴州行宫·漱玉园' },
    ],
}, history: [] };
const migrated = WorldStateMachine.Storage.load();
assert.equal(migrated.schemaVersion, 24);
assert.equal(migrated.world.season, '未明确', '虚构地点无法确定南北半球时不得只凭月份写死季节');
assert.equal(migrated.world.seasonMeta.truthStatus, 'unknown');
assert.equal(migrated.world.location.weather, '多云');
assert.equal(migrated.world.location.weatherMeta.truthStatus, 'system_generated');
assert.deepEqual(migrated.world.currentConditions, []);
assert.equal('facts' in migrated.world, false);
const migratedLegacyAnchor = migrated.factAnchors.find((item) => item.fact === '夏砚知已经取得临江路商铺');
assert.ok(migratedLegacyAnchor);
assert.equal(migratedLegacyAnchor.priority, 'L2', '无来源的旧事实不得继续占用L3核心层');
assert.equal(migratedLegacyAnchor.truthStatus, 'unknown');
assert.equal(migratedLegacyAnchor.activity, 'COLD');
assert.equal(migrated.map.rootLabel, '大地图');
const migratedArea = migrated.map.locations.find((item) => item.name === '夏家');
assert.ok(migratedArea, '旧版area应迁移成可进入的层级节点');
assert.equal(migrated.map.locations.find((item) => item.id === 'living').parentId, migratedArea.id);
assert.equal(migrated.map.locations.filter((item) => item.name === '夏家·客厅').length, 1, '同名同父级地点必须自动合并');
assert.doesNotMatch(migrated.map.locations.find((item) => item.id === 'living').description, /冲突|主要发生地/, '地图描述不得长期保存剧情意义');
assert.equal(migrated.map.locations.find((item) => item.id === 'living').origin, '夏砚知回家时首次进入');
assert.ok(migrated.map.locations.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y)), '迁移后每个地点都应有稳定坐标');
const resolvedPalace = migrated.map.locations.find((item) => item.name === '兴州行宫');
assert.ok(resolvedPalace, '名称形式的parentId必须自动建立上级节点，避免地点成为不可见孤儿');
assert.equal(migrated.map.locations.find((item) => item.id === 'orphan-room').parentId, resolvedPalace.id);
assert.equal(migrated.map.locations.find((item) => item.name === '漱玉园')?.parentId, resolvedPalace.id, '旧REV中时间线的明确地点应在本地载入时补建地图');
const currentOffice = migrated.map.locations.find((item) => item.name === '总裁办公室');
assert.ok(currentOffice, '即使模型未返回locations，当前位置也必须自动形成地图节点');
assert.equal(migrated.map.currentLocationId, currentOffice.id);
assert.ok(migrated.map.locations.find((item) => item.name === '临空市' && !item.parentId), '当前位置层级必须从大地图根层可见');
assert.equal(migrated.runtime.needsWorldRefresh, true);
assert.equal(migrated.runtime.npcLastUpdatedElapsedMinutes.char, 30);
assert.equal('lastUpdatedElapsedMinutes' in migrated.characters[0], false);
assert.equal(migrated.characters[0].maintenanceLevel, 'core');
assert.equal(migrated.characters[0].situation, '行动受限');
assert.equal(migrated.characters[0].persistentConditions[0].name, '左腿骨折');
assert.equal(migrated.characters[0].importantItems[0].name, '白玉佩');
assert.equal('injuries' in migrated.characters[0], false);
assert.equal(migrated.knowledge[0].priority, 'L2');
assert.equal(migrated.knowledge[0].disclosure, 'confidential');
assert.equal('concealedBy' in migrated.knowledge[0], false);
assert.deepEqual(migrated.events, []);
assert.ok(migrated.timeline.some((item) => /董事公开反对投资方案/.test(item.summary)), '旧版已结束世界事件必须迁入时间线');
assert.equal(migrated.causalEffects[0].status, 'active');
assert.deepEqual(migrated.causalEffects[0].decayConditions, []);
assert.equal('at' in migrated.npcActivities[0], false);
assert.equal(migrated.npcActivities[0].movement, '');
assert.deepEqual(migrated.triggers[0].conditions, ['世界时间达到15:35']);
assert.equal('earliestAt' in migrated.triggers[0], false);
assert.equal('choices' in migrated.tasks[0], false, '旧版任务choices应迁移删除，由本地意图按钮替代');
assert.equal('choices' in migrated.triggers[0], false, '旧版触发器choices应迁移删除，由本地意图按钮替代');
assert.equal('at' in migrated.timeline[0], false);

const mapLifecycleState = WorldStateMachine.Defaults.createState();
mapLifecycleState.revision = 30;
mapLifecycleState.map.locations = [
    { id: 'city-core', name: '临空市', type: 'city', parentId: '', priority: 'L3', activity: 'COLD', updatedRevision: 0, sourceRefs: [] },
    { id: 'one-off-cafe', name: '临时咖啡馆', type: 'landmark', parentId: 'city-core', priority: 'L1', activity: 'COLD', updatedRevision: 0, sourceRefs: [] },
];
WorldStateMachine.Storage._test.compactState(mapLifecycleState);
assert.equal(mapLifecycleState.map.locations.some((item) => item.id === 'city-core'), true, 'L3核心地点必须长期保留');
assert.equal(mapLifecycleState.map.locations.some((item) => item.id === 'one-off-cafe'), false, '长期不用的L1临时地点应淘汰');

const completeInitialState = WorldStateMachine.Defaults.createState();
completeInitialState.initialized = true;
completeInitialState.identities = { user: '用户', char: '角色' };
completeInitialState.runtime.sourceSummary = { sourceRead: { mode: 'single-pass-complete-source' } };
WorldStateMachine.Storage._test.compactState(completeInitialState);
for (const module of ['worldRules','factAnchors','resourceConstraints','characters','npcActivities','relationships','knowledge','tasks','triggers','threads','processes','causalEffects','timeline']) {
    assert.deepEqual(completeInitialState[module], [], `没有证据时${module}必须保持空集合，不能生成占位卡`);
}
assert.deepEqual(completeInitialState.map.locations, [], '没有地点证据时地图必须保持空集合');
assert.doesNotMatch(WorldStateMachine.Injection.compose(completeInitialState, {}, {}), /当前没有|尚未从已读取资料中明确/, '占位状态不得注入正文AI');
completeInitialState.tasks.push({ id: 'real-task', title: '核对名单', status: 'active', priority: 'L2', activity: 'HOT' });
WorldStateMachine.Storage._test.compactState(completeInitialState);
assert.deepEqual(completeInitialState.tasks.map((item) => item.id), ['real-task'], '真实记录必须被正常保留');

testContext.chatMetadata.worldStateMachine = { state: {
    ...migrated,
    initialized: true,
    revision: 10,
    knowledge: [
        { id: 'organize-core', information: '必须保留的核心秘密', priority: 'L3', activity: 'COLD', truthStatus: 'confirmed', sourceRefs: ['worldbook:organize-core'] },
        { id: 'organize-temp-old', information: '已经冷却的早餐信息', priority: 'L1', activity: 'WARM' },
        { id: 'organize-temp-hot', information: '当前仍在使用的临时信息', priority: 'L1', activity: 'HOT', updatedRevision: 10 },
    ],
    tasks: [{ id: 'organize-active-task', title: '仍在进行的临时任务', priority: 'L1', activity: 'WARM', status: 'active' }],
}, history: [] };
const organized = await WorldStateMachine.Storage.organizeState('temporary');
assert.equal(organized.state.revision, 11, '手动整理应生成新REV');
assert.equal(organized.state.knowledge.some((item) => item.id === 'organize-core'), true, '整理不得删除L3');
assert.equal(organized.state.knowledge.some((item) => item.id === 'organize-temp-old'), false, '临时清理应移除非HOT的L1');
assert.equal(organized.state.knowledge.some((item) => item.id === 'organize-temp-hot'), true, '临时清理不得删除HOT的L1');
assert.equal(organized.state.tasks.some((item) => item.id === 'organize-active-task'), true, '临时清理不得删除仍在进行的任务');
assert.equal(WorldStateMachine.Storage.history()[0]?.kind, 'organization', '整理前必须建立可回滚快照');
assert.equal(WorldStateMachine.Storage._test.isChatGenerationSnapshot({ kind: 'generation', reason: 'pre-generation-reasoning', turnKey: '' }), true, '旧版生成节点必须能随删除楼层自动回退');
assert.equal(WorldStateMachine.Storage._test.isChatGenerationSnapshot({ kind: 'generation', reason: 'planner', turnKey: '' }), true, '无turnKey的当前规划节点必须能随删除楼层自动回退');
assert.equal(WorldStateMachine.Storage._test.isChatGenerationSnapshot({ kind: 'organization', reason: 'organize-smart', turnKey: '' }), false, '整理快照不得被删除楼层操作消耗');
assert.equal(WorldStateMachine.Storage._test.isChatGenerationSnapshot({ kind: 'generation', reason: 'initialize', turnKey: '' }), false, '初始化快照不得被删除楼层操作消耗');
await WorldStateMachine.Storage.rollbackPreviousGeneration();
assert.equal(WorldStateMachine.Storage.load().knowledge.some((item) => item.id === 'organize-temp-old'), true, '回滚应恢复整理前状态');

const legacyRollbackBox = activeChatStore();
const legacyRollbackTarget = structuredClone(legacyRollbackBox.state);
legacyRollbackTarget.revision = 12;
legacyRollbackTarget.world = { ...legacyRollbackTarget.world, location: { ...legacyRollbackTarget.world.location, current: '删除前节点' } };
legacyRollbackBox.state = { ...structuredClone(legacyRollbackTarget), revision: 20, runtime: { ...legacyRollbackTarget.runtime, lastReadFloor: 19, lastPreviousBodyFloor: 19, lastPreviousBodyMessageId: 'assistant-19' }, world: { ...legacyRollbackTarget.world, location: { ...legacyRollbackTarget.world.location, current: '删除后节点' } } };
legacyRollbackBox.history = [{ kind: 'generation', reason: 'pre-generation-reasoning', turnKey: '', state: legacyRollbackTarget }];
const legacyRollbackResult = await WorldStateMachine.Storage.rollbackGenerations(1);
assert.equal(legacyRollbackResult.rolledBack, 1, '删除楼层必须实际消费旧版生成节点');
assert.equal(WorldStateMachine.Storage.load().world.location.current, '删除前节点', '删除楼层必须恢复旧版快照中的上一节点');
assert.equal(WorldStateMachine.Storage.load().runtime.lastReadFloor, 19, '删除楼层回退状态时不得清除正文读取楼层标记');

testContext.generateRaw = async () => '{"ok":true}';
testContext.chat = [
    { is_user: true, name: '林知夏', mes: '我停止打闹，坐回座位。', send_date: 'u2' },
    { is_user: false, name: '夏以昼', mes: '<content>他替我系好安全带。</content><meow_FM><time>当日下午</time><plot>林知夏停止打闹并坐回座位，夏以昼替她系好安全带。</plot></meow_FM>', send_date: 'a2' },
];
activeChatStore().state = {
    ...migrated, initialized: true, planner: { turnKey: 'u2:test', plan: {}, moduleInjections: {}, injection: '', error: '' },
    world: { ...migrated.world, time: { ...migrated.world.time, elapsedMinutes: 90 } },
    runtime: { ...migrated.runtime, lastSettledMessageId: '' },
};
const stableTriggers = WorldStateMachine.Engine._test.rotateTriggersForNextTurn(
    { triggers: [{ id: 'keep' }, { id: 'expire' }] },
    { triggers: [{ id: 'keep', status: 'armed' }, { id: 'expire', status: 'expired' }, { id: 'new', status: 'eligible' }] },
);
assert.deepEqual(stableTriggers.triggers.map((item) => item.id), ['keep', 'new'], '未触发但仍成立的候选必须保留稳定ID，只有触发/过期项移除');
let settleCalls = 0;
WorldStateMachine.Api.complete = async (_system, payload) => {
    settleCalls += 1;
    assert.equal(payload.phase, 'POST_GENERATION_RECONCILE');
    assert.match(payload.actualAssistantMessage.content, /他替我系好安全带/);
    assert.doesNotMatch(payload.actualAssistantMessage.content, /林知夏停止打闹|meow_FM/);
    assert.equal(payload.recentChat.length, 2, '结算上下文必须包含最近用户与助手正文');
    assert.equal(payload.recentChat.every((message) => message.memoryOnly === false), true, '最近五层必须作为正文而非总结发送');
    assert.ok(Array.isArray(payload.worldbookRules));
    assert.equal(payload.npcSchedule.find((item) => item.characterId === 'char')?.mode, 'background', '到达后台间隔的离屏NPC必须进入同一次结算');
    assert.equal(payload.simulationRules.allowNoSignificantChange, true);
    return {
        state: structuredClone(activeChatStore().state),
        npcUpdates: [{ characterId: 'char', mode: 'background', action: '沿既有会议活动完成一次宏观检查', reason: '既有活动且后台间隔已到' }],
        worldbookEntries: [{ key: selectedKey, core: ['公共场景中只允许合乎比例的旁观者反应'], triggers: ['公共场景'], rules: [], background: [] }],
    };
};
const settled = await WorldStateMachine.Engine.settle({ force: true });
assert.equal(settleCalls, 1, '回复后普通状态与世界书必须合并为一次结算 API');
assert.equal(settled.runtime.npcLastUpdatedElapsedMinutes.char, 90, '真正执行过的后台NPC tick必须推进程序时钟');

localStorage.setItem('wsm_two_pass_first_half_cache_v3', '{"cached":true}');
localStorage.setItem('wsm_two_pass_first_half_cache_v4', '{"cached":true}');
localStorage.setItem('wsm_two_pass_first_half_cache_v5', '{"cached":true}');
localStorage.setItem('wsm_two_pass_first_half_cache_v6', '{"cached":true}');
localStorage.setItem('wsm_two_pass_first_half_cache_v9', '{"cached":true}');
assert.notEqual(localStorage.getItem('wsm_worldbook_compiler_cache_v3'), null, '清空测试前应存在世界书拆解缓存');
activeChatStore().sourceReadCache = { cached: { evidence: { currentScene: ['旧读取'] } } };
activeChatStore().historyMemory = { status: 'complete' };
await WorldStateMachine.Storage.clearAll();
assert.equal(WorldStateMachine.Storage.load().initialized, false, '彻底清空后状态必须回到未初始化');
assert.deepEqual(WorldStateMachine.Storage.load().worldRules, [], '彻底清空后硬规则状态必须为空');
assert.equal(localStorage.getItem('wsm_worldbook_compiler_cache_v3'), null, '彻底清空必须删除世界书拆解缓存键');
assert.equal(localStorage.getItem('wsm_two_pass_first_half_cache_v3'), null, '彻底清空必须删除本地两阶段读取缓存');
assert.equal(localStorage.getItem('wsm_two_pass_first_half_cache_v4'), null, '彻底清空必须删除当前GPT两阶段读取缓存');
assert.equal(localStorage.getItem('wsm_two_pass_first_half_cache_v5'), null, '彻底清空必须删除GPT覆盖式两阶段读取缓存');
assert.equal(localStorage.getItem('wsm_two_pass_first_half_cache_v6'), null, '彻底清空必须删除GPT高分辨率两阶段读取缓存');
assert.equal(localStorage.getItem('wsm_two_pass_first_half_cache_v9'), null, '彻底清空必须删除旧版证据契约缓存');
assert.equal(activeChatStore().sourceReadCache, undefined, '彻底清空必须删除聊天级读取缓存');
assert.equal(activeChatStore().historyMemory, undefined, '彻底清空必须删除历史读取记忆');
assert.deepEqual(WorldStateMachine.WorldbookCompiler.getStaticCatalog().worldRules, [], '彻底清空后静态硬规则目录必须为空');
assert.deepEqual(WorldStateMachine.WorldbookCompiler.getReport().entries, [], '彻底清空后世界书注入报告必须为空');

console.log('Injection ownership/deduplication smoke test passed.');
