import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } };
globalThis.dispatchEvent = () => {};
const local = new Map();
globalThis.localStorage = {
    getItem: (key) => local.get(key) || null,
    setItem: (key, value) => local.set(key, String(value)),
};

const sourceChat = Array.from({ length: 10 }, (_, index) => ({
    id: `m${index + 1}`,
    index,
    role: index % 2 ? 'assistant' : 'user',
    name: index % 2 ? '角色' : '用户',
    hidden: index === 2,
    content: `${index === 2 ? '用户取得黑塔通行证。' : index === 8 ? '黑塔通行证已经转交给角色。' : `第${index + 1}层普通正文。`}${'连续正文。'.repeat(850)}`,
}));
const ctx = {
    chatMetadata: {},
    chat: sourceChat.map((message) => ({
        is_user: message.role === 'user', is_system: message.hidden, name: message.name, mes: message.content,
        send_date: message.id, extra: {},
    })),
    async saveChat() {},
};
globalThis.SillyTavern = { getContext: () => ctx };

await import('../src/defaults.js');
await import('../src/storage.js');
await import('../src/context.js');
await import('../src/source-reader.js');

const calls = [];
WorldStateMachine.Api = {
    async complete(_prompt, payload) {
        calls.push(payload);
        const refs = [...new Set(payload.sourceChunk.filter((item) => item.kind === 'chat').map((item) => item.ref))];
        const changes = [];
        if (refs.includes('chat:m3')) changes.push({
            factId: 'black-tower-pass-owner', module: 'resourceConstraints', operation: 'upsert', entityId: 'black-tower-pass',
            value: { id: 'black-tower-pass', subjectId: 'user', kind: 'permission', condition: '用户持有黑塔通行证', status: 'active' },
            sourceRefs: ['chat:m3'],
        });
        if (refs.includes('chat:m9')) changes.push({
            factId: 'black-tower-pass-owner', module: 'resourceConstraints', operation: 'upsert', entityId: 'black-tower-pass',
            value: { id: 'black-tower-pass', subjectId: 'char', kind: 'permission', condition: '角色持有黑塔通行证', status: 'active' },
            sourceRefs: ['chat:m9'],
        });
        return {
            evidence: {
                chunkStatus: changes.length ? 'changes' : 'no_long_term_change',
                messageResults: refs.map((ref) => ({ messageId: ref.slice(5), status: changes.some((change) => change.sourceRefs.includes(ref)) ? 'changes' : 'no_long_term_change' })),
                changes,
                conflicts: [],
                summaryChecks: [],
                complete: true,
            },
        };
    },
};

const source = {
    identities: { user: '用户', char: '角色' },
    character: { name: '角色', description: '角色卡' },
    persona: '用户设定',
    worldbooks: [],
    chat: sourceChat,
};
const defaultChunks = WorldStateMachine.SourceReader._test.calibrationChunks(source);
const defaultChatChunks = defaultChunks.filter((chunk) => chunk.kind === 'chat');
assert.ok(defaultChatChunks.length < 10, 'default calibration must merge records into request-sized blocks instead of pre-splitting them into small requests');
assert.ok(defaultChatChunks.some((chunk) => JSON.stringify(chunk.records).length > 40000), 'default blocks should approach the configured 60k source request ceiling');
const coveredText = new Set(defaultChatChunks.flatMap((chunk) => chunk.records).map((record) => `${record.ref}:${record.part || 1}:${record.content}`));
const expectedText = WorldStateMachine.SourceReader._test.sourceRecords(source, WorldStateMachine.SourceReader._test.calibrationSourceBudget({}) - 1200)
    .filter((record) => record.kind === 'chat')
    .map((record) => `${record.ref}:${record.part || 1}:${record.content}`);
assert.ok(expectedText.every((record) => coveredText.has(record)), 'request-sized local merging must preserve every original chat part');
assert.throws(() => WorldStateMachine.SourceReader._test.normalizeCalibrationResult(
    { evidence: { messageResults: [{ messageId: 'm1', status: 'no_long_term_change' }], changes: [] } },
    { kind: 'chat', records: [{ ref: 'chat:m1', kind: 'chat', content: '正文' }] },
    'truncated-test',
), /complete:true/, 'a truncated block must never be accepted as fully understood');
const compactReceipt = WorldStateMachine.SourceReader._test.normalizeCalibrationResult({ evidence: {
    chunkStatus: 'no_long_term_change', readFailedMessageIds: [], changes: [], conflicts: [], summaryChecks: [], complete: true,
} }, { kind: 'chat', records: [
    { ref: 'chat:m1', kind: 'chat', content: '正文一' },
    { ref: 'chat:m2', kind: 'chat', content: '正文二' },
] }, 'compact-test');
assert.deepEqual(compactReceipt.messageResults.map((item) => [item.messageId, item.status]), [
    ['m1', 'no_long_term_change'], ['m2', 'no_long_term_change'],
], 'one compact complete receipt must deterministically fill local per-message status without verbose model output');
const first = await WorldStateMachine.SourceReader.calibrate(source, { chunkChars: 15000 });
assert.ok(calls.length > 2, 'a complete calibration must use bounded blocks instead of two giant requests');
assert.equal(first.audit.totalReadableMessages, 10);
assert.equal(first.audit.processedMessages, 10);
assert.equal(first.audit.hiddenIncluded, 1);
assert.equal(first.audit.failedMessages, 0);
assert.equal(first.ledger.filter((item) => item.factId === 'black-tower-pass-owner').length, 2, 'later updates to the same factId must remain separate ledger transitions');

