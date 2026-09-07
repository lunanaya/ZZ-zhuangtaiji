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
await import('../src/context.js');

const auditedModules = ['world','worldRules','factAnchors','resourceConstraints','organizations','map','characters','npcActivities','relationships','knowledge','schedules','tasks','triggers','threads','progression','processes','causalEffects','timeline'];
const calls = [];
WorldStateMachine.Api = {
    async complete(prompt, payload, options) {
        calls.push({ prompt, payload, options });
        if (payload.task === 'SOURCE_READ_FACT_STREAM' && calls.filter((call) => call.payload.task === payload.task).length === 1) {
            return { factStream: {
                facts: [
                    { kind: 'character', sourceIndex: 1, subject: '夏以昼', field: 'identity', value: '皇帝' },
                    { kind: 'character', sourceIndex: 1, subject: '夏以昼', field: 'situation', value: '在宫中主持朝会' },
                ],
                patches: [], checkedModules: [], candidateModules: ['characters'], end: false, maxCheckpoint: 1,
            } };
        }
        if (payload.task === 'SOURCE_READ_FACT_ADJUDICATE') return { factStream: {
            facts: [
                { kind: 'relationship', sourceIndex: 2, subject: '夏以昼', object: '夏寻樨', value: '兄妹' },
                ...minimalFill,
            ],
            patches: [], checkedModules: auditedModules, candidateModules: auditedModules, end: true, maxCheckpoint: 2,
        } };
        throw new Error(`unexpected task ${payload.task}`);
    },
};

await import('../src/engine.js');

const guardedGeneratedFacts = WorldStateMachine.Engine._test.factsWithRegisteredSources([
    { kind: 'npcActivity', subject: '夏以昼', value: '在书房处理日常政务' },
    { kind: 'character', subject: '夏以昼', field: 'situation', value: '暂时专注于日常政务' },
    { kind: 'relationship', subject: '夏以昼', object: '陌生人', value: '盟友' },
    { kind: 'character', subject: '凭空人物', field: 'situation', value: '正在行动' },
], [{ ref: 'worldbook:人物' }], 'derived', true, {
    characterSubjects: ['夏以昼'], activitySubjects: ['夏以昼'],
});
assert.equal(guardedGeneratedFacts.length, 2, '无来源模拟只能进入白名单且只能引用已有角色');
assert.ok(guardedGeneratedFacts.every((fact) => fact.truthStatus === 'system_generated'));
const forcedRelationship = WorldStateMachine.Engine._test.factsWithRegisteredSources([
    { kind: 'relationship', subject: '甲', object: '乙', value: '保持礼貌但彼此不熟' },
], [{ ref: 'worldbook:人物' }], 'derived', true, { forceFillModules: ['relationships'] });
assert.equal(forcedRelationship.length, 1, '第二轮必须允许为空栏目建立可覆盖的合理模拟');
assert.equal(forcedRelationship[0].truthStatus, 'system_generated');
assert.equal(forcedRelationship[0].data.simulationFill, true);
const singleSourceMissingIndex = WorldStateMachine.Engine._test.factsWithRegisteredSources([
    { kind: 'relationship', subject: '甲', object: '乙', value: '亲属' },
], [{ ref: 'worldbook:人物', serializedJson: '{"text":"甲与乙是亲属"}' }], 'confirmed');
assert.equal(singleSourceMissingIndex.length, 1, '第一轮只有一个来源时，漏写sourceIndex不得导致有意义事实整条删除');
assert.deepEqual(singleSourceMissingIndex[0].sourceRefs, ['worldbook:人物']);
const inferredSourceFact = WorldStateMachine.Engine._test.factsWithRegisteredSources([
    { kind: 'character', subject: '夏以昼', field: 'identity', value: '皇帝' },
], [
    { ref: 'worldbook:无关', serializedJson: '{"text":"其他人物"}' },
    { ref: 'worldbook:人物', serializedJson: '{"text":"夏以昼是皇帝"}' },
], 'confirmed');
assert.deepEqual(inferredSourceFact[0].sourceRefs, ['worldbook:人物'], '第一轮漏写sourceIndex时应按事实文本回查来源，而不是删除整条记录');

