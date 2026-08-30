import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
};
globalThis.dispatchEvent = () => {};
const storage = new Map();
globalThis.localStorage = {
    getItem(key) { return storage.get(key) || null; },
    setItem(key, value) { storage.set(key, String(value)); },
};

await import('../src/defaults.js');

const calls = [];
WorldStateMachine.Api = {
    async complete(_prompt, payload, options) {
        calls.push({ payload, options });
        if (payload.task === 'SOURCE_READ_HALF_ONCE') {
            return {
                evidence: {
                    sourceRefs: payload.sourceRecords.map((item) => item.ref),
                    canon: ['请求 A 已逐项读取'], chronology: [], characters: ['测试角色：前段人物资料'], relationships: [],
                    knowledge: [], locations: [], tasks: [], events: [], causal: [], currentScene: [], uncertainties: [],
                },
            };
        }
        if (payload.task === 'SOURCE_READ_SECOND_HALF_ONCE') {
            return {
                evidence: {
                    sourceRefs: [...(payload.firstHalfEvidence?.sourceRefs || []), ...payload.sourceRecords.map((item) => item.ref)],
                    canon: ['请求 A 已逐项读取', '请求 B 已逐项读取'],
                    chronology: [{ time: '测试时刻', summary: '全部资料时间线' }],
                    characters: ['测试角色：核心角色'],
                    relationships: [], knowledge: [], locations: [{ name: '测试地点' }], tasks: [], events: [], causal: [],
                    currentScene: [{ location: '测试地点', environment: '当前场景' }], uncertainties: [],
                },
            };
        }
        throw new Error(`unexpected task ${payload.task}`);
    },
};
await import('../src/engine.js');

const source = {
    identities: { user: '测试用户', char: '测试角色' },
    character: { name: '测试角色', description: '角色卡完整内容。'.repeat(1200) },
    persona: 'Persona完整内容。'.repeat(700),
    worldbooks: [{
        name: '测试世界书',
        entries: Array.from({ length: 12 }, (_, index) => ({ id: index + 1, comment: `规则${index + 1}`, content: `世界规则${index + 1}。`.repeat(260) })),
    }],
    chat: Array.from({ length: 80 }, (_, index) => ({ id: index + 1, role: index % 2 ? 'assistant' : 'user', name: index % 2 ? '测试角色' : '测试用户', content: `聊天第${index + 1}条完整原文。`.repeat(85) })),
    tavernTextContext: { totalMessages: 80, includedMessages: 80, truncated: false },
    currentUserAction: null,
    latestAssistantText: null,
};
source.currentUserAction = { ...source.chat[78] };
source.latestAssistantText = { ...source.chat[79] };
const payload = {
    phase: 'INITIALIZE_WORLD',
    source,
    currentState: WorldStateMachine.Defaults.createState(),
    stateSchema: WorldStateMachine.Defaults.STATE_SCHEMA,
    moduleOwnership: WorldStateMachine.Defaults.MODULE_OWNERSHIP,
    modulePrompts: WorldStateMachine.Defaults.MODULE_PROMPTS,
};
const settings = { model: '[按次]gpt-5.5', endpoint: 'https://example.test/v1', useTavernApi: false };
const plannerPrompt = WorldStateMachine.Defaults.PLANNER_PROMPT;
const prepared = WorldStateMachine.Engine._test.prepareSourceForStateRequests(source, { plannerPrompt, payload });
assert.equal(prepared.large, true);
assert.ok(prepared.originalChars > 100000, `expected a genuinely large source, got ${prepared.originalChars}`);
assert.ok(prepared.halves[0].length > 0 && prepared.halves[1].length > 0);
assert.equal(prepared.deduplicatedRecords, 2);
assert.deepEqual(prepared.deduplicatedRefs.sort(), ['currentUserAction', 'latestAssistantText']);
assert.equal(prepared.halves.flat().length, prepared.sentRecords);
const allRecordParts = WorldStateMachine.Engine._test.completeSourceRecords(source).map((item) => `${item.ref}:${item.part || 1}:${item.serializedJson}`);
const sentRecordParts = prepared.halves.flat().map((item) => `${item.ref}:${item.part || 1}:${item.serializedJson}`);
const uniqueRecordParts = allRecordParts.filter((item) => !item.startsWith('currentUserAction:') && !item.startsWith('latestAssistantText:'));
assert.deepEqual(sentRecordParts, uniqueRecordParts, 'two-pass preparation must preserve all unique source records in order');
assert.ok(Math.abs(prepared.halfChars[0] - prepared.halfChars[1]) < prepared.originalChars * 0.2, 'request A/B raw source sizes should remain close enough to avoid a gateway timeout');

const result = await WorldStateMachine.Engine._test.buildStateWithinLimit(plannerPrompt, { ...payload, source: null }, payload.currentState, settings, undefined, prepared);
assert.equal(result.state.world.location.current, '测试地点');
assert.equal(result.state.map.rootLabel, '大地图', 'omitted default modules must be filled locally');
assert.equal(result.state.characters[0].name, '测试角色');
assert.equal(result.state.characters.length, 1, 'A/B evidence for the same named character must merge locally');
assert.equal(result.state.characters[0].summary, '测试角色：核心角色', 'later B evidence must update the earlier character snapshot');
assert.equal(result.state.characters[0].description, '测试角色：核心角色');
assert.equal(result.state.characters[0].notes, '测试角色：核心角色');
assert.deepEqual(result.state.tasks, [], 'omitted arrays must be filled locally');
assert.equal(calls.length, 2);
assert.deepEqual(calls.map((call) => call.payload.task), ['SOURCE_READ_HALF_ONCE', 'SOURCE_READ_SECOND_HALF_ONCE']);
assert.equal(calls[0].options.jsonContract, 'evidence');
assert.equal(calls[1].options.jsonContract, 'evidence');
assert.equal(calls[1].options.maxTokens, 5000);
assert.equal(calls[1].options.stream, true);
assert.equal(calls[1].options.reasoningEffort, undefined);
assert.equal(calls[1].payload.modulePrompts, undefined, 'request B must not resend local module prompt text');
assert.equal(calls[1].payload.stateSchema, undefined, 'request B must not resend the verbose state schema');
assert.equal(calls[1].payload.stateShape, undefined, 'request B only returns merged evidence; state hydration is local');
assert.equal(calls[1].payload.currentState, undefined, 'request B must not resend current state');
assert.ok(calls.every((call) => call.options.singleAttempt === true));
assert.equal(calls[0].payload.sourceRecords.length + calls[1].payload.sourceRecords.length, prepared.sentRecords);
const progress = WorldStateMachine.Engine.getProgress();
assert.match(progress.steps.map((step) => `${step.message} ${step.details}`).join('\n'), /原文分片 .*请求 A 读取.*API 1\/2/);
assert.match(progress.steps.map((step) => `${step.message} ${step.details}`).join('\n'), /请求 B 读取并合并证据.*API 2\/2/);

calls.length = 0;
const preparedAgain = WorldStateMachine.Engine._test.prepareSourceForStateRequests(source, { plannerPrompt, payload });
await WorldStateMachine.Engine._test.buildStateWithinLimit(plannerPrompt, { ...payload, source: null }, payload.currentState, settings, undefined, preparedAgain);
assert.equal(calls.length, 1, 'a successful request-A evidence result should be reusable after a request-B failure/retry');
assert.equal(calls[0].payload.task, 'SOURCE_READ_SECOND_HALF_ONCE');
assert.equal(preparedAgain.cacheHits, 1);
assert.equal(preparedAgain.requestAttempts, 1);

console.log('Two-pass large-source smoke tests passed');
