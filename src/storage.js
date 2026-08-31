(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const META_KEY = 'worldStateMachine';
    const HISTORY_LIMIT = 10;

    const clone = (value) => {
        try { return structuredClone(value); }
        catch (_) { return JSON.parse(JSON.stringify(value)); }
    };
    const RETENTION_LIMITS = Object.freeze({
        currentConditions: 8, factAnchors: 16, resourceConstraints: 10, locations: 32, routes: 40, characters: 16, npcActivities: 12,
        relationships: 16, knowledge: 24, tasks: 8, events: 8, triggers: 6,
        threads: 8, processes: 8, causalEffects: 10, timeline: 24,
    });
    const MEMORY_MODULES = ['factAnchors','resourceConstraints','characters','npcActivities','relationships','knowledge','tasks','events','triggers','threads','processes','causalEffects','timeline'];
    const PRIORITY_DEFAULTS = Object.freeze({
        factAnchors: 'L3', resourceConstraints: 'L2', characters: 'L2', npcActivities: 'L1', relationships: 'L2', knowledge: 'L2', tasks: 'L2', events: 'L2',
        triggers: 'L1', threads: 'L2', processes: 'L2', causalEffects: 'L2', timeline: 'L1',
    });
    function defaultActivity(module, item) {
        if (module === 'factAnchors') return 'COLD';
        if (module === 'characters') return item?.present === true ? 'HOT' : 'WARM';
        if (module === 'npcActivities') return 'HOT';
        if (module === 'tasks') return item?.status === 'active' ? 'HOT' : 'WARM';
        if (module === 'events') return item?.status === 'ongoing' ? 'HOT' : 'WARM';
        if (module === 'triggers') return item?.status === 'eligible' ? 'HOT' : 'WARM';
        if (module === 'causalEffects') return item?.status === 'active' ? 'HOT' : 'WARM';
        if (module === 'timeline') return 'COLD';
        return 'WARM';
    }
    function prepareLifecycle(values, module, revision) {
        return (Array.isArray(values) ? values : []).map((item) => {
            const next = Object.assign({}, item || {});
            const priority = String(next.priority || '').toUpperCase();
            const activity = String(next.activity || '').toUpperCase();
            next.priority = ['L1','L2','L3'].includes(priority)
                ? priority : (module === 'characters' && next.maintenanceLevel === 'core' ? 'L3' : PRIORITY_DEFAULTS[module]);
            next.activity = ['HOT','WARM','COLD'].includes(activity) ? activity : defaultActivity(module, next);
            if (!Number.isFinite(Number(next.updatedRevision))) next.updatedRevision = revision;
            const age = Math.max(0, revision - Number(next.updatedRevision || revision));
            if (next.activity === 'HOT' && age > 4) next.activity = 'WARM';
            if (next.activity === 'WARM' && age > 12) next.activity = 'COLD';
            return next;
        }).filter((item) => module === 'timeline' || item.priority !== 'L1' || item.activity !== 'COLD');
    }
    function itemKey(item, index) {
        if (item && typeof item === 'object') return String(item.id || item.key || item.title || item.name || item.information || `${index}`);
        return String(item ?? '');
    }
    function uniqueRecent(values, limit, keyOf = itemKey) {
        const seen = new Set();
        return (Array.isArray(values) ? values : []).map((item, index) => ({ item, index })).reverse().filter(({ item, index }) => {
            const key = keyOf(item, index);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, limit).reverse().map(({ item }) => item);
    }
    function semanticText(value) {
        const raw = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
        return raw.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '').slice(0, 400);
    }
    const readableLabels = Object.freeze({
        time: '时间', date: '日期', location: '地点', place: '地点', participants: '相关人物', activity: '发生的事', action: '行动',
        movement: '移动', name: '名称', status: '状态', effect: '影响', recovery: '恢复情况', significance: '重要性', summary: '摘要',
        description: '说明', result: '结果', cause: '起因', currentRole: '当前作用',
    });
    function parseJsonish(value) {
        const input = String(value || '').trim();
        if (!input || !/^[\[{]/.test(input) || !/[\]}]$/.test(input)) return null;
        try { return JSON.parse(input); } catch (_error) { /* try adjacent records */ }
        if (input.startsWith('{') && input.endsWith('}')) {
            try { return JSON.parse(`[${input.replace(/}\s*{/g, '},{')}]`); } catch (_error) { return null; }
        }
        return null;
    }
    function readableText(value) {
        if (Array.isArray(value)) return value.map(readableText).filter(Boolean).join('、');
        if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => {
            const rendered = readableText(item);
            return rendered ? `${readableLabels[key] || key}：${rendered}` : '';
        }).filter(Boolean).join('；');
        const input = String(value ?? '').trim();
        const parsed = parseJsonish(input);
        return parsed == null ? input : readableText(parsed);
    }
    function semanticRecent(values, limit, keyOf = itemKey) {
        const kept = [];
        (Array.isArray(values) ? values : []).slice().reverse().forEach((item, reverseIndex) => {
            const key = semanticText(keyOf(item, values.length - reverseIndex - 1));
            if (!key) return;
            const duplicate = kept.some(({ key: existing }) => key === existing
                || (Math.min(key.length, existing.length) >= 12 && (key.includes(existing) || existing.includes(key))));
            if (!duplicate) kept.push({ item, key });
        });
        return kept.slice(0, limit).reverse().map(({ item }) => item);
    }
    function hasText(value) { return String(value ?? '').trim().length > 0; }
    function validMemoryItem(module, item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        if (module === 'factAnchors') return hasText(item.fact);
        if (module === 'resourceConstraints') return hasText(item.condition) && !['expired','satisfied'].includes(String(item.status || '').toLowerCase());
        if (module === 'characters') return hasText(item.name) || hasText(item.id);
        if (module === 'npcActivities') return hasText(item.characterId) && hasText(item.action);
        if (module === 'relationships') return hasText(item.from) && hasText(item.to) && item.from !== item.to && hasText(item.status || item.type);
        if (module === 'knowledge') return hasText(item.information);
        if (module === 'tasks') return hasText(item.title);
        if (module === 'events') return hasText(item.title) && hasText(item.summary || item.outcome);
        if (module === 'triggers') return hasText(item.title) && (hasText(item.userRelevance) || (item.conditions || []).some(hasText));
        if (module === 'threads') return hasText(item.title) && hasText(item.stakes || item.nextNaturalStep || item.status);
        if (module === 'processes') return hasText(item.title) && hasText(item.currentDirection || item.status);
        if (module === 'causalEffects') return hasText(item.result) && hasText(item.cause || item.causeRef);
        if (module === 'timeline') return hasText(item.summary);
        return true;
    }
    function memoryKey(module, item, index) {
        if (module === 'factAnchors') return item?.fact;
        if (module === 'resourceConstraints') return item?.id || `${item?.subjectId || ''}>${item?.kind || ''}>${item?.scope || ''}`;
        if (module === 'characters') return item?.name || item?.id;
        if (module === 'npcActivities') return item?.characterId;
        if (module === 'relationships') return `${item?.from || ''}>${item?.to || ''}`;
        if (module === 'knowledge') return item?.information;
        if (module === 'tasks' || module === 'events' || module === 'triggers' || module === 'threads' || module === 'processes') return item?.title;
        if (module === 'causalEffects') return item?.causeRef || `${item?.cause || ''}>${item?.result || ''}`;
        if (module === 'timeline') return item?.summary;
        return itemKey(item, index);
    }
    function trimArray(value, limit, fromEnd = true) {
        const items = Array.isArray(value) ? value.filter((item) => item !== '' && item != null) : [];
        const unique = uniqueRecent(items, Math.max(limit, items.length), (item) => typeof item === 'string' ? item.trim() : itemKey(item));
        return fromEnd ? unique.slice(-limit) : unique.slice(0, limit);
    }
    function trimFields(item, fields = {}) {
        const next = Object.assign({}, item || {});
        Object.entries(fields).forEach(([key, limit]) => { next[key] = trimArray(next[key], limit); });
        return next;
    }
    function activeFirst(values, limit, important = () => false, keyOf = itemKey) {
        const unique = uniqueRecent(values, Math.max(limit, (values || []).length), keyOf);
        if (unique.length <= limit) return unique;
        const core = unique.filter((item) => String(item?.priority || '').toUpperCase() === 'L3');
        const others = unique.filter((item) => !core.includes(item));
        const activityScore = (item) => ({ HOT: 3, WARM: 2, COLD: 1 }[String(item?.activity || '').toUpperCase()] || 0);
        const ranked = others.map((item, index) => ({ item, index }))
            .sort((a, b) => Number(important(b.item)) - Number(important(a.item)) || activityScore(b.item) - activityScore(a.item) || b.index - a.index)
            .map(({ item }) => item);
        const capacity = core.length >= limit ? core.length + Math.min(8, ranked.length) : limit;
        const selected = new Set([...core, ...ranked].slice(0, capacity));
        return unique.filter((item) => selected.has(item));
    }
    function removeExpiredL1(values, revision, keep = () => false) {
        return (Array.isArray(values) ? values : []).filter((item) => {
            if (String(item?.priority || '').toUpperCase() !== 'L1' || keep(item)) return true;
            const touched = Number(item?.updatedRevision);
            return !Number.isFinite(touched) || Math.max(0, revision - touched) <= 16;
        });
    }
    function compactTimeline(values, limit) {
        const unique = uniqueRecent(values, Math.max(limit, (values || []).length), (item) => String(item?.summary || item?.id || ''));
        if (unique.length <= limit) return unique;
        const core = unique.filter((item) => String(item?.priority || '').toUpperCase() === 'L3');
        const recent = unique.slice(-16);
        const protectedSet = new Set([...core, ...recent]);
        const older = unique.filter((item) => !protectedSet.has(item));
        const compressed = [];
        for (let index = 0; index < older.length; index += 4) {
            const group = older.slice(index, index + 4);
            if (!group.length) continue;
            const first = group[0];
            const last = group.at(-1);
            const summary = group.map((item) => String(item?.summary || '').trim()).filter(Boolean).join('；').slice(0, 220);
            compressed.push({
                id: `timeline-summary-${String(first?.id || index)}-${String(last?.id || index)}`,
                summary: summary || '较早阶段的重要发展已合并',
                priority: group.some((item) => String(item?.priority || '').toUpperCase() === 'L2') ? 'L2' : 'L1',
                granularity: 'phase',
                participants: trimArray(group.flatMap((item) => item?.participants || []), 10),
                location: group.map((item) => item?.location).filter(Boolean).at(-1) || '',
                evidence: trimArray(group.flatMap((item) => item?.evidence || []), 8),
            });
        }
        const combined = [...core, ...compressed, ...recent];
        return uniqueRecent(combined, Math.max(limit, core.length + recent.length), (item) => String(item?.id || item?.summary || ''));
    }
    function compactState(state) {
        const revision = Number(state.revision || 0);
        MEMORY_MODULES.forEach((module) => {
            const values = (Array.isArray(state[module]) ? state[module] : []).filter((item) => validMemoryItem(module, item));
            state[module] = semanticRecent(values, Math.max(RETENTION_LIMITS[module] || values.length, values.length), (item, index) => memoryKey(module, item, index));
        });
        MEMORY_MODULES.forEach((module) => { state[module] = prepareLifecycle(state[module], module, revision); });
        state.world.currentConditions = trimArray(state.world.currentConditions, RETENTION_LIMITS.currentConditions);
        state.factAnchors = activeFirst(state.factAnchors, RETENTION_LIMITS.factAnchors, () => false, (item) => semanticText(item?.fact))
            .map((item) => trimFields(item, { sourceRefs: 4 }));
        state.resourceConstraints = activeFirst(removeExpiredL1(state.resourceConstraints.filter((item) => !['expired','satisfied'].includes(String(item?.status || '').toLowerCase())), revision, (item) => item?.status === 'active'), RETENTION_LIMITS.resourceConstraints, (item) => item?.status === 'active', (item) => String(item?.id || `${item?.subjectId || ''}>${item?.kind || ''}>${item?.scope || ''}`))
            .map((item) => trimFields(item, { sourceRefs: 4 }));
        state.progression ||= { priority: 'L2', activity: 'WARM', direction: '', currentMovement: '', nextRequiredChanges: [], basedOnRefs: [], blockedByDecision: '', updatedRevision: 0 };
        const progressionTouched = Number.isFinite(Number(state.progression.updatedRevision)) ? Number(state.progression.updatedRevision) : revision;
        const progressionAge = Math.max(0, revision - progressionTouched);
        if (state.progression.activity === 'HOT' && progressionAge > 4) state.progression.activity = 'WARM';
        if (state.progression.activity === 'WARM' && progressionAge > 12) state.progression.activity = 'COLD';
        state.progression.nextRequiredChanges = trimArray(state.progression.nextRequiredChanges, 6, false);
        state.progression.basedOnRefs = trimArray(state.progression.basedOnRefs, 10, false);

        const locationsById = new Map(state.map.locations.map((item) => [item.id, item]));
        const requiredLocationIds = new Set();
        let locationId = state.map.currentLocationId;
        while (locationId && !requiredLocationIds.has(locationId) && requiredLocationIds.size < RETENTION_LIMITS.locations) {
            requiredLocationIds.add(locationId);
            locationId = locationsById.get(locationId)?.parentId || '';
        }
        const keptLocationIds = new Set(requiredLocationIds);
        state.map.locations.filter((item) => item.priority === 'L3').forEach((candidate) => {
            const visited = new Set();
            for (let item = candidate; item && !visited.has(item.id); item = item.parentId ? locationsById.get(item.parentId) : null) {
                visited.add(item.id); keptLocationIds.add(item.id);
            }
        });
        const eligibleLocations = state.map.locations.filter((item) => {
            if (requiredLocationIds.has(item.id) || item.priority === 'L3') return true;
            const touched = Number(item.updatedRevision);
            const age = Number.isFinite(touched) ? Math.max(0, revision - touched) : 0;
            if (item.priority === 'L1' && (item.activity === 'COLD' || age > 16)) return false;
            if (item.priority === 'L2' && item.activity === 'COLD' && age > 40) return false;
            return true;
        });
        eligibleLocations.slice().reverse().forEach((candidate) => {
            if (keptLocationIds.has(candidate.id)) return;
            const chain = [];
            const visited = new Set();
            let item = candidate;
            while (item && !keptLocationIds.has(item.id) && !visited.has(item.id)) {
                visited.add(item.id);
                chain.push(item.id);
                item = item.parentId ? locationsById.get(item.parentId) : null;
            }
            if (keptLocationIds.size + chain.length <= RETENTION_LIMITS.locations) chain.forEach((id) => keptLocationIds.add(id));
        });
        const locationPool = state.map.locations.filter((item) => keptLocationIds.has(item.id));
        state.map.locations = locationPool.map((item) => trimFields(item, { sourceRefs: 4 }));
        state.map.routes = uniqueRecent(state.map.routes.filter((item) => keptLocationIds.has(item.from) && keptLocationIds.has(item.to)), RETENTION_LIMITS.routes, (item) => `${item.from}>${item.to}`);

        const uniqueCharacters = uniqueRecent(state.characters, Math.max(RETENTION_LIMITS.characters, state.characters.length));
        const coreCharacters = uniqueCharacters.filter((item) => item?.maintenanceLevel === 'core' || ['user','char','<user>','<char>'].includes(String(item?.id || '').toLowerCase()));
        const activeCharacters = uniqueCharacters.filter((item) => !coreCharacters.includes(item));
        const keptCharacters = new Set([...coreCharacters, ...activeCharacters.filter((item) => item?.present === true), ...activeCharacters].slice(0, Math.max(RETENTION_LIMITS.characters, coreCharacters.length)));
        state.characters = uniqueCharacters.filter((item) => keptCharacters.has(item))
            .map((item) => trimFields(item, { persistentConditions: 4, importantItems: 4, sourceRefs: 4 }));
        state.npcActivities = uniqueRecent(state.npcActivities, RETENTION_LIMITS.npcActivities, (item) => String(item?.characterId || item?.id || ''));
        state.relationships = activeFirst(removeExpiredL1(state.relationships, revision), RETENTION_LIMITS.relationships, () => false, (item) => `${String(item?.from || '')}>${String(item?.to || '')}`)
            .map((item) => trimFields(item, { evidence: 4 }));
        const uniqueKnowledge = uniqueRecent(state.knowledge, Math.max(RETENTION_LIMITS.knowledge, state.knowledge.length), (item) => String(item?.information || item?.id || ''));
        const coreKnowledge = uniqueKnowledge.filter((item) => String(item?.priority || '').toUpperCase() === 'L3');
        const otherKnowledge = uniqueKnowledge.filter((item) => !coreKnowledge.includes(item));
        const rankedKnowledge = otherKnowledge.slice().reverse().sort((a, b) => {
            const priority = (item) => ({ L3: 3, L2: 2, L1: 1 }[String(item?.priority || '').toUpperCase()] || 0);
            const activity = (item) => ({ HOT: 3, WARM: 2, COLD: 1 }[String(item?.activity || '').toUpperCase()] || 0);
            return priority(b) - priority(a) || activity(b) - activity(a);
        });
        const knowledgeCapacity = coreKnowledge.length >= RETENTION_LIMITS.knowledge
            ? coreKnowledge.length + Math.min(8, rankedKnowledge.length) : RETENTION_LIMITS.knowledge;
        const keptKnowledge = new Set([...coreKnowledge, ...rankedKnowledge].slice(0, knowledgeCapacity));
        state.knowledge = uniqueKnowledge.filter((item) => keptKnowledge.has(item)).map((item) => trimFields(item, {
            knownBy: 8, believedBy: 8, suspectedBy: 8, misunderstoodBy: 8, unknownTo: 8,
            relatedRefs: 6, evidence: 5, discoveryPaths: 4, maturityConditions: 4,
        }));
        state.tasks = activeFirst(removeExpiredL1(state.tasks.filter((item) => !['done','failed'].includes(item?.status)), revision, (item) => item?.status === 'active'), RETENTION_LIMITS.tasks, (item) => ['active','blocked'].includes(item?.status), (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { ownerIds: 6, dependencies: 4, consequences: 4, sourceRefs: 4 }));
        state.events = activeFirst(removeExpiredL1(state.events, revision, (item) => item?.status === 'ongoing'), RETENTION_LIMITS.events, (item) => item?.status === 'ongoing', (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { participantIds: 8, relatedProcessIds: 4, sourceRefs: 4 }));
        state.triggers = activeFirst(state.triggers.filter((item) => !['triggered','expired'].includes(item?.status)), RETENTION_LIMITS.triggers, (item) => item?.status === 'eligible', (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { conditions: 4, effectsIfTriggered: 4, blockedReasons: 3, sourceRefs: 4 }));
        state.threads = activeFirst(state.threads.filter((item) => item?.status !== 'resolved'), RETENTION_LIMITS.threads, (item) => item?.status === 'open', (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { participantIds: 8, history: 4 }));
        state.processes = activeFirst(state.processes.filter((item) => !['resolved','transformed'].includes(item?.status)), RETENTION_LIMITS.processes, (item) => ['active','decaying'].includes(item?.status), (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { drivers: 4, decayConditions: 3, resolutionConditions: 3 }));
        state.causalEffects = activeFirst(removeExpiredL1(state.causalEffects.filter((item) => !['resolved','discarded'].includes(item?.status)), revision, (item) => item?.status === 'active'), RETENTION_LIMITS.causalEffects, (item) => item?.status === 'active', (item) => String(item?.id || `${item?.causeRef || ''}|${item?.result || ''}`))
            .map((item) => trimFields(item, { steps: 4, affectedIds: 8, decayConditions: 3, evidenceRefs: 4 }));
        state.timeline = compactTimeline(state.timeline, RETENTION_LIMITS.timeline).map((item) => trimFields(item, { participants: 8, evidence: 4, actualChanges: 4 }));
        return state;
    }
    function context() { return window.SillyTavern?.getContext?.() || null; }
    function metadata() {
        const ctx = context();
        if (!ctx) return null;
        if (ctx.chatMetadata && typeof ctx.chatMetadata === 'object') return ctx.chatMetadata;
        if (window.chat_metadata && typeof window.chat_metadata === 'object') return window.chat_metadata;
        try { ctx.chatMetadata = {}; return ctx.chatMetadata; }
        catch (_) { return null; }
    }
    function mapTypeFromName(name, fallback = 'other') {
        const value = String(name || '');
        if (/(世界|大陆|星球)$/.test(value)) return 'world';
        if (/(国|共和国|王国)$/.test(value)) return 'country';
        if (/(市|城|都市)$/.test(value)) return 'city';
        if (/(区|县|镇|乡|街区)$/.test(value)) return 'district';
        if (/(家|住宅|公寓|宅|别墅)$/.test(value)) return 'residence';
        if (/(公司|集团|事务所|工作室|学校|医院)$/.test(value)) return 'workplace';
        if (/(房|室|厅|厨房|玄关|走廊)$/.test(value)) return 'room';
        return fallback;
    }
    function stableMapId(prefix, value) {
        let hash = 2166136261;
        for (const char of String(value || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
        return `${prefix}-${(hash >>> 0).toString(36)}`;
    }
    const mapPriorityScore = (value) => ({ L3: 3, L2: 2, L1: 1 }[String(value || '').toUpperCase()] || 0);
    const mapActivityScore = (value) => ({ HOT: 3, WARM: 2, COLD: 1 }[String(value || '').toUpperCase()] || 0);
    function defaultMapPriority(type) {
        if (['world','country','region','city'].includes(type)) return 'L3';
        if (['district','residence','workplace','building'].includes(type)) return 'L2';
        return 'L1';
    }
    function cleanSpatialDescription(value) {
        const parts = String(value || '').replace(/[\r\n]+/g, ' ').split(/[。；;]/).map((item) => item.trim()).filter(Boolean);
        const plotMeaning = /(主要场景|剧情|冲突|交锋|博弈|关键场所|发生地|最后交割|谈判地点|推动.*(?:剧情|故事)|见证了|曾在此)/;
        return parts.map((item) => item.split(/[，,]/).map((part) => part.trim()).filter((part) => part && !plotMeaning.test(part)).join('，')).filter(Boolean).join('；').slice(0, 100);
    }
    function cleanLocationOrigin(value) {
        return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().split(/[。；;]/)[0].slice(0, 80);
    }
    function locationIdentityKey(item) {
        return `${semanticText(item?.parentId).slice(0, 80)}|${semanticText(item?.name).slice(0, 120)}`;
    }
    function mergeMapLocations(locations) {
        const aliases = new Map();
        const merged = [];
        const byKey = new Map();
        (Array.isArray(locations) ? locations : []).forEach((item) => {
            item.parentId = aliases.get(item.parentId) || item.parentId;
            const key = locationIdentityKey(item);
            const existing = byKey.get(key);
            if (!existing) { byKey.set(key, item); merged.push(item); return; }
            aliases.set(item.id, existing.id);
            if (mapPriorityScore(item.priority) > mapPriorityScore(existing.priority)) existing.priority = item.priority;
            if (mapActivityScore(item.activity) > mapActivityScore(existing.activity)) existing.activity = item.activity;
            if (item.status === 'visited' || (existing.status !== 'visited' && item.status === 'unavailable')) existing.status = item.status;
            if (!existing.description && item.description) existing.description = item.description;
            if (!existing.origin && item.origin) existing.origin = item.origin;
            existing.updatedRevision = Math.max(Number(existing.updatedRevision || 0), Number(item.updatedRevision || 0));
            existing.sourceRefs = trimArray([...(existing.sourceRefs || []), ...(item.sourceRefs || [])], 4);
        });
        merged.forEach((item) => { item.parentId = aliases.get(item.parentId) || item.parentId; });
        return { locations: merged, aliases };
    }
    function envelope() {
        const meta = metadata();
        if (!meta) return { state: WSM.Defaults.createState(), history: [] };
        if (!meta[META_KEY]?.state) meta[META_KEY] = { state: WSM.Defaults.createState(), history: [] };
        meta[META_KEY].history = Array.isArray(meta[META_KEY].history) ? meta[META_KEY].history : [];
        meta[META_KEY].history = meta[META_KEY].history.filter(isGenerationSnapshot).slice(0, HISTORY_LIMIT);
        return meta[META_KEY];
    }
    function normalizeState(value) {
        const incomingVersion = Number(value?.schemaVersion || 0);
        const state = Object.assign(WSM.Defaults.createState(), clone(value || {}));
        state.identities = Object.assign({ user: '', char: '' }, state.identities || {});
        state.world = Object.assign(WSM.Defaults.createState().world, state.world || {});
        state.world.time = Object.assign({ display: '', iso: '', timezone: '', elapsedMinutes: 0 }, state.world.time || {});
        state.world.location = Object.assign({ current: '', environment: '', weather: '' }, state.world.location || {});
        state.world.season = String(state.world.season || '').trim();
        state.world.currentConditions = Array.isArray(state.world.currentConditions) ? state.world.currentConditions.map(readableText).filter(Boolean) : [];
        if (incomingVersion < 17 && Array.isArray(state.world.facts)) {
            state.factAnchors = [
                ...(Array.isArray(state.factAnchors) ? state.factAnchors : []),
                ...state.world.facts.filter(Boolean).map((fact, index) => ({
                    id: `legacy-fact-anchor-${index + 1}`,
                    fact: String(fact), priority: 'L3', activity: 'COLD', scope: '由旧版“已有安排与事实”迁移，等待后续整理归属', sourceRefs: [],
                })),
            ];
        }
        delete state.world.facts;
        state.map = Object.assign({ rootLabel: '大地图', currentLocationId: '', locations: [], routes: [] }, state.map || {});
        const rawLocations = Array.isArray(state.map.locations) ? state.map.locations : [];
        state.map.locations = rawLocations.map((item, index) => {
            const location = Object.assign({}, item || {});
            location.id = String(location.id || `location-${index + 1}`);
            location.name = String(location.name || location.id || '未命名地点');
            location.type = String(location.type || mapTypeFromName(location.name));
            location.parentId = String(location.parentId || '');
            location.area = String(location.area || '');
            location.status = String(location.status || 'known');
            location.description = cleanSpatialDescription(location.description);
            location.origin = cleanLocationOrigin(location.origin || location.establishedBy || '');
            const priority = String(location.priority || '').toUpperCase();
            const activity = String(location.activity || '').toUpperCase();
            location.priority = ['L1','L2','L3'].includes(priority) ? priority : defaultMapPriority(location.type);
            location.activity = ['HOT','WARM','COLD'].includes(activity) ? activity : (location.status === 'visited' ? 'HOT' : 'WARM');
            location.updatedRevision = Number.isFinite(Number(location.updatedRevision)) ? Number(location.updatedRevision) : Number(state.revision || 0);
            const locationAge = Math.max(0, Number(state.revision || 0) - location.updatedRevision);
            if (location.activity === 'HOT' && locationAge > 4) location.activity = 'WARM';
            if (location.activity === 'WARM' && locationAge > 12) location.activity = 'COLD';
            location.sourceRefs = Array.isArray(location.sourceRefs) ? location.sourceRefs.filter(Boolean).map(String) : [];
            location.x = Number.isFinite(Number(location.x)) ? Math.max(0, Math.min(100, Number(location.x))) : null;
            location.y = Number.isFinite(Number(location.y)) ? Math.max(0, Math.min(100, Number(location.y))) : null;
            return location;
        });
        const locationsByName = new Map(state.map.locations.map((item) => [item.name, item]));
        const usedIds = new Set(state.map.locations.map((item) => item.id));
        const ensureNamedLocation = (name, parentId = '', options = {}) => {
            const cleanName = String(name || '').trim();
            if (!cleanName || cleanName === '未设定') return null;
            let location = locationsByName.get(cleanName);
            if (location) {
                if (!location.parentId && parentId && location.id !== parentId) location.parentId = parentId;
                return location;
            }
            let id = stableMapId(options.prefix || 'location', cleanName);
            while (usedIds.has(id)) id = `${id}-location`;
            location = {
                id, name: cleanName, type: mapTypeFromName(cleanName, options.type || 'other'), parentId,
                x: null, y: null, area: '', description: String(options.description || ''),
                origin: String(options.origin || '当前状态自动建立'), status: options.status || 'known',
                priority: options.priority || 'L2', activity: options.activity || 'WARM',
                updatedRevision: Number(state.revision || 0), sourceRefs: [],
            };
            state.map.locations.push(location);
            locationsByName.set(cleanName, location);
            usedIds.add(id);
            return location;
        };
        // Models often return a readable parent name in parentId. Resolve it
        // into a stable node so children do not become invisible orphans.
        state.map.locations.slice().forEach((location) => {
            if (!location.parentId || usedIds.has(location.parentId)) return;
            const parent = ensureNamedLocation(location.parentId, '', { prefix: 'parent', priority: 'L3', origin: '由地点父级名称建立' });
            if (parent) location.parentId = parent.id;
        });
        state.map.locations.slice().forEach((location) => {
            if (location.parentId || !location.area || location.area === location.name) return;
            let parent = locationsByName.get(location.area);
            if (!parent) {
                let id = stableMapId('area', location.area);
                while (usedIds.has(id)) id = `${id}-area`;
                parent = { id, name: location.area, type: mapTypeFromName(location.area, 'region'), parentId: '', x: null, y: null, area: '', description: '', origin: '旧地图层级迁移', status: 'known', priority: 'L3', activity: 'WARM', updatedRevision: Number(state.revision || 0), sourceRefs: [] };
                state.map.locations.push(parent);
                locationsByName.set(parent.name, parent);
                usedIds.add(parent.id);
            }
            location.parentId = parent.id;
        });
        // Older initialized revisions may already contain explicit location
        // fields in timeline/events/character snapshots while their dedicated
        // map array only contains a country root. Rebuild the spatial index
        // locally on load; this must never require another API read.
        const countryRoots = state.map.locations.filter((item) => item.type === 'country' && !item.parentId);
        const defaultCountryId = countryRoots.length === 1 ? countryRoots[0].id : '';
        const ensureLocationPath = (rawPlace, origin = '已保存状态中的地点', options = {}) => {
            const place = String(rawPlace || '').trim();
            if (!place || place === '未设定') return null;
            const parts = place.split(/\s*(?:·|＞|>|\/|\\)\s*/).map((part) => part.trim()).filter(Boolean);
            if (!parts.length) return null;
            let parentId = defaultCountryId && parts[0] !== countryRoots[0]?.name ? defaultCountryId : '';
            let leaf = null;
            parts.forEach((part, index) => {
                leaf = ensureNamedLocation(part, parentId, {
                    prefix: index === 0 ? 'place' : 'inside',
                    priority: options.priority || (index === 0 ? 'L3' : 'L2'),
                    activity: options.current && index === parts.length - 1 ? 'HOT' : 'WARM',
                    status: options.current && index === parts.length - 1 ? 'visited' : 'known',
                    origin: String(origin || '已保存状态中的地点').slice(0, 100),
                });
                if (leaf) parentId = leaf.id;
            });
            return leaf;
        };
        const savedLocationRecords = [
            ...(Array.isArray(state.timeline) ? state.timeline.slice(-16) : []),
            ...(Array.isArray(state.events) ? state.events : []),
            ...(Array.isArray(state.npcActivities) ? state.npcActivities : []),
            ...(Array.isArray(state.characters) ? state.characters : []),
        ];
        savedLocationRecords.forEach((item) => {
            const place = String(item?.location || item?.place || '').trim();
            if (!place) return;
            const actor = String(item?.characterId || item?.name || '').trim();
            const action = readableText(item?.summary || item?.action || item?.situation || '已保存状态中出现');
            ensureLocationPath(place, [actor, action].filter(Boolean).join('｜'));
        });
        // The current world location must always have a visible map path even
        // when the evidence extractor omitted the separate locations array.
        const currentPlace = String(state.world.location.current || '').trim();
        if (currentPlace && currentPlace !== '未设定') {
            const currentNode = ensureLocationPath(currentPlace, '当前场景位置', { current: true });
            if (currentNode) state.map.currentLocationId = currentNode.id;
        }
        const mergedMap = mergeMapLocations(state.map.locations);
        state.map.locations = mergedMap.locations;
        state.map.currentLocationId = mergedMap.aliases.get(String(state.map.currentLocationId || '')) || String(state.map.currentLocationId || '');
        const siblings = new Map();
        state.map.locations.forEach((location) => { (siblings.get(location.parentId) || siblings.set(location.parentId, []).get(location.parentId)).push(location); });
        siblings.forEach((items) => items.forEach((location, index) => {
            if (location.x === null) location.x = 15 + ((index * 31) % 70);
            if (location.y === null) location.y = 18 + ((Math.floor(index / 3) * 31 + (index % 3) * 13) % 64);
        }));
        state.map.routes = (Array.isArray(state.map.routes) ? state.map.routes : []).map((item) => ({
            ...item, from: mergedMap.aliases.get(String(item?.from || '')) || String(item?.from || ''), to: mergedMap.aliases.get(String(item?.to || '')) || String(item?.to || ''), status: String(item?.status || 'open'),
            description: String(item?.description || ''), travelMinutes: Number.isFinite(Number(item?.travelMinutes)) ? Number(item.travelMinutes) : 0,
            distance: String(item?.distance || ''),
        })).filter((item) => item.from && item.to);
        if (!state.initialized && state.world.time.display === '未设定') state.world.time.display = '';
        if (!state.initialized && state.world.location.current === '未设定') state.world.location.current = '';
        ['factAnchors','resourceConstraints','characters','npcActivities','relationships','knowledge','tasks','events','triggers','threads','processes','causalEffects','timeline','lockedPaths'].forEach((key) => {
            state[key] = Array.isArray(state[key]) ? state[key] : [];
        });
        const inferSeason = () => {
            const display = String(state.world.time.display || '');
            const named = display.match(/[春夏秋冬]季?/)?.[0];
            if (named) return named.endsWith('季') ? named : `${named}季`;
            const month = Number(display.match(/(?:^|\D)(1[0-2]|0?[1-9])月/)?.[1] || state.world.time.iso?.match(/^\d{4}-(1[0-2]|0[1-9])-/)?.[1]);
            if (!month) return '';
            const northern = month >= 3 && month <= 5 ? '春季' : month >= 6 && month <= 8 ? '夏季' : month >= 9 && month <= 11 ? '秋季' : '冬季';
            if (!/(澳大利亚|新西兰|南半球|阿根廷|智利|南非)/.test(String(state.world.location.current || ''))) return northern;
            return ({ 春季: '秋季', 夏季: '冬季', 秋季: '春季', 冬季: '夏季' })[northern];
        };
        if (!state.world.season) state.world.season = inferSeason() || (state.initialized ? '季节待确认' : '');
        if (!state.world.location.weather && state.initialized) state.world.location.weather = '天气待确认';
        state.progression = Object.assign({}, WSM.Defaults.createState().progression, state.progression && typeof state.progression === 'object' && !Array.isArray(state.progression) ? state.progression : {});
        state.progression.priority = ['L1','L2','L3'].includes(String(state.progression.priority || '').toUpperCase()) ? String(state.progression.priority).toUpperCase() : 'L2';
        state.progression.activity = ['HOT','WARM','COLD'].includes(String(state.progression.activity || '').toUpperCase()) ? String(state.progression.activity).toUpperCase() : 'WARM';
        state.progression.direction = String(state.progression.direction || '').trim();
        state.progression.currentMovement = String(state.progression.currentMovement || '').trim();
        state.progression.nextRequiredChanges = Array.isArray(state.progression.nextRequiredChanges) ? state.progression.nextRequiredChanges.filter(Boolean).map(String) : [];
        state.progression.basedOnRefs = Array.isArray(state.progression.basedOnRefs) ? state.progression.basedOnRefs.filter(Boolean).map(String) : [];
        state.progression.blockedByDecision = String(state.progression.blockedByDecision || '').trim();
        const progressionRevision = Number(state.progression.updatedRevision);
        const hasProgression = !!(state.progression.direction || state.progression.currentMovement || state.progression.blockedByDecision || state.progression.nextRequiredChanges.length);
        state.progression.updatedRevision = Number.isFinite(progressionRevision) && (progressionRevision > 0 || !hasProgression)
            ? progressionRevision : Number(state.revision || 0);
        if (!state.causalEffects.length) {
            const legacyLinks = Array.isArray(state.causalLinks) ? state.causalLinks : [];
            const legacySeeds = Array.isArray(state.causalSeeds) ? state.causalSeeds : [];
            state.causalEffects = [
                ...legacyLinks.map((item, index) => ({
                    id: item.id || `legacy-causal-link-${index}`, causeRef: item.rootCauseRef || '', cause: item.rootCauseRef || '既存起因',
                    steps: Array.isArray(item.requiredSteps) ? item.requiredSteps : [], result: item.effect || '', affectedIds: [],
                    status: item.status === 'reached' ? 'active' : item.status === 'resolved' ? 'resolved' : 'developing', reachCondition: '', decayConditions: [], evidenceRefs: item.evidenceRefs || [],
                })),
                ...legacySeeds.map((item, index) => ({
                    id: item.id || `legacy-causal-seed-${index}`, causeRef: item.rootCauseRef || '', cause: item.rootCauseRef || '既存起因',
                    steps: [], result: item.potentialEffect || '', affectedIds: [], status: item.status === 'reached' ? 'active' : item.status === 'expired' ? 'discarded' : 'developing',
                    reachCondition: Array.isArray(item.naturalReachConditions) ? item.naturalReachConditions.join('；') : '', decayConditions: [], evidenceRefs: item.evidenceRefs || [],
                })),
            ];
        }
        delete state.causalLinks;
        delete state.causalSeeds;
        state.relationships = state.relationships.map((item) => {
            const relationship = Object.assign({}, item || {});
            delete relationship.closeness;
            delete relationship.trust;
            delete relationship.tension;
            return relationship;
        });
        state.npcActivities = uniqueRecent(state.npcActivities.filter((item) => item?.characterId && item?.action), RETENTION_LIMITS.npcActivities, (item) => String(item.characterId));
        state.runtime = Object.assign({}, WSM.Defaults.createState().runtime, state.runtime || {});
        state.runtime.npcLastUpdatedElapsedMinutes = Object.assign({}, state.runtime.npcLastUpdatedElapsedMinutes || {});
        if (state.initialized && incomingVersion < 6) state.runtime.needsWorldRefresh = true;
        state.characters = state.characters.map((item) => {
            const character = Object.assign({}, item || {});
            const rawName = String(character.name || '').trim();
            const parsedName = rawName.split(/[：:]/)[0].trim();
            if (parsedName && parsedName !== rawName && parsedName.length <= 80) {
                character.name = parsedName;
                character.summary = String(character.summary || character.description || rawName).trim();
            }
            if (!character.description && character.summary) character.description = String(character.summary);
            if (!character.notes && (character.summary || character.description)) character.notes = String(character.summary || character.description);
            if (character.id && Number.isFinite(Number(character.lastUpdatedElapsedMinutes))) {
                state.runtime.npcLastUpdatedElapsedMinutes[character.id] = Number(character.lastUpdatedElapsedMinutes);
            }
            const stableId = String(character.id || '').toLowerCase();
            character.maintenanceLevel = ['core','active'].includes(character.maintenanceLevel)
                ? character.maintenanceLevel
                : (['user','char','character','<user>','<char>'].includes(stableId) || character.present === true ? 'core' : 'active');
            character.identity = String(character.identity || '').trim();
            character.situation = readableText(character.situation || character.status);
            character.persistentConditions = Array.isArray(character.persistentConditions)
                ? character.persistentConditions
                : (Array.isArray(character.injuries) ? character.injuries.map((value) => ({ name: String(value), effect: '', recovery: '根据时间、治疗和行动自然更新' })) : []);
            character.importantItems = Array.isArray(character.importantItems)
                ? character.importantItems
                : (Array.isArray(character.heldItems) ? character.heldItems.map((value) => ({ name: String(value), status: '当前持有', significance: '由旧人物状态迁移，后续按剧情价值复核' })) : []);
            ['status','pose','clothing','heldItems','injuries','resources','goals','currentAction','memories'].forEach((field) => delete character[field]);
            delete character.lastUpdatedElapsedMinutes;
            return character;
        });
        state.knowledge = state.knowledge.map((item) => {
            const knowledge = Object.assign({}, item || {});
            knowledge.priority = ['L1','L2','L3'].includes(String(knowledge.priority || '').toUpperCase()) ? String(knowledge.priority).toUpperCase() : 'L2';
            knowledge.disclosure = ['confidential','restricted','public'].includes(knowledge.disclosure)
                ? knowledge.disclosure
                : (Array.isArray(knowledge.concealedBy) && knowledge.concealedBy.length ? 'confidential' : 'restricted');
            delete knowledge.concealedBy;
            return knowledge;
        });
        Object.entries(PRIORITY_DEFAULTS).forEach(([module, fallback]) => {
            state[module] = state[module].map((item) => {
                const next = Object.assign({}, item || {});
                const priority = String(next.priority || '').toUpperCase();
                next.priority = ['L1','L2','L3'].includes(priority)
                    ? priority : (module === 'characters' && next.maintenanceLevel === 'core' ? 'L3' : fallback);
                const activity = String(next.activity || '').toUpperCase();
                next.activity = ['HOT','WARM','COLD'].includes(activity) ? activity : defaultActivity(module, next);
                return next;
            });
        });
        const charactersByName = new Map();
        state.characters.forEach((character, index) => {
            const name = String(character?.name || '').trim().toLocaleLowerCase();
            const key = name ? `name:${name}` : `id:${String(character?.id || index)}`;
            const previous = charactersByName.get(key);
            if (!previous) { charactersByName.set(key, character); return; }
            const canonicalId = [previous.id, character.id].find((id) => ['user','char','character'].includes(String(id || '').toLowerCase()));
            const merged = { ...previous, ...character, id: canonicalId || previous.id || character.id };
            ['sourceRefs'].forEach((field) => {
                const values = [...(Array.isArray(previous[field]) ? previous[field] : []), ...(Array.isArray(character[field]) ? character[field] : [])];
                if (values.length) merged[field] = [...new Set(values.map((item) => typeof item === 'string' ? item : JSON.stringify(item)))].map((item) => {
                    try { return JSON.parse(item); } catch (_) { return item; }
                });
            });
            charactersByName.set(key, merged);
        });
        state.characters = [...charactersByName.values()];
        state.npcActivities = state.npcActivities.map((item) => {
            const next = Object.assign({}, item);
            next.location = readableText(next.location);
            next.movement = readableText(next.movement);
            next.action = readableText(next.action);
            next.currentRole = readableText(next.currentRole);
            delete next.at;
            return next;
        });
        state.events = state.events.map((item) => {
            const next = Object.assign({}, item);
            const legacyDevelopments = Array.isArray(next.developments) ? next.developments.filter(Boolean) : [];
            next.status = ['ongoing','occurred'].includes(next.status) ? next.status : (next.status === 'resolved' ? 'occurred' : 'ongoing');
            next.title = readableText(next.title || next.name);
            next.summary = readableText(next.summary || legacyDevelopments.at(-1) || next.description);
            next.outcome = readableText(next.outcome);
            next.relatedProcessIds = Array.isArray(next.relatedProcessIds) ? next.relatedProcessIds : [];
            next.sourceRefs = Array.isArray(next.sourceRefs) ? next.sourceRefs : [];
            delete next.developments;
            delete next.startedAt;
            return next;
        });
        state.causalEffects = state.causalEffects.map((item) => {
            const next = Object.assign({}, item);
            if (next.status === 'arrived' || next.status === 'reached') next.status = 'active';
            next.decayConditions = Array.isArray(next.decayConditions) ? next.decayConditions : [];
            return next;
        });
        state.triggers = state.triggers.map((item) => {
            const next = Object.assign({}, item);
            next.title = String(next.title || next.name || next.id || '').trim();
            if (next.earliestAt && !next.conditions?.some((condition) => String(condition).includes(next.earliestAt))) next.conditions = [...(next.conditions || []), `世界时间达到${next.earliestAt}`];
            delete next.earliestAt;
            return next;
        });
        state.tasks = state.tasks.map((item) => { const next = { ...item }; next.title = readableText(next.title || next.name); next.progress = readableText(next.progress); delete next.choices; return next; });
        state.triggers = state.triggers.map((item) => { const next = { ...item }; delete next.choices; return next; });
        state.processes = state.processes.map((item) => { const next = Object.assign({}, item); delete next.lastUpdatedAt; return next; });
        state.timeline = state.timeline.map((item) => { const next = Object.assign({}, item); next.summary = readableText(next.summary); delete next.at; return next; });
        state.factAnchors = state.factAnchors.map((item) => ({ ...item, fact: readableText(item?.fact), scope: readableText(item?.scope) }));
        state.relationships = state.relationships.map((item) => ({ ...item, type: readableText(item?.type), status: readableText(item?.status), evidence: Array.isArray(item?.evidence) ? item.evidence.map(readableText).filter(Boolean) : [] }));
        state.knowledge = state.knowledge.map((item) => ({ ...item, information: readableText(item?.information), source: readableText(item?.source), evidence: Array.isArray(item?.evidence) ? item.evidence.map(readableText).filter(Boolean) : [] }));
        state.threads = state.threads.map((item) => ({ ...item, title: readableText(item?.title), stakes: readableText(item?.stakes), nextNaturalStep: readableText(item?.nextNaturalStep), history: Array.isArray(item?.history) ? item.history.map(readableText).filter(Boolean) : [] }));
        state.processes = state.processes.map((item) => ({ ...item, title: readableText(item?.title), currentDirection: readableText(item?.currentDirection), drivers: Array.isArray(item?.drivers) ? item.drivers.map(readableText).filter(Boolean) : [] }));
        state.causalEffects = state.causalEffects.map((item) => ({ ...item, cause: readableText(item?.cause), result: readableText(item?.result), steps: Array.isArray(item?.steps) ? item.steps.map(readableText).filter(Boolean) : [] }));
        state.schemaVersion = 20;
        return compactState(state);
    }
    function load() { return normalizeState(envelope().state); }
    function readSourceReadCache(cacheKey) {
        if (!cacheKey) return null;
        const evidence = envelope()?.sourceReadCache?.[cacheKey]?.evidence;
        return evidence && typeof evidence === 'object' ? clone(evidence) : null;
    }
    async function writeSourceReadCache(cacheKey, evidence) {
        if (!cacheKey || !evidence || typeof evidence !== 'object') return;
        const box = envelope();
        const current = box.sourceReadCache && typeof box.sourceReadCache === 'object' && !Array.isArray(box.sourceReadCache)
            ? box.sourceReadCache : {};
        current[cacheKey] = { at: Date.now(), evidence: clone(evidence) };
        box.sourceReadCache = Object.fromEntries(Object.entries(current)
            .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 4));
        await persist();
    }
    async function persist() {
        const ctx = context();
        if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
        else if (typeof window.saveChatConditional === 'function') await window.saveChatConditional();
        else window.saveMetadataDebounced?.();
    }
    async function save(next, reason = 'update', options = {}) {
        const box = envelope();
        if (options.clearHistory === true) box.history = [];
        if (options.snapshot === true && box.state) {
            box.history.unshift({ at: Date.now(), reason, kind: options.snapshotKind || 'generation', state: clone(box.state) });
            box.history = box.history.filter(isGenerationSnapshot).slice(0, HISTORY_LIMIT);
        }
        const state = normalizeState(next || WSM.Defaults.createState());
        state.revision = Number(state.revision || 0) + 1;
        state.updatedAt = Date.now();
        box.state = state;
        await persist();
        window.dispatchEvent(new CustomEvent('wsm-state-changed', { detail: { reason } }));
        return clone(state);
    }
    function isGenerationSnapshot(item) {
        return item?.kind === 'generation' || item?.kind === 'organization' || item?.reason === 'planner';
    }
    function history() { return clone(envelope().history.filter(isGenerationSnapshot).slice(0, HISTORY_LIMIT)); }
    async function rollbackPreviousGeneration() {
        const box = envelope();
        const index = box.history.findIndex(isGenerationSnapshot);
        if (index < 0) throw new Error('还没有可回滚的上一轮生成结果');
        const [snap] = box.history.splice(index, 1);
        return save(snap.state, 'rollback-generation', { snapshot: false });
    }
    async function clearAll() {
        const box = envelope();
        box.state = WSM.Defaults.createState();
        box.history = [];
        delete box.sourceReadCache;
        await persist();
        window.dispatchEvent(new CustomEvent('wsm-state-changed', { detail: { reason: 'clear-all' } }));
        return clone(box.state);
    }
    function memoryItemCount(state) {
        return MEMORY_MODULES.reduce((total, module) => total + (Array.isArray(state?.[module]) ? state[module].length : 0), 0);
    }
    async function organizeState(mode = 'smart') {
        const current = load();
        if (!current.initialized) throw new Error('状态尚未初始化');
        const next = clone(current);
        const beforeItems = memoryItemCount(next);
        const beforeTimeline = next.timeline.length;
        const temporaryOnly = mode === 'temporary';
        const ongoing = (module, item) => {
            const status = String(item?.status || '').toLowerCase();
            if (module === 'characters') return item?.present === true;
            if (module === 'tasks') return ['pending','active','blocked'].includes(status);
            if (module === 'events') return status === 'ongoing';
            if (module === 'triggers') return ['armed','eligible'].includes(status);
            if (module === 'threads') return ['open','paused'].includes(status);
            if (module === 'processes') return ['active','decaying','paused'].includes(status);
            if (module === 'causalEffects') return ['developing','active'].includes(status);
            return false;
        };
        MEMORY_MODULES.filter((module) => module !== 'timeline').forEach((module) => {
            next[module] = (next[module] || []).filter((item) => {
                const priority = String(item?.priority || '').toUpperCase();
                const activity = String(item?.activity || '').toUpperCase();
                return priority !== 'L1' || activity === 'HOT' || ongoing(module, item);
            });
        });
        if (!temporaryOnly) next.timeline = compactTimeline(next.timeline, 24);
        compactState(next);
        next.planner ||= {};
        if (WSM.Injection?.compose) next.planner.injection = WSM.Injection.compose(next, next.planner.plan || {}, next.planner.moduleInjections || {});
        const saved = await save(next, temporaryOnly ? 'organize-temporary' : 'organize-smart', { snapshot: true, snapshotKind: 'organization' });
        return {
            state: saved,
            mode: temporaryOnly ? 'temporary' : 'smart',
            beforeItems,
            afterItems: memoryItemCount(saved),
            beforeTimeline,
            afterTimeline: saved.timeline.length,
        };
    }
    function getPath(root, path) {
        return String(path).split('.').filter(Boolean).reduce((value, key) => value?.[key], root);
    }
    function setPath(root, path, value) {
        const keys = String(path).split('.').filter(Boolean);
        if (!keys.length) return;
        let target = root;
        for (let i = 0; i < keys.length - 1; i += 1) {
            target[keys[i]] = target[keys[i]] && typeof target[keys[i]] === 'object' ? target[keys[i]] : {};
            target = target[keys[i]];
        }
        target[keys.at(-1)] = clone(value);
    }
    function enforceLocks(previous, candidate) {
        const result = clone(candidate || previous);
        const locks = Array.isArray(previous?.lockedPaths) ? previous.lockedPaths : [];
        locks.forEach((path) => setPath(result, path, getPath(previous, path)));
        result.lockedPaths = clone(locks);
        return result;
    }
    WSM.Storage = { load, save, history, rollbackPreviousGeneration, clearAll, organizeState, enforceLocks, clone, readSourceReadCache, writeSourceReadCache, _test: { compactState, compactTimeline, memoryItemCount, RETENTION_LIMITS } };
})();
