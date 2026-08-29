(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const KEY = 'worldStateMachine';
    const RULES_VERSION = 7;
    const defaults = {
        rulesVersion: RULES_VERSION,
        enabled: true,
        autoInitialize: true,
        useTavernApi: true,
        jailbreakPrompt: '',
        followTavernFont: true,
        customFontFamily: 'Inter, "Microsoft YaHei", sans-serif',
        fontScale: 0.9,
        endpoint: '',
        apiKey: '',
        model: '',
        apiProfiles: [],
        activeApiProfileId: '',
        temperature: 0.15,
        maxTokens: 5000,
        recentMessages: 12,
        maxSourceChars: 60000,
        injectionDepth: 0,
        injectionMaxChars: 3500,
        diceEnabled: false,
        blockOnPlannerError: false,
        injectionModules: WSM.Defaults.INJECTION_MODULES,
        modulePrompts: WSM.Defaults.MODULE_PROMPTS,
        worldbookCompiler: { enabled: false, entryKeys: [], budget: 500, contextMessages: 8, failClosed: true },
        timeoutMs: 180000,
        plannerPrompt: WSM.Defaults.PLANNER_PROMPT,
        reconcilerPrompt: WSM.Defaults.RECONCILER_PROMPT,
    };

    function context() { return window.SillyTavern?.getContext?.() || null; }
    function store() {
        const ctx = context();
        window.extension_settings = window.extension_settings || {};
        const root = ctx?.extensionSettings || window.extension_settings;
        const saved = root[KEY] || {};
        root[KEY] = Object.assign({}, defaults, saved);
        const rawProfiles = Array.isArray(root[KEY].apiProfiles) ? root[KEY].apiProfiles : [];
        const profiles = rawProfiles.map((profile, index) => ({
            id: String(profile?.id || `api-${index + 1}`),
            name: String(profile?.name || `API ${index + 1}`),
            endpoint: String(profile?.endpoint || ''),
            apiKey: String(profile?.apiKey || ''),
            model: String(profile?.model || ''),
        }));
        if (!profiles.length) profiles.push({
            id: 'api-default', name: 'API 1', endpoint: String(root[KEY].endpoint || ''),
            apiKey: String(root[KEY].apiKey || ''), model: String(root[KEY].model || ''),
        });
        root[KEY].apiProfiles = profiles;
        if (!profiles.some((profile) => profile.id === root[KEY].activeApiProfileId)) root[KEY].activeApiProfileId = profiles[0].id;
        const activeProfile = profiles.find((profile) => profile.id === root[KEY].activeApiProfileId) || profiles[0];
        root[KEY].endpoint = activeProfile.endpoint;
        root[KEY].apiKey = activeProfile.apiKey;
        root[KEY].model = activeProfile.model;
        if (Number(saved.rulesVersion || 0) < RULES_VERSION) {
            // Old saved prompts otherwise permanently override new built-ins. Keep a
            // recoverable copy, then migrate the complete rule set as one unit.
            root[KEY].promptMigrationBackup = {
                plannerPrompt: saved.plannerPrompt || '',
                reconcilerPrompt: saved.reconcilerPrompt || '',
                modulePrompts: saved.modulePrompts || {},
            };
            root[KEY].plannerPrompt = WSM.Defaults.PLANNER_PROMPT;
            root[KEY].reconcilerPrompt = WSM.Defaults.RECONCILER_PROMPT;
            root[KEY].modulePrompts = Object.assign({}, WSM.Defaults.MODULE_PROMPTS, saved.modulePrompts || {});
            ['causalLinks', 'causalSeeds', 'scenePressure', 'actorCausality', 'backgroundQueue', 'advanceScheduler'].forEach((id) => { delete root[KEY].modulePrompts[id]; });
            root[KEY].modulePrompts.causalEffects = WSM.Defaults.MODULE_PROMPTS.causalEffects;
            root[KEY].modulePrompts.planner = WSM.Defaults.MODULE_PROMPTS.planner;
            root[KEY].rulesVersion = RULES_VERSION;
            ctx?.saveSettingsDebounced?.();
            window.saveSettingsDebounced?.();
        }
        const savedModules = root[KEY].injectionModules || {};
        root[KEY].injectionModules = Object.fromEntries(Object.entries(WSM.Defaults.INJECTION_MODULES).map(([id, value]) => [id, Object.assign({}, value, savedModules[id] || {})]));
        root[KEY].modulePrompts = Object.assign({}, WSM.Defaults.MODULE_PROMPTS, root[KEY].modulePrompts || {});
        ['causalLinks', 'causalSeeds', 'scenePressure', 'actorCausality', 'backgroundQueue', 'advanceScheduler'].forEach((id) => { delete root[KEY].modulePrompts[id]; });
        root[KEY].worldbookCompiler = Object.assign({}, defaults.worldbookCompiler, root[KEY].worldbookCompiler || {});
        // maxTokens controls one response, not how much source is read. Keep a
        // sane provider-compatible generation budget; long sources are handled
        // by SourceReader's complete chunk pipeline.
        root[KEY].maxTokens = Math.max(256, Math.min(16384, Math.round(Number(root[KEY].maxTokens) || defaults.maxTokens)));
        window.extension_settings[KEY] = root[KEY];
        return root[KEY];
    }
    function get() { return store(); }
    function update(patch) {
        Object.assign(store(), patch || {});
        const ctx = context();
        ctx?.saveSettingsDebounced?.();
        window.saveSettingsDebounced?.();
        window.dispatchEvent(new CustomEvent('wsm-settings-changed'));
        return get();
    }
    WSM.Settings = { defaults, get, update };
})();
