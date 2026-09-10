import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } };
globalThis.dispatchEvent = () => {};
globalThis.addEventListener = () => {};
const local = new Map();
globalThis.localStorage = { getItem: key => local.get(key) || null, setItem: (key, value) => local.set(key, value) };
const prompts = {};
const raw = (id, is_user, mes) => ({ send_date: id, name: is_user ? 'User' : 'NPC', is_user, mes });
const ctx = { chatId: 'delivery-a', characterId: 0, name1: 'User', chatMetadata: {}, chat: [raw('u1', true, '我喝了一口茶。')],
    saveChat: async () => {}, setExtensionPrompt: async (id, text) => { prompts[id] = text; } };
globalThis.SillyTavern = { getContext: () => ctx };
for (const module of ['defaults', 'storage', 'context', 'injection', 'engine']) await import(`../src/${module}.js`);
const W = WorldStateMachine;
const settings = { enabled: true, useTavernApi: false, endpoint: 'mock', diceEnabled: false, blockOnPlannerError: false,
    injectionMaxChars: 20000, modulePrompts: {}, injectionModules: W.Defaults.INJECTION_MODULES };
W.Settings = { get: () => settings };
W.WorldbookCompiler = { getStaticCatalog: () => ({}) };
let fail = false;
let calls = 0;
W.Api = { withCallBudget: async (_n, _label, run) => run(), complete: async () => {
    calls++;
    if (fail) throw new Error('simulated interruption');
    return { stateDelta: { statePatch: {}, collectionOps: [] }, actualChanges: [] };
} };
const clone = value => structuredClone(value);
const fact = { truthStatus: 'confirmed', sourceRefs: ['chat:1'], priority: 'L2', activity: 'HOT' };
let state = W.Defaults.createState();
state.initialized = true;
state.world.time.display = '2026-09-10 10:00';
state.world.location.current = '客厅';
state.schedules = [{ ...fact, id: 'banquet', title: '赴宴', expectedTime: '明天18:00', status: 'scheduled', participantIds: ['user'] }];
state.tasks = [{ ...fact, id: 'archive', title: '核验档案', status: 'active', progress: '等待资料', completionConditions: ['核验来源'] }];
state.characters = [{ ...fact, id: 'user', name: 'User', present: true, location: '客厅', currentGoals: ['明天赴宴'], routine: '赴宴前整理衣物' }];
state.progression = { ...state.progression, ...fact, direction: '筹备宴会', nextRequiredChanges: ['赴宴'], currentMovement: '' };
state.planner = { ...state.planner, plan: { advanceDecision: { direction: '旧计划预告' }, eligibleDevelopments: ['旧候选预告'] }, moduleInjections: { planner: '旧缓存预告' } };
state = await W.Storage.save(state, 'baseline');
assert.equal(state.runtime.memoryTurn, 0);
assert.equal(state.runtime.memoryTiming['schedules:banquet'].at, W.Storage.storyTimestamp('2026-09-11 18:00'));
let blocks = W.Injection.fallbackBlocks(state);
assert.equal(blocks.schedules, '', 'being present does not make a future appointment relevant');
assert.equal(blocks.tasks, '', 'active alone does not make a task relevant');
assert.doesNotMatch(blocks.characters, /赴宴/);
assert.doesNotMatch(W.Injection.preview(state, state.planner.plan, state.planner.moduleInjections), /赴宴|旧计划预告|旧候选预告|旧缓存预告/);

// An identical update, audit refresh, or repeated save must not reheat memory.
const before = clone(state);
const repeated = W.Engine._test.applyStateDelta(state, { collectionOps: [{ module: 'tasks', op: 'update', id: 'archive', value: {
    progress: '等待资料', activity: 'HOT', basis: ['重新检查'], sourceRefs: ['chat:2'], updatedTurn: 999,
} }], statePatch: { progression: clone(state.progression) } });
assert.equal(repeated.tasks[0].updatedRevision, before.tasks[0].updatedRevision);
assert.equal(repeated.tasks[0].updatedTurn, before.tasks[0].updatedTurn);
assert.equal(repeated.progression.updatedRevision, before.progression.updatedRevision);
state = await W.Storage.save(repeated, 'edit');
for (let i = 0; i < 18; i++) state = await W.Storage.save(state, 'preview-save');
assert.equal(state.runtime.memoryTurn, 0);
assert.equal(state.tasks[0].activity, 'HOT');
for (let i = 1; i <= 13; i++) {
    state = W.Engine._test.applyStateDelta(state, { collectionOps: [{ module: 'schedules', op: 'update', id: 'banquet', value: {
        ...clone(state.schedules[0]), activity: 'HOT', updatedTurn: 999, sourceRefs: [`chat:repeat-${i}`],
    } }] });
    state = await W.Storage.save(state, 'post-generation-read', { snapshotReadReceipt: { messageKey: `read-${i}` } });
}
assert.equal(state.runtime.memoryTurn, 13);
assert.equal(state.tasks[0].activity, 'COLD');
assert.equal(state.schedules[0].activity, 'COLD');
state = await W.Storage.save(state, 'post-generation-read', { snapshotReadReceipt: { messageKey: 'read-13' } });
assert.equal(state.runtime.memoryTurn, 13, 'reading the same message twice does not advance the clock');
ctx.chat = [raw('ask', true, '赴宴安排是什么？')];
assert.match(W.Injection.fallbackBlocks(state).schedules, /赴宴/, 'explicit query recalls COLD memory');
ctx.chat = [raw('act', true, '我来核验档案。')];
assert.match(W.Injection.fallbackBlocks(state).tasks, /完成条件.*核验来源/, 'current action keeps task constraints');
const updated = W.Engine._test.applyStateDelta(state, { collectionOps: [{ module: 'tasks', op: 'update', id: 'archive', value: { progress: '资料已经送达' } }] });
state = await W.Storage.save(updated, 'edit');
assert.equal(state.tasks[0].activity, 'HOT');
assert.equal(state.tasks[0].updatedTurn, 13);
assert.equal(state.runtime.memoryTiming['schedules:banquet'].at, W.Storage.storyTimestamp('2026-09-11 18:00'), 'relative time never slides forward on reread');

