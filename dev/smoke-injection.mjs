import assert from 'node:assert/strict';

globalThis.window = globalThis;
globalThis.extension_settings = {
    worldStateMachine: {
        plannerPrompt: '旧规则包含因果链与延迟因果',
        reconcilerPrompt: '旧结算规则',
        modulePrompts: { causalLinks: '旧因果链', causalSeeds: '旧延迟因果' },
    },
};
globalThis.CustomEvent = class CustomEvent {
    constructor(type) { this.type = type; }
};
globalThis.dispatchEvent = () => {};
const localValues = new Map();
globalThis.localStorage = {
    getItem(key) { return localValues.has(key) ? localValues.get(key) : null; },
    setItem(key, value) { localValues.set(key, String(value)); },
    removeItem(key) { localValues.delete(key); },
};
const testContext = { extensionSettings: globalThis.extension_settings, chatMetadata: {} };
globalThis.SillyTavern = {
    getContext() {
        return testContext;
    },
};

await import('../src/defaults.js');
await import('../src/settings.js');
await import('../src/storage.js');
await import('../src/dice.js');
await import('../src/context.js');
await import('../src/worldbook-compiler.js');
await import('../src/injection.js');
await import('../src/engine.js');

const state = WorldStateMachine.Defaults.createState();
assert.equal(Object.keys(WorldStateMachine.Settings.get().modulePrompts).length, Object.keys(WorldStateMachine.Defaults.MODULE_PROMPTS).length);
assert.equal(WorldStateMachine.Settings.get().rulesVersion, 7);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /寻常因果影响/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /实际 user\/assistant 正文/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /剧情压力与空转侦测器/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /Phantasm 世界运作逻辑（最高优先级）/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /LOAD → PARSE → ADJUDICATE → ADVANCE → COMMIT/);
assert.match(WorldStateMachine.Settings.get().plannerPrompt, /有效变化点/);
assert.match(WorldStateMachine.Settings.get().reconcilerPrompt, /Phantasm 世界运作逻辑（最高优先级）/);
assert.match(WorldStateMachine.Settings.get().reconcilerPrompt, /不是可选择的模式/);
assert.match(WorldStateMachine.Settings.get().promptMigrationBackup.plannerPrompt, /因果链与延迟因果/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.relationships, /禁止.*评分/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.causalEffects, /动机、能力、机会/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.planner, /停滞/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.planner, /sourceType/);
assert.match(WorldStateMachine.Settings.get().modulePrompts.planner, /一轮最多一个变化点/);
assert.equal('scenePressure' in WorldStateMachine.Settings.get().modulePrompts, false);
assert.equal('actorCausality' in WorldStateMachine.Settings.get().modulePrompts, false);
assert.equal('backgroundQueue' in WorldStateMachine.Settings.get().modulePrompts, false);
assert.equal('advanceScheduler' in WorldStateMachine.Settings.get().modulePrompts, false);
assert.equal(state.world.time.display, '');
assert.equal(state.world.location.current, '');
assert.deepEqual(state.characters, []);
assert.deepEqual(state.npcActivities, []);
assert.equal(WorldStateMachine.Defaults.INJECTION_MODULES.ambient.enabled, true);
assert.equal(WorldStateMachine.Settings.get().blockOnPlannerError, false);
state.identities = { user: '林知夏', char: '夏以昼' };
state.world.time.display = '周二 14:30';
state.world.location.current = '夏家·客厅';
state.world.facts = ['夏以昼16:00有既定公司会议'];
state.map = {
    currentLocationId: 'living',
    locations: [{ id: 'living', name: '夏家·客厅', area: '夏家', status: 'visited' }, { id: 'entry', name: '夏家·玄关', area: '夏家', status: 'known' }],
    routes: [{ from: 'living', to: 'entry', description: '穿过短廊', status: 'open' }],
};
state.characters = [
    { id: 'user', name: 'user', present: true, location: '夏家·客厅' },
    { id: 'char', name: 'char', present: true, location: '夏家·客厅' },
];
state.relationships = [{ from: 'user', to: 'char', status: '相互试探' }];
state.npcActivities = [{ characterId: 'char', location: '夏家·客厅', action: '整理会议文件' }];
state.events = [{
    id: 'event-talk',
    title: '午后谈话',
    status: 'active',
    developments: ['夏以昼16:00有既定公司会议', '双方的交流仍然平稳'],
}];

