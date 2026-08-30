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
        worldFacts: 32, locations: 48, routes: 64, characters: 24, npcActivities: 40,
        relationships: 32, knowledge: 40, tasks: 16, events: 16, triggers: 8,
        threads: 12, processes: 12, causalEffects: 12, timeline: 40,
    });
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
    function activeFirst(values, limit, important) {
        const unique = uniqueRecent(values, Math.max(limit, (values || []).length));
        if (unique.length <= limit) return unique;
        const selected = new Set([...unique.filter(important), ...unique.filter((item) => !important(item))].slice(0, limit));
        return unique.filter((item) => selected.has(item));
    }
    function compactState(state) {
        state.world.facts = trimArray(state.world.facts, RETENTION_LIMITS.worldFacts);

        const locationsById = new Map(state.map.locations.map((item) => [item.id, item]));
        const requiredLocationIds = new Set();
        let locationId = state.map.currentLocationId;
        while (locationId && !requiredLocationIds.has(locationId) && requiredLocationIds.size < RETENTION_LIMITS.locations) {
            requiredLocationIds.add(locationId);
            locationId = locationsById.get(locationId)?.parentId || '';
        }
        const keptLocationIds = new Set(requiredLocationIds);
        state.map.locations.slice().reverse().forEach((candidate) => {
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
        state.map.locations = locationPool.map((item) => trimFields(item, { sourceRefs: 6 }));
        state.map.routes = uniqueRecent(state.map.routes.filter((item) => keptLocationIds.has(item.from) && keptLocationIds.has(item.to)), RETENTION_LIMITS.routes, (item) => `${item.from}>${item.to}`);

        state.characters = activeFirst(state.characters, RETENTION_LIMITS.characters, (item) => ['user','char','<user>','<char>'].includes(String(item?.id || '').toLowerCase()) || item?.present === true)
            .map((item) => trimFields(item, { heldItems: 8, injuries: 8, resources: 10, goals: 8, memories: 12 }));
        state.npcActivities = state.npcActivities.slice(-RETENTION_LIMITS.npcActivities);
        state.relationships = uniqueRecent(state.relationships, RETENTION_LIMITS.relationships).map((item) => trimFields(item, { evidence: 8 }));
        state.knowledge = uniqueRecent(state.knowledge, RETENTION_LIMITS.knowledge).map((item) => trimFields(item, {
            knownBy: 12, believedBy: 12, suspectedBy: 12, misunderstoodBy: 12, concealedBy: 12,
            unknownTo: 12, relatedRefs: 10, evidence: 10, discoveryPaths: 8, maturityConditions: 8,
        }));
        state.tasks = activeFirst(state.tasks.filter((item) => !['done','failed'].includes(item?.status)), RETENTION_LIMITS.tasks, (item) => ['active','blocked'].includes(item?.status))
            .map((item) => trimFields(item, { ownerIds: 8, dependencies: 8, consequences: 8, sourceRefs: 8, choices: 4 }));
        state.events = activeFirst(state.events.filter((item) => item?.status !== 'resolved'), RETENTION_LIMITS.events, (item) => item?.status === 'active')
            .map((item) => trimFields(item, { participantIds: 10, developments: 8 }));
        state.triggers = uniqueRecent(state.triggers.filter((item) => !['triggered','expired'].includes(item?.status)), RETENTION_LIMITS.triggers)
            .map((item) => trimFields(item, { conditions: 8, effectsIfTriggered: 8, blockedReasons: 6, sourceRefs: 8, choices: 4 }));
        state.threads = activeFirst(state.threads.filter((item) => item?.status !== 'resolved'), RETENTION_LIMITS.threads, (item) => item?.status === 'open')
            .map((item) => trimFields(item, { participantIds: 10, history: 8 }));
        state.processes = activeFirst(state.processes.filter((item) => !['resolved','transformed'].includes(item?.status)), RETENTION_LIMITS.processes, (item) => ['active','decaying'].includes(item?.status))
            .map((item) => trimFields(item, { drivers: 8, decayConditions: 6, resolutionConditions: 6 }));
        state.causalEffects = activeFirst(state.causalEffects.filter((item) => !['resolved','discarded'].includes(item?.status)), RETENTION_LIMITS.causalEffects, (item) => item?.status === 'arrived')
            .map((item) => trimFields(item, { steps: 6, affectedIds: 10, evidenceRefs: 8 }));
        state.timeline = uniqueRecent(state.timeline, RETENTION_LIMITS.timeline).map((item) => trimFields(item, { participants: 10, evidence: 8, actualChanges: 8 }));
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
            location.description = String(location.description || '');
            location.sourceRefs = Array.isArray(location.sourceRefs) ? location.sourceRefs.filter(Boolean).map(String) : [];
            location.x = Number.isFinite(Number(location.x)) ? Math.max(0, Math.min(100, Number(location.x))) : null;
            location.y = Number.isFinite(Number(location.y)) ? Math.max(0, Math.min(100, Number(location.y))) : null;
            return location;
        });
        const locationsByName = new Map(state.map.locations.map((item) => [item.name, item]));
        const usedIds = new Set(state.map.locations.map((item) => item.id));
        state.map.locations.slice().forEach((location) => {
            if (location.parentId || !location.area || location.area === location.name) return;
            let parent = locationsByName.get(location.area);
            if (!parent) {
                let id = stableMapId('area', location.area);
                while (usedIds.has(id)) id = `${id}-area`;
                parent = { id, name: location.area, type: mapTypeFromName(location.area, 'region'), parentId: '', x: null, y: null, area: '', description: '由旧地图所属区域迁移', status: 'known', sourceRefs: [] };
                state.map.locations.push(parent);
                locationsByName.set(parent.name, parent);
                usedIds.add(parent.id);
            }
            location.parentId = parent.id;
        });
        const siblings = new Map();
        state.map.locations.forEach((location) => { (siblings.get(location.parentId) || siblings.set(location.parentId, []).get(location.parentId)).push(location); });
        siblings.forEach((items) => items.forEach((location, index) => {
            if (location.x === null) location.x = 15 + ((index * 31) % 70);
            if (location.y === null) location.y = 18 + ((Math.floor(index / 3) * 31 + (index % 3) * 13) % 64);
        }));
        state.map.routes = (Array.isArray(state.map.routes) ? state.map.routes : []).map((item) => ({
            ...item, from: String(item?.from || ''), to: String(item?.to || ''), status: String(item?.status || 'open'),
            description: String(item?.description || ''), travelMinutes: Number.isFinite(Number(item?.travelMinutes)) ? Number(item.travelMinutes) : 0,
            distance: String(item?.distance || ''),
        })).filter((item) => item.from && item.to);
        if (!state.initialized && state.world.time.display === '未设定') state.world.time.display = '';
        if (!state.initialized && state.world.location.current === '未设定') state.world.location.current = '';
        ['characters','npcActivities','relationships','knowledge','tasks','events','triggers','threads','processes','causalEffects','timeline','lockedPaths'].forEach((key) => {
            state[key] = Array.isArray(state[key]) ? state[key] : [];
        });
        if (!state.causalEffects.length) {
            const legacyLinks = Array.isArray(state.causalLinks) ? state.causalLinks : [];
            const legacySeeds = Array.isArray(state.causalSeeds) ? state.causalSeeds : [];
            state.causalEffects = [
                ...legacyLinks.map((item, index) => ({
                    id: item.id || `legacy-causal-link-${index}`, causeRef: item.rootCauseRef || '', cause: item.rootCauseRef || '既存起因',
                    steps: Array.isArray(item.requiredSteps) ? item.requiredSteps : [], result: item.effect || '', affectedIds: [],
                    status: item.status === 'reached' ? 'arrived' : item.status === 'resolved' ? 'resolved' : 'developing', reachCondition: '', evidenceRefs: item.evidenceRefs || [],
                })),
                ...legacySeeds.map((item, index) => ({
                    id: item.id || `legacy-causal-seed-${index}`, causeRef: item.rootCauseRef || '', cause: item.rootCauseRef || '既存起因',
                    steps: [], result: item.potentialEffect || '', affectedIds: [], status: item.status === 'reached' ? 'arrived' : item.status === 'expired' ? 'discarded' : 'developing',
                    reachCondition: Array.isArray(item.naturalReachConditions) ? item.naturalReachConditions.join('；') : '', evidenceRefs: item.evidenceRefs || [],
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
        const activityCounts = new Map();
        state.npcActivities = state.npcActivities.slice().reverse().filter((item) => {
            if (!item?.characterId || !item?.action) return false;
            const count = activityCounts.get(item.characterId) || 0;
            if (count >= 5) return false;
            activityCounts.set(item.characterId, count + 1);
            return true;
        }).reverse();
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
            delete character.lastUpdatedElapsedMinutes;
            return character;
        });
        const charactersByName = new Map();
        state.characters.forEach((character, index) => {
            const name = String(character?.name || '').trim().toLocaleLowerCase();
            const key = name ? `name:${name}` : `id:${String(character?.id || index)}`;
            const previous = charactersByName.get(key);
            if (!previous) { charactersByName.set(key, character); return; }
            const canonicalId = [previous.id, character.id].find((id) => ['user','char','character'].includes(String(id || '').toLowerCase()));
            const merged = { ...previous, ...character, id: canonicalId || previous.id || character.id };
            ['heldItems','injuries','resources','goals','memories','sourceRefs'].forEach((field) => {
                const values = [...(Array.isArray(previous[field]) ? previous[field] : []), ...(Array.isArray(character[field]) ? character[field] : [])];
                if (values.length) merged[field] = [...new Set(values.map((item) => typeof item === 'string' ? item : JSON.stringify(item)))].map((item) => {
                    try { return JSON.parse(item); } catch (_) { return item; }
                });
            });
            charactersByName.set(key, merged);
        });
        state.characters = [...charactersByName.values()];
        state.npcActivities = state.npcActivities.map((item) => { const next = Object.assign({}, item); delete next.at; return next; });
        state.events = state.events.map((item) => { const next = Object.assign({}, item); delete next.startedAt; return next; });
        state.triggers = state.triggers.map((item) => { const next = Object.assign({}, item); if (next.earliestAt && !next.conditions?.some((condition) => String(condition).includes(next.earliestAt))) next.conditions = [...(next.conditions || []), `世界时间达到${next.earliestAt}`]; delete next.earliestAt; return next; });
        const normalizeChoices = (item) => {
            const choices = Array.isArray(item?.choices) ? item.choices : [];
            const seen = new Set();
            return choices.map((choice, index) => {
                const source = typeof choice === 'string' ? { label: choice, message: choice } : (choice || {});
                const label = String(source.label || source.title || source.message || '').trim();
                const message = String(source.message || source.prompt || source.text || label).trim();
                const key = `${label}\n${message}`;
                if (!label || !message || seen.has(key)) return null;
                seen.add(key);
                return { id: String(source.id || `choice-${index + 1}`), label, message };
            }).filter(Boolean).slice(0, 4);
        };
        state.tasks = state.tasks.map((item) => ({ ...item, choices: normalizeChoices(item) }));
        state.triggers = state.triggers.map((item) => ({ ...item, choices: normalizeChoices(item) }));
        state.processes = state.processes.map((item) => { const next = Object.assign({}, item); delete next.lastUpdatedAt; return next; });
        state.timeline = state.timeline.map((item) => { const next = Object.assign({}, item); delete next.at; return next; });
        state.schemaVersion = 9;
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
        return item?.kind === 'generation' || item?.reason === 'planner';
    }
    function history() { return clone(envelope().history.filter(isGenerationSnapshot).slice(0, HISTORY_LIMIT)); }
    async function rollbackPreviousGeneration() {
        const box = envelope();
        const index = box.history.findIndex(isGenerationSnapshot);
        if (index < 0) throw new Error('还没有可回滚的上一轮生成结果');
        const [snap] = box.history.splice(index, 1);
        return save(snap.state, 'rollback-generation', { snapshot: false });
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
    WSM.Storage = { load, save, history, rollbackPreviousGeneration, enforceLocks, clone, readSourceReadCache, writeSourceReadCache, _test: { compactState, RETENTION_LIMITS } };
})();
