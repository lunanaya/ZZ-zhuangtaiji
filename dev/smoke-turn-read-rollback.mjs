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
    chatId: 'turn-regression', characterId: 0, chatMetadata: {}, name1: 'User', name2: 'Character',
    chat: [], saveChat: async () => {},
    event_types: { MESSAGE_DELETED: 'deleted', MESSAGE_SENT: 'sent', MESSAGE_RECEIVED: 'received' },
    eventSource: { on: (name, handler) => events.set(name, handler) },
};
globalThis.SillyTavern = { getContext: () => ctx };
for (const module of ['defaults', 'storage', 'context']) await import(`../src/${module}.js`);
const WSM = WorldStateMachine;
WSM.Settings = { get: () => ({ enabled: true, useTavernApi: false, endpoint: 'test', plannerPrompt: 'test', diceEnabled: false }) };
WSM.Injection = { compose: () => '<WORLD_STATE>test</WORLD_STATE>', composeByDepth: () => ({}) };
WSM.Storage.loadHistoryMemory = () => ({ status: 'not-started' });
const calls = [];
let responder = () => ({ stateDelta: { statePatch: { world: { weather: 'rain' } } }, actualChanges: ['weather changed'] });
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
baseline.runtime.sourceSummary = { sourceRead: { coveredChatMessages: 404 } };
baseline.planner = { turnKey: 'old', injection: '<WORLD_STATE>old</WORLD_STATE>' };
baseline.world.weather = 'sun';
await WSM.Storage.save(baseline, 'baseline');
await WSM.Engine.init();

ctx.chat.push(raw('assistant-401', false, 'It starts raining.'));
ctx.chat.push(raw('user-402', true, 'I open my umbrella.'));
events.get('received')();
await WSM.Engine.plan();
assert.equal(calls.length, 1);
assert.ok(progressEvents.some(event => event.state === 'running' && event.message === '正在读取'));
assert.equal(progressEvents.at(-1).state, 'idle');
assert.equal(calls[0].payload.previousAssistantFloor, 401, 'old coverage counts must not suppress a new body');
assert.match(calls[0].payload.currentUserAction.content, /umbrella/);
assert.match(calls[0].payload.previousAssistantMessage.content, /raining/);
assert.equal(WSM.Storage.load().world.weather, 'rain', 'actual delta must reach persistent state');
assert.equal(WSM.Storage.load().runtime.lastReadFloor, 401);
await WSM.Engine.plan();
assert.equal(calls.length, 1, 'same turn and same body must reuse its plan');

// Same floor, edited body: a numeric high-water mark must not hide it.
ctx.chat[400].mes = 'The rain stops.';
responder = () => ({ stateDelta: { statePatch: { world: { weather: 'clear' } } } });
await WSM.Engine.plan();
assert.equal(calls.length, 2);
assert.equal(WSM.Storage.load().world.weather, 'clear');

// An unconsumed reply has no associated state update to undo.
ctx.chat.push(raw('unread-403', false, 'A new reply.'));
events.get('received')();
ctx.chat.pop();
events.get('deleted')();
await WSM.Engine.plan();
assert.equal(WSM.Storage.load().world.weather, 'clear');

// Delete both consumed versions of floor 401. Restore its baseline and cursor.
ctx.chat.splice(400);
events.get('deleted')();
ctx.chat.push(raw('replacement-401', false, 'It is snowing now.'));
ctx.chat.push(raw('replacement-user', true, 'I put on a coat.'));
responder = () => {
    assert.equal(WSM.Storage.load().world.weather, 'sun', 'deletion must restore the pre-read facts');
    assert.equal(WSM.Storage.load().runtime.lastReadFloor, 400, '404/401 must return to 400');
    return { stateDelta: { statePatch: { world: { weather: 'snow' } } } };
};
await WSM.Engine.plan();
assert.match(calls.at(-1).payload.previousAssistantMessage.content, /snowing/);
assert.equal(WSM.Storage.load().world.weather, 'snow');

// No snapshots still requires cursor repair.
const receipts = WSM.Context.chat(ctx, { includeHidden: true }).slice(0, 390).map(WSM.Engine._test.previousBodyReceipt);
await WSM.Storage.rollbackGenerations(0, { remainingFloor: 390, remainingReceipts: receipts });
assert.ok(WSM.Storage.load().runtime.lastReadFloor <= 390);
assert.equal(WSM.Engine._test.readFloorHighWater(WSM.Storage.load()), WSM.Storage.load().runtime.lastReadFloor);

// Failed reads do not acknowledge the floor; a later retry can still update it.
responder = () => { throw new Error('Gateway Timeout'); };
await WSM.Engine.plan({ force: true });
assert.match(WSM.Storage.load().planner.error, /Gateway Timeout/);
assert.equal(progressEvents.at(-1).state, 'idle', 'Failed reads must dismiss the popup');
assert.ok(WSM.Storage.load().runtime.lastReadFloor < 401);
responder = () => ({ stateDelta: { statePatch: { world: { weather: 'retry-success' } } } });
await WSM.Engine.plan();
assert.equal(WSM.Storage.load().world.weather, 'retry-success');
assert.equal(WSM.Storage.load().runtime.lastReadFloor, 401);

// A response arriving after deletion must not resurrect removed facts.
ctx.chat.push(raw('pending-body', false, 'The river freezes.'));
ctx.chat.push(raw('pending-user', true, 'I wait.'));
events.get('received')();
let release;
let started;
const didStart = new Promise(resolve => { started = resolve; });
responder = () => new Promise(resolve => { release = resolve; started(); });
const pending = WSM.Engine.plan();
await didStart;
ctx.chat.splice(400);
events.get('deleted')();
release({ stateDelta: { statePatch: { world: { weather: 'stale-response' } } } });
await pending;
assert.notEqual(WSM.Storage.load().world.weather, 'stale-response');
console.log('Turn read, edits, deletion rollback, retry, and late-response regression tests passed');
