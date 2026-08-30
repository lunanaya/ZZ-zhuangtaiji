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
    const SOURCE_PROGRESS_FRAGMENT_CHARS = 8000;
    const FIRST_HALF_EVIDENCE_RESERVE_CHARS = 18000;
    const FIRST_HALF_CACHE_KEY = 'wsm_two_pass_first_half_cache_v2';
    const SOURCE_READ_PROMPT = '你是资料读取器，不是故事续写者。sourceRecords 是全部资料严格分配给请求 A 的原文；逐条读取，serializedJson 分片必须按 ref、part 顺序无损拼接理解。提取供请求 B 建立世界状态的紧凑证据，保留事实、规则、例外、人物、地点、关系、时间顺序、知识边界、任务、事件、因果、当前场景和不确定性。sourceRefs 必须覆盖输入中的每个 ref；相同事实合并，每条证据只写一句短句，不复述文风、对白或长段原文，整个 JSON 尽量控制在 7000 字内。不得省略较早资料，不得创造原文没有的内容，不要输出思考过程。只输出严格 JSON：{"evidence":{"sourceRefs":[],"canon":[],"chronology":[],"characters":[],"relationships":[],"knowledge":[],"locations":[],"tasks":[],"events":[],"causal":[],"currentScene":[],"uncertainties":[]}}。';
    const FINAL_EVIDENCE_PROMPT = '你是第二段资料读取与证据合并器，不是故事续写者。firstHalfEvidence 是请求 A 已完整读取前半原文得到的证据，sourceRecords 是全部后半原文；必须逐条读取后半并与前半证据合并，覆盖事实、规则、例外、人物、地点、关系、时间顺序、知识边界、任务、事件、因果、当前场景和不确定性。evidence 内必须首先输出 canon；canon[0] 必须是1000字以内、覆盖后半全部资料并综合前半证据的核心连续性摘要，随后才输出 sourceRefs、currentScene、chronology、characters、relationships、knowledge、locations、tasks、events、causal、uncertainties。sourceRefs 必须覆盖 firstHalfEvidence 已有来源与后半每个 ref；相同事实合并，每项只写一句短句，不复述文风、对白或长原文，不创造内容，不输出思考。整个 JSON 尽量控制在 7000 字内，只输出闭合严格 JSON：{"evidence":{"canon":[],"sourceRefs":[],"currentScene":[],"chronology":[],"characters":[],"relationships":[],"knowledge":[],"locations":[],"tasks":[],"events":[],"causal":[],"uncertainties":[]}}。';
    const INITIAL_STATE_PROMPT = '你是世界状态初始化器，不是故事续写者。严格依据输入的原文、firstHalfEvidence、可选 currentState 和 stateShape 建立此刻已经成立的持久世界状态。必须综合所有来源，但只把有来源且会影响连续性的事实写入 state；相同事实合并，数组项目使用短句，禁止复述长段原文、预演未来、创造设定或输出思考过程。输出紧凑状态补丁：可以省略空数组、空字符串、默认值、runtime、planner、revision、updatedAt、schemaVersion、initialized、lockedPaths，以及与 currentState 完全相同的字段；程序会在本地把省略项与默认状态或 currentState 递归合并。需要清除已有数组时必须显式输出空数组。state 内必须首先输出 world；world.facts 的第一项必须是800字以内、综合全部资料的核心连续性摘要，然后依次输出 identities、characters、relationships、knowledge、map、tasks、events、causalEffects、timeline 等仍有内容的模块。这样即使尾部达到服务上限，核心资料也已经完整落在闭合模块中。把同类细节合并，不要为每条资料复制一个状态项，不要在输出前进行长篇分析，整个 JSON 严格控制在 2200 个中文字符以内。只输出一个闭合的严格 JSON：{"state":{}}，不要输出 plan、moduleInjections、injection、Markdown 或第二个 JSON。';
    function losslessParts(value, limit = COMPLETE_SOURCE_PART_CHARS) {
        const input = String(value ?? '');
        if (!input) return [''];
        const parts = [];
        for (let start = 0; start < input.length; start += limit) parts.push(input.slice(start, start + limit));
        return parts;
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
        const serialized = JSON.stringify(source);
        const worldbookEntries = (source?.worldbooks || []).reduce((sum, book) => sum + (book.entries || []).length, 0);
        const large = serialized.length > 50000 || worldbookEntries > 200;
        if (!large) return { source, large: false, originalChars: serialized.length, includedChars: serialized.length, worldbookEntries, records: 1 };
        const records = completeSourceRecords(source);
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
        const deduplicatedSecond = removeMirroredChatRecords(source, halves[1]);
        halves[1] = deduplicatedSecond.records;
        const halfChars = halves.map((half) => JSON.stringify(half).length);
        const oversized = halfChars.findIndex((length) => length > MAX_COMPLETE_HALF_CHARS);
        if (oversized >= 0) {
            throw new Error(`资料共有 ${serialized.length} 字；第 ${oversized + 1}/2 半为 ${halfChars[oversized]} 字，超过两次请求完整读取的单次安全容量 ${MAX_COMPLETE_HALF_CHARS} 字。为避免漏读和额外扣费，本次尚未调用 API；请减少所选资料。插件不会擅自发起第三次请求。`);
        }
        return {
            source: null, halves, large: true, originalChars: serialized.length,
            includedChars: serialized.length, halfChars, worldbookEntries, records: records.length,
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
            records: prepared?.halves?.[0] || [], prompt: SOURCE_READ_PROMPT,
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
    function normalizeStateResult(result, baseState = null) {
        const envelopes = [result, result?.result, result?.data, result?.output].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
        const wrapped = envelopes.find((item) => item.state && typeof item.state === 'object' && !Array.isArray(item.state));
        if (wrapped) return { ...wrapped, state: mergeStatePatch(baseState || WSM.Defaults.createState(), wrapped.state) };
        const stateKeys = Object.keys(WSM.Defaults?.STATE_SCHEMA || {});
        const rootKeyCount = stateKeys.reduce((count, key) => count + (Object.prototype.hasOwnProperty.call(result || {}, key) ? 1 : 0), 0);
        return rootKeyCount >= 3 ? { state: mergeStatePatch(baseState || WSM.Defaults.createState(), result), plan: {}, moduleInjections: {} } : result;
    }
    const EVIDENCE_KEYS = ['sourceRefs','canon','chronology','characters','relationships','knowledge','locations','tasks','events','causal','currentScene','uncertainties'];
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
        const mapped = (items, prefix, factory) => items.map((item, index) => {
            const text = evidenceItemText(item);
            return factory(objectItem(item), text, `${prefix}-${hash(`${index}:${text}`)}`);
        }).filter(Boolean);
        const canon = evidence.canon.map(evidenceItemText).filter(Boolean);
        const scene = evidence.currentScene.map(evidenceItemText).filter(Boolean);
        state.world.facts = [...new Set([...canon, ...scene])];
        const latestScene = evidence.currentScene.at(-1);
        const latestSceneObject = objectItem(latestScene);
        state.world.location.current = safeText(latestSceneObject.location || latestSceneObject.place || latestSceneObject.currentLocation || state.world.location.current);
        state.world.location.environment = safeText(latestSceneObject.environment || latestSceneObject.summary || evidenceItemText(latestScene) || state.world.location.environment);
        const latestChronology = objectItem(evidence.chronology.at(-1));
        const latestChronologyText = evidenceItemText(evidence.chronology.at(-1));
        state.world.time.display = safeText(latestChronology.time || latestChronology.date || latestChronology.display || state.world.time.display || latestChronologyText.slice(0, 100));
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
        state.characters = [...charactersByName.values()];
        state.relationships = mapped(evidence.relationships, 'relationship', (item, text, id) => ({ ...item, id: safeText(item.id || id), summary: safeText(item.summary || item.description || text) }));
        state.knowledge = mapped([...evidence.knowledge, ...evidence.uncertainties], 'knowledge', (item, text, id) => ({
            ...item, id: safeText(item.id || id), information: safeText(item.information || item.summary || text),
            status: safeText(item.status || (evidence.uncertainties.includes(item) ? 'Suspected' : 'Known')),
        }));
        state.map.locations = mapped(evidence.locations, 'location', (item, text, id) => ({
            ...item, id: safeText(item.id || id), name: safeText(item.name || item.location || item.place || text.slice(0, 100)),
            description: safeText(item.description || item.summary || text), parentId: safeText(item.parentId), sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
        }));
        state.tasks = mapped(evidence.tasks, 'task', (item, text, id) => ({ ...item, id: safeText(item.id || id), title: safeText(item.title || item.name || text.slice(0, 100)), description: safeText(item.description || item.summary || text), status: safeText(item.status || 'active'), choices: Array.isArray(item.choices) ? item.choices : [] }));
        state.events = mapped(evidence.events, 'event', (item, text, id) => ({ ...item, id: safeText(item.id || id), summary: safeText(item.summary || item.description || text), status: safeText(item.status || 'active') }));
        state.causalEffects = mapped(evidence.causal, 'causal', (item, text, id) => ({ ...item, id: safeText(item.id || id), cause: safeText(item.cause || text), result: safeText(item.result || item.effect || text), status: safeText(item.status || 'developing'), steps: Array.isArray(item.steps) ? item.steps : [], affectedIds: Array.isArray(item.affectedIds) ? item.affectedIds : [], evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [] }));
        state.timeline = mapped(evidence.chronology, 'timeline', (item, text, id) => ({ ...item, id: safeText(item.id || id), summary: safeText(item.summary || item.description || text) }));
        return { state, plan: {}, moduleInjections: {}, evidence };
    }
    async function buildStateWithinLimit(plannerPrompt, payload, _baseState, settings, signal, prepared) {
        if (!prepared?.large) {
            const direct = await WSM.Api.complete(INITIAL_STATE_PROMPT, payload, { maxTokens: 5000, singleAttempt: true, signal, jsonContract: 'state' });
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
                SOURCE_READ_PROMPT,
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
        const finalInputChars = JSON.stringify(finalPayload).length + FINAL_EVIDENCE_PROMPT.length;
        reportProgress('正在分批读取全部资料', 'running', `原文分片 ${fragments[0] + 1}–${totalFragments}/${totalFragments} · 请求 B 读取并合并证据 · API ${apiOrdinal}/2 · 携带请求 A 全部证据 · 约 ${finalInputChars} 字`);
        const finalResult = await WSM.Api.complete(
            FINAL_EVIDENCE_PROMPT,
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
        { id: 'foundation', label: '世界与地图', keys: ['identities','world','map','timeline'], maxTokens: 4000 },
        { id: 'people', label: '人物与知识', keys: ['characters','npcActivities','relationships','knowledge'], maxTokens: 6500 },
        { id: 'affairs', label: '任务与事件', keys: ['tasks','events','triggers','threads'], maxTokens: 4500 },
        { id: 'dynamics', label: '进程与因果', keys: ['processes','causalEffects'], maxTokens: 4000 },
    ];
    function stateReference(state) {
        return {
            identities: state.identities,
            world: state.world,
            characters: (state.characters || []).map((item) => ({ id: item.id, name: item.name })),
            tasks: (state.tasks || []).map((item) => ({ id: item.id, title: item.title })),
            events: (state.events || []).map((item) => ({ id: item.id, title: item.title })),
        };
    }
    const SLICE_EVIDENCE_FIELDS = {
        foundation: ['sourceRefs','canon','chronology','locations','currentScene','uncertainties'],
        people: ['sourceRefs','characters','relationships','knowledge','currentScene','uncertainties'],
        affairs: ['sourceRefs','chronology','tasks','currentScene'],
        dynamics: ['sourceRefs','chronology','tasks','uncertainties'],
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
                    `你是世界状态初始化器，本次只建立“${slice.label}”切片。source 已由前序分片模型完整读取，sourceDigest 中每一项都必须综合使用。只能记录来源中已经存在或正文已经发生的事实，不得续写、推测成真或创造设定。严格遵守 ownership，只返回 JSON：{"state":{本切片字段}}；不得返回其他状态字段、plan、Markdown 或解释。`,
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
            const localPlan = {
                ...(diceRound ? { diceRound } : {}),
                notes: ['省额度模式：生成前使用最近一次已结算状态；正文完成后以一次 API 请求统一更新全部栏目。'],
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
        });
        throwIfCancelled(signal);
        // Preserve a local snapshot before selected worldbook originals are
        // removed from `source`. Large-source detection must use the true input
        // size; otherwise thousands of entries look deceptively small after
        // local routing and get forced into one oversized final request.
        const completeSourceSnapshot = initializing || refreshWorld ? JSON.parse(JSON.stringify(source)) : null;
        if (initializing || refreshWorld) {
            const preview = summarizeSource(source);
            reportProgress('第 2/3 步：本地资料收集完成，正在整理世界书', 'running', `模型尚未开始读取 · 正文 ${preview.chatMessages}/${preview.chatTotalMessages} 条 · 世界书 ${preview.loadedWorldbooks.length} 本 · 读取失败 ${preview.failedWorldbooks.length} 本`);
        }
        const fingerprint = WSM.Context.sourceFingerprint(source);
        let compilerResult;
        try {
            // Reading/rebuilding owns a two-call budget. Worldbook extraction is
            // local here and is folded into the same final state request rather
            // than spending a separate call per entry or route.
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
                prepared = prepareSourceForStateRequests(completeSourceSnapshot, { plannerPrompt, payload });
                payload.source = prepared.source;
                sourceSummary.sourceRead = {
                    mode: prepared.large ? 'two-complete-halves' : 'direct-complete',
                    chunked: true,
                    chunks: prepared.large ? 2 : 1, requestAttempts: 0, cacheHits: 0,
                    originalChars: prepared.originalChars, includedChars: prepared.includedChars,
                    halfChars: prepared.halfChars || [], records: prepared.records,
                };
            }
            if (initializing || refreshWorld) reportProgress('本地资料已就绪，正在发送给模型读取', 'running', prepared?.large
                ? `尚未完成模型读取 · 将用 2 次 API 无遗漏覆盖 ${prepared.records} 项、${prepared.originalChars} 字资料`
                : `尚未完成模型读取 · 正在用唯一一次 API 读取 ${prepared.originalChars} 字资料并建立状态`);
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
            await setStatePrompts(next, next.planner.plan || {}, next.planner.moduleInjections || {});
            if (initializing || refreshWorld) reportProgress('读取并初始化完成', 'success', `已建立 REV ${next.revision} · 世界书 ${sourceSummary.loadedWorldbooks.length} 本 · 正文 ${sourceSummary.chatMessages} 条`);
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
        const previousIds = new Set((previous?.triggers || []).map((item) => safeText(item?.id)).filter(Boolean));
        const triggeredThisRound = (next.triggers || []).some((item) => item?.status === 'triggered' && previousIds.has(safeText(item?.id)));
        const active = (next.triggers || []).filter((item) => !['triggered','expired'].includes(item?.status));
        // When none of the prior candidates fired, carrying their IDs forward
        // would turn a per-turn choice pool into permanent state. Keep only
        // genuinely fresh candidates returned for the next turn.
        next.triggers = triggeredThisRound ? active : active.filter((item) => !previousIds.has(safeText(item?.id)));
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
            worldbookRules: worldbookReport?.entries || [],
            stateSchema: WSM.Defaults.STATE_SCHEMA,
            moduleOwnership: WSM.Defaults.MODULE_OWNERSHIP,
            modulePrompts: settings.modulePrompts || WSM.Defaults.MODULE_PROMPTS,
            lockedPaths: current.lockedPaths || [],
        };
        try {
            const result = await WSM.Api.complete(`${settings.reconcilerPrompt}\n\n本次结算必须在同一个 JSON 响应内同时完成普通状态与世界书浓缩缓存更新。除既有 state、timelineEntry、actualChanges 字段外，返回 worldbookEntries 数组；每项沿用输入 worldbookRules 的 key，并只依据本轮 user/assistant 实际正文修正 core、triggers、rules、background。没有变化的条目可省略，禁止创造世界书原文不存在的新规则。不得要求第二次调用。`, payload, { singleAttempt: true });
            if (!result?.state || typeof result.state !== 'object') throw new Error('结算响应缺少 state');
            let next = WSM.Storage.enforceLocks(current, result.state);
            next = syncIdentities(next, current.identities);
            next = rotateTriggersForNextTurn(current, next);
            next.initialized = true;
            next.planner = current.planner;
            const worldbookUpdate = WSM.WorldbookCompiler?.ingestReadResult?.(settleSource, result);
            next.runtime = Object.assign({}, current.runtime, next.runtime, {
                lastSettledMessageId: key,
                worldbookInjection: worldbookUpdate?.report || current.runtime?.worldbookInjection || null,
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
    WSM.Engine = { init, plan: ensurePlan, settle: ensureSettle, interceptor, fallbackInjection, reportProgress, getProgress, cancelRead, isReading, syncRegisteredPrompt, _test: { generationBlockReason, plannerAvailable, activeChatAvailable, setPrompt, setStatePrompts, syncRegisteredPrompt, initializeInSlices, sourceForInitializeSlice, rotateTriggersForNextTurn, completeSourceRecords, splitCompleteRecords, removeMirroredChatRecords, prepareSourceForStateRequests, buildStateWithinLimit, normalizeStateResult, mergeStatePatch, mergeCompleteEvidence, stateFromEvidence, firstHalfCacheKey } };
})();
