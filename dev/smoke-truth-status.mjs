import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
globalThis.dispatchEvent = () => {};
const local = new Map();
globalThis.localStorage = {
    getItem: (key) => local.get(key) || null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key),
};
const ctx = { chatMetadata: {}, async saveChat() {} };
globalThis.SillyTavern = { getContext: () => ctx };

await import('../src/defaults.js');
await import('../src/storage.js');
await import('../src/injection.js');
await import('../src/engine.js');

const northern = WorldStateMachine.Defaults.createState();
northern.initialized = true;
northern.identities = { user: '用户', char: '角色' };
northern.world.time.display = '2026年12月10日 18:00';
northern.world.location.current = '中国北京';
const normalizedNorthern = WorldStateMachine.Storage._test.normalizeState(northern);
assert.equal(normalizedNorthern.world.season, '冬季');
assert.equal(normalizedNorthern.world.seasonMeta.truthStatus, 'derived');
assert.match(normalizedNorthern.world.seasonMeta.basis.join('\n'), /12月[\s\S]*北半球/);
assert.equal(normalizedNorthern.world.location.weather, '多云');
assert.equal(normalizedNorthern.world.location.weatherMeta.truthStatus, 'system_generated');
assert.notEqual(normalizedNorthern.world.time.display, '');
assert.notEqual(normalizedNorthern.world.location.environment, '');
assert.equal(normalizedNorthern.relationships.filter((item) => item.coverageOnly).length, 2);
assert.ok(normalizedNorthern.relationships.every((item) => item.truthStatus === 'not_established'));
assert.equal(normalizedNorthern.moduleCoverage.relationships.status, 'coverage_only');
assert.equal(normalizedNorthern.moduleCoverage.tasks.status, 'unknown_empty');

const auditedEmpty = WorldStateMachine.Defaults.createState();
auditedEmpty.initialized = true;
auditedEmpty.runtime.sourceSummary = { sourceRead: { audit: { totalReadableMessages: 12, processedMessages: 12, failedMessages: 0 } } };
assert.equal(WorldStateMachine.Storage._test.normalizeState(auditedEmpty).moduleCoverage.tasks.status, 'checked_empty');
const failedCoverage = WorldStateMachine.Defaults.createState();
failedCoverage.initialized = true;
failedCoverage.moduleCoverage.tasks = { status: 'failed', basis: '任务来源块读取失败' };
assert.equal(WorldStateMachine.Storage._test.normalizeState(failedCoverage).moduleCoverage.tasks.status, 'failed');

const unknownHemisphere = WorldStateMachine.Defaults.createState();
unknownHemisphere.initialized = true;
unknownHemisphere.world.time.display = '12月10日';
unknownHemisphere.world.location.current = '异界浮岛';
const normalizedUnknown = WorldStateMachine.Storage._test.normalizeState(unknownHemisphere);
assert.equal(normalizedUnknown.world.season, '未明确');
assert.equal(normalizedUnknown.world.seasonMeta.truthStatus, 'unknown');

const inventedIdentityState = WorldStateMachine.Defaults.createState();
inventedIdentityState.initialized = true;
inventedIdentityState.characters = [{ id: 'npc-invented', name: '陌生人', identity: '秘密王族', truthStatus: 'system_generated', priority: 'L3', activity: 'HOT' }];
const normalizedIdentity = WorldStateMachine.Storage._test.normalizeState(inventedIdentityState).characters[0];
assert.equal(normalizedIdentity.truthStatus, 'unknown');
assert.equal(normalizedIdentity.identityMeta.truthStatus, 'unknown');
assert.equal(normalizedIdentity.priority, 'L2');

const relationshipState = WorldStateMachine.Defaults.createState();
relationshipState.initialized = true;
relationshipState.identities = { user: '用户', char: '角色' };
relationshipState.relationships = [{
    id: 'possible-romance', from: 'user', to: 'char', type: '可能的暧昧', status: '多次出现亲密试探但没有确认',
    truthStatus: 'suspected', basis: ['多次出现超出普通朋友范围的试探'], sourceRefs: ['chat:21'], priority: 'L3', activity: 'HOT',
}];
const normalizedRelationship = WorldStateMachine.Storage._test.normalizeState(relationshipState);
const possibleRomance = normalizedRelationship.relationships.find((item) => item.id === 'possible-romance');
assert.equal(possibleRomance.truthStatus, 'suspected');
assert.equal(possibleRomance.priority, 'L2', '推测关系不得成为L3核心事实');
assert.equal(normalizedRelationship.relationships.find((item) => item.from === 'char' && item.to === 'user')?.truthStatus, 'not_established');

const transitionBase = WorldStateMachine.Defaults.createState();
transitionBase.relationships = [{
    id: 'rel', from: 'user', to: 'char', status: '可能存在暧昧', truthStatus: 'suspected', basis: ['若干试探'], sourceRefs: ['chat:8'], priority: 'L2', activity: 'HOT',
}];
const unsafePromotion = WorldStateMachine.Engine._test.applyStateDelta(transitionBase, {
    collectionOps: [{ module: 'relationships', op: 'update', id: 'rel', value: { status: '已经正式恋爱', truthStatus: 'confirmed', sourceRefs: [] } }],
});
assert.equal(unsafePromotion.relationships[0].truthStatus, 'suspected', '没有新来源时不得自动升级为确认');
const safePromotion = WorldStateMachine.Engine._test.applyStateDelta(transitionBase, {
    collectionOps: [{ module: 'relationships', op: 'update', id: 'rel', value: { status: '双方明确确认恋爱关系', truthStatus: 'confirmed', basis: ['双方明确对话'], sourceRefs: ['chat:44'] } }],
});
assert.equal(safePromotion.relationships[0].truthStatus, 'confirmed');

const weatherBase = WorldStateMachine.Defaults.createState();
weatherBase.world.location.weather = '小雨';
weatherBase.world.location.weatherMeta = { truthStatus: 'system_generated', basis: ['上一轮连续天气'], sourceRefs: [] };
const weatherJump = WorldStateMachine.Engine._test.applyStateDelta(weatherBase, {
    statePatch: { world: { location: { weather: '暴雪', weatherMeta: { truthStatus: 'system_generated', basis: ['为了气氛'], sourceRefs: [] } } } },
});
assert.equal(weatherJump.world.location.weather, '小雨', '无原文依据的系统天气不得从小雨突变为暴雪');

const blocks = WorldStateMachine.Injection.fallbackBlocks(normalizedRelationship);
assert.match(blocks.relationships, /疑似，不得写成事实/);
assert.match(blocks.relationships, /尚未建立，不得自行升级/);
assert.match(WorldStateMachine.Injection.fallbackBlocks(normalizedNorthern).world, /系统生成，保持连续/);
assert.match(WorldStateMachine.Injection.fallbackBlocks(normalizedUnknown).world, /未知，禁止补造/);

console.log('Truth status, constrained inference, and relationship coverage smoke tests passed');
