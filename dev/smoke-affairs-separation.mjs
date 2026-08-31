import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
await import('../src/defaults.js');
await import('../src/engine.js');

const normalize = WorldStateMachine.Engine._test.normalizeAffairsState;
const state = normalize({
    tasks: [
        { id: 'a', title: '主线A', kind: 'main', status: 'active' },
        { id: 'b', title: '主线B', kind: 'main', status: 'blocked' },
        { id: 'c', title: '旧任务', kind: 'main', status: 'done' },
    ],
    triggers: [{ id: 't', conditions: '夜间独自经过旧城区', effectsIfTriggered: '玩家遇见逃避搜查的顾言' }],
});

assert.equal(state.tasks.filter((item) => item.kind === 'main' && !['done', 'failed'].includes(item.status)).length, 1);
assert.equal(state.tasks[0].kind, 'main');
assert.equal(state.tasks[1].kind, 'side');
assert.equal(state.tasks[2].kind, 'side');
assert.deepEqual(state.triggers[0].conditions, ['夜间独自经过旧城区']);
assert.deepEqual(state.triggers[0].effectsIfTriggered, ['玩家遇见逃避搜查的顾言']);

const prompt = WorldStateMachine.Defaults.PLANNER_PROMPT;
const reconciler = WorldStateMachine.Defaults.RECONCILER_PROMPT;
assert.match(prompt, /事务四栏强制判定/);
assert.match(prompt, /kind=main 最多一个/);
assert.match(prompt, /只发生在 NPC 之间/);
assert.match(reconciler, /已发生→timeline/);

console.log('Affairs separation smoke tests passed');
