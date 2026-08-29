import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};

await import('../src/source-reader.js');

const calls = [];
WorldStateMachine.Api = {
    async complete(_prompt, payload, options) {
        calls.push({ payload, options });
        if (payload.task === 'SOURCE_READ_CHUNK') {
            return { digest: { sourceRefs: payload.sourceChunk.map((item) => item.ref), canon: [`chunk-${payload.chunkIndex}`] } };
        }
        if (payload.task === 'SOURCE_MERGE_DIGESTS' || payload.task === 'SOURCE_FINAL_COMPACT') {
            return { digest: { sourceRefs: payload.digestBatch.flatMap((item) => item.sourceRefs || []), canon: ['merged'] } };
        }
        throw new Error(`unexpected task ${payload.task}`);
    },
};

const chat = Array.from({ length: 12 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? 'assistant' : 'user',
    name: index % 2 ? '角色' : '用户',
    content: `UNIQUE-${index}-` + '正文内容。'.repeat(500),
}));
const source = {
    identities: { user: '用户', char: '角色' },
    character: { name: '角色', description: '角色卡资料。'.repeat(800) },
    persona: 'Persona资料。'.repeat(600),
    worldbooks: [{ name: '世界书', entries: [{ id: 'rule', comment: '规则', content: '世界规则。'.repeat(1000) }] }],
    worldbookDiagnostics: { loadedNames: ['世界书'] },
    chat,
    tavernTextContext: { totalMessages: chat.length, includedMessages: chat.length, truncated: false },
    currentUserAction: chat[10],
    latestAssistantText: chat[11],
};

const result = await WorldStateMachine.SourceReader.prepare(source, { chunkChars: 4000, reduceTargetChars: 12000 });
assert.equal(result.stats.chunked, true);
assert.ok(result.stats.chunks > 1);
assert.equal(result.source.tavernTextContext.includedMessages, 12);
assert.equal(result.source.tavernTextContext.truncated, false);
assert.equal(result.source.tavernTextContext.processedInChunks, true);
assert.equal(result.source.chat.length, 8);
assert.equal(result.source.character.processedInSourceDigest, true);
assert.match(result.source.persona, /完整分片读取/);
assert.ok(calls.every((call) => call.options.maxTokens <= 3500));

const readPayload = JSON.stringify(calls.filter((call) => call.payload.task === 'SOURCE_READ_CHUNK').map((call) => call.payload.sourceChunk));
for (let index = 0; index < chat.length; index += 1) assert.match(readPayload, new RegExp(`UNIQUE-${index}-`));
assert.match(readPayload, /角色卡资料/);
assert.match(readPayload, /Persona资料/);
assert.match(readPayload, /世界规则/);

const adaptiveCalls = [];
WorldStateMachine.Api.complete = async (_prompt, payload) => {
    adaptiveCalls.push(payload);
    if (payload.task === 'SOURCE_READ_CHUNK') {
        if (JSON.stringify(payload.sourceChunk).length > 2500) throw new Error('Gateway Timeout');
        return { digest: { sourceRefs: payload.sourceChunk.map((item) => item.ref), canon: ['adaptive'] } };
    }
    if (payload.task === 'SOURCE_MERGE_DIGESTS' || payload.task === 'SOURCE_FINAL_COMPACT') {
        return { digest: { sourceRefs: payload.digestBatch.flatMap((item) => item.sourceRefs || []), canon: ['merged'] } };
    }
    throw new Error(`unexpected task ${payload.task}`);
};
const adaptive = await WorldStateMachine.SourceReader.prepare(source, { chunkChars: 4000, reduceTargetChars: 12000 });
assert.ok(adaptive.stats.adaptiveSplits > 0);
assert.ok(adaptive.stats.requestAttempts > adaptive.stats.chunks);
assert.ok(adaptive.stats.chunks > adaptive.stats.initialChunks);
const successfulAdaptivePayload = JSON.stringify(adaptiveCalls.filter((payload) =>
    payload.task === 'SOURCE_READ_CHUNK' && JSON.stringify(payload.sourceChunk).length <= 2500
).map((payload) => payload.sourceChunk));
for (let index = 0; index < chat.length; index += 1) assert.match(successfulAdaptivePayload, new RegExp(`UNIQUE-${index}-`));
assert.match(successfulAdaptivePayload, /角色卡资料/);
assert.match(successfulAdaptivePayload, /Persona资料/);
assert.match(successfulAdaptivePayload, /世界规则/);

const beforeForced = adaptiveCalls.length;
const forcedSmall = await WorldStateMachine.SourceReader.prepare({
    identities: { user: '用户', char: '角色' },
    character: { name: '角色', description: '短角色卡' },
    persona: '短Persona',
    worldbooks: [],
    chat: [{ id: 'small', role: 'user', content: '短正文也必须先读取' }],
}, { chunkChars: 4000, forceDigest: true, reduceTargetChars: 12000 });
assert.equal(forcedSmall.stats.chunked, true);
assert.ok(adaptiveCalls.slice(beforeForced).some((payload) => payload.task === 'SOURCE_READ_CHUNK'));
assert.ok(Array.isArray(forcedSmall.source.sourceDigest));

console.log('Source reader smoke tests passed');
