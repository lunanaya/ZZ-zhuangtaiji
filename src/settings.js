(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const KEY = 'worldStateMachine';
    const RULES_VERSION = 28;
    const defaults = {
        rulesVersion: RULES_VERSION,
        enabled: true,
        autoInitialize: false,
        useTavernApi: true,
        gptMode: false,
        jailbreakPrompt: '',
        followTavernFont: true,
        customFontFamily: 'Inter, "Microsoft YaHei", sans-serif',
        fontScale: 0.9,
        launcherVisible: true,
        launcherPosition: null,
        endpoint: '',
        apiKey: '',
        model: '',
        apiProfiles: [],
        activeApiProfileId: '',
        temperature: 0.15,
        maxTokens: 5000,
        recentMessages: 12,
        summaryTag: 'meow_FM',
        maxSourceChars: 60000,
        injectionDepth: 0,
        injectionMaxChars: 3500,
        diceEnabled: false,
        storyPacing: { mode: 'off', allowSceneTransition: false, allowTimeSkip: false },
        blockOnPlannerError: false,
        injectionModules: WSM.Defaults.INJECTION_MODULES,
        modulePrompts: WSM.Defaults.MODULE_PROMPTS,
        worldbookCompiler: { enabled: false, selectedBookNames: [], knownBookNames: [], entryKeys: [], knownEntryKeys: [], budget: 500, contextMessages: 8, failClosed: true },
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
        const needsRulesMigration = Number(saved.rulesVersion || 0) < RULES_VERSION;
        if (needsRulesMigration) {
            // Old saved prompts otherwise permanently override new built-ins. Keep a
            // recoverable copy, then migrate the complete rule set as one unit.
            root[KEY].promptMigrationBackup = {
                plannerPrompt: saved.plannerPrompt || '',
                reconcilerPrompt: saved.reconcilerPrompt || '',
                modulePrompts: saved.modulePrompts || {},
            };
            root[KEY].plannerPrompt = WSM.Defaults.PLANNER_PROMPT;
            root[KEY].reconcilerPrompt = WSM.Defaults.RECONCILER_PROMPT;
            root[KEY].modulePrompts = Object.assign({}, WSM.Defaults.MODULE_PROMPTS, saved.modulePrompts || {}, {
                // These modules implement the bounded-state lifecycle plus the
                // people-memory and world-layer ownership models. They
                // must migrate together with the core prompts; the previous
                // customized text remains available in promptMigrationBackup.
                causalEffects: WSM.Defaults.MODULE_PROMPTS.causalEffects,
                organizations: WSM.Defaults.MODULE_PROMPTS.organizations,
                schedules: WSM.Defaults.MODULE_PROMPTS.schedules,
                pacing: WSM.Defaults.MODULE_PROMPTS.pacing,
                planner: WSM.Defaults.MODULE_PROMPTS.planner,
                characters: WSM.Defaults.MODULE_PROMPTS.characters,
                npcActivities: WSM.Defaults.MODULE_PROMPTS.npcActivities,
                relationships: WSM.Defaults.MODULE_PROMPTS.relationships,
                knowledge: WSM.Defaults.MODULE_PROMPTS.knowledge,
                world: WSM.Defaults.MODULE_PROMPTS.world,
                worldRules: WSM.Defaults.MODULE_PROMPTS.worldRules,
                processes: WSM.Defaults.MODULE_PROMPTS.processes,
                tasks: WSM.Defaults.MODULE_PROMPTS.tasks,
                triggers: WSM.Defaults.MODULE_PROMPTS.triggers,
                threads: WSM.Defaults.MODULE_PROMPTS.threads,
                progression: WSM.Defaults.MODULE_PROMPTS.progression,
                timeline: WSM.Defaults.MODULE_PROMPTS.timeline,
                map: WSM.Defaults.MODULE_PROMPTS.map,
            });
            ['events', 'causalLinks', 'causalSeeds', 'scenePressure', 'actorCausality', 'backgroundQueue', 'advanceScheduler'].forEach((id) => { delete root[KEY].modulePrompts[id]; });
            root[KEY].modulePrompts.causalEffects = WSM.Defaults.MODULE_PROMPTS.causalEffects;
            root[KEY].modulePrompts.planner = WSM.Defaults.MODULE_PROMPTS.planner;
            root[KEY].rulesVersion = RULES_VERSION;
            ctx?.saveSettingsDebounced?.();
            window.saveSettingsDebounced?.();
        }
        const savedModules = root[KEY].injectionModules || {};
        root[KEY].injectionModules = Object.fromEntries(Object.entries(WSM.Defaults.INJECTION_MODULES).map(([id, value]) => [id, Object.assign({}, value, savedModules[id] || {})]));
        if (needsRulesMigration) ['characters','organizations','npcActivities','relationships','knowledge','world','worldRules','schedules','processes','causalEffects','tasks','triggers','threads','progression','pacing','map'].forEach((id) => {
            root[KEY].injectionModules[id].instruction = WSM.Defaults.INJECTION_MODULES[id].instruction;
        });
        if (needsRulesMigration && root[KEY].injectionModules.map) root[KEY].injectionModules.map.enabled = true;
        if (needsRulesMigration && root[KEY].injectionModules.knowledge) root[KEY].injectionModules.knowledge.enabled = true;
        root[KEY].modulePrompts = Object.assign({}, WSM.Defaults.MODULE_PROMPTS, root[KEY].modulePrompts || {});
        ['events', 'causalLinks', 'causalSeeds', 'scenePressure', 'actorCausality', 'backgroundQueue', 'advanceScheduler'].forEach((id) => { delete root[KEY].modulePrompts[id]; });
        root[KEY].worldbookCompiler = Object.assign({}, defaults.worldbookCompiler, root[KEY].worldbookCompiler || {});
        root[KEY].storyPacing = Object.assign({}, defaults.storyPacing, root[KEY].storyPacing || {});
        if (!['off','verySlow','slow','medium','fast'].includes(root[KEY].storyPacing.mode)) root[KEY].storyPacing.mode = 'off';
        root[KEY].storyPacing.allowSceneTransition = root[KEY].storyPacing.allowSceneTransition === true;
        root[KEY].storyPacing.allowTimeSkip = root[KEY].storyPacing.allowTimeSkip === true;
        root[KEY].gptMode = root[KEY].gptMode === true;
        root[KEY].launcherVisible = root[KEY].launcherVisible !== false;
        const launcherPosition = root[KEY].launcherPosition;
        root[KEY].launcherPosition = launcherPosition && Number.isFinite(Number(launcherPosition.x)) && Number.isFinite(Number(launcherPosition.y))
            ? { x: Number(launcherPosition.x), y: Number(launcherPosition.y) }
            : null;
        // Kept only as a compatibility field for older saved settings. Reading
        // and initialization are always manual from v0.9.21 onward.
        root[KEY].autoInitialize = false;
        // maxTokens controls one response, not how much source is read. Keep a
        // sane provider-compatible generation budget; long sources are handled
        // by SourceReader's complete chunk pipeline.
        root[KEY].maxTokens = Math.max(256, Math.min(16384, Math.round(Number(root[KEY].maxTokens) || defaults.maxTokens)));
        const recentMessages = Number(root[KEY].recentMessages);
        root[KEY].recentMessages = Number.isFinite(recentMessages) ? Math.max(0, Math.min(200, Math.round(recentMessages))) : defaults.recentMessages;
        root[KEY].summaryTag = typeof root[KEY].summaryTag === 'string' ? root[KEY].summaryTag.trim() : defaults.summaryTag;
        delete root[KEY].calibrationConcurrency;
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
