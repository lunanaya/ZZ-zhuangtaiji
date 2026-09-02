(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

    const text = (value) => String(value ?? '').trim();
    const jsonLength = (value) => JSON.stringify(value).length;
    function cancellationError() { return Object.assign(new Error('用户已终止读取'), { name: 'AbortError' }); }
    function throwIfCancelled(signal) { if (signal?.aborted) throw cancellationError(); }
    const CACHE_KEY = 'wsm_source_reader_digest_cache_v1';
    const CHUNK_PROMPT = `你是资料分片读取器，不是故事续写者。逐项读取 sourceChunk 中的原始资料，提取可供世界状态初始化使用的证据。不得增加原文不存在的设定，不得把角色主张或猜测升级为客观事实。保留姓名、身份、时间顺序、地点、关系、知识边界、任务、伤势、物品、规则、例外和当前场景；还要分别提取当前真正限制行动的资金/权限/人手/关键物品/封锁resourceConstraints、NPC后台实际活动npcActivities、等待条件的可触发事件triggers、围绕用户的长期未决线threads、世界自行演变的processes以及已发生的重要timeline。地点只作为空间实体，按国家→城市→城市地标/城区→建筑→室内空间给出稳定id和parentId，国家是第一层；资料没有明确中间层时可跳过但不得补造。description只写空间用途，origin只写一句首次建立原因，不得把完整事件或剧情意义写入地点。每条结论附带 truthStatus、basis、sourceRefs：原文/设定明确为confirmed；可复算推导为derived；有线索但未确认只能suspected；读不到为failed。人物身份、关系、秘密/知识、规则、任务、权限和命名地点不得system_generated；无证据时写入uncertainties，不得硬补。只输出严格 JSON：{"digest":{"sourceRefs":[],"canon":[],"chronology":[],"timeline":[],"resourceConstraints":[],"characters":[],"npcActivities":[],"relationships":[],"knowledge":[],"locations":[],"tasks":[],"events":[],"triggers":[],"threads":[],"processes":[],"causal":[],"currentScene":[],"uncertainties":[]}}。内容应紧凑但不能因为资料较早就忽略。`;
    const MERGE_PROMPT = `你是资料证据合并器。合并 digestBatch 中已经逐片读取的证据，去重但不得丢失仍有效的事实、规则、例外、时间顺序、资源与硬约束、人物关系、知识边界、任务、NPC活动、触发事件、长期线程、世界进程、时间线和来源引用。可把同一事项的多条证据合写为一条并保留全部关键 sourceRefs；冲突内容并存并放入 uncertainties，不得自行裁决或续写。若提供 targetChars，应尽量把 JSON 控制在该字符数内。只输出严格 JSON：{"digest":{"sourceRefs":[],"canon":[],"chronology":[],"timeline":[],"resourceConstraints":[],"characters":[],"npcActivities":[],"relationships":[],"knowledge":[],"locations":[],"tasks":[],"events":[],"triggers":[],"threads":[],"processes":[],"causal":[],"currentScene":[],"uncertainties":[]}}。`;
    const PHANTASM_COVERAGE_PROMPT = `\n\n[PHANTASM COVERAGE SCAN]\n必须检查worldRules、organizations、characters、npcActivities、relationships、knowledge、schedules、tasks、events、triggers、threads、processes、causalEffects、timeline全部模块。organizations保存有来源的组织职责、权限、资源与处境；schedules只保存明确承诺、约定、预约、命令或日期安排。characters每个核心/相关具名人物必须有结构化identity、location、situation；未知字段留空但人物不得消失。npcActivities的characterId必须引用已识别人物且只能是离屏活动，台词、代词、称谓、动作短语不能当姓名。relationships逐方向from→to，身份关系和当前认知分开。currentScene只保存地点、在场者、当前问题、已完成/待回应动作、阻碍、交互点与结束条件。每个模块必须给出moduleCoverage状态和moduleDecisions结论；读取失败写retrieval_failed，不得伪装成空。`;
    const CALIBRATION_REQUEST_MAX_CHARS = 60000;
    const CALIBRATION_ENVELOPE_RESERVE_CHARS = 4000;
    const CALIBRATION_OVERLAP_MESSAGES = 2;
    const CALIBRATION_PROMPT_VERSION = 5;
    const CALIBRATION_PROMPT = `你是历史状态校准器，不是故事续写者，也不是剧情摘要器。sourceChunk 是完整资料校准中的一个有界分块；chat 记录按原始楼层顺序排列，邻块可能重叠。你只记录这一块造成的“状态变化”，不得概括剧情、复述普通对白、修辞、动作细节、短暂情绪、饮食、姿势、衣物或无长期影响的日常过程。

必须识别：新建立、被覆盖、被纠正或失效的事实；时间与地点变化；人物当前状态和持续伤势；关系变化；谁知道/相信/怀疑/误解了什么；任务建立/推进/完成；重要物品与权限转移；不可逆事件；触发器、线程、世界进程和持续因果。世界书/角色卡/Persona属于参考资料，只建立规则、身份和知识边界，不冒充聊天中已经发生的变化。

每条 change 必须包含稳定 factId、module、operation(upsert/remove)、entityId、value、sourceRefs；value 必须带 truthStatus、basis、sourceRefs。sourceRefs 必须引用实际 ref，例如 chat:801 或 worldbook:书名:条目；不得凭空补来源。confirmed必须有来源，derived必须有可复算依据，suspected/assumed不得升级为事实，failed表示读取失败。人物身份、关系、秘密/知识、世界规则、任务、权限和命名地点不得system_generated；L3不得使用suspected、assumed或system_generated。当前型资料只输出本块结束时的新版本。冲突不能自行圆回来，写入 conflicts。若块中出现已有小摘要，则逐项交叉检查：原文确认=confirmed，摘要独有但本块找不到原文=summary_only，原文有而摘要漏写=missing_from_summary，互相冲突=conflict。只在确有可比摘要时输出 summaryChecks。

完整读取 sourceChunk 中全部记录。不要为每个正常楼层重复输出一条回执：程序会根据完整块和 changes 的 sourceRefs 在本地补齐逐楼层状态。只有确实无法读取的 chat 楼层才把 id 放入 readFailedMessageIds；全部读完时必须明确返回空数组。允许 changes 为空。complete:true 必须是 evidence 的最后一个字段，只有读完本块并闭合前面所有数组后才能写出；禁止提前写。只输出一个闭合严格 JSON 对象，禁止按楼层输出多个 JSON：{"evidence":{"chunkStatus":"changes或no_long_term_change","readFailedMessageIds":[],"changes":[{"factId":"","module":"world|worldRules|factAnchors|resourceConstraints|organizations|characters|npcActivities|relationships|knowledge|schedules|locations|tasks|events|triggers|threads|progression|processes|causalEffects|timeline","operation":"upsert","entityId":"","value":{"truthStatus":"confirmed","basis":[],"sourceRefs":[]},"sourceRefs":[]}],"conflicts":[],"summaryChecks":[],"complete":true}}。`;

    function hash(value) {
        const input = String(value || '');
        let result = 2166136261;
        for (let index = 0; index < input.length; index += 1) result = Math.imul(result ^ input.charCodeAt(index), 16777619);
        return `${input.length.toString(36)}-${(result >>> 0).toString(36)}`;
    }
    function loadCache() {
        if (typeof localStorage === 'undefined') return {};
        try {
            const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (_error) { return {}; }
    }
    function saveCache(cache) {
        if (typeof localStorage === 'undefined') return;
        try {
            const recent = Object.entries(cache).sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 200);
            localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(recent)));
        } catch (error) { console.debug('[WorldStateMachine] 无法保存资料读取缓存', error); }
    }

    function splitText(value, limit) {
        const input = text(value);
        if (!input) return [];
        if (input.length <= limit) return [input];
        const parts = [];
        let rest = input;
        while (rest.length > limit) {
            let cut = Math.max(rest.lastIndexOf('\n', limit), rest.lastIndexOf('。', limit), rest.lastIndexOf('！', limit), rest.lastIndexOf('？', limit));
            if (cut < Math.floor(limit * 0.45)) cut = limit;
            else cut += 1;
            parts.push(rest.slice(0, cut));
            rest = rest.slice(cut);
        }
        if (rest) parts.push(rest);
        return parts;
    }

    function addTextRecords(records, base, value, partLimit) {
        const parts = splitText(value, partLimit);
        parts.forEach((content, index) => records.push({
            ...base,
            part: parts.length > 1 ? index + 1 : undefined,
            parts: parts.length > 1 ? parts.length : undefined,
            content,
        }));
    }

    function sourceRecords(source, partLimit = 12000) {
        const records = [];
        records.push({ ref: 'identities', kind: 'identities', data: source.identities || {} });
        Object.entries(source.character || {}).forEach(([field, value]) => addTextRecords(records, {
            ref: `character.${field}`, kind: 'character-card', field,
        }, value, partLimit));
        addTextRecords(records, { ref: 'persona', kind: 'persona' }, source.persona, partLimit);
        (source.worldbooks || []).forEach((book, bookIndex) => (book.entries || []).forEach((entry, entryIndex) => {
            addTextRecords(records, {
                ref: `worldbook:${book.name || bookIndex}:${entry.id || entryIndex}`,
                kind: 'worldbook', book: book.name || '', title: entry.comment || '', keys: entry.keys || [], depth: entry.depth,
            }, entry.content, partLimit);
        }));
        if (source.compiledWorldbookRules) records.push({ ref: 'compiledWorldbookRules', kind: 'compiled-worldbook-rules', data: source.compiledWorldbookRules });
        (source.chat || []).forEach((message, index) => addTextRecords(records, {
            ref: `chat:${message.id || index}`, kind: 'chat', index, id: message.id || '', role: message.role || '', name: message.name || '',
            hidden: message.hidden === true, timestamp: message.timestamp || '', contentHash: hash(message.content || ''),
        }, message.content, partLimit));
        return records;
    }

    function pack(values, limit) {
        const groups = [];
        let group = [];
        let length = 2;
        values.forEach((value) => {
            const itemLength = jsonLength(value) + 1;
            if (group.length && length + itemLength > limit) {
                groups.push(group);
                group = [];
                length = 2;
            }
            group.push(value);
            length += itemLength;
        });
        if (group.length) groups.push(group);
        return groups;
    }

    function calibrationSourceBudget(options = {}) {
        const configuredLimit = Number(options.requestMaxChars
            || options.chunkChars
            || WSM.Settings?.get?.().maxSourceChars
            || CALIBRATION_REQUEST_MAX_CHARS);
        const requestMaxChars = Math.max(15000, Math.min(240000, Number.isFinite(configuredLimit) ? configuredLimit : CALIBRATION_REQUEST_MAX_CHARS));
        // Keep the source close to the configured request ceiling while leaving
        // deterministic room for the task envelope and per-record JSON syntax.
        // Explicit chunkChars remains an exact source budget for tests and
        // callers that already accounted for that overhead.
        return options.chunkChars
            ? requestMaxChars
            : Math.max(15000, requestMaxChars - CALIBRATION_ENVELOPE_RESERVE_CHARS);
    }

    function digestValue(result) {
        const digest = result?.digest ?? result;
        if (!digest || typeof digest !== 'object') throw new Error('分片读取结果缺少 digest');
        return digest;
    }

    function splitFailedChunk(chunk, minimumChars = 1200) {
        if (chunk.length > 1) {
            const middle = Math.ceil(chunk.length / 2);
            return [chunk.slice(0, middle), chunk.slice(middle)];
        }
        const record = chunk[0];
        if (!record) return null;
        let field = 'content';
        let value = typeof record.content === 'string' ? record.content : '';
        if (!value && record.data && typeof record.data === 'object') {
            field = 'data';
            value = JSON.stringify(record.data);
        }
        if (value.length <= minimumChars) return null;
        const parts = splitText(value, Math.max(minimumChars, Math.ceil(value.length / 2)));
        if (parts.length < 2) return null;
        return parts.map((content, index) => [{
            ...record,
            ...(field === 'data' ? { data: undefined, content, serializedField: 'data' } : { content }),
            adaptivePart: index + 1,
            adaptiveParts: parts.length,
        }]);
    }

    function calibrationChunkKey(chunk) {
        return `chunk:${hash(JSON.stringify({ version: CALIBRATION_PROMPT_VERSION, kind: chunk.kind, records: chunk.records }))}`;
    }

    function expandPreviouslyFailedCalibrationChunks(chunks, memory, depth = 0) {
        if (!memory?.chunks || depth > 8) return chunks;
        return (chunks || []).flatMap((chunk) => {
            const previous = memory.chunks[calibrationChunkKey(chunk)];
            const parts = splitFailedChunk(chunk.records, 1200);
            if (!parts?.length || previous?.status === 'processed') return [chunk];
            const partChunks = parts.map((records) => ({ kind: chunk.kind, records }));
            // A failed parent may have been pruned by an older begin-calibration
            // pass. Existing child history is therefore also a durable signal
            // that this exact parent must remain split on every later resume.
            const hasChildHistory = partChunks.some((part) => memory.chunks[calibrationChunkKey(part)]);
            if (previous?.status !== 'failed' && !hasChildHistory) return [chunk];
            return expandPreviouslyFailedCalibrationChunks(
                partChunks, memory, depth + 1,
            );
        });
    }

    function messageManifest(source) {
        return Object.fromEntries((source?.chat || []).map((message, index) => {
            const id = text(message?.id ?? index);
            return [id, {
                id,
                index: Number.isFinite(Number(message?.index)) ? Number(message.index) : index,
                role: text(message?.role),
                hidden: message?.hidden === true,
                contentHash: hash(message?.content || ''),
                processed: false,
                changeIds: [],
            }];
        }));
    }

    function packWithMessageOverlap(records, limit = CALIBRATION_CHUNK_CHARS, overlapMessages = CALIBRATION_OVERLAP_MESSAGES) {
        const chunks = [];
        let chunk = [];
        let length = 2;
        const overlapTail = (values) => {
            const refs = [];
            for (let index = values.length - 1; index >= 0 && refs.length < overlapMessages; index -= 1) {
                const ref = text(values[index]?.ref);
                if (ref && !refs.includes(ref)) refs.unshift(ref);
            }
            const selected = new Set(refs);
            return values.filter((item) => selected.has(text(item?.ref)));
        };
        (records || []).forEach((record) => {
            const itemLength = jsonLength(record) + 1;
            if (chunk.length && length + itemLength > limit) {
                chunks.push(chunk);
                chunk = overlapTail(chunk);
                length = jsonLength(chunk) + 1;
                // A very large multipart floor must still make progress even if
                // its overlap alone fills the next block.
                if (chunk.length && length + itemLength > limit && chunk.some((item) => item.ref === record.ref)) {
                    chunk = [];
                    length = 2;
                }
            }
            chunk.push(record);
            length += itemLength;
        });
        if (chunk.length) chunks.push(chunk);
        return chunks;
    }

    function calibrationChunks(source, options = {}) {
        const chunkChars = calibrationSourceBudget(options);
        // Only split a record when its serialized form cannot fit in one
        // request. The old 55%/14k pre-split created many tiny multipart
        // records before packing and was the main source of very high block
        // counts. This larger split is lossless and deterministic.
        const partChars = Math.max(6000, chunkChars - 1200);
        const records = sourceRecords(source, partChars);
        const referenceRecords = records.filter((record) => record.kind !== 'chat');
        const chatRecords = records.filter((record) => record.kind === 'chat');
        const referenceChunks = pack(referenceRecords, chunkChars).map((values) => ({ kind: 'reference', records: values }));
        const chatChunks = packWithMessageOverlap(chatRecords, chunkChars, Math.max(1, Number(options.overlapMessages || CALIBRATION_OVERLAP_MESSAGES)))
            .map((values) => ({ kind: 'chat', records: values }));
        return [...referenceChunks, ...chatChunks];
    }

    function normalizeCalibrationResult(result, chunk, chunkKey) {
        const body = result?.evidence ?? result?.chunkResult ?? result?.result ?? result ?? {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('校准分块结果缺少 evidence');
        if (body.complete !== true || Object.keys(body).at(-1) !== 'complete') throw new Error('校准分块没有返回位于末尾的 complete:true，不能把截断输出误记为已读完');
        const sourceRefs = [...new Set((chunk.records || []).map((record) => text(record.ref)).filter(Boolean))];
        const chatIds = [...new Set(sourceRefs.filter((ref) => ref.startsWith('chat:')).map((ref) => ref.slice(5)))];
        const changes = (Array.isArray(body.changes) ? body.changes : []).filter((item) => item && typeof item === 'object').map((item, index) => {
            const refs = Array.isArray(item.sourceRefs) ? item.sourceRefs.map(text).filter(Boolean) : [];
            const fingerprint = JSON.stringify({
                factId: item.factId, module: item.module, operation: item.operation,
                entityId: item.entityId, value: item.value, sourceRefs: refs,
            });
            return {
                ...item,
                // factId identifies the fact across revisions; changeId identifies
                // this specific transition.  Never collapse a later correction
                // merely because it updates the same factId.
                changeId: text(item.changeId) || `change-${hash(fingerprint)}`,
                factId: text(item.factId),
                module: text(item.module),
                operation: ['remove','delete','archive'].includes(text(item.operation).toLowerCase()) ? 'remove' : 'upsert',
                entityId: text(item.entityId || item.id || item.factId),
                value: item.value && typeof item.value === 'object'
                    ? { ...item.value, factId: text(item.factId || item.value.factId) }
                    : (item.value == null ? { factId: text(item.factId) } : { summary: text(item.value), factId: text(item.factId) }),
                sourceRefs: refs,
                origin: refs.some((ref) => ref.startsWith('chat:')) ? 'chat' : chunk.kind,
            };
        });
        const changeIdsByMessage = new Map(chatIds.map((id) => [id, []]));
        changes.forEach((change) => (change.sourceRefs || []).forEach((ref) => {
            if (!ref.startsWith('chat:')) return;
            const id = ref.slice(5);
            if (!changeIdsByMessage.has(id)) changeIdsByMessage.set(id, []);
            changeIdsByMessage.get(id).push(change.changeId);
        }));
        const legacyMessageResults = Array.isArray(body.messageResults) ? body.messageResults : null;
        const returned = new Map((legacyMessageResults || []).map((item) => [text(item?.messageId).replace(/^chat:/, ''), item]));
        const hasCompactReceipt = Array.isArray(body.readFailedMessageIds);
        const missingMessageIds = legacyMessageResults ? chatIds.filter((messageId) => !returned.has(messageId)) : [];
        if (!hasCompactReceipt && missingMessageIds.length) throw new Error(`校准分块漏报 ${missingMessageIds.length} 个聊天楼层：${missingMessageIds.slice(0, 6).join('、')}`);
        if (!hasCompactReceipt && !legacyMessageResults && chatIds.length) throw new Error('校准分块缺少 readFailedMessageIds 完整读取回执');
        const failedIds = new Set((hasCompactReceipt ? body.readFailedMessageIds : [])
            .map((value) => text(value).replace(/^chat:/, '')).filter(Boolean));
        const messageResults = chatIds.map((messageId) => {
            const item = returned.get(messageId) || {};
            const changeIds = [...new Set([...(Array.isArray(item.changeIds) ? item.changeIds.map(text) : []), ...(changeIdsByMessage.get(messageId) || [])].filter(Boolean))];
            const requested = text(item.status).toLowerCase();
            const status = failedIds.has(messageId) || requested === 'read_failed'
                ? 'read_failed'
                : (changeIds.length || requested === 'changes' ? 'changes' : 'no_long_term_change');
            return { messageId, status, changeIds };
        });
        const legacyEvidence = Object.fromEntries(Object.entries(body).filter(([key, value]) => !['chunkStatus','messageResults','readFailedMessageIds','changes','conflicts','summaryChecks','complete'].includes(key) && (Array.isArray(value) || (value && typeof value === 'object'))));
        return {
            chunkStatus: changes.length ? 'changes' : 'no_long_term_change',
            messageResults,
            changes,
            conflicts: Array.isArray(body.conflicts) ? body.conflicts : [],
            summaryChecks: Array.isArray(body.summaryChecks) ? body.summaryChecks : [],
            legacyEvidence,
        };
    }

    const CHANGE_EVIDENCE_KEYS = {
        worldRules: 'worldRules', factAnchors: 'anchors', resourceConstraints: 'resourceConstraints', organizations: 'organizations', characters: 'characters', npcActivities: 'npcActivities',
        relationships: 'relationships', knowledge: 'knowledge', locations: 'locations', tasks: 'tasks', events: 'events', triggers: 'triggers',
        schedules: 'schedules', threads: 'threads', progression: 'progression', processes: 'processes', causalEffects: 'causal', timeline: 'timeline',
    };
    function evidenceFromChanges(changes) {
        const evidence = {};
        (changes || []).filter((change) => change.operation !== 'remove').forEach((change) => {
            const module = text(change.module);
            if (module === 'world') {
                const value = { ...(change.value || {}), sourceRefs: change.sourceRefs || [] };
                (evidence.currentScene ||= []).push(value);
                if (value.time || value.date || value.display) (evidence.chronology ||= []).push(value);
                return;
            }
            const key = CHANGE_EVIDENCE_KEYS[module];
            if (!key) return;
            const value = { ...(change.value || {}), id: change.entityId || change.value?.id, sourceRefs: change.sourceRefs || [] };
            (evidence[key] ||= []).push(value);
        });
        return evidence;
    }
    function mergeEvidence(...values) {
        const result = {};
        values.forEach((value) => Object.entries(value || {}).forEach(([key, items]) => {
            const array = Array.isArray(items) ? items : (items == null ? [] : [items]);
            (result[key] ||= []).push(...array);
        }));
        return result;
    }

    async function calibrate(source, options = {}) {
        if (!WSM.Storage?.beginHistoryCalibration) throw new Error('当前存储模块不支持带来源的历史校准');
        let chunks = calibrationChunks(source, options);
        const messages = messageManifest(source);
        const boundaryMessage = (source?.chat || []).at(-1) || null;
        const boundary = boundaryMessage ? { messageId: text(boundaryMessage.id), index: Number(boundaryMessage.index ?? (source.chat.length - 1)) } : null;
        const fingerprint = `cal-v${CALIBRATION_PROMPT_VERSION}:${hash(JSON.stringify({
            messages: Object.values(messages).map((item) => [item.id, item.contentHash, item.hidden]),
            references: chunks.filter((chunk) => chunk.kind === 'reference').flatMap((chunk) => chunk.records.map((record) => [record.ref, hash(JSON.stringify(record))])),
        }))}`;
        const previousMemory = WSM.Storage.loadHistoryMemory?.();
        if (previousMemory?.fingerprint === fingerprint) chunks = expandPreviouslyFailedCalibrationChunks(chunks, previousMemory);
        const maxChunks = Math.max(1, Math.floor(Number(options.maxChunks || 256)));
        if (chunks.length > maxChunks) throw new Error(`完整资料需要 ${chunks.length} 个校准块，超过单次手动操作的安全上限 ${maxChunks} 块；尚未调用 API。请先缩短单条超大资料或分阶段校准。`);
        const chunkKeys = chunks.map(calibrationChunkKey);
        await WSM.Storage.beginHistoryCalibration({ fingerprint, boundary, messages, chunkKeys });
        const results = new Array(chunks.length);
        let requestAttempts = 0;
        let cacheHits = 0;
        let completedChunks = 0;
        const concurrency = Math.max(1, Math.min(12, Math.round(Number(
            options.concurrency || WSM.Settings?.get?.().calibrationConcurrency || 8,
        ))));
        try {
            const pendingIndexes = [];
            for (let index = 0; index < chunks.length; index += 1) {
                throwIfCancelled(options.signal);
                const chunk = chunks[index];
                const chunkKey = chunkKeys[index];
                const sourceRefs = [...new Set(chunk.records.map((record) => text(record.ref)).filter(Boolean))];
                const uniqueMessageIds = [...new Set(sourceRefs.filter((ref) => ref.startsWith('chat:')).map((ref) => ref.slice(5)))];
                const cached = WSM.Storage.readHistoryCalibrationChunk(fingerprint, chunkKey);
                if (cached?.result) {
                    results[index] = cached.result;
                    cacheHits += 1;
                    completedChunks += 1;
                    options.onProgress?.({ stage: 'calibrate', current: completedChunks, chunkIndex: index + 1, total: chunks.length, kind: chunk.kind, cached: true, cacheHits, concurrency, uniqueMessageIds });
                    continue;
                }
                pendingIndexes.push(index);
            }
            let cursor = 0;
            let firstFailure = null;
            const worker = async () => {
                while (!firstFailure) {
                    throwIfCancelled(options.signal);
                    const position = cursor;
                    cursor += 1;
                    if (position >= pendingIndexes.length) return;
                    const index = pendingIndexes[position];
                    const chunk = chunks[index];
                    const chunkKey = chunkKeys[index];
                    const sourceRefs = [...new Set(chunk.records.map((record) => text(record.ref)).filter(Boolean))];
                    const uniqueMessageIds = [...new Set(sourceRefs.filter((ref) => ref.startsWith('chat:')).map((ref) => ref.slice(5)))];
                    options.onProgress?.({ stage: 'calibrate', current: completedChunks, chunkIndex: index + 1, total: chunks.length, kind: chunk.kind, cached: false, cacheHits, concurrency, uniqueMessageIds });
                    requestAttempts += 1;
                    try {
                        const response = await WSM.Api.complete(`${CALIBRATION_PROMPT}${PHANTASM_COVERAGE_PROMPT}`, {
                            task: 'HISTORY_CALIBRATION_CHUNK',
                            chunkIndex: index + 1,
                            chunkCount: chunks.length,
                            chunkKind: chunk.kind,
                            sourceChunk: chunk.records,
                        }, { maxTokens: 8000, singleAttempt: true, signal: options.signal, jsonContract: 'evidence' });
                        const normalized = normalizeCalibrationResult(response, chunk, chunkKey);
                        results[index] = normalized;
                        await WSM.Storage.writeHistoryCalibrationChunk(fingerprint, chunkKey, {
                            status: 'processed', kind: chunk.kind, index: index + 1, total: chunks.length,
                            sourceRefs, uniqueMessageIds, chars: jsonLength(chunk.records), result: normalized,
                        });
                        completedChunks += 1;
                        options.onProgress?.({ stage: 'calibrate', current: completedChunks, chunkIndex: index + 1, total: chunks.length, kind: chunk.kind, cached: false, cacheHits, concurrency, uniqueMessageIds });
                    } catch (error) {
                        if (error?.name !== 'AbortError' && !options.signal?.aborted) {
                            await WSM.Storage.writeHistoryCalibrationChunk(fingerprint, chunkKey, {
                                status: 'failed', kind: chunk.kind, index: index + 1, total: chunks.length,
                                sourceRefs, uniqueMessageIds, chars: jsonLength(chunk.records), error: text(error?.message || error),
                            });
                        }
                        firstFailure ||= { index, error };
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(concurrency, pendingIndexes.length) }, () => worker()));
            if (firstFailure) {
                if (firstFailure.error?.name === 'AbortError' || options.signal?.aborted) throw cancellationError();
                throw new Error(`历史校准块 ${firstFailure.index + 1}/${chunks.length} 读取失败，已记录失败状态；再次读取会复用成功块并只把该失败块确定性拆小：${text(firstFailure.error?.message || firstFailure.error)}`);
            }
        } catch (error) {
            const failedAudit = {
                totalReadableMessages: Object.keys(messages).length,
                processedMessages: [...new Set(results.flatMap((result) => result.messageResults || []).filter((item) => item.status !== 'read_failed').map((item) => item.messageId))].length,
                failedChunks: 1,
                hiddenIncluded: Object.values(messages).filter((item) => item.hidden).length,
                chunks: chunks.length,
            };
            await WSM.Storage.completeHistoryCalibration({ fingerprint, status: 'failed', audit: failedAudit, boundary });
            throw error;
        }
        const changes = [];
        const changeKeys = new Set();
        results.flatMap((result) => result.changes || []).forEach((change) => {
            const key = change.changeId || hash(JSON.stringify(change));
            if (changeKeys.has(key)) return;
            changeKeys.add(key);
            changes.push(change);
        });
        const ledger = changes.filter((change) => change.origin === 'chat' || (change.sourceRefs || []).some((ref) => ref.startsWith('chat:')));
        const conflicts = results.flatMap((result) => result.conflicts || []);
        const summaryChecks = results.flatMap((result) => result.summaryChecks || []);
        const statusByMessage = new Map();
        results.flatMap((result) => result.messageResults || []).forEach((item) => {
            const previous = statusByMessage.get(item.messageId);
            if (!previous || item.status === 'changes' || previous.status === 'read_failed') statusByMessage.set(item.messageId, item);
        });
        const changedMessages = new Set(ledger.flatMap((change) => change.sourceRefs || []).filter((ref) => ref.startsWith('chat:')).map((ref) => ref.slice(5)));
        const failedMessages = [...statusByMessage.values()].filter((item) => item.status === 'read_failed').length;
        const audit = {
            totalReadableMessages: Object.keys(messages).length,
            processedMessages: [...statusByMessage.values()].filter((item) => item.status !== 'read_failed').length,
            failedMessages,
            failedChunks: 0,
            hiddenIncluded: Object.values(messages).filter((item) => item.hidden).length,
            changedMessages: changedMessages.size,
            noLongTermChangeMessages: Math.max(0, Object.keys(messages).length - changedMessages.size - failedMessages),
            summaryOmissions: summaryChecks.filter((item) => item?.status === 'missing_from_summary').length,
            summaryConflicts: summaryChecks.filter((item) => item?.status === 'conflict').length,
            sourceLessChanges: changes.filter((change) => !change.sourceRefs?.length).length,
            chunks: chunks.length,
            referenceChunks: chunks.filter((chunk) => chunk.kind === 'reference').length,
            chatChunks: chunks.filter((chunk) => chunk.kind === 'chat').length,
            requestAttempts,
            cacheHits,
            concurrency,
        };
        await WSM.Storage.completeHistoryCalibration({
            fingerprint, ledger, conflicts, summaryChecks, audit, boundary,
            messageResults: [...statusByMessage.values()],
        });
        const evidence = mergeEvidence(
            ...results.map((result) => result.legacyEvidence),
            evidenceFromChanges(changes),
        );
        return {
            calibration: true,
            fingerprint,
            source: null,
            boundary,
            audit,
            ledger,
            allChanges: changes,
            evidence,
            large: true,
            originalChars: jsonLength(source),
            includedChars: chunks.reduce((sum, chunk) => sum + jsonLength(chunk.records), 0),
            records: chunks.reduce((sum, chunk) => sum + chunk.records.length, 0),
            chunks: chunks.length,
            requestAttempts,
            cacheHits,
            concurrency,
        };
    }

    async function prepare(source, options = {}) {
        // A 20k-character Chinese chat can already be a fairly large token
        // payload once JSON and instructions are included.  Use conservative
        // default chunks; failures still split further adaptively below.
        const chunkChars = Math.max(4000, Number(options.chunkChars || 8000));
        const partChars = Math.max(2000, Math.floor(chunkChars * 0.55));
        const records = sourceRecords(source, partChars);
        // Keep immutable setup material and chat history in separate packs.
        // Appending one new chat floor then leaves prior setup/chat chunks
        // byte-identical, so their extracted evidence can be reused.
        const staticRecords = records.filter((record) => record.kind !== 'chat');
        const chatRecords = records.filter((record) => record.kind === 'chat');
        const chunks = [...pack(staticRecords, chunkChars), ...pack(chatRecords, chunkChars)];
        const sourceChars = jsonLength(source);
        if (options.forceDigest !== true && chunks.length <= 1 && sourceChars <= chunkChars) {
            return { source, stats: { chunked: false, sourceChars, chunks: 1, mergePasses: 0 } };
        }

        const digests = [];
        const queue = chunks.slice();
        const initialChunks = chunks.length;
        let requestAttempts = 0;
        let adaptiveSplits = 0;
        let cacheHits = 0;
        const cache = loadCache();
        let cacheDirty = false;
        for (let index = 0; index < queue.length;) {
            throwIfCancelled(options.signal);
            const cacheKey = `read:${hash(JSON.stringify(queue[index]))}`;
            const cached = cache[cacheKey]?.digest;
            options.onProgress?.({ stage: 'read', current: index + 1, total: queue.length, attempts: requestAttempts + 1, cached: !!cached, cacheHits });
            if (cached && typeof cached === 'object') {
                digests.push(cached);
                cacheHits += 1;
                index += 1;
                continue;
            }
            try {
                requestAttempts += 1;
                const result = await WSM.Api.complete(`${CHUNK_PROMPT}${PHANTASM_COVERAGE_PROMPT}`, {
                    task: 'SOURCE_READ_CHUNK', chunkIndex: index + 1, chunkCount: queue.length, sourceChunk: queue[index],
                }, { maxTokens: 3000, signal: options.signal });
                const digest = digestValue(result);
                digests.push(digest);
                cache[cacheKey] = { at: Date.now(), digest };
                cacheDirty = true;
                index += 1;
            } catch (error) {
                if (options.signal?.aborted) throw cancellationError();
                const children = splitFailedChunk(queue[index]);
                if (!children) throw new Error(`资料分片 ${index + 1}/${queue.length} 已细分到最小单位仍读取失败：${text(error?.message || error)}`);
                adaptiveSplits += 1;
                queue.splice(index, 1, ...children);
                options.onProgress?.({
                    stage: 'split', current: index + 1, total: queue.length, splits: adaptiveSplits,
                    reason: text(error?.message || error),
                });
            }
        }

        let current = digests;
        let mergePasses = 0;
        const reduceTarget = Math.max(12000, Number(options.reduceTargetChars || 42000));
        while (jsonLength(current) > reduceTarget && current.length > 1) {
            mergePasses += 1;
            const batches = pack(current, Math.max(8000, Math.floor(reduceTarget * 0.7)));
            const merged = [];
            for (let index = 0; index < batches.length; index += 1) {
                throwIfCancelled(options.signal);
                const cacheKey = `merge:${hash(JSON.stringify({ target: reduceTarget, batch: batches[index] }))}`;
                const cached = cache[cacheKey]?.digest;
                options.onProgress?.({ stage: 'merge', current: index + 1, total: batches.length, pass: mergePasses, cached: !!cached, cacheHits });
                if (cached && typeof cached === 'object') {
                    merged.push(cached);
                    cacheHits += 1;
                    continue;
                }
                try {
                    const result = await WSM.Api.complete(`${MERGE_PROMPT}${PHANTASM_COVERAGE_PROMPT}`, {
                        task: 'SOURCE_MERGE_DIGESTS', pass: mergePasses, batchIndex: index + 1, batchCount: batches.length, digestBatch: batches[index],
                        targetChars: reduceTarget,
                    }, { maxTokens: 3500, signal: options.signal });
                    const digest = digestValue(result);
                    merged.push(digest);
                    cache[cacheKey] = { at: Date.now(), digest };
                    cacheDirty = true;
                } catch (error) {
                    if (options.signal?.aborted) throw cancellationError();
                    throw new Error(`资料摘要第 ${mergePasses} 轮合并 ${index + 1}/${batches.length} 失败：${text(error?.message || error)}`);
                }
            }
            if (merged.length >= current.length && jsonLength(merged) >= jsonLength(current)) break;
            current = merged;
        }
        if (jsonLength(current) > Math.floor(reduceTarget * 1.15)) {
            throwIfCancelled(options.signal);
            mergePasses += 1;
            options.onProgress?.({ stage: 'merge', current: 1, total: 1, pass: mergePasses });
            try {
                const cacheKey = `final:${hash(JSON.stringify({ target: reduceTarget, batch: current }))}`;
                const cached = cache[cacheKey]?.digest;
                if (cached && typeof cached === 'object') {
                    current = [cached];
                    cacheHits += 1;
                } else {
                    const result = await WSM.Api.complete(`${MERGE_PROMPT}${PHANTASM_COVERAGE_PROMPT}`, {
                        task: 'SOURCE_FINAL_COMPACT', pass: mergePasses, targetChars: reduceTarget, digestBatch: current,
                    }, { maxTokens: 3000, signal: options.signal });
                    const digest = digestValue(result);
                    current = [digest];
                    cache[cacheKey] = { at: Date.now(), digest };
                    cacheDirty = true;
                }
            } catch (error) {
                if (options.signal?.aborted) throw cancellationError();
                console.warn('[WorldStateMachine] 最终证据压缩失败，保留已完整读取的分片证据', error);
            }
        }

        if (cacheDirty) saveCache(cache);
        const recentChat = (source.chat || []).slice(-8);
        const prepared = {
            identities: source.identities,
            character: { name: source.character?.name || '', processedInSourceDigest: true },
            persona: source.persona ? '[已完整分片读取，见 sourceDigest]' : '',
            sourceDigest: current,
            chat: recentChat,
            currentUserAction: source.currentUserAction,
            latestAssistantText: source.latestAssistantText,
            compiledWorldbookRules: source.compiledWorldbookRules,
            worldbookDiagnostics: source.worldbookDiagnostics,
            tavernTextContext: {
                ...(source.tavernTextContext || {}),
                includedMessages: Number(source.tavernTextContext?.totalMessages || source.chat?.length || 0),
                truncated: false,
                processedInChunks: true,
                rawTailMessages: recentChat.length,
                sourceChunks: queue.length,
            },
            sourceRead: {
                mode: 'chunked-map-reduce', sourceChars, records: records.length, initialChunks,
                chunks: queue.length, requestAttempts, cacheHits, adaptiveSplits, mergePasses,
            },
        };
        return { source: prepared, stats: {
            chunked: true, sourceChars, records: records.length, initialChunks,
            chunks: queue.length, requestAttempts, cacheHits, adaptiveSplits, mergePasses,
        } };
    }

    WSM.SourceReader = {
        prepare,
        calibrate,
        _test: {
            splitText, sourceRecords, pack, splitFailedChunk, calibrationChunkKey, expandPreviouslyFailedCalibrationChunks, packWithMessageOverlap,
            calibrationSourceBudget, calibrationChunks, normalizeCalibrationResult, evidenceFromChanges, mergeEvidence, messageManifest,
        },
    };
})();
