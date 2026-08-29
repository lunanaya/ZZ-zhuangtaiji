import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.document = undefined;
globalThis.WorldStateMachine = {};
const memory = new Map();
globalThis.localStorage = {
    getItem(key) { return memory.get(key) || null; },
    setItem(key, value) { memory.set(key, String(value)); },
};

const compilerConfig = {
    enabled: true,
    entryKeys: [],
    knownEntryKeys: [],
    budget: 500,
    contextMessages: 8,
    failClosed: true,
};
WorldStateMachine.Settings = { get: () => ({ worldbookCompiler: compilerConfig, recentMessages: 12, maxSourceChars: 60000 }) };
globalThis.selected_world_info = ['测试世界书'];
globalThis.SillyTavern = {
    getContext() {
        return {
            chat: [{ is_user: true, mes: '测试正文', name: '用户', send_date: 1 }],
            name1: '用户',
            name2: '角色',
            characterId: 0,
            characters: [{ name: '角色', data: {} }],
            async getWorldInfo() {
                return { entries: {
                    1: { uid: 1, comment: '开启条目', content: '开启规则', disable: false, depth: 2 },
                    2: { uid: 2, comment: '关闭条目', content: '关闭规则', disable: true, depth: 3 },
                } };
            },
        };
    },
};

await import('../src/context.js');
const allEntries = await WorldStateMachine.Context.listWorldbookEntries({ includeDisabled: true });
assert.equal(allEntries.length, 2);
assert.equal(allEntries.filter((entry) => entry.enabled).length, 1);
assert.equal(allEntries.find((entry) => !entry.enabled).comment, '关闭条目');

const source = await WorldStateMachine.Context.buildSource({ fullChat: true, preserveFull: true });
assert.equal(source.worldbooks[0].entries.length, 1);
assert.equal(source.worldbooks[0].entries[0].comment, '开启条目');

compilerConfig.entryKeys = allEntries.map((entry) => entry.key);
compilerConfig.knownEntryKeys = [...compilerConfig.entryKeys];
WorldStateMachine.Api = {
    async complete(_prompt, payload) {
        if (payload.task === 'WORLDBOOK_COMPILE') {
            return { entries: payload.entries.map((entry) => ({ key: entry.key, core: [entry.content], triggers: [], rules: [], background: [] })) };
        }
        if (payload.task === 'WORLDBOOK_ROUTE') return { text: '开启规则' };
        if (payload.task === 'WORLDBOOK_ROUTE_MERGE') return { text: '开启规则' };
        throw new Error(`unexpected task ${payload.task}`);
    },
};
await import('../src/worldbook-compiler.js');
const compiled = await WorldStateMachine.WorldbookCompiler.compileConfig(compilerConfig, { force: true, entries: allEntries });
assert.equal(compiled.count, 2);
const processed = await WorldStateMachine.WorldbookCompiler.processSource(source);
assert.equal(processed.blocked, undefined);
assert.equal(processed.selected, 1);
assert.equal(source.compiledWorldbookRules.originalEntriesRemoved, 1);

const largeEntry = {
    key: WorldStateMachine.Context.worldbookEntryKey('测试世界书', 'large'),
    id: 'large', bookName: '测试世界书', comment: '超长条目', enabled: true, depth: 2,
    content: `LARGE-START-${'世界规则。'.repeat(1800)}-LARGE-END`,
};
compilerConfig.entryKeys = [largeEntry.key];
compilerConfig.knownEntryKeys.push(largeEntry.key);
let largeAttempts = 0;
const successfulParts = [];
WorldStateMachine.Api.complete = async (_prompt, payload, options) => {
    assert.ok(options.maxTokens <= 3000);
    largeAttempts += 1;
    if (JSON.stringify(payload.entries).length > 2500) throw new Error('Got response status 502');
    successfulParts.push(...payload.entries.map((entry) => entry.content));
    return { entries: payload.entries.map((entry) => ({ key: entry.key, core: [entry.content], triggers: [], rules: [], background: [] })) };
};
const adaptiveCompiled = await WorldStateMachine.WorldbookCompiler.compileConfig(compilerConfig, { force: true, entries: [largeEntry] });
assert.equal(adaptiveCompiled.count, 1);
assert.ok(largeAttempts > successfulParts.length);
assert.match(successfulParts.join(''), /LARGE-START/);
assert.match(successfulParts.join(''), /LARGE-END/);

console.log('Worldbook enabled/disabled entry smoke tests passed');