// Preview is pure; only successfully reconciled foreground delivery consumes it.
ctx.chat = [raw('due-user', true, '我继续喝茶。')];
state.world.time.display = '2026-09-11 17:40';
state = await W.Storage.save(state, 'edit');
const preview = W.Injection.preview(state);
assert.match(preview, /赴宴/);
assert.equal(W.Injection.preview(state), preview);
assert.equal(state.runtime.memoryDelivery, undefined);
await W.Engine.interceptor(ctx.chat, 32000, () => {}, 'normal');
assert.match(Object.values(prompts).join('\n'), /赴宴/);
assert.equal(calls, 0, 'foreground injection adds no API call');
ctx.chat.push(raw('due-assistant', false, '茶香仍在。'));
fail = true;
assert.equal(await W.Engine.settle({ latestOnly: true, force: true }), null);
assert.equal(W.Storage.load().runtime.memoryDelivery, undefined, 'failed reconciliation does not consume a reminder');
fail = false;
state = await W.Engine.settle({ latestOnly: true, force: true });
assert.ok(state);
assert.ok(state.runtime.memoryDelivery['schedules:banquet']);
assert.equal(state.runtime.memoryTurn, 14);
ctx.chat.push(raw('after-due', true, '我又喝了一口茶。'));
assert.doesNotMatch(W.Injection.preview(state), /赴宴/, 'unchanged due reminder remains quiet');
state.runtime.memoryTurn += 20;
assert.doesNotMatch(W.Injection.preview(state), /赴宴/, 'unchanged trigger does not periodically repeat');
ctx.chat.push(raw('recall', true, '赴宴是什么时间？'));
assert.match(W.Injection.preview(state), /赴宴/, 'explicit recall bypasses reminder suppression');
ctx.chat.push(raw('quiet', true, '我继续喝茶。'));
const changed = clone(state);
changed.schedules[0].expectedTime = '2026-09-11 17:45';
assert.match(W.Injection.preview(changed), /赴宴/, 'rescheduled imminent appointment bypasses suppression');
changed.schedules[0].status = 'cancelled';
assert.equal(W.Injection.fallbackBlocks(changed).schedules, '');
const disabled = clone(settings.injectionModules);
settings.injectionModules = { ...disabled, schedules: { ...disabled.schedules, enabled: false } };
changed.schedules[0].status = 'scheduled';
assert.match(W.Injection.fallbackBlocks(changed).schedules, /赴宴/);
assert.equal(W.Injection.createDeliveryReceipt(changed, W.Injection.composeByDepth(changed)).length, 0);
settings.injectionModules = disabled;
const localTask = { ...fact, id: 'local', title: '整理书库', status: 'active', locationRefs: ['hall','garden'] };
const locationState = clone(state);
locationState.map.currentLocationId = 'garden';
locationState.runtime.memoryTurn = 21;
locationState.runtime.memoryDelivery = { 'tasks:local': { fingerprint: W.Storage.memoryFingerprint(localTask), reason: 'location:hall', turn: 20 } };
assert.equal(W.Injection._test.futureSelection(locationState, 'tasks', localTask), null, 'different scene trigger respects cooldown');
locationState.runtime.memoryTurn = 23;
assert.ok(W.Injection._test.futureSelection(locationState, 'tasks', localTask));
locationState.progression.activity = 'COLD';
locationState.progression.blockedByDecision = '是否离开必须由用户决定';
assert.match(W.Injection.fallbackBlocks(locationState).progression, /是否离开必须由用户决定/);
const legacy = clone(state);
legacy.revision = 999;
delete legacy.runtime.memoryTurn;
legacy.tasks[0].activity = 'HOT';
delete legacy.tasks[0].updatedTurn;
legacy.tasks[0].updatedRevision = 0;
assert.equal(W.Storage._test.normalizeState(legacy).tasks[0].activity, 'HOT', 'legacy revision is not interpreted as elapsed dialogue');

// Rollback restores the receipt and turn counter together; other chats start clean.
state = await W.Storage.rollbackPreviousGeneration();
assert.equal(state.runtime.memoryTurn, 13);
assert.equal(state.runtime.memoryDelivery, undefined);
assert.match(W.Injection.preview(state), /赴宴/);
ctx.chatId = 'delivery-b';
assert.equal(W.Storage.load().runtime.memoryDelivery, undefined);
assert.equal(W.Storage.load().runtime.memoryTurn, undefined);
ctx.chatId = 'delivery-a';
assert.equal(W.Storage.load().runtime.memoryTurn, 13);
assert.equal(W.Storage.storyTimestamp('周二下午'), null);
assert.equal(W.Storage.storyTimestamp('2026-02-30 18:00'), null);
assert.equal(W.Storage.resolveReminderTime('明天18:00', null), null, 'ambiguous old relative dates must not use the computer date');
assert.equal(W.Storage.resolveReminderTime('明天下午6:00', W.Storage.storyTimestamp('2026-09-10 10:00')), null, 'unsupported natural-language periods must not be mistaken for morning');
console.log('Memory delivery regression passed: no-op updates, turn decay, relative dates, recall, reminder receipts, failed retry, rollback and isolation.');
