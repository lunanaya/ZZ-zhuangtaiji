import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } };
globalThis.dispatchEvent = () => {};
const local = new Map();
globalThis.localStorage = {
    getItem: (key) => local.get(key) || null,
    setItem: (key, value) => local.set(key, String(value)),
};
const tavernContext = { chatId: 'fast-meow-smoke', chatMetadata: {}, async saveChat() {} };
globalThis.SillyTavern = { getContext: () => tavernContext };

await import('../src/defaults.js');
await import('../src/storage.js');
await import('../src/engine.js');

const chat = [
    {
        id: 'old-1', index: 0, role: 'assistant',
        content: '<meow_FM><serial>001</serial><time>景和三年三月初七</time><scene>京城·东院书房</scene><plot>用户取得玄鸟密钥，并将它藏入书架夹层。</plot><seeds>密钥来历仍需调查</seeds></meow_FM>',
    },
    {
        id: 'old-2', index: 1, role: 'assistant',
        content: '<meow_FM>serial: 002\ntime: 当夜\nscene: 京城·长街\nplot: 城门发生重大事故并被永久封锁\nseeds: 巡城卫将在换班后核查身份</meow_FM>',
    },
    {
        id: 'new-3', index: 2, role: 'assistant',
        content: '<meow_FM><serial>003</serial><time>次日辰时</time><scene>京城·客栈</scene><plot>用户抵达客栈。</plot><seeds>无</seeds></meow_FM>',
    },
];
const source = { identities: { user: '用户', char: '角色' }, character: { name: '角色' }, worldbooks: [], chat };
const ledger = WorldStateMachine.Engine._test.deterministicMeowLedger(source);
assert.equal(ledger.length, 3, 'every meow_FM block must become one searchable local ledger entry');
assert.equal(new Set(ledger.map((item) => item.changeId)).size, 3, 'ledger ids must be stable and unique');
assert.match(ledger[0].value.archiveText, /玄鸟密钥/);
assert.equal(ledger[1].value.location, '京城·长街', 'legacy colon fields must remain supported');

WorldStateMachine.Context = {
    context: () => ({}),
    messagesByIds: (ids) => chat.filter((message) => ids.includes(String(message.id))),
    buildSource: async () => source,
};
const state = WorldStateMachine.Defaults.createState();
state.initialized = true;
await WorldStateMachine.Storage.setTwoPassHistoryBaseline(state, { messages: chat, ledger, audit: { processedMessages: chat.length } });
const memory = WorldStateMachine.Storage.loadHistoryMemory();
assert.equal(memory.ledger.length, 3, 'two-pass baseline must retain the deterministic archive ledger');
assert.ok(memory.messages['old-1'].changeIds.length, 'covered messages must link to their ledger entries');
const recall = WorldStateMachine.Storage.retrieveHistory('玄鸟密钥藏在哪里', { maxChars: 1200, evidenceCount: 4, state });
assert.match(recall.text, /书架夹层/);
assert.equal(recall.evidence[0].ref, 'chat:old-1', 'recall must resolve the original chat floor as evidence');

await WorldStateMachine.Storage.setTwoPassHistoryBaseline(state, { messages: chat, ledger: [], audit: { processedMessages: chat.length } });
assert.equal(await WorldStateMachine.Engine._test.ensureDeterministicMeowLedger(state), 3, 'an older empty baseline must migrate locally without an API read');
assert.equal(WorldStateMachine.Storage.loadHistoryMemory().ledger.length, 3);

const prepared = WorldStateMachine.Engine._test.prepareSourceForStateRequests(source, { gptMode: false });
assert.equal(prepared.localEvidence.currentScene.at(-1).location, '京城·客栈');
assert.ok(prepared.localEvidence.timeline.some((item) => /永久封锁/.test(item.summary)), 'deterministic major milestones must survive locally before API adjudication');

console.log('Fast meow_FM ledger and local fallback smoke tests passed');
