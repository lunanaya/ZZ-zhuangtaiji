import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
const uiSource = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
assert.ok(!uiSource.includes("labeled('依据', current?.basis || current?.sourceRefs)"), 'NPC活动卡不应展示仅供后台审计的依据与来源');
const cssSource = await readFile(new URL('../styles/state-machine.css', import.meta.url), 'utf8');
assert.match(uiSource, /<header class="wsm-header"><div class="wsm-actions">[\s\S]*?<\/header>\s*<div class="wsm-scroll-page">/, '顶部操作行必须位于整页滚动容器之外');
assert.match(uiSource, /class="wsm-scroll-page">[\s\S]*?id="wsm-operation-status"/, '读取进度表必须跟随页面内容滚动');
assert.match(cssSource, /\.wsm-scroll-page\s*\{[^}]*overflow-y:auto/, '整个页面内容区必须可纵向滚动');
assert.doesNotMatch(cssSource, /\.wsm-operation-steps\s*\{[^}]*max-height:/, '读取表不应再被卡在独立小滚动框内');
console.log('Reading popup visibility and cleanup tests passed');