const result = WorldStateMachine.Injection.compose(state);
assert.match(result, /\[外置状态权威\]/);
assert.match(result, /不得另行输出 <INDRS>/);
assert.equal(result.match(/夏以昼16:00有既定公司会议/g)?.length, 1);
assert.match(result, /午后谈话最新进展：双方的交流仍然平稳/);
assert.doesNotMatch(result, /午后谈话最新进展：夏以昼16:00/);
assert.match(result, /林知夏：在场/);
assert.match(result, /夏以昼：在场/);
assert.match(result, /林知夏→夏以昼：相互试探/);
assert.match(result, /夏以昼：夏家·客厅｜整理会议文件/);
assert.match(result, /夏家·客厅 → 夏家·玄关：可通行；穿过短廊/);
assert.doesNotMatch(result, /\b(?:user|char)→|(?:：|>)\s*(?:user|char)\b/i);

const plannerNamed = WorldStateMachine.Injection.compose(state, {}, { planner: 'user可以继续与<char>交流' });
assert.match(plannerNamed, /林知夏可以继续与夏以昼交流/);
assert.doesNotMatch(plannerNamed, /<char>|\buser\b/i);

const fourModulePlan = WorldStateMachine.Injection.compose(state, {
    sceneAssessment: { status: 'quiet', shouldAdvance: false, intensity: 'none', evidence: ['交流仍有新内容'] },
    actorDecisions: [{ characterId: 'char', action: '继续整理文件', allowed: true }],
    backgroundQueue: [{ sourceType: 'task', sourceId: 'meeting', decision: 'carry', reason: '尚未到时间' }],
    advanceDecision: { mode: 'continue', intensity: 'none', direction: '继续当前交流', reason: '无需制造额外事件' },
});
assert.match(fourModulePlan, /本轮方向：继续当前交流/);
assert.match(fourModulePlan, /推进方式：continue；强度：none/);
assert.doesNotMatch(fourModulePlan, /尚未到时间/);

const ratingFree = WorldStateMachine.Injection.compose(state, {}, { relationships: '林知夏→夏以昼：熟悉但谨慎\n亲密度：38\ntrust=42\n紧张 31%' });
assert.match(ratingFree, /熟悉但谨慎/);
assert.doesNotMatch(ratingFree, /38|42|31%|trust=/i);

const ambient = WorldStateMachine.Injection.compose(state, {
    ambientResponses: [{ actor: '邻座乘客', response: '因两人的打闹回头看了一眼，随后继续看书' }],
});
assert.match(ambient, /\[环境与路人反应\]/);
assert.match(ambient, /邻座乘客：因两人的打闹回头看了一眼/);
assert.equal(state.characters.some((item) => item.name === '邻座乘客'), false);

const timelinePrivate = WorldStateMachine.Injection.compose(state, {}, { timeline: '不应发送给正文模型的历史记录' });
assert.doesNotMatch(timelinePrivate, /不应发送给正文模型的历史记录/);
assert.equal(Object.prototype.hasOwnProperty.call(WorldStateMachine.Defaults.INJECTION_MODULES, 'timeline'), false);

const allModulesEnabled = Object.fromEntries(Object.entries(WorldStateMachine.Defaults.INJECTION_MODULES)
    .map(([id, config]) => [id, { ...config, enabled: true }]));
WorldStateMachine.Settings.update({ injectionModules: allModulesEnabled, injectionMaxChars: 3500 });
const crowdedBlocks = Object.fromEntries(Object.keys(WorldStateMachine.Defaults.INJECTION_MODULES)
    .map((id, index) => [id, `${id}-UNIQUE-${String(index).padStart(2, '0')}-` + '内容'.repeat(180)]));
