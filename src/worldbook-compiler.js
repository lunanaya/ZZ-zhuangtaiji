(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const CACHE_KEY = 'wsm_worldbook_compiler_cache_v1';
    let activeTurn = null;
    let lastDelivery = null;
    let lastStatus = { state: 'idle', message: '尚未运行', at: 0 };

    const text = (value) => String(value ?? '').trim();
    const clone = (value) => {
        try { return structuredClone(value); }
        catch (_error) { return JSON.parse(JSON.stringify(value)); }
    };
    function normalizeConfig(value = WSM.Settings.get().worldbookCompiler) {
        const raw = value && typeof value === 'object' ? value : {};
        return {
            enabled: raw.enabled === true,
            entryKeys: [...new Set((Array.isArray(raw.entryKeys) ? raw.entryKeys : []).map(String).filter(Boolean))],
            budget: Math.max(120, Math.min(2000, Math.round(Number(raw.budget) || 500))),
            contextMessages: Math.max(2, Math.min(30, Math.round(Number(raw.contextMessages) || 8))),
            failClosed: true,
        };
    }
    function hash(value) {
        const input = String(value || '');
        let result = 2166136261;
        for (let index = 0; index < input.length; index += 1) result = Math.imul(result ^ input.charCodeAt(index), 16777619);
        return (result >>> 0).toString(16).padStart(8, '0');
    }
    function packByJsonSize(values, limit = 24000) {
        const batches = [];
        let batch = [];
        let length = 2;
        (values || []).forEach((value) => {
            const itemLength = JSON.stringify(value).length + 1;
            if (batch.length && length + itemLength > limit) {
                batches.push(batch);
                batch = [];
                length = 2;
            }
            batch.push(value);
            length += itemLength;
        });
        if (batch.length) batches.push(batch);
        return batches;
    }
    function splitContent(value, limit = 12000) {
        const input = text(value);
        if (input.length <= limit) return [input];
        const parts = [];
        let rest = input;
        while (rest.length > limit) {
            let cut = Math.max(rest.lastIndexOf('\n', limit), rest.lastIndexOf('。', limit));
            if (cut < Math.floor(limit * 0.45)) cut = limit;
            else cut += 1;
            parts.push(rest.slice(0, cut));
            rest = rest.slice(cut);
        }
        if (rest) parts.push(rest);
        return parts;
    }
    function loadCache() {
        try {
            const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) { return {}; }
    }
    function saveCache(cache) {
        try {
            const recent = Object.entries(cache || {}).sort((a, b) => Number(b[1]?.compiledAt || 0) - Number(a[1]?.compiledAt || 0)).slice(0, 500);
            localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(recent)));
        } catch (error) { console.warn('[WorldStateMachine] 无法保存世界书拆解缓存', error); }
    }
    async function resolveSelectedEntries(config = normalizeConfig()) {
        const selected = new Set(config.entryKeys);
        const available = await WSM.Context.listWorldbookEntries();
        return available.filter((entry) => selected.has(entry.key) && entry.content);
    }
    function normalizeCompiled(item, entry) {
        const values = (value) => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
        return {
            key: entry.key,
            bookName: entry.bookName,
            label: entry.comment || entry.bookName,
            core: values(item?.core),
            triggers: values(item?.triggers || item?.when),
            rules: values(item?.rules || item?.conditionalRules || item?.rule),
            background: values(item?.background),
        };
    }
    async function ensureCompiled(config, entries, options = {}) {
        const cache = loadCache();
        const missing = entries.filter((entry) => options.force === true || cache[entry.key]?.sourceHash !== hash(entry.content) || !cache[entry.key]?.compiled);
        if (missing.length) {
            const units = missing.flatMap((entry) => {
                const parts = splitContent(entry.content);
                return parts.map((content, index) => ({
                    entry,
                    requestKey: parts.length > 1 ? `${entry.key}::part-${index + 1}-of-${parts.length}` : entry.key,
                    part: index + 1,
                    parts: parts.length,
                    content,
                }));
            });
            const batches = packByJsonSize(units.map((unit) => ({
                key: unit.requestKey, originalKey: unit.entry.key, part: unit.part, parts: unit.parts,
                book: unit.entry.bookName, title: unit.entry.comment, content: unit.content,
            })), 22000);
            const compiledParts = new Map();
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
                const batch = batches[batchIndex];
                lastStatus = { state: 'compiling', message: `正在分批拆解世界书 ${batchIndex + 1}/${batches.length}（共 ${missing.length} 条）`, at: Date.now() };
                const result = await WSM.Api.complete(
                    '你是世界书规则拆解器。逐条去重、消歧并压缩，但不得改变事实、规则强度、例外、人物身份和权力边界。只输出严格 JSON：{"entries":[{"key":"原key","core":["不可违反的短规则"],"triggers":["触发词或情境"],"rules":["条件规则"],"background":["必要背景"]}]}。禁止续写正文、增加设定或输出 Markdown。',
                    { task: 'WORLDBOOK_COMPILE', batchIndex: batchIndex + 1, batchCount: batches.length, entries: batch },
                    { maxTokens: 5000 },
                );
                const items = Array.isArray(result?.entries) ? result.entries : [];
                batch.forEach((unit) => {
                    const matched = items.find((item) => text(item?.key) === unit.key) || (batch.length === 1 ? items[0] : null);
                    if (!matched) throw new Error(`拆解结果缺少条目：${unit.title || unit.originalKey}（分片 ${unit.part}/${unit.parts}）`);
                    const entry = missing.find((item) => item.key === unit.originalKey);
                    const values = compiledParts.get(unit.originalKey) || [];
                    values.push(normalizeCompiled(matched, entry));
                    compiledParts.set(unit.originalKey, values);
                });
            }
            missing.forEach((entry) => {
                const parts = compiledParts.get(entry.key) || [];
                if (!parts.length) throw new Error(`拆解结果缺少条目：${entry.comment || entry.key}`);
                const unique = (field) => [...new Set(parts.flatMap((item) => item[field] || []).map(text).filter(Boolean))];
                cache[entry.key] = {
                    sourceHash: hash(entry.content), compiledAt: Date.now(),
                    compiled: { ...parts[0], key: entry.key, core: unique('core'), triggers: unique('triggers'), rules: unique('rules'), background: unique('background') },
                };
            });
            saveCache(cache);
        }
        return entries.map((entry) => cache[entry.key]).filter(Boolean);
    }
    function contentOf(value) {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.map((part) => typeof part === 'string' ? part : text(part?.text || part?.content)).filter(Boolean).join('\n');
        return '';
    }
    function contextFromMessages(messages, count) {
        const normalized = (Array.isArray(messages) ? messages : []).map((message) => {
            if (typeof message === 'string') return { role: 'prompt', content: message };
            const role = text(message?.role || (message?.is_system ? 'system' : message?.is_user ? 'user' : 'assistant')).toLowerCase();
            return { role, content: contentOf(message?.content ?? message?.parts ?? message?.text ?? message?.mes).slice(-5000) };
        }).filter((message) => message.content && !message.content.includes('【本轮世界书拆解规则】'));
        const dialogue = normalized.filter((message) => ['user', 'assistant', 'model', 'human', 'char'].includes(message.role));
        return (dialogue.length ? dialogue : normalized).slice(-count);
    }
    function fallbackText(compiled, budget) {
        const lines = compiled.flatMap((item) => [...(item.compiled?.core || []), ...(item.compiled?.rules || [])]);
        return [...new Set(lines)].join('\n').slice(0, budget);
    }
    function reportEntry(value) {
        const compiled = value?.compiled || value;
        if (!compiled || typeof compiled !== 'object') return null;
        return {
            key: text(compiled.key),
            bookName: text(compiled.bookName),
            label: text(compiled.label),
            core: Array.isArray(compiled.core) ? compiled.core.map(text).filter(Boolean) : [],
            triggers: Array.isArray(compiled.triggers) ? compiled.triggers.map(text).filter(Boolean) : [],
            rules: Array.isArray(compiled.rules) ? compiled.rules.map(text).filter(Boolean) : [],
            background: Array.isArray(compiled.background) ? compiled.background.map(text).filter(Boolean) : [],
            compiledAt: Number(value?.compiledAt || 0),
        };
    }
    function buildReport(prepared = activeTurn, extra = {}) {
        const config = normalizeConfig();
        const cache = loadCache();
        const cachedEntries = config.entryKeys.map((key) => reportEntry(cache[key])).filter(Boolean);
        const turnEntries = (prepared?.compiled || []).map(reportEntry).filter(Boolean);
        const entries = turnEntries.length ? turnEntries : cachedEntries;
        const routedText = text(prepared?.routed || extra.routedText);
        return {
            enabled: config.enabled,
            selectedCount: config.entryKeys.length,
            compiledCount: entries.length,
            entries,
            routedText,
            routedChars: routedText.length,
            turnAt: Number(prepared?.at || extra.turnAt || 0),
            status: clone(lastStatus),
            delivery: clone(lastDelivery),
            ...extra,
        };
    }
    async function route(config, compiled, currentContext) {
        const rules = compiled.map((item) => item.compiled).filter(Boolean);
        const batches = packByJsonSize(rules, 22000);
        const candidates = [];
        for (let index = 0; index < batches.length; index += 1) {
            const result = await WSM.Api.complete(
                `你是逐轮世界书规则路由器。currentContext 是酒馆实际正文。只选择本轮相关规则，合并重复内容；核心硬规则只要可能影响回复就保留。不得续写剧情、增加设定或弱化禁令。只输出严格 JSON {"text":"候选纯文本规则"}，text 不超过 ${config.budget} 个汉字；没有相关规则时可为空。`,
                { task: 'WORLDBOOK_ROUTE', batchIndex: index + 1, batchCount: batches.length, currentContext, compiledRules: batches[index] },
                { maxTokens: 1500 },
            );
            if (text(result?.text)) candidates.push(text(result.text));
        }
        if (candidates.length <= 1) return text(candidates[0]).slice(0, config.budget);
        const merged = await WSM.Api.complete(
            `你是世界书规则最终路由器。合并 candidateTexts，删除重复，但不得弱化硬规则、例外和禁止事项。只输出严格 JSON {"text":"最终纯文本规则"}，text 不超过 ${config.budget} 个汉字。`,
            { task: 'WORLDBOOK_ROUTE_MERGE', currentContext, candidateTexts: candidates },
            { maxTokens: 1500 },
        );
        return text(merged?.text).slice(0, config.budget);
    }
    async function prepare(config, entries, currentContext, options = {}) {
        const key = hash(JSON.stringify({ entries: entries.map((entry) => [entry.key, hash(entry.content)]), currentContext, budget: config.budget }));
        if (!options.force && activeTurn?.key === key) return activeTurn;
        const compiled = await ensureCompiled(config, entries, options);
        let routed;
        try { routed = await route(config, compiled, currentContext); }
        catch (error) {
            routed = fallbackText(compiled, config.budget);
            if (!routed) throw error;
            console.warn('[WorldStateMachine] 世界书逐轮路由失败，使用已拆解核心规则', error);
        }
        activeTurn = { key, entryKeys: entries.map((entry) => entry.key), routed, compiled, at: Date.now() };
        return activeTurn;
    }
    function expandedOriginals(entries) {
        const variants = new Set();
        entries.forEach((entry) => {
            const original = text(entry.content);
            if (!original) return;
            variants.add(original);
            variants.add(original.replace(/\r\n/g, '\n'));
            variants.add(original.replace(/\n/g, '\r\n'));
            [window.substituteParams, window.substituteParamsExtended].forEach((substitute) => {
                if (typeof substitute !== 'function') return;
                try { variants.add(text(substitute(original))); } catch (_error) { /* literal form remains */ }
            });
        });
        return [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
    }
    function redactOriginals(target, entries) {
        const originals = expandedOriginals(entries);
        let removed = 0;
        const walk = (node, key = '') => {
            if (!node) return node;
            if (typeof node === 'string') {
                if (['model', 'name', 'role', 'id'].includes(key)) return node;
                let value = node;
                originals.forEach((original) => {
                    if (!original || !value.includes(original)) return;
                    const pieces = value.split(original);
                    removed += pieces.length - 1;
                    value = pieces.join('');
                });
                return value;
            }
            if (Array.isArray(node)) {
                node.forEach((value, index) => { node[index] = walk(value, key); });
                return node;
            }
            if (typeof node === 'object') Object.keys(node).forEach((child) => { node[child] = walk(node[child], child); });
            return node;
        };
        walk(target);
        return removed;
    }
    function injectText(chat, routed) {
        if (!routed || !Array.isArray(chat)) return false;
        const content = `【本轮世界书拆解规则】\n${routed}`;
        if (chat.some((item) => contentOf(typeof item === 'string' ? item : (item?.content ?? item?.mes)).includes('【本轮世界书拆解规则】'))) return true;
        if (!chat.length || typeof chat[0] === 'string') { chat.push(content); return true; }
        const hasRoles = chat.some((item) => item && Object.prototype.hasOwnProperty.call(item, 'role'));
        if (hasRoles) {
            const index = chat.map((item) => item?.role).lastIndexOf('user');
            chat.splice(index >= 0 ? index : chat.length, 0, { role: 'system', content, wsmInjectionType: 'worldbook-compiled' });
        } else {
            const index = chat.map((item) => !!item?.is_user).lastIndexOf(true);
            chat.splice(index >= 0 ? index : chat.length, 0, { is_user: false, is_system: true, name: 'Worldbook Rules', mes: content, wsmInjectionType: 'worldbook-compiled' });
        }
        return true;
    }
    function missingKeys(config, entries) {
        const found = new Set(entries.map((entry) => entry.key));
        return config.entryKeys.filter((key) => !found.has(key));
    }
    async function processSource(source) {
        const config = normalizeConfig();
        if (!config.enabled || !config.entryKeys.length) return { enabled: false };
        const entries = (source.worldbooks || []).flatMap((book) => book.entries || []).filter((entry) => config.entryKeys.includes(entry.key));
        const missing = missingKeys(config, entries);
        if (missing.length) return { enabled: true, blocked: true, error: `无法读取 ${missing.length} 条已勾选世界书条目` };
        if (!entries.length) return { enabled: true, blocked: true, error: '没有可读取的已勾选世界书条目' };
        const selected = new Set(entries.map((entry) => entry.key));
        source.worldbooks = (source.worldbooks || []).map((book) => ({ ...book, entries: (book.entries || []).filter((entry) => !selected.has(entry.key)) })).filter((book) => book.entries.length);
        try {
            const prepared = await prepare(config, entries, contextFromMessages(source.chat, config.contextMessages));
            source.compiledWorldbookRules = { text: prepared.routed, selectedEntryKeys: prepared.entryKeys, originalEntriesRemoved: entries.length };
            lastStatus = { state: 'ready', message: `已为 Planner 路由 ${prepared.routed.length} 字世界书规则`, at: Date.now() };
            return { enabled: true, routed: prepared.routed, selected: entries.length, report: buildReport(prepared, { originalEntriesRemoved: entries.length }) };
        } catch (error) {
            lastStatus = { state: 'error', message: text(error?.message || error), at: Date.now() };
            return { enabled: true, blocked: true, error: lastStatus.message };
        }
    }
    async function processChat(chat) {
        const config = normalizeConfig();
        if (!config.enabled || !config.entryKeys.length) return { enabled: false };
        const entries = await resolveSelectedEntries(config);
        const missing = missingKeys(config, entries);
        if (missing.length) {
            const error = `无法读取 ${missing.length} 条已勾选世界书条目；为避免原文泄漏，已阻止正文请求`;
            lastStatus = { state: 'blocked', message: error, at: Date.now() };
            return { enabled: true, blocked: true, error };
        }
        if (!entries.length) return { enabled: true, removed: 0, injected: false };
        const removed = redactOriginals(chat, entries);
        try {
            const prepared = await prepare(config, entries, contextFromMessages(chat, config.contextMessages));
            const injected = injectText(chat, prepared.routed);
            lastStatus = { state: 'ready', message: `已剔除 ${removed} 处原文，注入 ${prepared.routed.length} 字`, at: Date.now() };
            lastDelivery = { at: Date.now(), injected, fallback: false, removedOriginalOccurrences: removed, chars: prepared.routed.length };
            return { enabled: true, removed, injected, length: prepared.routed.length };
        } catch (error) {
            const cached = entries.map((entry) => loadCache()[entry.key]).filter(Boolean);
            const fallback = fallbackText(cached, config.budget);
            const injected = injectText(chat, fallback);
            const message = text(error?.message || error);
            lastStatus = { state: !fallback ? 'blocked' : 'error', message, at: Date.now() };
            lastDelivery = { at: Date.now(), injected, fallback: !!fallback, removedOriginalOccurrences: removed, chars: fallback.length, error: message };
            return { enabled: true, removed, injected, fallback: !!fallback, blocked: !fallback, error: message };
        }
    }
    async function compileConfig(configValue, options = {}) {
        const config = normalizeConfig(configValue);
        const entries = await resolveSelectedEntries(config);
        if (!entries.length) throw new Error('请至少勾选一条当前可读取的世界书条目');
        await ensureCompiled(config, entries, { force: options.force === true });
        lastStatus = { state: 'ready', message: `已拆解 ${entries.length} 条世界书`, at: Date.now() };
        return { count: entries.length };
    }
    function updateCompiledEntry(key, value) {
        const entryKey = text(key);
        const cache = loadCache();
        const previous = cache[entryKey];
        if (!entryKey || !previous?.compiled) throw new Error('找不到需要修改的世界书拆解条目');
        const values = (items) => (Array.isArray(items) ? items : []).map(text).filter(Boolean);
        cache[entryKey] = {
            ...previous,
            compiledAt: Date.now(),
            compiled: {
                ...previous.compiled,
                core: values(value?.core),
                triggers: values(value?.triggers),
                rules: values(value?.rules),
                background: values(value?.background),
            },
        };
        saveCache(cache);
        activeTurn = null;
        lastDelivery = null;
        lastStatus = { state: 'edited', message: '拆解规则已人工修改，将在下一轮重新路由注入', at: Date.now() };
        return reportEntry(cache[entryKey]);
    }
    WSM.WorldbookCompiler = {
        normalizeConfig,
        processSource,
        processChat,
        compileConfig,
        getLastStatus: () => clone(lastStatus),
        getReport: (persisted) => {
            const live = buildReport();
            if (activeTurn || lastDelivery || lastStatus.state === 'edited' || !persisted) return live;
            const saved = clone(persisted);
            const editedAfterTurn = live.entries.some((entry) => Number(entry.compiledAt || 0) > Number(saved.turnAt || 0));
            if (editedAfterTurn) return {
                ...live,
                status: { state: 'edited', message: '拆解规则已人工修改，将在下一轮重新路由注入', at: Math.max(...live.entries.map((entry) => Number(entry.compiledAt || 0))) },
            };
            return {
                ...saved,
                enabled: live.enabled,
                selectedCount: live.selectedCount,
                compiledCount: live.entries.length || Number(saved.compiledCount || 0),
                entries: live.entries.length ? live.entries : (saved.entries || []),
            };
        },
        updateCompiledEntry,
        clearCache() { saveCache({}); activeTurn = null; lastDelivery = null; lastStatus = { state: 'idle', message: '拆解缓存已清空', at: Date.now() }; },
        _test: { hash, contextFromMessages, redactOriginals, injectText, fallbackText },
    };
})();