const fillModules = auditedModules;
const minimalFill = [
    { kind: 'world', field: 'weather', value: '天气平稳' },
    { kind: 'worldRules', subject: '行动遵循当前世界的基本秩序' },
    { kind: 'factAnchors', subject: '当前人物与世界状态连续有效' },
    { kind: 'resourceConstraints', subject: '主角', value: '行动仍受当前时间与地点限制' },
    { kind: 'organizations', subject: '当前社会组织' },
    { kind: 'map', subject: '当前场景' },
    { kind: 'characters', subject: '主角', field: 'situation', value: '正在面对当前局面' },
    { kind: 'npcActivities', subject: '主角', value: '继续处理当前事务' },
    { kind: 'relationships', subject: '主角', object: '当前互动对象', value: '保持当前互动关系' },
    { kind: 'knowledge', subject: '当前可见信息' },
    { kind: 'schedules', subject: '接下来继续当前安排' },
    { kind: 'tasks', subject: '处理当前局面', value: '决定下一步行动' },
    { kind: 'triggers', subject: '当前局面的可能入口', value: '局面出现进一步变化时' },
    { kind: 'threads', subject: '当前未决局面', value: '仍可继续发展' },
    { kind: 'progression', value: '沿当前矛盾自然推进' },
    { kind: 'processes', subject: '背景运行', value: '世界按既有秩序继续运转' },
    { kind: 'causalEffects', subject: '当前局面', value: '后续行动仍会受其影响' },
    { kind: 'timeline', subject: '当前阶段已经建立' },
];
const allGenerated = WorldStateMachine.Engine._test.factsWithRegisteredSources(minimalFill, [], 'derived', true, { forceFillModules: fillModules });
const allGeneratedState = WorldStateMachine.Engine._test.stateFromEvidence(
    WorldStateMachine.Engine._test.evidenceFromFactRecords(allGenerated, { checkedModules: fillModules }), {}, WorldStateMachine.Defaults.createState(),
).state;
assert.deepEqual(fillModules.filter((module) => !WorldStateMachine.Engine._test.stateModuleHasContent(allGeneratedState, module)), [], '第二轮返回最小模拟后18栏必须都能组装为非空状态');
const sanitizedGeneratedState = structuredClone(allGeneratedState);
WorldStateMachine.Engine._test.sanitizeGptHydratedState(sanitizedGeneratedState, { gptRecentRefs: [], gptLatestRefs: [] });
assert.deepEqual(fillModules.filter((module) => !WorldStateMachine.Engine._test.stateModuleHasContent(sanitizedGeneratedState, module)), [], '最终状态清洗器不得删除第二轮明确标记的推导或模拟补全');
const sanitizedGeneratedEvidence = WorldStateMachine.Engine._test.sanitizeGptEvidence(
    WorldStateMachine.Engine._test.evidenceFromFactRecords(allGenerated, { checkedModules: fillModules }),
    { gptRecentRefs: [], gptLatestRefs: [] },
);
const stateAfterEvidenceSanitize = WorldStateMachine.Engine._test.stateFromEvidence(
    sanitizedGeneratedEvidence, {}, WorldStateMachine.Defaults.createState(),
).state;
assert.deepEqual(fillModules.filter((module) => !WorldStateMachine.Engine._test.stateModuleHasContent(stateAfterEvidenceSanitize, module)), [], 'GPT证据清洗器不得用旧的近期性或反推测规则删除明确标记的模拟补全');

const prepared = {
    transportVersion: 'fact-stream-v1', large: true,
    batches: [[
        { ref: 'worldbook:人物', kind: 'worldbook-entry', serializedJson: '{"text":"夏以昼是皇帝，正在宫中主持朝会"}' },
        { ref: 'worldbook:关系', kind: 'worldbook-entry', serializedJson: '{"text":"夏以昼与夏寻樨是兄妹"}' },
    ]],
    localEvidence: {}, originalChars: 100, includedChars: 100,
};
const result = await WorldStateMachine.Engine._test.buildStateWithinLimit(
    '', { sourceBoundary: {}, moduleOwnership: {} }, WorldStateMachine.Defaults.createState(),
    { model: 'test', useTavernApi: true, maxTokens: 9000 }, undefined, prepared,
);

