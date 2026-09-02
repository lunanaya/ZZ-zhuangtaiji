(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const PROMPT_ID = 'WORLD_STATE_MACHINE_CONTEXT';
    const DEPTH_PROMPT_IDS = Array.from({ length: 5 }, (_, depth) => `${PROMPT_ID}_DEPTH_${depth}`);
    let planningPromise = null;
    let settlingPromise = null;
    let activeReadController = null;
    let bound = false;
    let settingsBound = false;
    let operationProgress = { state: 'idle', message: '', details: '', at: 0, startedAt: 0, elapsedMs: 0, steps: [] };

    const safeText = (value) => String(value ?? '').trim();
    function cancellationError() { return Object.assign(new Error('用户已终止读取'), { name: 'AbortError' }); }
    function throwIfCancelled(signal) { if (signal?.aborted) throw cancellationError(); }
    function reportProgress(message, state = 'running', details = '') {
        const nextMessage = safeText(message);
        const nextDetails = safeText(details);
        // A new initialization begins a fresh, visible progress trail. Keep
        // previous stages of the active run so the user can see exactly where
        // source reading reached before it completed or failed.
        const startsRead = /正在读取酒馆资料/.test(nextMessage);
        const previous = startsRead ? [] : (operationProgress.steps || []);
        const startedAt = startsRead || !Number(operationProgress.startedAt)
            ? Date.now()
            : Number(operationProgress.startedAt);
        const last = previous.at(-1);
        const step = { state, message: nextMessage, details: nextDetails, at: Date.now(), elapsedMs: Date.now() - startedAt };
        const steps = last?.message === step.message && last?.details === step.details && last?.state === step.state
            ? [...previous.slice(0, -1), step]
            : [...previous, step].slice(-36);
        operationProgress = { ...step, startedAt, steps };
        try { window.dispatchEvent(new CustomEvent('wsm-operation-progress', { detail: operationProgress })); }
        catch (_error) { /* Progress reporting must never interrupt planning. */ }
        return operationProgress;
    }
    function getProgress() { return { ...operationProgress, steps: (operationProgress.steps || []).map((step) => ({ ...step })) }; }
    function resetProgress() {
        operationProgress = { state: 'idle', message: '', details: '', at: Date.now(), startedAt: 0, elapsedMs: 0, steps: [] };
        try { window.dispatchEvent(new CustomEvent('wsm-operation-progress', { detail: operationProgress })); }
        catch (_error) { /* Resetting display state must never interrupt clearing. */ }
        return getProgress();
    }
    function syncIdentities(state, names = WSM.Context?.identityNames?.() || { user: '<USER>', char: '' }) {
        const next = state;
        const previousUserName = safeText(next?.identities?.user);
        const userName = safeText(names?.user) || '<USER>';
        const identities = {
            user: userName,
            char: '',
        };
        const legacyUserNames = new Set(['<user>', '<USER>']);
        if (previousUserName && !/^(?:user|<user>)$/i.test(previousUserName)) legacyUserNames.add(previousUserName);
        const replaceUserMentions = (value) => {
            if (typeof value === 'string') {
                if (value === userName) return value;
                // Stable references remain `user`; only human-readable state
                // text is rewritten to the current third-person display name.
                if (/^(?:user|<user>)$/i.test(value)) return value;
                let output = value.replace(/<user>|\buser\b/gi, userName).replace(/你/g, userName);
                legacyUserNames.forEach((legacy) => {
                    if (legacy && legacy !== userName) output = output.split(legacy).join(userName);
                });
                return output;
            }
            if (Array.isArray(value)) return value.map(replaceUserMentions);
            if (value && typeof value === 'object') Object.keys(value).forEach((key) => { value[key] = replaceUserMentions(value[key]); });
            return value;
        };
        replaceUserMentions(next);
        next.identities = identities;
        (next.characters || []).forEach((character) => {
            const id = safeText(character?.id).toLowerCase();
            if (['user','<user>'].includes(id)) character.name = userName;
        });
        return next;
    }
    function isForeground(type) {
        const value = safeText(type).toLowerCase();
        return !['quiet', 'impersonate'].includes(value);
    }
    function generationBlockReason(settings, planner) {
        if (settings?.blockOnPlannerError && planner?.error) {
            return `Planner 失败且已启用严格阻止：${safeText(planner.error)}`;
        }
        return '';
    }
    function plannerAvailable(settings = WSM.Settings.get()) {
        if (settings?.useTavernApi !== false) return typeof WSM.Context.context()?.generateRaw === 'function';
        return !!safeText(settings?.endpoint);
    }
    function activeChatAvailable() {
        const ctx = WSM.Context.context();
        // SillyTavern's welcome page also exposes two synthetic chat messages
        // ("SillyTavern System" and "Assistant"). A message count alone must
        // never make that page look like an opened character archive.
        const hasCharacter = (Number.isInteger(ctx?.characterId) && ctx.characterId >= 0)
            || (/^\d+$/.test(safeText(ctx?.characterId)) && Number(ctx.characterId) >= 0);
        if (hasCharacter || !!ctx?.groupId) return true;
        const messages = Array.isArray(ctx?.chat) ? ctx.chat : [];
        const welcomeOnly = messages.length > 0 && messages.every((message) => {
            const name = safeText(message?.name);
            const content = safeText(message?.mes ?? message?.content);
            return /^(?:assistant|system|sillytavern(?: system)?)$/i.test(name)
                || /SillyTavern\s+\d|如果您已连接到一个 API|welcome page assistant/i.test(content);
        });
        return messages.length > 0 && !welcomeOnly;
    }
    function turnKey() {
        const message = WSM.Context.latestUserMessage();
        return message ? `${message.id}:${hash(message.content)}` : '';
    }
    function hash(value) {
        const input = safeText(value);
        let result = 0;
        for (let i = 0; i < input.length; i += 1) result = ((result << 5) - result + input.charCodeAt(i)) | 0;
        return (result >>> 0).toString(36);
    }
    function normalizeInjection(value) {
        let output = safeText(value);
        output = output.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
        if (!output.startsWith('<WORLD_STATE>')) output = `<WORLD_STATE>\n${output}`;
        if (!output.endsWith('</WORLD_STATE>')) output += '\n</WORLD_STATE>';
        return output.slice(0, 5000);
    }
    function fallbackInjection(state) {
        const names = (state.characters || []).filter((item) => item.present || item.location === state.world?.location?.current).map((item) => item.name).filter(Boolean);
        return normalizeInjection([
            `时间：${state.world?.time?.display || '未设定'}`,
            `地点：${state.world?.location?.current || '未设定'}`,
            names.length ? `在场：${names.join('、')}` : '',
            '遵守已有状态、人物知识边界与因果关系；没有充分理由时，不要引入新人物或突发事件。',
        ].filter(Boolean).join('\n'));
    }
    function buildNpcSchedule(state) {
        const elapsed = Number(state.world?.time?.elapsedMinutes || 0);
        const currentLocation = safeText(state.world?.location?.current);
        const updatedAt = state.runtime?.npcLastUpdatedElapsedMinutes || {};
        return (state.characters || []).map((character) => {
            const last = Number(updatedAt[character.id] || 0);
            const minutesSinceUpdate = Math.max(0, elapsed - last);
            const visible = character.present === true || (!!currentLocation && safeText(character.location) === currentLocation);
            const mode = visible ? 'realtime' : (minutesSinceUpdate >= 60 ? 'background' : 'carry');
            return {
                characterId: character.id,
                name: character.name,
                mode,
                minutesSinceUpdate,
                reason: visible ? '与当前场景同地点或明确在场' : (mode === 'background' ? '离场且达到一小时后台更新间隔' : '离场且尚未达到后台更新间隔'),
            };
        });
    }
    function plannerState(state) {
        const next = WSM.Storage.clone(state);
        // Technical clocks and cached planner output are program-owned. Keeping
        // them out of the model payload prevents competing timelines.
        delete next.updatedAt;
        delete next.runtime;
        delete next.planner;
        ['worldRules','factAnchors','organizations','characters','npcActivities','relationships','knowledge','schedules','tasks','events','triggers','threads','processes','causalEffects','timeline'].forEach((module) => {
            (next[module] || []).forEach((item) => { if (item && typeof item === 'object') delete item.updatedRevision; });
        });
        if (next.progression && typeof next.progression === 'object') delete next.progression.updatedRevision;
        return next;
    }
    function summarizeSource(source) {
        return {
            checkedAt: Date.now(),
            characterCard: !!source?.character,
            persona: !!source?.persona,
            chatMessages: Number(source?.tavernTextContext?.includedMessages || 0),
            chatTotalMessages: Number(source?.tavernTextContext?.totalMessages || 0),
            chatTruncated: source?.tavernTextContext?.truncated === true,
            hiddenChatMessages: Number(source?.tavernTextContext?.hiddenMessages || 0),
            requestedWorldbooks: source?.worldbookDiagnostics?.requestedNames || [],
            loadedWorldbooks: source?.worldbookDiagnostics?.loadedNames || [],
            failedWorldbooks: source?.worldbookDiagnostics?.failedNames || [],
            worldbookEntryCounts: source?.worldbookDiagnostics?.entryCounts || {},
            worldbookReadSources: source?.worldbookDiagnostics?.readSources || {},
        };
    }
    const COMPLETE_SOURCE_PART_CHARS = 24000;
    const TWO_PASS_SOURCE_TARGET_CHARS = 140000;
    const GPT_SOURCE_TARGET_CHARS = 64000;
    const GPT_SOURCE_MAX_BATCHES = 2;
    const SOURCE_PROGRESS_FRAGMENT_CHARS = 8000;
    const FIRST_HALF_CACHE_KEY = 'wsm_two_pass_first_half_cache_v8';
    const IDENTITY_READ_RULE = '身份硬规则：用户始终以第三人称表示，姓名必须逐字使用输入identities.user；仅当该字段为空时使用<USER>，禁止写成“你”，用户改名后禁止沿用旧名。char和<char>只是内部占位符，禁止输出。角色卡名称只是文件、版本或组合标签，不得直接当成人名；其他人物只能使用角色卡正文或聊天正文明确出现的真实姓名，没有明确姓名就不建立人物。';
    const SOURCE_READ_PROMPT = '你是持续世界状态推演器，不是故事续写者或摘要器。你必须执行 SOURCE_CHECK→RULE_MATCH→FACT_DERIVATION→SIMULATION→CONSISTENCY_AUDIT→MODULE_UPDATE→STATE_GC→CONTEXT_SELECTION，并只输出结论、关键依据和结构化证据，不输出思维链。除原文明确发生或宣布的内容外，必须综合称谓、自称、官职、礼制、正式册封/任命、连续行为、地点层级、时间顺序与多处相互印证的线索，补全可以唯一确定的身份、正式关系、权限、资源限制和当前世界状态并标为derived。禁止推测内心、情感、动机和人格，不得创造姓名、秘密、数值、历史或设定。原始世界书、角色卡、Persona和完整聊天始终是权威来源，本结果只保存当前运行版本。每个展示模块必须经过检查；数组可为空，但必须在moduleCoverage中给出empty_confirmed、unknown、retrieval_failed或not_applicable及依据，绝不允许把漏读伪装成空。characters必须覆盖所有核心人物和当前仍影响世界的具名人物；每项至少输出id、name、maintenanceLevel、identity、location、situation、truthStatus、basis、sourceRefs，身份/位置/处境无依据时字段留空但人物不能消失；persistentConditions、importantItems、currentGoals、authorityRefs仅在有依据时输出。npcActivities只允许离开当前场景的NPC，characterId必须引用characters中的真实人物，台词片段、代词、称谓和动作短语绝不能当姓名；每人只留一条当前实际活动。schedules只保存已经明确承诺、约定、预约、命令或规定日期且尚未发生的事项。tasks只保存用户当前能主动推进的事务。world只保存当前客观现实；currentScene保存当前幕；threads保存跨阶段未决问题；progression保存实际方向；不得跨模块复述同一段剧情。每项带truthStatus、basis、sourceRefs、priority、activity。输出总长不超过9000个中文字符；人物最多24项，其他模块按当前运行需要保留1至12项。所有数组键必须原样保留，即使为空。moduleCoverage必须逐项覆盖world、worldRules、factAnchors、resourceConstraints、organizations、map、characters、npcActivities、relationships、knowledge、schedules、tasks、events、triggers、threads、progression、processes、causalEffects、timeline。moduleDecisions必须对同一组模块逐项输出module、operation和reason。不得输出Markdown或解释，只输出闭合JSON。';
    const SOURCE_READ_MODULE_EXTENSION = '严格JSON结构：{"evidence":{"currentScene":[],"progression":[],"anchors":[],"resourceConstraints":[],"organizations":[],"characters":[],"npcActivities":[],"relationships":[],"knowledge":[],"schedules":[],"chronology":[],"timeline":[],"canon":[],"worldRules":[],"locations":[],"tasks":[],"events":[],"triggers":[],"threads":[],"processes":[],"causal":[],"uncertainties":[],"matchedRules":[],"derivedFacts":[],"conflicts":[],"staleStates":[],"actorFeasibility":[],"causalCandidates":[],"moduleCoverage":[],"moduleDecisions":[]}}。worldRules提取底层规则、条件与例外；organizations提取有来源的组织职责、权限、资源与处境；关系逐方向输出from→to并分离identityRelation/currentPerception；currentScene必须有time、season、location、weather、environment、objectiveConditions、presentCharacterIds、currentIssue、completedActions、pendingResponses、obstacles、interactionPoints、endConditions。';
    const GPT_SOURCE_READ_EXTENSION = `${SOURCE_READ_MODULE_EXTENSION}\n不要解释、不要展示分析过程。跨sourceRecords与firstHalfEvidence交叉验证。完整维护人物最多24项，其他模块最多12项；不能为压缩输出而省略后半模块。characters必须输出结构化身份、当前位置与当前重要处境；npcActivities只允许引用characters中的离屏人物；明确的未来安排必须进入schedules。所有持久条目必须带sourceRefs，同一对象只保留一个当前版本。`;
    const GPT_SOURCE_READ_PROMPT = SOURCE_READ_PROMPT;
    const FINAL_EVIDENCE_PROMPT = `${SOURCE_READ_PROMPT}\n这是第二段资料读取与最终合并。firstHalfEvidence是请求A的有界证据，sourceRecords是后半资料；逐条读取后半并用较新、证据更强的版本覆盖前半旧状态。最终仍必须返回完整契约和所有moduleCoverage/moduleDecisions，不能因为模块来自前半就省略，也不能把前半数组机械追加成重复摘要。`;
    const INITIAL_STATE_PROMPT = '你是世界状态初始化器，不是故事续写者。先识别事实、跨模块去重，再按priority与activity建立紧凑当前状态。必须综合称谓、自称、官职、礼制、正式册封/任命、连续行为、地点层级、时间顺序和已结算事件，自动补全可以唯一确定的身份、正式关系、权限、资源约束与当前状态并标为derived；不得因为世界书没有逐字定义而遗漏。world固定只含当前时间、季节、地点、天气、环境和最多8条正在生效的客观状态；天气必须存在，服从地点、季节、时间与既有气象并连续渐变。resourceConstraints只记录当前会改变行动可行性的资金、权限、人手、关键物品与地点封锁，不做资产清单，不猜测数量。人物背景、历史、未来安排和世界规则不得进入world。factAnchors只放正文已经永久确立且不能由其他模块明确表达的最终客观结果；世界书、角色卡和Persona始终是长期设定权威。L2为当前阶段重要信息，L1为临时信息；HOT仅限当前场景。当前型模块只留最新版本。初始化必须逐一检查stateSchema中的所有展示模块，有依据或可确定推导的模块至少返回一条最相关当前记录；确无依据时保持空集合，禁止建立“当前没有”“尚未读取到”“未明确”“原文未说明”等可见占位卡，也不得用捏造设定凑数。卡片缺关键字段时不创建，禁止空对象、空标题、空白卡和同一事实的多份改写。普通饮食、姿势、衣物、情绪和日用品默认不进入。重要完成节点才进入timeline。单模块通常不超过8张卡，单卡列表字段通常不超过4项；达到容量时保留L3与当前HOT/L2，其余留在原始资料。禁止预演未来、创造姓名、秘密、事件或输出分析。整个JSON严格控制在2200个中文字符以内，只输出闭合严格JSON：{"state":{}}。';
    const TRUTH_POLICY_PROMPT = '真实性硬规则：补全顺序为原文事实→定点回查世界书/角色卡/摘要/历史→多来源交叉验证→可确定程序推导→有充分线索的推测→仅低风险模块受约束生成→后台未知。每个持久条目都返回truthStatus、basis、sourceRefs。truthStatus只允许confirmed、derived、system_generated、suspected、assumed、unknown、not_established、not_applicable、failed。confirmed必须绑定来源；derived必须有可复算依据；suspected/assumed不得写成事实或自动升级；failed必须重试读取。天气可system_generated但服从地点、季节、时间、上轮天气和特殊气候并连续演变；季节优先由日期、地点和南北半球确定。人物身份、正式关系、权限和地点层级在称谓、自称、正式册封/任命、已结算事件或多处一致上下文能够唯一确定时必须补全为derived；不得因世界书未单独定义就留空。秘密、事件结果和具体数值禁止自由生成。L3禁止suspected、assumed、system_generated。unknown/not_established只供后台审计，不得形成“未明确”“原文未说明”等面板或正文注入文字。';
    function losslessParts(value, limit = COMPLETE_SOURCE_PART_CHARS) {
        const input = String(value ?? '');
        if (!input) return [''];
        const parts = [];
        for (let start = 0; start < input.length; start += limit) parts.push(input.slice(start, start + limit));
        return parts;
    }
    function boundedText(value, limit) {
        const input = safeText(value).replace(/\s+/g, ' ');
        if (!input || input.length <= limit) return input;
        const tail = Math.max(40, Math.floor(limit * 0.28));
        return `${input.slice(0, Math.max(1, limit - tail - 1))}…${input.slice(-tail)}`;
    }
    function taggedBlock(content, tag) {
        const match = String(content || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return safeText(match?.[1]);
    }
    function compactAssistantChronicle(content, limit) {
        const raw = String(content || '');
        const memory = taggedBlock(raw, 'meow_FM');
        if (memory) {
            const pick = (tag) => safeText(memory.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]);
            const parts = [pick('serial'), pick('time'), pick('scene'), pick('plot'), pick('seeds')].filter(Boolean);
            return boundedText(parts.join('｜'), limit);
        }
        const indrs = taggedBlock(raw, 'INDRS');
        if (indrs) return boundedText(indrs, limit);
        const withoutPrivateWork = raw
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<snow>[\s\S]*?<\/snow>/gi, '')
            .replace(/<details>[\s\S]*?<\/details>/gi, '');
        const contentBlock = taggedBlock(withoutPrivateWork, 'content');
        return boundedText(contentBlock || withoutPrivateWork, limit);
    }
    function compactSourceChronicle(source, targetChars = TWO_PASS_SOURCE_TARGET_CHARS) {
        const chat = Array.isArray(source?.chat) ? source.chat : [];
        if (!chat.length) return { source, compacted: false, coveredMessages: 0 };
        const clone = WSM.Storage?.clone ? WSM.Storage.clone(source) : structuredClone(source);
        clone.chat = [];
        clone.currentUserAction = null;
        clone.latestAssistantText = null;
        const fixedChars = JSON.stringify(clone).length;
        const recentCount = Math.min(10, chat.length);
        const recentReserve = Math.min(60000, Math.max(18000, targetChars - fixedChars) * 0.25);
        const olderCount = Math.max(1, chat.length - recentCount);
        const olderBudget = Math.max(107, Math.min(900, Math.floor((targetChars - fixedChars - recentReserve) / olderCount) - 120));
        const recentBudget = Math.max(900, Math.min(5000, Math.floor(recentReserve / Math.max(1, recentCount)) - 120));
        clone.chat = chat.map((message, index) => {
            const recent = index >= chat.length - recentCount;
            const limit = recent ? recentBudget : olderBudget;
            const content = message?.role === 'assistant'
                ? compactAssistantChronicle(message?.content, limit)
                : boundedText(message?.content, limit);
            return { ...message, content, compacted: content !== safeText(message?.content), originalChars: String(message?.content || '').length };
        });
        const compactedMessages = clone.chat.filter((message, index) => message.content !== safeText(chat[index]?.content)).length;
        const originalChatChars = chat.reduce((sum, message) => sum + String(message?.content || '').length, 0);
        const includedChatChars = clone.chat.reduce((sum, message) => sum + String(message?.content || '').length, 0);
        clone.currentUserAction = [...clone.chat].reverse().find((message) => message.role === 'user') || null;
        clone.latestAssistantText = [...clone.chat].reverse().find((message) => message.role === 'assistant') || null;
        clone.semanticChronicle = {
            enabled: true,
            method: 'all-message-local-scan',
            coveredMessages: chat.length,
            totalMessages: Number(source?.tavernTextContext?.totalMessages || chat.length),
            recentFullResolutionMessages: recentCount,
            compactedMessages,
            originalChatChars,
            includedChatChars,
            note: '每条聊天均已扫描；较早助手消息优先保留meow_FM/INDRS中的时间、地点、剧情摘要和持续种子，完整原文仍在SillyTavern。',
        };
        return { source: clone, compacted: true, coveredMessages: chat.length, compactedMessages, originalChatChars, includedChatChars };
    }
    function compactGptSourceChronicle(source, targetChars = GPT_SOURCE_TARGET_CHARS) {
        const chat = Array.isArray(source?.chat) ? source.chat : [];
        const clone = WSM.Storage?.clone ? WSM.Storage.clone(source) : structuredClone(source);
        const originalChatChars = chat.reduce((sum, message) => sum + String(message?.content || '').length, 0);
        if (clone.character && typeof clone.character === 'object') {
            clone.character = {
                name: safeText(clone.character.name),
                description: boundedText(clone.character.description, 3000),
                personality: boundedText(clone.character.personality, 1400),
                scenario: boundedText(clone.character.scenario, 1400),
                firstMessage: boundedText(clone.character.firstMessage, 700),
                exampleDialogue: boundedText(clone.character.exampleDialogue, 700),
                creatorNotes: boundedText(clone.character.creatorNotes, 700),
                systemPrompt: boundedText(clone.character.systemPrompt, 900),
                postHistoryInstructions: boundedText(clone.character.postHistoryInstructions, 900),
            };
        }
        clone.persona = boundedText(clone.persona, 1800);
        // Keep lore text and activation semantics, but omit editor-only metadata
        // that adds tokens without helping the source reader.
        clone.worldbooks = (clone.worldbooks || []).map((book) => ({
            name: safeText(book?.name), source: safeText(book?.source),
            entries: (book?.entries || []).map((entry) => ({
                id: entry?.id, key: safeText(entry?.key), bookName: safeText(entry?.bookName || book?.name),
                keys: Array.isArray(entry?.keys) ? entry.keys.map(safeText).filter(Boolean) : [],
                secondaryKeys: Array.isArray(entry?.secondaryKeys) ? entry.secondaryKeys.map(safeText).filter(Boolean) : [],
                comment: safeText(entry?.comment), content: safeText(entry?.content),
                constant: entry?.constant === true, selective: entry?.selective === true,
                position: entry?.position, depth: entry?.depth, order: entry?.order,
            })),
        }));
        clone.chat = [];
        clone.currentUserAction = null;
        clone.latestAssistantText = null;
        const recentCount = Math.min(12, chat.length);
        const older = chat.slice(0, Math.max(0, chat.length - recentCount));
        const recent = chat.slice(-recentCount);
        const blockSize = 12;
        const blockCount = Math.ceil(older.length / blockSize);
        // Lore is split into separate records below, so it must not consume the
        // chat chronicle's entire budget. The old calculation could leave a
        // 827-floor chat with only about 90 characters per 16-floor block.
        const available = Math.max(16000, targetChars);
        const recentReserve = Math.min(12000, Math.max(6000, Math.floor(available * 0.22)));
        const blockBudget = Math.max(420, Math.min(1100, Math.floor((available - recentReserve) / Math.max(1, blockCount))));
        const recentBudget = Math.max(520, Math.min(1400, Math.floor(recentReserve / Math.max(1, recentCount))));
        const summarized = [];
        for (let start = 0; start < older.length; start += blockSize) {
            const block = older.slice(start, start + blockSize);
            const fragments = block.map((message) => message?.role === 'assistant'
                ? compactAssistantChronicle(message?.content, 300)
                : boundedText(message?.content, 150)).filter(Boolean);
            summarized.push({
                id: `archive:${block[0]?.id ?? start}-${block.at(-1)?.id ?? start + block.length - 1}`,
                role: 'system', name: '本地历史时间块', index: block.at(-1)?.index ?? start + block.length - 1,
                hidden: false, timestamp: safeText(block.at(-1)?.timestamp),
                content: boundedText(fragments.join('｜'), blockBudget),
                compacted: true, originalMessageCount: block.length,
            });
        }
        const compactRecent = recent.map((message) => {
            const content = message?.role === 'assistant'
                ? compactAssistantChronicle(message?.content, recentBudget)
                : boundedText(message?.content, recentBudget);
            return { ...message, content, compacted: content !== safeText(message?.content), originalChars: String(message?.content || '').length };
        });
        clone.chat = [...summarized, ...compactRecent];
        clone.currentUserAction = [...compactRecent].reverse().find((message) => message.role === 'user') || null;
        clone.latestAssistantText = [...compactRecent].reverse().find((message) => message.role === 'assistant') || null;
        const includedChatChars = clone.chat.reduce((sum, message) => sum + String(message?.content || '').length, 0);
        clone.semanticChronicle = {
            enabled: true, method: 'gpt-two-pass-hierarchical-local-scan', coveredMessages: chat.length,
            totalMessages: Number(source?.tavernTextContext?.totalMessages || chat.length), recentFullResolutionMessages: recentCount,
            compactedMessages: Math.max(0, chat.length - compactRecent.filter((message) => message.compacted !== true).length),
            originalChatChars, includedChatChars,
            note: '全部聊天已在本地依顺序扫描；旧正文按12层聚合为高分辨率时间块，最近正文保留更高分辨率，完整原文仍在SillyTavern。',
        };
        return { source: clone, compacted: true, coveredMessages: chat.length, compactedMessages: clone.semanticChronicle.compactedMessages, originalChatChars, includedChatChars };
    }
    function completeSourceRecords(source) {
        const records = [];
        const addSerialized = (ref, kind, value, metadata = {}) => {
            const serialized = JSON.stringify(value ?? null);
            const parts = losslessParts(serialized);
            parts.forEach((content, index) => records.push({
                ref, kind, ...metadata,
                part: parts.length > 1 ? index + 1 : undefined,
                parts: parts.length > 1 ? parts.length : undefined,
                serializedJson: content,
            }));
        };
        addSerialized('identities', 'identities', source?.identities || {});
        addSerialized('character', 'character-card', source?.character || {});
        addSerialized('persona', 'persona', source?.persona || '');
        (source?.worldbooks || []).forEach((book, bookIndex) => {
            addSerialized(`worldbook:${book?.name || bookIndex}:metadata`, 'worldbook-metadata', { ...book, entries: undefined });
            (book?.entries || []).forEach((entry, entryIndex) => addSerialized(
                `worldbook:${book?.name || bookIndex}:${entry?.id ?? entryIndex}`,
                'worldbook-entry', entry, { book: book?.name || '', entryIndex },
            ));
        });
        const chat = Array.isArray(source?.chat) ? source.chat : [];
        if (source?.semanticChronicle?.enabled && chat.length) {
            const blockSize = 32;
            for (let start = 0; start < chat.length; start += blockSize) {
                const block = chat.slice(start, start + blockSize);
                const messages = block.map((message, offset) => [
                    message?.id ?? start + offset,
                    message?.role === 'assistant' ? 'a' : message?.role === 'user' ? 'u' : 's',
                    safeText(message?.name),
                    message?.hidden === true ? 1 : 0,
                    safeText(message?.content),
                ]);
                addSerialized(`chat-block:${start + 1}-${start + block.length}`, 'chat-chronicle-block', {
                    format: '[messageId,role(a/u/s),name,hidden,text]',
                    messages,
                }, { messageStartIndex: start, messageEndIndex: start + block.length - 1, messageCount: block.length });
            }
        } else {
            chat.forEach((message, index) => addSerialized(
                `chat:${message?.id ?? index}`, 'chat-message', message, { messageIndex: index },
            ));
        }
        ['worldbookDiagnostics','tavernTextContext','currentUserAction','latestAssistantText','compiledWorldbookRules'].forEach((field) => {
            if (source?.[field] !== undefined) addSerialized(field, 'source-metadata', source[field]);
        });
        return records;
    }
    function splitCompleteRecords(records) {
        const values = Array.isArray(records) ? records : [];
        if (values.length < 2) return values.length ? [values] : [[]];
        const lengths = values.map((record) => JSON.stringify(record).length + 1);
        const target = lengths.reduce((sum, value) => sum + value, 0) / 2;
        let running = 0;
        let splitAt = 1;
        let difference = Infinity;
        for (let index = 1; index < values.length; index += 1) {
            running += lengths[index - 1];
            const nextDifference = Math.abs(target - running);
            if (nextDifference <= difference) {
                difference = nextDifference;
                splitAt = index;
            } else break;
        }
        return [values.slice(0, splitAt), values.slice(splitAt)].filter((batch) => batch.length);
    }
    function splitGptCompleteRecords(records) { return splitCompleteRecords(records).slice(0, GPT_SOURCE_MAX_BATCHES); }
    function removeMirroredChatRecords(source, records) {
        const chat = Array.isArray(source?.chat) ? source.chat : [];
        const mirroredRefs = ['currentUserAction', 'latestAssistantText'].filter((field) => {
            const value = source?.[field];
            if (!value || typeof value !== 'object') return false;
            return chat.some((message) => String(message?.id ?? '') === String(value?.id ?? '')
                && String(message?.role ?? '') === String(value?.role ?? '')
                && String(message?.name ?? '') === String(value?.name ?? '')
                && String(message?.content ?? '') === String(value?.content ?? ''));
        });
        const mirrored = new Set(mirroredRefs);
        return {
            records: records.filter((record) => !mirrored.has(record.ref)),
            removedRefs: mirroredRefs,
        };
    }
    function prepareSourceForStateRequests(source, options = {}) {
        const rawSerialized = JSON.stringify(source);
        const gptScene = gptSceneFromSource(source);
        const recentStart = Math.max(0, (Array.isArray(source?.chat) ? source.chat.length : 0) - 32);
        const gptRecentRefs = (Array.isArray(source?.chat) ? source.chat : []).slice(-32)
            .map((message, index) => `chat:${message?.id ?? message?.index ?? recentStart + index}`).map(safeText).filter(Boolean);
        const latestStart = Math.max(0, (Array.isArray(source?.chat) ? source.chat.length : 0) - 8);
        const gptLatestRefs = (Array.isArray(source?.chat) ? source.chat : []).slice(-8)
            .map((message, index) => `chat:${message?.id ?? message?.index ?? latestStart + index}`).map(safeText).filter(Boolean);
        const scannedLocalEvidence = localEvidenceFromSource(source);
        const localEvidence = options.gptMode === true ? compactGptLocalEvidence(scannedLocalEvidence, gptScene) : scannedLocalEvidence;
        const chronicle = options.gptMode === true && rawSerialized.length > 50000
            ? compactGptSourceChronicle(source, GPT_SOURCE_TARGET_CHARS)
            : rawSerialized.length > TWO_PASS_SOURCE_TARGET_CHARS
                ? compactSourceChronicle(source, TWO_PASS_SOURCE_TARGET_CHARS)
                : { source, compacted: false, coveredMessages: Array.isArray(source?.chat) ? source.chat.length : 0 };
        const preparedSource = chronicle.source;
        const serialized = JSON.stringify(preparedSource);
        const worldbookEntries = (source?.worldbooks || []).reduce((sum, book) => sum + (book.entries || []).length, 0);
        const large = rawSerialized.length > 50000 || worldbookEntries > 200;
        if (!large) return { source, localEvidence, gptMode: options.gptMode === true, gptScene, gptRecentRefs, gptLatestRefs, large: false, originalChars: rawSerialized.length, includedChars: rawSerialized.length, worldbookEntries, records: 1 };
        const records = completeSourceRecords(preparedSource);
        const deduplicated = removeMirroredChatRecords(preparedSource, records);
        const batches = options.gptMode === true ? splitGptCompleteRecords(deduplicated.records) : splitCompleteRecords(deduplicated.records);
        const batchChars = batches.map((batch) => JSON.stringify(batch).length);
        return {
            source: null, localEvidence, gptMode: options.gptMode === true, gptScene, gptRecentRefs, gptLatestRefs, batches, halves: batches, large: true, originalChars: rawSerialized.length,
            includedChars: serialized.length, batchChars, halfChars: batchChars, worldbookEntries, records: records.length,
            semanticCompaction: chronicle.compacted,
            coveredChatMessages: chronicle.coveredMessages,
            compactedChatMessages: chronicle.compactedMessages || 0,
            originalChatChars: chronicle.originalChatChars || 0,
            includedChatChars: chronicle.includedChatChars || 0,
            sentRecords: batches.reduce((sum, batch) => sum + batch.length, 0),
            deduplicatedRecords: records.length - deduplicated.records.length,
            deduplicatedRefs: deduplicated.removedRefs,
            progressFragments: batchChars.map((length) => Math.max(1, Math.ceil(length / SOURCE_PROGRESS_FRAGMENT_CHARS))),
        };
    }
    function readFirstHalfCache(cacheKey) {
        if (!cacheKey) return null;
        const chatCache = WSM.Storage?.readSourceReadCache?.(cacheKey);
        if (chatCache && typeof chatCache === 'object') return chatCache;
        if (typeof localStorage === 'undefined') return null;
        try {
            const cache = JSON.parse(localStorage.getItem(FIRST_HALF_CACHE_KEY) || '{}');
            const evidence = cache?.[cacheKey]?.evidence;
            return evidence && typeof evidence === 'object' ? evidence : null;
        } catch (_error) { return null; }
    }
    async function writeFirstHalfCache(cacheKey, evidence) {
        if (!cacheKey || !evidence || typeof evidence !== 'object') return;
        if (typeof WSM.Storage?.writeSourceReadCache === 'function') {
            await WSM.Storage.writeSourceReadCache(cacheKey, evidence);
            return;
        }
        if (typeof localStorage === 'undefined') return;
        try {
            const current = JSON.parse(localStorage.getItem(FIRST_HALF_CACHE_KEY) || '{}');
            const cache = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
            cache[cacheKey] = { at: Date.now(), evidence };
            const recent = Object.entries(cache).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 12);
            localStorage.setItem(FIRST_HALF_CACHE_KEY, JSON.stringify(Object.fromEntries(recent)));
        } catch (error) { console.debug('[WorldStateMachine] 无法保存请求 A 证据缓存', error); }
    }
    function firstHalfCacheKey(prepared, settings) {
        return `sequential8:${hash(JSON.stringify({
            model: settings?.model || '', endpoint: settings?.useTavernApi === false ? settings?.endpoint || '' : 'tavern',
            records: prepared?.batches || prepared?.halves || [], prompt: `${SOURCE_READ_PROMPT}\n${SOURCE_READ_MODULE_EXTENSION}\n${TRUTH_POLICY_PROMPT}`,
        }))}`;
    }
    function mergeStatePatch(base, patch) {
        const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
        const merge = (left, right) => {
            if (!isPlainObject(right)) return WSM.Storage?.clone ? WSM.Storage.clone(right) : structuredClone(right);
            const output = isPlainObject(left)
                ? (WSM.Storage?.clone ? WSM.Storage.clone(left) : structuredClone(left))
                : {};
            Object.entries(right).forEach(([key, value]) => {
                if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
                output[key] = isPlainObject(value) ? merge(output[key], value)
                    : (WSM.Storage?.clone ? WSM.Storage.clone(value) : structuredClone(value));
            });
            return output;
        };
        return merge(base || WSM.Defaults.createState(), patch || {});
    }
    const STATE_COLLECTION_KEYS = new Set(['worldRules','factAnchors','resourceConstraints','organizations','characters','npcActivities','relationships','knowledge','schedules','tasks','events','triggers','threads','processes','causalEffects','timeline']);
    const STATE_COLLECTION_PRIMARY_FIELDS = {
        worldRules: 'statement', factAnchors: 'statement', resourceConstraints: 'condition', organizations: 'name',
        characters: 'name', npcActivities: 'action', relationships: 'identityRelation', knowledge: 'information', schedules: 'title',
        tasks: 'title', events: 'title', triggers: 'title', threads: 'title', processes: 'currentDirection',
        causalEffects: 'cause', timeline: 'summary', locations: 'name',
    };
    function normalizeStateCollection(value, module) {
        if (Array.isArray(value)) return value.filter((item) => item != null && item !== '');
        if (value == null || value === '') return [];
        if (typeof value === 'string') {
            const text = value.trim();
            if (!text) return [];
            if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
                try { return normalizeStateCollection(JSON.parse(text), module); }
                catch (_error) { /* preserve the original model text below */ }
            }
            const field = STATE_COLLECTION_PRIMARY_FIELDS[module] || 'summary';
            const item = { [field]: text };
            if (module === 'events') item.summary = text;
            if (module === 'processes') item.title = text;
            if (module === 'causalEffects') item.result = text;
            return [item];
        }
        if (typeof value !== 'object') return normalizeStateCollection(String(value), module);
        const field = STATE_COLLECTION_PRIMARY_FIELDS[module] || 'summary';
        const itemMarkers = new Set(['id', field, 'title', 'name', 'statement', 'summary', 'information', 'characterId', 'from', 'to', 'cause', 'result', 'currentDirection']);
        if (Object.keys(value).some((key) => itemMarkers.has(key))) return [value];
        return Object.entries(value).flatMap(([key, item]) => {
            const normalized = normalizeStateCollection(item, module);
            return normalized.map((entry) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
                const next = { ...entry };
                if (!next.id && !/^\d+$/.test(key)) next.id = key;
                if (!next[field] && !/^\d+$/.test(key)) next[field] = key;
                return next;
            });
        });
    }
    function normalizeStateCollections(input) {
        const state = input && typeof input === 'object' ? input : WSM.Defaults.createState();
        STATE_COLLECTION_KEYS.forEach((module) => { state[module] = normalizeStateCollection(state[module], module); });
        state.map ||= {};
        state.map.locations = normalizeStateCollection(state.map.locations, 'locations');
        return state;
    }
    function collectionIdentity(module, item = {}) {
        if (module === 'npcActivities') return safeText(item.characterId || item.id);
        if (module === 'relationships') return `${safeText(item.from)}>${safeText(item.to)}`;
        return safeText(item.id || item.title || item.name || item.information || item.summary);
    }
    function applyStateDelta(base, delta = {}) {
        const touchedRevision = Number(base?.revision || 0) + 1;
        const patch = WSM.Storage.clone(delta.statePatch || delta.patch || {});
        if (patch?.progression && typeof patch.progression === 'object' && !Array.isArray(patch.progression)) {
            patch.progression.activity = patch.progression.activity || 'HOT';
            patch.progression.updatedRevision = touchedRevision;
        }
        let next = mergeStatePatch(base || WSM.Defaults.createState(), patch);
        const previousWeather = safeText(base?.world?.location?.weather);
        const candidateWeather = safeText(next?.world?.location?.weather);
        const weatherWasPatched = patch?.world?.location && Object.prototype.hasOwnProperty.call(patch.world.location, 'weather');
        const weatherMeta = next?.world?.location?.weatherMeta || {};
        const weatherRefs = Array.isArray(weatherMeta.sourceRefs) ? weatherMeta.sourceRefs.filter(Boolean) : [];
        const weatherRank = (value) => {
            const input = safeText(value);
            if (/暴(?:雨|雪)|台风|飓风|龙卷/.test(input)) return 6;
            if (/大(?:雨|雪)/.test(input)) return 5;
            if (/中(?:雨|雪)/.test(input)) return 4;
            if (/小(?:雨|雪)|毛毛雨|雨夹雪/.test(input)) return 3;
            if (/阴/.test(input)) return 2;
            if (/多云/.test(input)) return 1;
            if (/晴/.test(input)) return 0;
            return null;
        };
        if (weatherWasPatched && previousWeather && candidateWeather && previousWeather !== candidateWeather
            && weatherRefs.length === 0 && weatherMeta.truthStatus !== 'confirmed') {
            const beforeRank = weatherRank(previousWeather);
            const afterRank = weatherRank(candidateWeather);
            if (beforeRank != null && afterRank != null && Math.abs(afterRank - beforeRank) > 1) {
                next.world.location.weather = previousWeather;
                next.world.location.weatherMeta = WSM.Storage.clone(base.world.location.weatherMeta || { truthStatus: 'unknown', basis: ['天气突变缺少原文依据，已保持上一轮'], sourceRefs: [] });
            }
        }
        const rawOps = Array.isArray(delta.collectionOps) ? [...delta.collectionOps] : [];
        Object.entries(delta.collections || {}).forEach(([module, value]) => {
            (value?.upsert || []).forEach((item) => rawOps.push({ module, op: 'update', id: item?.id, value: item }));
            (value?.replace || []).forEach((item) => rawOps.push({ module, op: 'replace', id: item?.id, value: item }));
            (value?.removeIds || []).forEach((id) => rawOps.push({ module, op: 'remove', id }));
        });
        rawOps.forEach((operation) => {
            const module = safeText(operation?.module);
            const op = safeText(operation?.op || 'update').toLowerCase();
            if (!STATE_COLLECTION_KEYS.has(module)) return;
            const items = Array.isArray(next[module]) ? WSM.Storage.clone(next[module]) : [];
            const value = operation?.value && typeof operation.value === 'object' && !Array.isArray(operation.value)
                ? WSM.Storage.clone(operation.value) : null;
            const wanted = safeText(operation?.id) || collectionIdentity(module, value || {});
            const valueIdentity = value ? collectionIdentity(module, value) : '';
            const index = items.findIndex((item) => {
                const identity = collectionIdentity(module, item);
                return (wanted && (safeText(item?.id) === wanted || identity === wanted)) || (valueIdentity && identity === valueIdentity);
            });
            if (['remove','delete','archive'].includes(op)) {
                if (index >= 0) items.splice(index, 1);
            } else if (value) {
                value.activity = value.activity || 'HOT';
                value.updatedRevision = touchedRevision;
                const previous = index >= 0 ? items[index] : {};
                if (op === 'create' && index < 0) items.push(WSM.Storage?.enforceTruthTransition?.(previous, value, module) || value);
                else if (op === 'replace') {
                    const replacement = WSM.Storage?.enforceTruthTransition?.(previous, value, module) || value;
                    if (index >= 0) items[index] = replacement;
                    else items.push(replacement);
                } else if (index >= 0) {
                    const merged = mergeStatePatch(items[index], value);
                    if (module === 'relationships' && items[index]?.coverageOnly === true && value.status && value.status !== '尚未读取到已确立的关系') {
                        merged.coverageOnly = false;
                        if (!Object.prototype.hasOwnProperty.call(value, 'truthStatus')) delete merged.truthStatus;
                    }
                    if (module === 'tasks' && merged.status === 'done' && Array.isArray(merged.completionConditions) && merged.completionConditions.length) {
                        const completed = new Set(Array.isArray(merged.completedConditions) ? merged.completedConditions.map(safeText) : []);
                        if (merged.completionConditions.some((condition) => !completed.has(safeText(condition)))) {
                            merged.status = 'active';
                            merged.progress = `${safeText(merged.progress)}${merged.progress ? '；' : ''}完成条件尚未全部核验`;
                        }
                    }
                    items[index] = WSM.Storage?.enforceTruthTransition?.(items[index], merged, module) || merged;
                } else items.push(WSM.Storage?.enforceTruthTransition?.({}, value, module) || value);
            }
            next[module] = items;
        });
        // Validate every operation shape, including create/replace. A model
        // cannot close a task by status alone while explicit conditions remain.
        next.tasks = (next.tasks || []).map((task) => {
            if (task?.status !== 'done' || !Array.isArray(task.completionConditions) || !task.completionConditions.length) return task;
            const completed = new Set((Array.isArray(task.completedConditions) ? task.completedConditions : []).map(safeText));
            if (!task.completionConditions.some((condition) => !completed.has(safeText(condition)))) return task;
            const progress = safeText(task.progress);
            return { ...task, status: 'active', progress: `${progress}${progress ? '；' : ''}完成条件尚未全部核验` };
        });
        return next;
    }
    function applyHistoryLedger(base, changes = []) {
        let next = WSM.Storage.clone(base || WSM.Defaults.createState());
        const collectionModules = new Set(STATE_COLLECTION_KEYS);
        (Array.isArray(changes) ? changes : []).forEach((change) => {
            const rawModule = safeText(change?.module);
            const module = ({ anchors: 'factAnchors', causal: 'causalEffects' })[rawModule] || rawModule;
            const operation = change?.operation === 'remove' ? 'remove' : 'update';
            const value = change?.value && typeof change.value === 'object' && !Array.isArray(change.value)
                ? { ...WSM.Storage.clone(change.value), sourceRefs: change.sourceRefs || change.value.sourceRefs || [] }
                : null;
            if (module === 'world' && value) {
                if (operation !== 'remove') next = mergeStatePatch(next, { world: value });
                return;
            }
            if (module === 'progression' && value) {
                if (operation === 'remove') next.progression = WSM.Defaults.createState().progression;
                else next = mergeStatePatch(next, { progression: value });
                return;
            }
            if (module === 'locations') {
                next.map ||= { rootLabel: '大地图', currentLocationId: '', locations: [], routes: [] };
                const locations = Array.isArray(next.map.locations) ? next.map.locations : [];
                const wanted = safeText(change?.entityId || value?.id || value?.name);
                const index = locations.findIndex((item) => safeText(item?.id) === wanted || safeText(item?.name) === wanted);
                if (operation === 'remove') {
                    if (index >= 0) locations.splice(index, 1);
                } else if (value) {
                    if (index >= 0) locations[index] = mergeStatePatch(locations[index], value);
                    else locations.push({ ...value, id: value.id || change.entityId });
                }
                next.map.locations = locations;
                return;
            }
            if (!collectionModules.has(module)) return;
            next = applyStateDelta(next, {
                collectionOps: [{ module, op: operation, id: change?.entityId || value?.id, value }],
            });
        });
        return next;
    }
    function historyChangesFromDelta(delta = {}, sourceRefs = [], prefix = 'turn') {
        const changes = [];
        const push = (module, operation, entityId, value) => {
            const changeId = `${prefix}:${changes.length + 1}:${hash(JSON.stringify({ module, operation, entityId, value }))}`;
            changes.push({ changeId, factId: safeText(value?.factId), module, operation, entityId: safeText(entityId), value: value || {}, sourceRefs, origin: 'chat' });
        };
        const patch = delta.statePatch || delta.patch || {};
        Object.entries(patch).forEach(([module, value]) => push(module, 'upsert', value?.id || '', value));
        const operations = Array.isArray(delta.collectionOps) ? [...delta.collectionOps] : [];
        Object.entries(delta.collections || {}).forEach(([module, value]) => {
            (value?.upsert || []).forEach((item) => operations.push({ module, op: 'update', id: item?.id, value: item }));
            (value?.replace || []).forEach((item) => operations.push({ module, op: 'replace', id: item?.id, value: item }));
            (value?.removeIds || []).forEach((id) => operations.push({ module, op: 'remove', id }));
        });
        operations.forEach((operation) => push(
            safeText(operation?.module),
            ['remove','delete','archive'].includes(safeText(operation?.op).toLowerCase()) ? 'remove' : 'upsert',
            operation?.id || operation?.value?.id,
            operation?.value || {},
        ));
        return changes;
    }
    function normalizeStateResult(result, baseState = null) {
        const envelopes = [result, result?.result, result?.data, result?.output].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
        const wrapped = envelopes.find((item) => item.state && typeof item.state === 'object' && !Array.isArray(item.state));
        if (wrapped) return { ...wrapped, state: normalizeStateCollections(mergeStatePatch(baseState || WSM.Defaults.createState(), wrapped.state)) };
        const stateKeys = Object.keys(WSM.Defaults?.STATE_SCHEMA || {});
        const rootKeyCount = stateKeys.reduce((count, key) => count + (Object.prototype.hasOwnProperty.call(result || {}, key) ? 1 : 0), 0);
        return rootKeyCount >= 3 ? { state: normalizeStateCollections(mergeStatePatch(baseState || WSM.Defaults.createState(), result)), plan: {}, moduleInjections: {} } : result;
    }
    const EVIDENCE_KEYS = ['sourceRefs','canon','worldRules','chronology','timeline','anchors','resourceConstraints','organizations','characters','npcActivities','relationships','knowledge','schedules','locations','tasks','events','triggers','threads','processes','causal','progression','currentScene','uncertainties','matchedRules','derivedFacts','conflicts','staleStates','actorFeasibility','causalCandidates','moduleCoverage','moduleDecisions'];
    const REQUIRED_EVIDENCE_KEYS = EVIDENCE_KEYS.filter((key) => key !== 'sourceRefs');
    const AUDITED_MODULES = ['world','worldRules','factAnchors','resourceConstraints','organizations','map','characters','npcActivities','relationships','knowledge','schedules','tasks','events','triggers','threads','progression','processes','causalEffects','timeline'];
    function validateEvidenceContract(value, label = '资料读取') {
        const missing = REQUIRED_EVIDENCE_KEYS.filter((key) => !Array.isArray(value?.[key]));
        if (missing.length) throw new Error(`${label}漏掉模块：${missing.join('、')}；不能把未返回的栏目当成空栏目`);
        const covered = new Set(value.moduleCoverage.map((item) => safeText(item?.module || item?.name)));
        const decided = new Set(value.moduleDecisions.map((item) => safeText(item?.module)));
        const uncovered = AUDITED_MODULES.filter((module) => !covered.has(module));
        const undecided = AUDITED_MODULES.filter((module) => !decided.has(module));
        if (uncovered.length || undecided.length) throw new Error(`${label}没有逐模块完成推演审计：${[...uncovered, ...undecided].filter((item, index, values) => values.indexOf(item) === index).join('、')}`);
        return value;
    }
    function evidenceItemText(item) {
        if (typeof item === 'string') {
            const value = item.trim();
            if (value.startsWith('{') && value.endsWith('}')) {
                try { return evidenceItemText(JSON.parse(value)); }
                catch (_error) { /* keep the original text */ }
            }
            return safeText(item);
        }
        if (typeof item === 'number') return safeText(item);
        if (!item || typeof item !== 'object') return '';
        return safeText(item.statement || item.rule || item.event || item.progression || item.summary || item.text || item.fact || item.information || item.content || item.description || item.title || item.name || JSON.stringify(item));
    }
    function mergeCompleteEvidence(...inputs) {
        const merged = Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, []]));
        const entityIdentity = (key, item) => {
            if (key === 'sourceRefs') return safeText(item);
            if (!item || typeof item !== 'object' || Array.isArray(item)) return evidenceItemText(item);
            if (key === 'characters') return safeText(item.id || item.name);
            if (key === 'npcActivities') return safeText(item.characterId || item.id);
            if (key === 'relationships') return `${safeText(item.from || item.subject)}>${safeText(item.to || item.object)}`;
            if (key === 'organizations') return safeText(item.id || item.name);
            if (key === 'schedules') return safeText(item.id || item.title);
            if (key === 'moduleCoverage' || key === 'moduleDecisions') return safeText(item.module || item.name);
            if (key === 'worldRules') return safeText(item.id || item.factId || item.statement);
            if (['tasks','events','triggers','threads','processes','causal'].includes(key)) return safeText(item.id || item.title || item.cause || evidenceItemText(item));
            return evidenceItemText(item);
        };
        EVIDENCE_KEYS.forEach((key) => {
            const byIdentity = new Map();
            inputs.forEach((input) => {
                const source = input?.evidence ?? input?.digest ?? input ?? {};
                const values = Array.isArray(source?.[key]) ? source[key] : (source?.[key] == null ? [] : [source[key]]);
                values.forEach((item) => {
                    const identity = entityIdentity(key, item);
                    if (!identity) return;
                    const previousIndex = byIdentity.get(identity);
                    if (previousIndex == null) {
                        byIdentity.set(identity, merged[key].length);
                        merged[key].push(item);
                        return;
                    }
                    const previous = merged[key][previousIndex];
                    if (previous && item && typeof previous === 'object' && typeof item === 'object' && !Array.isArray(previous) && !Array.isArray(item)) {
                        const defined = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined && value !== null && value !== ''));
                        merged[key][previousIndex] = { ...previous, ...defined };
                    }
                });
            });
        });
        return merged;
    }
    const ARCHIVE_FALLBACK_EVIDENCE_KEYS = ['anchors','resourceConstraints','relationships','knowledge','threads'];
    function supplementMissingEvidenceFromArchive(input) {
        const evidence = mergeCompleteEvidence(input);
        const archive = WSM.Storage?.readSourceReadArchive?.(4) || [];
        ARCHIVE_FALLBACK_EVIDENCE_KEYS.forEach((key) => {
            if (evidence[key]?.length) return;
            const previous = archive.find((item) => Array.isArray(item?.[key]) && item[key].length);
            if (previous) evidence[key] = previous[key].map((item) => (item && typeof item === 'object' ? { ...item } : item));
        });
        return evidence;
    }
    function localEvidenceFromSource(source = {}) {
        const evidence = Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, []]));
        const uniquePush = (key, item) => {
            if (!item) return;
            const identity = key === 'sourceRefs' ? safeText(item) : evidenceItemText(item);
            if (!identity || evidence[key].some((value) => evidenceItemText(value) === identity)) return;
            evidence[key].push(item);
        };
        const card = source.character && typeof source.character === 'object' ? source.character : {};
        const cardLabel = safeText(card.name);
        const chats = Array.isArray(source.chat) ? source.chat : [];
        const chatCorpus = chats.map((message) => String(message?.content ?? message?.mes ?? '')).join('\n');
        const familyNamePattern = '[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季贾路娄江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉龚程嵇邢滑裴陆荣翁荀羊甄曲家封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶司黎乔苍双闻莘党翟谭贡劳姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公]';
        const cardSuffixName = safeText(cardLabel.match(new RegExp(`(${familyNamePattern}[\\u3400-\\u9fff]{1,2})$`))?.[1]);
        const mainName = cardSuffixName && chatCorpus.includes(cardSuffixName) ? cardSuffixName : '';
        uniquePush('characters', { id: 'user', name: safeText(source?.identities?.user) || '<USER>', summary: '', sourceRefs: ['identities'], truthStatus: 'confirmed' });
        const rulePattern = /(必须|不得|禁止|严禁|不可|只能|仅能|除非|权限|法律|皇权|阶级|礼法|规则|原则|前置条件)/;
        const ruleCandidates = [];
        (source.worldbooks || []).forEach((book, bookIndex) => (book.entries || []).forEach((entry, entryIndex) => {
            const ref = `worldbook:${book?.name || bookIndex}:${entry?.id ?? entryIndex}`;
            String(entry?.content || '').replace(/<[^>]+>/g, '\n').split(/\n+|(?<=[。！？；!?;])/).map(safeText)
                .filter((line) => line.length >= 10 && line.length <= 360 && rulePattern.test(line))
                .forEach((statement) => ruleCandidates.push({ statement, sourceRefs: [ref], truthStatus: 'confirmed' }));
        }));
        (source.compiledWorldbookRules?.facts || []).forEach((fact) => {
            if (fact?.owner === 'worldRules' || rulePattern.test(safeText(fact?.statement))) ruleCandidates.push(fact);
        });
        ruleCandidates.slice(0, 16).forEach((item) => uniquePush('worldRules', item));

        const field = (block, name) => safeText(
            String(block || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]
            || String(block || '').match(new RegExp(`(?:^|[\\n；;])\\s*${name}\\s*[：:]\\s*([^\\n；;]+)`, 'im'))?.[1],
        );
        const userName = safeText(source?.identities?.user) || '<USER>';
        let latestScene = null;
        chats.forEach((message, index) => {
            const raw = String(message?.content ?? message?.mes ?? '');
            const ref = `chat:${message?.id ?? index}`;
            const memory = taggedBlock(raw, 'meow_FM');
            const indrs = taggedBlock(raw, 'INDRS');
            const header = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').slice(0, 900);
            const time = field(memory, 'time') || field(indrs, '时间地点')
                || safeText(header.match(/(?:📅)?时间[：:]\s*([^|\]\n]+)/)?.[1]);
            const location = field(memory, 'scene')
                || safeText(field(indrs, '时间地点').split(/[，,]/).slice(1).join('，'))
                || safeText(header.match(/(?:📍)?地点[：:]\s*([^|\]\n]+)/)?.[1]);
            const weather = safeText(header.match(/(?:☁️)?天气[：:]\s*([^|\]\n]+)/)?.[1]);
            const plot = field(memory, 'plot') || field(indrs, '全局事件') || field(indrs, '重要变化');
            const currentProgress = field(indrs, '当前进度');
            const todo = field(indrs, '待办事项');
            const seeds = field(memory, 'seeds');
            if (plot && !/^(?:无|未明确|暂无)$/.test(plot)) {
                const objectivePlot = gptObjectiveEventText(plot);
                const event = { title: objectivePlot.split(/[。；;]/)[0].slice(0, 80), summary: objectivePlot, time, location, sourceRefs: [ref], truthStatus: 'confirmed' };
                const major = gptIsMajorEventText(plot);
                const phase = major || GPT_PHASE_PATTERN.test(plot);
                if (major) uniquePush('events', event);
                if (major && /(?:登基|册封|正式成婚|婚姻|死亡|身亡|自裁|处决|不可逆)/.test(objectivePlot)) {
                    uniquePush('anchors', { fact: objectivePlot, sourceRefs: [ref], truthStatus: 'confirmed', priority: 'L3', activity: 'COLD' });
                }
                if (phase) {
                    uniquePush('timeline', { summary: plot, time, location, evidence: [ref], sourceRefs: [ref], truthStatus: 'confirmed' });
                    uniquePush('chronology', { time, summary: plot, location, sourceRefs: [ref], truthStatus: 'confirmed' });
                }
                const expectedTime = safeText(plot.match(/((?:约)?[一二三四五六七八九十百0-9]+(?:天|日|月|年|小时|时辰|分钟)后)/)?.[1]);
                if (expectedTime && /(?:约定|答应|承诺|预约|命令|规定|安排)/.test(plot) && /(?:前往|去|启程|出发|会面|返回|离开|完成|交付|召开|开始)/.test(plot)) {
                    const participantIds = [];
                    if (userName && plot.includes(userName)) participantIds.push('user');
                    if (mainName && plot.includes(mainName)) participantIds.push(mainName);
                    const precondition = safeText(plot.match(/(?:在|待)([^。；]{2,36}?)(?:完成|结束|满足)后/)?.[1]);
                    uniquePush('schedules', {
                        title: plot.slice(0, 100), participantIds, expectedTime, preconditions: precondition ? [precondition] : [],
                        status: 'agreed', source: '正文中的明确未来安排', sourceRefs: [ref], truthStatus: 'confirmed',
                    });
                }
            }
            if (todo && !/^(?:无|未明确|暂无)$/.test(todo)) uniquePush('tasks', { title: todo.split(/[，,；;]/)[0].slice(0, 80), description: todo, status: 'active', ownerIds: ['user'], sourceRefs: [ref], truthStatus: 'confirmed' });
            if (seeds && !/^(?:无|未明确|暂无)$/.test(seeds)) uniquePush('triggers', { title: seeds.split(/[。；;]/)[0].slice(0, 80), conditions: [seeds], status: 'armed', sourceRefs: [ref], truthStatus: 'suspected' });
            if (currentProgress && !/^(?:无|未明确|暂无)$/.test(currentProgress)) uniquePush('progression', { direction: currentProgress, currentMovement: plot, sourceRefs: [ref], truthStatus: 'confirmed' });
            if (time || location || weather || currentProgress || plot) latestScene = {
                time, location, weather, environment: currentProgress || plot,
                sourceRefs: [ref], truthStatus: 'confirmed',
            };
            // Assistant message names are character-card or group metadata,
            // not reliable person names. Real people come from story content.
        });
        // Do not infer a story-specific identity from titles, costumes, card
        // labels, or honorifics here. Identity extraction belongs to the
        // evidence reader, which must return the exact quoted basis.
        const recentStart = Math.max(0, chats.length - 16);
        chats.slice(recentStart).forEach((message, offset) => {
            if (message?.role !== 'assistant') return;
            const index = recentStart + offset;
            const ref = `chat:${message?.id ?? index}`;
            const visible = String(message?.content ?? message?.mes ?? '')
                .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                .replace(/<(?:meow_FM|INDRS|abstract|note)[^>]*>[\s\S]*?<\/(?:meow_FM|INDRS|abstract|note)>/gi, '')
                .replace(/\[[^\]]{0,80}\]/g, '');
            visible.split(/(?<=[。！？!?；;])/).map(safeText).filter((sentence) => sentence.length >= 6 && sentence.length <= 180).forEach((sentence) => {
                const explicitConstraint = /(禁足|封锁.{0,24}(?:道路|城门|地区|建筑)|不得离开|不能离开|无法离开|不许离开|哪儿也别去|只能留在|必须留在|没有.{0,12}(?:权限|许可|通行证|门卡)|必须持有.{0,12}(?:许可|通行证|门卡))/.test(sentence);
                if (!explicitConstraint || GPT_SUBJECTIVE_SPECULATION_PATTERN.test(sentence)) return;
                const userName = safeText(source?.identities?.user);
                const subjectId = /你|用户/.test(sentence) || (userName && sentence.includes(userName)) ? 'user' : '';
                const kind = /封锁|城门|道路|通行/.test(sentence) ? 'blockade' : /权限|许可|门卡/.test(sentence) ? 'access' : 'mobility';
                const consequence = kind === 'blockade' ? '相关地点或道路当前不可自由通行' : '当前不能自由离开指定地点';
                const constrainedPlace = safeText(sentence.match(/(?:留在|待在)([\u3400-\u9fff]{2,12}?)(?:里|内|，|。)/)?.[1]);
                const condition = /哪儿也别去|只能留在|必须留在|不得离开|不能离开|无法离开|不许离开/.test(sentence)
                        ? `${userName || '<USER>'}近日被要求留在${constrainedPlace || '指定地点'}，暂不能自由离开。`
                        : kind === 'blockade'
                            ? '相关地点或道路目前处于封锁状态。'
                            : '当前行动受明确权限或通行条件限制。';
                uniquePush('resourceConstraints', {
                    condition, subjectId, kind, consequence, status: 'active',
                    priority: 'L2', activity: index >= chats.length - 4 ? 'HOT' : 'WARM',
                    sourceRefs: [ref], truthStatus: 'confirmed', basis: ['最近正文明确限制了行动可行性'],
                });
                // A sentence can simultaneously establish a restriction and
                // an NPC's current off-screen work (for example a blockade).
            });
            visible.split(/(?<=[。！？!?；;])/).map(safeText).filter((sentence) => sentence.length >= 6 && sentence.length <= 180).forEach((sentence) => {
                for (const match of sentence.matchAll(/([\u3400-\u9fff]{2,4}?)(?:的人)?[^，。！？!?；;]{0,16}(搜捕|清查|接管|处理|部署|驻守|调查|护送)([^。！？!?；;]{0,60})/g)) {
                    const actor = safeText(match[1]);
                    if (!actor || /^(?:朕|我|他|她|其)|(?:这边|事情|时候|现在|三天后|之后|此前|其中)$/.test(actor)) continue;
                    const userName = safeText(source?.identities?.user);
                    if (actor === userName) continue;
                    const action = safeText(`${match[2]}${match[3]}`);
                    uniquePush('npcActivities', {
                        characterId: actor, characterName: actor, action, location: '',
                        status: 'active', priority: 'L2', activity: index >= chats.length - 4 ? 'HOT' : 'WARM',
                        sourceRefs: [ref], truthStatus: 'confirmed', basis: ['最近正文明确写出该人物正在执行的行动'],
                    });
                }
            });
        });
        if (latestScene) uniquePush('currentScene', latestScene);
        if (!evidence.progression.length && evidence.events.length) {
            const latest = evidence.events.at(-1);
            uniquePush('progression', { direction: latest.summary, currentMovement: latest.summary, sourceRefs: latest.sourceRefs, truthStatus: 'derived' });
        }
        return evidence;
    }
    function gptSceneFromSource(source = {}) {
        const chats = Array.isArray(source?.chat) ? source.chat : [];
        const latest = [...chats].reverse().find((message) => message?.role === 'assistant' && safeText(message?.content));
        if (!latest) return null;
        const raw = String(latest.content || '');
        const memory = taggedBlock(raw, 'meow_FM');
        const pick = (name) => safeText(
            memory.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]
            || memory.match(new RegExp(`(?:^|[\\n；;])\\s*${name}\\s*[：:]\\s*([^\\n；;]+)`, 'im'))?.[1],
        );
        const header = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').match(/【📅时间[：:]([^|]+)\|📍地点[：:]([^|]+)\|☁️天气[：:]([^|]+)(?:\|[^】]*)?】/);
        const time = pick('time') || safeText(header?.[1]);
        const location = pick('scene') || safeText(header?.[2]);
        const rawWeather = safeText(header?.[3]);
        const weather = safeText(rawWeather.replace(/^\[[^\]]+\]\s*/, ''));
        const plot = pick('plot');
        const season = safeText(time.match(/(?:^|\s)(春|夏|秋|冬)(?:\s|$)/)?.[1]);
        const sourceRefs = [`chat:${latest.id ?? latest.index ?? chats.length - 1}`];
        if (!time && !location && !weather && !plot) return null;
        return {
            time, season, location, weather,
            environment: [location, weather].filter(Boolean).join(' · '),
            currentConditions: plot ? [plot] : [], sourceRefs, truthStatus: 'confirmed',
        };
    }
    function compactGptLocalEvidence(evidence, scene) {
        const next = mergeCompleteEvidence(evidence);
        next.characters = next.characters.filter((item) => {
            const value = typeof item === 'object' ? item : {};
            const name = safeText(value.name || evidenceItemText(item));
            return value.id === 'char' || (!!name && !/^(?:User|Assistant|System)$/i.test(name));
        }).slice(0, 8);
        // Raw meow_FM/INDRS `plot` fields are secondary summaries, not module
        // assignments. Keep only locally verified major milestones.
        next.events = next.events.slice(-6);
        next.timeline = next.timeline.slice(-8);
        next.chronology = next.chronology.slice(-8);
        next.tasks = [];
        next.triggers = next.triggers.slice(-4);
        next.progression = next.progression.slice(-1);
        if (scene) next.currentScene = [scene];
        return next;
    }
    const GPT_MAJOR_EVENT_PATTERN = /(登基|退位|废黜|降为|册封|正式封为|成婚|婚礼|决裂|死亡|身亡|自裁|处决|被杀|遇刺|刺杀|谋反|政变|叛乱|下达平叛军令|平叛行动(?:开始|完成)|围困皇城|战争|开战|停战|覆灭|灭亡|(?:管理权|权力)(?:核心)?(?:完成)?(?:正式)?交替|接管.{0,12}(?:政权|防务|组织)|城池.{0,12}(?:失守|易手)|重大(?:事故|灾害)|决堤|封锁.{0,12}(?:道路|城池)|正式建立|不可逆)/;
    const GPT_MICRO_EVENT_PATTERN = /(吐槽|不信|逗弄|试探|询问|反问|调侃|糕点|干酪|吃饭|用膳|晚膳|下马|进帐|进入营帐|安排.{0,8}营帐|梳妆|更衣|换上|牵手|拥抱|喂(?:食|鱼|葡萄|荔枝)|散步|对弈|闲聊|表示|回应|邀请.{0,12}(?:下马|进帐|一叙)|去别处玩)/;
    const GPT_NONFINAL_EVENT_PATTERN = /(意图|意欲|打算|准备|计划|拟定|拟封|拟将|要将|提出.{0,20}(?:方案|可以|册封)|宣告要|若.{0,20}(?:便|则|将)|即将|尚未|等待)/;
    const GPT_SUBJECTIVE_SPECULATION_PATTERN = /(控制欲|占有欲|深爱|深情|嫉妒|依赖|动摇|心理防线|被打动|心动|爱意|偏执|情感拉扯|极致亲密|价值观.{0,8}鸿沟|深刻认知|冷血|残忍|排斥|决意|暗中评估|保持观望|内心.{0,8}(?:渴望|恐惧|绝望|波澜)|人格|性格倾向)/;
    const GPT_PHASE_PATTERN = /(逃出|逃亡|重逢|找回|抓回|归京|入宫|离宫|伏击|治水|身份真相|正式关系|册封|登基|自裁|身亡|死亡|谋反|权力.{0,8}交替|重大转折)/;
    const GPT_ANCHOR_PATTERN = /(真实身份|身份真相|血缘|亲属|父女|母女|兄妹|婚姻|正式成婚|现任皇帝|登基|册封|死亡|身亡|自裁|处决|永久|不可逆|正式建立|正式解除|权力.{0,8}交替)/;
    const GPT_STALE_TASK_PATTERN = /^(?:无|暂无|没有)[。！!？?\s]*$/;
    const GPT_FUTURE_KNOWLEDGE_PATTERN = /(?:最终)?是否会|会采取何种|将采取什么|未来会|尚未明确.{0,12}(?:态度|结果)|可能发生什么/;
    const GPT_WORLD_PROCESS_PATTERN = /(朝堂|后宫势力|地方势力|政权|政治|战争|军队|组织|家族|政策|法律|舆论|社会|经济|灾害|环境|清洗|集权|管理权|权力|防务)/;
    function gptIsMajorEventText(input) {
        const text = safeText(input);
        if (/伪造.{0,6}死亡|假死|尚未发生|仅为(?:提议|方案|选择)|(?:^|[，,；;])(?:一是|二是)|给出.{0,8}选择/.test(text)) return false;
        if (!GPT_MAJOR_EVENT_PATTERN.test(text)) return false;
        if (GPT_NONFINAL_EVENT_PATTERN.test(text) && !/(已|当即|正式|最终|实际|完成|身亡|死亡|自裁|处决|血溅|下达平叛军令|围困皇城)/.test(text)) return false;
        return !GPT_MICRO_EVENT_PATTERN.test(text) || /(死亡|身亡|自裁|处决|谋反|政变|平叛|围困皇城|权力.{0,8}交替)/.test(text);
    }
    function gptObjectiveText(input) {
        const clauses = safeText(input).split(/[。！？；!?;,，]+/).map(safeText).filter(Boolean);
        const objective = clauses.filter((clause) => !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(clause));
        return safeText((objective.length ? objective : clauses.filter((clause) => gptIsMajorEventText(clause))).join('；'));
    }
    function gptObjectiveEventText(input) {
        const text = safeText(input);
        const breach = text.match(/([\u3400-\u9fff]{2,8}(?:江|河|湖|矶|堤|坝|城|州|县))决堤/);
        if (breach) return `${breach[1]}决堤。`;
        const demotion = text.match(/将([\u3400-\u9fff]{2,8})降为[“"]?([^，”"。；]{2,12})[”"]?/);
        if (demotion) return `${demotion[1]}被降为${safeText(demotion[2]).replace(/[“”"]+/g, '')}。`;
        const confer = text.match(/(?:正式|当即)?册封([\u3400-\u9fff]{1,8})为[“"]?([^，”"。；]{2,12}?)(?=的旨意|[，”"。；])/);
        if (confer && !/催促.{0,12}册封|册封.{0,12}之事/.test(text)) return `${confer[1] === '你' ? (safeText(WSM.Context?.identityNames?.()?.user) || '<USER>') : confer[1]}被册封为${safeText(confer[2]).replace(/[“”"]+/g, '')}。`;
        const clauses = text.split(/(?<=[。！？；!?;])/).map(safeText).filter(Boolean);
        const selected = clauses.filter((clause) => gptIsMajorEventText(clause) && !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(clause));
        return safeText((selected.length ? selected : clauses.filter((clause) => gptIsMajorEventText(clause))).join(''));
    }
    function gptEvidenceRefs(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        return (Array.isArray(item.sourceRefs) ? item.sourceRefs : Array.isArray(item.evidence) ? item.evidence : []).map(safeText).filter(Boolean);
    }
    function gptEvidenceObject(item, fallbackKey = 'summary') {
        if (item && typeof item === 'object' && !Array.isArray(item)) return { ...item };
        return { [fallbackKey]: safeText(item) };
    }
    function gptEvidenceSignature(module, item) {
        const value = gptEvidenceObject(item);
        const rawText = evidenceItemText(value);
        const signatureText = ['events','timeline','chronology'].includes(module) ? (gptObjectiveEventText(rawText) || rawText) : rawText;
        const text = signatureText.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
        if (module === 'characters') {
            const name = safeText(value.name || value.character || value.person || text);
            return name.toLowerCase();
        }
        return text.slice(0, 180);
    }
    function gptDedupeEvidence(items, module, limit) {
        const byKey = new Map();
        (Array.isArray(items) ? items : []).forEach((item) => {
            const key = gptEvidenceSignature(module, item);
            if (!key) return;
            const previous = byKey.get(key);
            if (!previous || evidenceItemText(item).length >= evidenceItemText(previous).length) byKey.set(key, item);
        });
        return [...byKey.values()].slice(-limit);
    }
    function sanitizeGptEvidence(input, prepared = {}) {
        const evidence = mergeCompleteEvidence(input);
        const scene = prepared?.gptScene;
        const recentRefs = new Set((prepared?.gptRecentRefs || []).map(safeText));
        const latestRefs = new Set((prepared?.gptLatestRefs || prepared?.gptRecentRefs || []).map(safeText));
        const isRecent = (item) => {
            const refs = gptEvidenceRefs(item);
            return refs.some((ref) => recentRefs.has(ref));
        };
        const isMajorEvent = (item) => {
            const text = evidenceItemText(item);
            return gptIsMajorEventText(text);
        };
        const eventCandidates = [...evidence.events, ...evidence.timeline, ...evidence.chronology, ...evidence.anchors]
            .filter(isMajorEvent).map((item) => {
                const value = gptEvidenceObject(item);
                const summary = gptObjectiveEventText(evidenceItemText(item));
                return { ...value, title: summary.split(/[。；;]/)[0].slice(0, 80), summary };
            });
        evidence.events = gptDedupeEvidence(eventCandidates, 'events', 6);
        evidence.timeline = gptDedupeEvidence(evidence.timeline.filter((item) => {
            const text = evidenceItemText(item);
            return (GPT_MAJOR_EVENT_PATTERN.test(text) || GPT_PHASE_PATTERN.test(text)) && (!GPT_MICRO_EVENT_PATTERN.test(text) || GPT_MAJOR_EVENT_PATTERN.test(text));
        }), 'timeline', 16);
        evidence.chronology = gptDedupeEvidence(evidence.chronology.filter((item) => {
            const text = evidenceItemText(item);
            return isRecent(item) || GPT_MAJOR_EVENT_PATTERN.test(text) || GPT_PHASE_PATTERN.test(text);
        }), 'chronology', 12);
        evidence.tasks = evidence.tasks.filter((item) => {
            const value = gptEvidenceObject(item, 'title');
            const text = safeText(value.title || value.description || evidenceItemText(item));
            const status = safeText(value.status).toLowerCase();
            return isRecent(item) && text && !GPT_STALE_TASK_PATTERN.test(text) && !['done','completed','resolved','expired','cancelled'].includes(status);
        }).slice(-4);
        evidence.triggers = evidence.triggers.filter((item) => {
            const value = gptEvidenceObject(item, 'title');
            const conditions = Array.isArray(value.conditions) ? value.conditions.map(safeText).filter(Boolean) : (value.conditions ? [safeText(value.conditions)] : []);
            const text = evidenceItemText(item);
            return gptEvidenceRefs(item).some((ref) => latestRefs.has(ref)) && conditions.length > 0 && !/(可能|也许|或许|猜测|联想到某些旧事)/.test(text) && !['triggered','expired','resolved'].includes(safeText(value.status).toLowerCase());
        }).slice(-4);
        evidence.npcActivities = evidence.npcActivities.filter((item) => isRecent(item) && gptEvidenceRefs(item).length > 0).slice(-6);
        evidence.anchors = gptDedupeEvidence(evidence.anchors.filter((item) => {
            const text = evidenceItemText(item);
            return GPT_ANCHOR_PATTERN.test(text) && !/(可能|疑似|极有可能|性格|底线|破防|性行为|船娘|普通经历)/.test(text);
        }), 'anchors', 8);
        evidence.relationships = evidence.relationships.filter((item) => !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(evidenceItemText(item))).slice(-10);
        evidence.knowledge = evidence.knowledge.filter((item) => !GPT_FUTURE_KNOWLEDGE_PATTERN.test(evidenceItemText(item)) && !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(evidenceItemText(item))).slice(-12);
        evidence.processes = evidence.processes.filter((item) => GPT_WORLD_PROCESS_PATTERN.test(evidenceItemText(item)) && !/(心理防线|恋爱|感情|依赖|妥协)/.test(evidenceItemText(item))).slice(-5);
        evidence.causal = evidence.causal.filter((item) => !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(evidenceItemText(item)) && (isRecent(item) || gptIsMajorEventText(evidenceItemText(item)) || /(?:仍在|持续|正在|当前|导致.{0,20}(?:限制|不适|无法|禁止))/.test(evidenceItemText(item)))).slice(-5);
        evidence.threads = evidence.threads.filter((item) => !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(evidenceItemText(item)) && !GPT_FUTURE_KNOWLEDGE_PATTERN.test(evidenceItemText(item))).slice(-6);
        evidence.resourceConstraints = evidence.resourceConstraints.filter((item) => {
            const text = evidenceItemText(item);
            return !/(嫉妒|盟友|筹码|庇护)/.test(text) || /(封锁|权限|人身自由|无法|禁止|不得)/.test(text);
        }).slice(-8);
        evidence.characters = gptDedupeEvidence(evidence.characters.filter((item) => !/^(?:User|Assistant|System)$/i.test(safeText(gptEvidenceObject(item).name))).map((item) => {
            const value = gptEvidenceObject(item);
            ['summary','description','notes'].forEach((key) => { if (value[key]) value[key] = gptObjectiveText(value[key]); });
            return value;
        }), 'characters', 10);
        if (scene) {
            evidence.currentScene = [scene];
            if (scene.currentConditions?.length) evidence.progression = [{
                direction: safeText(scene.currentConditions[0]), currentMovement: safeText(scene.currentConditions[0]),
                sourceRefs: scene.sourceRefs || [], truthStatus: 'confirmed', priority: 'L2', activity: 'HOT',
            }];
        }
        return evidence;
    }
    function sanitizeGptHydratedState(state, prepared = {}) {
        if (!state || typeof state !== 'object') return state;
        const scene = prepared?.gptScene;
        const recentRefs = new Set((prepared?.gptRecentRefs || scene?.sourceRefs || []).map(safeText));
        const latestRefs = new Set((prepared?.gptLatestRefs || prepared?.gptRecentRefs || scene?.sourceRefs || []).map(safeText));
        const textOf = (item) => safeText(item?.summary || item?.title || item?.description || item?.information || item?.statement || item?.currentDirection || evidenceItemText(item));
        const refsOf = (item) => (Array.isArray(item?.sourceRefs) ? item.sourceRefs : Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : Array.isArray(item?.evidence) ? item.evidence : []).map(safeText).filter(Boolean);
        // A compressed chat-block can represent hundreds of old turns. It is
        // evidence, but never proof that a current-only item is recent.
        const recent = (item) => refsOf(item).some((ref) => recentRefs.has(ref));
        const major = (item) => {
            const text = textOf(item);
            return gptIsMajorEventText(text);
        };
        const unique = (items, keyOf, limit) => {
            const seen = new Set();
            return (Array.isArray(items) ? items : []).filter((item) => {
                const key = keyOf(item);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(-limit);
        };
        const hydratedEventSources = (state.events || []).length ? state.events : [...(state.factAnchors || []), ...(state.timeline || [])];
        const eventCandidates = hydratedEventSources
            .filter(major).map((item) => ({
                ...item,
                title: gptObjectiveEventText(item?.summary || item?.fact || item?.description || textOf(item)).split(/[。；;]/)[0].slice(0, 80),
                summary: gptObjectiveEventText(item?.summary || item?.fact || item?.description || textOf(item)),
                status: safeText(item?.status || 'occurred'),
            })).filter((item) => item.title && item.summary);
        state.events = unique(eventCandidates, (item) => gptEvidenceSignature('events', item), 6);
        state.timeline = unique((state.timeline || []).filter((item) => {
            const text = textOf(item);
            return GPT_MAJOR_EVENT_PATTERN.test(text) || GPT_PHASE_PATTERN.test(text);
        }), (item) => gptEvidenceSignature('timeline', item), 16);
        state.factAnchors = unique((state.factAnchors || []).filter((item) => {
            const text = textOf(item);
            return GPT_ANCHOR_PATTERN.test(text) && gptIsMajorEventText(text) && !/(可能|疑似|性格|底线|破防|性行为|船娘|伪造.{0,6}死亡|假死|给出.{0,8}选择|一是|二是|捏造.{0,12}身份|要将)/.test(text);
        }).map((item) => {
            const fact = gptObjectiveEventText(textOf(item));
            return fact ? { ...item, fact, summary: fact } : item;
        }), (item) => textOf(item).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase(), 8);
        state.triggers = (state.triggers || []).filter((item) => {
            const conditions = Array.isArray(item?.conditions) ? item.conditions.filter((value) => safeText(value)) : [];
            return refsOf(item).some((ref) => latestRefs.has(ref)) && conditions.length && !/(可能|也许|或许|猜测|联想到某些旧事)/.test(textOf(item)) && !['triggered','expired','resolved'].includes(safeText(item?.status).toLowerCase());
        }).slice(-4);
        state.relationships = (state.relationships || []).filter((item) => !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(textOf(item)));
        state.knowledge = (state.knowledge || []).filter((item) => !GPT_FUTURE_KNOWLEDGE_PATTERN.test(textOf(item)) && !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(textOf(item)) && !/(?:是否|尚不清楚|尚未明确|仍未知)/.test(textOf(item))).slice(-12);
        state.processes = (state.processes || []).filter((item) => GPT_WORLD_PROCESS_PATTERN.test(textOf(item)) && !/(心理防线|恋爱|感情|依赖|妥协)/.test(textOf(item))).slice(-5);
        state.causalEffects = (state.causalEffects || []).filter((item) => !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(textOf(item)) && (recent(item) || gptIsMajorEventText(textOf(item)) || /(?:仍在|持续|正在|当前|导致.{0,20}(?:限制|不适|无法|禁止))/.test(textOf(item)))).slice(-5);
        state.threads = (state.threads || []).filter((item) => !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(textOf(item)) && !GPT_FUTURE_KNOWLEDGE_PATTERN.test(textOf(item))).slice(-6);
        state.tasks = (state.tasks || []).filter((item) => !GPT_SUBJECTIVE_SPECULATION_PATTERN.test(textOf(item))).slice(-6);
        state.resourceConstraints = (state.resourceConstraints || []).filter((item) => {
            const text = textOf(item);
            return !/(嫉妒|盟友|筹码|庇护)/.test(text) || /(封锁|权限|人身自由|无法|禁止|不得)/.test(text);
        }).slice(-8);
        const deadNames = new Set();
        [...(state.events || []), ...(state.factAnchors || []), ...(state.timeline || [])].forEach((item) => {
            const match = textOf(item).match(/([\u3400-\u9fff]{2,8})(?:自裁|死亡|身亡|已死|被处决)/);
            if (match?.[1]) deadNames.add(match[1]);
        });
        state.npcActivities = (state.npcActivities || []).filter((item) => {
            const actor = safeText(item?.characterName || item?.name || item?.actor || item?.characterId);
            return recent(item) && ![...deadNames].some((name) => actor.includes(name) || textOf(item).startsWith(name));
        }).slice(-6);
        state.relationships = unique((state.relationships || []).reverse(), (item) => {
            const pair = [safeText(item?.fromId || item?.sourceId || item?.from || item?.personA), safeText(item?.toId || item?.targetId || item?.to || item?.personB)].filter(Boolean).sort();
            return pair.length === 2 ? pair.join('|') : textOf(item).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
        }, 12).reverse();
        state.characters = (state.characters || []).map((item) => {
            const value = { ...item };
            ['summary','description','notes'].forEach((key) => { if (value[key]) value[key] = gptObjectiveText(value[key]); });
            return value;
        });
        if (scene?.currentConditions?.length) state.progression = {
            ...(state.progression || {}), priority: 'L2', activity: 'HOT',
            direction: safeText(scene.currentConditions[0]), currentMovement: safeText(scene.currentConditions[0]),
            nextRequiredChanges: [], basedOnRefs: scene.sourceRefs || [], blockedByDecision: '',
        };
        return state;
    }
    function applyGptSceneToState(result, prepared) {
        const state = result?.state;
        const scene = prepared?.gptScene;
        if (!state) return result;
        if (prepared?.gptMode !== true) return result;
        if (!scene) {
            sanitizeGptHydratedState(state, prepared);
            return result;
        }
        const refs = Array.isArray(scene.sourceRefs) ? scene.sourceRefs : [];
        if (scene.time) Object.assign(state.world.time, { display: scene.time, truthStatus: 'confirmed', basis: ['最新助手正文状态栏'], sourceRefs: refs });
        if (scene.season) {
            state.world.season = scene.season;
            state.world.seasonMeta = { truthStatus: 'confirmed', basis: ['由最新正文时间直接读取'], sourceRefs: refs };
        }
        if (scene.location) {
            state.world.location.current = scene.location;
            state.world.location.currentMeta = { truthStatus: 'confirmed', basis: ['最新助手正文状态栏'], sourceRefs: refs };
        }
        if (scene.weather) {
            state.world.location.weather = scene.weather;
            state.world.location.weatherMeta = { truthStatus: 'confirmed', basis: ['最新助手正文状态栏'], sourceRefs: refs };
        }
        state.world.location.environment = scene.environment || [scene.time, scene.location, scene.weather].filter(Boolean).join('，') || state.world.location.environment;
        state.world.location.environmentMeta = { truthStatus: scene.environment ? 'confirmed' : 'derived', basis: [scene.environment ? '最新正文明确环境' : '由当前时间、地点与天气组合为简短客观环境'], sourceRefs: refs };
        const latestPlot = safeText(scene.currentConditions?.[0]);
        const narrativeSummary = /(?:提出|询问|答应|承诺|约定|默认|随后|回到|返回|相拥|入眠|谈话)/;
        const objectiveConditions = (scene.currentConditions || []).map(safeText).filter((value) => value && !narrativeSummary.test(value));
        state.world.currentConditions = objectiveConditions.slice(0, 3);
        state.world.currentConditionDetails = state.world.currentConditions.map((value) => ({ value, truthStatus: 'confirmed', basis: ['最新正文仍在生效的客观条件'], sourceRefs: refs }));
        state.sceneState = {
            ...(state.sceneState || {}), location: scene.location || state.world.location.current,
            presentCharacterIds: (state.characters || []).filter((item) => item.present === true).map((item) => item.id),
            currentIssue: latestPlot, completedActions: latestPlot ? [latestPlot] : [], pendingResponses: [], obstacles: [], interactionPoints: [], endConditions: [],
            truthStatus: refs.length ? 'confirmed' : 'derived', basis: ['由最新场景正文建立，不进入正文注入'], sourceRefs: refs,
        };
        const relativeTime = safeText(latestPlot.match(/((?:约)?[一二三四五六七八九十百0-9]+(?:天|日|月|年|小时|时辰|分钟)后)/)?.[1]);
        const scheduledAction = relativeTime && /(?:前往|去|启程|出发|会面|返回|离开|完成|交付|召开|开始)/.test(latestPlot) ? latestPlot : '';
        if (scheduledAction && !(state.schedules || []).some((item) => safeText(item?.title) === scheduledAction)) {
            state.schedules = [{
                id: `schedule-${hash(`${relativeTime}:${scheduledAction}`)}`, title: scheduledAction,
                participantIds: [], expectedTime: relativeTime, preconditions: [], status: 'agreed',
                source: '最新正文中的明确时间安排', priority: 'L2', activity: 'HOT', truthStatus: 'confirmed',
                basis: ['正文同时明确了相对时间与将执行的行动'], sourceRefs: refs,
            }, ...(state.schedules || [])].slice(0, 12);
        }
        if (latestPlot) {
            const currentRefSet = new Set(refs.map(safeText));
            state.tasks = (state.tasks || []).filter((item) => {
                const itemRefs = Array.isArray(item?.sourceRefs) ? item.sourceRefs.map(safeText) : [];
                return itemRefs.some((ref) => currentRefSet.has(ref) || /^chat-block:/.test(ref));
            }).slice(0, 6);
        }
        state.characters = (state.characters || []).filter((item, index, values) => {
            const name = safeText(item?.name);
            return name && !/^(?:User|Assistant|System)$/i.test(name) && values.findIndex((other) => safeText(other?.name) === name) === index;
        });
        state.knowledge = (state.knowledge || []).filter((item) => !/(?:是否|尚不清楚|仍未知)/.test(safeText(item?.information)));

        sanitizeGptHydratedState(state, prepared);
        return result;
    }
    function normalizeGptIdentityAliases(state, cardLabel = '') {
        if (!state || !Array.isArray(state.characters)) return state;
        const inferredName = (item) => safeText(item?.summary || item?.description).match(/^([\u3400-\u9fff]{2,8})[：:]/)?.[1] || '';
        const normalizedCardLabel = safeText(cardLabel);
        const contextUserName = safeText(WSM.Context?.identityNames?.()?.user);
        const storedUserName = safeText(state.identities?.user);
        const configuredUserName = contextUserName || (!/^(?:user|<user>)$/i.test(storedUserName) ? storedUserName : '') || '<USER>';
        const previousUserName = safeText(state.identities?.user);
        const userCharacter = state.characters.find((item) => ['user','<user>'].includes(safeText(item?.id).toLowerCase()) || /^(?:User|用户|<user>)$/i.test(safeText(item?.name)));
        const userAliases = new Set((Array.isArray(userCharacter?.aliases) ? userCharacter.aliases : []).map(safeText).filter(Boolean));
        const inferredUserName = inferredName(userCharacter);
        const legacyUserName = !/^(?:user|<user>)$/i.test(previousUserName) && previousUserName !== configuredUserName ? previousUserName : inferredUserName;
        const placeholderCharacterName = state.characters.map((item) => {
            const id = safeText(item?.id).toLowerCase();
            const name = safeText(item?.name);
            return ['char','character','<char>'].includes(id) || /^(?:char|character|<char>)$/i.test(name) || (normalizedCardLabel && name === normalizedCardLabel)
                ? inferredName(item)
                : '';
        }).find((name) => name && name !== normalizedCardLabel) || '';
        const cardContainedPersonName = state.characters.map((item) => safeText(item?.name))
            .filter((name) => /^[\u3400-\u9fff]{2,8}$/.test(name) && normalizedCardLabel.includes(name))
            .sort((a, b) => a.length - b.length)[0] || '';
        const explicitCharacterName = placeholderCharacterName || cardContainedPersonName;
        const explicitCharacterId = explicitCharacterName ? `person-${explicitCharacterName}` : '';
        const normalizeRef = (value) => {
            const raw = safeText(value);
            const key = raw.toLowerCase();
            if (['user','<user>'].includes(key) || userAliases.has(raw) || (legacyUserName && raw === legacyUserName)) return 'user';
            if (explicitCharacterId && ['char','character','<char>'].includes(key)) return explicitCharacterId;
            return value;
        };
        const normalized = state.characters.map((item) => {
            const id = safeText(item?.id).toLowerCase();
            const name = safeText(item?.name);
            if (['user','<user>'].includes(id) || /^(?:User|用户|<user>)$/i.test(name)) {
                return { ...item, id: 'user', name: configuredUserName };
            }
            if (userAliases.has(name)) return null;
            if (['char','character','<char>'].includes(id) || /^(?:char|character|<char>)$/i.test(name) || (normalizedCardLabel && name === normalizedCardLabel)) {
                const explicitName = inferredName(item);
                return explicitName && explicitName !== normalizedCardLabel ? { ...item, id: `person-${explicitName}`, name: explicitName } : null;
            }
            if (explicitCharacterName && name !== explicitCharacterName && normalizedCardLabel.includes(name) && name.includes(explicitCharacterName)) return null;
            return item;
        }).filter(Boolean).filter((item) => !normalizedCardLabel || safeText(item?.name) !== normalizedCardLabel);
        if (!normalized.some((item) => item?.id === 'user' || safeText(item?.name) === configuredUserName)) {
            normalized.unshift({ id: 'user', name: configuredUserName, maintenanceLevel: 'core', present: false });
        }
        state.characters = normalized.filter((item, index, values) => {
            const name = safeText(item?.name);
            return name && values.findIndex((other) => safeText(other?.name) === name) === index;
        });
        const refArrays = ['ownerIds','participantIds','participants','characterRefs','affectedIds','holderIds','knownBy','believedBy','suspectedBy','misunderstoodBy','unknownTo','leaderIds','presentCharacterIds'];
        const refScalars = ['from','to','characterId','subjectId'];
        const collections = ['npcActivities','relationships','knowledge','schedules','organizations','tasks','events','triggers','threads','processes','causalEffects','timeline','resourceConstraints'];
        collections.forEach((module) => (state[module] || []).forEach((item) => {
            refArrays.forEach((field) => {
                if (Array.isArray(item?.[field])) item[field] = item[field].map(normalizeRef);
            });
            refScalars.forEach((field) => {
                if (item?.[field] != null) item[field] = normalizeRef(item[field]);
            });
        }));
        const replaceUserMentions = (value) => {
            if (typeof value === 'string') {
                if (/^(?:user|<user>)$/i.test(value)) return value;
                let output = value.replace(/<user>|\buser\b/gi, configuredUserName).replace(/你/g, configuredUserName);
                if (legacyUserName && !/^(?:user|<user>)$/i.test(legacyUserName)) output = output.split(legacyUserName).join(configuredUserName);
                userAliases.forEach((alias) => { output = output.split(alias).join(configuredUserName); });
                return output;
            }
            if (Array.isArray(value)) return value.map(replaceUserMentions);
            if (value && typeof value === 'object') {
                Object.keys(value).forEach((key) => { value[key] = replaceUserMentions(value[key]); });
            }
            return value;
        };
        replaceUserMentions(state);
        state.identities = { user: configuredUserName, char: '' };
        return syncIdentities(state, { user: configuredUserName, char: '' });
    }
    function reconcileEntityReferences(state) {
        if (!state || !Array.isArray(state.characters)) return state;
        const userName = safeText(state.identities?.user || WSM.Context?.identityNames?.()?.user);
        const characters = state.characters.filter((item) => safeText(item?.id) && safeText(item?.name));
        const byId = new Map(characters.map((item) => [safeText(item.id), item]));
        const byName = new Map();
        characters.forEach((item) => [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])].map(safeText).filter(Boolean).forEach((name) => byName.set(name.toLocaleLowerCase(), item)));
        if (userName) byName.set(userName.toLocaleLowerCase(), byId.get('user') || { id: 'user', name: userName });
        const namesIn = (value) => characters.filter((item) => safeText(item.name) && safeText(value).includes(safeText(item.name))).sort((a, b) => safeText(value).indexOf(a.name) - safeText(value).indexOf(b.name));
        const resolve = (ref, context = '', excluded = '') => {
            const raw = safeText(ref);
            if (!raw) return raw;
            if (byId.has(raw)) return raw;
            if (['user','<user>'].includes(raw.toLowerCase()) || (userName && raw === userName)) return 'user';
            const direct = byName.get(raw.toLocaleLowerCase());
            if (direct) return direct.id;
            if (/^(?:character|person)-[a-z0-9]+$/i.test(raw)) {
                const candidate = namesIn(context).find((item) => item.id !== excluded);
                if (candidate) return candidate.id;
            }
            return raw;
        };
        const refArrays = ['ownerIds','participantIds','participants','characterRefs','affectedIds','holderIds','knownBy','believedBy','suspectedBy','misunderstoodBy','unknownTo','leaderIds','presentCharacterIds'];
        const refScalars = ['from','to','characterId','subjectId'];
        ['npcActivities','relationships','knowledge','schedules','organizations','tasks','events','triggers','threads','processes','causalEffects','timeline','resourceConstraints'].forEach((module) => (state[module] || []).forEach((item) => {
            const context = [item?.name,item?.title,item?.status,item?.type,item?.identityRelation,item?.currentPerception,item?.formationBasis,item?.information,item?.summary,item?.description].map(safeText).filter(Boolean).join('；');
            if (module === 'relationships') {
                item.from = resolve(item.from, context);
                item.to = resolve(item.to, context, item.from);
            }
            refScalars.forEach((field) => { if (item?.[field] != null && module !== 'relationships') item[field] = resolve(item[field], context); });
            refArrays.forEach((field) => { if (Array.isArray(item?.[field])) item[field] = [...new Set(item[field].map((value) => resolve(value, context)).filter(Boolean))]; });
        }));
        if (Array.isArray(state.sceneState?.presentCharacterIds)) {
            const sceneContext = [state.sceneState.currentIssue, ...(state.sceneState.completedActions || []), ...(state.sceneState.pendingResponses || [])].map(safeText).join('；');
            state.sceneState.presentCharacterIds = [...new Set(state.sceneState.presentCharacterIds.map((value) => resolve(value, sceneContext)).filter(Boolean))];
            const presentIds = new Set(state.sceneState.presentCharacterIds);
            characters.forEach((character) => {
                character.present = presentIds.has(character.id);
                if (character.present && !safeText(character.location)) character.location = safeText(state.sceneState.location || state.world?.location?.current);
            });
        }
        const directed = new Map();
        (state.relationships || []).forEach((item) => {
            if (!item?.from || !item?.to || item.from === item.to) return;
            const context = safeText(item.status || item.identityRelation || item.type);
            const fromName = byId.get(item.from)?.name || item.from;
            const toName = byId.get(item.to)?.name || item.to;
            const formal = safeText(item.identityRelation || item.type || context).replace(/^(?:未明确|未知|unknown)$/i, '');
            const currentPerception = safeText(item.currentPerception || item.dynamicPattern).replace(/^(?:未明确|未知|unknown)$/i, '');
            const normalized = { ...item, id: safeText(item.id || `relationship-${hash(`${item.from}>${item.to}`)}`), identityRelation: formal, currentPerception, formationBasis: safeText(item.formationBasis || item.evidence || item.basis), status: safeText(item.status).replace(/^(?:未明确|未知|unknown)$/i, '') };
            directed.set(`${normalized.from}>${normalized.to}`, normalized);
            if (!directed.has(`${normalized.to}>${normalized.from}`) && formal) directed.set(`${normalized.to}>${normalized.from}`, {
                ...normalized, id: `relationship-${hash(`${normalized.to}>${normalized.from}`)}`, from: normalized.to, to: normalized.from,
                identityRelation: formal.replace(fromName, '__FROM__').replace(toName, fromName).replace('__FROM__', toName), currentPerception: '', status: '',
                formationBasis: normalized.formationBasis || '由同一正式身份关系反向建立；不推断心理认知',
            });
        });
        state.relationships = [...directed.values()];
        return state;
    }
    function auditStateLifecycle(state, incomingAudit = {}) {
        reconcileEntityReferences(state);
        const priorAudit = state?.reasoningAudit && typeof state.reasoningAudit === 'object' ? state.reasoningAudit : {};
        const audit = { matchedRules: [], derivedFacts: [], conflicts: [], staleStates: [], actorFeasibility: [], causalCandidates: [], moduleDecisions: [], ...priorAudit, ...(incomingAudit || {}) };
        const timeline = Array.isArray(state.timeline) ? state.timeline : [];
        const archive = (module, item, reason) => {
            const summary = safeText(item?.outcome || item?.summary || item?.result || item?.currentDirection || item?.title);
            if (summary && !timeline.some((entry) => safeText(entry?.summary) === summary)) timeline.push({ id: `timeline-${hash(`${module}:${item?.id || summary}`)}`, summary, granularity: 'phase', participants: item?.participantIds || item?.affectedIds || [], location: item?.location || '', priority: item?.priority || 'L2', activity: 'WARM', truthStatus: item?.truthStatus || 'confirmed', basis: [reason], sourceRefs: item?.sourceRefs || [] });
            audit.staleStates.push(`${module}:${item?.id || item?.title || summary}｜${reason}`);
            audit.moduleDecisions.push({ module, operation: 'ARCHIVE', reason });
        };
        const filterTerminal = (module, terminal, reason) => { state[module] = (state[module] || []).filter((item) => { if (!terminal.has(safeText(item?.status).toLowerCase())) return true; archive(module, item, reason); return false; }); };
        filterTerminal('schedules', new Set(['completed','cancelled']), '安排已经完成或取消，不再占用当前安排');
        filterTerminal('events', new Set(['occurred','completed','resolved']), '事件节点已经结束，压缩进入时间线');
        filterTerminal('processes', new Set(['resolved','completed']), '世界进程已经完成，不再作为持续进程');
        filterTerminal('causalEffects', new Set(['resolved','discarded']), '因果影响已经消失或路径不成立');
        state.resourceConstraints = (state.resourceConstraints || []).filter((item) => { const stale = ['satisfied','expired','resolved'].includes(safeText(item?.status).toLowerCase()); if (stale) audit.staleStates.push(`resourceConstraints:${item.id || item.condition}｜限制已解除`); return !stale; });
        state.tasks = (state.tasks || []).filter((item) => !['done','failed','completed'].includes(safeText(item?.status).toLowerCase()));
        const present = new Set((state.characters || []).filter((item) => item.present === true || (safeText(state.world?.location?.current) && safeText(item.location) === safeText(state.world.location.current))).map((item) => item.id));
        state.npcActivities = (state.npcActivities || []).filter((item) => !present.has(item.characterId));
        const narrative = /(?:提出|询问|答应|承诺|约定|默认|随后|回到|返回|相拥|入眠|谈话)/;
        state.world.currentConditions = (state.world.currentConditions || []).filter((value) => !narrative.test(safeText(value))).slice(0, 8);
        state.world.currentConditionDetails = (state.world.currentConditionDetails || []).filter((item) => state.world.currentConditions.includes(item?.value));
        state.timeline = timeline.slice(-24);
        audit.matchedRules = [...new Set((audit.matchedRules || []).map(safeText).filter(Boolean))];
        const allModules = ['world','worldRules','factAnchors','resourceConstraints','organizations','map','characters','npcActivities','relationships','knowledge','schedules','tasks','events','triggers','threads','progression','processes','causalEffects','timeline'];
        const decided = new Set((audit.moduleDecisions || []).map((item) => item?.module));
        allModules.forEach((module) => { if (!decided.has(module)) audit.moduleDecisions.push({ module, operation: 'KEEP', reason: '已完成本轮检查；没有足够证据要求改变当前版本' }); });
        state.reasoningAudit = audit;
        return reconcileEntityReferences(state);
    }
    async function refreshGptLocalState() {
        const settings = WSM.Settings.get();
        const existing = WSM.Storage.load();
        const source = await WSM.Context.buildSource({ fullChat: true, preserveFull: true, includeHidden: true });
        const chats = Array.isArray(source?.chat) ? source.chat : [];
        const previouslyRead = Number(existing.runtime?.sourceSummary?.chatMessages || existing.runtime?.sourceSummary?.sourceRead?.totalReadableMessages || 0);
        if (!chats.length || (existing.initialized && previouslyRead >= 20 && chats.length < Math.min(20, previouslyRead))) {
            throw new Error(`酒馆聊天正文尚未加载完成（当前 ${chats.length} 层，既有读取 ${previouslyRead || '未知'} 层）；已保留原状态，请稍后重试`);
        }
        const prepared = {
            gptMode: settings.gptMode === true,
            gptScene: gptSceneFromSource(source),
            gptRecentRefs: chats.slice(-32).map((message, index) => `chat:${message?.id ?? message?.index ?? Math.max(0, chats.length - 32) + index}`),
            gptLatestRefs: chats.slice(-8).map((message, index) => `chat:${message?.id ?? message?.index ?? Math.max(0, chats.length - 8) + index}`),
        };
        const localEvidence = sanitizeGptEvidence(localEvidenceFromSource(source), prepared);
        const rebuilt = stateFromEvidence(localEvidence, {}, WSM.Defaults.createState()).state;
        const state = existing.initialized ? existing : rebuilt;
        state.events = rebuilt.events || [];
        state.timeline = rebuilt.timeline || [];
        state.causalEffects = rebuilt.causalEffects || [];
        state.resourceConstraints = rebuilt.resourceConstraints || [];
        state.npcActivities = rebuilt.npcActivities || [];
        state.triggers = rebuilt.triggers || [];
        const mergedCharacters = new Map();
        [...(state.characters || []), ...(rebuilt.characters || [])].forEach((character, index) => {
            const id = safeText(character?.id).toLowerCase();
            const name = safeText(character?.name).toLocaleLowerCase();
            const key = ['user','<user>'].includes(id) ? 'user' : (name || id || String(index));
            mergedCharacters.set(key, { ...(mergedCharacters.get(key) || {}), ...character });
        });
        state.characters = [...mergedCharacters.values()];
        state.factAnchors = normalizeStateCollection([...(state.factAnchors || []), ...(rebuilt.factAnchors || [])], 'factAnchors');
        if (settings.gptMode === true) applyGptSceneToState({ state }, prepared);
        else sanitizeGptHydratedState(state, prepared);
        normalizeGptIdentityAliases(state, safeText(source?.character?.name));
        state.runtime ||= {};
        state.planner ||= {};
        delete state.runtime.finalInjectionOverride;
        state.initialized = true;
        state.runtime.gptLocalNormalizationVersion = 31;
        state.runtime.sharedLocalNormalizationVersion = 31;
        // Local rebuilding changes the authoritative state without running a
        // planner turn. Refresh the cached preview as part of the same save so
        // the UI and the next registered prompt immediately see inferred
        // identities and other rebuilt facts.
        state.planner.injection = WSM.Injection.compose(
            state,
            state.planner.plan || {},
            state.planner.moduleInjections || {},
        );
        return WSM.Storage.save(state, 'shared-local-normalization', { snapshot: true, snapshotKind: 'organization' });
    }
    function stateFromEvidence(firstEvidence, secondEvidence, baseState = null) {
        const evidence = mergeCompleteEvidence(firstEvidence, secondEvidence);
        const state = mergeStatePatch(baseState || WSM.Defaults.createState(), {});
        const objectItem = (item) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) return { ...item };
            if (typeof item === 'string') {
                const value = item.trim();
                if (value.startsWith('{') && value.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(value);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
                    } catch (_error) { /* use the text fallback */ }
                }
            }
            return {};
        };
        const sceneText = evidence.currentScene.map(evidenceItemText).filter(Boolean).join('\n');
        const priorityOf = (item, text, fallback = 'L2') => {
            const explicit = safeText(item.priority).toUpperCase();
            if (['L1','L2','L3'].includes(explicit)) return explicit;
            if (/(真实身份|身份真相|重大秘密|核心秘密|不可逆|死亡|血缘|亲属|婚姻|世界规则|底层规则|关键承诺|主线矛盾|事件真相)/.test(text)) return 'L3';
            if (/(吃了|喝了|早餐|午餐|晚餐|零食|短暂情绪|微笑|皱眉|坐下|站起|穿着|拿着|日常闲聊)/.test(text)) return 'L1';
            return fallback;
        };
        const activityOf = (item, text, priority) => {
            const explicit = safeText(item.activity).toUpperCase();
            if (['HOT','WARM','COLD'].includes(explicit)) return explicit;
            if (item.present === true || ['active','ongoing','eligible'].includes(safeText(item.status).toLowerCase())) return 'HOT';
            if (text && sceneText && (sceneText.includes(text.slice(0, 36)) || text.includes(sceneText.slice(0, 36)))) return 'HOT';
            return priority === 'L3' ? 'COLD' : 'WARM';
        };
        const mapped = (items, prefix, factory) => items.map((item, index) => {
            const text = evidenceItemText(item);
            const source = objectItem(item);
            const result = factory(source, text, `${prefix}-${hash(`${index}:${text}`)}`);
            if (!result || prefix === 'location') return result;
            const priority = priorityOf(source, text, prefix === 'timeline' ? 'L1' : prefix === 'anchor' ? 'L3' : 'L2');
            const sourceRefs = Array.isArray(result.sourceRefs) ? result.sourceRefs.filter(Boolean).map(safeText)
                : (Array.isArray(source.sourceRefs) ? source.sourceRefs.filter(Boolean).map(safeText) : []);
            const basis = Array.isArray(result.basis) ? result.basis.filter(Boolean).map(safeText)
                : (result.basis ? [safeText(result.basis)] : []);
            const module = ({ rule: 'worldRules', anchor: 'factAnchors', constraint: 'resourceConstraints', organization: 'organizations', character: 'characters', npcActivity: 'npcActivities', relationship: 'relationships', knowledge: 'knowledge', schedule: 'schedules', task: 'tasks', event: 'events', trigger: 'triggers', thread: 'threads', process: 'processes', causal: 'causalEffects', timeline: 'timeline' })[prefix] || prefix;
            const primitiveEvidence = typeof item === 'string' || typeof item === 'number';
            const prepared = {
                ...result,
                priority,
                activity: activityOf(source, text, priority),
                sourceRefs,
                truthStatus: safeText(result.truthStatus || source.truthStatus || (primitiveEvidence ? 'derived' : '')) || undefined,
                basis: basis.length ? basis : (primitiveEvidence ? ['由完整资料读取结果确定性提取；原始聊天与世界书仍是权威来源'] : []),
            };
            const enforced = WSM.Storage?.enforceTruthTransition?.({}, prepared, module) || prepared;
            // Truth validation can legitimately demote an unsupported L3 item.
            // If COLD was only inferred from that former L3 priority, recompute
            // it as WARM so the evidence is not silently discarded.
            if (!safeText(source.activity) && enforced.activity === 'COLD' && enforced.priority !== 'L3') enforced.activity = 'WARM';
            return enforced;
        }).filter(Boolean);
        const selectRuntime = (items, limit) => items.filter((item) => item.activity === 'HOT' || (item.activity === 'WARM' && item.priority !== 'L1') || item.priority === 'L3')
            .sort((a, b) => ({ HOT: 3, WARM: 2, COLD: 1 }[b.activity] || 0) - ({ HOT: 3, WARM: 2, COLD: 1 }[a.activity] || 0)
                || ({ L3: 3, L2: 2, L1: 1 }[b.priority] || 0) - ({ L3: 3, L2: 2, L1: 1 }[a.priority] || 0))
            .slice(0, limit);
        const explicitPlaceOf = (item) => {
            const source = objectItem(item);
            return safeText(source.location || source.place || source.currentLocation || source.venue);
        };
        const latestExplicitPlace = (items) => [...items].reverse().map(explicitPlaceOf).find(Boolean) || '';
        const scenePlace = latestExplicitPlace(evidence.currentScene);
        // A compressed chat digest may omit currentScene while still retaining
        // the newest explicit location in chronology/timeline. Prefer that
        // concrete field to leaving both the world snapshot and map unset.
        const narrativePlace = scenePlace || latestExplicitPlace(evidence.chronology) || latestExplicitPlace(evidence.timeline);
        const scene = evidence.currentScene.flatMap((item) => {
            const value = objectItem(item);
            const conditions = Array.isArray(value.objectiveConditions) ? value.objectiveConditions
                : Array.isArray(value.currentConditions) ? value.currentConditions : [];
            return conditions.map(safeText).filter(Boolean);
        }).filter((text) => !/(吃了|喝了|早餐|午餐|晚餐|零食|微笑|皱眉|坐下|站起|穿着|拿着)/.test(text)).slice(-8);
        // Canon from worldbooks/character cards remains in its source of truth.
        // The live world snapshot only keeps current-scene facts, otherwise a
        // large setting library is duplicated into state on first hydration.
        state.world.currentConditions = [...new Set(scene)].slice(-8);
        state.world.currentConditionDetails = state.world.currentConditions.map((value) => {
            const evidenceItem = evidence.currentScene.find((item) => evidenceItemText(item) === value);
            const source = objectItem(evidenceItem);
            const sourceRefs = Array.isArray(source.sourceRefs) ? source.sourceRefs.filter(Boolean).map(safeText) : [];
            return { value, truthStatus: sourceRefs.length ? 'confirmed' : 'unknown', basis: sourceRefs.length ? ['当前客观状态来自场景原文证据'] : ['场景证据未绑定来源，等待回查'], sourceRefs };
        });
        const latestScene = [...evidence.currentScene].reverse().find((item) => explicitPlaceOf(item)) || evidence.currentScene.at(-1);
        const latestSceneObject = objectItem(latestScene);
        const sceneRefs = Array.isArray(latestSceneObject.sourceRefs) ? latestSceneObject.sourceRefs.filter(Boolean).map(safeText) : [];
        state.world.location.current = safeText(narrativePlace || state.world.location.current);
        if (narrativePlace) state.world.location.currentMeta = { truthStatus: sceneRefs.length ? 'confirmed' : 'unknown', basis: [sceneRefs.length ? '当前地点来自已读取的场景/时间证据' : '地点证据没有绑定来源，等待回查'], sourceRefs: sceneRefs };
        state.world.location.environment = safeText(latestSceneObject.environment || state.world.location.environment);
        if (latestSceneObject.environment) state.world.location.environmentMeta = { truthStatus: sceneRefs.length ? 'confirmed' : 'assumed', basis: ['环境来自当前场景证据'], sourceRefs: sceneRefs };
        if (latestSceneObject.weather) {
            state.world.location.weather = safeText(latestSceneObject.weather);
            state.world.location.weatherMeta = { truthStatus: sceneRefs.length ? 'confirmed' : 'assumed', basis: ['天气来自当前场景证据'], sourceRefs: sceneRefs };
        }
        if (latestSceneObject.season) {
            state.world.season = safeText(latestSceneObject.season);
            state.world.seasonMeta = { truthStatus: sceneRefs.length ? 'confirmed' : 'assumed', basis: ['季节来自当前场景证据'], sourceRefs: sceneRefs };
        }
        const latestChronology = objectItem(evidence.chronology.at(-1));
        const latestChronologyText = evidenceItemText(evidence.chronology.at(-1));
        state.world.time.display = safeText(latestSceneObject.time || latestChronology.time || latestChronology.date || latestChronology.display || state.world.time.display || latestChronologyText.slice(0, 100));
        const timeRefs = latestSceneObject.time ? sceneRefs : (Array.isArray(latestChronology.sourceRefs) ? latestChronology.sourceRefs.filter(Boolean).map(safeText) : []);
        if (state.world.time.display) Object.assign(state.world.time, { truthStatus: timeRefs.length ? 'confirmed' : 'assumed', basis: ['时间来自已读取的时间顺序证据'], sourceRefs: timeRefs });
        state.sceneState = {
            ...(state.sceneState || {}),
            location: safeText(latestSceneObject.location || narrativePlace),
            presentCharacterIds: Array.isArray(latestSceneObject.presentCharacterIds || latestSceneObject.presentCharacters)
                ? (latestSceneObject.presentCharacterIds || latestSceneObject.presentCharacters).map(safeText).filter(Boolean) : [],
            currentIssue: safeText(latestSceneObject.currentIssue),
            completedActions: Array.isArray(latestSceneObject.completedActions) ? latestSceneObject.completedActions.map(safeText).filter(Boolean) : [],
            pendingResponses: Array.isArray(latestSceneObject.pendingResponses) ? latestSceneObject.pendingResponses.map(safeText).filter(Boolean) : [],
            obstacles: Array.isArray(latestSceneObject.obstacles) ? latestSceneObject.obstacles.map(safeText).filter(Boolean) : [],
            interactionPoints: Array.isArray(latestSceneObject.interactionPoints) ? latestSceneObject.interactionPoints.map(safeText).filter(Boolean) : [],
            endConditions: Array.isArray(latestSceneObject.endConditions) ? latestSceneObject.endConditions.map(safeText).filter(Boolean) : [],
            truthStatus: sceneRefs.length ? 'confirmed' : 'unknown', basis: ['由最新场景证据建立；不作为剧情摘要注入'], sourceRefs: sceneRefs,
        };
        const irreversibleAnchorPattern = /(登基|册封|正式成为|真实身份|身份真相|血缘|亲属|婚姻|死亡|身亡|自裁|不可逆|永久|失去|获得|建立|摧毁|覆灭|决堤|封锁)/;
        const derivedAnchorEvidence = [...evidence.canon, ...evidence.timeline, ...evidence.chronology, ...evidence.events].flatMap((item) => {
            const text = evidenceItemText(item);
            if (!irreversibleAnchorPattern.test(text) || !gptIsMajorEventText(text)) return [];
            const fact = gptObjectiveEventText(text);
            if (!fact || /(?:伪造.{0,6}死亡|假死|给出.{0,8}选择|一是|二是|尚未发生)/.test(text)) return [];
            const value = objectItem(item);
            return [{ ...value, fact, summary: fact }];
        });
        const anchorEvidence = gptDedupeEvidence([...evidence.anchors, ...derivedAnchorEvidence], 'anchors', 16);
        state.factAnchors = selectRuntime(mapped(anchorEvidence, 'anchor', (item, text, id) => ({
            ...item, id: safeText(item.id || id), fact: safeText(item.fact || item.anchor || item.description || item.summary || text), scope: safeText(item.scope),
            sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.slice(0, 3) : [],
        })), 16).map((item) => ({ ...item, priority: 'L3', activity: item.activity || 'COLD' }));
        state.worldRules = mapped(evidence.worldRules, 'rule', (item, text, id) => ({
            ...item,
            id: safeText(item.id || item.factId || id),
            factId: safeText(item.factId || item.id || id),
            owner: 'worldRules',
            consumers: Array.isArray(item.consumers) ? item.consumers.map(safeText).filter(Boolean) : [],
            delivery: safeText(item.delivery || (item.constant === true ? 'resident' : 'conditional')),
            statement: safeText(item.statement || item.rule || item.summary || text),
            scope: Array.isArray(item.scope) ? item.scope.map(safeText).filter(Boolean) : (item.scope ? [safeText(item.scope)] : []),
            conditions: Array.isArray(item.conditions) ? item.conditions.map(safeText).filter(Boolean) : (item.conditions ? [safeText(item.conditions)] : []),
            exceptions: Array.isArray(item.exceptions) ? item.exceptions.map(safeText).filter(Boolean) : (item.exceptions ? [safeText(item.exceptions)] : []),
            precedence: Number(item.precedence || 70),
            sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.slice(0, 4) : [],
        })).filter((item) => item.statement).slice(0, 64);
        state.resourceConstraints = selectRuntime(mapped(evidence.resourceConstraints, 'constraint', (item, text, id) => ({
            ...item, id: safeText(item.id || id), subjectId: safeText(item.subjectId || item.subject),
            kind: safeText(item.kind || 'other'), condition: safeText(item.condition || item.summary || text),
            status: safeText(item.status || 'active'), amount: safeText(item.amount), scope: safeText(item.scope),
            consequence: safeText(item.consequence || item.effect), sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.slice(0, 3) : [],
        })).filter((item) => item.condition && item.status !== 'expired'), 10);
        state.organizations = selectRuntime(mapped(evidence.organizations, 'organization', (item, text, id) => ({
            ...item, id: safeText(item.id || id), name: safeText(item.name || item.organization || text.split(/[：:]/)[0]),
            kind: safeText(item.kind || item.type || 'other'), leaderIds: Array.isArray(item.leaderIds) ? item.leaderIds.map(safeText).filter(Boolean) : [],
            jurisdiction: safeText(item.jurisdiction || item.scope), goals: Array.isArray(item.goals) ? item.goals.map(safeText).filter(Boolean) : [],
            resources: Array.isArray(item.resources) ? item.resources.map(safeText).filter(Boolean) : [], situation: safeText(item.situation || item.summary || text),
        })).filter((item) => item.name), 24);
        const mappedCharacters = mapped(evidence.characters, 'character', (item, text, id) => ({
            ...item, id: safeText(item.id || id), name: safeText(item.name || item.character || item.person || item.characterId || text.split(/[：:]/)[0].trim().slice(0, 80)),
            identity: safeText(item.identity), location: safeText(item.location || item.currentLocation), situation: safeText(item.situation || item.currentSituation),
            summary: safeText(item.summary), description: safeText(item.description), notes: safeText(item.notes),
            maintenanceLevel: safeText(item.maintenanceLevel || (item.present === true ? 'core' : 'active')),
        })).filter((item) => item.name && !/^[{["']|^(?:characterId|identity|truthStatus)$/i.test(item.name));
        const charactersByName = new Map();
        mappedCharacters.forEach((character, index) => {
            const key = safeText(character.name).toLocaleLowerCase() || safeText(character.id) || String(index);
            const previous = charactersByName.get(key);
            charactersByName.set(key, previous ? { ...previous, ...character, id: previous.id || character.id } : character);
        });
        state.characters = selectRuntime([...charactersByName.values()], 24);
        const characterForText = (value) => {
            const content = safeText(value);
            if (!content) return null;
            return state.characters
                .filter((character) => safeText(character.name) && content.includes(safeText(character.name)))
                .sort((a, b) => safeText(b.name).length - safeText(a.name).length)[0] || null;
        };
        const mappedNpcActivities = mapped(evidence.npcActivities, 'npcActivity', (item, text, id) => ({
            ...item, id: safeText(item.id || id), characterId: safeText(item.characterId || item.character || item.actorId || item.actor),
            location: safeText(item.location), movement: safeText(item.movement || item.route),
            action: safeText(item.action || item.activity || item.summary || text), currentRole: safeText(item.currentRole || item.role),
        })).map((item) => {
            const raw = safeText(item.characterId);
            const known = state.characters.find((character) => raw === safeText(character.id) || raw === safeText(character.name)
                || (character.aliases || []).map(safeText).includes(raw));
            return known ? { ...item, characterId: known.id } : null;
        }).filter((item) => item?.characterId && item.action);
        const latestNpcActivity = new Map();
        mappedNpcActivities.forEach((item) => latestNpcActivity.set(item.characterId, item));
        state.npcActivities = selectRuntime([...latestNpcActivity.values()], 12);
        state.relationships = selectRuntime(mapped(evidence.relationships, 'relationship', (item, text, id) => {
            const participants = Array.isArray(item.participants) ? item.participants.map(safeText).filter(Boolean) : [];
            if (participants.length < 2) {
                state.characters.filter((character) => safeText(character.name) && text.includes(safeText(character.name)))
                    .sort((a, b) => text.indexOf(safeText(a.name)) - text.indexOf(safeText(b.name)))
                    .forEach((character) => { if (!participants.includes(character.id)) participants.push(character.id); });
            }
            if (participants.length < 2) {
                const pair = text.match(/^(.{1,24}?)(?:与|和|↔)(.{1,24}?)(?=[：:]|是|之间)/);
                [pair?.[1], pair?.[2]].map(safeText).filter(Boolean).forEach((name) => { if (!participants.includes(name)) participants.push(name); });
            }
            return {
                ...item,
                id: safeText(item.id || id),
                from: safeText(item.from || item.subject || participants[0]),
                to: safeText(item.to || item.object || participants[1]),
                participants: participants.slice(0, 8),
                identityRelation: safeText(item.identityRelation || item.formalRelation || item.type),
                currentPerception: safeText(item.currentPerception || item.perception),
                formationBasis: safeText(item.formationBasis || item.basis || item.evidence),
                status: safeText(item.status || item.summary || item.description || text),
            };
        }).filter((item) => item.from && item.to), 16);
        state.knowledge = selectRuntime(mapped([...evidence.knowledge, ...evidence.uncertainties], 'knowledge', (item, text, id) => ({
            ...item, id: safeText(item.id || id), information: safeText(item.information || item.summary || text),
            holderIds: Array.isArray(item.holderIds) ? item.holderIds.map(safeText).filter(Boolean) : (Array.isArray(item.knownBy) ? item.knownBy.map(safeText).filter(Boolean) : []),
            cognitiveStatus: safeText(item.cognitiveStatus || (evidence.uncertainties.includes(item) ? 'suspected' : 'confirmed')).toLowerCase(),
            userVisible: item.userVisible === true,
            status: safeText(item.status || (evidence.uncertainties.includes(item) ? 'Suspected' : 'Known')),
        })), 24);
        state.schedules = selectRuntime(mapped(evidence.schedules, 'schedule', (item, text, id) => ({
            ...item, id: safeText(item.id || id), title: safeText(item.title || item.arrangement || item.summary || text),
            participantIds: Array.isArray(item.participantIds) ? item.participantIds.map(safeText).filter(Boolean) : [],
            expectedTime: safeText(item.expectedTime || item.time || item.date), preconditions: Array.isArray(item.preconditions) ? item.preconditions.map(safeText).filter(Boolean) : [],
            status: safeText(item.status || 'agreed').toLowerCase(), source: safeText(item.source || item.origin),
        })).filter((item) => item.title && !['completed','cancelled'].includes(item.status)), 12);
        const locationEvidence = [];
        const locationKeys = new Set();
        const pushLocationEvidence = (value) => {
            const source = objectItem(value);
            const name = safeText(source.name || source.location || source.place || source.currentLocation || evidenceItemText(value).slice(0, 100));
            if (!name) return;
            const parentId = safeText(source.parentId);
            const key = `${name.toLocaleLowerCase()}\u0000${parentId.toLocaleLowerCase()}`;
            if (locationKeys.has(key)) return;
            locationKeys.add(key);
            locationEvidence.push({ ...source, name, parentId });
        };
        evidence.locations.forEach(pushLocationEvidence);
        const countryRoots = locationEvidence.filter((item) => safeText(item.type).toLowerCase() === 'country' && !safeText(item.parentId));
        const defaultCountry = countryRoots.length === 1 ? safeText(countryRoots[0].name) : '';
        const originOf = (item, fallback) => {
            const source = objectItem(item);
            const participants = Array.isArray(source.participants) ? source.participants.map(safeText).filter(Boolean).slice(0, 2) : [];
            const actor = safeText(source.actor || source.character || source.characterId || participants.join('、'));
            const action = safeText(source.activity || source.action || source.summary || source.event || source.description);
            const origin = [actor, action].filter(Boolean).join('｜');
            return (origin || fallback).slice(0, 100);
        };
        const addLocationPath = (item, sourceKind, current = false) => {
            const rawPlace = explicitPlaceOf(item);
            if (!rawPlace) return;
            const parts = rawPlace.split(/\s*(?:·|＞|>|\/|\\)\s*/).map((part) => part.trim()).filter(Boolean);
            if (!parts.length) return;
            let parentName = defaultCountry && parts[0] !== defaultCountry ? defaultCountry : '';
            parts.forEach((name, index) => {
                pushLocationEvidence({
                    name,
                    parentId: parentName,
                    origin: originOf(item, sourceKind === 'currentScene' ? '当前场景位置' : '正文中出现'),
                    status: current && index === parts.length - 1 ? 'visited' : 'known',
                    priority: index === 0 ? 'L3' : 'L2',
                    activity: current && index === parts.length - 1 ? 'HOT' : 'WARM',
                    sourceRefs: Array.isArray(objectItem(item).sourceRefs) ? objectItem(item).sourceRefs.slice(0, 3) : [],
                });
                parentName = name;
            });
        };
        evidence.currentScene.forEach((item) => addLocationPath(item, 'currentScene', explicitPlaceOf(item) === narrativePlace));
        evidence.chronology.forEach((item) => addLocationPath(item, 'chronology', !scenePlace && explicitPlaceOf(item) === narrativePlace));
        evidence.timeline.forEach((item) => addLocationPath(item, 'timeline', !scenePlace && explicitPlaceOf(item) === narrativePlace));
        evidence.events.forEach((item) => addLocationPath(item, 'event'));
        evidence.npcActivities.forEach((item) => addLocationPath(item, 'npcActivity'));
        evidence.characters.forEach((item) => addLocationPath(item, 'character'));
        state.map.locations = mapped(locationEvidence, 'location', (item, text, id) => ({
            ...item, id: safeText(item.id || id), name: safeText(item.name || item.location || item.place || text.slice(0, 100)),
            description: safeText(item.description || item.spatialDescription), origin: safeText(item.origin || item.establishedBy || (item.sourceKind === 'worldbook' ? '世界设定' : '')),
            parentId: safeText(item.parentId), sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
        }));
        state.tasks = selectRuntime(mapped(evidence.tasks, 'task', (item, text, id) => ({ ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || text.slice(0, 100)), description: safeText(item.description || item.summary || text), status: safeText(item.status || 'active') })), 8);
        const eventEvidence = evidence.events.length ? evidence.events : [...evidence.timeline, ...evidence.chronology].slice(-12);
        const mappedEvents = mapped(eventEvidence, 'event', (item, text, id) => ({ ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || item.event || item.summary || text.slice(0, 100)), summary: safeText(item.summary || item.event || item.description || text), status: safeText(item.status || 'occurred') }));
        const eventsByTitle = new Map();
        mappedEvents.forEach((item) => eventsByTitle.set(safeText(item.title || item.summary).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase(), item));
        state.events = selectRuntime([...eventsByTitle.values()], 8);
        state.triggers = selectRuntime(mapped(evidence.triggers, 'trigger', (item, text, id) => ({
            ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || text.slice(0, 100)),
            conditions: Array.isArray(item.conditions) ? item.conditions.map(safeText).filter(Boolean) : [], status: safeText(item.status || 'armed'),
            effectsIfTriggered: Array.isArray(item.effectsIfTriggered || item.effects) ? (item.effectsIfTriggered || item.effects).map(safeText).filter(Boolean) : [],
            blockedReasons: Array.isArray(item.blockedReasons) ? item.blockedReasons.map(safeText).filter(Boolean) : [],
            userVisible: item.userVisible !== false, userRelevance: safeText(item.userRelevance),
        })), 6);
        const threadEvidence = evidence.threads.length ? evidence.threads : evidence.progression.map((item) => {
            const value = objectItem(item);
            const text = evidenceItemText(item);
            return {
                ...value,
                title: safeText(value.title || value.direction || value.progression || text).split(/[。；;]/)[0].slice(0, 80),
                stakes: safeText(value.stakes || value.currentMovement || value.summary || text),
                status: safeText(value.status || 'open'),
                sourceRefs: Array.isArray(value.sourceRefs) ? value.sourceRefs : [],
                truthStatus: value.truthStatus || (typeof item === 'string' ? 'derived' : undefined),
                basis: value.basis || ['由已读取的持续剧情推进线建立长期线程'],
            };
        }).filter((item) => item.title && item.stakes);
        state.threads = selectRuntime(mapped(threadEvidence, 'thread', (item, text, id) => ({
            ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || text.slice(0, 100)), status: safeText(item.status || 'open'),
            stakes: safeText(item.stakes || item.summary || text), participantIds: Array.isArray(item.participantIds || item.participants) ? (item.participantIds || item.participants).map(safeText).filter(Boolean) : [],
            nextNaturalStep: safeText(item.nextNaturalStep), history: Array.isArray(item.history) ? item.history.map(safeText).filter(Boolean) : [],
        })), 8);
        const processEvidence = evidence.processes.length ? evidence.processes : evidence.progression.filter((item) => GPT_WORLD_PROCESS_PATTERN.test(evidenceItemText(item))).map((item) => {
            const value = item && typeof item === 'object' && !Array.isArray(item) ? item : { direction: safeText(item) };
            return {
                ...value,
                title: safeText(value.title || value.progression || value.direction || value.currentMovement || '当前世界进程'),
                currentDirection: safeText(value.currentDirection || value.progression || value.currentMovement || value.direction || value.summary),
                status: safeText(value.status || 'active'),
                kind: safeText(value.kind || 'story'),
            };
        });
        const labeledProcessField = (text, field) => safeText(text.match(new RegExp(`(?:^|[；;])\\s*${field}[：:]\\s*([^；;]+)`, 'i'))?.[1]);
        const mappedProcesses = mapped(processEvidence, 'process', (item, text, id) => {
            const rawProgression = safeText(item.progression || item.currentDirection || item.direction || item.summary || text);
            const progressionText = safeText(labeledProcessField(rawProgression, 'progression') || labeledProcessField(text, 'progression') || rawProgression);
            const shortTitle = progressionText.split(/[，,。；;]/)[0].slice(0, 48);
            const parsedRefs = labeledProcessField(text, 'sourceRefs').split(/[、,，\s]+/).filter(Boolean);
            const rawTitle = safeText(item.title || item.name);
            const normalizedTitle = /^(?:progression|进程)[：:]/i.test(rawTitle) ? shortTitle : rawTitle;
            return ({
            ...item, id: safeText(item.id || id), title: safeText(normalizedTitle || shortTitle || '当前世界进程'), status: safeText(item.status || 'active'),
            kind: safeText(item.kind || 'other'), drivers: Array.isArray(item.drivers) ? item.drivers.map(safeText).filter(Boolean) : [],
            currentDirection: progressionText,
            decayConditions: Array.isArray(item.decayConditions) ? item.decayConditions.map(safeText).filter(Boolean) : [],
            resolutionConditions: Array.isArray(item.resolutionConditions) ? item.resolutionConditions.map(safeText).filter(Boolean) : [],
            truthStatus: safeText(item.truthStatus || labeledProcessField(text, 'truthStatus')) || undefined,
            basis: Array.isArray(item.basis) ? item.basis : (labeledProcessField(text, 'basis') ? [labeledProcessField(text, 'basis')] : []),
            sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : parsedRefs,
        }); });
        const processesByDirection = new Map();
        mappedProcesses.forEach((item) => processesByDirection.set(safeText(item.currentDirection || item.title).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase(), item));
        state.processes = selectRuntime([...processesByDirection.values()], 8);
        const derivedCausalEvidence = evidence.causal.length ? evidence.causal : state.processes.map((process) => ({
            cause: safeText((process.drivers || [])[0] || process.title),
            result: safeText(process.currentDirection),
            status: safeText(process.status || 'developing'),
            sourceRefs: process.sourceRefs || [],
            truthStatus: process.truthStatus || 'derived',
            basis: process.basis?.length ? process.basis : ['由已读取的持续世界进程建立因果影响'],
        })).filter((item) => item.cause && item.result);
        state.causalEffects = selectRuntime(mapped(derivedCausalEvidence, 'causal', (item, text, id) => {
            const causalMatch = text.match(/^因为(.+?)[，,；;](?:所以|因此|导致|使得?|从而)(.+)$/);
            const cause = safeText(item.cause || causalMatch?.[1] || text);
            const result = safeText(item.result || item.effect || causalMatch?.[2] || text);
            return { ...item, id: safeText(item.id || id), cause, result, status: safeText(item.status || 'developing'), steps: Array.isArray(item.steps) ? item.steps : [], affectedIds: Array.isArray(item.affectedIds) ? item.affectedIds : [], evidenceRefs: Array.isArray(item.evidenceRefs || item.sourceRefs) ? (item.evidenceRefs || item.sourceRefs) : [] };
        }), 10);
        const latestProgressionRaw = evidence.progression.at(-1);
        const latestProgression = objectItem(latestProgressionRaw);
        const latestProgressionText = evidenceItemText(latestProgressionRaw);
        const progressionWasObject = latestProgressionRaw && typeof latestProgressionRaw === 'object' && !Array.isArray(latestProgressionRaw);
        if (latestProgressionText) state.progression = {
            ...state.progression,
            priority: 'L2',
            activity: safeText(latestProgression.activity).toUpperCase() === 'COLD' ? 'COLD' : 'WARM',
            direction: safeText(latestProgression.direction || latestProgression.title || latestProgressionText),
            currentMovement: safeText(latestProgression.currentMovement || latestProgression.stage || latestProgression.summary || (progressionWasObject ? '' : latestProgressionText)),
            nextRequiredChanges: Array.isArray(latestProgression.nextRequiredChanges) ? latestProgression.nextRequiredChanges.filter(Boolean).map(safeText) : [],
            basedOnRefs: Array.isArray(latestProgression.basedOnRefs || latestProgression.sourceRefs) ? (latestProgression.basedOnRefs || latestProgression.sourceRefs).filter(Boolean).map(safeText) : [],
            blockedByDecision: safeText(latestProgression.blockedByDecision),
        };
        state.timeline = mapped([...evidence.timeline, ...evidence.chronology].slice(-40), 'timeline', (item, text, id) => ({
            ...item, id: safeText(item.id || id), summary: safeText(item.summary || item.description || text),
            granularity: safeText(item.granularity || 'phase'), participants: Array.isArray(item.participants) ? item.participants.map(safeText).filter(Boolean) : [],
            location: safeText(item.location), evidence: Array.isArray(item.evidence || item.sourceRefs) ? (item.evidence || item.sourceRefs).map(safeText).filter(Boolean) : [],
        })).filter((item) => item.summary).slice(-24);
        state.moduleCoverage = Object.fromEntries(evidence.moduleCoverage.map((item) => {
            const value = objectItem(item);
            const module = safeText(value.module || value.name);
            const status = safeText(value.status).toLowerCase();
            return module ? [module, {
                status: ['empty_confirmed','unknown','retrieval_failed','not_applicable','has_records'].includes(status) ? status : 'unknown',
                basis: safeText(value.basis || value.reason) || '读取器已检查该模块但未给出可验证依据', checkedRevision: Number(state.revision || 0),
            }] : null;
        }).filter(Boolean));
        state.reasoningAudit = {
            matchedRules: evidence.matchedRules.map((item) => safeText(objectItem(item).id || objectItem(item).ruleId || item)).filter(Boolean),
            derivedFacts: evidence.derivedFacts,
            conflicts: evidence.conflicts,
            staleStates: evidence.staleStates,
            actorFeasibility: evidence.actorFeasibility,
            causalCandidates: evidence.causalCandidates,
            moduleDecisions: evidence.moduleDecisions.map((item) => ({ ...objectItem(item), module: safeText(objectItem(item).module), operation: safeText(objectItem(item).operation || 'KEEP').toUpperCase(), reason: safeText(objectItem(item).reason || objectItem(item).basis) })).filter((item) => item.module),
        };
        return { state, plan: {}, moduleInjections: {}, evidence };
    }
    async function buildStateWithinLimit(plannerPrompt, payload, _baseState, settings, signal, prepared) {
        if (prepared?.calibration) {
            const hydrated = stateFromEvidence(supplementMissingEvidenceFromArchive(prepared.evidence || {}), {}, _baseState);
            hydrated.state = applyHistoryLedger(hydrated.state, prepared.allChanges || prepared.ledger || []);
            hydrated.calibration = { audit: prepared.audit, boundary: prepared.boundary, fingerprint: prepared.fingerprint };
            return hydrated;
        }
        if (!prepared?.large) {
            // Small sources used to ask the model for a complete state object in
            // one shot. That made collection shapes unstable and allowed entire
            // modules to disappear. Read the same unified evidence contract as
            // the large-source path, then hydrate every state module locally.
            const completeRecords = completeSourceRecords(prepared.source || payload?.source || {});
            const deduplicated = removeMirroredChatRecords(prepared.source || payload?.source || {}, completeRecords);
            const direct = await WSM.Api.complete(
                prepared.gptMode === true
                    ? `${IDENTITY_READ_RULE}\n\n${GPT_SOURCE_READ_PROMPT}\n\n${GPT_SOURCE_READ_EXTENSION}`
                    : `${IDENTITY_READ_RULE}\n\n${SOURCE_READ_PROMPT}\n\n${SOURCE_READ_MODULE_EXTENSION}\n\n${TRUTH_POLICY_PROMPT}`,
                {
                    task: 'SOURCE_READ_COMPLETE',
                    sourceRecords: deduplicated.records,
                    identities: payload?.source?.identities || payload?.currentState?.identities || {},
                    sourceRecordCount: deduplicated.records.length,
                },
                {
                    maxTokens: 9000,
                    singleAttempt: true, signal, jsonContract: 'evidence',
                    reasoningEffort: settings.gptMode === true && /gpt/i.test(String(settings.model || '')) ? 'low' : undefined,
                    stream: settings.gptMode === true,
                },
            );
            prepared.requestAttempts = 1;
            prepared.cacheHits = 0;
            prepared.sentRecords = deduplicated.records.length;
            prepared.deduplicatedRecords = completeRecords.length - deduplicated.records.length;
            const evidence = direct?.evidence ?? direct?.digest ?? direct;
            if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('一次完整读取响应缺少 evidence');
            validateEvidenceContract(evidence, '一次完整读取响应');
            const completedEvidence = supplementMissingEvidenceFromArchive(mergeCompleteEvidence(prepared.localEvidence, evidence));
            const finalEvidence = sanitizeGptEvidence(completedEvidence, prepared);
            return applyGptSceneToState(stateFromEvidence(finalEvidence, {}, _baseState), prepared);
        }
        throwIfCancelled(signal);
        const batches = prepared.batches || prepared.halves || [];
        if (!batches.length) throw new Error('没有可读取的资料批次');
        const fragments = prepared.progressFragments || batches.map((batch) => Math.max(1, Math.ceil(JSON.stringify(batch).length / SOURCE_PROGRESS_FRAGMENT_CHARS)));
        const totalFragments = fragments.reduce((sum, value) => sum + value, 0);
        const cacheKey = firstHalfCacheKey(prepared, settings);
        const cachedCheckpoint = readFirstHalfCache(cacheKey);
        let completedBatches = Math.max(0, Math.min(batches.length, Number(cachedCheckpoint?.__completedBatches || 0)));
        let mergedEvidence = cachedCheckpoint && typeof cachedCheckpoint === 'object'
            ? mergeCompleteEvidence(cachedCheckpoint)
            : mergeCompleteEvidence();
        prepared.requestAttempts = 0;
        prepared.requestDurationsMs = [];
        prepared.cacheHits = completedBatches;
        if (completedBatches) {
            const cachedFragments = fragments.slice(0, completedBatches).reduce((sum, value) => sum + value, 0);
            reportProgress('正在顺序读取全部资料', 'running', `已从断点恢复 ${completedBatches}/${batches.length} 批 · 原文分片 ${cachedFragments}/${totalFragments} · 尚未新增请求`);
        }
        for (let index = completedBatches; index < batches.length; index += 1) {
            throwIfCancelled(signal);
            const fragmentStart = fragments.slice(0, index).reduce((sum, value) => sum + value, 0) + 1;
            const fragmentEnd = fragments.slice(0, index + 1).reduce((sum, value) => sum + value, 0);
            const batchChars = prepared.batchChars?.[index] || prepared.halfChars?.[index] || JSON.stringify(batches[index]).length;
            reportProgress('正在顺序读取全部资料', 'running', `批次 ${index + 1}/${batches.length} · 原文分片 ${fragmentStart}–${fragmentEnd}/${totalFragments} · API ${prepared.requestAttempts + 1} 次 · ${batches[index].length} 项 ${batchChars} 字`);
            const startedAt = Date.now();
            const gptFinalMerge = prepared.gptMode === true && index > 0 && index === batches.length - 1;
            const result = await WSM.Api.complete(
                prepared.gptMode === true
                    ? `${IDENTITY_READ_RULE}\n\n${GPT_SOURCE_READ_PROMPT}\n\n${GPT_SOURCE_READ_EXTENSION}`
                    : `${IDENTITY_READ_RULE}\n\n${gptFinalMerge ? FINAL_EVIDENCE_PROMPT : SOURCE_READ_PROMPT}\n\n${SOURCE_READ_MODULE_EXTENSION}\n\n${TRUTH_POLICY_PROMPT}`,
                {
                    task: 'SOURCE_READ_SEQUENTIAL_BATCH',
                    sourceBatchIndex: index + 1,
                    sourceBatchCount: batches.length,
                    sourceRecords: batches[index],
                    ...(gptFinalMerge ? { firstHalfEvidence: mergedEvidence } : {}),
                    completeCoverage: {
                        originalChars: prepared.originalChars, includedChars: prepared.includedChars,
                        records: prepared.records, sentRecords: prepared.sentRecords || prepared.records,
                        mirroredChatRecordsReused: prepared.deduplicatedRefs || [],
                    },
                },
                {
                    maxTokens: 9000,
                    singleAttempt: true, signal, jsonContract: 'evidence',
                    reasoningEffort: settings.gptMode === true && /gpt/i.test(String(settings.model || '')) ? 'low' : undefined,
                    stream: settings.gptMode === true,
                },
            );
            const durationMs = Date.now() - startedAt;
            prepared.requestDurationsMs.push(durationMs);
            prepared.requestAttempts += 1;
            const evidence = result?.evidence ?? result?.digest ?? result;
            if (!evidence || typeof evidence !== 'object') {
                throw new Error(`第 ${index + 1}/${batches.length} 批读取响应缺少 evidence；已保存前 ${index}/${batches.length} 批断点`);
            }
            validateEvidenceContract(evidence, `第 ${index + 1}/${batches.length} 批读取响应`);
            // GPT request B owns the final current snapshot and may deliberately
            // empty stale arrays from request A. Gemini/default keeps its
            // historical union behavior unchanged.
            if (gptFinalMerge) {
                const finalSnapshot = mergeCompleteEvidence(evidence);
                const stableUnion = mergeCompleteEvidence(mergedEvidence, evidence);
                ['canon','worldRules','anchors','characters','relationships','knowledge','locations','events','timeline','chronology','causal'].forEach((key) => {
                    finalSnapshot[key] = stableUnion[key];
                });
                mergedEvidence = finalSnapshot;
            } else mergedEvidence = mergeCompleteEvidence(mergedEvidence, evidence);
            completedBatches = index + 1;
            await writeFirstHalfCache(cacheKey, { ...mergedEvidence, __completedBatches: completedBatches });
            reportProgress('本批读取完成并保存断点', 'running', `已完成 ${completedBatches}/${batches.length} 批 · 本批 ${(durationMs / 1000).toFixed(1)} 秒 · 累计 API ${prepared.requestAttempts} 次 · 缓存复用 ${prepared.cacheHits} 批`);
        }
        reportProgress('全部资料批次读取完成', 'running', `运行资料 ${prepared.sentRecords || prepared.records} 项已覆盖 · 严格串行 ${batches.length} 批 · 本次 API ${prepared.requestAttempts} 次 · 缓存复用 ${prepared.cacheHits} 批`);
        const completedEvidence = supplementMissingEvidenceFromArchive(mergeCompleteEvidence(prepared.localEvidence, mergedEvidence));
        const finalEvidence = sanitizeGptEvidence(completedEvidence, prepared);
        return applyGptSceneToState(stateFromEvidence(finalEvidence, {}, _baseState), prepared);
    }
    function updateNpcClock(previous, next, plan, initialize = false) {
        const clock = Object.assign({}, previous.runtime?.npcLastUpdatedElapsedMinutes || {});
        const elapsed = Number(next.world?.time?.elapsedMinutes || 0);
        if (initialize) normalizeStateCollection(next.characters, 'characters').forEach((item) => { if (item?.id) clock[item.id] = elapsed; });
        normalizeStateCollection(plan?.npcUpdates, 'npcActivities').forEach((item) => {
            if (item?.characterId && item.mode !== 'carry') clock[item.characterId] = elapsed;
        });
        return clock;
    }
    const INITIALIZE_SLICES = [
        { id: 'foundation', label: '世界、硬规则、资源与地图', keys: ['identities','world','worldRules','factAnchors','resourceConstraints','map','timeline'], maxTokens: 6500 },
        { id: 'people', label: '人物与知识', keys: ['characters','npcActivities','relationships','knowledge'], maxTokens: 6500 },
        { id: 'affairs', label: '任务与事件', keys: ['tasks','events','triggers','threads'], maxTokens: 4500 },
        { id: 'dynamics', label: '进程与因果', keys: ['processes','causalEffects'], maxTokens: 4000 },
    ];
    function stateReference(state) {
        return {
            identities: state.identities,
            world: state.world,
            worldRules: (state.worldRules || []).map((item) => ({ id: item.id, factId: item.factId, statement: item.statement })),
            characters: (state.characters || []).map((item) => ({ id: item.id, name: item.name })),
            tasks: (state.tasks || []).map((item) => ({ id: item.id, title: item.title })),
            events: (state.events || []).map((item) => ({ id: item.id, title: item.title })),
        };
    }
    const SLICE_EVIDENCE_FIELDS = {
        foundation: ['sourceRefs','canon','chronology','locations','resourceConstraints','currentScene','uncertainties'],
        people: ['sourceRefs','characters','relationships','knowledge','currentScene','uncertainties'],
        affairs: ['sourceRefs','chronology','timeline','tasks','events','triggers','threads','currentScene'],
        dynamics: ['sourceRefs','chronology','events','processes','causal','uncertainties'],
    };
    function sourceForInitializeSlice(source, sliceId) {
        const fields = new Set(SLICE_EVIDENCE_FIELDS[sliceId] || []);
        const digestBatch = Array.isArray(source?.sourceDigest) ? source.sourceDigest : [];
        const sourceDigest = digestBatch.map((digest) => Object.fromEntries(
            Object.entries(digest || {}).filter(([key, value]) => fields.has(key) && (!Array.isArray(value) || value.length)),
        )).filter((digest) => Object.keys(digest).length);
        return {
            identities: source?.identities,
            character: source?.character,
            persona: source?.persona,
            sourceDigest,
            compiledWorldbookRules: source?.compiledWorldbookRules,
            tavernTextContext: source?.tavernTextContext,
            sourceRead: source?.sourceRead,
        };
    }
    async function initializeInSlices(source, payload, settings, signal) {
        const state = WSM.Defaults.createState();
        const queue = INITIALIZE_SLICES.map((slice) => ({ ...slice }));
        for (let index = 0; index < queue.length;) {
            throwIfCancelled(signal);
            const slice = queue[index];
            reportProgress(`正在分批建立初始状态：${slice.label}`, 'running', `${index + 1}/${queue.length} · 避免单个超大 INITIALIZE_WORLD 请求`);
            const schema = Object.fromEntries(slice.keys.map((key) => [key, WSM.Defaults.STATE_SCHEMA[key]]));
            const ownership = Object.fromEntries(slice.keys.map((key) => [key, WSM.Defaults.MODULE_OWNERSHIP[key]]).filter(([, value]) => value));
            const prompts = Object.fromEntries(slice.keys.map((key) => [key, settings.modulePrompts?.[key] || WSM.Defaults.MODULE_PROMPTS[key]]).filter(([, value]) => value));
            try {
                const result = await WSM.Api.complete(
                    `你是世界状态初始化器，本次只建立“${slice.label}”切片。source 已由前序分片模型完整读取，但只把当前运行需要的内容写入状态，原始资料仍是权威库。先跨模块去重，再按重要性与当前相关度筛选；L1临时细节优先省略，COLD核心信息保存但不扩写。集合模块允许为空，禁止凑数；一旦创建卡片就必须有最小有效字段，人物关系必须有from、to、status，人物必须有name，NPC活动必须有characterId和action，事件必须有title及summary/outcome，其余必须有标题或事实正文。缺失的持久条目先定点补查；仍不能确定时按模块权限标为unknown/not_established，不得用空白或自由生成冒充事实。单模块通常最多8张卡，单卡数组最多4项。只能记录来源中已经存在或正文已经发生的事实，不得续写、推测成真或创造设定。严格遵守 ownership，只返回 JSON：{"state":{本切片字段}}；不得返回其他状态字段、plan、Markdown 或解释。\n\n${TRUTH_POLICY_PROMPT}`,
                    {
                        task: 'INITIALIZE_WORLD_SLICE', slice: slice.id, sliceIndex: index + 1, sliceCount: queue.length,
                        source: sourceForInitializeSlice(source, slice.id.split(':')[0]), stateReference: stateReference(state), stateSchema: schema, moduleOwnership: ownership, modulePrompts: prompts,
                    },
                    { maxTokens: Math.max(1800, Math.min(slice.maxTokens, 1800 + slice.keys.length * 1100)), signal },
                );
                const partial = result?.state ?? result;
                if (!partial || typeof partial !== 'object') throw new Error(`初始化切片 ${slice.label} 响应缺少 state`);
                slice.keys.forEach((key) => { if (Object.prototype.hasOwnProperty.call(partial, key)) state[key] = partial[key]; });
                index += 1;
            } catch (error) {
                if (signal?.aborted) throw cancellationError();
                if (slice.keys.length <= 1) throw error;
                const middle = Math.ceil(slice.keys.length / 2);
                const children = [slice.keys.slice(0, middle), slice.keys.slice(middle)].map((keys, childIndex) => ({
                    ...slice, id: `${slice.id}:${childIndex + 1}`, label: `${slice.label}（${keys.join('、')}）`, keys,
                }));
                queue.splice(index, 1, ...children);
                reportProgress('状态切片请求失败，正在继续细分', 'running', `${slice.label} → ${children.map((child) => child.keys.join('、')).join(' / ')}`);
            }
        }
        state.initialized = true;
        return {
            state,
            plan: { notes: ['初始状态已按世界、人物、事务与因果切片建立；本轮只建立事实，不预演新剧情。'] },
            moduleInjections: {},
        };
    }
    async function setPrompt(content) {
        const ctx = WSM.Context.context();
        const setter = typeof ctx?.setExtensionPrompt === 'function' ? ctx.setExtensionPrompt.bind(ctx) : (typeof window.setExtensionPrompt === 'function' ? window.setExtensionPrompt.bind(window) : null);
        if (!setter) return;
        await setter(PROMPT_ID, '', 1, 0, false, 0);
        for (let depth = 0; depth <= 4; depth += 1) await setter(DEPTH_PROMPT_IDS[depth], typeof content === 'object' ? (content[depth] || '') : '', 1, depth, false, 0);
    }
    async function setStatePrompts(state, plan = {}, moduleInjections = {}) {
        return setPrompt(WSM.Injection.composeByDepth(syncIdentities(state), plan, moduleInjections));
    }
    async function syncRegisteredPrompt() {
        const settings = WSM.Settings.get();
        if (!settings.enabled) return setPrompt('');
        const loaded = WSM.Storage.load();
        const oldUserName = safeText(loaded?.identities?.user);
        let state = syncIdentities(loaded);
        if (oldUserName !== state.identities.user) state = await WSM.Storage.save(state, 'identity-sync', { snapshot: false });
        const hasUsableState = state.initialized || !!safeText(state.planner?.injection);
        if (!hasUsableState) return setPrompt('');
        state.planner.injection = WSM.Injection.compose(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
        return setStatePrompts(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
    }
    async function clearRegisteredPrompts() {
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.removeItem(FIRST_HALF_CACHE_KEY);
                localStorage.removeItem('wsm_two_pass_first_half_cache_v7');
                localStorage.removeItem('wsm_two_pass_first_half_cache_v6');
                localStorage.removeItem('wsm_two_pass_first_half_cache_v5');
                localStorage.removeItem('wsm_two_pass_first_half_cache_v4');
                localStorage.removeItem('wsm_two_pass_first_half_cache_v3');
            }
            catch (error) { console.debug('[WorldStateMachine] 无法清除本地读取缓存', error); }
        }
        await setPrompt('');
    }
    async function plan(options = {}) {
        const signal = options.signal;
        throwIfCancelled(signal);
        const settings = WSM.Settings.get();
        if (!settings.enabled) {
            await setPrompt('');
            if (options.initialize === true || options.readFullChat === true) {
                reportProgress('读取当前聊天失败', 'error', '已在设置中关闭“启用自动状态机”');
            }
            return null;
        }
        if ((options.initialize === true || options.readFullChat === true) && !activeChatAvailable()) {
            const error = '当前是酒馆欢迎页，尚未打开角色聊天存档；请先从侧边栏打开具体存档再读取';
            reportProgress('读取当前聊天失败', 'error', error);
            return { error };
        }
        const key = turnKey();
        let current = syncIdentities(WSM.Storage.load());
        // Initialization is a user-triggered operation. Generation hooks may
        // update an existing state, but must never read and initialize a new
        // chat implicitly.
        if (!current.initialized && options.initialize !== true) {
            await setPrompt('');
            return null;
        }
        if (!current.runtime?.needsWorldRefresh && !options.force && key && current.planner?.turnKey === key && current.planner?.injection && !current.planner?.error) {
            current.planner.injection = WSM.Injection.compose(current, current.planner.plan || {}, current.planner.moduleInjections || {});
            await setStatePrompts(current, current.planner.plan || {}, current.planner.moduleInjections || {});
            return current.planner;
        }
        const explicitRead = options.initialize === true || options.readFullChat === true;
        const readStartedAt = explicitRead ? Date.now() : 0;
        // Ordinary generations spend no API call before the main text request.
        // They inject the latest settled state locally; the single permitted
        // background call is reserved for the post-generation reconciliation.
        // A pending world refresh therefore waits for the user's explicit read
        // button instead of silently starting a multi-call rebuild here.
        if (!explicitRead) {
            const diceRound = settings.diceEnabled ? WSM.Dice?.createRound?.(key) : null;
            const recallQuery = [
                WSM.Context.latestUserMessage()?.content,
                current.world?.location?.current,
                ...(current.characters || []).filter((item) => item.present).map((item) => item.name),
            ].filter(Boolean).join('\n');
            const historyRecall = WSM.Storage.retrieveHistory?.(recallQuery, { maxChars: 800, evidenceCount: 2, state: current }) || { text: '' };
            const localPlan = {
                ...(diceRound ? { diceRound } : {}),
                ...(historyRecall.text ? { historyRecall: historyRecall.text } : {}),
                notes: ['省额度模式：生成前使用最近一次已结算状态；正文完成后以一次 API 检查全部栏目，但只返回并写入发生实质变化的增量。'],
            };
            current.planner = {
                lastRunAt: Date.now(), turnKey: key, plan: localPlan,
                moduleInjections: {}, injection: '', error: '', localOnly: true,
            };
            current.planner.injection = WSM.Injection.compose(current, localPlan, {});
            current = await WSM.Storage.save(current, 'local-pre-generation', {
                snapshot: true, snapshotKind: 'generation',
            });
            await setStatePrompts(current, localPlan, {});
            return current.planner;
        }
        if (!plannerAvailable(settings)) {
            if (options.initialize === true || options.readFullChat === true) {
                const error = settings.useTavernApi !== false ? '酒馆默认 API 当前不可用' : '尚未配置 Planner API';
                reportProgress('读取当前聊天失败', 'error', error);
                return { error };
            }
            const diceRound = settings.diceEnabled ? WSM.Dice?.createRound?.(key) : null;
            const localPlan = diceRound ? { diceRound } : {};
            const injection = WSM.Injection.compose(current, localPlan, {});
            const error = settings.useTavernApi !== false ? '酒馆默认 API 当前不可用' : '尚未配置 Planner API';
            current.planner = { lastRunAt: Date.now(), turnKey: key, plan: localPlan, moduleInjections: {}, injection, error };
            if (diceRound) current = await WSM.Storage.save(current, 'local-dice', { snapshot: false });
            await setStatePrompts(current, localPlan, {});
            return current.planner;
        }

        const rebuilding = options.initialize === true;
        // A rebuild starts from a clean state, but the old persisted state is
        // retained until the replacement succeeds. Cancellation/failure is safe.
        const rebuildBase = rebuilding ? syncIdentities(WSM.Defaults.createState()) : current;
        rebuildBase.runtime ||= {};
        rebuildBase.runtime.storageChatKey = current.runtime?.storageChatKey || '';
        // “读取当前聊天” is an explicit user request to re-read the chat, not
        // the lightweight per-turn planner refresh.  The latter intentionally
        // reads only recentMessages, which made a long existing chat appear to
        // be analysed while most of its history never reached SourceReader.
        const fullChatRefresh = options.readFullChat === true && current.initialized;
        const refreshWorld = !rebuilding && current.initialized && (current.runtime?.needsWorldRefresh === true || fullChatRefresh);
        const initializing = !current.initialized || rebuilding;
        if (initializing || refreshWorld) reportProgress('第 1/3 步：正在读取酒馆资料', 'running', '角色卡、Persona、已启用世界书和聊天正文');
        const source = await WSM.Context.buildSource({
            fullChat: initializing || refreshWorld || options.initialize,
            preserveFull: initializing || refreshWorld,
            includeHidden: initializing || refreshWorld,
        });
        throwIfCancelled(signal);
        // Preserve a local snapshot before adding compiled projections.
        // Worldbook originals remain intact; large-source detection must still
        // use the true source size rather than only the short routed projection.
        const completeSourceSnapshot = initializing || refreshWorld ? JSON.parse(JSON.stringify(source)) : null;
        if (initializing || refreshWorld) {
            const preview = summarizeSource(source);
            reportProgress('第 2/3 步：本地资料收集完成，正在整理世界书', 'running', `模型尚未开始读取 · 正文 ${preview.chatMessages}/${preview.chatTotalMessages} 条 · 世界书 ${preview.loadedWorldbooks.length} 本 · 读取失败 ${preview.failedWorldbooks.length} 本`);
        }
        const fingerprint = WSM.Context.sourceFingerprint(source);
        let compilerResult;
        try {
            // Reading/rebuilding owns an explicit bounded-block budget.
            // Worldbook routing remains local here; the calibration reader sees
            // the source records in the same resumable block stream.
            compilerResult = await WSM.WorldbookCompiler?.processSource?.(source, { localOnly: true, signal });
            throwIfCancelled(signal);
        } catch (error) {
            if (signal?.aborted) {
                reportProgress('读取已终止', 'cancelled', '旧状态未被修改；可以随时重新开始读取。');
                const activeState = WSM.Storage.load();
                await setStatePrompts(activeState, activeState.planner?.plan || {}, activeState.planner?.moduleInjections || {});
                return { cancelled: true };
            }
            throw error;
        }
        const sourceSummary = Object.assign(summarizeSource(source), {
            worldbookCompiler: compilerResult?.enabled ? {
                selectedEntries: Number(compilerResult.selected || 0),
                routedChars: String(compilerResult.routed || '').length,
            } : null,
        });
        const phase = initializing ? 'INITIALIZE_WORLD' : (fullChatRefresh ? 'REFRESH_FULL_CHAT' : (refreshWorld ? 'REFRESH_WORLD' : 'PRE_GENERATION_PLAN'));
        const diceRound = settings.diceEnabled ? WSM.Dice?.createRound?.(key) : null;
        const payload = {
            phase,
            instructions: initializing
                ? '完整理解角色卡、Persona、聊天与已启用世界书，建立初始持久世界状态；除user和char外，提取3至12名最相关的既存NPC。'
                : fullChatRefresh
                    ? '这是用户主动执行的完整聊天刷新。必须综合 sourceDigest 的全部分片证据、角色卡、Persona、世界书和当前已结算状态，更新所有受聊天事实影响的状态字段；不得只看末尾正文，也不得只补 NPC。保留仍成立的既有事实，冲突或不确定信息必须标明来源和不确定性，禁止续写。'
                : refreshWorld
                    ? '保留已经成立的事实，重新阅读完整角色卡与世界书，补齐其中有姓名、身份或长期关系的3至12名相关NPC；不要把无关路人塞入世界，也不要重演历史。'
                    : '推进用户本轮行为后的世界后台，规划但不要假定正文将发生的事情。',
            source,
            currentState: plannerState(rebuildBase),
            stateSchema: WSM.Defaults.STATE_SCHEMA,
            moduleOwnership: WSM.Defaults.MODULE_OWNERSHIP,
            modulePrompts: settings.modulePrompts || WSM.Defaults.MODULE_PROMPTS,
            simulationClock: rebuilding ? { elapsedMinutes: 0, display: '' } : { elapsedMinutes: Number(current.world?.time?.elapsedMinutes || 0), display: current.world?.time?.display || '' },
            npcSchedule: rebuilding ? [] : buildNpcSchedule(current),
            simulationRules: {
                offscreenUpdateIntervalMinutes: 60,
                updateVisibleCharactersEveryTick: true,
                carryOffscreenCharactersBetweenDueTicks: true,
                requirePreexistingCauseForRipple: true,
                allowNoSignificantChange: true,
            },
            lockedPaths: rebuilding ? [] : (current.lockedPaths || []),
        };
        if (diceRound) payload.diceRound = diceRound;
        const plannerPrompt = `${settings.plannerPrompt}${diceRound ? WSM.Dice.plannerInstructions(diceRound) : ''}`;
        try {
            if (compilerResult?.blocked) throw new Error(compilerResult.error || '世界书拆解阻止了 Planner 请求');
            let prepared = null;
            if (initializing || refreshWorld) {
                if (source.compiledWorldbookRules !== undefined) completeSourceSnapshot.compiledWorldbookRules = source.compiledWorldbookRules;
                // A manual read has a hard ceiling of two billable calls. Every
                // raw source is scanned locally first; oversized chats become a
                // deterministic all-message semantic chronicle, then A reads the
                // first half and B reads the second half plus A's evidence.
                prepared = prepareSourceForStateRequests(completeSourceSnapshot, { payload, plannerPrompt, gptMode: settings.gptMode === true });
                payload.source = prepared.source;
                sourceSummary.sourceRead = {
                    mode: prepared.large ? 'sequential-batch-local-chronicle' : 'single-pass-complete-source',
                    chunked: prepared.large === true,
                    apiLimit: prepared.large ? (prepared.batches || prepared.halves || []).length : 1,
                    semanticCompaction: prepared.semanticCompaction === true,
                    requestAttempts: prepared.requestAttempts, cacheHits: prepared.cacheHits,
                    originalChars: prepared.originalChars, includedChars: prepared.includedChars,
                    coveredChatMessages: Number(prepared.coveredChatMessages || sourceSummary.chatMessages || 0),
                    compactedChatMessages: Number(prepared.compactedChatMessages || 0),
                    originalChatChars: Number(prepared.originalChatChars || 0),
                    includedChatChars: Number(prepared.includedChatChars || 0),
                    records: prepared.records,
                };
            }
            if (initializing || refreshWorld) reportProgress('本地全量扫描完成，正在建立基准快照', 'running', prepared?.large
                ? `全部 ${prepared.coveredChatMessages || sourceSummary.chatMessages} 条正文及世界书已本地覆盖 · ${settings.gptMode === true ? 'GPT 两次内压缩模式' : '默认两批模式'} · 最多 2 次串行 API 读取`
                : `完整资料 ${prepared.originalChars} 字 · 固定 API 1 次`);
            const result = await buildStateWithinLimit(plannerPrompt, payload, rebuildBase, settings, signal, prepared);
            throwIfCancelled(signal);
            if (sourceSummary.sourceRead && prepared) {
                sourceSummary.sourceRead.requestAttempts = Number(prepared.requestAttempts || 0);
                sourceSummary.sourceRead.cacheHits = Number(prepared.cacheHits || 0);
                sourceSummary.sourceRead.progressFragments = prepared.progressFragments || [1];
                sourceSummary.sourceRead.requestDurationsMs = prepared.requestDurationsMs || [];
                sourceSummary.sourceRead.durationMs = Math.max(0, Date.now() - readStartedAt);
            }
            if (!result?.state || typeof result.state !== 'object') throw new Error('Planner 响应缺少 state');
            let next = WSM.Storage.enforceLocks(rebuildBase, result.state);
            next = normalizeStateCollections(syncIdentities(next, source.identities));
            next = normalizeGptIdentityAliases(next, safeText(source?.character?.name));
            next = auditStateLifecycle(next, result?.reasoningAudit || {});
            next.initialized = true;
            next.runtime = Object.assign({}, rebuildBase.runtime, next.runtime, {
                lastUserMessageId: source.currentUserAction?.id || '',
                sourceFingerprint: fingerprint,
                sourceSummary,
                worldbookInjection: compilerResult?.report || rebuildBase.runtime?.worldbookInjection || null,
                npcLastUpdatedElapsedMinutes: updateNpcClock(rebuildBase, next, result.plan, initializing || refreshWorld),
                needsWorldRefresh: false,
            });
            const nextPlan = Object.assign({}, result.plan || {});
            if (diceRound) nextPlan.diceRound = diceRound;
            else delete nextPlan.diceRound;
            next.planner = {
                lastRunAt: Date.now(),
                turnKey: key,
                plan: nextPlan,
                moduleInjections: result.moduleInjections && typeof result.moduleInjections === 'object' ? result.moduleInjections : {},
                injection: '',
                error: '',
            };
            next.planner.injection = WSM.Injection.compose(next, next.planner.plan || {}, next.planner.moduleInjections);
            next = await WSM.Storage.save(next, initializing ? 'initialize' : (refreshWorld ? 'refresh-world' : 'planner'), {
                snapshot: !rebuilding && current.initialized && !refreshWorld,
                snapshotKind: 'generation',
                clearHistory: rebuilding,
            });
            if (initializing || refreshWorld) {
                const chatMessages = Array.isArray(completeSourceSnapshot?.chat) ? completeSourceSnapshot.chat : [];
                await WSM.Storage.setTwoPassHistoryBaseline?.(next, {
                    fingerprint,
                    boundary: chatMessages.length ? { messageId: safeText(chatMessages.at(-1)?.id), index: chatMessages.length - 1 } : null,
                    messages: chatMessages,
                    audit: {
                        totalReadableMessages: chatMessages.length,
                        processedMessages: chatMessages.length,
                        failedMessages: 0,
                        failedChunks: 0,
                        hiddenIncluded: chatMessages.filter((message) => message?.hidden === true).length,
                        chunks: prepared.large ? (prepared.batches || prepared.halves || []).length : 1,
                        referenceChunks: 0,
                        chatChunks: prepared.large ? (prepared.batches || prepared.halves || []).length : 1,
                        requestAttempts: Number(prepared.requestAttempts || 0),
                        cacheHits: Number(prepared.cacheHits || 0),
                        originalChars: Number(prepared.originalChars || 0),
                        includedChars: Number(prepared.includedChars || 0),
                        compactedMessages: Number(prepared.compactedChatMessages || 0),
                        requestDurationsMs: prepared.requestDurationsMs || [],
                        durationMs: Math.max(0, Date.now() - readStartedAt),
                    },
                });
            }
            await setStatePrompts(next, next.planner.plan || {}, next.planner.moduleInjections || {});
            if (initializing || refreshWorld) {
                const durationMs = Math.max(0, Date.now() - readStartedAt);
                reportProgress('读取完成，基准快照已建立', 'success', `正文 ${sourceSummary.chatMessages} 层 · 世界书 ${sourceSummary.loadedWorldbooks.length} 本 · 串行批次 ${(prepared.batches || prepared.halves || []).length || 1} · 本次 API ${prepared.requestAttempts || 0} 次 · 缓存 ${prepared.cacheHits || 0} 批 · 总用时 ${(durationMs / 1000).toFixed(1)} 秒 · 原文仍保留在酒馆`);
            }
            return next.planner;
        } catch (error) {
            if (signal?.aborted) {
                reportProgress('读取已终止', 'cancelled', '旧状态未被修改；可以随时重新开始读取。');
                const activeState = WSM.Storage.load();
                await setStatePrompts(activeState, activeState.planner?.plan || {}, activeState.planner?.moduleInjections || {});
                return { cancelled: true };
            }
            if (initializing || refreshWorld) {
                reportProgress('读取或初始化失败', 'error', safeText(error?.message || error));
                const activeState = WSM.Storage.load();
                await setStatePrompts(activeState, activeState.planner?.plan || {}, activeState.planner?.moduleInjections || {});
                console.error('[WorldStateMachine] 完整读取失败，旧状态保持不变', error);
                return { error: safeText(error?.message || error) };
            }
            current.runtime = Object.assign({}, current.runtime, { sourceSummary, worldbookInjection: compilerResult?.report || current.runtime?.worldbookInjection || null });
            current.planner = Object.assign({}, current.planner, {
                lastRunAt: Date.now(), turnKey: key, error: safeText(error?.message || error), moduleInjections: current.planner?.moduleInjections || {}, injection: WSM.Injection.compose(current, current.planner?.plan || {}, current.planner?.moduleInjections || {}),
            });
            await WSM.Storage.save(current, 'planner-error', { snapshot: false });
            await setStatePrompts(current, current.planner?.plan || {}, current.planner?.moduleInjections || {});
            if (initializing || refreshWorld) reportProgress('读取或初始化失败', 'error', safeText(error?.message || error));
            console.error('[WorldStateMachine] Planner 失败，使用当前状态降级', error);
            return current.planner;
        }
    }
    async function ensurePlan(options = {}) {
        if (planningPromise) return planningPromise;
        const interactiveRead = options.interactiveRead === true;
        const controller = interactiveRead ? new AbortController() : null;
        if (controller) activeReadController = controller;
        // Both Gemini/default and GPT complete reads are capped at two calls.
        // GPT reaches that ceiling through stronger deterministic local
        // compaction rather than by increasing billable request count.
        const maximumCalls = options.initialize === true || options.readFullChat === true ? 2 : 0;
        planningPromise = WSM.Api.withCallBudget(maximumCalls, maximumCalls ? 'read-and-initialize' : 'pre-generation-local', () => plan({
            ...options, signal: controller?.signal || options.signal,
        })).finally(() => {
            planningPromise = null;
            if (activeReadController === controller) activeReadController = null;
        });
        return planningPromise;
    }
    function cancelRead() {
        if (!activeReadController || activeReadController.signal.aborted) return false;
        reportProgress('正在终止读取', 'running', '正在取消当前资料读取与状态建立请求…');
        activeReadController.abort();
        return true;
    }
    function isReading() { return !!activeReadController && !activeReadController.signal.aborted; }
    async function interceptor(chat, _contextSize, abort, type) {
        const settings = WSM.Settings.get();
        if (!isForeground(type)) return;
        if (!settings.enabled) {
            await setPrompt('');
            return;
        }
        if (!WSM.Storage.load().initialized) {
            await setPrompt('');
            return;
        }
        try {
            const earlyBlock = generationBlockReason(settings, null);
            if (earlyBlock) {
                if (typeof abort === 'function') abort(earlyBlock);
                else throw new Error(earlyBlock);
                return;
            }
            const compiler = await WSM.WorldbookCompiler?.processChat?.(chat);
            if (compiler?.blocked) {
                const message = compiler.error || '世界书拆解安全检查阻止了正文请求';
                if (typeof abort === 'function') abort(message);
                else throw new Error(message);
                return;
            }
            const planner = await ensurePlan();
            const plannerBlock = generationBlockReason(WSM.Settings.get(), planner);
            if (plannerBlock) {
                if (typeof abort === 'function') abort(plannerBlock);
                else throw new Error(plannerBlock);
                return;
            }
            // WORLD_STATE modules are delivered through separate depth prompts.
            // The interceptor does not mutate chat, avoiding duplicate injection.
        } catch (error) {
            console.error('[WorldStateMachine] 生成拦截失败', error);
            if (typeof abort === 'function' && WSM.Settings.get().blockOnPlannerError) abort(error.message);
        }
    }
    window.WorldStateMachine_interceptGeneration = interceptor;

    function assistantKey(message) { return message ? `${message.id}:${hash(message.content)}` : ''; }
    function rotateTriggersForNextTurn(previous, candidate) {
        const next = candidate;
        const byId = new Map();
        (next.triggers || []).filter((item) => !['triggered','expired'].includes(item?.status)).forEach((item) => {
            const id = safeText(item?.id);
            if (id) byId.set(id, item);
        });
        // An armed trigger represents a causal possibility, not a per-turn
        // suggestion slot. Preserve it until its condition fires, becomes
        // impossible, or is explicitly expired; never churn the whole pool
        // merely because this turn happened to be quiet.
        next.triggers = [...byId.values()];
        return next;
    }
    async function settle(options = {}) {
        const current = WSM.Storage.load();
        const operationChatKey = current.runtime?.storageChatKey || WSM.Storage.currentChatKey();
        if (!current.initialized || !current.planner?.turnKey) return null;
        const assistant = WSM.Context.latestAssistantMessage();
        const key = assistantKey(assistant);
        if (!assistant?.content || (!options.force && current.runtime?.lastSettledMessageId === key)) return null;
        const settings = WSM.Settings.get();
        if (!plannerAvailable(settings)) return null;
        const settleSource = await WSM.Context.buildSource();
        if (WSM.Storage.currentChatKey() !== operationChatKey) return null;
        const recent = settleSource.chat;
        const worldbookReport = WSM.WorldbookCompiler?.getReport?.(current.runtime?.worldbookInjection) || null;
        const payload = {
            phase: 'POST_GENERATION_RECONCILE',
            preState: plannerState(current),
            plannerResult: current.planner,
            actualAssistantMessage: assistant,
            recentChat: recent,
            simulationClock: { elapsedMinutes: Number(current.world?.time?.elapsedMinutes || 0), display: current.world?.time?.display || '' },
            npcSchedule: buildNpcSchedule(current),
            simulationRules: {
                offscreenUpdateIntervalMinutes: 60,
                updateVisibleCharactersEveryTick: true,
                carryOffscreenCharactersBetweenDueTicks: true,
                requirePreexistingCauseForRipple: true,
                allowNoSignificantChange: true,
                forbidUnscheduledOffscreenInvention: true,
            },
            worldbookRules: worldbookReport?.entries || [],
            stateSchema: WSM.Defaults.STATE_SCHEMA,
            moduleOwnership: WSM.Defaults.MODULE_OWNERSHIP,
            modulePrompts: settings.modulePrompts || WSM.Defaults.MODULE_PROMPTS,
            lockedPaths: current.lockedPaths || [],
        };
        try {
            const result = await WSM.Api.complete(`${settings.reconcilerPrompt}\n\n${TRUTH_POLICY_PROMPT}\n\n本次结算必须在同一个 JSON 响应内同时完成增量状态结算、到期的离屏生态推进与世界书浓缩缓存更新。先结算 user/assistant 正文；再严格按 npcSchedule 执行一个有界后台 tick：realtime 可结算正文行动，background 只能沿既存 motives、currentGoals、routine、npcActivities、tasks、processes 或已成立因果继续，carry 必须保持。允许完全无变化，禁止给离屏人物凭空安排新目标、巧合或重大事件。用 npcUpdates 报告本次真正检查结果。除 stateDelta、timelineEntry、actualChanges、npcUpdates 字段外，返回 worldbookEntries 数组；每项沿用输入 worldbookRules 的 key，并只依据本轮 user/assistant 实际正文修正 core、triggers、rules、background。没有变化的状态模块和世界书条目必须省略，禁止为了显得完整而复述。不得要求第二次调用。`, payload, { singleAttempt: true });
            if (WSM.Storage.currentChatKey() !== operationChatKey) return null;
            const delta = result?.stateDelta || result?.delta;
            const legacyState = result?.state;
            if ((!delta || typeof delta !== 'object') && (!legacyState || typeof legacyState !== 'object')) throw new Error('结算响应缺少 stateDelta');
            const candidate = delta && typeof delta === 'object' ? applyStateDelta(current, delta) : legacyState;
            let next = WSM.Storage.enforceLocks(current, candidate);
            next = syncIdentities(next, current.identities);
            next = auditStateLifecycle(next, result?.reasoningAudit || {});
            next = rotateTriggersForNextTurn(current, next);
            next.initialized = true;
            next.planner = current.planner;
            const worldbookUpdate = WSM.WorldbookCompiler?.ingestReadResult?.(settleSource, result);
            next.runtime = Object.assign({}, current.runtime, next.runtime, {
                lastSettledMessageId: key,
                worldbookInjection: worldbookUpdate?.report || current.runtime?.worldbookInjection || null,
                npcLastUpdatedElapsedMinutes: updateNpcClock(current, next, { npcUpdates: result?.npcUpdates || [] }),
            });
            // Manual final-injection edits are intentionally one generation
            // only. Once that assistant response has been reconciled, resume
            // normal state-derived composition.
            delete next.runtime.finalInjectionOverride;
            next.planner.injection = WSM.Injection.compose(next, next.planner?.plan || {}, next.planner?.moduleInjections || {});
            if (result.timelineEntry?.summary) {
                next.timeline = Array.isArray(next.timeline) ? next.timeline : [];
                const entry = Object.assign({ id: `turn-${Date.now()}` }, result.timelineEntry, { actualChanges: result.actualChanges || [] });
                if (!next.timeline.some((item) => item?.id === entry.id || (item?.summary === entry.summary && item?.messageId === key))) {
                    entry.messageId = key;
                    next.timeline.push(entry);
                }
            }
            const userMessage = WSM.Context.latestUserMessage();
            const sourceRefs = [userMessage?.id, assistant?.id].filter((id) => id !== undefined && id !== null && String(id) !== '').map((id) => `chat:${id}`);
            let ledgerChanges = delta && typeof delta === 'object' ? historyChangesFromDelta(delta, sourceRefs, `turn:${key}`) : [];
            if (!ledgerChanges.length && Array.isArray(result.actualChanges)) {
                ledgerChanges = result.actualChanges.filter(Boolean).map((summary, index) => ({
                    changeId: `turn:${key}:actual:${index + 1}`,
                    factId: '', module: 'timeline', operation: 'upsert', entityId: `turn-${key}-${index + 1}`,
                    value: { summary: safeText(summary), granularity: 'turn' }, sourceRefs, origin: 'chat',
                }));
            }
            const changeIds = ledgerChanges.map((change) => change.changeId);
            WSM.Storage.appendHistoryChanges?.(ledgerChanges, [userMessage, assistant].filter(Boolean).map((message, index) => ({
                id: message.id,
                index: Number(message.index || 0),
                role: message.role,
                hidden: message.hidden === true,
                contentHash: hash(message.content),
                changeIds: sourceRefs.includes(`chat:${message.id}`) ? changeIds : [],
            })), { prefix: `turn:${key}` });
            return await WSM.Storage.save(next, 'reconcile', { snapshot: false });
        } catch (error) {
            const next = WSM.Storage.load();
            next.planner = Object.assign({}, next.planner, { error: `结算失败：${safeText(error?.message || error)}` });
            await WSM.Storage.save(next, 'reconcile-error', { snapshot: false });
            console.error('[WorldStateMachine] 正文结算失败', error);
            return null;
        }
    }
    async function ensureSettle(options = {}) {
        if (settlingPromise) return settlingPromise;
        settlingPromise = WSM.Api.withCallBudget(1, 'post-generation-update', () => settle(options))
            .finally(() => { settlingPromise = null; });
        return settlingPromise;
    }
    function bindEvents() {
        if (bound) return true;
        const ctx = WSM.Context.context();
        const events = ctx?.event_types || window.event_types;
        const source = ctx?.eventSource || window.eventSource;
        if (!events || !source?.on) return false;
        WSM.WorldbookCompiler?.installNativeWorldbookFilter?.();
        bound = true;
        const before = events.GENERATION_AFTER_COMMANDS || 'generation_after_commands';
        source.on(before, async (type) => {
            if (isForeground(type) && WSM.Storage.load().initialized) await ensurePlan();
        });
        const onAssistant = () => window.setTimeout(() => ensureSettle(), 500);
        [events.CHARACTER_MESSAGE_RENDERED, events.MESSAGE_RECEIVED].filter(Boolean).forEach((name) => source.on(name, onAssistant));
        if (events.GENERATION_ENDED) source.on(events.GENERATION_ENDED, () => window.setTimeout(() => ensureSettle(), 250));
        if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, () => {
            if (activeReadController && !activeReadController.signal.aborted) activeReadController.abort();
            void setPrompt('');
            void WSM.WorldbookCompiler?.setWorldbookPrompts?.({});
            window.setTimeout(async () => {
                await syncRegisteredPrompt();
                window.dispatchEvent(new CustomEvent('wsm-state-changed', { detail: { reason: 'chat-changed' } }));
            }, 0);
        });
        return true;
    }
    function bindSettingsEvents() {
        if (settingsBound) return;
        settingsBound = true;
        window.addEventListener('wsm-settings-changed', () => { void syncRegisteredPrompt(); });
    }
    async function init() {
        bindSettingsEvents();
        WSM.WorldbookCompiler?.installNativeWorldbookFilter?.();
        await setPrompt('');
        await WSM.WorldbookCompiler?.setWorldbookPrompts?.({});
        if (!bindEvents()) {
            let attempts = 0;
            const timer = window.setInterval(() => {
                attempts += 1;
                if (bindEvents() || attempts > 30) window.clearInterval(timer);
            }, 1000);
        }
    }
    WSM.Engine = { init, plan: ensurePlan, settle: ensureSettle, interceptor, fallbackInjection, reportProgress, resetProgress, getProgress, cancelRead, isReading, syncRegisteredPrompt, refreshGptLocalState, clearRegisteredPrompts, _test: { generationBlockReason, plannerAvailable, activeChatAvailable, setPrompt, setStatePrompts, syncRegisteredPrompt, syncIdentities, initializeInSlices, sourceForInitializeSlice, rotateTriggersForNextTurn, completeSourceRecords, compactSourceChronicle, compactGptSourceChronicle, splitCompleteRecords, splitGptCompleteRecords, removeMirroredChatRecords, prepareSourceForStateRequests, buildStateWithinLimit, normalizeStateResult, normalizeStateCollection, normalizeStateCollections, normalizeGptIdentityAliases, reconcileEntityReferences, auditStateLifecycle, mergeStatePatch, applyStateDelta, applyHistoryLedger, historyChangesFromDelta, mergeCompleteEvidence, supplementMissingEvidenceFromArchive, localEvidenceFromSource, sanitizeGptEvidence, sanitizeGptHydratedState, applyGptSceneToState, stateFromEvidence, firstHalfCacheKey } };
})();
