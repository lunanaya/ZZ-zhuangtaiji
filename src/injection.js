(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const text = (value) => String(value ?? '').trim();
    const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
    const join = (value) => list(value).join('、');
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
            ...list(state.causalEffects).filter((item) => item.status === 'arrived').flatMap((item) => list(item.affectedIds)),
        ]);
        const recentNpcActivities = Object.values(list(state.npcActivities).filter((item) => relevantNpcIds.has(item.characterId)).reduce((groups, item) => {
            if (!item?.characterId || !item?.action) return groups;
            (groups[item.characterId] ||= []).push(item);
            groups[item.characterId] = groups[item.characterId].slice(-3);
            return groups;
        }, {})).flat();
        const snapshotFacts = [world.time?.display, world.location?.current, world.location?.environment, world.location?.weather, ...list(world.facts)].map(canonicalLine).filter(Boolean);
        const uniqueEventDevelopments = (item) => list(item.developments).filter((value) => {
            const canonical = canonicalLine(value);
            return canonical && !snapshotFacts.some((fact) => fact === canonical || (canonical.length >= 12 && (fact.includes(canonical) || canonical.includes(fact))));
        });
        return {
            world: [
                world.time?.display ? `时间：${world.time.display}` : '',
                world.location?.current ? `地点：${world.location.current}` : '',
                world.location?.environment ? `环境：${world.location.environment}` : '',
                world.location?.weather ? `天气：${world.location.weather}` : '',
                ...list(world.facts).map((value) => `既定事实：${value}`),
            ].filter(Boolean).join('\n'),
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
            characters: list(state.characters).map((item) => [
                `${entityName(state, item.id, item.name)}：${item.present ? '在场' : `位于${item.location || '未知地点'}`}`,
                item.status ? `状态：${item.status}` : '',
                item.pose ? `姿势：${item.pose}` : '',
                item.clothing ? `衣物：${item.clothing}` : '',
                join(item.heldItems) ? `手持：${join(item.heldItems)}` : '',
                join(item.injuries) ? `伤势：${join(item.injuries)}` : '',
                item.currentAction ? `正在：${item.currentAction}` : '',
                join(item.goals) ? `目标：${join(item.goals)}` : '',
            ].filter(Boolean).join('；')).join('\n'),
            npcActivities: recentNpcActivities.map((item) => `${entityName(state, item.characterId)}：${item.location ? `${item.location}｜` : ''}${item.action}`).join('\n'),
            relationships: list(state.relationships).map((item) => `${entityName(state, item.from) || '?'}→${entityName(state, item.to) || '?'}：${item.status || item.type || '未描述'}`).join('\n'),
            knowledge: list(state.knowledge).map((item) => [
                replaceIdentityTokens(item.information, state),
                item.certainty ? `性质：${item.certainty}` : '',
                join(list(item.knownBy).map((id) => entityName(state, id))) ? `确认：${join(list(item.knownBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.believedBy).map((id) => entityName(state, id))) ? `相信：${join(list(item.believedBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.suspectedBy).map((id) => entityName(state, id))) ? `怀疑：${join(list(item.suspectedBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.misunderstoodBy).map((id) => entityName(state, id))) ? `误解：${join(list(item.misunderstoodBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.concealedBy).map((id) => entityName(state, id))) ? `隐瞒：${join(list(item.concealedBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.unknownTo).map((id) => entityName(state, id))) ? `未知：${join(list(item.unknownTo).map((id) => entityName(state, id)))}` : '',
            ].filter(Boolean).join('｜')).join('\n'),
            tasks: list(state.tasks).filter((item) => !['done','failed'].includes(item.status)).map((item) => `${item.title}：${item.progress || item.status || '待处理'}${item.deadline ? `；截止${item.deadline}` : ''}`).join('\n'),
            events: list(state.events).filter((item) => item.status !== 'resolved' && uniqueEventDevelopments(item).length).map((item) => `${item.title}最新进展：${join(uniqueEventDevelopments(item))}`).join('\n'),
            triggers: list(state.triggers).filter((item) => !['triggered','expired'].includes(item.status)).map((item) => `${item.title}：条件${join(item.conditions) || '未设定'}；当前${item.status || 'armed'}`).join('\n'),
            threads: list(state.threads).filter((item) => item.status !== 'resolved').map((item) => `${item.title}：${item.nextNaturalStep || item.status || '延续中'}`).join('\n'),
            processes: list(state.processes).filter((item) => item.status !== 'resolved').map((item) => `${item.title}：${item.currentDirection || item.status || '自然延续'}${Number(item.progress?.max) > 0 ? `；进度${Number(item.progress?.current || 0)}/${Number(item.progress.max)}` : ''}`).join('\n'),
            causalEffects: list(state.causalEffects).filter((item) => item.status === 'arrived').map((item) => [item.cause || item.causeRef, ...list(item.steps), item.result].filter(Boolean).join(' → ')).join('\n'),
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
        return text(value).replace(/^[-*•\d.、\s]+/, '').replace(/^(时间|地点|环境|天气|状态|既定事实|最新进展)[：:]\s*/, '').replace(/[\s，。；：:、]/g, '').toLowerCase();
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
            const config = Object.assign({}, defaultModule, modules[id] || {});
            if (config.enabled === false) return;
            const content = dedupeContent(removeRatingNumbers(replaceIdentityTokens(supplied[id] || generated[id], state)), seenFacts);
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
            const config = Object.assign({}, defaultModule, modules[id] || {});
            if (config.enabled === false) return;
            const content = dedupeContent(removeRatingNumbers(replaceIdentityTokens(supplied[id] || generated[id], state)), seenFacts);
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

    WSM.Injection = { compose, composeByDepth, preview, normalizeFinalOverride, fallbackBlocks };
})();
