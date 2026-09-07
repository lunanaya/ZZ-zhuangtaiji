import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.getRequestHeaders = () => ({});
globalThis.WorldStateMachine = { Settings: { get: () => ({ useTavernApi: false, endpoint: 'https://example.invalid/v1', model: 'test', maxTokens: 5000 }) } };
globalThis.SillyTavern = { getContext: () => ({ getRequestHeaders: () => ({}) }) };
await import('../src/api.js');
const api = WorldStateMachine.Api;
const run = () => api.withCallBudget(1, 'test', () => api.complete('test', { task: 'SOURCE_READ_SEQUENTIAL_BATCH' }, { stream: true, jsonContract: 'evidence' }));
const chunk = value => new TextEncoder().encode(value);
const event = value => 'data: ' + JSON.stringify(value) + '\n\n';
let cancelled = false;
globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
        controller.enqueue(chunk(event({ choices: [{ delta: { content: '{"evidence":{"canon":[]}}' } }] })));
        controller.enqueue(chunk('data: [DO'));
        controller.enqueue(chunk('NE]\n\n'));
        // Deliberately keep HTTP open, as some proxies do.
    },
    cancel() { cancelled = true; },
}));
const result = await run();
assert.deepEqual(result, { evidence: { canon: [] } });
assert.equal(cancelled, true, 'DONE must finish without waiting for the HTTP socket');
const interrupted = api._test.parseSseResponse(event({ choices: [{ delta: { reasoning_content: 'thinking' } }] }), true);
assert.equal(interrupted.choices[0].finish_reason, '', 'interruption must not be mislabeled as token exhaustion');
assert.equal(interrupted.reasoningChars, 8);
const failureAfterContent = api._test.parseSseResponse(event({ choices: [{ delta: { content: '{}' } }] }) + event({ error: { message: 'Gateway Timeout' } }));
assert.equal(failureAfterContent.error.message, 'Gateway Timeout');
globalThis.fetch = async () => new Response(event({ choices: [{ delta: { content: '{"evidence":{"canon":[]}}' }, finish_reason: 'length' }] }));
const lengthRecovered = await run();
assert.deepEqual(lengthRecovered, { evidence: { canon: [] } }, '输出上限之前已闭合的证据必须安全保留');
console.log('Stream termination, interruption classification and error propagation tests passed');
