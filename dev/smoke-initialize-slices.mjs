import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
await import('../src/defaults.js');

const calls = [];
WorldStateMachine.Api = {
    async complete(_prompt, payload, options) {
        calls.push({ payload, options });
        const state = {};
        Object.keys(payload.stateSchema).forEach((key) => {
            state[key] = key === 'identities' ? { user: '用户', char: '角色' } : (['world','map'].includes(key) ? {} : []);
        });
        return { state };
    },
};
await import('../src/engine.js');

const settings = { modulePrompts: WorldStateMachine.Defaults.MODULE_PROMPTS };
const result = await WorldStateMachine.Engine._test.initializeInSlices({
    sourceDigest: [{
        sourceRefs: ['all'], canon: ['世界事实'], chronology: ['时间顺序'], characters: ['人物'],
        relationships: ['关系'], knowledge: ['知识'], locations: ['地点'], tasks: ['任务'],
        currentScene: ['当前场景'], uncertainties: ['冲突'],
    }],
    chat: [{ role: 'user', content: '当前场景' }],
}, {}, settings);
assert.equal(calls.length, 4);
assert.ok(calls.every((call) => call.payload.task === 'INITIALIZE_WORLD_SLICE'));
assert.deepEqual(calls.map((call) => call.payload.slice), ['foundation','people','affairs','dynamics']);
assert.ok(calls.every((call) => call.options.maxTokens <= 6500));
assert.equal(calls.every((call) => !('chat' in call.payload.source)), true);
assert.deepEqual(Object.keys(calls[0].payload.source.sourceDigest[0]).sort(), ['canon','chronology','currentScene','locations','sourceRefs','uncertainties'].sort());
assert.deepEqual(Object.keys(calls[1].payload.source.sourceDigest[0]).sort(), ['characters','currentScene','knowledge','relationships','sourceRefs','uncertainties'].sort());
assert.equal(result.state.initialized, true);
assert.equal(result.state.identities.user, '用户');
assert.ok(Array.isArray(result.state.characters));
assert.ok(Array.isArray(result.state.causalEffects));
assert.ok(result.plan.notes.length);

const splitCalls = [];
WorldStateMachine.Api.complete = async (_prompt, payload) => {
    splitCalls.push(payload);
    const keys = Object.keys(payload.stateSchema);
    if (keys.length > 1) throw new Error('Got response status 502');
    const key = keys[0];
    return { state: { [key]: key === 'identities' ? { user: '用户', char: '角色' } : (['world','map'].includes(key) ? {} : []) } };
};
const splitResult = await WorldStateMachine.Engine._test.initializeInSlices({ sourceDigest: [{ canon: ['证据'] }] }, {}, settings);
assert.ok(splitCalls.length > 4);
assert.equal(splitResult.state.initialized, true);
assert.ok(Array.isArray(splitResult.state.characters));
assert.ok(Array.isArray(splitResult.state.causalEffects));

console.log('Batched initialization smoke tests passed');
