import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } };
const progressEvents = [];
globalThis.dispatchEvent = event => { if (event.type === 'wsm-turn-read-progress') progressEvents.push(event.detail); };
globalThis.addEventListener = () => {};
const local = new Map();
globalThis.localStorage = { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) };
const events = new Map();
const ctx = {
    chatId: 'turn-regression', characterId: 0, chatMetadata: {}, name1: 'User', name2: 'Character', chat: [],
    saveChat: async () => {}, setExtensionPrompt: async () => {},
    event_types: { MESSAGE_DELETED: 'deleted', MESSAGE_SENT: 'sent', MESSAGE_RECEIVED: 'received', MESSAGE_SWIPED: 'swiped' },
    eventSource: { on: (name, handler) => events.set(name, handler) },
};
globalThis.SillyTavern = { getContext: () => ctx };
for (const module of ['defaults', 'storage', 'context']) await import(`../src/${module}.js`);
const WSM = WorldStateMachine;
const engineSettings = { enabled: true, useTavernApi: false, endpoint: 'test', plannerPrompt: 'test', diceEnabled: false, blockOnPlannerError: false };
WSM.Settings = { get: () => engineSettings };
WSM.Injection = { compose: () => '<WORLD_STATE>test</WORLD_STATE>', composeByDepth: () => ({ 0: '<WORLD_STATE>test</WORLD_STATE>' }) };
WSM.WorldbookCompiler = { installNativeWorldbookFilter() {}, setWorldbookPrompts: async () => {} };
const calls = [];
let responder = () => ({ stateDelta: { statePatch: { world: { weather: 'rain' } }, collectionOps: [] }, actualChanges: ['weather changed'] });
WSM.Api = {
    withCallBudget: async (_limit, _label, run) => run(),
    complete: async (_prompt, payload, options) => { calls.push({ payload, options }); return responder(); },
};
await import('../src/engine.js');
const raw = (id, is_user, mes) => ({ send_date: id, name: is_user ? 'User' : 'Character', is_user, mes });
ctx.chat = Array.from({ length: 400 }, (_, i) => raw(`old-${i}`, i % 2 === 0, `archived ${i}`));
let baseline = WSM.Defaults.createState();
baseline.initialized = true;
baseline.runtime.lastReadFloor = 400;
baseline.runtime.readPositionVersion = 2;
baseline.world.weather = 'sun';
baseline.characters = Array.from({ length: 20 }, (_, i) => ({ id: `npc-${i}`, name: `Person ${i}`, situation: 'kept' }));
await WSM.Storage.save(baseline, 'baseline');
await WSM.Engine.init();

assert.deepEqual(WSM.Engine._test.ordinaryTurnCallPolicy(), { apiCallsPerUserMessage: 0, postGenerationApiCalls: 1 });
ctx.chat.push(raw('user-401', true, 'I open my umbrella.'));
await WSM.Engine.interceptor(ctx.chat, 32000, () => {}, 'normal');
assert.equal(calls.length, 0, 'sending a user message must not call the state API');

ctx.chat.push(raw('assistant-402', false, 'It starts raining.'));
events.get('received')();
await WSM.Engine._test.waitForPostGenerationReads();
assert.equal(calls.length, 1, 'finished正文 starts exactly one background read');
assert.equal(calls[0].payload.actualAssistantMessage.content, 'It starts raining.');
assert.equal(calls[0].payload.preState.characters.length, 20, 'background read receives every old state row');
assert.equal(calls[0].payload.recentChat, undefined, 'background read receives no older chat body');
assert.equal(WSM.Storage.load().world.weather, 'rain');
assert.equal(WSM.Storage.load().runtime.lastReadFloor, 402);
assert.ok(progressEvents.some(event => event.message === '正在读取'));

ctx.chat.push(raw('user-403', true, 'I go outside.'));
await WSM.Engine.interceptor(ctx.chat, 32000, () => {}, 'normal');
assert.equal(calls.length, 1, 'the next user send must remain instant');

responder = () => ({ stateDelta: { statePatch: { world: { weather: 'snow' } }, collectionOps: [] }, actualChanges: [] });
ctx.chat.push(raw('assistant-404', false, 'Snow begins.'));
events.get('received')();
await WSM.Engine._test.waitForPostGenerationReads();
assert.equal(WSM.Storage.load().world.weather, 'snow');

await WSM.Engine.interceptor(ctx.chat, 32000, () => {}, 'regenerate');
assert.equal(calls.length, 2, 'reroll rollback is local and must not call the state API');
assert.equal(WSM.Storage.load().world.weather, 'rain', 'old candidate state is removed before replacement正文 generation');
responder = () => ({ stateDelta: { statePatch: { world: { weather: 'clear' } }, collectionOps: [
    { module: 'characters', op: 'update', id: 'npc-0', value: { location: 'garden' } },
    { module: 'characters', op: 'create', id: 'new-npc', value: { id: 'new-npc', name: 'New Person' } },
] }, actualChanges: [] });
ctx.chat.at(-1).mes = 'The sky clears. Person 0 enters the garden with New Person.';
events.get('swiped')();
await WSM.Engine._test.waitForPostGenerationReads();
const rerolled = WSM.Storage.load();
assert.equal(calls.length, 3);
assert.equal(rerolled.world.weather, 'clear', 'reroll replaces the old candidate state');
assert.equal(rerolled.characters.find(item => item.id === 'npc-0').situation, 'kept', 'partial updates preserve old fields');
assert.equal(rerolled.characters.find(item => item.id === 'npc-0').location, 'garden');
assert.ok(rerolled.characters.some(item => item.id === 'new-npc'));

ctx.chat.push(raw('user-405', true, 'I wait.'));
ctx.chat.push(raw('assistant-406', false, 'The river freezes.'));
let release;
let started;
const didStart = new Promise(resolve => { started = resolve; });
responder = () => new Promise(resolve => { release = resolve; started(); });
events.get('received')();
await didStart;
ctx.chat.at(-1).mes = 'The river remains liquid.';
responder = () => ({ stateDelta: { statePatch: { world: { weather: 'mild' } }, collectionOps: [] }, actualChanges: [] });
events.get('swiped')();
release({ stateDelta: { statePatch: { world: { weather: 'stale-response' } }, collectionOps: [] }, actualChanges: [] });
await WSM.Engine._test.waitForPostGenerationReads();
assert.equal(WSM.Storage.load().world.weather, 'mild');
assert.notEqual(WSM.Storage.load().world.weather, 'stale-response');

const callsBeforeDisabledMessage = calls.length;
const weatherBeforeDisabledMessage = WSM.Storage.load().world.weather;
engineSettings.enabled = false;
await WSM.Engine.setEnabled(false);
ctx.chat.push(raw('user-407', true, 'I wait while the plugin is off.'));
ctx.chat.push(raw('assistant-408', false, 'A disabled plugin must ignore this message.'));
events.get('received')();
await WSM.Engine._test.waitForPostGenerationReads();
assert.equal(calls.length, callsBeforeDisabledMessage, '总开关关闭后收到正文不得调用状态 API');
assert.equal(WSM.Storage.load().world.weather, weatherBeforeDisabledMessage, '总开关关闭后不得更新已有状态');
await assert.rejects(WSM.Engine.readPreviousBody(), /总开关已关闭/, '总开关关闭后手动读取也必须停止');
engineSettings.enabled = true;
await WSM.Engine.setEnabled(true);

console.log('Post-generation background read, reroll rollback, and late-response tests passed');
