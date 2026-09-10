import assert from 'node:assert/strict';
globalThis.window = globalThis;
const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
globalThis.WorldStateMachine = {};
await import('../src/defaults.js');
await import('../src/facts.js');
let state = WorldStateMachine.Defaults.createState();
const config = { enabled: true, entryKeys: ['book::1', 'book::2', 'book::3'], budget: 120 };
const settings = { enabled: true, worldbookCompiler: config, injectionMaxChars: 500, injectionModules: WorldStateMachine.Defaults.INJECTION_MODULES };
WorldStateMachine.Settings = { get: () => settings };
WorldStateMachine.Storage = { load: () => state };
const events = new Map();
const ctx = { eventSource: { on: (name, fn) => events.set(name, fn) }, event_types: { WORLDINFO_ENTRIES_LOADED: 'loaded', WORLD_INFO_ACTIVATED: 'activated' }, setExtensionPrompt() {} };
WorldStateMachine.Context = { context: () => ctx };
let apiCalls = 0;
const longBackground = '书院建在城北，藏书楼有三层，庭院种有桂树，院长负责教学与藏书。'.repeat(95);
const sourceRules = '只有持有许可时才允许进入内院，必须经过守卫核验；每日最多进入2次，禁止携带武器，除非持有皇帝特许。';
const originals = [
    { uid: 1, world: 'book', key: ['书院'], content: longBackground, position: 0, depth: 4, role: 0, order: 90, disable: false },
    { uid: 2, world: 'book', key: ['不存在的触发词'], content: sourceRules, position: 1, depth: 7, role: 2, order: 80, disable: false, probability: 0, group: 'exclusive', cooldown: 8 },
    { uid: 3, world: 'book', key: [], content: '禁用原文不得出现', position: 1, disable: true },
    { uid: 4, world: 'other', key: [], content: '未选条目保持原样', position: 1 },
];
const sourceSnapshot = structuredClone(originals);
const entries = originals.slice(0, 3).map(entry => ({ ...entry, key: `${entry.world}::${entry.uid}`, id: entry.uid, bookName: entry.world, enabled: !entry.disable }));
WorldStateMachine.Api = {
    withCallBudget: (_limit, _label, run) => run(),
    async complete(prompt, payload) {
        apiCalls++;
        assert.match(prompt, /必须保留所有不同信息/);
        assert.doesNotMatch(prompt, /十分之一|3000字约300字/);
        assert.equal(payload.task, 'WORLDBOOK_COMPILE_ONCE');
        assert.equal(payload.entries[0].content, longBackground, '完整原文进入压缩请求');
        return { entries: payload.entries.map(entry => ({ key: entry.key,
            modules: entry.paragraphs.map(part => ({ title: '完整资料', sourceParagraphIds: [part.id], content: entry.key === 'book::1' ? '书院建在城北，藏书楼有三层，庭院种有桂树，院长负责教学与藏书。' : part.content, conditions: entry.key === 'book::2' ? ['仅持有许可时可进入'] : [], exceptions: entry.key === 'book::2' ? ['皇帝特許'] : [] })),
            summary: entry.key === 'book::1' ? '书院位于城北，藏书楼三层，院内种桂树；院长负责教学和藏书。' : '内院实行许可制。',
            compressedRules: entry.key === 'book::2' ? [{ sourceParagraphIds: ['p1'], statement: '必须凭许可经守卫核验入内院，每日最多2次；禁止携带武器。', conditions: ['仅持有许可时允许进入'], exceptions: ['皇帝特许可携武器'] }] : [],
        })) };
    },
};
await import('../src/worldbook-compiler.js');
await import('../src/injection.js');
const compiler = WorldStateMachine.WorldbookCompiler;
const result = await compiler.compileConfig(config, { force: true, entries });
assert.equal(apiCalls, 1);
assert.equal(result.fallbackCount, 1);
const report = compiler.getReport();
assert.equal(report.entries[0].referenceText, '书院建在城北，藏书楼有三层，庭院种有桂树，院长负责教学与藏书。', '保留原有信息且允许合并重复表述');
assert.ok(report.entries.every(entry => entry.compiledChars <= entry.originalChars), '实际发送文本不得比原文长');
assert.ok(report.entries[1].referenceText.includes(sourceRules), '硬规则须保持完整原文');
assert.equal(report.entries[1].ruleFallbackCount, 1);
const initialReferences = compiler.getReferenceModules();
assert.equal(initialReferences.length, 2, '禁用条目不参与参考');
state.worldRules = compiler.getStaticCatalog().worldRules.map(rule => ({ ...rule, delivery: 'resident' }));
const savedRuleCount = state.worldRules.length;
assert.equal(WorldStateMachine.Injection.fallbackBlocks(state).worldRules, '', '旧状态中的原文规则副本不再重复发送');
assert.equal(state.worldRules.length, savedRuleCount, '不删除旧状态记录');
const payload = () => ({ globalLore: [...originals], characterLore: [], chatLore: [], personaLore: [] });
assert.equal(compiler.installNativeWorldbookFilter(), true);
let native = payload();
events.get('loaded')(native);
assert.deepEqual(originals, sourceSnapshot, '不能修改原世界书对象');
assert.deepEqual(native.globalLore.map(entry => [entry.position, entry.depth, entry.role, entry.order]), originals.map(entry => [entry.position, entry.depth, entry.role, entry.order]));
assert.equal(native.globalLore[2], originals[2]);
assert.equal(native.globalLore[3], originals[3]);
assert.equal(native.globalLore[0].content, report.entries[0].referenceText);
assert.match(native.globalLore[1].content, /禁止携带武器/);
assert.match(native.globalLore[1].content, /皇帝特许/);
assert.equal(native.globalLore[1].constant, true);
assert.equal(native.globalLore[1].ignoreBudget, true);
assert.equal(native.globalLore[1].probability, 100);
assert.equal(native.globalLore[1].cooldown, 0);
assert.equal(native.globalLore[1].group, '');
events.get('activated')(native.globalLore.slice(0, 2));
assert.equal(compiler.getReport().delivery.modules.filter(module => module.activated).length, 2);
const expectedContents = native.globalLore.map(entry => entry.content);
const whitespacePayload = payload();
whitespacePayload.globalLore[0] = { ...originals[0], content: '\n' + originals[0].content + '\n\n' };
events.get('loaded')(whitespacePayload);
assert.equal(whitespacePayload.globalLore[0].content, expectedContents[0], '原生内容与读取器的首尾空白差异不能使摘要失效');
state.runtime.finalInjectionOverride = '状态临时覆盖';
for (const module of Object.values(settings.injectionModules)) module.enabled = false;
assert.equal(WorldStateMachine.Injection.preview(state), '状态临时覆盖');
native = payload(); events.get('loaded')(native);
assert.deepEqual(native.globalLore.map(entry => entry.content), expectedContents, '临时状态覆盖和状态开关不影响世界书');
state = WorldStateMachine.Defaults.createState();
settings.enabled = false;
native = payload(); events.get('loaded')(native);
assert.deepEqual(native.globalLore.map(entry => entry.content), expectedContents, '清空状态与关闭实时状态不改变独立世界书');
const cacheBeforeSettlement = [...memory.values()];
compiler.ingestReadResult({ worldbooks: [{ entries }] }, { worldbookEntries: [{ key: 'book::2', summary: '可以无许可入内' }] });
assert.deepEqual([...memory.values()], cacheBeforeSettlement, '结算没有世界书写权限');
assert.throws(() => compiler.updateCompiledEntry('book::2', {}), /固定世界书参考/);
const rawChat = [{ role: 'user', content: sourceRules }];
await compiler.processChat(rawChat);
assert.equal(rawChat[0].content, sourceRules, '不能从用户聊天中剔除世界书原文');
const fallback = compiler._test.referenceData({ summary: '测试', compressedRules: [{ sourceParagraphIds: ['p1'], statement: '所有人物必须经过守卫才能进入内院', conditions: [], exceptions: [] }] }, entries[1]);
assert.equal(fallback.referenceVersion, 3);
assert.equal(fallback.coveredParagraphCount, fallback.sourceParagraphCount);
assert.ok(fallback.hardRules.includes(sourceRules));
const expanded = compiler._test.referenceData({ modules: [{ title: '很长的模块标题'.repeat(40), sourceParagraphIds: ['p1'], content: longBackground + '新增扩写' }] }, entries[0]);
assert.equal(compiler._test.referenceText({ ...entries[0], ...expanded }), longBackground, '整理变长时保留完整原文，不能截断');
const shortEntry = { key: 'tiny::0', content: '雨停了。' };
const shortResult = compiler._test.referenceData({}, shortEntry);
assert.equal(compiler._test.referenceText({ ...shortEntry, ...shortResult }), shortEntry.content, '标题与说明不能使短条目变长');
const compressibleRule = { ...entries[1], content: sourceRules.repeat(8) };
const conciseRule = compiler._test.referenceData({ modules: [{ sourceParagraphIds: ['p1'], title: '内院通行', content: '必须经守卫核验入内院，每日最多2次，禁止携带武器。', conditions: ['只有持有许可时才允许进入'], exceptions: ['持有皇帝特许时可携带武器'] }] }, compressibleRule);
assert.equal(conciseRule.ruleFallbackCount, 0, '规则可以精炼重复表述，条件和例外仍独立保留');
assert.ok(conciseRule.referenceBody.length < compressibleRule.content.length);
const completeEntry = { key: 'coverage::1', bookName: '覆盖检查', comment: '完整资料', content: '第一段：远方小镇每年举办灯会。\n\n第二段：客房窗边放着一本蓝色旧册。\n\n第三段：守卫禁止无许可通行，除非持有特许。\n\n第四段：远方小镇每年举办灯会。' };
const incompleteModel = { modules: [
    { title: '仅命名中段', sourceParagraphIds: ['p2'], content: '不能接受的改写正文'.repeat(30) },
    { title: '重复引用', sourceParagraphIds: ['p2', 'not-a-source'] },
] };
const preserved = compiler._test.referenceData(incompleteModel, completeEntry);
assert.deepEqual(preserved.referenceModules.map(module => module.content), compiler._test.paragraphRecords(completeEntry).map(part => part.content), '漏答、重复和无效引用均不得改变任何原文段落或顺序');
assert.equal(preserved.coveredParagraphCount, 4);
assert.doesNotMatch(compiler._test.referenceText({ ...completeEntry, ...preserved }), /不能接受的改写正文/);
const migrated = compiler._test.referenceText({ ...completeEntry, label: completeEntry.comment, referenceVersion: 1, summary: '只剩一行的旧摘要', compiledText: completeEntry.content });
for (const part of compiler._test.paragraphRecords(completeEntry)) assert.ok(migrated.includes(part.content), '旧压缩缓存自动恢复全部段落');
assert.doesNotMatch(migrated, /只剩一行的旧摘要/);
const changed = structuredClone(originals);
changed[1].content = '禁止进入内院，原有许可全部失效。';
native = { globalLore: changed, characterLore: [], chatLore: [], personaLore: [] };
events.get('loaded')(native);
assert.match(native.globalLore[1].content, /原有许可全部失效/);
assert.doesNotMatch(native.globalLore[1].content, /皇帝特许可携武器/, '原文变化后不能发送旧摘要');
assert.equal(apiCalls, 1, '生成与结算不产生压缩API调用');
config.enabled = false;
native = payload(); events.get('loaded')(native);
assert.deepEqual(native.globalLore, originals, '显式关闭世界书拆解恢复原生原文路径');
assert.deepEqual(compiler.getReferenceModules(), []);
console.log('PASS independent worldbook: complete source coverage, immutable source, native slots, forced rules, fallback, state isolation, source invalidation, no background API');
