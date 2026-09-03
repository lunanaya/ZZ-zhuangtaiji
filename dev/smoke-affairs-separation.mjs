import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
await import('../src/defaults.js');
await import('../src/facts.js');
await import('../src/storage.js');

const normalize = WorldStateMachine.Storage._test.normalizeState;
const state = normalize({
    tasks: [
        { id: 'a', title: '查清委托', status: 'active', dependencies: 'task:prelude', locationRefs: 'location:archive', characterRefs: 'character:keeper', ruleRefs: 'rule:access', knowledgeRefs: 'knowledge:clue', resourceConstraintRefs: 'constraint:permit', completionConditions: '取得档案并核验来源', completedConditions: '取得档案并核验来源' },
    ],
    triggers: [{ id: 't', conditions: '夜间独自经过旧城区', effectsIfTriggered: '玩家遇见逃避搜查的顾言' }],
});

assert.deepEqual(state.tasks[0].dependencies, ['task:prelude']);
assert.deepEqual(state.tasks[0].locationRefs, ['location:archive']);
assert.deepEqual(state.tasks[0].characterRefs, ['character:keeper']);
assert.deepEqual(state.tasks[0].ruleRefs, ['rule:access']);
assert.deepEqual(state.tasks[0].knowledgeRefs, ['knowledge:clue']);
assert.deepEqual(state.tasks[0].resourceConstraintRefs, ['constraint:permit']);
assert.deepEqual(state.tasks[0].completionConditions, ['取得档案并核验来源']);
assert.deepEqual(state.tasks[0].completedConditions, ['取得档案并核验来源']);
assert.deepEqual(state.triggers[0].conditions, ['夜间独自经过旧城区']);
assert.deepEqual(state.triggers[0].effectsIfTriggered, ['玩家遇见逃避搜查的顾言']);

const prompt = WorldStateMachine.Defaults.PLANNER_PROMPT;
const reconciler = WorldStateMachine.Defaults.RECONCILER_PROMPT;
assert.match(prompt, /任务 vs 可触发事件/);
assert.match(prompt, /可触发事件 vs 长期线程/);
assert.match(prompt, /长期线程 vs 世界进程/);
assert.match(prompt, /即使用户角色不参与也会自行变化/);
assert.match(reconciler, /仍可能成立的armed\/eligible项保留稳定ID/);
assert.match(reconciler, /允许0条且不得补足配额/);

console.log('Affairs separation smoke tests passed');
