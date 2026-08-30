(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const PROMPT_ID = 'WORLD_STATE_MACHINE_CONTEXT';
    const DEPTH_PROMPT_IDS = Array.from({ length: 5 }, (_, depth) => `${PROMPT_ID}_DEPTH_${depth}`);
    let planningPromise = null;
    let settlingPromise = null;
    let bound = false;
    let settingsBound = false;
    let operationProgress = { state: 'idle', message: '', details: '', at: 0, steps: [] };

    const safeText = (value) => String(value ?? '').trim();
    function reportProgress(message, state = 'running', details = '') {
        const nextMessage = safeText(message);
        const nextDetails = safeText(details);
        // A new initialization begins a fresh, visible progress trail. Keep
        // previous stages of the active run so the user can see exactly where
        // source reading reached before it completed or failed.
        const previous = /^第 1\/3 步：/.test(nextMessage) ? [] : (operationProgress.steps || []);
        const last = previous.at(-1);
        const step = { state, message: nextMessage, details: nextDetails, at: Date.now() };
        const steps = last?.message === step.message && last?.details === step.details && last?.state === step.state
            ? [...previous.slice(0, -1), step]
            : [...previous, step].slice(-36);
        operationProgress = { ...step, steps };
        try { window.dispatchEvent(new CustomEvent('wsm-operation-progress', { detail: operationProgress })); }
        catch (_error) { /* Progress reporting must never interrupt planning. */ }
        return operationProgress;
    }
    function getProgress() { return { ...operationProgress, steps: (operationProgress.steps || []).map((step) => ({ ...step })) }; }
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
    const INITIALIZE_SLICES = [
        { id: 'foundation', label: '世界与地图', keys: ['identities','world','map','timeline'], maxTokens: 4000 },
        { id: 'people', label: '人物与知识', keys: ['characters','npcActivities','relationships','knowledge'], maxTokens: 6500 },
        { id: 'affairs', label: '任务与事件', keys: ['tasks','events','triggers','threads'], maxTokens: 4500 },
        { id: 'dynamics', label: '进程与因果', keys: ['processes','causalEffects'], maxTokens: 4000 },
    ];
    function stateReference(state) {
        return {
            identities: state.identities,
            world: state.world,
            characters: (state.characters || []).map((item) => ({ id: item.id, name: item.name })),
            tasks: (state.tasks || []).map((item) => ({ id: item.id, title: item.title })),
            events: (state.events || []).map((item) => ({ id: item.id, title: item.title })),
        };
    }
    const SLICE_EVIDENCE_FIELDS = {
        foundation: ['sourceRefs','canon','chronology','locations','currentScene','uncertainties'],
        people: ['sourceRefs','characters','relationships','knowledge','currentScene','uncertainties'],
        affairs: ['sourceRefs','chronology','tasks','currentScene'],
        dynamics: ['sourceRefs','chronology','tasks','uncertainties'],
    };
    function sourceForInitializeSlice(source, sliceId) {
        const fields = new Set(SLICE_EVIDENCE_FIELDS[sliceId] || []);
        const digestBatch = Array.isArray(source?.sourceDigest) ? source.sourceDigest : [];
        const sourceDigest = digestBatch.map((digest) => Object.fromEntries(
            Object.entries(digest || {}).filter(([key, value]) => fields.has(key) && (!Array.isArray(value) || value.length)),
        )).filter((digest) => Object.keys(digest).length);
        return {
            identities: source?.identities,
            character: source?.character,
            persona: source?.persona,
            sourceDigest,
            compiledWorldbookRules: source?.compiledWorldbookRules,
            tavernTextContext: source?.tavernTextContext,
            sourceRead: source?.sourceRead,
        };
    }
    async function initializeInSlices(source, payload, settings) {
        const state = WSM.Defaults.createState();
        const queue = INITIALIZE_SLICES.map((slice) => ({ ...slice }));
        for (let index = 0; index < queue.length;) {
            const slice = queue[index];
            reportProgress(`正在分批建立初始状态：${slice.label}`, 'running', `${index + 1}/${queue.length} · 避免单个超大 INITIALIZE_WORLD 请求`);
            const schema = Object.fromEntries(slice.keys.map((key) => [key, WSM.Defaults.STATE_SCHEMA[key]]));
            const ownership = Object.fromEntries(slice.keys.map((key) => [key, WSM.Defaults.MODULE_OWNERSHIP[key]]).filter(([, value]) => value));
            const prompts = Object.fromEntries(slice.keys.map((key) => [key, settings.modulePrompts?.[key] || WSM.Defaults.MODULE_PROMPTS[key]]).filter(([, value]) => value));
            try {
                const result = await WSM.Api.complete(
                    `你是世界状态初始化器，本次只建立“${slice.label}”切片。source 已由前序分片模型完整读取，sourceDigest 中每一项都必须综合使用。只能记录来源中已经存在或正文已经发生的事实，不得续写、推测成真或创造设定。严格遵守 ownership，只返回 JSON：{"state":{本切片字段}}；不得返回其他状态字段、plan、Markdown 或解释。`,
                    {
                        task: 'INITIALIZE_WORLD_SLICE', slice: slice.id, sliceIndex: index + 1, sliceCount: queue.length,
                        source: sourceForInitializeSlice(source, slice.id.split(':')[0]), stateReference: stateReference(state), stateSchema: schema, moduleOwnership: ownership, modulePrompts: prompts,
                    },
                    { maxTokens: Math.max(1800, Math.min(slice.maxTokens, 1800 + slice.keys.length * 1100)) },
                );
                const partial = result?.state ?? result;
                if (!partial || typeof partial !== 'object') throw new Error(`初始化切片 ${slice.label} 响应缺少 state`);
                slice.keys.forEach((key) => { if (Object.prototype.hasOwnProperty.call(partial, key)) state[key] = partial[key]; });
                index += 1;
            } catch (error) {
                if (slice.keys.length <= 1) throw error;
                const middle = Math.ceil(slice.keys.length / 2);
                const children = [slice.keys.slice(0, middle), slice.keys.slice(middle)].map((keys, childIndex) => ({
                    ...slice, id: `${slice.id}:${childIndex + 1}`, label: `${slice.label}（${keys.join('、')}）`, keys,
                }));
                queue.splice(index, 1, ...children);
                reportProgress('状态切片请求失败，正在继续细分', 'running', `${slice.label} → ${children.map((child) => child.keys.join('、')).join(' / ')}`);
            }
        }
        state.initialized = true;
        return {
            state,
            plan: { notes: ['初始状态已按世界、人物、事务与因果切片建立；本轮只建立事实，不预演新剧情。'] },
            moduleInjections: {},
        };
    }
    async function setPrompt(content) {
        const ctx = WSM.Context.context();
        const setter = typeof ctx?.setExtensionPrompt === 'function' ? ctx.setExtensionPrompt.bind(ctx) : (typeof window.setExtensionPrompt === 'function' ? window.setExtensionPrompt.bind(window) : null);
        if (!setter) return;
        await setter(PROMPT_ID, '', 1, 0, false, 0);
        for (let depth = 0; depth <= 4; depth += 1) await setter(DEPTH_PROMPT_IDS[depth], typeof content === 'object' ? (content[depth] || '') : '', 1, depth, false, 0);
    }
    async function setStatePrompts(state, plan = {}, moduleInjections = {}) {
        return setPrompt(WSM.Injection.composeByDepth(state, plan, moduleInjections));
    }
    async function syncRegisteredPrompt() {
        const settings = WSM.Settings.get();
        if (!settings.enabled) return setPrompt('');
        const state = WSM.Storage.load();
        const hasUsableState = state.initialized || !!safeText(state.planner?.injection);
        if (!hasUsableState) return setPrompt('');
        state.planner.injection = WSM.Injection.compose(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
        return setStatePrompts(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
    }
    async function plan(options = {}) {
        const settings = WSM.Settings.get();
        if (!settings.enabled) {
            await setPrompt('');
            if (options.initialize === true || options.readFullChat === true) {
                reportProgress('读取当前聊天失败', 'error', '已在设置中关闭“启用自动状态机”');
            }
            return null;
        }
        const key = turnKey();
        let current = syncIdentities(WSM.Storage.load());
        // Initialization is a user-triggered operation. Generation hooks may
        // update an existing state, but must never read and initialize a new
        // chat implicitly.
        if (!current.initialized && options.initialize !== true) {
            await setPrompt('');
            return null;
        }
        if (!current.runtime?.needsWorldRefresh && !options.force && key && current.planner?.turnKey === key && current.planner?.injection && !current.planner?.error) {
            current.planner.injection = WSM.Injection.compose(current, current.planner.plan || {}, current.planner.moduleInjections || {});
            await setStatePrompts(current, current.planner.plan || {}, current.planner.moduleInjections || {});
            return current.planner;
        }
        if (!plannerAvailable(settings)) {
            const diceRound = settings.diceEnabled ? WSM.Dice?.createRound?.(key) : null;
            const localPlan = diceRound ? { diceRound } : {};
            const injection = WSM.Injection.compose(current, localPlan, {});
            const error = settings.useTavernApi !== false ? '酒馆默认 API 当前不可用' : '尚未配置 Planner API';
            current.planner = { lastRunAt: Date.now(), turnKey: key, plan: localPlan, moduleInjections: {}, injection, error };
            if (diceRound) current = await WSM.Storage.save(current, 'local-dice', { snapshot: false });
            await setStatePrompts(current, localPlan, {});
            return current.planner;
        }

        const rebuilding = options.initialize === true;
        // “读取当前聊天” is an explicit user request to re-read the chat, not
        // the lightweight per-turn planner refresh.  The latter intentionally
        // reads only recentMessages, which made a long existing chat appear to
        // be analysed while most of its history never reached SourceReader.
        const fullChatRefresh = options.readFullChat === true && current.initialized;
        const refreshWorld = !rebuilding && current.initialized && (current.runtime?.needsWorldRefresh === true || fullChatRefresh);
        const initializing = !current.initialized || rebuilding;
        if (initializing || refreshWorld) reportProgress('第 1/3 步：正在读取酒馆资料', 'running', '角色卡、Persona、已启用世界书和聊天正文');
        const source = await WSM.Context.buildSource({
            fullChat: initializing || refreshWorld || options.initialize,
            preserveFull: initializing || refreshWorld,
        });
        if (initializing || refreshWorld) {
            const preview = summarizeSource(source);
            reportProgress('第 2/3 步：资料读取完成，正在处理世界书', 'running', `正文 ${preview.chatMessages}/${preview.chatTotalMessages} 条 · 世界书 ${preview.loadedWorldbooks.length} 本 · 读取失败 ${preview.failedWorldbooks.length} 本`);
        }
        const fingerprint = WSM.Context.sourceFingerprint(source);
        const compilerResult = await WSM.WorldbookCompiler?.processSource?.(source);
        const sourceSummary = Object.assign(summarizeSource(source), {
            worldbookCompiler: compilerResult?.enabled ? {
                selectedEntries: Number(compilerResult.selected || 0),
                routedChars: String(compilerResult.routed || '').length,
            } : null,
        });
        const phase = initializing ? 'INITIALIZE_WORLD' : (fullChatRefresh ? 'REFRESH_FULL_CHAT' : (refreshWorld ? 'REFRESH_WORLD' : 'PRE_GENERATION_PLAN'));
        const diceRound = settings.diceEnabled ? WSM.Dice?.createRound?.(key) : null;
        const payload = {
            phase,
            instructions: initializing
                ? '完整理解角色卡、Persona、聊天与已启用世界书，建立初始持久世界状态；除user和char外，提取3至12名最相关的既存NPC。'
                : fullChatRefresh
                    ? '这是用户主动执行的完整聊天刷新。必须综合 sourceDigest 的全部分片证据、角色卡、Persona、世界书和当前已结算状态，更新所有受聊天事实影响的状态字段；不得只看末尾正文，也不得只补 NPC。保留仍成立的既有事实，冲突或不确定信息必须标明来源和不确定性，禁止续写。'
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
            if (initializing || refreshWorld) {
                const prepared = await WSM.SourceReader.prepare(source, {
                    forceDigest: true,
                    // Keep the final digest bounded for the state model.  Raw
                    // source has no total-length cap: it is read in bounded
                    // chunks and recursively merged before reaching here.
                    reduceTargetChars: 16000,
                    onProgress(progress) {
                          if (progress.stage === 'read') {
                              reportProgress('正在分批读取全部资料', 'running', `资料分片 ${progress.current}/${progress.total} · 每片独立请求，不丢弃旧正文`);
                          } else if (progress.stage === 'split') {
                              reportProgress('分片请求失败，正在自动细分后继续', 'running', `已细分 ${progress.splits} 次 · 当前共 ${progress.total} 片 · ${progress.reason}`);
                          } else {
                              reportProgress('正在合并分片证据', 'running', `第 ${progress.pass} 轮 · ${progress.current}/${progress.total}`);
                          }
                    },
                });
                payload.source = prepared.source;
                sourceSummary.sourceRead = prepared.stats;
            }
            const plannerPrompt = `${settings.plannerPrompt}${diceRound ? WSM.Dice.plannerInstructions(diceRound) : ''}`;
            if (initializing || refreshWorld) reportProgress('全部资料读取完成，正在建立状态', 'running', `正文 ${sourceSummary.chatMessages}/${sourceSummary.chatTotalMessages} 条 · 分片 ${sourceSummary.sourceRead?.chunks || 1} 个 · 世界书 ${sourceSummary.loadedWorldbooks.length} 本`);
            const result = initializing
                ? await initializeInSlices(payload.source, payload, settings)
                : await WSM.Api.complete(plannerPrompt, payload, { maxTokens: 12000 });
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
            await setStatePrompts(next, next.planner.plan || {}, next.planner.moduleInjections || {});
            if (initializing || refreshWorld) reportProgress('读取并初始化完成', 'success', `已建立 REV ${next.revision} · 世界书 ${sourceSummary.loadedWorldbooks.length} 本 · 正文 ${sourceSummary.chatMessages} 条`);
            return next.planner;
        } catch (error) {
            current.runtime = Object.assign({}, current.runtime, { sourceSummary, worldbookInjection: compilerResult?.report || current.runtime?.worldbookInjection || null });
            current.planner = Object.assign({}, current.planner, {
                lastRunAt: Date.now(), turnKey: key, error: safeText(error?.message || error), moduleInjections: current.planner?.moduleInjections || {}, injection: WSM.Injection.compose(current, current.planner?.plan || {}, current.planner?.moduleInjections || {}),
            });
            await WSM.Storage.save(current, 'planner-error', { snapshot: false });
            await setStatePrompts(current, current.planner?.plan || {}, current.planner?.moduleInjections || {});
            if (initializing || refreshWorld) reportProgress('读取或初始化失败', 'error', safeText(error?.message || error));
            console.error('[WorldStateMachine] Planner 失败，使用当前状态降级', error);
            return current.planner;
        }
    }
    async function ensurePlan(options = {}) {
        if (planningPromise) return planningPromise;
        planningPromise = plan(options).finally(() => { planningPromise = null; });
        return planningPromise;
    }
    async function interceptor(chat, _contextSize, abort, type) {
        const settings = WSM.Settings.get();
        if (!isForeground(type)) return;
        if (!settings.enabled) {
            await setPrompt('');
            return;
        }
        if (!WSM.Storage.load().initialized) {
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
            // WORLD_STATE modules are delivered through separate depth prompts.
            // The interceptor does not mutate chat, avoiding duplicate injection.
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
            if (isForeground(type) && WSM.Storage.load().initialized) await ensurePlan();
        });
        const onAssistant = () => window.setTimeout(() => ensureSettle(), 500);
        [events.CHARACTER_MESSAGE_RENDERED, events.MESSAGE_RECEIVED].filter(Boolean).forEach((name) => source.on(name, onAssistant));
        if (events.GENERATION_ENDED) source.on(events.GENERATION_ENDED, () => window.setTimeout(() => ensureSettle(), 250));
        if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, () => {
            void setPrompt('');
            void WSM.WorldbookCompiler?.setWorldbookPrompts?.({});
            window.dispatchEvent(new CustomEvent('wsm-state-changed', { detail: { reason: 'chat-changed' } }));
        });
        return true;
    }
    function bindSettingsEvents() {
        if (settingsBound) return;
        settingsBound = true;
        window.addEventListener('wsm-settings-changed', () => { void syncRegisteredPrompt(); });
    }
    async function init() {
        bindSettingsEvents();
        await setPrompt('');
        await WSM.WorldbookCompiler?.setWorldbookPrompts?.({});
        if (!bindEvents()) {
            let attempts = 0;
            const timer = window.setInterval(() => {
                attempts += 1;
                if (bindEvents() || attempts > 30) window.clearInterval(timer);
            }, 1000);
        }
    }
    WSM.Engine = { init, plan: ensurePlan, settle: ensureSettle, interceptor, fallbackInjection, reportProgress, getProgress, _test: { generationBlockReason, plannerAvailable, activeChatAvailable, setPrompt, setStatePrompts, syncRegisteredPrompt, initializeInSlices, sourceForInitializeSlice } };
})();
