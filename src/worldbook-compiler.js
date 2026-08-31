(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const CACHE_KEY = 'wsm_worldbook_compiler_cache_v2';
    const PROMPT_PREFIX = 'WORLD_STATE_MACHINE_WORLDBOOK_DEPTH_';
    let activeTurn = null;
    let lastDelivery = null;
    let lastStatus = { state: 'idle', message: '尚未运行', at: 0 };
    let registeredWorldbookDepths = new Set();
    let nativeWorldbookFilterBound = false;
    let nativeWorldbookFilterSource = null;

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
    function nativeEntryKey(entry) {
        const explicit = text(entry?.key);
        if (explicit) return explicit;
        const bookName = text(entry?.world || entry?.bookName || entry?.book);
        const entryId = text(entry?.uid ?? entry?.id);
        return bookName && entryId ? `${encodeURIComponent(bookName)}::${encodeURIComponent(entryId)}` : '';
    }
    function filterNativeWorldbookEntries(payload, config = normalizeConfig()) {
        if (!config.enabled || !config.entryKeys.length || !payload || typeof payload !== 'object') return 0;
        const selected = new Set(config.entryKeys.map(String));
        let removed = 0;
        for (const key of ['globalLore','characterLore','chatLore','personaLore']) {
            const entries = payload[key];
            if (!Array.isArray(entries)) continue;
            for (let index = entries.length - 1; index >= 0; index -= 1) {
                if (!selected.has(nativeEntryKey(entries[index]))) continue;
                entries.splice(index, 1);
                removed += 1;
            }
        }
        return removed;
    }
    function installNativeWorldbookFilter() {
        const ctx = WSM.Context?.context?.();
        const source = ctx?.eventSource || window.eventSource;
        const events = ctx?.eventTypes || ctx?.event_types || window.event_types;
        const eventName = events?.WORLDINFO_ENTRIES_LOADED || 'worldinfo_entries_loaded';
        if (!source?.on || !eventName) return false;
        if (nativeWorldbookFilterBound && nativeWorldbookFilterSource === source) return true;
        if (nativeWorldbookFilterBound && nativeWorldbookFilterSource?.off) {
            nativeWorldbookFilterSource.off(eventName, filterNativeWorldbookEntries);
        }
        source.on(eventName, filterNativeWorldbookEntries);
        nativeWorldbookFilterBound = true;
        nativeWorldbookFilterSource = source;
        return true;
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
    function uniqueRules(value, limit) {
        const seen = [];
        for (const item of (Array.isArray(value) ? value : [value]).map(text).filter(Boolean)) {
            const key = item.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
            if (!key || seen.some((entry) => entry.key === key || (Math.min(entry.key.length, key.length) >= 12 && (entry.key.includes(key) || key.includes(entry.key))))) continue;
            seen.push({ value: item, key });
            if (seen.length >= limit) break;
        }
        return seen.map((entry) => entry.value);
    }
    function compactRuleGroups(item) {
        const groups = {
            core: uniqueRules(item?.core, 3),
            triggers: uniqueRules(item?.triggers || item?.when, 2),
            rules: uniqueRules(item?.rules || item?.conditionalRules || item?.rule, 5),
            background: uniqueRules(item?.background, 2),
        };
        let remaining = 12;
        for (const key of ['core','rules','triggers','background']) {
            groups[key] = groups[key].slice(0, remaining);
            remaining -= groups[key].length;
        }
        return groups;
    }
    function fragmentText(value) { return text(value?.text || value?.content || value?.rule || value?.fact || value); }
    function fragmentCues(value, fallback = []) {
        const explicit = value?.cues || value?.keywords || value?.triggers || value?.when;
        return uniqueRules([...(Array.isArray(explicit) ? explicit : explicit ? [explicit] : []), ...fallback], 8).map((cue) => cue.slice(0, 30));
    }
    function normalizeFragments(item, groups) {
        const globalCues = uniqueRules(item?.triggers || item?.when, 8);
        const raw = Array.isArray(item?.fragments) ? item.fragments : [];
        const fragments = raw.map((fragment) => ({
            type: ['rule','character','background','location','history','fact','exception','other'].includes(text(fragment?.type)) ? text(fragment.type) : 'other',
            cues: fragmentCues(fragment), text: fragmentText(fragment).slice(0, 220),
        })).filter((fragment) => fragment.text);
        const byText = new Map(fragments.map((fragment) => [fragment.text, fragment]));
        [...groups.rules.map((value) => ['rule', value]), ...groups.background.map((value) => ['background', value])].forEach(([type, value]) => {
            if (!byText.has(value)) byText.set(value, { type, cues: fragmentCues({}, globalCues), text: value });
        });
        return [...byText.values()].slice(0, 9);
    }
    function sourceRuleGroups(content) {
        const lines = text(content).replace(/<\/?[^>\n]+>/g, '\n').replace(/\r/g, '').split(/\n+/).map(text).filter(Boolean);
        const joined = [];
        const startsUnit = (value) => /^(?:[-·•*]|\d+[.．、]|[一二三四五六七八九十]+[、，.．])/.test(value);
        lines.forEach((line) => {
            const previous = joined.at(-1);
            if (previous && !/[。！？；：:]$/.test(previous) && !startsUnit(line)) joined[joined.length - 1] = `${previous}${line}`;
            else joined.push(line);
        });
        const units = joined.flatMap((line) => line.split(/(?<=[。！？；])/)).map((line) => text(line).replace(/^(?:[-·•*]|\d+[.．、]|[一二三四五六七八九十]+[、，.．])\s*/, '')).filter((line) => line.length >= 12 && !/^(?:核心原则|总结|空间与礼法|言行与身份|情节推动|触发情境|条件规则|必要背景)[：:]?$/.test(line));
        const actionable = units.filter((line) => /(必须|不得|禁止|严禁|不可|绝无可能|除非|需要|只能|应当|应先|应以|基本准则|禁区|限制|前提|意味着|首要)/.test(line));
        const dimensions = [
            /(许可|权限|禁区)/, /(外出|内外有别|大门不出)/, /(陪同|仆人|仆从|侍从|旁观者|监督)/,
            /(男女|身体|授受不亲|肢体)/, /(公开|公共|职责|体面)/, /(宴席|媒妁|传信|合法.*场合)/,
            /(场合问|身份问|现实问|生成.*前|检查)/, /(身份|官位|家族|社会角色)/,
        ];
        const dimensionalRules = [];
        dimensions.forEach((pattern) => {
            const found = actionable.find((line) => pattern.test(line) && !dimensionalRules.includes(line));
            if (found) dimensionalRules.push(found);
        });
        actionable.forEach((line) => { if (!dimensionalRules.includes(line)) dimensionalRules.push(line); });
        const selectedRules = uniqueRules(dimensionalRules, 5);
        const selectedKeys = new Set(selectedRules.map((line) => line.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')));
        const triggerLike = units.filter((line) => /(公开场合|私下|外出|内宅|内闱|宴席|媒妁|仆人传信|男女之间|场合问|身份问|现实问|生成任何.*前)/.test(line))
            .filter((line) => !selectedKeys.has(line.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')));
        const coreLike = units.filter((line) => /(核心原则|黄金法则|每一个动作|每一句言语|必须在其身份|最高原则)/.test(line));
        const backgroundLike = units.filter((line) => /(世界观|社会秩序|时代背景|礼法|身份的象征与束缚|张力正源于)/.test(line) && !actionable.includes(line));
        return compactRuleGroups({
            core: coreLike.map((line) => line.slice(0, 180)),
            triggers: triggerLike.map((line) => line.slice(0, 180)),
            rules: selectedRules.map((line) => line.slice(0, 180)),
            background: backgroundLike.map((line) => line.slice(0, 180)),
        });
    }
    function meaningfulRule(value) {
        const rule = text(value).replace(/<\/?[^>]+>/g, '').trim();
        if (rule.length < 12 || /^(?:核心原则|触发情境|条件规则|必要背景)[：:]?$/.test(rule)) return '';
        return rule;
    }
    function normalizeCompiled(item, entry) {
        const rawFragments = Array.isArray(item?.fragments) ? item.fragments : [];
        const fragmentRules = rawFragments.filter((fragment) => ['rule','exception'].includes(text(fragment?.type))).map(fragmentText);
        const fragmentBackground = rawFragments.filter((fragment) => !['rule','exception'].includes(text(fragment?.type))).map(fragmentText);
        const fragmentTriggers = rawFragments.flatMap((fragment) => fragmentCues(fragment));
        const modelGroups = compactRuleGroups({
            ...item,
            rules: [...(Array.isArray(item?.rules) ? item.rules : []), ...fragmentRules],
            background: [...(Array.isArray(item?.background) ? item.background : []), ...fragmentBackground],
            triggers: [...(Array.isArray(item?.triggers) ? item.triggers : []), ...fragmentTriggers],
        });
        const localGroups = sourceRuleGroups(entry?.content);
        const modelExecutable = [...modelGroups.core, ...modelGroups.rules].filter((line) => /(必须|不得|禁止|严禁|不可|除非|需要|只能|应当|限制|规则|原则)/.test(line)).length;
        const needsCoverageRepair = localGroups.rules.length >= 3 && (modelGroups.rules.length < 2 || modelExecutable < 3);
        const groups = compactRuleGroups(needsCoverageRepair ? {
            core: [...modelGroups.core.map(meaningfulRule).filter(Boolean), ...localGroups.core],
            triggers: [...localGroups.triggers, ...modelGroups.triggers.map(meaningfulRule).filter(Boolean)],
            rules: [...localGroups.rules, ...modelGroups.rules.map(meaningfulRule).filter(Boolean)],
            background: [...modelGroups.background.map(meaningfulRule).filter(Boolean), ...localGroups.background],
        } : modelGroups);
        return {
            key: entry.key,
            bookName: entry.bookName,
            label: entry.comment || entry.bookName,
            depth: Math.max(0, Math.min(100, Math.round(Number(entry.depth ?? 4) || 0))),
            role: Number(entry.role ?? 0) || 0,
            ...groups,
            fragments: normalizeFragments(item, groups),
        };
    }
    function compiledResultItems(result, batch = []) {
        const arrays = [result?.entries, result?.results, result?.items, result?.data?.entries, result?.data?.items];
        const listed = arrays.find(Array.isArray);
        if (listed) return listed;
        if (batch.length !== 1 || !result || typeof result !== 'object') return [];
        const looksCompiled = (value) => value && typeof value === 'object' && ['core', 'fragments', 'triggers', 'when', 'rules', 'conditionalRules', 'rule', 'background'].some((key) => Object.prototype.hasOwnProperty.call(value, key));
        if (looksCompiled(result.entry)) return [result.entry];
        if (looksCompiled(result)) return [result];
        const nested = Object.values(result).filter(looksCompiled);
        return nested.length === 1 ? nested : [];
    }
    function sourceFallbackRule(entry) {
        const content = text(entry?.content);
        const cueWords = (value) => uniqueRules([
            ...(entry?.keys || []), entry?.comment,
            ...((text(value).match(/(?:皇权|选秀|礼法|内宅|外出|公开场合|私下|男女|侍从|仆人|宴席|媒妁|传信|官位|身份|家族|朝政|宫廷|战争|地点|秘密)/g)) || []),
        ], 8);
        const operational = sourceRuleGroups(content);
        if ([...operational.core, ...operational.triggers, ...operational.rules, ...operational.background].length >= 3) {
            return {
                key: entry.key,
                core: operational.core,
                fragments: [
                    ...operational.rules.map((value) => ({ type: 'rule', cues: cueWords(value), text: value })),
                    ...operational.background.map((value) => ({ type: 'background', cues: cueWords(value), text: value })),
                ].slice(0, 9),
            };
        }
        const pieces = content.split(/\n+|(?<=[。！？；])/).map(text).filter(Boolean);
        const fragments = [];
        let used = 0;
        for (const piece of pieces) {
            if (used >= 1600 || fragments.length >= 9) break;
            const value = piece.slice(0, Math.max(0, 1200 - used));
            if (value) { fragments.push({ type: 'other', cues: cueWords(value), text: value }); used += value.length; }
        }
        return { key: entry.key, core: [], fragments };
    }
    function ingestReadResult(source, result) {
        const config = normalizeConfig();
        const selected = new Set(config.entryKeys);
        const entries = (source?.worldbooks || []).flatMap((book) => book.entries || []).filter((entry) => entry?.content && selected.has(entry.key));
        if (!entries.length) return { count: 0, report: buildReport(null) };
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
                    '你是通用世界书语义拆解器。世界书可能是人物、背景故事、地点、组织、制度、规则、历史或秘密。一次响应完成全部条目，不得改变事实、规则强度、例外、身份和权力边界。每条拆成两层：core只放无论当前话题为何、只要可能影响角色回复就不能缺失的0–3条核心锚点；普通人物、地点或历史细节不得因为重要就常驻。其余内容拆成fragments，每片必须是独立完整事实或规则，并附2–8个可被本轮人物名、地点、组织、事件、主题或情境命中的cues。人物被提及才检索其人物片段，进入地点才检索地点片段，谈到皇权/选秀才检索相应制度片段；禁止把所有细节塞进core。规则条目必须覆盖原文独立约束维度，不能只摘录开头、标题、口号、半句或换行残句。每原条目core最多3、fragments最多9，总计最多12。只输出严格JSON：{"entries":[{"key":"原key","core":["可为空的少量常驻锚点"],"fragments":[{"type":"rule|character|background|location|history|fact|exception|other","cues":["检索词或情境"],"text":"命中时发送的完整片段"}]}]}。禁止续写、增加设定、Markdown或后续调用。',
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
        const lines = compiled.flatMap((item) => item.compiled?.core || []);
        return [...new Set(lines)].join('\n').slice(0, budget);
    }
    function reportEntry(value) {
        const compiled = value?.compiled || value;
        if (!compiled || typeof compiled !== 'object') return null;
        const groups = compactRuleGroups(compiled);
        if (![...groups.core, ...groups.triggers, ...groups.rules, ...groups.background].length) return null;
        return {
            key: text(compiled.key),
            bookName: text(compiled.bookName),
            label: text(compiled.label),
            depth: Math.max(0, Math.min(100, Math.round(Number(compiled.depth ?? 4) || 0))),
            ...groups,
            fragments: (Array.isArray(compiled.fragments) ? compiled.fragments : []).map((fragment) => ({ type: text(fragment?.type || 'other'), cues: fragmentCues(fragment), text: fragmentText(fragment) })).filter((fragment) => fragment.text).slice(0, 9),
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
                    `你是逐轮世界书语义路由器。currentContext是酒馆实际正文。保留少量core；带cues的fragments只有其人物、地点、组织、历史、主题或情境与本轮相关时才选择，不得整条全发。合并重复内容，不得续写、增加设定或弱化禁令。只输出严格JSON {"text":"候选纯文本资料"}，text不超过${config.budget}个汉字；除core外没有相关片段时不添加其他内容。`,
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
        const groups = new Map();
        compiled.forEach((item) => {
            const rule = item?.compiled || {};
            const depth = Math.max(0, Math.min(100, Math.round(Number(item?.compiled?.depth ?? 4) || 0)));
            if (!groups.has(depth)) groups.set(depth, []);
            const lines = [...(rule.core || [])];
            const entryCues = [rule.label, rule.bookName, ...(rule.triggers || [])].map(text).filter(Boolean);
            const entryMatched = entryCues.some((cue) => contextText.includes(cue.toLowerCase()));
            const fragments = (Array.isArray(rule.fragments) ? rule.fragments : []).map((fragment, index) => {
                const cues = fragmentCues(fragment, entryCues);
                let score = cues.reduce((sum, cue) => sum + (contextText.includes(cue.toLowerCase()) ? 12 : 0), 0);
                relevanceTerms(fragment.text).forEach((term) => { if (contextTerms.has(term) && !/^(人物|角色|当前|必须|不得|可以|一个|这个|进行|情况)$/.test(term)) score += 1; });
                if (entryMatched) score += 4;
                return { fragment, score, index };
            }).filter((candidate) => candidate.score >= 4).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4);
            lines.push(...fragments.map((candidate) => candidate.fragment.text));
            groups.get(depth).push(...lines);
        });
        const routedByDepth = {};
        const perDepthBudget = Math.max(120, Math.floor(config.budget / Math.max(1, groups.size)));
        groups.forEach((items, depth) => {
            const value = uniqueRules(items, items.length).join('\n').slice(0, perDepthBudget);
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
                `你是逐轮世界书语义路由器。compiledRules包含少量core与带cues的fragments，currentContext是本轮酒馆正文。core保留；fragments只有其人物、地点、组织、事件、主题或情境与本轮相关时才抽取。例如谈到皇权才取皇权片段，要选秀才取选秀片段；不得把同条目的全部片段一起输出。不得续写、增加设定或弱化禁令。只输出严格JSON：{"text":"不超过 ${config.budget} 个汉字的本轮资料","byDepth":{"4":"按深度分组的资料"}}。同一轮只能完成一次路由。`,
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
                fragments: normalizeFragments({ ...value, fragments: Array.isArray(value?.fragments) ? value.fragments : [] }, compactRuleGroups(value)),
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
        installNativeWorldbookFilter,
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
        _test: { hash, contextFromMessages, redactOriginals, injectText, fallbackText, splitCompileBatch, compiledResultItems, localRoute, sourceFallbackRule, sourceRuleGroups, routeKeyFromMessages, compactRuleGroups, filterNativeWorldbookEntries, nativeEntryKey },
    };
})();
