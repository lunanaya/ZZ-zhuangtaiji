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
assert.deepEqual(await WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'test' }), { ok: true });
assert.equal(tavernRequest.jsonSchema.name, 'world_state_machine_result');
assert.equal(tavernRequest.responseLength, 3210);
assert.equal(tavernRequest.trimNames, false);
assert.equal(tavernGenerationData.reasoning_effort, 'low');
assert.equal(tavernGenerationData.verbosity, 'low');
assert.match(tavernRequest.prompt[0].content, /BASE-SYSTEM/);
assert.match(tavernRequest.prompt[0].content, /CUSTOM-JAILBREAK-MARKER/);
assert.deepEqual(JSON.parse(tavernRequest.prompt[1].content), { task: 'test' });
assert.deepEqual(await WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'bounded' }, { maxTokens: 500000 }), { ok: true });
assert.equal(tavernRequest.responseLength, 16384);

let attempts = 0;
SillyTavern.getContext = () => ({
    async generateRaw(request) {
        tavernRequest = request;
        attempts += 1;
        if (attempts === 1) throw new Error('API returned an error Gateway Timeout');
        return '{"ok":true}';
    },
});
assert.deepEqual(await WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'retry' }), { ok: true });
assert.equal(attempts, 2);
assert.equal('jsonSchema' in tavernRequest, false);

SillyTavern.getContext = () => ({
    async generateRaw() { throw new Error('Got response status 502'); },
});
await assert.rejects(
    WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'diagnostic-task' }),
    /任务 diagnostic-task 最终失败：.*502.*兼容请求.*502.*输入/,
);

settings.useTavernApi = false;
settings.endpoint = 'https://example.test/v1';
settings.apiKey = 'secret';
settings.model = 'mock-model';
let externalRequest;
globalThis.fetch = async (url, request) => {
    externalRequest = { url, request };
    if (String(url).endsWith('/models')) return { ok: true, status: 200, text: async () => '{"data":[{"id":"model-b"},{"id":"model-a"}]}' };
    return { ok: true, status: 200, text: async () => '{"choices":[{"message":{"content":"{\\"ok\\":true}"}}]}' };
};
assert.deepEqual(await WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'external' }), { ok: true });
assert.equal(externalRequest.url, 'https://example.test/v1/chat/completions');
assert.equal(externalRequest.request.headers.Authorization, 'Bearer secret');
assert.match(JSON.parse(externalRequest.request.body).messages[0].content, /CUSTOM-JAILBREAK-MARKER/);
settings.model = 'gpt-5';
assert.deepEqual(await WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'external-gpt' }), { ok: true });
const gptBody = JSON.parse(externalRequest.request.body);
assert.equal(gptBody.max_completion_tokens, 3210);
assert.equal(gptBody.reasoning_effort, 'low');
assert.equal(gptBody.verbosity, 'low');
assert.equal('max_tokens' in gptBody, false);
assert.equal('temperature' in gptBody, false);
assert.deepEqual(await WorldStateMachine.Api.listModels(), ['model-a', 'model-b']);
assert.equal(externalRequest.url, 'https://example.test/v1/models');

console.log('API smoke tests passed');
