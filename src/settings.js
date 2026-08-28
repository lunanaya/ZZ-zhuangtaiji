(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const KEY = 'worldStateMachine';
    const RULES_VERSION = 7;
    const defaults = {
        rulesVersion: RULES_VERSION,
        enabled: true,
        autoInitialize: true,
        endpoint: '',
        apiKey: '',
        model: '',
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
        timeoutMs: 90000,
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
