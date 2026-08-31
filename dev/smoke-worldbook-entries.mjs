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
WorldStateMachine.Settings = {
    get: () => ({ worldbookCompiler: compilerConfig, recentMessages: 12, maxSourceChars: 60000 }),
    update: ({ worldbookCompiler }) => { if (worldbookCompiler) Object.assign(compilerConfig, worldbookCompiler); },
};
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
const nestedEntries = WorldStateMachine.Context._test.normalizeEntries({ world: { entries: [{ id: 'nested', content: { text: '嵌套正文' } }] } }, { includeDisabled: true });
assert.equal(nestedEntries[0].content, '嵌套正文');
const allEntries = await WorldStateMachine.Context.listWorldbookEntries({ includeDisabled: true });
assert.equal(allEntries.length, 2);
assert.equal(allEntries.filter((entry) => entry.enabled).length, 1);
assert.equal(allEntries.find((entry) => !entry.enabled).comment, '关闭条目');
const directBook = await WorldStateMachine.Context.readWorldbook('测试世界书', undefined, { includeDisabled: true });
assert.ok(directBook.entries.every((entry) => entry.key && entry.key !== 'undefined'));

const source = await WorldStateMachine.Context.buildSource({ fullChat: true, preserveFull: true });
assert.equal(source.worldbooks[0].entries.length, 1);
assert.equal(source.worldbooks[0].entries[0].comment, '开启条目');

compilerConfig.entryKeys = allEntries.map((entry) => entry.key);
compilerConfig.knownEntryKeys = [...compilerConfig.entryKeys];
WorldStateMachine.Api = {
    async withCallBudget(_max, _label, operation) { return operation(); },
    async complete(_prompt, payload) {
        if (payload.task === 'WORLDBOOK_COMPILE_ONCE') {
            return { entries: payload.entries.map((entry) => ({ key: entry.key, core: [entry.content], triggers: [], rules: [], background: [] })) };
        }
        if (payload.task === 'WORLDBOOK_ROUTE_ONCE') return { text: '开启规则', byDepth: { 2: '开启规则' } };
        throw new Error(`unexpected task ${payload.task}`);
    },
};
await import('../src/worldbook-compiler.js');
const nativePayload = {
    globalLore: [
        { world: '测试世界书', uid: 1, content: '开启规则' },
        { world: '其他世界书', uid: 99, content: '未交给插件管理的规则' },
    ],
    characterLore: [], chatLore: [], personaLore: [],
};
const nativeRemoved = WorldStateMachine.WorldbookCompiler._test.filterNativeWorldbookEntries(nativePayload, compilerConfig);
assert.equal(nativeRemoved, 1, '已交给拆解器的条目必须在酒馆组装世界书前/后之前移除');
assert.deepEqual(nativePayload.globalLore.map((entry) => entry.content), ['未交给插件管理的规则'], '未选择的原生世界书条目必须继续由酒馆正常注入');
assert.deepEqual(WorldStateMachine.WorldbookCompiler._test.compiledResultItems({ core: ['直接结果'] }, [{ key: 'only' }]), [{ core: ['直接结果'] }]);
assert.deepEqual(WorldStateMachine.WorldbookCompiler._test.compiledResultItems({ entry: { rules: ['单条包装'] } }, [{ key: 'only' }]), [{ rules: ['单条包装'] }]);
assert.deepEqual(WorldStateMachine.WorldbookCompiler._test.compiledResultItems({ core: ['不能猜归属'] }, [{ key: 'a' }, { key: 'b' }]), []);
const compactGroups = WorldStateMachine.WorldbookCompiler._test.compactRuleGroups({
    core: Array.from({ length: 9 }, (_, index) => `核心规则${index}`),
    triggers: Array.from({ length: 7 }, (_, index) => `触发情境${index}`),
    rules: Array.from({ length: 9 }, (_, index) => `条件规则${index}`),
    background: Array.from({ length: 5 }, (_, index) => `必要背景${index}`),
});
assert.ok(Object.values(compactGroups).flat().length <= 12, '单个世界书规则卡不得膨胀到十几二十条以上');
assert.ok(compactGroups.core.length <= 3);
assert.ok(compactGroups.triggers.length <= 3);
assert.ok(compactGroups.rules.length <= 5);
assert.ok(compactGroups.background.length <= 2);
const etiquetteGroups = WorldStateMachine.WorldbookCompiler._test.sourceRuleGroups(`
核心原则：人物行为必须符合身份、场合与礼法。
大家闺秀外出必须有合理理由，并需母亲、嬷嬷或贴身丫鬟陪同。
男性进入别人内宅属于禁区，除非至亲或得到特殊许可。
有身份者身边通常有仆从，私密交谈需要避开旁观者。
男女之间不得随意身体接触。
公开场合必须履行社会职责，严禁因私人感情抛下职责。
情节应通过宴席、媒妁或仆人传信等合乎身份的渠道推进。
生成前必须检查场合、身份与在场旁观者。
`);
assert.ok(etiquetteGroups.rules.length >= 4, '规则型世界书必须保留多个独立可执行约束，不能只摘录开头口号');
assert.match([...etiquetteGroups.rules, ...etiquetteGroups.triggers].join('\n'), /外出.*陪同/);
assert.match([...etiquetteGroups.rules, ...etiquetteGroups.triggers].join('\n'), /内宅.*许可/);
assert.match([...etiquetteGroups.rules, ...etiquetteGroups.triggers].join('\n'), /公开场合.*职责/);
const semanticCompiled = [{ compiled: {
    depth: 4,
    core: ['人物言行必须符合身份与场合。'],
    triggers: [], rules: [], background: [],
    fragments: [
        { type: 'rule', cues: ['皇权','朝政'], text: '皇权决策必须符合既定君臣权力边界。' },
        { type: 'rule', cues: ['选秀','采选'], text: '选秀启动时必须遵守候选资格与宫廷程序。' },
        { type: 'character', cues: ['夏以昼'], text: '夏以昼是掌握兵权的皇帝。' },
    ],
} }];
const imperialRoute = WorldStateMachine.WorldbookCompiler._test.localRoute({ budget: 500 }, semanticCompiled, [{ role: 'user', content: '我想问皇权如何约束朝政。' }]);
assert.match(imperialRoute.text, /身份与场合/);
assert.match(imperialRoute.text, /皇权决策/);
assert.doesNotMatch(imperialRoute.text, /选秀启动|夏以昼是/);
const selectionRoute = WorldStateMachine.WorldbookCompiler._test.localRoute({ budget: 500 }, semanticCompiled, [{ role: 'user', content: '宫中马上要开始选秀。' }]);
assert.match(selectionRoute.text, /选秀启动/);
assert.doesNotMatch(selectionRoute.text, /皇权决策/);
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
assert.equal(largeAttempts, 1, 'worldbook compilation must not exceed its single billable request cap');
assert.equal(successfulParts.length, 0);
assert.match([...memory.values()].join('\n'), /LARGE-START/);

console.log('Worldbook enabled/disabled entry smoke tests passed');