await import('../src/engine.js');
const hydrated = await WorldStateMachine.Engine._test.buildStateWithinLimit('', {}, WorldStateMachine.Defaults.createState(), {}, undefined, first);
const saved = await WorldStateMachine.Storage.save(hydrated.state, 'calibration-smoke');
await WorldStateMachine.Storage.setHistoryBaseline(saved, { boundary: first.boundary, audit: first.audit });
assert.equal(saved.resourceConstraints.length, 1, 'the current snapshot keeps one version of a fact while the ledger keeps both transitions');
assert.equal(saved.resourceConstraints[0].subjectId, 'char');

const memory = WorldStateMachine.Storage.loadHistoryMemory();
assert.equal(memory.status, 'complete');
assert.equal(Object.values(memory.messages).filter((item) => item.processed).length, 10);
assert.ok(Object.keys(memory.chunks).length > 2);
const recall = WorldStateMachine.Storage.retrieveHistory('使用黑塔通行证进入黑塔', { maxChars: 800, evidenceCount: 2 });
assert.match(recall.text, /黑塔通行证/);
assert.ok(recall.evidence.length >= 1);

const beforeReuse = calls.length;
const second = await WorldStateMachine.SourceReader.calibrate(source, { chunkChars: 15000 });
assert.equal(calls.length, beforeReuse, 'byte-identical calibration chunks must be reused without new API calls');
assert.equal(second.cacheHits, second.chunks);

const previousComplete = WorldStateMachine.Storage.loadHistoryMemory();
const appendedMessage = { id: 'm11', index: 10, role: 'user', name: '用户', hidden: false, content: `准备进入黑塔。${'新增正文。'.repeat(850)}` };
const appendedSource = { ...source, chat: [...source.chat, appendedMessage] };
const workingComplete = WorldStateMachine.Api.complete;
WorldStateMachine.Api.complete = async (prompt, payload, options) => {
    if (payload.sourceChunk.some((item) => item.ref === 'chat:m11')) throw new Error('simulated gateway failure');
    return workingComplete(prompt, payload, options);
};
await assert.rejects(() => WorldStateMachine.SourceReader.calibrate(appendedSource, { chunkChars: 15000 }), /已记录失败状态/);
const afterFailedRefresh = WorldStateMachine.Storage.loadHistoryMemory();
assert.equal(afterFailedRefresh.status, 'complete', 'a failed refresh must keep the prior baseline active');
assert.deepEqual(afterFailedRefresh.ledger, previousComplete.ledger, 'a failed refresh must not replace the active ledger');
assert.equal(afterFailedRefresh.baseline.state.resourceConstraints[0].subjectId, 'char');
assert.match(WorldStateMachine.Storage.retrieveHistory('黑塔通行证', { state: saved }).text, /黑塔通行证/);

const beforeResume = calls.length;
WorldStateMachine.Api.complete = workingComplete;
const resumed = await WorldStateMachine.SourceReader.calibrate(appendedSource, { chunkChars: 15000 });
assert.equal(calls.length, beforeResume + 2, 'resume must reuse successful blocks and retry only deterministic halves of the previously failed block');
assert.equal(resumed.requestAttempts, 2);
assert.equal(resumed.cacheHits, resumed.chunks - 2);
assert.equal(resumed.audit.processedMessages, 11);
const memoryAfterResume = WorldStateMachine.Storage.loadHistoryMemory();
const failedParent = Object.values(memoryAfterResume.chunks).find((chunk) => chunk.status === 'failed');
assert.ok(failedParent, 'failed parent routing marker must survive a successful split resume');
const beforeStableResume = calls.length;
const stableResume = await WorldStateMachine.SourceReader.calibrate(appendedSource, { chunkChars: 15000 });
assert.equal(calls.length, beforeStableResume, 'later resumes must keep using cached child blocks and never retry the known-bad parent');
assert.equal(stableResume.cacheHits, stableResume.chunks);

console.log('History calibration and targeted recall smoke tests passed');
