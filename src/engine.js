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
    let operationProgress = { state: 'idle', message: '', details: '', at: 0, steps: [] };

    const safeText = (value) => String(value ?? '').trim();
    function cancellationError() { return Object.assign(new Error('用户已终止读取'), { name: 'AbortError' }); }
    function throwIfCancelled(signal) { if (signal?.aborted) throw cancellationError(); }
    function reportProgress(message, state = 'running', details = '') {
        const nextMessage = safeText(message);
        const nextDetails = safeText(details);
        // A new initialization begins a fresh, visible progress trail. Keep
        // previous stages of the active run so the user can see exactly where
        // source reading reached before it completed or failed.
        const previous = /^第 1\/3 步：/.test(nextMessage) ? [] : (operationProgress.steps || []);
        const last = previous.at(-1);
        const step = { state, message: nextMessage, details: nextDetails, at: Date.now() };
        const steps = last?.message === step.message && last?.details === step.details && last?.state === step.state
            ? [...previous.slice(0, -1), step]
            : [...previous, step].slice(-36);
        operationProgress = { ...step, steps };
        try { window.dispatchEvent(new CustomEvent('wsm-operation-progress', { detail: operationProgress })); }
        catch (_error) { /* Progress reporting must never interrupt planning. */ }
        return operationProgress;
    }
    function getProgress() { return { ...operationProgress, steps: (operationProgress.steps || []).map((step) => ({ ...step })) }; }
    function resetProgress() {
        operationProgress = { state: 'idle', message: '', details: '', at: Date.now(), steps: [] };
        try { window.dispatchEvent(new CustomEvent('wsm-operation-progress', { detail: operationProgress })); }
        catch (_error) { /* Resetting display state must never interrupt clearing. */ }
        return getProgress();
    }
    function syncIdentities(state, names = WSM.Context.identityNames()) {
        const next = state;
        const identities = {
            user: safeText(names?.user || next.identities?.user),
            char: safeText(names?.char || next.identities?.char),
        };
        next.identities = identities;
        (next.characters || []).forEach((character) => {
            const id = safeText(character?.id).toLowerCase();
            if (['user','<user>'].includes(id) && identities.user) character.name = identities.user;
            if (['char','character','<char>'].includes(id) && identities.char) character.name = identities.char;
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
        return (Number.isInteger(ctx?.characterId) && ctx.characterId >= 0) || !!ctx?.groupId || (Array.isArray(ctx?.chat) && ctx.chat.length > 0);
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
        ['worldRules','factAnchors','characters','npcActivities','relationships','knowledge','tasks','events','triggers','threads','processes','causalEffects','timeline'].forEach((module) => {
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
    const MAX_COMPLETE_HALF_CHARS = 180000;
    const TWO_PASS_SOURCE_TARGET_CHARS = 260000;
    const SOURCE_PROGRESS_FRAGMENT_CHARS = 8000;
    const FIRST_HALF_EVIDENCE_RESERVE_CHARS = 18000;
    const FIRST_HALF_CACHE_KEY = 'wsm_two_pass_first_half_cache_v3';
    const SOURCE_READ_PROMPT = '你是资料读取器，不是故事续写者。sourceRecords 是严格分配给请求 A 的资料；chat-message 可能是程序从超长原文逐条提取的语义年表，但每个聊天楼层都已被本地扫描并保留编号、角色与最有连续性价值的内容。逐条读取，serializedJson 分片按 ref、part 顺序拼接理解。原始世界书、角色卡、Persona和完整聊天仍是权威来源，本结果只建立当前运行证据。先去重再分级：L3为身份真相、重大秘密、不可逆事实、核心关系或主线矛盾；L2为当前任务、关系变化、进程和关键情报；L1为饮食、短暂情绪、小动作和一次性日常。必须逐个检查并提取所有具备依据的模块，不得因为优先级较低就整栏遗漏：resourceConstraints=当前真正限制行动的资金、权限、人手、关键持有物或地点封锁；npcActivities=NPC脱离玩家视野后的实际或既定活动；triggers=尚未发生且等待条件的一次节点；threads=围绕用户经历持续未解决的剧情线；processes=即使用户不参与也会演变的世界级变化；timeline=已发生且值得回顾的重要节点。anchors只放正文中已永久成立、遗忘会造成逻辑错误且不能由其他模块替代的最终客观结果，绝不能复制世界书原设。locations只提取空间实体，按世界→城市→区域→建筑→内部空间给出parentId；同名同父级只留一个。description只写稳定空间用途，origin用一句人物+行为/原因或“世界设定”说明首次来源，禁止写事件经过与剧情意义。HOT仅限当前场景，WARM为近期可用，COLD为暂不相关。只保留会影响连续性的当前版本；不得预测结果、续写或替用户选择。确无依据时数组可以为空并由程序建立“尚未建立”占位；同一对象或同一事实只能出现一次。每项必须具备最小有效字段，npcActivities必须有characterId和action，tasks必须有title，triggers必须有title及conditions或userRelevance。严禁列出全部输入ref。输出总长必须少于4400个中文字符；数组硬上限：currentScene 3、progression 1、anchors 6、resourceConstraints 8、characters 10、npcActivities 6、relationships 8、knowledge 10、chronology 8、timeline 8、canon 6、locations 8、tasks 5、events 5、triggers 5、threads 5、processes 5、causal 5、uncertainties 3。每项一句，单项不超过80字，所有数组键都必须保留。不得输出思考、Markdown或解释。必须从以下开头直接输出闭合JSON：{"evidence":{"currentScene":[],"progression":[],"anchors":[],"resourceConstraints":[],"characters":[],"npcActivities":[],"relationships":[],"knowledge":[],"chronology":[],"timeline":[],"canon":[],"locations":[],"tasks":[],"events":[],"triggers":[],"threads":[],"processes":[],"causal":[],"uncertainties":[]}}。';
    const FINAL_EVIDENCE_PROMPT = '你是第二段资料读取与证据合并器，不是故事续写者。firstHalfEvidence 是请求 A 的有界证据，sourceRecords 是后半资料；逐条读取后半并与前半去重，只保留仍影响当前运行的最新版本。必须逐个检查并分别维护resourceConstraints、npcActivities、tasks、events、triggers、threads、processes、causal和timeline，不得因为属于L1或信息较早就整栏遗漏；只有原文确实没有符合定义的内容时才为空并交给程序建立“尚未建立”占位。resourceConstraints只收录会改变行动可行性的资金、权限、人手、关键持有物或封锁，不做资产清单。原始世界书、角色卡、Persona和完整聊天仍是权威来源；不得把本结果当作替代原文的固定摘要。anchors只保留正文已永久确立且不能由其他模块替代的最终结果。L3为核心锚点，L2为活跃信息，L1为临时信息；HOT只给当前场景。不得预测、续写、创造或替用户决定。同一对象或事实只保留一个最新版本。缺字段时删除，禁止输出空对象和半成品；npcActivities必须有characterId和action，tasks必须有title，triggers必须有title及conditions或userRelevance。输出总长必须少于4800个中文字符；最终数组硬上限：currentScene 3、progression 1、anchors 8、resourceConstraints 10、characters 12、npcActivities 8、relationships 10、knowledge 12、chronology 10、timeline 10、canon 6、locations 10、tasks 6、events 6、triggers 6、threads 6、processes 6、causal 6、uncertainties 3。每项一句，单项不超过80字，所有数组键都必须保留。不得输出思考、Markdown或解释。必须从以下开头直接输出闭合JSON：{"evidence":{"currentScene":[],"progression":[],"anchors":[],"resourceConstraints":[],"characters":[],"npcActivities":[],"relationships":[],"knowledge":[],"chronology":[],"timeline":[],"canon":[],"locations":[],"tasks":[],"events":[],"triggers":[],"threads":[],"processes":[],"causal":[],"uncertainties":[]}}。';
    const INITIAL_STATE_PROMPT = '你是世界状态初始化器，不是故事续写者。先识别事实、跨模块去重，再按priority与activity建立紧凑当前状态。world固定只含当前时间、季节、地点、天气、环境和最多8条正在生效的客观状态；天气必须存在，服从地点、季节、时间与既有气象并连续渐变。resourceConstraints只记录当前会改变行动可行性的资金、权限、人手、关键物品与地点封锁，不做资产清单，不猜测数量。人物背景、历史、未来安排和世界规则不得进入world。factAnchors只放正文已经永久确立且不能由其他模块明确表达的最终客观结果；世界书、角色卡和Persona始终是长期设定权威。L2为当前阶段重要信息，L1为临时信息；HOT仅限当前场景。当前型模块只留最新版本。初始化必须逐一检查stateSchema中的所有展示模块，有依据的模块至少返回一条最相关当前记录；确无依据时允许程序建立明确的“尚未建立”占位，不得用捏造设定凑数。卡片缺关键字段时不创建，禁止空对象、空标题、空白卡和同一事实的多份改写。普通饮食、姿势、衣物、情绪和日用品默认不进入。重要完成节点才进入timeline。单模块通常不超过8张卡，单卡列表字段通常不超过4项；达到容量时保留L3与当前HOT/L2，其余留在原始资料。禁止预演未来、创造设定或输出分析。整个JSON严格控制在2200个中文字符以内，只输出闭合严格JSON：{"state":{}}。';
    const TRUTH_POLICY_PROMPT = '真实性硬规则：补全顺序为原文事实→定点回查世界书/角色卡/摘要/历史→可确定程序推导→有充分线索的推测→仅低风险模块受约束生成→明确未知。每个持久条目都返回truthStatus、basis、sourceRefs。truthStatus只允许confirmed、derived、system_generated、suspected、assumed、unknown、not_established、not_applicable、failed。confirmed必须绑定来源；derived必须有可复算依据；suspected/assumed不得写成事实或自动升级；failed必须重试读取。天气可system_generated但服从地点、季节、时间、上轮天气和特殊气候并连续演变；季节优先由日期、地点和南北半球确定，衣着只能作冷暖弱线索。人物身份、关系、秘密/知识、世界规则、任务、权限、命名地点禁止自由生成，无证据时明确unknown或not_established。L3禁止suspected、assumed、system_generated。集合可为空，但必填单值不得空字符串，至少写“未明确”并附真实性元数据。';
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
        clone.currentUserAction = [...clone.chat].reverse().find((message) => message.role === 'user') || null;
        clone.latestAssistantText = [...clone.chat].reverse().find((message) => message.role === 'assistant') || null;
        clone.semanticChronicle = {
            enabled: true,
            method: 'all-message-local-scan',
            coveredMessages: chat.length,
            totalMessages: Number(source?.tavernTextContext?.totalMessages || chat.length),
            recentFullResolutionMessages: recentCount,
            note: '每条聊天均已扫描；较早助手消息优先保留meow_FM/INDRS中的时间、地点、剧情摘要和持续种子，完整原文仍在SillyTavern。',
        };
        return { source: clone, compacted: true, coveredMessages: chat.length };
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
        (source?.chat || []).forEach((message, index) => addSerialized(
            `chat:${message?.id ?? index}`, 'chat-message', message, { messageIndex: index },
        ));
        ['worldbookDiagnostics','tavernTextContext','currentUserAction','latestAssistantText','compiledWorldbookRules'].forEach((field) => {
            if (source?.[field] !== undefined) addSerialized(field, 'source-metadata', source[field]);
        });
        return records;
    }
    function splitCompleteRecords(records, secondRequestOverhead = 0) {
        // Keep every multipart JSON value in the same request. Splitting two
        // adjacent parts of one worldbook entry across requests would make
        // neither model call able to reconstruct that entry by itself.
        const groups = [];
        records.forEach((record) => {
            const previous = groups.at(-1);
            if (previous?.[0]?.ref === record.ref) previous.push(record);
            else groups.push([record]);
        });
        if (groups.length < 2) return [records, []];
        const lengths = groups.map((group) => JSON.stringify(group).length + 1);
        const total = lengths.reduce((sum, length) => sum + length, 0);
        let bestIndex = 1;
        let bestPeak = Infinity;
        let bestDifference = Infinity;
        let running = 0;
        for (let index = 1; index < groups.length; index += 1) {
            running += lengths[index - 1];
            const firstRequest = running;
            const secondRequest = Math.max(0, total - running) + Math.max(0, Number(secondRequestOverhead || 0));
            const peak = Math.max(firstRequest, secondRequest);
            const difference = Math.abs(firstRequest - secondRequest);
            if (peak < bestPeak || (peak === bestPeak && difference < bestDifference)) {
                bestPeak = peak;
                bestDifference = difference;
                bestIndex = index;
            }
        }
        return [groups.slice(0, bestIndex).flat(), groups.slice(bestIndex).flat()];
    }
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
        const chronicle = rawSerialized.length > TWO_PASS_SOURCE_TARGET_CHARS
            ? compactSourceChronicle(source, TWO_PASS_SOURCE_TARGET_CHARS)
            : { source, compacted: false, coveredMessages: Array.isArray(source?.chat) ? source.chat.length : 0 };
        const preparedSource = chronicle.source;
        const serialized = JSON.stringify(preparedSource);
        const worldbookEntries = (source?.worldbooks || []).reduce((sum, book) => sum + (book.entries || []).length, 0);
        const large = rawSerialized.length > 50000 || worldbookEntries > 200;
        if (!large) return { source, large: false, originalChars: rawSerialized.length, includedChars: rawSerialized.length, worldbookEntries, records: 1 };
        const records = completeSourceRecords(preparedSource);
        const payloadWithoutSource = { ...(options.payload || {}), source: undefined };
        // Keep A and B close to an even raw-source size. The configured proxy
        // has already demonstrated that roughly 60k characters succeeds, while
        // moving most source text into A to compensate for B's schema overhead
        // makes A hit Gateway Timeout before the model can return evidence.
        const secondRequestOverhead = String(options.plannerPrompt || '').length
            + JSON.stringify(payloadWithoutSource).length
            + FIRST_HALF_EVIDENCE_RESERVE_CHARS;
        // Split first so removing end-of-source mirrors cannot move request A's
        // boundary or invalidate a paid evidence cache. currentUserAction and
        // latestAssistantText are byte-for-byte copies of chat records produced
        // by Context.buildSource; sending them again only inflates request B.
        const halves = splitCompleteRecords(records);
        const deduplicatedSecond = removeMirroredChatRecords(preparedSource, halves[1]);
        halves[1] = deduplicatedSecond.records;
        const halfChars = halves.map((half) => JSON.stringify(half).length);
        const oversized = halfChars.findIndex((length) => length > MAX_COMPLETE_HALF_CHARS);
        if (oversized >= 0) {
            throw new Error(`资料原文共有 ${rawSerialized.length} 字；本地逐条提炼后第 ${oversized + 1}/2 半仍为 ${halfChars[oversized]} 字，超过两次请求的单次安全容量 ${MAX_COMPLETE_HALF_CHARS} 字。为避免漏读和额外扣费，本次尚未调用 API；请减少超大角色卡或世界书。插件不会擅自发起第三次请求。`);
        }
        return {
            source: null, halves, large: true, originalChars: rawSerialized.length,
            includedChars: serialized.length, halfChars, worldbookEntries, records: records.length,
            semanticCompaction: chronicle.compacted,
            coveredChatMessages: chronicle.coveredMessages,
            sentRecords: halves[0].length + halves[1].length,
            deduplicatedRecords: records.length - halves[0].length - halves[1].length,
            deduplicatedRefs: deduplicatedSecond.removedRefs,
            progressFragments: halfChars.map((length) => Math.max(1, Math.ceil(length / SOURCE_PROGRESS_FRAGMENT_CHARS))),
            secondRequestOverhead,
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
        return `a2:${hash(JSON.stringify({
            model: settings?.model || '', endpoint: settings?.useTavernApi === false ? settings?.endpoint || '' : 'tavern',
            records: prepared?.halves?.[0] || [], prompt: `${SOURCE_READ_PROMPT}\n${TRUTH_POLICY_PROMPT}`,
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
    const STATE_COLLECTION_KEYS = new Set(['worldRules','factAnchors','resourceConstraints','characters','npcActivities','relationships','knowledge','tasks','events','triggers','threads','processes','causalEffects','timeline']);
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
        if (wrapped) return { ...wrapped, state: mergeStatePatch(baseState || WSM.Defaults.createState(), wrapped.state) };
        const stateKeys = Object.keys(WSM.Defaults?.STATE_SCHEMA || {});
        const rootKeyCount = stateKeys.reduce((count, key) => count + (Object.prototype.hasOwnProperty.call(result || {}, key) ? 1 : 0), 0);
        return rootKeyCount >= 3 ? { state: mergeStatePatch(baseState || WSM.Defaults.createState(), result), plan: {}, moduleInjections: {} } : result;
    }
    const EVIDENCE_KEYS = ['sourceRefs','canon','chronology','timeline','anchors','resourceConstraints','characters','npcActivities','relationships','knowledge','locations','tasks','events','triggers','threads','processes','causal','progression','currentScene','uncertainties'];
    function evidenceItemText(item) {
        if (typeof item === 'string' || typeof item === 'number') return safeText(item);
        if (!item || typeof item !== 'object') return '';
        return safeText(item.summary || item.text || item.fact || item.information || item.content || item.description || item.title || item.name || JSON.stringify(item));
    }
    function mergeCompleteEvidence(...inputs) {
        const merged = Object.fromEntries(EVIDENCE_KEYS.map((key) => [key, []]));
        EVIDENCE_KEYS.forEach((key) => {
            const seen = new Set();
            inputs.forEach((input) => {
                const source = input?.evidence ?? input?.digest ?? input ?? {};
                const values = Array.isArray(source?.[key]) ? source[key] : (source?.[key] == null ? [] : [source[key]]);
                values.forEach((item) => {
                    const identity = key === 'sourceRefs' ? safeText(item) : evidenceItemText(item);
                    if (!identity || seen.has(identity)) return;
                    seen.add(identity);
                    merged[key].push(item);
                });
            });
        });
        return merged;
    }
    function stateFromEvidence(firstEvidence, secondEvidence, baseState = null) {
        const evidence = mergeCompleteEvidence(firstEvidence, secondEvidence);
        const state = mergeStatePatch(baseState || WSM.Defaults.createState(), {});
        const objectItem = (item) => item && typeof item === 'object' && !Array.isArray(item) ? { ...item } : {};
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
            const module = ({ anchor: 'factAnchors', constraint: 'resourceConstraints', character: 'characters', npcActivity: 'npcActivities', relationship: 'relationships', knowledge: 'knowledge', task: 'tasks', event: 'events', trigger: 'triggers', thread: 'threads', process: 'processes', causal: 'causalEffects', timeline: 'timeline' })[prefix] || prefix;
            const prepared = { ...result, priority, activity: activityOf(source, text, priority), sourceRefs, basis };
            return WSM.Storage?.enforceTruthTransition?.({}, prepared, module) || prepared;
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
        const scene = evidence.currentScene.map(evidenceItemText).filter(Boolean)
            .filter((text) => !/(吃了|喝了|早餐|午餐|晚餐|零食|微笑|皱眉|坐下|站起|穿着|拿着)/.test(text))
            .slice(-8);
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
        state.world.location.environment = safeText(latestSceneObject.environment || latestSceneObject.summary || evidenceItemText(latestScene) || state.world.location.environment);
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
        state.world.time.display = safeText(latestChronology.time || latestChronology.date || latestChronology.display || state.world.time.display || latestChronologyText.slice(0, 100));
        const timeRefs = Array.isArray(latestChronology.sourceRefs) ? latestChronology.sourceRefs.filter(Boolean).map(safeText) : [];
        if (state.world.time.display) Object.assign(state.world.time, { truthStatus: timeRefs.length ? 'confirmed' : 'assumed', basis: ['时间来自已读取的时间顺序证据'], sourceRefs: timeRefs });
        state.factAnchors = selectRuntime(mapped(evidence.anchors, 'anchor', (item, text, id) => ({
            ...item, id: safeText(item.id || id), fact: safeText(item.fact || item.summary || text), scope: safeText(item.scope),
            sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.slice(0, 3) : [],
        })), 16).map((item) => ({ ...item, priority: 'L3', activity: item.activity || 'COLD' }));
        state.resourceConstraints = selectRuntime(mapped(evidence.resourceConstraints, 'constraint', (item, text, id) => ({
            ...item, id: safeText(item.id || id), subjectId: safeText(item.subjectId || item.subject),
            kind: safeText(item.kind || 'other'), condition: safeText(item.condition || item.summary || text),
            status: safeText(item.status || 'active'), amount: safeText(item.amount), scope: safeText(item.scope),
            consequence: safeText(item.consequence || item.effect), sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.slice(0, 3) : [],
        })).filter((item) => item.condition && item.status !== 'expired'), 10);
        const mappedCharacters = mapped(evidence.characters, 'character', (item, text, id) => ({
            ...item, id: safeText(item.id || id), name: safeText(item.name || item.character || item.person || text.split(/[：:]/)[0].trim().slice(0, 80)),
            summary: safeText(item.summary || item.description || text), description: safeText(item.description || item.summary || text), notes: safeText(item.notes || item.summary || item.description || text),
        }));
        const charactersByName = new Map();
        mappedCharacters.forEach((character, index) => {
            const key = safeText(character.name).toLocaleLowerCase() || safeText(character.id) || String(index);
            const previous = charactersByName.get(key);
            charactersByName.set(key, previous ? { ...previous, ...character, id: previous.id || character.id } : character);
        });
        state.characters = selectRuntime([...charactersByName.values()], 16);
        const mappedNpcActivities = mapped(evidence.npcActivities, 'npcActivity', (item, text, id) => ({
            ...item, id: safeText(item.id || id), characterId: safeText(item.characterId || item.character || item.actorId || item.actor),
            location: safeText(item.location), movement: safeText(item.movement || item.route),
            action: safeText(item.action || item.activity || item.summary || text), currentRole: safeText(item.currentRole || item.role),
        })).filter((item) => item.characterId && item.action);
        const latestNpcActivity = new Map();
        mappedNpcActivities.forEach((item) => latestNpcActivity.set(item.characterId, item));
        state.npcActivities = selectRuntime([...latestNpcActivity.values()], 12);
        state.relationships = selectRuntime(mapped(evidence.relationships, 'relationship', (item, text, id) => {
            const participants = Array.isArray(item.participants) ? item.participants.map(safeText).filter(Boolean) : [];
            return {
                ...item,
                id: safeText(item.id || id),
                from: safeText(item.from || item.subject || participants[0]),
                to: safeText(item.to || item.object || participants[1]),
                status: safeText(item.status || item.summary || item.description || text),
            };
        }), 16);
        state.knowledge = selectRuntime(mapped([...evidence.knowledge, ...evidence.uncertainties], 'knowledge', (item, text, id) => ({
            ...item, id: safeText(item.id || id), information: safeText(item.information || item.summary || text),
            status: safeText(item.status || (evidence.uncertainties.includes(item) ? 'Suspected' : 'Known')),
        })), 24);
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
        state.events = selectRuntime(mapped(evidence.events, 'event', (item, text, id) => ({ ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || text.slice(0, 100)), summary: safeText(item.summary || item.description || text), status: safeText(item.status || 'ongoing') })), 8);
        state.triggers = selectRuntime(mapped(evidence.triggers, 'trigger', (item, text, id) => ({
            ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || text.slice(0, 100)),
            conditions: Array.isArray(item.conditions) ? item.conditions.map(safeText).filter(Boolean) : [], status: safeText(item.status || 'armed'),
            effectsIfTriggered: Array.isArray(item.effectsIfTriggered || item.effects) ? (item.effectsIfTriggered || item.effects).map(safeText).filter(Boolean) : [],
            blockedReasons: Array.isArray(item.blockedReasons) ? item.blockedReasons.map(safeText).filter(Boolean) : [],
            userVisible: item.userVisible !== false, userRelevance: safeText(item.userRelevance),
        })), 6);
        state.threads = selectRuntime(mapped(evidence.threads, 'thread', (item, text, id) => ({
            ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || text.slice(0, 100)), status: safeText(item.status || 'open'),
            stakes: safeText(item.stakes || item.summary || text), participantIds: Array.isArray(item.participantIds || item.participants) ? (item.participantIds || item.participants).map(safeText).filter(Boolean) : [],
            nextNaturalStep: safeText(item.nextNaturalStep), history: Array.isArray(item.history) ? item.history.map(safeText).filter(Boolean) : [],
        })), 8);
        state.processes = selectRuntime(mapped(evidence.processes, 'process', (item, text, id) => ({
            ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || text.slice(0, 100)), status: safeText(item.status || 'active'),
            kind: safeText(item.kind || 'other'), drivers: Array.isArray(item.drivers) ? item.drivers.map(safeText).filter(Boolean) : [],
            currentDirection: safeText(item.currentDirection || item.direction || item.summary || text),
            decayConditions: Array.isArray(item.decayConditions) ? item.decayConditions.map(safeText).filter(Boolean) : [],
            resolutionConditions: Array.isArray(item.resolutionConditions) ? item.resolutionConditions.map(safeText).filter(Boolean) : [],
        })), 8);
        state.causalEffects = selectRuntime(mapped(evidence.causal, 'causal', (item, text, id) => ({ ...item, id: safeText(item.id || id), cause: safeText(item.cause || text), result: safeText(item.result || item.effect || text), status: safeText(item.status || 'developing'), steps: Array.isArray(item.steps) ? item.steps : [], affectedIds: Array.isArray(item.affectedIds) ? item.affectedIds : [], evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [] })), 10);
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
        return { state, plan: {}, moduleInjections: {}, evidence };
    }
    async function buildStateWithinLimit(plannerPrompt, payload, _baseState, settings, signal, prepared) {
        if (prepared?.calibration) {
            const hydrated = stateFromEvidence(prepared.evidence || {}, {}, _baseState);
            hydrated.state = applyHistoryLedger(hydrated.state, prepared.allChanges || prepared.ledger || []);
            hydrated.calibration = { audit: prepared.audit, boundary: prepared.boundary, fingerprint: prepared.fingerprint };
            return hydrated;
        }
        if (!prepared?.large) {
            const direct = await WSM.Api.complete(`${INITIAL_STATE_PROMPT}\n\n${TRUTH_POLICY_PROMPT}`, payload, { maxTokens: 5000, singleAttempt: true, signal, jsonContract: 'state' });
            prepared.requestAttempts = 1;
            prepared.cacheHits = 0;
            return normalizeStateResult(direct, _baseState);
        }
        throwIfCancelled(signal);
        const fragments = prepared.progressFragments || [Math.max(1, Math.ceil(prepared.halfChars[0] / SOURCE_PROGRESS_FRAGMENT_CHARS)), Math.max(1, Math.ceil(prepared.halfChars[1] / SOURCE_PROGRESS_FRAGMENT_CHARS))];
        const totalFragments = fragments[0] + fragments[1];
        const cacheKey = firstHalfCacheKey(prepared, settings);
        let firstHalfEvidence = readFirstHalfCache(cacheKey);
        prepared.requestAttempts = 0;
        prepared.cacheHits = firstHalfEvidence ? 1 : 0;
        if (firstHalfEvidence) {
            reportProgress('正在分批读取全部资料', 'running', `原文分片 1–${fragments[0]}/${totalFragments} · 请求 A 已复用完整证据缓存 · 缓存复用 1 片 · 尚未新增扣费`);
        } else {
            reportProgress('正在分批读取全部资料', 'running', `原文分片 1–${fragments[0]}/${totalFragments} · 请求 A 读取 · API 1/2 · 缓存复用 0 片 · ${prepared.halves[0].length} 项 ${prepared.halfChars[0]} 字`);
            const firstResult = await WSM.Api.complete(
                `${SOURCE_READ_PROMPT}\n\n${TRUTH_POLICY_PROMPT}`,
                { task: 'SOURCE_READ_HALF_ONCE', sourceHalfIndex: 1, sourceHalfCount: 2, sourceRecords: prepared.halves[0] },
                { maxTokens: 5000, singleAttempt: true, signal, jsonContract: 'evidence' },
            );
            prepared.requestAttempts += 1;
            firstHalfEvidence = firstResult?.evidence ?? firstResult?.digest ?? firstResult;
            if (firstHalfEvidence && typeof firstHalfEvidence === 'object') await writeFirstHalfCache(cacheKey, firstHalfEvidence);
            reportProgress('请求 A 已完整读取并缓存', 'running', `原文分片 ${fragments[0]}/${totalFragments} · 已读 ${prepared.halves[0].length}/${prepared.records} 项 · 下一步请求 B`);
        }
        if (!firstHalfEvidence || typeof firstHalfEvidence !== 'object') throw new Error('第 1/2 次读取响应缺少 evidence；已停止，不会发起第三次请求');
        throwIfCancelled(signal);
        const apiOrdinal = prepared.requestAttempts + 1;
        // Request B performs the same bounded evidence-reading job as A. State
        // hydration is deterministic and local, so no schema/module rules or
        // empty current state need to cross the proxy.
        const finalPayload = {
            task: 'SOURCE_READ_SECOND_HALF_ONCE',
            firstHalfEvidence,
            sourceHalfIndex: 2,
            sourceHalfCount: 2,
            sourceRecords: prepared.halves[1],
            completeCoverage: {
                originalChars: prepared.originalChars, includedChars: prepared.includedChars,
                records: prepared.records, sentRecords: prepared.sentRecords || prepared.records,
                mirroredChatRecordsReused: prepared.deduplicatedRefs || [],
            },
        };
        const finalInputChars = JSON.stringify(finalPayload).length + FINAL_EVIDENCE_PROMPT.length + TRUTH_POLICY_PROMPT.length;
        reportProgress('正在分批读取全部资料', 'running', `原文分片 ${fragments[0] + 1}–${totalFragments}/${totalFragments} · 请求 B 读取并合并证据 · API ${apiOrdinal}/2 · 携带请求 A 全部证据 · 约 ${finalInputChars} 字`);
        const finalResult = await WSM.Api.complete(
            `${FINAL_EVIDENCE_PROMPT}\n\n${TRUTH_POLICY_PROMPT}`,
            finalPayload,
            { maxTokens: 5000, stream: true, singleAttempt: true, signal, jsonContract: 'evidence' },
        );
        prepared.requestAttempts += 1;
        const secondHalfEvidence = finalResult?.evidence ?? finalResult?.digest ?? finalResult;
        if (!secondHalfEvidence || typeof secondHalfEvidence !== 'object') throw new Error('第 2/2 次读取响应缺少 evidence；已停止，不会发起第三次请求');
        reportProgress('请求 B 已读取后半并完成证据合并', 'running', `原文分片 ${totalFragments}/${totalFragments} · 全部 ${prepared.records} 项内容已覆盖 · API 发送 ${prepared.sentRecords || prepared.records} 项、复用聊天镜像 ${prepared.deduplicatedRecords || 0} 项 · 实际 API ${prepared.requestAttempts} 次 · 缓存复用 ${prepared.cacheHits} 片`);
        return stateFromEvidence(firstHalfEvidence, secondHalfEvidence, _baseState);
    }
    function updateNpcClock(previous, next, plan, initialize = false) {
        const clock = Object.assign({}, previous.runtime?.npcLastUpdatedElapsedMinutes || {});
        const elapsed = Number(next.world?.time?.elapsedMinutes || 0);
        if (initialize) (next.characters || []).forEach((item) => { if (item?.id) clock[item.id] = elapsed; });
        (plan?.npcUpdates || []).forEach((item) => {
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
        return setPrompt(WSM.Injection.composeByDepth(state, plan, moduleInjections));
    }
    async function syncRegisteredPrompt() {
        const settings = WSM.Settings.get();
        if (!settings.enabled) return setPrompt('');
        const state = WSM.Storage.load();
        const hasUsableState = state.initialized || !!safeText(state.planner?.injection);
        if (!hasUsableState) return setPrompt('');
        state.planner.injection = WSM.Injection.compose(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
        return setStatePrompts(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
    }
    async function clearRegisteredPrompts() {
        if (typeof localStorage !== 'undefined') {
            try { localStorage.removeItem(FIRST_HALF_CACHE_KEY); }
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
        const persistedCurrent = current;
        // A rebuild starts from a clean state, but the old persisted state is
        // retained until the replacement succeeds. Cancellation/failure is safe.
        const rebuildBase = rebuilding ? syncIdentities(WSM.Defaults.createState()) : current;
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
                await setStatePrompts(persistedCurrent, persistedCurrent.planner?.plan || {}, persistedCurrent.planner?.moduleInjections || {});
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
                prepared = prepareSourceForStateRequests(completeSourceSnapshot, { payload, plannerPrompt });
                payload.source = prepared.source;
                sourceSummary.sourceRead = {
                    mode: prepared.large ? 'two-pass-local-chronicle' : 'single-pass-complete-source',
                    chunked: false,
                    apiLimit: prepared.large ? 2 : 1,
                    semanticCompaction: prepared.semanticCompaction === true,
                    requestAttempts: prepared.requestAttempts, cacheHits: prepared.cacheHits,
                    originalChars: prepared.originalChars, includedChars: prepared.includedChars,
                    coveredChatMessages: Number(prepared.coveredChatMessages || sourceSummary.chatMessages || 0),
                    records: prepared.records,
                };
            }
            if (initializing || refreshWorld) reportProgress('本地全量扫描完成，正在建立基准快照', 'running', prepared?.large
                ? `全部 ${prepared.coveredChatMessages || sourceSummary.chatMessages} 条正文及世界书已本地覆盖 · 固定最多 API 2 次`
                : `完整资料 ${prepared.originalChars} 字 · 固定 API 1 次`);
            const result = await buildStateWithinLimit(plannerPrompt, payload, rebuildBase, settings, signal, prepared);
            throwIfCancelled(signal);
            if (sourceSummary.sourceRead && prepared) {
                sourceSummary.sourceRead.requestAttempts = Number(prepared.requestAttempts || 0);
                sourceSummary.sourceRead.cacheHits = Number(prepared.cacheHits || 0);
                sourceSummary.sourceRead.progressFragments = prepared.progressFragments || [1];
            }
            if (!result?.state || typeof result.state !== 'object') throw new Error('Planner 响应缺少 state');
            let next = WSM.Storage.enforceLocks(rebuildBase, result.state);
            next = syncIdentities(next, source.identities);
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
                        chunks: prepared.large ? 2 : 1,
                        referenceChunks: 0,
                        chatChunks: prepared.large ? 2 : 1,
                        requestAttempts: Number(prepared.requestAttempts || 0),
                        cacheHits: Number(prepared.cacheHits || 0),
                    },
                });
            }
            await setStatePrompts(next, next.planner.plan || {}, next.planner.moduleInjections || {});
            if (initializing || refreshWorld) {
                reportProgress('两阶段读取与基准快照已建立', 'success', `完整覆盖 ${sourceSummary.chatMessages} 条正文 · 世界书 ${sourceSummary.loadedWorldbooks.length} 本 · API ${prepared.requestAttempts || 0}/2 · 缓存复用 ${prepared.cacheHits || 0} 次 · 原文仍保留在酒馆`);
            }
            return next.planner;
        } catch (error) {
            if (signal?.aborted) {
                reportProgress('读取已终止', 'cancelled', '旧状态未被修改；可以随时重新开始读取。');
                await setStatePrompts(persistedCurrent, persistedCurrent.planner?.plan || {}, persistedCurrent.planner?.moduleInjections || {});
                return { cancelled: true };
            }
            if (initializing || refreshWorld) {
                reportProgress('读取或初始化失败', 'error', safeText(error?.message || error));
                await setStatePrompts(persistedCurrent, persistedCurrent.planner?.plan || {}, persistedCurrent.planner?.moduleInjections || {});
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
        // Manual initialization/refresh has a strict two-call ceiling. Local
        // scanning and deterministic compaction do not consume API calls.
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
        if (!current.initialized || !current.planner?.turnKey) return null;
        const assistant = WSM.Context.latestAssistantMessage();
        const key = assistantKey(assistant);
        if (!assistant?.content || (!options.force && current.runtime?.lastSettledMessageId === key)) return null;
        const settings = WSM.Settings.get();
        if (!plannerAvailable(settings)) return null;
        const settleSource = await WSM.Context.buildSource();
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
            const delta = result?.stateDelta || result?.delta;
            const legacyState = result?.state;
            if ((!delta || typeof delta !== 'object') && (!legacyState || typeof legacyState !== 'object')) throw new Error('结算响应缺少 stateDelta');
            const candidate = delta && typeof delta === 'object' ? applyStateDelta(current, delta) : legacyState;
            let next = WSM.Storage.enforceLocks(current, candidate);
            next = syncIdentities(next, current.identities);
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
            void setPrompt('');
            void WSM.WorldbookCompiler?.setWorldbookPrompts?.({});
            window.dispatchEvent(new CustomEvent('wsm-state-changed', { detail: { reason: 'chat-changed' } }));
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
    WSM.Engine = { init, plan: ensurePlan, settle: ensureSettle, interceptor, fallbackInjection, reportProgress, resetProgress, getProgress, cancelRead, isReading, syncRegisteredPrompt, clearRegisteredPrompts, _test: { generationBlockReason, plannerAvailable, activeChatAvailable, setPrompt, setStatePrompts, syncRegisteredPrompt, initializeInSlices, sourceForInitializeSlice, rotateTriggersForNextTurn, completeSourceRecords, compactSourceChronicle, splitCompleteRecords, removeMirroredChatRecords, prepareSourceForStateRequests, buildStateWithinLimit, normalizeStateResult, mergeStatePatch, applyStateDelta, applyHistoryLedger, historyChangesFromDelta, mergeCompleteEvidence, stateFromEvidence, firstHalfCacheKey } };
})();