const crowdedInjection = WorldStateMachine.Injection.compose(state, {}, crowdedBlocks);
Object.values(WorldStateMachine.Defaults.INJECTION_MODULES).forEach((config) => {
    assert.match(crowdedInjection, new RegExp(`\\[${config.label}\\]`));
});
assert.ok(crowdedInjection.length <= 3500 + '<WORLD_STATE>\n\n</WORLD_STATE>'.length);
assert.match(crowdedInjection, /本模块已按预算压缩/);
WorldStateMachine.Settings.update({ injectionMaxChars: 500 });
const tightInjection = WorldStateMachine.Injection.compose(state, {}, crowdedBlocks);
Object.values(WorldStateMachine.Defaults.INJECTION_MODULES).forEach((config) => {
    assert.match(tightInjection, new RegExp(`\\[${config.label}\\]`));
});
assert.match(tightInjection, /本模块已按预算压缩/);
WorldStateMachine.Settings.update({ injectionMaxChars: 3500 });

const customModulePrompts = { ...WorldStateMachine.Settings.get().modulePrompts, world: 'WORLD-EDITABLE-PROMPT-UNIQUE' };
WorldStateMachine.Settings.update({ modulePrompts: customModulePrompts, injectionMaxChars: 12000 });
const editablePromptInjection = WorldStateMachine.Injection.compose(state);
assert.match(editablePromptInjection, /WORLD-EDITABLE-PROMPT-UNIQUE/);
WorldStateMachine.Settings.update({ injectionMaxChars: 3500 });

assert.match(WorldStateMachine.Engine._test.generationBlockReason({ blockOnPlannerError: true }, { error: 'timeout' }), /timeout/);
assert.equal(WorldStateMachine.Engine._test.generationBlockReason({ blockOnPlannerError: false }, { error: 'timeout' }), '');

