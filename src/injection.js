(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const text = (value) => String(value ?? '').trim();
    const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
    const join = (value) => list(value).join('、');
    const disclosureLabel = (value) => ({ confidential: '保密', restricted: '受限', public: '公开' }[value] || text(value));
    function activeMemory(values, warmRelevant = () => false) {
        return list(values).filter((item) => {
            const activity = text(item?.activity).toUpperCase();
            if (!activity || activity === 'HOT') return true;
            if (activity === 'COLD') return false;
            return activity === 'WARM' && warmRelevant(item);
        });
    }
    function pacingBlock(settings = WSM.Settings?.get?.() || {}) {
        const pacing = settings.storyPacing || {};
        const mode = text(pacing.mode) || 'off';
        if (mode === 'off') return '';
        const modeRules = {
            verySlow: '推进速度：极慢。只处理当前动作、对白、感官结果与直接人物反馈；通常不引入新节点，不主动结束或跳离当前场景。',
            slow: '推进速度：慢速。每轮最多推进一个很小的变化点，以人物回应、信息澄清和当前场景深化为主。',
            medium: '推进速度：中速。每轮可以自然推进一个完整节点，必要时触发已经成立的事件或推进既有线程。',
            fast: '推进速度：快速。可以跳过低价值重复过程，让既有任务、事件或线程进入下一阶段，但仍需写出必要因果与过渡。',
        };
        const sceneRule = pacing.allowSceneTransition === true
            ? '场景切换：允许，但只能在当前场景已自然结束且不需要用户选择时发生。'
            : '场景切换：禁止自动切换；除非用户明确发起，否则停留在当前场景。';
        const timeRule = pacing.allowTimeSkip === true
            ? '时间跳跃：允许，但只能跳过没有决策价值的空白过程，并明确交代经过时间。'
            : '时间跳跃：禁止自动跳时；不得擅自使用“几小时后、第二天、回到家后”等跨时段推进。';
        return [
            modeRules[mode] || modeRules.slow,
            '速度只控制推进幅度，不控制事件强度；快速不等于制造大事，极慢不等于人物停止行动。',
            '任何速度都不得越过用户决策点。遇到是否跟随、签署、承诺、告白、离开、接受方案或改变立场等选择时，必须停下并等待用户决定。',
            '本模块不是剧情规划器：不得新增无依据节点，不得把后台可能性当成已发生事实，也不得在正文模型原有推进之外额外推进第二次。',
            sceneRule,
            timeRule,
        ].join('\n');
    }
    function replaceIdentityTokens(value, state) {
        let output = text(value);
        const userName = text(state?.identities?.user);
        const charName = text(state?.identities?.char);
        if (userName) output = output.replace(/<user>|\buser\b/gi, userName);
        if (charName) output = output.replace(/<char>|\bchar\b/gi, charName);
        return output;
    }
    function entityName(state, id, fallback = '') {
        const key = text(id).toLowerCase();
        if (['user','<user>'].includes(key)) return text(state?.identities?.user) || fallback || text(id);
        if (['char','character','<char>'].includes(key)) return text(state?.identities?.char) || fallback || text(id);
        return fallback || text(id);
    }

    function fallbackBlocks(state, plan = {}) {
        const world = state.world || {};
        const map = state.map || {};
        const mapLocations = new Map(list(map.locations).map((item) => [item.id, item]));
        const currentMapLocation = mapLocations.get(map.currentLocationId);
        const relevantRoutes = list(map.routes).filter((route) => route.from === map.currentLocationId || route.to === map.currentLocationId);
        const relevantNpcIds = new Set([
            ...list(state.characters).filter((item) => item.present || item.location === world.location?.current).map((item) => item.id),
            ...list(state.causalEffects).filter((item) => item.status === 'active').flatMap((item) => list(item.affectedIds)),
        ]);
        const touchesRelevant = (ids) => list(ids).some((id) => relevantNpcIds.has(id));
        const recentNpcActivities = Object.values(activeMemory(state.npcActivities, (item) => relevantNpcIds.has(item.characterId)).filter((item) => relevantNpcIds.has(item.characterId)).reduce((groups, item) => {
            if (!item?.characterId || !item?.action) return groups;
            (groups[item.characterId] ||= []).push(item);
            groups[item.characterId] = groups[item.characterId].slice(-3);
            return groups;
        }, {})).flat();
        const snapshotFacts = [world.time?.display, world.season, world.location?.current, world.location?.environment, world.location?.weather, ...list(world.currentConditions)].map(canonicalLine).filter(Boolean);
        const uniqueEventContent = (item) => [item.summary, item.outcome].filter(Boolean).filter((value) => {
            const canonical = canonicalLine(value);
            return canonical && !snapshotFacts.some((fact) => fact === canonical || (canonical.length >= 12 && (fact.includes(canonical) || canonical.includes(fact))));
        });
        return {
            world: [
                world.time?.display ? `时间：${world.time.display}` : '',
                world.season ? `季节：${world.season}` : '',
                world.location?.current ? `地点：${world.location.current}` : '',
                world.location?.environment ? `环境：${world.location.environment}` : '',
                world.location?.weather ? `天气：${world.location.weather}` : '',
                ...list(world.currentConditions).map((value) => `当前客观状态：${value}`),
            ].filter(Boolean).join('\n'),
            factAnchors: activeMemory(state.factAnchors).map((item) => `事实锚点：${item.fact}${item.scope ? `｜范围：${item.scope}` : ''}`).join('\n'),
            resourceConstraints: activeMemory(state.resourceConstraints, (item) => item.status === 'active').filter((item) => !['expired','satisfied'].includes(item.status)).map((item) => [
                item.subjectId ? `${entityName(state, item.subjectId, item.subjectId)}：` : '',
                item.condition,
                item.amount ? `数量/额度：${item.amount}` : '',
                item.scope ? `范围：${item.scope}` : '',
                item.consequence ? `不满足时：${item.consequence}` : '',
            ].filter(Boolean).join('｜')).join('\n'),
            ambient: list(plan.ambientResponses).map((item) => {
                if (typeof item === 'string') return `环境反馈：${item}`;
                const actor = text(item?.actor) || '环境中的人';
                const response = text(item?.response);
                return response ? `${actor}：${response}` : '';
            }).filter(Boolean).join('\n'),
            map: [
                currentMapLocation ? `当前位置：${currentMapLocation.name}${currentMapLocation.area ? `（${currentMapLocation.area}）` : ''}` : '',
                ...relevantRoutes.map((route) => {
                    const from = mapLocations.get(route.from)?.name || route.from;
                    const to = mapLocations.get(route.to)?.name || route.to;
                    const status = route.status === 'blocked' ? '受阻' : route.status === 'unknown' ? '状况未知' : '可通行';
                    return `${from} → ${to}：${status}${route.description ? `；${route.description}` : ''}`;
                }),
            ].filter(Boolean).join('\n'),
            characters: activeMemory(state.characters, (item) => item.present || relevantNpcIds.has(item.id)).map((item) => [
                `${entityName(state, item.id, item.name)}｜${item.maintenanceLevel === 'active' ? '活跃NPC' : '核心人物'}`,
                item.identity ? `身份：${item.identity}` : '',
                item.present ? `位置：${item.location || world.location?.current || '当前场景'}（在场）` : `位置：${item.location || '未知地点'}`,
                item.situation ? `重要处境：${item.situation}` : '',
                join(list(item.persistentConditions).map((condition) => typeof condition === 'string' ? condition : [condition.name, condition.effect, condition.recovery].filter(Boolean).join('｜'))) ? `持续状态：${join(list(item.persistentConditions).map((condition) => typeof condition === 'string' ? condition : [condition.name, condition.effect, condition.recovery].filter(Boolean).join('｜')))}` : '',
                join(list(item.importantItems).map((owned) => typeof owned === 'string' ? owned : [owned.name, owned.status, owned.significance].filter(Boolean).join('｜'))) ? `重要物品：${join(list(item.importantItems).map((owned) => typeof owned === 'string' ? owned : [owned.name, owned.status, owned.significance].filter(Boolean).join('｜')))}` : '',
            ].filter(Boolean).join('；')).join('\n'),
            npcActivities: recentNpcActivities.map((item) => `${entityName(state, item.characterId)}：${item.movement ? `${item.movement}｜` : ''}${item.location ? `${item.location}｜` : ''}${item.action}${item.currentRole ? `｜当前作用：${item.currentRole}` : ''}`).join('\n'),
            relationships: activeMemory(state.relationships, (item) => relevantNpcIds.has(item.from) || relevantNpcIds.has(item.to)).map((item) => `${entityName(state, item.from) || '?'}→${entityName(state, item.to) || '?'}：${item.status || item.type || '未描述'}`).join('\n'),
            knowledge: activeMemory(state.knowledge, (item) => item.priority === 'L3' && touchesRelevant([...list(item.knownBy), ...list(item.believedBy), ...list(item.suspectedBy), ...list(item.misunderstoodBy), ...list(item.relatedRefs)])).map((item) => [
                replaceIdentityTokens(item.information, state),
                item.priority ? `重要性：${item.priority}` : '',
                item.disclosure ? `公开状态：${disclosureLabel(item.disclosure)}` : '',
                item.certainty ? `性质：${item.certainty}` : '',
                join(list(item.knownBy).map((id) => entityName(state, id))) ? `确认：${join(list(item.knownBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.believedBy).map((id) => entityName(state, id))) ? `相信：${join(list(item.believedBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.suspectedBy).map((id) => entityName(state, id))) ? `怀疑：${join(list(item.suspectedBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.misunderstoodBy).map((id) => entityName(state, id))) ? `误解：${join(list(item.misunderstoodBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.unknownTo).map((id) => entityName(state, id))) ? `未知：${join(list(item.unknownTo).map((id) => entityName(state, id)))}` : '',
            ].filter(Boolean).join('｜')).join('\n'),
            tasks: activeMemory(state.tasks, (item) => item.status === 'active' && item.userVisible !== false).filter((item) => !['done','failed'].includes(item.status)).map((item) => `${item.title}：${item.progress || item.status || '待处理'}${item.deadline ? `；截止${item.deadline}` : ''}`).join('\n'),
            events: activeMemory(state.events, (item) => item.status === 'ongoing' && (!item.location || item.location === world.location?.current)).filter((item) => uniqueEventContent(item).length).map((item) => `${item.title}｜${item.status === 'occurred' ? '已发生' : '正在发生'}：${join(uniqueEventContent(item))}`).join('\n'),
            triggers: activeMemory(state.triggers, (item) => item.status === 'eligible').filter((item) => !['triggered','expired'].includes(item.status)).map((item) => `${item.title}：条件${join(item.conditions) || '未设定'}；当前${item.status || 'armed'}`).join('\n'),
            threads: activeMemory(state.threads, (item) => item.priority === 'L3' && touchesRelevant(item.participantIds)).filter((item) => item.status !== 'resolved').map((item) => `${item.title}：${item.nextNaturalStep || item.status || '延续中'}`).join('\n'),
            progression: state.progression?.activity !== 'COLD' ? [
                state.progression?.direction ? `当前方向：${state.progression.direction}` : '',
                state.progression?.currentMovement ? `当前变化：${state.progression.currentMovement}` : '',
                join(state.progression?.nextRequiredChanges) ? `下一阶段仍需：${join(state.progression.nextRequiredChanges)}` : '',
                state.progression?.blockedByDecision ? `必须停在用户决策点：${state.progression.blockedByDecision}` : '',
            ].filter(Boolean).join('\n') : '',
            processes: activeMemory(state.processes, (item) => item.priority === 'L3').filter((item) => item.status !== 'resolved').map((item) => `${item.title}：${item.currentDirection || item.status || '自然延续'}${Number(item.progress?.max) > 0 ? `；进度${Number(item.progress?.current || 0)}/${Number(item.progress.max)}` : ''}`).join('\n'),
            causalEffects: activeMemory(state.causalEffects, (item) => item.status === 'active' && touchesRelevant(item.affectedIds)).filter((item) => item.status === 'active').map((item) => [item.cause || item.causeRef, ...list(item.steps), item.result].filter(Boolean).join(' → ')).join('\n'),
            pacing: pacingBlock(),
            planner: [
                plan.advanceDecision?.direction ? `本轮方向：${plan.advanceDecision.direction}` : '',
                plan.advanceDecision?.mode ? `推进方式：${plan.advanceDecision.mode}；强度：${plan.advanceDecision.intensity || 'none'}` : '',
                ...list(plan.eligibleDevelopments).map((value) => `可以：${value}`),
                ...list(plan.forbiddenDevelopments).map((value) => `不要：${value}`),
                ...list(plan.noChangeReasons).map((value) => `可无变化：${value}`),
                plan.notes ? `备注：${plan.notes}` : '',
            ].filter(Boolean).join('\n'),
        };
    }

    function normalizePlannerBlocks(value, state) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return Object.fromEntries(Object.entries(value).map(([key, content]) => [key, replaceIdentityTokens(content, state)]));
    }

    function canonicalLine(value) {
        return text(value).replace(/^[-*•\d.、\s]+/, '').replace(/^(时间|季节|地点|环境|天气|状态|当前客观状态|事实锚点|最新进展)[：:]\s*/, '').replace(/[\s，。；：:、]/g, '').toLowerCase();
    }

    function dedupeContent(content, seen) {
        return text(content).split(/\n+/).map((line) => line.trim()).filter(Boolean).filter((line) => {
            const canonical = canonicalLine(line);
            if (!canonical) return false;
            const duplicate = seen.some((previous) => previous === canonical || (canonical.length >= 12 && previous.length >= 12 && (previous.includes(canonical) || canonical.includes(previous))));
            if (duplicate) return false;
            seen.push(canonical);
            return true;
        }).join('\n');
    }

    function removeRatingNumbers(value) {
        return text(value)
            .replace(/(?:亲密|亲近|信任|紧张|好感|关系)(?:度|值|评分)?\s*[：:=]?\s*-?\d+(?:\.\d+)?%?/gi, '')
            .replace(/\b(?:closeness|trust|tension)\s*[：:=]\s*-?\d+(?:\.\d+)?%?/gi, '')
            .split(/\n+/).map((line) => line.trim()).filter(Boolean).join('\n');
    }
    function finalOverride(state) {
        return text(state?.runtime?.finalInjectionOverride);
    }
    function normalizeFinalOverride(value) {
        return text(value).slice(0, 24000);
    }

    function shorten(value, limit) {
        const input = text(value);
        if (input.length <= limit) return input;
        const marker = '…（本模块已按预算压缩）';
        if (limit <= marker.length) return marker.slice(0, Math.max(0, limit));
        return `${input.slice(0, limit - marker.length).trimEnd()}${marker}`;
    }

    function composeWithinBudget(diceBlock, candidates, configuredMax) {
        const entries = candidates.map((item) => ({
            header: `[${item.label}]\n`,
            payload: `${item.content}${item.instruction ? `\n使用规则：${item.instruction}` : ''}`,
        }));
        const sectionCount = entries.length + (diceBlock ? 1 : 0);
        const separatorChars = Math.max(0, sectionCount - 1) * 2;
        const headerChars = entries.reduce((sum, item) => sum + item.header.length, 0);
        const minimumPayloads = entries.map((item) => Math.min(item.payload.length, 24));
        const minimumRequired = (diceBlock ? diceBlock.length : 0)
            + separatorChars
            + headerChars
            + minimumPayloads.reduce((sum, length) => sum + length, 0);
        // A configured budget smaller than the structural minimum cannot both be
        // a hard cap and preserve every checked module. Preserve the modules and
        // exceed that pathological cap only by the minimum amount required.
        const maxChars = Math.max(500, Number(configuredMax || 3500), minimumRequired);
        const fullSections = [diceBlock, ...entries.map((item) => item.header + item.payload)].filter(Boolean);
        const fullBody = fullSections.join('\n\n');
        if (fullBody.length <= maxChars) return fullBody;

        const allocations = minimumPayloads.slice();
        let remaining = maxChars
            - (diceBlock ? diceBlock.length : 0)
            - separatorChars
            - headerChars
            - allocations.reduce((sum, length) => sum + length, 0);
        let pending = entries.map((item, index) => ({ index, need: item.payload.length - allocations[index] })).filter((item) => item.need > 0);
        while (remaining > 0 && pending.length) {
            const share = Math.max(1, Math.floor(remaining / pending.length));
            pending.forEach((item) => {
                if (remaining <= 0) return;
                const addition = Math.min(item.need, share, remaining);
                allocations[item.index] += addition;
                item.need -= addition;
                remaining -= addition;
            });
            pending = pending.filter((item) => item.need > 0);
        }
        return [
            diceBlock,
            ...entries.map((item, index) => item.header + shorten(item.payload, allocations[index])),
        ].filter(Boolean).join('\n\n');
    }

    function compose(state, plan = {}, plannerBlocks = {}) {
        const override = finalOverride(state);
        if (override) return override;
        const settings = WSM.Settings.get();
        const modules = settings.injectionModules || WSM.Defaults.INJECTION_MODULES;
        const generated = fallbackBlocks(state, plan);
        const supplied = normalizePlannerBlocks(plannerBlocks, state);
        const diceBlock = settings.diceEnabled ? WSM.Dice?.injectionBlock?.(plan.diceRound) : '';
        const authorityBlock = '[外置状态权威]\n本 WORLD_STATE 标签是本轮唯一状态来源。只输出叙事正文及用户明确要求的附加格式；不得另行输出 <INDRS>、<abstract>、<note> 或 GM_STATE，不得在正文后自行提交第二套状态。';
        const fixedBlock = [diceBlock, authorityBlock].filter(Boolean).join('\n\n');
        const candidates = [];
        const seenFacts = [];
        Object.entries(WSM.Defaults.INJECTION_MODULES).forEach(([id, defaultModule]) => {
            if (id === 'map') return; // Spatial index is sent only through an explicit player interaction.
            const config = Object.assign({}, defaultModule, modules[id] || {});
            if (config.enabled === false) return;
            const source = ['ambient','planner'].includes(id) ? (supplied[id] || generated[id]) : generated[id];
            const content = dedupeContent(removeRatingNumbers(replaceIdentityTokens(source, state)), seenFacts);
            if (!content) return;
            const fixedInstruction = text(config.instruction);
            const editablePrompt = text(settings.modulePrompts?.[id]);
            const instruction = [fixedInstruction, editablePrompt && editablePrompt !== fixedInstruction ? `模块提示词：${editablePrompt}` : ''].filter(Boolean).join('\n');
            candidates.push({ label: config.label, content, instruction });
        });
        // Allocate the budget across every enabled non-empty module. This keeps
        // later modules from disappearing merely because they are ordered last.
        // The dice contract is indivisible and is reserved before fair sharing.
        const body = composeWithinBudget(fixedBlock, candidates, settings.injectionMaxChars);
        return `<WORLD_STATE>\n${body || '本轮没有需要额外注入的世界状态。'}\n</WORLD_STATE>`;
    }

    function composeByDepth(state, plan = {}, plannerBlocks = {}) {
        const override = finalOverride(state);
        if (override) return { 0: override };
        const settings = WSM.Settings.get();
        const modules = settings.injectionModules || WSM.Defaults.INJECTION_MODULES;
        const generated = fallbackBlocks(state, plan);
        const supplied = normalizePlannerBlocks(plannerBlocks, state);
        const groups = new Map();
        const seenFacts = [];
        Object.entries(WSM.Defaults.INJECTION_MODULES).forEach(([id, defaultModule]) => {
            if (id === 'map') return; // Never leak the background map into ordinary narration.
            const config = Object.assign({}, defaultModule, modules[id] || {});
            if (config.enabled === false) return;
            const source = ['ambient','planner'].includes(id) ? (supplied[id] || generated[id]) : generated[id];
            const content = dedupeContent(removeRatingNumbers(replaceIdentityTokens(source, state)), seenFacts);
            if (!content) return;
            const fixedInstruction = text(config.instruction);
            const editablePrompt = text(settings.modulePrompts?.[id]);
            const instruction = [fixedInstruction, editablePrompt && editablePrompt !== fixedInstruction ? `模块提示词：${editablePrompt}` : ''].filter(Boolean).join('\n');
            const depth = Math.max(0, Math.min(4, Math.round(Number(config.depth ?? defaultModule.depth ?? 2))));
            if (!groups.has(depth)) groups.set(depth, []);
            groups.get(depth).push({ id, label: config.label, content, instruction });
        });
        const diceBlock = settings.diceEnabled ? WSM.Dice?.injectionBlock?.(plan.diceRound) : '';
        const authorityBlock = '[外置状态权威]\n以下按重要性分层注入的 WORLD_STATE 共同构成本轮唯一状态来源。只输出叙事正文及用户明确要求的附加格式；不得另行输出 <INDRS>、<abstract>、<note> 或 GM_STATE。';
        const configuredMax = Math.max(500, Number(settings.injectionMaxChars || 3500));
        const totalWeight = [...groups.values()].reduce((sum, items) => sum + items.reduce((size, item) => size + item.content.length + item.instruction.length, 0), 0) || 1;
        const prompts = {};
        [...groups.entries()].sort((a, b) => a[0] - b[0]).forEach(([depth, candidates]) => {
            const weight = candidates.reduce((size, item) => size + item.content.length + item.instruction.length, 0);
            const budget = Math.max(500, Math.round(configuredMax * weight / totalWeight));
            const fixed = depth === 0 ? [diceBlock, authorityBlock].filter(Boolean).join('\n\n') : '';
            const body = composeWithinBudget(fixed, candidates, budget);
            prompts[depth] = `<WORLD_STATE depth="${depth}">\n${body}\n</WORLD_STATE>`;
        });
        if (!prompts[0]) prompts[0] = `<WORLD_STATE depth="0">\n${[diceBlock, authorityBlock].filter(Boolean).join('\n\n')}\n</WORLD_STATE>`;
        return prompts;
    }

    function preview(state, plan = {}, plannerBlocks = {}, worldbookByDepth = {}) {
        const override = finalOverride(state);
        if (override) return override;
        const statePrompts = composeByDepth(state, plan, plannerBlocks);
        const depths = [...new Set([...Object.keys(statePrompts), ...Object.keys(worldbookByDepth || {})].map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
        return depths.flatMap((depth) => {
            const values = [];
            if (text(statePrompts[depth])) values.push(text(statePrompts[depth]));
            const worldbook = text(worldbookByDepth?.[depth]);
            if (worldbook) values.push(`<WORLDBOOK_RULES depth="${depth}">\n${worldbook}\n</WORLDBOOK_RULES>`);
            return values;
        }).join('\n\n');
    }

    WSM.Injection = { compose, composeByDepth, preview, normalizeFinalOverride, fallbackBlocks, pacingBlock };
})();
