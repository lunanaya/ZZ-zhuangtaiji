(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const CACHE_KEY = 'wsm_worldbook_compiler_cache_v1';
    const PROMPT_PREFIX = 'WORLD_STATE_MACHINE_WORLDBOOK_DEPTH_';
    let activeTurn = null;
    let lastDelivery = null;
    let lastStatus = { state: 'idle', message: '尚未运行', at: 0 };
    let registeredWorldbookDepths = new Set();

    const text = (value) => String(value ?? '').trim();
    const clone = (value) => {
        try { return structuredClone(value); }
        catch (_error) { return JSON.parse(JSON.stringify(value)); }
    };
    function normalizeConfig(value = WSM.Settings.get().worldbookCompiler) {
        const raw = value && typeof value === 'object' ? value : {};
        return {
            enabled: raw.enabled === true,
            selectedBookNames: [...new Set((Array.isArray(raw.selectedBookNames) ? raw.selectedBookNames : []).map(text).filter(Boolean))],
            knownBookNames: [...new Set((Array.isArray(raw.knownBookNames) ? raw.knownBookNames : []).map(text).filter(Boolean))],
            entryKeys: [...new Set((Array.isArray(raw.entryKeys) ? raw.entryKeys : []).map(String).filter((key) => key && key !== 'undefined'))],
            knownEntryKeys: [...new Set((Array.isArray(raw.knownEntryKeys) ? raw.knownEntryKeys : []).map(String).filter((key) => key && key !== 'undefined'))],
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
    function splitCompileBatch(batch, minimumChars = 900) {
        if (batch.length > 1) {
            const middle = Math.ceil(batch.length / 2);
            return [batch.slice(0, middle), batch.slice(middle)];
        }
        const unit = batch[0];
        if (!unit || text(unit.content).length <= minimumChars) return null;
        const parts = splitContent(unit.content, Math.max(minimumChars, Math.ceil(unit.content.length / 2)));
        if (parts.length < 2) return null;
        return parts.map((content, index) => [{
            ...unit,
            key: `${unit.key}::adaptive-${index + 1}-of-${parts.length}`,
            part: `${unit.part}.${index + 1}`,
            content,
        }]);
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
    async function resolveSelectedEntries(config = normalizeConfig(), options = {}) {
        const selected = new Set(config.entryKeys);
        const available = await WSM.Context.listWorldbookEntries({ includeDisabled: options.includeDisabled === true });
        return available.filter((entry) => selected.has(entry.key) && entry.content);
    }
    function normalizeCompiled(item, entry) {
        const values = (value) => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
        return {
            key: entry.key,
            bookName: entry.bookName,
            label: entry.comment || entry.bookName,
            depth: Math.max(0, Math.min(100, Math.round(Number(entry.depth ?? 4) || 0))),
            role: Number(entry.role ?? 0) || 0,
            core: values(item?.core),
            triggers: values(item?.triggers || item?.when),
            rules: values(item?.rules || item?.conditionalRules || item?.rule),
            background: values(item?.background),
        };
    }
    function compiledResultItems(result, batch = []) {
        const arrays = [result?.entries, result?.results, result?.items, result?.data?.entries, result?.data?.items];
        const listed = arrays.find(Array.isArray);
        if (listed) return listed;
        if (batch.length !== 1 || !result || typeof result !== 'object') return [];
        const looksCompiled = (value) => value && typeof value === 'object' && ['core', 'triggers', 'when', 'rules', 'conditionalRules', 'rule', 'background'].some((key) => Object.prototype.hasOwnProperty.call(value, key));
        if (looksCompiled(result.entry)) return [result.entry];
        if (looksCompiled(result)) return [result];
        const nested = Object.values(result).filter(looksCompiled);
        return nested.length === 1 ? nested : [];
    }
    function sourceFallbackRule(entry) {
        const content = text(entry?.content);
        const pieces = content.split(/\n+|(?<=[。！？；])/).map(text).filter(Boolean);
        const core = [];
        let used = 0;
        for (const piece of pieces) {
            if (used >= 1200 || core.length >= 12) break;
            const value = piece.slice(0, Math.max(0, 1200 - used));
            if (value) { core.push(value); used += value.length; }
        }
        return { key: entry.key, core, triggers: entry.keys || [], rules: [], background: [] };
    }
    function ingestReadResult(source, result) {
        const config = normalizeConfig();
        const entries = (source?.worldbooks || []).flatMap((book) => book.entries || []).filter((entry) => entry?.content);
        const allKeys = [...new Set(entries.map((entry) => entry.key).filter(Boolean))];
        if (allKeys.some((key) => !config.entryKeys.includes(key))) {
            WSM.Settings.update({ worldbookCompiler: normalizeConfig({
                ...config, enabled: true,
                entryKeys: [...config.entryKeys, ...allKeys],
                knownEntryKeys: [...config.knownEntryKeys, ...allKeys],
            }) });
        }
        const returned = compiledResultItems({ entries: result?.worldbookEntries || result?.worldRules?.entries || [] }, entries);
        const cache = loadCache();
        entries.forEach((entry) => {
            const matched = returned.find((item) => text(item?.key) === entry.key)
                || returned.find((item) => text(item?.title || item?.label) === text(entry.comment));
            const existing = cache[entry.key];
            const item = matched || (existing?.compiled ? existing.compiled : sourceFallbackRule(entry));
            cache[entry.key] = {
                sourceHash: hash(entry.content), compiledAt: Date.now(), compiled: normalizeCompiled(item, entry),
            };
        });
        saveCache(cache);
        activeTurn = null;
        lastStatus = { state: 'ready', message: `一次读取已浓缩 ${entries.length} 条世界书规则`, at: Date.now() };
        return { count: entries.length, report: buildReport(null) };
    }
    async function ensureCompiled(config, entries, options = {}) {
        const cache = loadCache();
        const missing = entries.filter((entry) => options.force === true || cache[entry.key]?.sourceHash !== hash(entry.content) || !cache[entry.key]?.compiled);
        if (missing.length && options.localOnly === true) {
            missing.forEach((entry) => {
                cache[entry.key] = {
                    sourceHash: hash(entry.content), compiledAt: Date.now(),
                    compiled: normalizeCompiled(sourceFallbackRule(entry), entry),
                };
            });
            saveCache(cache);
        }
        if (missing.length && options.localOnly !== true) {
            const totalBudget = 50000;
            const perEntry = Math.max(500, Math.floor(totalBudget / Math.max(1, missing.length)));
            const requestEntries = missing.map((entry) => {
                const content = text(entry.content);
                const excerpt = content.length <= perEntry
                    ? content
                    : `${content.slice(0, Math.floor(perEntry / 2))}\n…[本地省略，不增加 API 请求]…\n${content.slice(-Math.ceil(perEntry / 2))}`;
                return { key: entry.key, book: entry.bookName, title: entry.comment, content: excerpt, originalChars: content.length };
            });
            lastStatus = { state: 'compiling', message: `正在一次性拆解 ${missing.length} 条世界书（API 上限 1 次）`, at: Date.now() };
            let items = [];
            try {
                const result = await WSM.Api.complete(
                    '你是世界书规则拆解器。一次响应完成全部条目；逐条去重、消歧并压缩，但不得改变事实、规则强度、例外、人物身份和权力边界。只输出严格 JSON：{"entries":[{"key":"原key","core":["不可违反的短规则"],"triggers":["触发词或情境"],"rules":["条件规则"],"background":["必要背景"]}]}。禁止续写正文、增加设定、输出 Markdown 或要求后续调用。',
                    { task: 'WORLDBOOK_COMPILE_ONCE', entries: requestEntries },
                    { maxTokens: Math.min(6000, 1000 + missing.length * 500), singleAttempt: true },
                );
                items = compiledResultItems(result, requestEntries);
            } catch (error) {
                console.warn('[WorldStateMachine] 世界书唯一一次拆解请求失败，使用本地无损降级，不重试', error);
                lastStatus = { state: 'error', message: `唯一一次 API 请求失败，已本地降级：${text(error?.message || error)}`, at: Date.now() };
            }
            missing.forEach((entry) => {
                const matched = items.find((item) => text(item?.key) === entry.key);
                cache[entry.key] = {
                    sourceHash: hash(entry.content), compiledAt: Date.now(),
                    compiled: normalizeCompiled(matched || sourceFallbackRule(entry), entry),
                };
            });
            saveCache(cache);
        }
        return entries.map((entry) => {
            const cached = cache[entry.key];
            if (!cached?.compiled) return null;
            return { ...cached, compiled: { ...cached.compiled, depth: Math.max(0, Math.min(100, Math.round(Number(entry.depth ?? cached.compiled.depth ?? 4) || 0))), role: Number(entry.role ?? cached.compiled.role ?? 0) || 0 } };
        }).filter(Boolean);
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
            depth: Math.max(0, Math.min(100, Math.round(Number(compiled.depth ?? 4) || 0))),
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
            routedByDepth: clone(prepared?.routedByDepth || extra.routedByDepth || {}),
            routedChars: routedText.length,
            turnAt: Number(prepared?.at || extra.turnAt || 0),
            status: clone(lastStatus),
            delivery: clone(lastDelivery),
            ...extra,
        };
    }
    async function routeGroup(config, compiled, currentContext) {
        const rules = compiled.map((item) => item.compiled).filter(Boolean);
        const batches = packByJsonSize(rules, 7000);
        const candidates = [];
        for (let index = 0; index < batches.length;) {
            try {
                const result = await WSM.Api.complete(
                    `你是逐轮世界书规则路由器。currentContext 是酒馆实际正文。只选择本轮相关规则，合并重复内容；核心硬规则只要可能影响回复就保留。不得续写剧情、增加设定或弱化禁令。只输出严格 JSON {"text":"候选纯文本规则"}，text 不超过 ${config.budget} 个汉字；没有相关规则时可为空。`,
                    { task: 'WORLDBOOK_ROUTE', batchIndex: index + 1, batchCount: batches.length, currentContext, compiledRules: batches[index] },
                    { maxTokens: 1200 },
                );
                if (text(result?.text)) candidates.push(text(result.text));
                index += 1;
            } catch (error) {
                if (batches[index].length <= 1) throw error;
                const middle = Math.ceil(batches[index].length / 2);
                batches.splice(index, 1, batches[index].slice(0, middle), batches[index].slice(middle));
            }
        }
        if (candidates.length <= 1) return text(candidates[0]).slice(0, config.budget);
        const merged = await WSM.Api.complete(
            `你是世界书规则最终路由器。合并 candidateTexts，删除重复，但不得弱化硬规则、例外和禁止事项。只输出严格 JSON {"text":"最终纯文本规则"}，text 不超过 ${config.budget} 个汉字。`,
            { task: 'WORLDBOOK_ROUTE_MERGE', currentContext, candidateTexts: candidates },
            { maxTokens: 1500 },
        );
        return text(merged?.text).slice(0, config.budget);
    }
    function relevanceTerms(value) {
        const input = text(value).toLowerCase();
        const terms = new Set((input.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}/g) || []));
        for (const run of input.match(/[\u3400-\u9fff]{3,}/g) || []) {
            for (let index = 0; index < run.length - 1; index += 1) terms.add(run.slice(index, index + 2));
        }
        return terms;
    }
    function localRoute(config, compiled, currentContext) {
        const contextText = text(JSON.stringify(currentContext)).toLowerCase();
        const contextTerms = relevanceTerms(contextText);
        const scored = compiled.map((item, index) => {
            const rule = item?.compiled || {};
            const triggerText = [...(rule.triggers || []), rule.label, rule.bookName].map(text).join(' ').toLowerCase();
            const body = [...(rule.core || []), ...(rule.rules || []), ...(rule.background || [])].join(' ').toLowerCase();
            let score = 0;
            relevanceTerms(triggerText).forEach((term) => { if (contextTerms.has(term) || contextText.includes(term)) score += 6; });
            relevanceTerms(body).forEach((term) => { if (contextTerms.has(term)) score += 1; });
            return { item, score, index };
        }).sort((a, b) => b.score - a.score || a.index - b.index);
        const relevant = scored.filter((item) => item.score > 0);
        const chosen = (relevant.length ? relevant : scored.slice(0, 1)).map((item) => item.item);
        const groups = new Map();
        chosen.forEach((item) => {
            const depth = Math.max(0, Math.min(100, Math.round(Number(item?.compiled?.depth ?? 4) || 0)));
            if (!groups.has(depth)) groups.set(depth, []);
            groups.get(depth).push(item);
        });
        const routedByDepth = {};
        const perDepthBudget = Math.max(120, Math.floor(config.budget / Math.max(1, groups.size)));
        groups.forEach((items, depth) => {
            const value = fallbackText(items, perDepthBudget);
            if (value) routedByDepth[depth] = value;
        });
        return { text: Object.values(routedByDepth).join('\n').slice(0, config.budget), byDepth: routedByDepth };
    }
    function localCandidateEntries(entries, currentContext, limit = 200) {
        if (entries.length <= limit) return entries;
        const contextText = text(JSON.stringify(currentContext)).toLowerCase();
        const contextTerms = relevanceTerms(contextText);
        return entries.map((entry, index) => {
            const heading = [entry.comment, ...(entry.keys || [])].map(text).join(' ').toLowerCase();
            let score = entry.constant === true ? 1000 : 0;
            relevanceTerms(heading).forEach((term) => {
                if (contextTerms.has(term) || contextText.includes(term)) score += 10;
            });
            return { entry, score, index };
        }).sort((a, b) => b.score - a.score || a.index - b.index)
            .slice(0, limit)
            .map((item) => item.entry);
    }
    async function route(config, compiled, currentContext) {
        const rules = compiled.map((item) => item.compiled).filter(Boolean);
        try {
            const result = await WSM.Api.complete(
                `你是逐轮世界书规则路由器。compiledRules 是全部已浓缩世界书，currentContext 是本轮酒馆正文。只抽取本轮相关规则，核心硬规则只要可能影响回复就保留；不得续写、增加设定或弱化禁令。只输出严格 JSON：{"text":"不超过 ${config.budget} 个汉字的规则","byDepth":{"4":"按深度分组的规则"}}。同一轮只能完成一次路由，不要请求后续步骤。`,
                { task: 'WORLDBOOK_ROUTE_ONCE', currentContext, compiledRules: rules, budget: config.budget },
                { maxTokens: 1800, singleAttempt: true },
            );
            const textResult = text(result?.text).slice(0, config.budget);
            const byDepth = result?.byDepth && typeof result.byDepth === 'object'
                ? Object.fromEntries(Object.entries(result.byDepth).map(([depth, value]) => [depth, text(value).slice(0, config.budget)]).filter(([, value]) => value))
                : {};
            if (!Object.keys(byDepth).length && textResult) {
                const depth = String(rules[0]?.depth ?? 4);
                byDepth[depth] = textResult;
            }
            return { text: textResult || Object.values(byDepth).join('\n').slice(0, config.budget), byDepth };
        } catch (error) {
            console.warn('[WorldStateMachine] 本轮世界书单次路由失败，使用本地相关性降级（不追加 API）', error);
            return localRoute(config, compiled, currentContext);
        }
    }
    function routeKeyFromMessages(messages) {
        const context = contextFromMessages(messages, 30);
        const users = context.filter((message) => message.role === 'user' || message.role === 'human');
        return hash(users.at(-1)?.content || JSON.stringify(context.slice(-2)));
    }
    async function prepare(config, entries, currentContext, options = {}) {
        const key = hash(JSON.stringify({ entries: entries.map((entry) => [entry.key, hash(entry.content), entry.depth]), currentContext, budget: config.budget }));
        const routeKey = text(options.routeKey);
        if (!options.force && activeTurn && ((routeKey && activeTurn.routeKey === routeKey) || activeTurn.key === key)) return activeTurn;
        // Thousands of selected entries must not freeze the UI while building
        // local fallback caches. Cheap keyword/constant preselection keeps the
        // detailed routing set bounded; initialization still receives an
        // evenly sampled snapshot of the complete original source.
        const routedEntries = options.localOnly === true ? localCandidateEntries(entries, currentContext) : entries;
        const compiled = await ensureCompiled(config, routedEntries, options);
        let routed;
        let routedByDepth;
        try {
            const result = options.localOnly === true
                ? localRoute(config, compiled, currentContext)
                : await route(config, compiled, currentContext);
            routed = result.text;
            routedByDepth = result.byDepth;
        }
        catch (error) {
            routed = fallbackText(compiled, config.budget);
            if (!routed) throw error;
            routedByDepth = Object.fromEntries([...new Set(compiled.map((item) => Number(item?.compiled?.depth ?? 4)))].map((depth) => [depth, fallbackText(compiled.filter((item) => Number(item?.compiled?.depth ?? 4) === depth), config.budget)]).filter(([, value]) => value));
            console.warn('[WorldStateMachine] 世界书逐轮路由失败，使用已拆解核心规则', error);
        }
        activeTurn = { key, routeKey, entryKeys: entries.map((entry) => entry.key), routed, routedByDepth, compiled, at: Date.now() };
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
    async function setWorldbookPrompts(routedByDepth = {}) {
        const ctx = WSM.Context.context();
        const setter = typeof ctx?.setExtensionPrompt === 'function' ? ctx.setExtensionPrompt.bind(ctx) : (typeof window.setExtensionPrompt === 'function' ? window.setExtensionPrompt.bind(window) : null);
        if (!setter) return false;
        const nextDepths = new Set(Object.keys(routedByDepth).map(Number).filter(Number.isFinite));
        const depths = new Set([...registeredWorldbookDepths, ...nextDepths]);
        for (const depth of depths) await setter(`${PROMPT_PREFIX}${depth}`, '', 1, depth, false, 0);
        for (const depth of nextDepths) {
            const value = text(routedByDepth[depth]);
            if (value) await setter(`${PROMPT_PREFIX}${depth}`, `<WORLDBOOK_RULES depth="${depth}">\n${value}\n</WORLDBOOK_RULES>`, 1, depth, false, 0);
        }
        registeredWorldbookDepths = nextDepths;
        return true;
    }
    function missingKeys(config, entries) {
        const found = new Set(entries.map((entry) => entry.key));
        return config.entryKeys.filter((key) => !found.has(key));
    }
    function bookNameFromEntryKey(key) {
        const encoded = text(key).split('::')[0];
        try { return decodeURIComponent(encoded); }
        catch (_error) { return encoded; }
    }
    async function processSource(source, options = {}) {
        const config = normalizeConfig();
        if (!config.enabled || !config.entryKeys.length) return { enabled: false };
        const entries = (source.worldbooks || []).flatMap((book) => book.entries || []).filter((entry) => config.entryKeys.includes(entry.key));
        const failedBooks = new Set(source.worldbookDiagnostics?.failedNames || []);
        const failedSelectedBooks = [...new Set(config.entryKeys.map(bookNameFromEntryKey).filter((name) => failedBooks.has(name)))];
        if (failedSelectedBooks.length) return { enabled: true, blocked: true, error: `无法读取已启用世界书：${failedSelectedBooks.join('、')}` };
        if (!entries.length) return { enabled: true, routed: '', selected: 0, report: buildReport(null, { originalEntriesRemoved: 0 }) };
        const selected = new Set(entries.map((entry) => entry.key));
        source.worldbooks = (source.worldbooks || []).map((book) => ({ ...book, entries: (book.entries || []).filter((entry) => !selected.has(entry.key)) })).filter((book) => book.entries.length);
        try {
            const prepared = await prepare(config, entries, contextFromMessages(source.chat, config.contextMessages), {
                localOnly: options.localOnly === true,
                routeKey: routeKeyFromMessages(source.chat),
            });
            source.compiledWorldbookRules = { text: prepared.routed, byDepth: prepared.routedByDepth, selectedEntryKeys: prepared.entryKeys, originalEntriesRemoved: entries.length };
            lastStatus = { state: 'ready', message: `已为 Planner 路由 ${prepared.routed.length} 字世界书规则`, at: Date.now() };
            return { enabled: true, routed: prepared.routed, selected: entries.length, report: buildReport(prepared, { originalEntriesRemoved: entries.length }) };
        } catch (error) {
            lastStatus = { state: 'error', message: text(error?.message || error), at: Date.now() };
            return { enabled: true, blocked: true, error: lastStatus.message };
        }
    }
    async function processChat(chat) {
        const config = normalizeConfig();
        if (!config.enabled || !config.entryKeys.length) {
            await setWorldbookPrompts({});
            return { enabled: false };
        }
        // Only currently enabled ST entries participate in this turn. Disabled
        // entries may still be selected and precompiled from the settings UI,
        // but must not be routed or treated as missing active material.
        const allAvailable = await WSM.Context.listWorldbookEntries({ includeDisabled: true });
        const activeBookNames = new Set([
            ...(await WSM.Context.listEnabledWorldNames?.() || []),
            ...allAvailable.map((entry) => entry.bookName),
        ]);
        const found = new Set(allAvailable.map((entry) => entry.key));
        const missing = config.entryKeys.filter((key) => activeBookNames.has(bookNameFromEntryKey(key)) && !found.has(key));
        if (missing.length) {
            await setWorldbookPrompts({});
            const error = `无法读取 ${missing.length} 条当前世界书中的已勾选条目；为避免原文泄漏，已阻止正文请求`;
            lastStatus = { state: 'blocked', message: error, at: Date.now() };
            return { enabled: true, blocked: true, error };
        }
        const selected = new Set(config.entryKeys);
        const entries = allAvailable.filter((entry) => entry.enabled && selected.has(entry.key));
        if (!entries.length) {
            await setWorldbookPrompts({});
            return { enabled: true, removed: 0, injected: false };
        }
        const removed = redactOriginals(chat, entries);
        // A manually edited “最终注入” is the complete one-shot payload. The
        // selected originals still have to be redacted, but adding routed rules
        // beside the override would duplicate content the user already edited.
        if (text(WSM.Storage?.load?.()?.runtime?.finalInjectionOverride)) {
            await setWorldbookPrompts({});
            lastDelivery = { at: Date.now(), injected: false, manualOverride: true, removedOriginalOccurrences: removed, chars: 0 };
            return { enabled: true, removed, injected: false, manualOverride: true };
        }
        try {
            const prepared = await prepare(config, entries, contextFromMessages(chat, config.contextMessages), { localOnly: true, routeKey: routeKeyFromMessages(chat) });
            const injected = await setWorldbookPrompts(prepared.routedByDepth) || injectText(chat, prepared.routed);
            lastStatus = { state: 'ready', message: `已剔除 ${removed} 处原文，注入 ${prepared.routed.length} 字`, at: Date.now() };
            lastDelivery = { at: Date.now(), injected, fallback: false, removedOriginalOccurrences: removed, chars: prepared.routed.length };
            return { enabled: true, removed, injected, length: prepared.routed.length };
        } catch (error) {
            const cached = entries.map((entry) => loadCache()[entry.key]).filter(Boolean);
            const fallback = fallbackText(cached, config.budget);
            const fallbackByDepth = Object.fromEntries([...new Set(cached.map((item) => Number(item?.compiled?.depth ?? 4)))].map((depth) => [depth, fallbackText(cached.filter((item) => Number(item?.compiled?.depth ?? 4) === depth), config.budget)]).filter(([, value]) => value));
            const injected = await setWorldbookPrompts(fallbackByDepth) || injectText(chat, fallback);
            const message = text(error?.message || error);
            lastStatus = { state: !fallback ? 'blocked' : 'error', message, at: Date.now() };
            lastDelivery = { at: Date.now(), injected, fallback: !!fallback, removedOriginalOccurrences: removed, chars: fallback.length, error: message };
            return { enabled: true, removed, injected, fallback: !!fallback, blocked: !fallback, error: message };
        }
    }
    async function compileConfig(configValue, options = {}) {
        return WSM.Api.withCallBudget(1, 'worldbook-update', async () => {
            const config = normalizeConfig(configValue);
            const explicit = Array.isArray(options.entries) ? options.entries : null;
            const selected = new Set(config.entryKeys);
            const entries = explicit
                ? explicit.filter((entry) => selected.has(entry.key) && entry.content)
                : await resolveSelectedEntries(config, { includeDisabled: true });
            if (!entries.length) throw new Error('请至少勾选一条当前可读取的世界书条目');
            await ensureCompiled(config, entries, { force: options.force === true });
            lastStatus = { state: 'ready', message: `已一次性处理 ${entries.length} 条世界书（API 1/1）`, at: Date.now() };
            return { count: entries.length };
        });
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
        setWorldbookPrompts,
        compileConfig,
        ingestReadResult,
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
        _test: { hash, contextFromMessages, redactOriginals, injectText, fallbackText, splitCompileBatch, compiledResultItems, localRoute, sourceFallbackRule, routeKeyFromMessages },
    };
})();