const xia = result.state.characters.find((item) => item.name === '夏以昼');
assert.ok(xia, '缺少显式ID的有意义人物事实必须保留');
assert.equal(xia.identity, '皇帝');
assert.equal(xia.situation, '在宫中主持朝会', '同一人物的逐字段事实必须由代码合并成一张卡');
assert.deepEqual(xia.sourceRefs, ['worldbook:人物'], '遗漏sourceRefs时必须用sourceIndex回填来源');
assert.ok(xia.basis.length > 0, '依据不得因模型少一个字段而丢失');
assert.ok(result.state.relationships.some((item) => item.identityRelation === '兄妹'));
assert.ok(!calls[0].prompt.includes('moduleCoverage'), '第一轮不得再要求模型输出18模块覆盖表');
assert.ok(calls[0].prompt.includes('不要输出sourceRefs'), '第一轮应明确省略由代码登记的来源元数据');
assert.equal(Object.prototype.hasOwnProperty.call(calls[0].payload, 'moduleOwnership'), false, '第一轮不得携带冗长的旧模块归属表');
assert.deepEqual(calls[0].payload.moduleNames, auditedModules, '第一轮只携带紧凑的模块名称清单');
assert.equal(calls.filter((call) => call.payload.task === 'SOURCE_READ_FACT_STREAM').length, 1, '第一次完整读取的事实提取固定只调用一次');
assert.equal(calls.at(-1).payload.task, 'SOURCE_READ_FACT_ADJUDICATE');
assert.ok(calls.every((call) => call.options.singleAttempt === true), '两次初始读取都不得在API封装层偷偷产生额外兼容请求');
assert.equal(calls.at(-1).payload.unreadSourceRecords.length, 1, '第一次只读到断点时，第二次调用必须接管未读来源');
assert.equal(calls.at(-1).payload.targetedSourceRecords.some((record) => record.sourceIndex === 2), false, '第二次调用不得在未读来源和定点原文中重复发送同一记录');
assert.ok(Array.isArray(calls.at(-1).payload.requiredEmptyModuleOutputs) && calls.at(-1).payload.requiredEmptyModuleOutputs.length > 0, '第二轮必须收到逐栏推演目标和最小合格示例');
assert.equal(Object.prototype.hasOwnProperty.call(calls.at(-1).payload, 'moduleOwnership'), false, '第二轮不得再收到要求无来源留空的旧模块规则');
assert.equal(prepared.requestAttempts, 2, '初次读取不得超过两次API');
const cache = JSON.parse(storage.get('wsm_extract_then_reason_cache_v16'));
assert.equal(Object.values(cache)[0].evidence.__factPipelineComplete, true, '第二次调用接管未读来源并补齐18栏后应完整保存');

const retryCalls = [];
WorldStateMachine.Api.complete = async (_prompt, payload, options) => {
    retryCalls.push({ payload, options });
    if (payload.task === 'SOURCE_READ_FACT_STREAM' && retryCalls.filter((item) => item.payload.task === payload.task).length === 1) {
        throw new Error('任务 SOURCE_READ_FACT_STREAM 上游或反代断流；已收到正文 0 字，推理 232 字');
    }
    if (payload.task === 'SOURCE_READ_FACT_ADJUDICATE') return { factStream: {
        facts: [
            { kind: 'character', sourceIndex: 1, subject: '重试角色', field: 'identity', value: '测试身份' },
            ...minimalFill,
        ],
        patches: [], checkedModules: auditedModules, candidateModules: auditedModules, end: true, maxCheckpoint: 1,
    } };
    throw new Error(`unexpected retry task ${payload.task}`);
};
const retryPrepared = {
    transportVersion: 'fact-stream-v1', large: true,
    batches: [[{ ref: 'worldbook:重试', kind: 'worldbook-entry', serializedJson: '{"text":"重试角色拥有测试身份"}' }]],
    localEvidence: {}, originalChars: 20, includedChars: 20,
};
const retryResult = await WorldStateMachine.Engine._test.buildStateWithinLimit(
    '', { sourceBoundary: {} }, WorldStateMachine.Defaults.createState(),
    { model: 'retry-test', useTavernApi: false, endpoint: 'test', maxTokens: 9000 }, undefined, retryPrepared,
);
assert.equal(retryCalls.length, 2, '第一次零正文断流后只能由第二次也是最后一次调用接管');
assert.equal(retryCalls[1].payload.task, 'SOURCE_READ_FACT_ADJUDICATE', '第二次调用必须同时恢复未读来源并完成补全，不能再发一次事实提取');
assert.equal(retryCalls[1].payload.unreadSourceRecords.length, 1);
assert.ok(retryResult.state.characters.some((item) => item.name === '重试角色'), '重试成功后的完整事实必须进入状态');
assert.equal(retryPrepared.sourceComplete, true, '第二次调用返回最终through后必须核实来源完整');

console.log('fact stream smoke test passed');
