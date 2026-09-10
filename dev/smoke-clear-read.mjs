import assert from 'node:assert/strict';

// Exercise the real confirmation flow with disposable DOM/storage substitutes.
globalThis.window = globalThis;
class Node {
    listeners = new Map();
    children = new Map();
    isConnected = true;
    setAttribute() {}
    set innerHTML(value) {
        this.html = value;
        for (const choice of ['cancel', 'confirm']) this.children.set(`[data-clear-choice="${choice}"]`, new Node());
    }
    querySelector(selector) { return this.children.get(selector); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    appendChild(child) { this.child = child; child.parent = this; }
    remove() { this.parent.child = undefined; this.isConnected = false; }
    focus() { document.activeElement = this; }
    emit(name, event = {}) { this.listeners.get(name)?.(event); }
}
const host = new Node();
const originalFocus = new Node();
globalThis.document = { getElementById: () => host, createElement: () => new Node(), activeElement: originalFocus };
globalThis.confirm = () => { throw new Error('Native confirmation must never be used'); };
let chatKey = 'chat-a', progress = 'idle', reading = false, clears = 0, resets = 0, syncs = 0;
let failSave = false, releaseSave;
globalThis.WorldStateMachine = {
    Storage: {
        currentChatKey: () => chatKey,
        clearAll: async () => {
            clears++;
            if (failSave) throw new Error('test save failed');
            if (releaseSave) await new Promise(resolve => { releaseSave = resolve; });
        },
    },
    Engine: { getProgress: () => ({state: progress}), isReading: () => reading,
        resetProgress: () => resets++, syncRegisteredPrompt: async () => syncs++ },
};
await import('../src/ui.js');
const clear = WorldStateMachine.UI._test.clearReadWithConfirmation;
const choose = choice => host.child.querySelector(`[data-clear-choice="${choice}"]`).emit('click');

let pending = clear();
assert.ok(host.child, 'click opens an actual in-page dialog');
assert.match(host.child.html, /无法通过插件回滚/);
assert.equal(clears, 0, 'opening must not clear anything');
assert.equal(document.activeElement, host.child.querySelector('[data-clear-choice="cancel"]'));
assert.equal(await clear(), false, 'repeated clicks do not open another confirmation');
choose('cancel');
assert.equal(await pending, false);
assert.equal(host.child, undefined);
assert.equal(document.activeElement, originalFocus);
assert.equal(clears, 0);

pending = clear();
host.child.emit('keydown', {key: 'Tab', preventDefault() {}});
assert.equal(document.activeElement, host.child.querySelector('[data-clear-choice="confirm"]'));
host.child.emit('keydown', {key: 'Escape', preventDefault() {}, stopPropagation() {}});
assert.equal(await pending, false);
assert.equal(clears, 0);

pending = clear();
chatKey = 'chat-b';
choose('confirm');
await assert.rejects(pending, /聊天已切换/);
assert.equal(clears, 0, 'never clear a different chat');

pending = clear();
progress = 'running';
choose('confirm');
await assert.rejects(pending, /确认期间开始/);
assert.equal(clears, 0);
await assert.rejects(clear(), /正在读取/);
assert.equal(host.child, undefined);
progress = 'idle';
reading = true;
await assert.rejects(clear(), /正在读取/);
reading = false;

releaseSave = true;
pending = clear();
choose('confirm');
await Promise.resolve();
assert.equal(clears, 1);
assert.equal(await clear(), false, 'duplicate clicks during persistence cannot clear twice');
releaseSave();
releaseSave = undefined;
assert.equal(await pending, true);
assert.equal(resets, 1);
assert.equal(syncs, 1);

failSave = true;
pending = clear();
choose('confirm');
await assert.rejects(pending, /test save failed/);
assert.equal(resets, 1, 'failed saves must not report success');
failSave = false;
pending = clear();
choose('cancel');
assert.equal(await pending, false, 'failed operations release the lock for retry');
console.log('Clear read confirmation: open/cancel/Escape/focus, chat/read guards, deduplication and save errors passed; no real chat modified.');
