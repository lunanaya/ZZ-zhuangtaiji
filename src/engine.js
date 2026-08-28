(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const PROMPT_ID = 'WORLD_STATE_MACHINE_CONTEXT';
    let planningPromise = null;
    let settlingPromise = null;
    let bound = false;
    let settingsBound = false;
    let autoInitializeTimer = null;
    let autoInitializeAttempts = 0;

    const safeText = (value) => String(value ?? '').trim();
    function syncIdentities(state, names = WSM.Context.identityNames()) {
        const next = state;
        const identities = {
            user: safeText(names?.user || next.identities?.user),
            char: safeText(names?.char || next.identities?.char),
        };
        next.identities = identities;
        (next.characters || []).forEach((character) => {
            const id = safeText(character?.id).toLowerCase();
            if (['user','<user>'].includes(id) && identities.user) character.name = identities.user;
            if (['char','character','<char>'].includes(id) && identities.char) character.name = identities.char;
        });
        return next;
    }
    function isForeground(type) {
        const value = safeText(type).toLowerCase();
        return !['quiet', 'impersonate'].includes(value);
    }
    function generationBlockReason(settings, planner) {
        if (settings?.blockOnPlannerError && planner?.error) {
            return `Planner 失败且已启用严格阻止：${safeText(planner.error)}`;
        }
        return '';
    }
    function plannerAvailable(settings = WSM.Settings.get()) {
        if (settings?.useTavernApi !== false) return typeof WSM.Context.context()?.generateRaw === 'function';
        return !!safeText(settings?.endpoint);
    }
    function activeChatAvailable() {
        const ctx = WSM.Context.context();
        return (Number.isInteger(ctx?.characterId) && ctx.characterId >= 0) || !!ctx?.groupId || (Array.isArray(ctx?.chat) && ctx.chat.length > 0);
    }
    function turnKey() {
        const message = WSM.Context.latestUserMessage();
        return message ? `${message.id}:${hash(message.content)}` : '';
    }
    function hash(value) {
        const input = safeText(value);
        let result = 0;
        for (let i = 0; i < input.length; i += 1) result = ((result << 5) - result + input.charCodeAt(i)) | 0;
        return (result >>> 0).toString(36);
    }
    function normalizeInjection(value) {
        let output = safeText(value);
        output = output.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```$/, '').trim();
        if (!output.startsWith('<WORLD_STATE>')) output = `<WORLD_STATE>\n${output}`;
        if (!output.endsWith('</WORLD_STATE>')) output += '\n</WORLD_STATE>';
        return output.slice(0, 5000);
    }
    function fallbackInjection(state) {
        const names = (state.characters || []).filter((item) => item.present || item.location === state.world?.location?.current).map((item) => item.name).filter(Boolean);
        return normalizeInjection([
            `时间：${state.world?.time?.display || '未设定'}`,
            `地点：${state.world?.location?.current || '未设定'}`,
            names.length ? `在场：${names.join('、')}` : '',
            '遵守已有状态、人物知识边界与因果关系；没有充分理由时，不要引入新人物或突发事件。',
        ].filter(Boolean).join('\n'));
    }
    function buildNpcSchedule(state) {
        const elapsed = Number(state.world?.time?.elapsedMinutes || 0);
        const currentLocation = safeText(state.world?.location?.current);
        const updatedAt = state.runtime?.npcLastUpdatedElapsedMinutes || {};
        return (state.characters || []).map((character) => {
            const last = Number(updatedAt[character.id] || 0);
            const minutesSinceUpdate = Math.max(0, elapsed - last);
            const visible = character.present === true || (!!currentLocation && safeText(character.location) === currentLocation);
            const mode = visible ? 'realtime' : (minutesSinceUpdate >= 60 ? 'background' : 'carry');
            return {
                characterId: character.id,
                name: character.name,
                mode,
                minutesSinceUpdate,
                reason: visible ? '与当前场景同地点或明确在场' : (mode === 'background' ? '离场且达到一小时后台更新间隔' : '离场且尚未达到后台更新间隔'),
            };
        });
    }
    function plannerState(state) {
        const next = WSM.Storage.clone(state);
        // Technical clocks and cached planner output are program-owned. Keeping
        // them out of the model payload prevents competing timelines.
        delete next.updatedAt;
        delete next.runtime;
        delete next.planner;
        return next;
    }
    function summarizeSource(source) {
        return {
            checkedAt: Date.now(),
            characterCard: !!source?.character,
            persona: !!source?.persona,
            chatMessages: Number(source?.tavernTextContext?.includedMessages || 0),
            chatTotalMessages: Number(source?.tavernTextContext?.totalMessages || 0),
            chatTruncated: source?.tavernTextContext?.truncated === true,
            requestedWorldbooks: source?.worldbookDiagnostics?.requestedNames || [],
            loadedWorldbooks: source?.worldbookDiagnostics?.loadedNames || [],
            failedWorldbooks: source?.worldbookDiagnostics?.failedNames || [],
            worldbookEntryCounts: source?.worldbookDiagnostics?.entryCounts || {},
            worldbookReadSources: source?.worldbookDiagnostics?.readSources || {},
        };
    }
    function updateNpcClock(previous, next, plan, initialize = false) {
        const clock = Object.assign({}, previous.runtime?.npcLastUpdatedElapsedMinutes || {});
        const elapsed = Number(next.world?.time?.elapsedMinutes || 0);
        if (initialize) (next.characters || []).forEach((item) => { if (item?.id) clock[item.id] = elapsed; });
        (plan?.npcUpdates || []).forEach((item) => {
            if (item?.characterId && item.mode !== 'carry') clock[item.characterId] = elapsed;
        });
        return clock;
    }
    async function setPrompt(content) {
        const ctx = WSM.Context.context();
        if (typeof ctx?.setExtensionPrompt === 'function') {
            await ctx.setExtensionPrompt(PROMPT_ID, content, 1, Number(WSM.Settings.get().injectionDepth || 0), false, 0);
        } else if (typeof window.setExtensionPrompt === 'function') {
            await window.setExtensionPrompt(PROMPT_ID, content, 1, Number(WSM.Settings.get().injectionDepth || 0), false, 0);
        }
    }
    async function syncRegisteredPrompt() {
        const settings = WSM.Settings.get();
        if (!settings.enabled) return setPrompt('');
        const state = WSM.Storage.load();
        const hasUsableState = state.initialized || !!safeText(state.planner?.injection);
        if (!hasUsableState) return setPrompt('');
        state.planner.injection = WSM.Injection.compose(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
        return setPrompt(state.planner.injection);
    }
    async function plan(options = {}) {
        const settings = WSM.Settings.get();
        if (!settings.enabled) {
            await setPrompt('');
            return null;
        }
        const key = turnKey();
        let current = syncIdentities(WSM.Storage.load());
        if (!current.runtime?.needsWorldRefresh && !options.force && key && current.planner?.turnKey === key && current.planner?.injection && !current.planner?.error) {
            current.planner.injection = WSM.Injection.compose(current, current.planner.plan || {}, current.planner.moduleInjections || {});
            await setPrompt(current.planner.injection);
            return current.planner;
        }
        if (!plannerAvailable(settings)) {
            const diceRound = settings.diceEnabled ? WSM.Dice?.createRound?.(key) : null;
            const localPlan = diceRound ? { diceRound } : {};
            const injection = WSM.Injection.compose(current, localPlan, {});
            const error = settings.useTavernApi !== false ? '酒馆默认 API 当前不可用' : '尚未配置 Planner API';
            current.planner = { lastRunAt: Date.now(), turnKey: key, plan: localPlan, moduleInjections: {}, injection, error };
            if (diceRound) current = await WSM.Storage.save(current, 'local-dice', { snapshot: false });
            await setPrompt(injection);
            return current.planner;
        }

        const rebuilding = options.initialize === true;
        const refreshWorld = !rebuilding && current.initialized && current.runtime?.needsWorldRefresh === true;
        const initializing = !current.initialized || rebuilding;
        const source = await WSM.Context.buildSource({ fullChat: initializing || refreshWorld || options.initialize });
        const fingerprint = WSM.Context.sourceFingerprint(source);
        const compilerResult = await WSM.WorldbookCompiler?.processSource?.(source);
        const sourceSummary = Object.assign(summarizeSource(source), {
            worldbookCompiler: compilerResult?.enabled ? {
                selectedEntries: Number(compilerResult.selected || 0),
                routedChars: String(compilerResult.routed || '').length,
            } : null,
        });
        const phase = initializing ? 'INITIALIZE_WORLD' : (refreshWorld ? 'REFRESH_WORLD' : 'PRE_GENERATION_PLAN');
        const diceRound = settings.diceEnabled ? WSM.Dice?.createRound?.(key) : null;
        const payload = {
            phase,
            instructions: initializing
                ? '完整理解角色卡、Persona、聊天与已启用世界书，建立初始持久世界状态；除user和char外，提取3至12名最相关的既存NPC。'
                : refreshWorld
                    ? '保留已经成立的事实，重新阅读完整角色卡与世界书，补齐其中有姓名、身份或长期关系的3至12名相关NPC；不要把无关路人塞入世界，也不要重演历史。'
                    : '推进用户本轮行为后的世界后台，规划但不要假定正文将发生的事情。',
            source,
            currentState: plannerState(current),
            stateSchema: WSM.Defaults.STATE_SCHEMA,
            moduleOwnership: WSM.Defaults.MODULE_OWNERSHIP,
            modulePrompts: settings.modulePrompts || WSM.Defaults.MODULE_PROMPTS,
            simulationClock: { elapsedMinutes: Number(current.world?.time?.elapsedMinutes || 0), display: current.world?.time?.display || '' },
            npcSchedule: buildNpcSchedule(current),
            simulationRules: {
                offscreenUpdateIntervalMinutes: 60,
                updateVisibleCharactersEveryTick: true,
                carryOffscreenCharactersBetweenDueTicks: true,
                requirePreexistingCauseForRipple: true,
                allowNoSignificantChange: true,
            },
            lockedPaths: current.lockedPaths || [],
        };
        if (diceRound) payload.diceRound = diceRound;
        try {
            if (compilerResult?.blocked) throw new Error(compilerResult.error || '世界书拆解阻止了 Planner 请求');
            const plannerPrompt = `${settings.plannerPrompt}${diceRound ? WSM.Dice.plannerInstructions(diceRound) : ''}`;
            const result = await WSM.Api.complete(plannerPrompt, payload);
            if (!result?.state || typeof result.state !== 'object') throw new Error('Planner 响应缺少 state');
            let next = WSM.Storage.enforceLocks(current, result.state);
            next = syncIdentities(next, source.identities);
            next.initialized = true;
            next.runtime = Object.assign({}, current.runtime, next.runtime, {
                lastUserMessageId: source.currentUserAction?.id || '',
                sourceFingerprint: fingerprint,
                sourceSummary,
                worldbookInjection: compilerResult?.report || current.runtime?.worldbookInjection || null,
                npcLastUpdatedElapsedMinutes: updateNpcClock(current, next, result.plan, initializing || refreshWorld),
                needsWorldRefresh: false,
            });
            const nextPlan = Object.assign({}, result.plan || {});
            if (diceRound) nextPlan.diceRound = diceRound;
            else delete nextPlan.diceRound;
            next.planner = {
                lastRunAt: Date.now(),
                turnKey: key,
                plan: nextPlan,
                moduleInjections: result.moduleInjections && typeof result.moduleInjections === 'object' ? result.moduleInjections : {},
                injection: '',
                error: '',
            };
            next.planner.injection = WSM.Injection.compose(next, next.planner.plan || {}, next.planner.moduleInjections);
            next = await WSM.Storage.save(next, initializing ? 'initialize' : (refreshWorld ? 'refresh-world' : 'planner'), {
                snapshot: current.initialized && !refreshWorld,
                snapshotKind: 'generation',
            });
            await setPrompt(next.planner.injection);
            return next.planner;
        } catch (error) {
            current.runtime = Object.assign({}, current.runtime, { sourceSummary, worldbookInjection: compilerResult?.report || current.runtime?.worldbookInjection || null });
            current.planner = Object.assign({}, current.planner, {
                lastRunAt: Date.now(), turnKey: key, error: safeText(error?.message || error), moduleInjections: current.planner?.moduleInjections || {}, injection: WSM.Injection.compose(current, current.planner?.plan || {}, current.planner?.moduleInjections || {}),
            });
            await WSM.Storage.save(current, 'planner-error', { snapshot: false });
            await setPrompt(current.planner.injection);
            console.error('[WorldStateMachine] Planner 失败，使用当前状态降级', error);
            return current.planner;
        }
    }
    async function ensurePlan(options = {}) {
        if (planningPromise) return planningPromise;
        planningPromise = plan(options).finally(() => { planningPromise = null; });
        return planningPromise;
    }
    async function autoInitialize(reason = 'startup') {
        const settings = WSM.Settings.get();
        const state = WSM.Storage.load();
        if (!settings.enabled || settings.autoInitialize === false || state.initialized) return null;
        if (!activeChatAvailable() || !plannerAvailable(settings)) {
            if (settings.useTavernApi !== false && autoInitializeAttempts < 30) {
                autoInitializeAttempts += 1;
                scheduleAutoInitialize('waiting-for-chat-api', 1000);
            }
            return null;
        }
        autoInitializeAttempts = 0;
        console.info(`[WorldStateMachine] 自动读取当前聊天：${reason}`);
        return ensurePlan({ force: true, initialize: true, reason });
    }
    function scheduleAutoInitialize(reason, delay = 800) {
        window.clearTimeout(autoInitializeTimer);
        autoInitializeTimer = window.setTimeout(async () => {
            await syncRegisteredPrompt();
            await autoInitialize(reason);
        }, delay);
    }
    async function interceptor(chat, _contextSize, abort, type) {
        const settings = WSM.Settings.get();
        if (!isForeground(type)) return;
        if (!settings.enabled) {
            await setPrompt('');
            return;
        }
        try {
            const earlyBlock = generationBlockReason(settings, null);
            if (earlyBlock) {
                if (typeof abort === 'function') abort(earlyBlock);
                else throw new Error(earlyBlock);
                return;
            }
            const compiler = await WSM.WorldbookCompiler?.processChat?.(chat);
            if (compiler?.blocked) {
                const message = compiler.error || '世界书拆解安全检查阻止了正文请求';
                if (typeof abort === 'function') abort(message);
                else throw new Error(message);
                return;
            }
            const planner = await ensurePlan();
            const plannerBlock = generationBlockReason(WSM.Settings.get(), planner);
            if (plannerBlock) {
                if (typeof abort === 'function') abort(plannerBlock);
                else throw new Error(plannerBlock);
                return;
            }
            // WORLD_STATE is delivered only through setExtensionPrompt. The
            // interceptor intentionally does not mutate chat, avoiding duplicate
            // injection and making injectionDepth authoritative.
        } catch (error) {
            console.error('[WorldStateMachine] 生成拦截失败', error);
            if (typeof abort === 'function' && WSM.Settings.get().blockOnPlannerError) abort(error.message);
        }
    }
    window.WorldStateMachine_interceptGeneration = interceptor;

    function assistantKey(message) { return message ? `${message.id}:${hash(message.content)}` : ''; }
    async function settle(options = {}) {
        const current = WSM.Storage.load();
        if (!current.initialized || !current.planner?.turnKey) return null;
        const assistant = WSM.Context.latestAssistantMessage();
        const key = assistantKey(assistant);
        if (!assistant?.content || (!options.force && current.runtime?.lastSettledMessageId === key)) return null;
        const settings = WSM.Settings.get();
        if (!plannerAvailable(settings)) return null;
        const recent = (await WSM.Context.buildSource()).chat;
        const payload = {
            phase: 'POST_GENERATION_RECONCILE',
            preState: plannerState(current),
            plannerResult: current.planner,
            actualAssistantMessage: assistant,
            recentChat: recent,
            stateSchema: WSM.Defaults.STATE_SCHEMA,
            moduleOwnership: WSM.Defaults.MODULE_OWNERSHIP,
            modulePrompts: settings.modulePrompts || WSM.Defaults.MODULE_PROMPTS,
            lockedPaths: current.lockedPaths || [],
        };
        try {
            const result = await WSM.Api.complete(settings.reconcilerPrompt, payload);
            if (!result?.state || typeof result.state !== 'object') throw new Error('结算响应缺少 state');
            let next = WSM.Storage.enforceLocks(current, result.state);
            next = syncIdentities(next, current.identities);
            next.initialized = true;
            next.planner = current.planner;
            next.runtime = Object.assign({}, current.runtime, next.runtime, { lastSettledMessageId: key });
            if (result.timelineEntry?.summary) {
                next.timeline = Array.isArray(next.timeline) ? next.timeline : [];
                const entry = Object.assign({ id: `turn-${Date.now()}` }, result.timelineEntry, { actualChanges: result.actualChanges || [] });
                if (!next.timeline.some((item) => item?.id === entry.id || (item?.summary === entry.summary && item?.messageId === key))) {
                    entry.messageId = key;
                    next.timeline.push(entry);
                }
            }
            return await WSM.Storage.save(next, 'reconcile', { snapshot: false });
        } catch (error) {
            const next = WSM.Storage.load();
            next.planner = Object.assign({}, next.planner, { error: `结算失败：${safeText(error?.message || error)}` });
            await WSM.Storage.save(next, 'reconcile-error', { snapshot: false });
            console.error('[WorldStateMachine] 正文结算失败', error);
            return null;
        }
    }
    async function ensureSettle(options = {}) {
        if (settlingPromise) return settlingPromise;
        settlingPromise = settle(options).finally(() => { settlingPromise = null; });
        return settlingPromise;
    }
    function bindEvents() {
        if (bound) return true;
        const ctx = WSM.Context.context();
        const events = ctx?.event_types || window.event_types;
        const source = ctx?.eventSource || window.eventSource;
        if (!events || !source?.on) return false;
        bound = true;
        const before = events.GENERATION_AFTER_COMMANDS || 'generation_after_commands';
        source.on(before, async (type) => {
            if (isForeground(type)) await ensurePlan();
        });
        const onAssistant = () => window.setTimeout(() => ensureSettle(), 500);
        [events.CHARACTER_MESSAGE_RENDERED, events.MESSAGE_RECEIVED].filter(Boolean).forEach((name) => source.on(name, onAssistant));
        if (events.GENERATION_ENDED) source.on(events.GENERATION_ENDED, () => window.setTimeout(() => ensureSettle(), 250));
        if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, () => {
            autoInitializeAttempts = 0;
            void setPrompt('');
            window.dispatchEvent(new CustomEvent('wsm-state-changed', { detail: { reason: 'chat-changed' } }));
            scheduleAutoInitialize('chat-changed');
        });
        return true;
    }
    function bindSettingsEvents() {
        if (settingsBound) return;
        settingsBound = true;
        window.addEventListener('wsm-settings-changed', () => { void syncRegisteredPrompt(); });
    }
    async function init() {
        autoInitializeAttempts = 0;
        bindSettingsEvents();
        await setPrompt('');
        if (!bindEvents()) {
            let attempts = 0;
            const timer = window.setInterval(() => {
                attempts += 1;
                if (bindEvents() || attempts > 30) window.clearInterval(timer);
            }, 1000);
        }
        scheduleAutoInitialize('startup', 1200);
    }
    WSM.Engine = { init, plan: ensurePlan, autoInitialize, settle: ensureSettle, interceptor, fallbackInjection, _test: { generationBlockReason, plannerAvailable, activeChatAvailable, setPrompt, syncRegisteredPrompt } };
})();
