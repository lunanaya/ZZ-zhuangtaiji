(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const text = (value) => String(value ?? '').trim();
    const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
    const join = (value) => list(value).join('、');
    const disclosureLabel = (value) => ({ confidential: '保密', restricted: '受限', public: '公开' }[value] || text(value));
    function truthLine(value, owner = {}) {
        const content = text(value);
        if (!content) return '';
        // Truth metadata is an internal audit mechanism. The prose model must
        // receive only facts that passed that audit, never the audit labels,
        // reasoning notes, or source identifiers themselves.
        const status = text(owner?.truthStatus).toLowerCase();
        if (['suspected','assumed','unknown','not_established','failed'].includes(status)) return '';
        return content;
    }
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
        const userName = text(WSM.Context?.identityNames?.()?.user || state?.identities?.user) || '<USER>';
        if (userName) output = output.replace(/<user>|\buser\b/gi, userName);
        output = output.replace(/<char>|\bchar\b/gi, '相关人物');
        return output;
    }
    function entityName(state, id, fallback = '') {
        const key = text(id).toLowerCase();
        if (['user','<user>'].includes(key)) return text(WSM.Context?.identityNames?.()?.user || state?.identities?.user) || '<USER>';
        if (['char','character','<char>'].includes(key)) return fallback || '相关人物';
        const character = list(state?.characters).find((item) => text(item?.id).toLowerCase() === key);
        if (character?.name) return text(character.name);
        return fallback || text(id);
    }
    function mergedMapState(state) {
        const map = state.map || {};
        const catalog = WSM.WorldbookCompiler?.getStaticCatalog?.() || {};
        const base = [...list(map.baseLocations), ...list(catalog.locations)];
        const dynamic = list(map.locations);
        const byId = new Map();
        const bySemantic = new Map();
        const aliases = new Map();
        const resolveId = (id) => aliases.get(text(id)) || text(id);
        const addLocation = (item, overlay = false) => {
            const itemId = text(item?.id);
            const parentId = resolveId(item?.parentId);
            const semantic = `${parentId}|${text(item?.name).toLocaleLowerCase()}`;
            const matched = (itemId && byId.has(itemId) ? itemId : '') || bySemantic.get(semantic);
            const key = matched || itemId || semantic;
            if (!key || key === '|') return;
            const previous = byId.get(key) || {};
            const canonicalId = text(previous.id) || itemId || key;
            const merged = { ...previous, ...item, id: canonicalId, parentId, aliases: [...new Set([...list(previous.aliases), ...list(item?.aliases), ...(itemId && itemId !== canonicalId ? [itemId] : [])])] };
            byId.set(key, merged);
            if (itemId) aliases.set(itemId, canonicalId);
            aliases.set(canonicalId, canonicalId);
            bySemantic.set(semantic, key);
            if (overlay) merged.overlay = true;
        };
        base.forEach((item) => addLocation(item, false));
        dynamic.forEach((item) => addLocation(item, true));
        const locations = [...byId.values()].map((item) => ({ ...item, parentId: resolveId(item.parentId) }));
        const routes = [...list(catalog.routes), ...list(map.routes), ...list(map.routeOverlays)].reduce((values, route) => {
            const normalized = { ...route, from: resolveId(route?.from), to: resolveId(route?.to) };
            const key = text(route?.id) || `${normalized.from}>${normalized.to}`;
            if (key) values.set(key, { ...(values.get(key) || {}), ...normalized });
            return values;
        }, new Map());
        return { ...map, currentLocationId: resolveId(map.currentLocationId), locations, routes: [...routes.values()] };
    }
    function mapSlice(state, plan = {}) {
        const map = mergedMapState(state);
        const locations = list(map.locations);
        const byId = new Map(locations.map((item) => [text(item.id), item]));
        const currentId = text(map.currentLocationId);
        const current = byId.get(currentId);
        const userText = text(WSM.Context?.latestUserMessage?.()?.content);
        const taskTargets = list(state.tasks).filter((item) => ['active','blocked','pending'].includes(item?.status)).flatMap((item) => list(item.locationRefs));
        const namedTarget = locations.find((item) => item.name && userText.includes(item.name));
        const targetId = text(taskTargets[0] || namedTarget?.id || plan?.targetLocationId);
        const movementActive = list(state.npcActivities).some((item) => text(item.movement));
        const triggered = !!(targetId || movementActive || plan?.mapRequired === true || ['entry','timeTransition'].includes(plan?.advanceDecision?.mode)
            || /(前往|去往|进入|离开|路线|怎么走|在哪里|地点|移动|赶往|抵达)/.test(userText));
        if (!triggered || !current) return '';
        const adjacency = new Map();
        list(map.routes).forEach((route) => {
            if (!route?.from || !route?.to) return;
            (adjacency.get(route.from) || adjacency.set(route.from, []).get(route.from)).push({ id: route.to, route });
            (adjacency.get(route.to) || adjacency.set(route.to, []).get(route.to)).push({ id: route.from, route });
        });
        const previous = new Map([[currentId, null]]);
        const queue = [currentId];
        while (queue.length && targetId && !previous.has(targetId)) {
            const from = queue.shift();
            (adjacency.get(from) || []).forEach(({ id, route }) => {
                if (previous.has(id)) return;
                previous.set(id, { from, route });
                queue.push(id);
            });
        }
        const path = [];
        if (targetId && previous.has(targetId)) {
            for (let cursor = targetId; cursor; cursor = previous.get(cursor)?.from || '') path.unshift(cursor);
        } else path.push(currentId, ...(targetId && targetId !== currentId ? [targetId] : []));
        const pathRoutes = path.slice(1).map((id) => previous.get(id)?.route).filter(Boolean);
        const target = byId.get(targetId);
        const accessRuleRefs = [...new Set([...path.flatMap((id) => list(byId.get(id)?.accessRuleRefs)), ...pathRoutes.flatMap((route) => list(route.accessRuleRefs))])];
        const totalMinutes = pathRoutes.reduce((sum, route) => sum + Math.max(0, Number(route.travelMinutes || 0)), 0);
        return [
            `当前位置：${current.name || current.id}`,
            target ? `目标：${target.name || target.id}${target.knownToPlayer === false ? '（玩家角色尚未知，不得直接说出）' : ''}` : '',
            path.length > 1 ? `最小路径：${path.map((id) => byId.get(id)?.name || id).join(' → ')}` : '',
            totalMinutes ? `预计耗时：约${totalMinutes}分钟` : '',
            pathRoutes.length ? `路线状态：${pathRoutes.some((route) => route.status === 'blocked') ? '存在封锁' : pathRoutes.some((route) => route.status === 'unknown') ? '部分未知' : '开放'}` : '',
            [...new Set(path.map((id) => text(byId.get(id)?.temporaryDanger)).filter(Boolean))].length ? `当前危险：${[...new Set(path.map((id) => text(byId.get(id)?.temporaryDanger)).filter(Boolean))].join('；')}` : '',
            accessRuleRefs.length ? `适用规则引用：${accessRuleRefs.join('、')}（规则正文由硬规则库补入）` : '',
        ].filter(Boolean).join('\n');
    }

    function referencedFactIds(state) {
        const refs = new Set();
        const add = (values) => list(values).forEach((value) => refs.add(text(value)));
        list(state.tasks).filter((item) => !['done','failed'].includes(item?.status)).forEach((item) => {
            ['ruleRefs','knowledgeRefs','resourceConstraintRefs','dependencyFactIds'].forEach((field) => add(item?.[field]));
        });
        list(state.characters).filter((item) => item?.present || item?.location === state.world?.location?.current).forEach((item) => {
            add(item?.authorityRefs); add(item?.knowledgeRefs); add(item?.dependencyFactIds);
        });
        const map = mergedMapState(state);
        const relevantLocationIds = new Set([map.currentLocationId, ...list(state.tasks).flatMap((item) => list(item?.locationRefs))].map(text).filter(Boolean));
        list(map.locations).filter((item) => relevantLocationIds.has(text(item?.id))).forEach((item) => {
            add(item?.accessRuleRefs); add(item?.secretRefs); add(item?.dependencyFactIds);
        });
        ['worldRules','factAnchors','resourceConstraints','organizations','characters','npcActivities','relationships','knowledge','schedules','tasks','triggers','threads','processes','causalEffects'].forEach((module) => {
            list(state?.[module]).forEach((item) => add(item?.dependencyFactIds));
        });
        refs.delete('');
        return refs;
    }

    function fallbackBlocks(state, plan = {}) {
        const world = state.world || {};
        const relevantNpcIds = new Set([
            ...(state.identities?.user ? ['user'] : []),
            ...(state.identities?.char ? ['char'] : []),
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
        const activeConstraints = activeMemory(state.resourceConstraints, (item) => item.status === 'active').filter((item) => !['expired','satisfied'].includes(item.status));
        const requiredFactIds = referencedFactIds(state);
        const activeKnowledge = list(state.knowledge).filter((item) => requiredFactIds.has(text(item?.factId || item?.id)) || activeMemory([item], (value) => value.priority === 'L3' && touchesRelevant([...list(value.holderIds), ...list(value.knownBy), ...list(value.believedBy), ...list(value.suspectedBy), ...list(value.misunderstoodBy), ...list(value.unknownTo), ...list(value.relatedRefs)])).length);
        const snapshotFacts = [world.time?.display, world.season, world.location?.current, world.location?.environment, world.location?.weather, ...list(world.currentConditions)].map(canonicalLine).filter(Boolean);
        const uniqueEventContent = (item) => [item.summary, item.outcome].filter(Boolean).filter((value) => {
            const canonical = canonicalLine(value);
            return canonical && !snapshotFacts.some((fact) => fact === canonical || (canonical.length >= 12 && (fact.includes(canonical) || canonical.includes(fact))));
        });
        return {
            world: [
                world.time?.display ? truthLine(`时间：${world.time.display}`, world.time) : '',
                world.season ? truthLine(`季节：${world.season}`, world.seasonMeta) : '',
                world.location?.current ? truthLine(`地点：${world.location.current}`, world.location.currentMeta) : '',
                world.location?.environment ? truthLine(`环境：${world.location.environment}`, world.location.environmentMeta) : '',
                world.location?.weather ? truthLine(`天气：${world.location.weather}`, world.location.weatherMeta) : '',
                ...list(world.currentConditions).map((value) => {
                    const detail = list(world.currentConditionDetails).find((item) => text(item?.value) === text(value));
                    return truthLine(`当前客观状态：${value}`, detail || { truthStatus: 'unknown', basis: ['该状态没有绑定来源'] });
                }),
            ].filter(Boolean).join('\n'),
            factAnchors: activeMemory(state.factAnchors).map((item) => truthLine(`事实锚点：${item.fact}${item.scope ? `｜范围：${item.scope}` : ''}`, item)).join('\n'),
            worldRules: list(state.worldRules).filter((item) => requiredFactIds.has(text(item?.factId || item?.id)) || item.delivery === 'resident' || (text(item.activity).toUpperCase() !== 'COLD' && WSM.Facts?.requiredByContext?.(item, `${text(WSM.Context?.latestUserMessage?.()?.content)}\n${text(plan?.advanceDecision?.direction)}`))).sort((a, b) => Number(b.precedence || 0) - Number(a.precedence || 0)).map((item) => truthLine(WSM.Facts?.render?.(item, state) || item.statement, item)).join('\n'),
            resourceConstraints: activeConstraints.map((item) => truthLine([
                `${item.subjectId ? `${entityName(state, item.subjectId, item.subjectId)}：` : ''}${item.condition}`,
                item.amount ? `数量/额度：${item.amount}` : '',
                item.scope ? `范围：${item.scope}` : '',
                item.consequence ? `不满足时：${item.consequence}` : '',
            ].filter(Boolean).join('｜'), item)).join('\n'),
            organizations: activeMemory(state.organizations, (item) => list(item.leaderIds).some((id) => relevantNpcIds.has(id))).map((item) => truthLine([
                `${item.name}｜${item.kind || '组织'}`,
                item.jurisdiction ? `管辖：${item.jurisdiction}` : '',
                list(item.goals).length ? `当前目标：${join(item.goals)}` : '',
                list(item.resources).length ? `可调用资源：${join(item.resources)}` : '',
                item.situation ? `当前处境：${item.situation}` : '',
            ].filter(Boolean).join('；'), item)).join('\n'),
            ambient: list(plan.ambientResponses).map((item) => {
                if (typeof item === 'string') return `【系统生成/即时反应】环境反馈：${item}`;
                const actor = text(item?.actor) || '环境中的人';
                const response = text(item?.response);
                return response ? `【系统生成/即时反应】${actor}：${response}` : '';
            }).filter(Boolean).join('\n'),
            map: mapSlice(state, plan),
            characters: activeMemory(state.characters, (item) => item.present || relevantNpcIds.has(item.id)).map((item) => truthLine([
                `${entityName(state, item.id, item.name)}｜${item.maintenanceLevel === 'active' ? '活跃NPC' : '核心人物'}`,
                item.identity ? truthLine(`身份：${item.identity}`, item.identityMeta || item) : '',
                list(item.affiliationRefs).length ? `所属引用：${join(item.affiliationRefs)}` : '',
                list(item.authorityRefs).length ? `权限规则引用：${join(item.authorityRefs)}` : '',
                list(item.motives).length ? `稳定动机：${join(item.motives)}` : '',
                list(item.currentGoals).length ? `当前目标：${join(item.currentGoals)}` : '',
                item.routine ? `日常安排：${item.routine}` : '',
                item.availability ? `当前可用性：${item.availability}` : '',
                item.present ? `位置：${item.location || world.location?.current || '当前场景'}（在场）` : `位置：${item.location || '未知地点'}`,
                item.situation ? `重要处境：${item.situation}` : '',
                list(item.persistentConditions).length ? `持续状态：${join(list(item.persistentConditions).map((condition) => typeof condition === 'string' ? condition : truthLine([condition.name, condition.effect, condition.recovery].filter(Boolean).join('｜'), condition)))}` : '',
                list(item.importantItems).length ? `重要物品：${join(list(item.importantItems).map((owned) => typeof owned === 'string' ? owned : truthLine([owned.name, owned.status, owned.significance].filter(Boolean).join('｜'), owned)))}` : '',
            ].filter(Boolean).join('；'), item)).join('\n'),
            npcActivities: recentNpcActivities.map((item) => truthLine(`${entityName(state, item.characterId)}：${item.movement ? `${item.movement}｜` : ''}${item.location ? `${item.location}｜` : ''}${item.action}${item.currentRole ? `｜当前作用：${item.currentRole}` : ''}`, item)).join('\n'),
            relationships: activeMemory(state.relationships, (item) => relevantNpcIds.has(item.from) || relevantNpcIds.has(item.to)).map((item) => truthLine([
                `${entityName(state, item.from) || '?'} → ${entityName(state, item.to) || '?'}`,
                item.identityRelation ? `身份关系：${item.identityRelation}` : '',
                (item.currentPerception || item.status) ? `当前关系认知：${item.currentPerception || item.status}` : '',
                item.formationBasis ? `形成依据：${item.formationBasis}` : '',
                list(item.boundaries).length ? `当前边界：${join(item.boundaries)}` : '',
            ].filter(Boolean).join('\n'), item)).join('\n\n'),
            knowledge: activeKnowledge.map((item) => truthLine([
                replaceIdentityTokens(item.information, state),
                item.priority ? `重要性：${item.priority}` : '',
                item.disclosure ? `公开状态：${disclosureLabel(item.disclosure)}` : '',
                item.certainty ? `性质：${item.certainty}` : '',
                join(list(item.holderIds).map((id) => entityName(state, id))) ? `持有人：${join(list(item.holderIds).map((id) => entityName(state, id)))}` : '',
                item.cognitiveStatus ? `认知状态：${item.cognitiveStatus}` : '',
                join(list(item.knownBy).map((id) => entityName(state, id))) ? `确认：${join(list(item.knownBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.believedBy).map((id) => entityName(state, id))) ? `相信：${join(list(item.believedBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.suspectedBy).map((id) => entityName(state, id))) ? `怀疑：${join(list(item.suspectedBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.misunderstoodBy).map((id) => entityName(state, id))) ? `误解：${join(list(item.misunderstoodBy).map((id) => entityName(state, id)))}` : '',
                join(list(item.unknownTo).map((id) => entityName(state, id))) ? `未知：${join(list(item.unknownTo).map((id) => entityName(state, id)))}` : '',
            ].filter(Boolean).join('｜'), item)).join('\n'),
            schedules: activeMemory(state.schedules, (item) => list(item.participantIds).some((id) => relevantNpcIds.has(id))).filter((item) => ['agreed','scheduled','changed'].includes(item.status)).map((item) => truthLine([
                item.title,
                list(item.participantIds).length ? `参与者：${join(list(item.participantIds).map((id) => entityName(state, id)))}` : '',
                item.expectedTime ? `预计时间：${item.expectedTime}` : '',
                list(item.preconditions).length ? `前置条件：${join(item.preconditions)}` : '',
                `状态：${item.status}`,
            ].filter(Boolean).join('｜'), item)).join('\n'),
            tasks: activeMemory(state.tasks, (item) => item.status === 'active' && item.userVisible !== false).filter((item) => !['done','failed'].includes(item.status)).map((item) => truthLine([
                `${item.title}：${item.progress || item.status || '待处理'}${item.deadline ? `；截止${item.deadline}` : ''}`,
                list(item.dependencies).length ? `依赖：${join(item.dependencies)}` : '',
                list(item.completionConditions).length ? `完成条件（必须逐条核验）：${join(item.completionConditions)}` : '',
                list(item.completedConditions).length ? `已核验完成条件：${join(item.completedConditions)}` : '',
                [...list(item.locationRefs), ...list(item.characterRefs), ...list(item.ruleRefs), ...list(item.knowledgeRefs), ...list(item.resourceConstraintRefs)].length ? `依赖引用：${join([...list(item.locationRefs), ...list(item.characterRefs), ...list(item.ruleRefs), ...list(item.knowledgeRefs), ...list(item.resourceConstraintRefs)])}` : '',
            ].filter(Boolean).join('｜'), item)).join('\n'),
            triggers: activeMemory(state.triggers, (item) => item.status === 'eligible').filter((item) => !['triggered','expired'].includes(item.status)).map((item) => truthLine(`${item.title}：条件${join(item.conditions) || '未设定'}；当前${item.status || 'armed'}`, item)).join('\n'),
            threads: activeMemory(state.threads, (item) => item.priority === 'L3' && touchesRelevant(item.participantIds)).filter((item) => item.status !== 'resolved').map((item) => truthLine(`${item.title}：${item.nextNaturalStep || item.status || '延续中'}`, item)).join('\n'),
            progression: state.progression?.activity !== 'COLD' ? truthLine([
                state.progression?.direction ? `当前方向：${state.progression.direction}` : '',
                state.progression?.currentMovement ? `当前变化：${state.progression.currentMovement}` : '',
                join(state.progression?.nextRequiredChanges) ? `下一阶段仍需：${join(state.progression.nextRequiredChanges)}` : '',
                state.progression?.blockedByDecision ? `必须停在用户决策点：${state.progression.blockedByDecision}` : '',
            ].filter(Boolean).join('\n'), state.progression) : '',
            processes: activeMemory(state.processes, (item) => item.priority === 'L3').filter((item) => item.status !== 'resolved').map((item) => truthLine(`${item.title}：${item.currentDirection || item.status || '自然延续'}${Number(item.progress?.max) > 0 ? `；进度${Number(item.progress?.current || 0)}/${Number(item.progress.max)}` : ''}`, item)).join('\n'),
            causalEffects: activeMemory(state.causalEffects, (item) => item.status === 'active' && touchesRelevant(item.affectedIds)).filter((item) => item.status === 'active').map((item) => truthLine([item.cause || item.causeRef, ...list(item.steps), item.result].filter(Boolean).join(' → '), item)).join('\n'),
            pacing: pacingBlock(),
            planner: [
                plan.historyRecall ? `本轮定点历史召回（仅用于核对当前行动，不代表重读全部历史）：\n${text(plan.historyRecall)}` : '',
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
        return Object.fromEntries(Object.entries(value).map(([key, content]) => {
            const normalized = replaceIdentityTokens(content, state);
            const marked = key === 'ambient'
                ? normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => line.startsWith('【') ? line : `【系统生成/即时反应】${line}`).join('\n')
                : normalized;
            return [key, marked];
        }));
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
            protected: item.protected === true,
            priority: Number(item.priority ?? 50),
        }));
        const maxChars = Math.max(500, Number(configuredMax || 3500));
        const fullSections = [diceBlock, ...entries.map((item) => item.header + item.payload)].filter(Boolean);
        const fullBody = fullSections.join('\n\n');
        if (fullBody.length <= maxChars) return fullBody;
        const protectedEntries = entries.filter((item) => item.protected);
        const protectedBody = [diceBlock, ...protectedEntries.map((item) => item.header + item.payload)].filter(Boolean).join('\n\n');
        // Hard rules (including scope, conditions and exceptions) and secret
        // knowledge boundaries are indivisible. If they alone exceed the user
        // budget, correctness wins over a misleading truncation.
        if (protectedBody.length >= maxChars) return protectedBody;
        let remaining = maxChars - protectedBody.length - (protectedBody ? 2 : 0);
        const allocations = new Map();
        const regularEntries = entries.filter((item) => !item.protected);
        const overhead = regularEntries.reduce((sum, item) => sum + item.header.length + 2, 0);
        if (remaining > overhead) {
            const payloadBudget = remaining - overhead;
            // Give every enabled, non-empty module a fair first slice before
            // distributing surplus by priority. Otherwise one long world or
            // resource prompt can consume the whole depth budget and silently
            // erase later modules such as character identities.
            const fairShare = Math.max(24, Math.floor(payloadBudget / Math.max(1, regularEntries.length)));
            let used = 0;
            regularEntries.forEach((item) => {
                const allocation = Math.min(item.payload.length, fairShare);
                if (allocation > 0) allocations.set(item, allocation);
                used += allocation;
            });
            let surplus = Math.max(0, payloadBudget - used);
            regularEntries.slice().sort((a, b) => b.priority - a.priority).forEach((item) => {
                if (surplus <= 0) return;
                const current = allocations.get(item) || 0;
                const extra = Math.min(item.payload.length - current, surplus);
                if (extra > 0) allocations.set(item, current + extra);
                surplus -= Math.max(0, extra);
            });
        }
        return [
            diceBlock,
            ...entries.map((item) => {
                if (item.protected) return item.header + item.payload;
                const allocation = allocations.get(item);
                return allocation ? item.header + shorten(item.payload, allocation) : '';
            }),
        ].filter(Boolean).join('\n\n');
    }
    function activeFactGroups(state, modules) {
        const moduleConfig = (id) => Object.assign({}, WSM.Defaults.INJECTION_MODULES[id] || {}, modules[id] || {});
        const enabledStateFactIds = new Set();
        Object.keys(WSM.Defaults.INJECTION_MODULES).forEach((module) => {
            if (moduleConfig(module).enabled === false) return;
            list(state?.[module]).forEach((item) => { if (item?.factId) enabledStateFactIds.add(text(item.factId)); });
        });
        const catalog = WSM.Facts?.merge?.(WSM.WorldbookCompiler?.getStaticCatalog?.()?.facts || []) || [];
        const required = referencedFactIds(state);
        const explicitFacts = catalog.filter((fact) => required.has(text(fact?.factId)));
        const seeds = WSM.Facts?.merge?.([...(WSM.WorldbookCompiler?.getActiveFacts?.() || []), ...explicitFacts]) || [];
        const activeFacts = WSM.Facts?.expandDependencies?.(seeds, catalog) || seeds;
        const includedFactIds = new Set(enabledStateFactIds);
        const groups = new Map();
        activeFacts.forEach((factValue) => {
            const fact = WSM.Facts.normalize(factValue);
            if (!fact.statement || includedFactIds.has(fact.factId) || fact.delivery === 'local') return;
            let owner = fact.owner;
            const ownerAvailable = WSM.Defaults.INJECTION_MODULES[owner] && moduleConfig(owner).enabled !== false;
            if (!ownerAvailable) owner = 'worldbook';
            const depth = owner === 'worldbook'
                ? fact.depth
                : Math.max(0, Math.min(4, Math.round(Number(moduleConfig(owner).depth ?? fact.depth ?? 2))));
            const key = `${owner}|${depth}`;
            if (!groups.has(key)) groups.set(key, { owner, depth, facts: [] });
            groups.get(key).facts.push(fact);
            includedFactIds.add(fact.factId);
        });
        return [...groups.values()].map((group) => ({
            ...group,
            content: group.facts.map((fact) => WSM.Facts.render(fact, state)).filter(Boolean).join('\n'),
            protected: group.facts.some((fact) => fact.owner === 'worldRules' || fact.owner === 'knowledge' || fact.type === 'rule'),
            factIds: group.facts.map((fact) => fact.factId),
        }));
    }
    const moduleBudgetPriority = Object.freeze({
        worldRules: 100, world: 95, resourceConstraints: 95, factAnchors: 90, knowledge: 90,
        organizations: 86, characters: 85, relationships: 85, schedules: 82, map: 80, tasks: 78, causalEffects: 70,
        npcActivities: 68, triggers: 62, threads: 60, processes: 58, progression: 55,
        pacing: 45, planner: 35, ambient: 20, worldbook: 10,
    });

    function compose(state, plan = {}, plannerBlocks = {}) {
        const override = finalOverride(state);
        if (override) return override;
        const settings = WSM.Settings.get();
        const modules = settings.injectionModules || WSM.Defaults.INJECTION_MODULES;
        const generated = fallbackBlocks(state, plan);
        const supplied = normalizePlannerBlocks(plannerBlocks, state);
        const factGroups = activeFactGroups(state, modules);
        const diceBlock = settings.diceEnabled ? WSM.Dice?.injectionBlock?.(plan.diceRound) : '';
        const authorityBlock = '[外置状态权威]\n本 WORLD_STATE 标签是本轮唯一状态来源。只输出叙事正文及用户明确要求的附加格式；不得另行输出 <INDRS>、<abstract>、<note> 或 GM_STATE，不得在正文后自行提交第二套状态。';
        const fixedBlock = [diceBlock, authorityBlock].filter(Boolean).join('\n\n');
        const candidates = [];
        const seenFacts = [];
        Object.entries(WSM.Defaults.INJECTION_MODULES).forEach(([id, defaultModule]) => {
            if (id === 'map') return; // The scene map is a local visualization and must never be sent to the narrative AI.
            const config = Object.assign({}, defaultModule, modules[id] || {});
            if (config.enabled === false) return;
            const projectedFacts = factGroups.filter((group) => group.owner === id).map((group) => group.content).filter(Boolean).join('\n');
            const source = [(['ambient','planner'].includes(id) ? (supplied[id] || generated[id]) : generated[id]), projectedFacts].filter(Boolean).join('\n');
            const content = dedupeContent(removeRatingNumbers(replaceIdentityTokens(source, state)), seenFacts);
            if (!content) return;
            const fixedInstruction = text(config.instruction);
            const editablePrompt = text(settings.modulePrompts?.[id]);
            const instruction = [fixedInstruction, editablePrompt && editablePrompt !== fixedInstruction ? `模块提示词：${editablePrompt}` : ''].filter(Boolean).join('\n');
            candidates.push({ label: config.label, content, instruction, protected: ['worldRules','knowledge'].includes(id) || factGroups.some((group) => group.owner === id && group.protected), priority: moduleBudgetPriority[id] || 50 });
        });
        factGroups.filter((group) => group.owner === 'worldbook').forEach((group) => {
            const content = dedupeContent(group.content, seenFacts);
            if (content) candidates.push({ label: '世界书剩余背景', content, instruction: '只补充尚未由其他主归属模块表达的背景与语义连接；原文仍是唯一来源。', protected: group.protected, priority: moduleBudgetPriority.worldbook });
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
        const factGroups = activeFactGroups(state, modules);
        const groups = new Map();
        const seenFacts = [];
        Object.entries(WSM.Defaults.INJECTION_MODULES).forEach(([id, defaultModule]) => {
            if (id === 'map') return; // Keep map topology, labels, and routes out of every injection depth.
            const config = Object.assign({}, defaultModule, modules[id] || {});
            if (config.enabled === false) return;
            const projectedFacts = factGroups.filter((group) => group.owner === id).map((group) => group.content).filter(Boolean).join('\n');
            const source = [(['ambient','planner'].includes(id) ? (supplied[id] || generated[id]) : generated[id]), projectedFacts].filter(Boolean).join('\n');
            const content = dedupeContent(removeRatingNumbers(replaceIdentityTokens(source, state)), seenFacts);
            if (!content) return;
            const fixedInstruction = text(config.instruction);
            const editablePrompt = text(settings.modulePrompts?.[id]);
            const instruction = [fixedInstruction, editablePrompt && editablePrompt !== fixedInstruction ? `模块提示词：${editablePrompt}` : ''].filter(Boolean).join('\n');
            const depth = Math.max(0, Math.min(4, Math.round(Number(config.depth ?? defaultModule.depth ?? 2))));
            if (!groups.has(depth)) groups.set(depth, []);
            groups.get(depth).push({ id, label: config.label, content, instruction, protected: ['worldRules','knowledge'].includes(id) || factGroups.some((group) => group.owner === id && group.protected), priority: moduleBudgetPriority[id] || 50 });
        });
        factGroups.filter((group) => group.owner === 'worldbook').forEach((group) => {
            const content = dedupeContent(group.content, seenFacts);
            if (!content) return;
            if (!groups.has(group.depth)) groups.set(group.depth, []);
            groups.get(group.depth).push({ id: 'worldbook', label: '世界书剩余背景', content, instruction: '只补充尚未由其他主归属模块表达的背景与语义连接；原文仍是唯一来源。', protected: group.protected, priority: moduleBudgetPriority.worldbook });
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

    function preview(state, plan = {}, plannerBlocks = {}) {
        const override = finalOverride(state);
        if (override) return override;
        const statePrompts = composeByDepth(state, plan, plannerBlocks);
        return Object.keys(statePrompts).map(Number).filter(Number.isFinite).sort((a, b) => a - b).map((depth) => text(statePrompts[depth])).filter(Boolean).join('\n\n');
    }

    WSM.Injection = { compose, composeByDepth, preview, normalizeFinalOverride, fallbackBlocks, pacingBlock, _test: { replaceIdentityTokens, entityName } };
})();
