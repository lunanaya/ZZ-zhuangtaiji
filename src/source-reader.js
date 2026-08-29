(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

    const text = (value) => String(value ?? '').trim();
    const jsonLength = (value) => JSON.stringify(value).length;
    const CHUNK_PROMPT = `你是资料分片读取器，不是故事续写者。逐项读取 sourceChunk 中的原始资料，提取可供世界状态初始化使用的证据。不得增加原文不存在的设定，不得把角色主张或猜测升级为客观事实。保留姓名、身份、时间顺序、地点、关系、知识边界、任务、伤势、物品、规则、例外和当前场景。每条结论附带 sourceRefs。只输出严格 JSON：{"digest":{"sourceRefs":[],"canon":[],"chronology":[],"characters":[],"relationships":[],"knowledge":[],"locations":[],"tasks":[],"currentScene":[],"uncertainties":[]}}。内容应紧凑但不能因为资料较早就忽略。`;
    const MERGE_PROMPT = `你是资料证据合并器。合并 digestBatch 中已经逐片读取的证据，去重但不得丢失仍有效的事实、规则、例外、时间顺序、人物关系、知识边界、任务和来源引用。冲突内容并存并放入 uncertainties，不得自行裁决或续写。只输出严格 JSON：{"digest":{"sourceRefs":[],"canon":[],"chronology":[],"characters":[],"relationships":[],"knowledge":[],"locations":[],"tasks":[],"currentScene":[],"uncertainties":[]}}。`;

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
                kind: 'worldbook', book: book.name || '', title: entry.comment || '', keys: entry.keys || [],
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

    async function prepare(source, options = {}) {
        const chunkChars = Math.max(4000, Number(options.chunkChars || 24000));
        const partChars = Math.max(2000, Math.floor(chunkChars * 0.55));
        const records = sourceRecords(source, partChars);
        const chunks = pack(records, chunkChars);
        const sourceChars = jsonLength(source);
        if (chunks.length <= 1 && sourceChars <= chunkChars) {
            return { source, stats: { chunked: false, sourceChars, chunks: 1, mergePasses: 0 } };
        }

        const digests = [];
        for (let index = 0; index < chunks.length; index += 1) {
            options.onProgress?.({ stage: 'read', current: index + 1, total: chunks.length });
            try {
                const result = await WSM.Api.complete(CHUNK_PROMPT, {
                    task: 'SOURCE_READ_CHUNK', chunkIndex: index + 1, chunkCount: chunks.length, sourceChunk: chunks[index],
                }, { maxTokens: 3000 });
                digests.push(digestValue(result));
            } catch (error) {
                throw new Error(`资料分片 ${index + 1}/${chunks.length} 读取失败：${text(error?.message || error)}`);
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
                options.onProgress?.({ stage: 'merge', current: index + 1, total: batches.length, pass: mergePasses });
                try {
                    const result = await WSM.Api.complete(MERGE_PROMPT, {
                        task: 'SOURCE_MERGE_DIGESTS', pass: mergePasses, batchIndex: index + 1, batchCount: batches.length, digestBatch: batches[index],
                    }, { maxTokens: 3500 });
                    merged.push(digestValue(result));
                } catch (error) {
                    throw new Error(`资料摘要第 ${mergePasses} 轮合并 ${index + 1}/${batches.length} 失败：${text(error?.message || error)}`);
                }
            }
            if (merged.length >= current.length && jsonLength(merged) >= jsonLength(current)) break;
            current = merged;
        }

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
                sourceChunks: chunks.length,
            },
            sourceRead: { mode: 'chunked-map-reduce', sourceChars, chunks: chunks.length, mergePasses },
        };
        return { source: prepared, stats: { chunked: true, sourceChars, chunks: chunks.length, mergePasses } };
    }

    WSM.SourceReader = { prepare, _test: { splitText, sourceRecords, pack } };
})();
