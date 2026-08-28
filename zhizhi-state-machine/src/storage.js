(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const META_KEY = 'worldStateMachine';
    const HISTORY_LIMIT = 10;

    const clone = (value) => {
        try { return structuredClone(value); }
        catch (_) { return JSON.parse(JSON.stringify(value)); }
    };
    function context() { return window.SillyTavern?.getContext?.() || null; }
    function metadata() {
        const ctx = context();
        if (!ctx) return null;
        if (ctx.chatMetadata && typeof ctx.chatMetadata === 'object') return ctx.chatMetadata;
        if (window.chat_metadata && typeof window.chat_metadata === 'object') return window.chat_metadata;
        try { ctx.chatMetadata = {}; return ctx.chatMetadata; }
        catch (_) { return null; }
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
        state.map = Object.assign({ currentLocationId: '', locations: [], routes: [] }, state.map || {});
        state.map.locations = Array.isArray(state.map.locations) ? state.map.locations : [];
        state.map.routes = Array.isArray(state.map.routes) ? state.map.routes : [];
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
            if (character.id && Number.isFinite(Number(character.lastUpdatedElapsedMinutes))) {
                state.runtime.npcLastUpdatedElapsedMinutes[character.id] = Number(character.lastUpdatedElapsedMinutes);
            }
            delete character.lastUpdatedElapsedMinutes;
            return character;
        });
        state.npcActivities = state.npcActivities.map((item) => { const next = Object.assign({}, item); delete next.at; return next; });
        state.events = state.events.map((item) => { const next = Object.assign({}, item); delete next.startedAt; return next; });
        state.triggers = state.triggers.map((item) => { const next = Object.assign({}, item); if (next.earliestAt && !next.conditions?.some((condition) => String(condition).includes(next.earliestAt))) next.conditions = [...(next.conditions || []), `世界时间达到${next.earliestAt}`]; delete next.earliestAt; return next; });
        state.processes = state.processes.map((item) => { const next = Object.assign({}, item); delete next.lastUpdatedAt; return next; });
        state.timeline = state.timeline.map((item) => { const next = Object.assign({}, item); delete next.at; return next; });
        state.schemaVersion = 6;
        return state;
    }
    function load() { return normalizeState(envelope().state); }
    async function persist() {
        const ctx = context();
        if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
        else if (typeof window.saveChatConditional === 'function') await window.saveChatConditional();
        else window.saveMetadataDebounced?.();
    }
    async function save(next, reason = 'update', options = {}) {
        const box = envelope();
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
    WSM.Storage = { load, save, history, rollbackPreviousGeneration, enforceLocks, clone };
})();
