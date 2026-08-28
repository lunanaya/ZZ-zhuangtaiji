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
globalThis.SillyTavern = {
    getContext() {
        return {
            async generateRaw(request) {
                tavernRequest = request;
                return '```json\n{"ok":true}\n```';
            },
        };
    },
};
WorldStateMachine.Settings = { get: () => settings };

await import('../src/api.js');
assert.deepEqual(await WorldStateMachine.Api.complete('BASE-SYSTEM', { task: 'test' }), { ok: true });
assert.equal(tavernRequest.responseLength, 3210);
assert.match(tavernRequest.prompt[0].content, /BASE-SYSTEM/);
assert.match(tavernRequest.prompt[0].content, /CUSTOM-JAILBREAK-MARKER/);
assert.deepEqual(JSON.parse(tavernRequest.prompt[1].content), { task: 'test' });

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
assert.deepEqual(await WorldStateMachine.Api.listModels(), ['model-a', 'model-b']);
assert.equal(externalRequest.url, 'https://example.test/v1/models');

console.log('API smoke tests passed');
