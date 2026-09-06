import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.WorldStateMachine = { Storage: { currentChatKey: () => 'chat-a' } };
const listeners = new Map();
globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
const nodes = new Map([['wsm-root', {}]]);
globalThis.document = {
    getElementById: id => nodes.get(id),
    createElement: () => ({ setAttribute() {}, remove() { nodes.delete(this.id); } }),
    body: { appendChild: node => nodes.set(node.id, node) },
};
await import('../src/ui.js');
WorldStateMachine.UI.mount();
const notify = detail => listeners.get('wsm-turn-read-progress')({ detail });
notify({ state: 'running', chatKey: 'chat-a' });
assert.equal(nodes.get('wsm-turn-read-popup').textContent, '正在读取');
notify({ state: 'running', chatKey: 'chat-a' });
assert.equal(nodes.size, 2, 'Only one popup is mounted');
for (const state of ['success', 'error', 'idle']) {
    notify({ state: 'running' });
    notify({ state });
    assert.equal(nodes.has('wsm-turn-read-popup'), false);
}
notify({ state: 'running', chatKey: 'other-chat' });
assert.equal(nodes.has('wsm-turn-read-popup'), false);
console.log('Reading popup visibility and cleanup tests passed');
