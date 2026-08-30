(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

    const text = (value) => String(value ?? '').trim();
    const jsonLength = (value) => JSON.stringify(value).length;
    function cancellationError() { return Object.assign(new Error('用户已终止读取'), { name: 'AbortError' }); }
    function throwIfCancelled(signal) { if (signal?.aborted) throw cancellationError(); }
    const CACHE_KEY = 'wsm_source_reader_digest_cache_v1';
    const CHUNK_PROMPT = `你是资料分片读取器，不是故事续写者。逐项读取 sourceChunk 中的原始资料，提取可供世界状态初始化使用的证据。不得增加原文不存在的设定，不得把角色主张或猜测升级为客观事实。保留姓名、身份、时间顺序、地点、关系、知识边界、任务、伤势、物品、规则、例外和当前场景。每条结论附带 sourceRefs。只输出严格 JSON：{"digest":{"sourceRefs":[],"canon":[],"chronology":[],"characters":[],"relationships":[],"knowledge":[],"locations":[],"tasks":[],"currentScene":[],"uncertainties":[]}}。内容应紧凑但不能因为资料较早就忽略。`;
    const MERGE_PROMPT = `你是资料证据合并器。合并 digestBatch 中已经逐片读取的证据，去重但不得丢失仍有效的事实、规则、例外、时间顺序、人物关系、知识边界、任务和来源引用。可把同一事项的多条证据合写为一条并保留全部关键 sourceRefs；冲突内容并存并放入 uncertainties，不得自行裁决或续写。若提供 targetChars，应尽量把 JSON 控制在该字符数内。只输出严格 JSON：{"digest":{"sourceRefs":[],"canon":[],"chronology":[],"characters":[],"relationships":[],"knowledge":[],"locations":[],"tasks":[],"currentScene":[],"uncertainties":[]}}。`;

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
                const result = await WSM.Api.complete(CHUNK_PROMPT, {
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
                    const result = await WSM.Api.complete(MERGE_PROMPT, {
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
                    const result = await WSM.Api.complete(MERGE_PROMPT, {
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

    WSM.SourceReader = { prepare, _test: { splitText, sourceRecords, pack, splitFailedChunk } };
})();
