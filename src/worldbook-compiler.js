(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const CACHE_KEY = 'wsm_worldbook_compiler_cache_v3';
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
    function paragraphRecords(entry) {
        const raw = String(entry?.content || '').replace(/\r\n?/g, '\n');
        const blocks = raw.split(/\n\s*\n+/).map((value) => value.trim()).filter(Boolean);
        return (blocks.length ? blocks : (raw.trim() ? [raw.trim()] : [])).map((content, index) => ({
            id: `p${index + 1}`,
            index: index + 1,
            content,
            sourceRef: `worldbook:${text(entry?.bookName) || 'unknown'}:${text(entry?.id ?? entry?.key) || 'entry'}:p${index + 1}`,
        }));
    }
    function semanticParts(value, maximum = 400) {
        const input = text(value);
        if (!input) return [];
        if (input.length <= maximum) return [input];
        const sentences = input.split(/(?<=[。！？；!?;])\s*/).map(text).filter(Boolean);
        const parts = [];
        let current = '';
        const push = () => { if (current) parts.push(current); current = ''; };
        sentences.forEach((sentence) => {
            if (sentence.length > maximum) {
                push();
                for (let offset = 0; offset < sentence.length; offset += maximum) parts.push(sentence.slice(offset, offset + maximum));
                return;
            }
            if (current && current.length + sentence.length > maximum) push();
            current += sentence;
        });
        push();
        return parts;
    }
    function buildSemanticChunks(entry, paragraphs = paragraphRecords(entry)) {
        const units = paragraphs.flatMap((paragraph) => semanticParts(paragraph.content).map((content, partIndex) => ({
            content, paragraphId: paragraph.id, partIndex, sourceRef: paragraph.sourceRef,
        })));
        const chunks = [];
        let current = null;
        units.forEach((unit) => {
            if (!current || current.text.length + unit.content.length + (current.text ? 1 : 0) > 1200) {
                current = { id: `chunk_${String(chunks.length + 1).padStart(3, '0')}`, title: text(entry?.comment || entry?.bookName || `世界书分块${chunks.length + 1}`), paragraphIds: [], sourceRefs: [], factIds: [], dependencyFactIds: [], text: '' };
                chunks.push(current);
            }
            current.text = [current.text, unit.content].filter(Boolean).join('\n');
            if (!current.paragraphIds.includes(unit.paragraphId)) current.paragraphIds.push(unit.paragraphId);
            if (!current.sourceRefs.includes(unit.sourceRef)) current.sourceRefs.push(unit.sourceRef);
        });
        return chunks;
    }
    function entryOwner(entry, sentence = '') {
        const heading = `${text(entry?.comment)} ${text(entry?.bookName)}`;
        const value = `${heading} ${sentence}`;
        if (/(秘密|真相|隐瞒|不知情|知情者|线索|谜底|暗中)/.test(value)) return 'knowledge';
        if (/(地图|地点|地区|国家|城市|街区|建筑|宫殿|房间|路线|位于|相邻|通往)/.test(value)) return 'map';
        if (/(人物|角色|姓名|身份档案|生平|性格|NPC)/i.test(heading)) return 'characters';
        if (/(任务|目标|委托|完成条件)/.test(heading)) return 'tasks';
        if (/(物品|道具|装备|持有|库存)/.test(heading)) return 'resourceConstraints';
        if (/(必须|不得|禁止|严禁|不可|只能|除非|例外|权限|法律|皇权|阶级|礼法|规则|原则|前置条件)/.test(value)) return 'worldRules';
        return 'worldbook';
    }
    function sentenceFacts(entry, chunks) {
        const facts = [];
        chunks.forEach((chunk) => {
            const pieces = chunk.text.split(/(?<=[。！？；!?;])\s*|\n+/).map(text).filter(Boolean);
            pieces.forEach((statement, index) => {
                const owner = entryOwner(entry, statement);
                const sourceRefs = [...chunk.sourceRefs];
                const factId = `wb_${hash(`${entry.key}|${chunk.id}|${index}|${statement}`)}`;
                const scope = [...new Set((statement.match(/(?:政治|法律|身份|宫廷|礼仪|地点|路线|权限|人物|关系|秘密|任务|物品|魔法|物理|组织|历史)/g) || []))];
                const conditions = (statement.match(/(?:当|若|如果|只有|仅当)[^，。；]{2,80}/g) || []).map(text);
                const exceptions = (statement.match(/(?:除非|例外(?:是|为)?|但若|但在)[^。；]{2,100}/g) || []).map(text);
                const situationalCues = /(公共场所|公开场合|旁观者|路人)/.test(statement) ? ['公共场所','公开场合','旁观者','路人','飞机','车站','餐厅','街道'] : [];
                const cues = uniqueRules([...(entry.keys || []), entry.comment, ...scope, ...situationalCues, ...(statement.match(/[\u3400-\u9fff]{2,8}/g) || []).slice(0, 6)], 14);
                const knowledgeBoundary = owner === 'knowledge' ? {
                    knownBy: [], believedBy: [], suspectedBy: [], misunderstoodBy: [], unknownTo: ['user'],
                    discoveryPaths: [], maturityConditions: [],
                } : null;
                facts.push(WSM.Facts.normalize({
                    factId, owner, consumers: owner === 'worldRules' ? ['characters','relationships','tasks','map','worldbook'] : [owner, 'worldbook'],
                    delivery: owner === 'worldRules' && entry.constant === true ? 'resident' : (owner === 'worldbook' ? 'lookup' : 'conditional'),
                    scope, sourceRefs, statement, conditions, exceptions,
                    precedence: owner === 'worldRules' ? 70 : 50, cues, depth: entry.depth, type: owner === 'worldRules' ? 'rule' : owner,
                    priority: owner === 'worldRules' ? 'L3' : 'L2', knowledgeBoundary,
                }));
                chunk.factIds.push(factId);
            });
        });
        return facts;
    }
    function mergeModelFacts(localFacts, item, entry) {
        const modelFacts = (Array.isArray(item?.facts) ? item.facts : []).map((fact) => WSM.Facts.normalize(fact, {
            owner: entryOwner(entry, text(fact?.statement || fact?.text)), sourceRefs: [`worldbook:${entry.bookName}:${entry.id ?? entry.key}`], depth: entry.depth,
        })).filter((fact) => fact.statement);
        if (!modelFacts.length) return localFacts;
        const result = [...localFacts];
        modelFacts.forEach((modelFact) => {
            const canonical = modelFact.statement.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
            const index = result.findIndex((fact) => {
                const value = fact.statement.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
                return value === canonical || (Math.min(value.length, canonical.length) >= 12 && (value.includes(canonical) || canonical.includes(value)));
            });
            if (index >= 0) result[index] = WSM.Facts.merge([result[index], { ...modelFact, factId: result[index].factId, sourceRefs: [...result[index].sourceRefs, ...modelFact.sourceRefs] }])[0];
        });
        return result;
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
        const paragraphs = paragraphRecords(entry);
        const chunks = buildSemanticChunks(entry, paragraphs);
        const facts = mergeModelFacts(sentenceFacts(entry, chunks), item, entry);
        const factById = new Map(facts.map((fact) => [fact.factId, fact]));
        chunks.forEach((chunk) => {
            chunk.factIds = [...new Set(chunk.factIds)];
            const chunkFacts = chunk.factIds.map((id) => factById.get(id)).filter(Boolean);
            chunk.dependencyFactIds = [...new Set(chunkFacts.flatMap((fact) => fact.dependencyFactIds || []))];
            chunk.entities = uniqueRules(chunkFacts.filter((fact) => ['characters','map','knowledge'].includes(fact.owner)).flatMap((fact) => fact.cues || []), 24);
            chunk.situations = uniqueRules(chunkFacts.flatMap((fact) => fact.scope || []), 16);
        });
        const coverage = Object.fromEntries(paragraphs.map((paragraph) => [paragraph.id, chunks.filter((chunk) => chunk.paragraphIds.includes(paragraph.id)).map((chunk) => chunk.id)]));
        // Keep an exact immutable copy for audit/export. Chunks may normalize
        // paragraph separators for retrieval, but never replace source text.
        const compiledText = String(entry.content || '');
        return {
            key: entry.key,
            entryId: text(entry.id ?? entry.key),
            bookName: entry.bookName,
            label: entry.comment || entry.bookName,
            depth: Math.max(0, Math.min(100, Math.round(Number(entry.depth ?? 4) || 0))),
            role: Number(entry.role ?? 0) || 0,
            sourceHash: hash(entry.content),
            sourceEnabled: entry.enabled !== false,
            originalChars: String(entry.content || '').length,
            compiledChars: compiledText.length,
            compiledText,
            coverage,
            chunks,
            facts,
            ...groups,
            fragments: normalizeFragments(item, groups),
        };
    }
    function compiledResultItems(result, batch = []) {
        const arrays = [result?.entries, result?.results, result?.items, result?.data?.entries, result?.data?.items];
        const listed = arrays.find(Array.isArray);
        if (listed) return listed;
        if (batch.length !== 1 || !result || typeof result !== 'object') return [];
        const looksCompiled = (value) => value && typeof value === 'object' && ['facts', 'core', 'fragments', 'triggers', 'when', 'rules', 'conditionalRules', 'rule', 'background'].some((key) => Object.prototype.hasOwnProperty.call(value, key));
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
        let availabilityChanged = false;
        entries.forEach((entry) => {
            const compiled = cache[entry.key]?.compiled;
            const sourceEnabled = entry.enabled !== false;
            if (compiled && compiled.sourceEnabled !== sourceEnabled) {
                compiled.sourceEnabled = sourceEnabled;
                availabilityChanged = true;
            }
        });
        if (availabilityChanged) saveCache(cache);
        const missing = entries.filter((entry) => options.force === true || cache[entry.key]?.sourceHash !== hash(entry.content) || !cache[entry.key]?.compiled);
        if (missing.length) {
            // Build the lossless local representation first. Model classification
            // is optional enrichment; it can never be the only copy of a source
            // paragraph and therefore cannot truncate the middle of an entry.
            missing.forEach((entry) => {
                cache[entry.key] = {
                    sourceHash: hash(entry.content), compiledAt: Date.now(),
                    compiled: normalizeCompiled(sourceFallbackRule(entry), entry),
                };
            });
            saveCache(cache);
        }
        if (missing.length && options.localOnly !== true) {
            const requestEntries = missing.map((entry) => ({
                key: entry.key, book: entry.bookName, title: entry.comment,
                content: text(entry.content), originalChars: text(entry.content).length,
            }));
            const requestChars = JSON.stringify(requestEntries).length;
            lastStatus = { state: 'compiling', message: `正在一次性拆解 ${missing.length} 条世界书（API 上限 1 次）`, at: Date.now() };
            let items = [];
            try {
                if (requestChars > 8000) throw Object.assign(new Error('世界书超过单次安全分类预算；已保留完整本地编译，不发送截断版本'), { localLossless: true });
                const result = await WSM.Api.complete(
                    '你是世界书事实分类器。输入保留完整原文；不得改写、删减、续写或增加设定。为每条原文识别可独立引用的事实，返回稳定分类字段：owner只能是worldRules、map、characters、knowledge、resourceConstraints、tasks、events、worldbook之一；delivery只能是resident、conditional、lookup、local；硬规则必须把statement、scope、conditions、exceptions作为不可分割单元。秘密必须给knowledgeBoundary。只输出严格JSON：{"entries":[{"key":"原key","facts":[{"statement":"原文事实","owner":"worldbook","consumers":[],"delivery":"lookup","scope":[],"conditions":[],"exceptions":[],"precedence":50,"cues":[]}]}]}。本结果只补充本地无损编译的分类，不替代原文、段落覆盖或分块。',
                    { task: 'WORLDBOOK_COMPILE_ONCE', entries: requestEntries },
                    { maxTokens: Math.min(6000, 1000 + missing.length * 500), singleAttempt: true },
                );
                items = compiledResultItems(result, requestEntries);
            } catch (error) {
                if (!error?.localLossless) console.warn('[WorldStateMachine] 世界书唯一一次分类请求失败，使用本地无损编译，不重试', error);
                lastStatus = { state: error?.localLossless ? 'ready' : 'error', message: text(error?.message || error), at: Date.now() };
            }
            missing.forEach((entry) => {
                const matched = items.find((item) => text(item?.key) === entry.key);
                cache[entry.key] = {
                    sourceHash: hash(entry.content), compiledAt: Date.now(),
                    compiled: normalizeCompiled(matched || cache[entry.key]?.compiled || sourceFallbackRule(entry), entry),
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
        if (![...groups.core, ...groups.triggers, ...groups.rules, ...groups.background].length && !compiled.facts?.length && !compiled.chunks?.length) return null;
        return {
            key: text(compiled.key),
            entryId: text(compiled.entryId),
            bookName: text(compiled.bookName),
            label: text(compiled.label),
            depth: Math.max(0, Math.min(100, Math.round(Number(compiled.depth ?? 4) || 0))),
            sourceHash: text(compiled.sourceHash),
            sourceEnabled: compiled.sourceEnabled !== false,
            originalChars: Number(compiled.originalChars || 0),
            compiledChars: Number(compiled.compiledChars || 0),
            coverage: clone(compiled.coverage || {}),
            chunks: clone(compiled.chunks || []),
            facts: clone(compiled.facts || []),
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
        // This report is also the UI/audit catalog. Keep every cached source
        // projection visible even when only a smaller subset routed this turn.
        const entries = cachedEntries.length ? cachedEntries : turnEntries;
        const routedText = text(prepared?.routed || extra.routedText);
        return {
            enabled: config.enabled,
            selectedCount: config.entryKeys.length,
            compiledCount: entries.length,
            entries,
            routedText,
            routedByDepth: clone(prepared?.routedByDepth || extra.routedByDepth || {}),
            routedFacts: clone(prepared?.routedFacts || extra.routedFacts || []),
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
    function selectStructuredFacts(config, compiled, currentContext) {
        const contextText = text(JSON.stringify(currentContext)).toLowerCase();
        const contextTerms = relevanceTerms(contextText);
        const catalog = WSM.Facts.merge(compiled.flatMap((item) => item?.compiled?.facts || []));
        const ranked = catalog.map((fact, index) => {
            let score = fact.delivery === 'resident' ? 1000 : 0;
            [...(fact.cues || []), ...(fact.scope || [])].forEach((cue) => { if (cue && contextText.includes(String(cue).toLowerCase())) score += 20; });
            relevanceTerms(fact.statement).forEach((term) => { if (contextTerms.has(term) && !/^(人物|角色|当前|必须|不得|可以|一个|这个|进行|情况)$/.test(term)) score += 1; });
            if (fact.owner === 'worldRules' && score > 0) score += 8;
            return { fact, score, index };
        }).filter((item) => item.fact.delivery === 'resident' || item.score >= 4)
            .sort((a, b) => b.score - a.score || b.fact.precedence - a.fact.precedence || a.index - b.index);
        const selected = [];
        let used = 0;
        ranked.forEach(({ fact }) => {
            const rendered = WSM.Facts.render(fact);
            const protectedRule = fact.owner === 'worldRules' || fact.type === 'rule';
            if (!protectedRule && used + rendered.length > Math.max(config.budget, 500)) return;
            selected.push(fact);
            used += rendered.length + 1;
        });
        return WSM.Facts.expandDependencies(selected, catalog);
    }
    function routedFromFacts(facts = []) {
        const byDepth = {};
        facts.forEach((fact) => {
            const depth = Math.max(0, Math.min(100, Math.round(Number(fact.depth ?? 4) || 0)));
            const rendered = WSM.Facts.render(fact);
            if (!rendered) return;
            (byDepth[depth] ||= []).push(rendered);
        });
        const normalized = Object.fromEntries(Object.entries(byDepth).map(([depth, lines]) => [depth, [...new Set(lines)].join('\n')]));
        return { text: Object.values(normalized).join('\n'), byDepth: normalized };
    }
    function localRoute(config, compiled, currentContext) {
        const facts = selectStructuredFacts(config, compiled, currentContext);
        if (facts.length) return { ...routedFromFacts(facts), facts };
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
        return { text: Object.values(routedByDepth).join('\n').slice(0, config.budget), byDepth: routedByDepth, facts: [] };
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
        // Build immutable facts and static catalogs for every selected entry.
        // Only the per-turn relevance pass is bounded; the base map, rules and
        // paragraph coverage never inherit that routing bound.
        const allCompiled = await ensureCompiled(config, entries, options);
        const routedEntries = options.localOnly === true ? localCandidateEntries(entries, currentContext) : entries;
        const routedKeys = new Set(routedEntries.map((entry) => entry.key));
        const compiled = options.localOnly === true ? allCompiled.filter((item) => routedKeys.has(item?.compiled?.key)) : allCompiled;
        let routed;
        let routedByDepth;
        let routedFacts = [];
        try {
            const result = options.localOnly === true
                ? localRoute(config, compiled, currentContext)
                : await route(config, compiled, currentContext);
            routedFacts = result.facts?.length ? result.facts : selectStructuredFacts(config, compiled, currentContext);
            const structured = routedFacts.length ? routedFromFacts(routedFacts) : result;
            routed = structured.text;
            routedByDepth = structured.byDepth;
        }
        catch (error) {
            routedFacts = selectStructuredFacts(config, compiled, currentContext);
            const structured = routedFromFacts(routedFacts);
            routed = structured.text || fallbackText(compiled, config.budget);
            if (!routed) throw error;
            routedByDepth = Object.keys(structured.byDepth).length ? structured.byDepth : Object.fromEntries([...new Set(compiled.map((item) => Number(item?.compiled?.depth ?? 4)))].map((depth) => [depth, fallbackText(compiled.filter((item) => Number(item?.compiled?.depth ?? 4) === depth), config.budget)]).filter(([, value]) => value));
            console.warn('[WorldStateMachine] 世界书逐轮路由失败，使用已拆解核心规则', error);
        }
        activeTurn = { key, routeKey, entryKeys: entries.map((entry) => entry.key), routed, routedByDepth, routedFacts, compiled, at: Date.now() };
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
        try {
            const prepared = await prepare(config, entries, contextFromMessages(source.chat, config.contextMessages), {
                localOnly: options.localOnly === true,
                routeKey: routeKeyFromMessages(source.chat),
            });
            source.compiledWorldbookRules = {
                text: prepared.routed,
                byDepth: prepared.routedByDepth,
                facts: clone(prepared.routedFacts || []),
                selectedEntryKeys: prepared.entryKeys,
                originalEntriesPreserved: entries.length,
                originalEntriesRemoved: 0,
            };
            lastStatus = { state: 'ready', message: `已为 Planner 路由 ${prepared.routed.length} 字世界书规则`, at: Date.now() };
            return { enabled: true, routed: prepared.routed, selected: entries.length, report: buildReport(prepared, { originalEntriesPreserved: entries.length, originalEntriesRemoved: 0 }) };
        } catch (error) {
            lastStatus = { state: 'error', message: text(error?.message || error), at: Date.now() };
            return { enabled: true, blocked: true, error: lastStatus.message };
        }
    }
    async function processChat(chat) {
        const config = normalizeConfig();
        // v0.13 delivers worldbook projections through the same final assembler
        // as state modules. Clear legacy standalone prompts to guarantee that
        // preview and the actual request are byte-for-byte equivalent.
        await setWorldbookPrompts({});
        if (!config.enabled || !config.entryKeys.length) {
            return { enabled: false };
        }
        // Only currently enabled ST entries participate in this turn. Disabled
        // entries may still be selected and precompiled from the settings UI,
        // but must not be routed or treated as missing active material.
        const allAvailable = await WSM.Context.listWorldbookEntries({ includeDisabled: true });
        syncEntryAvailability(allAvailable);
        const activeBookNames = new Set([
            ...(await WSM.Context.listEnabledWorldNames?.() || []),
            ...allAvailable.map((entry) => entry.bookName),
        ]);
        const found = new Set(allAvailable.map((entry) => entry.key));
        const missing = config.entryKeys.filter((key) => activeBookNames.has(bookNameFromEntryKey(key)) && !found.has(key));
        if (missing.length) {
            const error = `无法读取 ${missing.length} 条当前世界书中的已勾选条目；为避免原文泄漏，已阻止正文请求`;
            lastStatus = { state: 'blocked', message: error, at: Date.now() };
            return { enabled: true, blocked: true, error };
        }
        const selected = new Set(config.entryKeys);
        const entries = allAvailable.filter((entry) => entry.enabled && selected.has(entry.key));
        if (!entries.length) {
            return { enabled: true, removed: 0, injected: false };
        }
        const removed = redactOriginals(chat, entries);
        // A manually edited “最终注入” is the complete one-shot payload. The
        // selected originals still have to be redacted, but adding routed rules
        // beside the override would duplicate content the user already edited.
        if (text(WSM.Storage?.load?.()?.runtime?.finalInjectionOverride)) {
            lastDelivery = { at: Date.now(), injected: false, manualOverride: true, removedOriginalOccurrences: removed, chars: 0 };
            return { enabled: true, removed, injected: false, manualOverride: true };
        }
        try {
            const prepared = await prepare(config, entries, contextFromMessages(chat, config.contextMessages), { localOnly: true, routeKey: routeKeyFromMessages(chat) });
            const injected = !!(prepared.routedFacts?.length || prepared.routed);
            lastStatus = { state: 'ready', message: `原文完整保留；运行时抑制 ${removed} 处原生重复，由统一注入器投影 ${prepared.routedFacts?.length || 0} 条事实`, at: Date.now() };
            lastDelivery = { at: Date.now(), injected, integrated: true, fallback: false, removedOriginalOccurrences: removed, chars: prepared.routed.length, factIds: (prepared.routedFacts || []).map((fact) => fact.factId) };
            return { enabled: true, removed, injected, length: prepared.routed.length };
        } catch (error) {
            const cached = entries.map((entry) => loadCache()[entry.key]).filter(Boolean);
            const fallbackFacts = selectStructuredFacts(config, cached, contextFromMessages(chat, config.contextMessages));
            const fallbackResult = routedFromFacts(fallbackFacts);
            const fallback = fallbackResult.text || fallbackText(cached, config.budget);
            if (fallbackFacts.length) activeTurn = { key: routeKeyFromMessages(chat), routeKey: routeKeyFromMessages(chat), entryKeys: entries.map((entry) => entry.key), routed: fallback, routedByDepth: fallbackResult.byDepth, routedFacts: fallbackFacts, compiled: cached, at: Date.now() };
            const injected = !!fallback;
            const message = text(error?.message || error);
            lastStatus = { state: !fallback ? 'blocked' : 'error', message, at: Date.now() };
            lastDelivery = { at: Date.now(), injected, integrated: true, fallback: !!fallback, removedOriginalOccurrences: removed, chars: fallback.length, factIds: fallbackFacts.map((fact) => fact.factId), error: message };
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
    function cachedCompiledEntries() {
        const config = normalizeConfig();
        const selected = new Set(config.entryKeys);
        return Object.entries(loadCache()).filter(([key]) => selected.has(key)).map(([, value]) => value?.compiled).filter(Boolean);
    }
    function syncEntryAvailability(entries = []) {
        const cache = loadCache();
        let changed = false;
        entries.forEach((entry) => {
            const compiled = cache[entry.key]?.compiled;
            if (!compiled) return;
            const sourceEnabled = entry.enabled !== false;
            if (compiled.sourceEnabled === sourceEnabled) return;
            compiled.sourceEnabled = sourceEnabled;
            changed = true;
        });
        if (changed) saveCache(cache);
    }
    const LOCATION_SUFFIX = '(?:共和国|自治州|帝国|王国|省|州|郡|市|城|区|县|镇|村|街道|大街|路|宫殿|宫|殿|府|宅|庄园|院|楼|塔|馆|店|室|房|厅|园|岛|港|机场|车站|公司|学校|学院|医院|酒店|餐厅|办公室)';
    function locationNames(value) {
        const found = new Set();
        text(value).split(/[，。；：\n]|(?:位于|坐落于|隶属于|属于|通往|相邻于|进入|抵达|前往)/).forEach((part) => {
            const matches = part.match(new RegExp(`[A-Za-z0-9\\u3400-\\u9fff·]{1,20}${LOCATION_SUFFIX}`, 'g')) || [];
            matches.forEach((name) => {
                const cleaned = text(name).replace(/^(?:这里|那里|该地|此地|其中|地图|地点|地理|区域|城市)/, '');
                if (cleaned.length >= 2 && cleaned.length <= 28) found.add(cleaned);
            });
        });
        return [...found];
    }
    function locationType(name) {
        const value = text(name);
        if (/(?:帝国|王国|共和国)$/.test(value)) return 'country';
        if (/(?:省|州|郡)$/.test(value)) return 'region';
        if (/(?:市|城|县|镇|村)$/.test(value)) return 'city';
        if (/(?:区|街道|大街|路)$/.test(value)) return 'district';
        if (/(?:室|房|厅|办公室)$/.test(value)) return 'room';
        if (/(?:宫殿|宫|殿|府|宅|庄园|院|楼|塔|馆|店|公司|学校|学院|医院|酒店|餐厅|机场|车站)$/.test(value)) return 'building';
        if (/(?:园|岛|港)$/.test(value)) return 'landmark';
        return 'other';
    }
    function getStaticCatalog() {
        const compiledEntries = cachedCompiledEntries().filter((entry) => entry.sourceEnabled !== false);
        const facts = WSM.Facts.merge(compiledEntries.flatMap((entry) => entry.facts || []));
        const locationRecords = new Map();
        const parentNames = new Map();
        const routeRecords = [];
        const addLocation = (name, entry, fact) => {
            const locationName = text(name);
            if (!locationName) return;
            const key = locationName.toLocaleLowerCase();
            const previous = locationRecords.get(key) || { name: locationName, entryKeys: new Set(), sourceRefs: new Set(), statements: new Set() };
            previous.entryKeys.add(entry.key);
            (fact?.sourceRefs || []).forEach((ref) => previous.sourceRefs.add(ref));
            if (fact?.statement) previous.statements.add(fact.statement);
            locationRecords.set(key, previous);
        };
        compiledEntries.forEach((entry) => {
            const locationFacts = (entry.facts || []).filter((fact) => fact.owner === 'map');
            if (!locationFacts.length) return;
            const headingNames = locationNames(entry.label);
            locationFacts.forEach((fact) => {
                const names = locationNames(fact.statement);
                [...headingNames, ...names].forEach((name) => addLocation(name, entry, fact));
                const edge = fact.statement.match(/([^，。；\n]{1,28}?)(?:位于|坐落于|隶属于|属于)([^，。；\n]{1,28})/);
                if (edge) {
                    const children = locationNames(edge[1]);
                    const parents = locationNames(edge[2]);
                    if (children[0] && parents[0]) parentNames.set(children[0].toLocaleLowerCase(), parents[0].toLocaleLowerCase());
                }
                const route = fact.statement.match(/(?:从)?([^，。；\n]{1,28}?)(?:通往|连接|相邻于|与)([^，。；\n]{1,28}?)(?:相邻|之间|[。；]|$)/)
                    || fact.statement.match(/从([^，。；\n]{1,28})到([^，。；\n]{1,28})/);
                if (route) {
                    const from = locationNames(route[1])[0];
                    const to = locationNames(route[2])[0];
                    if (from && to && from !== to) {
                        addLocation(from, entry, fact);
                        addLocation(to, entry, fact);
                        routeRecords.push({ from: from.toLocaleLowerCase(), to: to.toLocaleLowerCase(), statement: fact.statement, sourceRefs: fact.sourceRefs || [] });
                    }
                }
            });
        });
        const idByName = new Map([...locationRecords].map(([key, record]) => [key, `location_wb_${hash(`${[...record.entryKeys].sort().join('|')}|${key}`)}`]));
        const locations = [...locationRecords.entries()].map(([key, record]) => {
            const sourceRefs = [...record.sourceRefs];
            return {
                id: idByName.get(key), name: record.name, aliases: [],
                parentId: idByName.get(parentNames.get(key)) || '', type: locationType(record.name),
                description: [...record.statements].join('；'), routeRefs: [],
                accessRuleRefs: facts.filter((fact) => fact.owner === 'worldRules' && fact.sourceRefs.some((ref) => sourceRefs.includes(ref))).map((fact) => fact.factId),
                characterRefs: [], organizationRefs: [],
                secretRefs: facts.filter((fact) => fact.owner === 'knowledge' && fact.sourceRefs.some((ref) => sourceRefs.includes(ref))).map((fact) => fact.factId),
                taskRefs: [], sourceRefs,
            };
        });
        const routeMap = new Map();
        routeRecords.forEach((record) => {
            const from = idByName.get(record.from);
            const to = idByName.get(record.to);
            if (!from || !to) return;
            const pair = [from, to].sort().join('|');
            const previous = routeMap.get(pair) || { id: `route_wb_${hash(pair)}`, from, to, descriptions: new Set(), sourceRefs: new Set() };
            previous.descriptions.add(record.statement);
            record.sourceRefs.forEach((ref) => previous.sourceRefs.add(ref));
            routeMap.set(pair, previous);
        });
        const routes = [...routeMap.values()].map((route) => ({
            id: route.id, from: route.from, to: route.to,
            description: [...route.descriptions].join('；'), status: 'open', travelMinutes: 0, distance: '',
            accessRuleRefs: facts.filter((fact) => fact.owner === 'worldRules' && fact.sourceRefs.some((ref) => route.sourceRefs.has(ref))).map((fact) => fact.factId),
            sourceRefs: [...route.sourceRefs],
        }));
        return {
            facts,
            locations,
            routes,
            characters: facts.filter((fact) => fact.owner === 'characters'),
            secrets: facts.filter((fact) => fact.owner === 'knowledge'),
            worldRules: facts.filter((fact) => fact.owner === 'worldRules'),
        };
    }
    function getActiveFacts() { return clone(activeTurn?.routedFacts || []); }
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
        getStaticCatalog,
        getActiveFacts,
        clearCache() {
            try { localStorage.removeItem(CACHE_KEY); }
            catch (error) { console.warn('[WorldStateMachine] 无法彻底删除世界书拆解缓存', error); }
            activeTurn = null;
            lastDelivery = null;
            lastStatus = { state: 'idle', message: '拆解缓存已清空', at: Date.now() };
        },
        _test: { hash, contextFromMessages, redactOriginals, injectText, fallbackText, splitCompileBatch, compiledResultItems, localRoute, sourceFallbackRule, sourceRuleGroups, routeKeyFromMessages, compactRuleGroups, filterNativeWorldbookEntries, nativeEntryKey, paragraphRecords, buildSemanticChunks, sentenceFacts, selectStructuredFacts, routedFromFacts },
    };
})();
