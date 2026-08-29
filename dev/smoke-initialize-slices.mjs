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
    sourceDigest: [{ canon: ['完整资料证据'] }],
    chat: [{ role: 'user', content: '当前场景' }],
}, {}, settings);
assert.equal(calls.length, 4);
assert.ok(calls.every((call) => call.payload.task === 'INITIALIZE_WORLD_SLICE'));
assert.deepEqual(calls.map((call) => call.payload.slice), ['foundation','people','affairs','dynamics']);
assert.ok(calls.every((call) => call.options.maxTokens <= 6500));
assert.equal(result.state.initialized, true);
assert.equal(result.state.identities.user, '用户');
assert.ok(Array.isArray(result.state.characters));
assert.ok(Array.isArray(result.state.causalEffects));
assert.ok(result.plan.notes.length);

console.log('Batched initialization smoke tests passed');
