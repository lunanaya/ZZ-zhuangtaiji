import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};

const settings = {
    useTavernApi: true,
    jailbreakPrompt: 'CUSTOM-JAILBREAK-MARKER',
    maxTokens: 3210,
    timeoutMs: 1000,
};
let tavernRequest;
let completionSettingsHandler;
let tavernGenerationData;
globalThis.SillyTavern = {
    getContext() {
        return {
            eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'chat-settings' },
            eventSource: {
                on(_name, handler) { completionSettingsHandler = handler; },
                removeListener(_name, handler) { if (completionSettingsHandler === handler) completionSettingsHandler = null; },
            },
            async generateRaw(request) {
                tavernRequest = request;
                tavernGenerationData = { model: 'gpt-5', messages: request.prompt };
                completionSettingsHandler?.(tavernGenerationData);
                return '```json\n{"ok":true}\n```';
            },
        };
    },
};
WorldStateMachine.Settings = { get: () => settings };

await import('../src/api.js');
const recoveredEvidence = WorldStateMachine.Api._test.extractJson(
    '{"evidence":{"currentScene":[],"characters":[{"name":"测试角色"}],"threads":[{"title":"未决线","status":"open"}]',
    { jsonContract: 'evidence' },
);
assert.equal((recoveredEvidence.evidence || recoveredEvidence).threads[0].title, '未决线', '外层未闭合但模块完整时必须本地修复，不能把内层卡片误报为几十个无关JSON');
let operationId = 0;
const complete = (system, payload, options = {}) => WorldStateMachine.Api.withCallBudget(
    1,
    `smoke-${operationId += 1}`,
    () => WorldStateMachine.Api.complete(system, payload, options),
);
assert.deepEqual(await complete('BASE-SYSTEM', { task: 'test' }), { ok: true });
assert.equal(tavernRequest.jsonSchema.name, 'world_state_machine_result');
assert.equal(tavernRequest.responseLength, 3210);
assert.equal(tavernRequest.trimNames, false);
assert.equal(tavernGenerationData.reasoning_effort, 'low');
assert.equal(tavernGenerationData.verbosity, 'low');
assert.match(tavernRequest.prompt[0].content, /BASE-SYSTEM/);
assert.match(tavernRequest.prompt[0].content, /CUSTOM-JAILBREAK-MARKER/);
assert.deepEqual(JSON.parse(tavernRequest.prompt[1].content), { task: 'test' });
assert.deepEqual(await complete('BASE-SYSTEM', { task: 'bounded' }, { maxTokens: 500000 }), { ok: true });
assert.equal(tavernRequest.responseLength, 3210, 'task limits must not override the user configured output budget');

SillyTavern.getContext = () => ({
    async generateRaw() {
        return '<think>先比较 {旧状态}，再作答。</think>\n```json\n{"ok":true,"nested":{"value":"} 在字符串内"}}\n```';
    },
});
assert.deepEqual(await complete('BASE-SYSTEM', { task: 'embedded-json' }), { ok: true, nested: { value: '} 在字符串内' } });
SillyTavern.getContext = () => ({ async generateRaw() { return { ok: true }; } });
assert.deepEqual(await complete('BASE-SYSTEM', { task: 'object-result' }), { ok: true });
SillyTavern.getContext = () => ({ async generateRaw() { throw new Error('Forbidden'); } });
await assert.rejects(complete('BASE-SYSTEM', { task: 'forbidden' }), /Forbidden\/403.*更换酒馆模型.*Planner API/);

let attempts = 0;
SillyTavern.getContext = () => ({
    async generateRaw(request) {
        tavernRequest = request;
        attempts += 1;
        if (attempts === 1) throw new Error('API returned an error Gateway Timeout');
        return '{"ok":true}';
    },
});
await assert.rejects(complete('BASE-SYSTEM', { task: 'retry' }), /Gateway Timeout/);
assert.equal(attempts, 1, 'A bounded completion must not spend a second billable attempt');

let singleAttempts = 0;
SillyTavern.getContext = () => ({
    async generateRaw() { singleAttempts += 1; throw new Error('Got response status 502'); },
});
await assert.rejects(complete('BASE-SYSTEM', { task: 'single-attempt' }, { singleAttempt: true }), /502/);
assert.equal(singleAttempts, 1);

let quotaAttempts = [];
SillyTavern.getContext = () => ({
    async generateRaw(request) {
        tavernRequest = request;
        quotaAttempts.push(request.responseLength);
        if (request.responseLength > 1024) throw new Error('Planner API 403: insufficient_user_quota 预扣费额度失败');
        return '{"ok":true}';
    },
});
await assert.rejects(complete('BASE-SYSTEM', { task: 'quota-backoff' }), /拒绝了请求|额度/);
assert.deepEqual(quotaAttempts, [3210]);
assert.equal(tavernRequest.jsonSchema.name, 'world_state_machine_result');

SillyTavern.getContext = () => ({
    async generateRaw() { throw new Error('Got response status 502'); },
});
await assert.rejects(
    complete('BASE-SYSTEM', { task: 'diagnostic-task' }),
    /502/,
);

