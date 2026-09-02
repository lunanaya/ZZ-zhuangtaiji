import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
};
globalThis.dispatchEvent = () => {};
const local = new Map();
globalThis.localStorage = {
    getItem: (key) => local.get(key) || null,
    setItem: (key, value) => local.set(key, String(value)),
};

const chats = { a1: {}, b1: {} };
let activeChat = 'a1';
let saves = 0;
globalThis.SillyTavern = { getContext: () => ({
    characterId: 7,
    chatId: activeChat,
    chatMetadata: chats[activeChat],
    async saveChat() { saves += 1; },
}) };

await import('../src/defaults.js');
await import('../src/storage.js');

const { Storage } = WorldStateMachine;
let a1 = Storage.load();
a1.initialized = true;
a1.world.time.display = 'A1 的时间';
a1 = await Storage.save(a1, 'a1-test');
assert.equal(a1.runtime.storageChatKey, 'a1');

activeChat = 'b1';
let b1 = Storage.load();
assert.equal(b1.initialized, false, '同一角色的新聊天不能继承 A1 的初始化状态');
assert.notEqual(b1.world.time.display, 'A1 的时间', 'B1 不能读取 A1 的状态正文');
b1.initialized = true;
b1.world.time.display = 'B1 的时间';
await Storage.save(b1, 'b1-test');

activeChat = 'a1';
assert.equal(Storage.load().world.time.display, 'A1 的时间', '切回 A1 必须恢复 A1 的插件存档');
activeChat = 'b1';
assert.equal(Storage.load().world.time.display, 'B1 的时间', '切回 B1 必须恢复 B1 的插件存档');

activeChat = 'a1';
const staleA1 = Storage.load();
activeChat = 'b1';
await assert.rejects(
    Storage.save(staleA1, 'late-a1-response'),
    /已阻止把旧聊天的状态写入新存档/,
    '切换聊天后才返回的 A1 请求不能污染 B1',
);

chats.c1 = structuredClone(chats.a1);
activeChat = 'c1';
const c1 = Storage.load();
assert.equal(c1.initialized, false, '复制自 A1 元数据的新聊天 C1 也必须创建独立插件存档');
assert.notEqual(c1.world.time.display, 'A1 的时间');
assert.equal(saves, 2);

console.log('chat isolation smoke test passed');