assert.equal(WorldStateMachine.Settings.get().diceEnabled, false);
const diceRound = WorldStateMachine.Dice.createRound('test-turn');
assert.ok(diceRound.intensity.number >= 1 && diceRound.intensity.number <= 20);
assert.ok(diceRound.direction.number >= 1 && diceRound.direction.number <= 20);
assert.ok(diceRound.checkPool.length >= 1 && diceRound.checkPool.length <= 4);
assert.equal(WorldStateMachine.Dice.outcome(1), 'critical-failure');
assert.equal(WorldStateMachine.Dice.outcome(10), 'failure');
assert.equal(WorldStateMachine.Dice.outcome(11), 'success');
assert.equal(WorldStateMachine.Dice.outcome(20), 'critical-success');
assert.doesNotMatch(WorldStateMachine.Injection.compose(state, { diceRound }), /\[骰子推进/);
WorldStateMachine.Settings.update({ diceEnabled: true });
const diceInjection = WorldStateMachine.Injection.compose(state, { diceRound });
assert.match(diceInjection, /^<WORLD_STATE>\n\[骰子推进｜优先执行\]/);
assert.match(diceInjection, /日常必然行为.*不检定/);
assert.match(diceInjection, /1=大失败.*2–10=失败.*11–19=成功.*20=大成功/);
assert.match(diceInjection, /<check>\[姓名\|结果\|数字\|/);
WorldStateMachine.Settings.update({ diceEnabled: false });

testContext.chat = [
    { is_user: true, name: '林知夏', mes: '我和他在飞机上闹起来了。', send_date: 'u1' },
    { is_user: false, name: '夏以昼', mes: '他笑着伸手挡住我的反击。', send_date: 'a1' },
];
globalThis.selected_world_info = ['分析世界书'];
testContext.getWorldInfo = async (name) => name === '分析世界书' ? {
    entries: {
        0: { uid: 0, comment: '公共场所规则', content: '公共场所允许合乎比例的旁观者反应。', disable: false },
        1: { uid: 1, comment: '未勾选规则', content: '这条未勾选原文应保持原样。', disable: false },
    },
} : { entries: {} };
const source = await WorldStateMachine.Context.buildSource();
assert.equal(source.tavernTextContext.source, 'SillyTavern.getContext().chat');
assert.equal(source.tavernTextContext.includedMessages, 2);
assert.match(source.chat[0].content, /飞机上闹起来/);
assert.match(source.latestAssistantText.content, /伸手挡住/);
assert.deepEqual(source.worldbookDiagnostics.loadedNames, ['分析世界书']);
assert.equal(source.worldbookDiagnostics.entryCounts['分析世界书'], 2);
assert.match(source.worldbooks[0].entries[0].content, /旁观者反应/);

const selectedKey = WorldStateMachine.Context.worldbookEntryKey('分析世界书', '0');
WorldStateMachine.Settings.update({ worldbookCompiler: { enabled: true, entryKeys: [selectedKey], budget: 300, contextMessages: 8, failClosed: true } });
WorldStateMachine.Api = {
    async complete(_system, payload) {
        if (payload.task === 'WORLDBOOK_COMPILE') return { entries: payload.entries.map((entry) => ({ key: entry.key, core: ['公共场景中只允许合乎比例的旁观者反应'], triggers: ['公共场景'], rules: [], background: [] })) };
        if (payload.task === 'WORLDBOOK_ROUTE') return { text: '公共场景中只允许合乎比例的旁观者反应' };
        throw new Error('unexpected task');
    },
};
const plannerSource = structuredClone(source);
const compiledSource = await WorldStateMachine.WorldbookCompiler.processSource(plannerSource);
assert.equal(compiledSource.blocked, undefined);
assert.equal(compiledSource.report.entries[0].label, '公共场所规则');
assert.match(compiledSource.report.routedText, /合乎比例/);
assert.doesNotMatch(JSON.stringify(compiledSource.report), /公共场所允许合乎比例的旁观者反应。/);
assert.match(plannerSource.compiledWorldbookRules.text, /合乎比例/);
assert.equal(plannerSource.worldbooks.flatMap((book) => book.entries).some((entry) => entry.key === selectedKey), false);
assert.equal(plannerSource.worldbooks.flatMap((book) => book.entries).some((entry) => entry.content === '这条未勾选原文应保持原样。'), true);
assert.doesNotMatch(JSON.stringify(plannerSource), /公共场所允许合乎比例的旁观者反应。/);

const foregroundChat = [
    { role: 'system', content: `角色设定\n${source.worldbooks[0].entries[0].content}\n这条未勾选原文应保持原样。` },
    { role: 'user', content: '我和他在飞机上闹起来了。' },
];
const foregroundResult = await WorldStateMachine.WorldbookCompiler.processChat(foregroundChat);
assert.equal(foregroundResult.blocked, undefined);
assert.equal(foregroundChat.some((message) => String(message.content || '').includes(source.worldbooks[0].entries[0].content)), false);
assert.equal(foregroundChat.some((message) => String(message.content || '').includes('这条未勾选原文应保持原样。')), true);
assert.equal(foregroundChat.some((message) => String(message.content || '').includes('【本轮世界书拆解规则】')), true);
const injectionReport = WorldStateMachine.WorldbookCompiler.getReport();
assert.equal(injectionReport.delivery.injected, true);
assert.equal(injectionReport.delivery.removedOriginalOccurrences, 1);
assert.match(injectionReport.routedText, /合乎比例/);
WorldStateMachine.WorldbookCompiler.updateCompiledEntry(selectedKey, { core: ['人工修改后的核心规则'], triggers: ['新触发情境'], rules: [], background: [] });
const editedReport = WorldStateMachine.WorldbookCompiler.getReport();
assert.equal(editedReport.status.state, 'edited');
assert.equal(editedReport.routedText, '');
assert.deepEqual(editedReport.entries[0].core, ['人工修改后的核心规则']);
assert.equal(editedReport.delivery, null);

testContext.chatMetadata.worldStateMachine = { state: {
    ...state,
    schemaVersion: 5,
    initialized: true,
    characters: [{ id: 'char', name: '夏以昼', lastUpdatedElapsedMinutes: 30 }],
    npcActivities: [{ characterId: 'char', at: '14:30', location: '公司', action: '开会' }],
    triggers: [{ id: 'leave', conditions: [], earliestAt: '15:35' }],
    timeline: [{ id: 'old', at: '14:20', summary: '谈话开始' }],
}, history: [] };
const migrated = WorldStateMachine.Storage.load();
assert.equal(migrated.schemaVersion, 6);
assert.equal(migrated.runtime.needsWorldRefresh, true);
assert.equal(migrated.runtime.npcLastUpdatedElapsedMinutes.char, 30);
assert.equal('lastUpdatedElapsedMinutes' in migrated.characters[0], false);
assert.equal('at' in migrated.npcActivities[0], false);
assert.deepEqual(migrated.triggers[0].conditions, ['世界时间达到15:35']);
assert.equal('earliestAt' in migrated.triggers[0], false);
assert.equal('at' in migrated.timeline[0], false);

console.log('Injection ownership/deduplication smoke test passed.');