const mixedJson = '<think>{"evidence":{"canon":["示例"]}}</think>\n{"state":{"world":{},"map":{},"characters":[]},"plan":{"notes":"最终答案"}}';
const contracted = WorldStateMachine.Api._test.extractJson(mixedJson, { jsonContract: 'state' });
assert.equal(contracted.plan.notes, '最终答案');
assert.equal(WorldStateMachine.Api._test.isGptReasoningModel('[按次]gpt-5.5'), false);
assert.equal(WorldStateMachine.Api._test.responseText({ choices: [{ message: { content: [{ type: 'text', text: '{"ok":true}' }] } }] }), '{"ok":true}');
assert.match(WorldStateMachine.Api._test.providerResponseError({ error: true, quota_error: '预扣额度不足', message: '请求被拒绝' }), /预扣额度不足|请求被拒绝/);

settings.useTavernApi = false;
settings.endpoint = 'https://example.test/v1';
settings.apiKey = 'secret';
settings.model = 'mock-model';
globalThis.getRequestHeaders = async () => ({ 'X-CSRF-Token': 'test' });
let externalRequest;
let forwardedCalls = 0;
globalThis.fetch = async (url, request) => {
    externalRequest = { url, request };
    if (String(url).endsWith('/models')) return { ok: true, status: 200, text: async () => '{"data":[{"id":"model-b"},{"id":"model-a"}]}' };
    forwardedCalls += 1;
    return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"{\\"ok\\":true}"}}]}' };
};
assert.deepEqual(await complete('BASE-SYSTEM', { task: 'external' }), { ok: true });
assert.equal(externalRequest.url, '/api/backends/chat-completions/generate');
const externalBody = JSON.parse(externalRequest.request.body);
assert.equal(externalBody.reverse_proxy, 'https://example.test/v1');
assert.equal(externalBody.proxy_password, 'secret');
assert.match(externalBody.messages[0].content, /CUSTOM-JAILBREAK-MARKER/);
settings.model = '[按次]gpt-5.5';
assert.deepEqual(await complete('BASE-SYSTEM', { task: 'external-alias-reasoning' }, { maxTokens: 3000, reasoningEffort: 'low' }), { ok: true });
const aliasBody = JSON.parse(externalRequest.request.body);
assert.equal(aliasBody.max_tokens, 3000);
assert.equal(aliasBody.reasoning_effort, 'low');
assert.equal(aliasBody.verbosity, 'low');
assert.equal('temperature' in aliasBody, false);
settings.model = 'gpt-5.5';
assert.deepEqual(await complete('BASE-SYSTEM', { task: 'external-gpt' }), { ok: true });
const gptBody = JSON.parse(externalRequest.request.body);
assert.equal(gptBody.max_completion_tokens, 3210);
assert.equal(gptBody.reasoning_effort, 'low');
assert.equal(gptBody.verbosity, 'low');
assert.equal('max_tokens' in gptBody, false);
assert.equal('temperature' in gptBody, false);
const repairedState = WorldStateMachine.Api._test.repairTruncatedJson('{"state":{"world":{"currentConditions":["当前客观状态"]},"characters":[{"id":"char","name":"角色"}],"relationships":[{"id":"unfinished', 'state');
assert.equal(repairedState.state.world.currentConditions[0], '当前客观状态');
assert.equal(repairedState.state.characters[0].name, '角色');
assert.equal(repairedState.state.relationships, undefined, 'an unfinished top-level module must be discarded as a whole');
const repairedEvidence = WorldStateMachine.Api._test.repairTruncatedJson('{"evidence":{"canon":["覆盖全部后半的核心摘要"],"sourceRefs":["chat:1","chat:2"],"characters":[{"name":"unfinished', 'evidence');
assert.equal(repairedEvidence.evidence.canon[0], '覆盖全部后半的核心摘要');
assert.deepEqual(repairedEvidence.evidence.sourceRefs, ['chat:1', 'chat:2']);
assert.equal(repairedEvidence.evidence.characters, undefined, 'an unfinished evidence module must be discarded as a whole');
const parsedStream = WorldStateMachine.Api._test.parseSseResponse('data: {"choices":[{"delta":{"content":"{\\"evidence\\":"}}]}\n\ndata: {"choices":[{"delta":{"content":"{\\"canon\\":[\\"摘要\\"]}}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n');
assert.equal(parsedStream.choices[0].message.content, '{"evidence":{"canon":["摘要"]}}');
assert.equal(parsedStream.choices[0].finish_reason, 'stop');
const callsBeforeBudgetTest = forwardedCalls;
await WorldStateMachine.Api.withCallBudget(2, 'two-call-hard-cap', async () => {
    await WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'cap-a' });
    await WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'cap-b' });
    await assert.rejects(WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'blocked-third' }), /调用上限（2 次）/);
});
assert.equal(forwardedCalls - callsBeforeBudgetTest, 2);
assert.deepEqual(await WorldStateMachine.Api.listModels(), ['model-a', 'model-b']);
assert.equal(externalRequest.url, 'https://example.test/v1/models');

console.log('API smoke tests passed');
