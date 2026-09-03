import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
globalThis.dispatchEvent = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const context = { chatMetadata: {}, name1: '测试用户', async saveChat() {} };
globalThis.SillyTavern = { getContext: () => context };

await import('../src/defaults.js');
await import('../src/facts.js');
await import('../src/settings.js');
await import('../src/storage.js');
await import('../src/dice.js');
await import('../src/injection.js');
await import('../src/engine.js');

const state = WorldStateMachine.Defaults.createState();
state.initialized = true;
state.identities.user = '测试用户';
state.world.location.current = '测试地点';
state.world.currentConditions = ['测试用户提出出发，甲答应两日后前往目的地。'];
state.characters = [
    { id: 'person-a', name: '甲', identity: '负责人', location: '测试地点', present: true },
    { id: 'user', name: '测试用户', identity: '参与者', location: '测试地点', present: true },
    { id: 'person-b', name: '乙', identity: '执行者', present: false },
];
state.relationships = [
    { id: 'old-a', from: 'character-olda', to: 'character-olduser', status: '甲与测试用户是合作伙伴关系。', truthStatus: 'confirmed' },
    { id: 'old-b', from: 'character-olda', to: '乙', status: '甲与乙是协作关系。', truthStatus: 'confirmed' },
];
state.schedules = [{ id: 'go-destination', title: '约两日后前往目的地', participantIds: ['user','person-a'], expectedTime: '约两日后', preconditions: ['完成准备工作'], status: 'agreed', truthStatus: 'confirmed' }];
state.processes = [{ id: 'done-process', title: '测试进程', status: 'resolved', currentDirection: '进程已完成', truthStatus: 'confirmed' }];
state.resourceConstraints = [{ id: 'old-limit', condition: '测试用户必须留在测试地点', status: 'satisfied', truthStatus: 'confirmed' }];
state.npcActivities = [{ id: 'bad-visible', characterId: 'person-a', action: '与测试用户继续当前对话', truthStatus: 'confirmed' }, { id: 'remote', characterId: 'person-b', action: '执行既有后台任务', truthStatus: 'confirmed' }];

const audited = WorldStateMachine.Engine._test.auditStateLifecycle(state);
assert.equal(audited.world.currentConditions.length, 0, '场景剧情摘要不得留在世界当前客观状态');
assert.equal(audited.processes.length, 0, '已完成进程必须归档');
assert.equal(audited.resourceConstraints.length, 0, '已解除约束必须移除');
assert.deepEqual(audited.npcActivities.map((item) => item.characterId), ['person-b'], '在场人物不得保留后台NPC轨迹');
assert.ok(audited.reasoningAudit.moduleDecisions.some((item) => item.operation === 'ARCHIVE'));

const migrated = WorldStateMachine.Storage._test.normalizeState({
    schemaVersion: 23, initialized: true,
    events: [
        { id: 'old-event', title: '测试事件结束', status: 'occurred', outcome: '测试事件已有结果', location: '测试地点', truthStatus: 'confirmed' },
        { id: 'live-event', title: '测试局势仍在发展', status: 'ongoing', summary: '各方仍在交涉', truthStatus: 'confirmed' },
    ],
});
assert.equal(migrated.events.length, 0, '旧世界事件字段迁移后必须清空');
assert.ok(migrated.timeline.some((item) => /测试事件已有结果/.test(item.summary)), '已结束事件必须迁入时间线');
assert.ok(migrated.processes.some((item) => /各方仍在交涉/.test(item.currentDirection)), '进行中事件必须迁入世界进程');
assert.ok(audited.relationships.every((item) => !String(item.from).startsWith('character-') && !String(item.to).startsWith('character-')), '旧随机人物引用必须按姓名对齐');
assert.ok(audited.relationships.some((item) => item.from === 'person-a' && item.to === 'user'));
assert.ok(audited.relationships.some((item) => item.from === 'user' && item.to === 'person-a'), '正式关系必须分别建立双方向记录');

const injection = WorldStateMachine.Injection.compose(audited);
assert.match(injection, /\[已有安排\]/);
assert.match(injection, /约两日后前往目的地/);
assert.doesNotMatch(injection, /测试用户提出出发/);
assert.doesNotMatch(injection, /person-|character-/);

const hydrated = WorldStateMachine.Engine._test.stateFromEvidence({
    characters: [
        { id: 'user', name: '测试用户', identity: '参与者', location: '测试地点', situation: '正在处理当前问题', sourceRefs: ['chat:10'] },
        { id: 'person-b', name: '乙', identity: '执行者', location: '远端地点', situation: '正在执行既有任务', sourceRefs: ['chat:10'] },
    ],
    npcActivities: [
        { characterId: '等我', action: '处理完手头的事情就出发', sourceRefs: ['chat:10'] },
        { characterId: 'person-b', action: '继续执行既有任务', sourceRefs: ['chat:10'] },
    ],
    schedules: [{ title: '两日后前往目的地', expectedTime: '两日后', status: 'agreed', sourceRefs: ['chat:10'] }],
    currentScene: [{ location: '测试地点', environment: '当前环境稳定', presentCharacterIds: ['user'], currentIssue: '处理当前问题', sourceRefs: ['chat:10'] }],
}, {}, WorldStateMachine.Defaults.createState()).state;
assert.equal(hydrated.characters[0].notes, '', '人物姓名或摘要不得复制成连续性摘要');
assert.deepEqual(hydrated.npcActivities.map((item) => item.characterId), ['person-b'], '台词片段不得被接受为NPC姓名');
assert.equal(hydrated.schedules.length, 1, '明确安排必须进入已有安排模块');
assert.equal(hydrated.sceneState.currentIssue, '处理当前问题', '场景状态必须独立保存当前问题');

console.log('Phantasm v0.14 lifecycle, directed relation, and schedule smoke tests passed');
