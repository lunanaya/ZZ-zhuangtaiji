(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const sectionMap = {
        overview: ['世界状态', (s) => ({ world: s.world, lockedPaths: s.lockedPaths || [] })],
        map: ['场景地图', (s) => s.map],
        characters: ['人物状态', (s) => s.characters],
        activities: ['NPC活动轨迹', (s) => s.npcActivities],
        relationships: ['人物关系', (s) => s.relationships],
        knowledge: ['知识 / 秘密', (s) => s.knowledge],
        tasks: ['当前任务', (s) => s.tasks],
        events: ['世界事件', (s) => s.events],
        triggers: ['可触发事件', (s) => s.triggers],
        threads: ['长期线程', (s) => s.threads],
        processes: ['世界进程', (s) => s.processes],
        causalEffects: ['因果影响', (s) => s.causalEffects],
        timeline: ['时间线', (s) => s.timeline],
        planner: ['本轮后台判断', (s) => s.planner],
        sources: ['输入来源', (s) => s.runtime?.sourceSummary || {}],
        worldbookEmpty: ['世界书注入', () => ({})],
        injection: ['最终注入', (s) => s.planner?.injection || ''],
    };
    let root;
    let active = 'overview';
    let editMode = false;
    let activeCategory = 'world';
    let activeSettingsTab = 'api';
    let worldbookEntriesCache = [];
    const dynamicWorldbookSections = new Set();
    const categories = {
        world: { icon: 'map', label: '世界', sections: ['overview','map','events','processes','causalEffects'] },
        people: { icon: 'people', label: '人物', sections: ['characters','activities','relationships','knowledge'] },
        affairs: { icon: 'clipboard', label: '事务', sections: ['tasks','triggers','threads','timeline'] },
        worldbook: { icon: 'note', label: '世界书注入', sections: [] },
        system: { icon: 'sliders', label: '系统', sections: ['sources','planner','injection'] },
    };
    const promptGroups = {
        world: ['world','ambient','map','events','processes','causalEffects'],
        people: ['characters','npcActivities','relationships','knowledge'],
        affairs: ['tasks','triggers','threads','timeline'],
        system: ['planner'],
    };
    const promptLabels = {
        world: '世界状态', ambient: '环境与路人反应', map: '场景地图', characters: '人物状态', npcActivities: 'NPC活动轨迹', relationships: '人物关系', knowledge: '知识与秘密',
        tasks: '当前任务', events: '世界事件', triggers: '可触发事件', threads: '长期线程', processes: '世界进程',
        causalEffects: '因果影响', timeline: '时间线', planner: '本轮后台判断',
    };
    const sectionHelp = {
        overview: '只显示此刻的时间、地点、环境和已定事实。',
        map: '显示当前位置、已知地点和地点之间的通行路线。',
        activities: '每个NPC只保留最近5条已经发生或正在持续的活动。',
        events: '只显示正在发生的变化和最新进展，不重复世界状态。',
        processes: '只解释事情为什么继续、淡去或结束。',
        causalEffects: '统一显示既存起因如何经过寻常步骤形成局部结果。',
        timeline: '只记录已经真正发生的事，每件事只记一次。',
        planner: '只显示本轮后台对“可以发生”与“不应发生”的判断。',
        sources: '显示最近一次推演实际读到的角色卡、Persona、酒馆正文和世界书；未列出的世界书没有进入 Planner。',
        worldbookEmpty: '尚无已拆解的世界书条目。请先在“设置 → 拆解世界书”中选择并拆解条目。',
        injection: '这是将要发给正文模型的去重后内容。',
    };

    const worldbookSectionId = (key) => `worldbookEntry:${encodeURIComponent(String(key || ''))}`;
    const isWorldbookSection = (id) => String(id || '').startsWith('worldbookEntry:');
    function currentWorldbookReport(state) {
        const persisted = state?.runtime?.worldbookInjection || null;
        return WSM.WorldbookCompiler?.getReport?.(persisted) || persisted || { entries: [] };
    }
    function syncWorldbookSections(state) {
        dynamicWorldbookSections.forEach((id) => { delete sectionMap[id]; delete sectionHelp[id]; });
        dynamicWorldbookSections.clear();
        const report = currentWorldbookReport(state);
        const entries = Array.isArray(report.entries) ? report.entries : [];
        categories.worldbook.sections = entries.map((entry, index) => {
            const id = worldbookSectionId(entry.key || index);
            dynamicWorldbookSections.add(id);
            sectionMap[id] = [entry.label || `拆解条目 ${index + 1}`, () => entry];
            sectionHelp[id] = `来自「${entry.bookName || '世界书'}」；这里显示并编辑该条目的拆解规则，保存后下一轮会重新路由。`;
            return id;
        });
        if (activeCategory === 'worldbook' && !categories.worldbook.sections.includes(active)) active = categories.worldbook.sections[0] || 'worldbookEmpty';
        return report;
    }

    const definitions = {
        characters: { title: '人物', identity: 'name', fields: [['location','位置'],['present','在场'],['status','状态'],['pose','姿势'],['clothing','衣物'],['heldItems','手持物'],['injuries','伤势'],['resources','资源'],['currentAction','正在做'],['goals','目标'],['tasks','任务'],['notes','备注']] },
        activities: { title: '活动', identity: 'action', stateKey: 'npcActivities', fields: [['characterId','人物'],['location','地点'],['action','在做什么']] },
        relationships: { title: '关系', identity: 'status', fields: [['from','主体'],['to','对象'],['type','类型'],['status','现状'],['evidence','依据']] },
        knowledge: { title: '信息', identity: 'information', fields: [['information','内容'],['certainty','认知性质'],['knownBy','确认者'],['believedBy','相信者'],['suspectedBy','怀疑者'],['misunderstoodBy','误解者'],['concealedBy','知情但隐瞒'],['unknownTo','未知者'],['source','来源/渠道'],['reliability','可靠性'],['evidence','证据'],['discoveryPaths','发现路径'],['maturityConditions','成熟条件']] },
        tasks: { title: '任务', identity: 'title', fields: [['title','名称'],['ownerIds','负责人'],['progress','当前进展'],['deadline','截止时间'],['dependencies','前置条件'],['consequences','影响']] },
        events: { title: '事件', identity: 'title', fields: [['title','名称'],['location','地点'],['participantIds','相关人物'],['developments','发展']] },
        triggers: { title: '可触发事件', identity: 'title', fields: [['title','名称'],['conditions','触发条件'],['effectsIfTriggered','触发后'],['blockedReasons','尚未触发原因']] },
        threads: { title: '长期事务', identity: 'title', fields: [['title','名称'],['stakes','重要性'],['participantIds','相关人物'],['nextNaturalStep','自然下一步'],['history','已有发展']] },
        processes: { title: '世界进程', identity: 'title', fields: [['title','名称'],['drivers','为什么仍在继续'],['decayConditions','可能逐渐淡去'],['resolutionConditions','自然结束条件'],['progress','进度钟'],['currentDirection','目前趋势']] },
        causalEffects: { title: '因果影响', identity: 'result', fields: [['causeRef','起因引用'],['cause','A：既存起因'],['steps','寻常经过'],['result','B：局部结果'],['affectedIds','影响到谁'],['status','抵达状态'],['reachCondition','尚缺条件'],['evidenceRefs','依据']] },
        timeline: { title: '记录', identity: 'summary', fields: [['summary','发生的事'],['participants','相关人物'],['location','地点'],['evidence','依据'],['actualChanges','实际变化']] },
    };

    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const iconPaths = {
        map: '<path d="M3 6.5 8 4l8 3 5-2.5v13L16 20l-8-3-5 2.5z"/><path d="M8 4v13M16 7v13"/>',
        people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8V20"/>',
        clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M9 9h6M9 13h6M9 17h4"/>',
        sliders: '<path d="M4 7h10M18 7h2M4 17h3M11 17h9"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
        weather: '<path d="M7 17h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 10.5 3.5 3.5 0 0 0 7 17Z"/><path d="M12 2v2M4.9 4.9l1.4 1.4M19.1 4.9l-1.4 1.4"/>',
        home: '<path d="m3 11 9-8 9 8v10H3z"/><path d="M9 21v-7h6v7"/>',
        note: '<path d="M5 3h11l3 3v15H5z"/><path d="M16 3v4h4M8 11h8M8 15h8M8 19h5"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
        heart: '<path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>',
        lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
        check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
        event: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
        flag: '<path d="M5 22V3M5 4h11l-2 4 2 4H5"/>',
        thread: '<path d="M4 7h8a4 4 0 0 1 4 4v6M12 17h8M17 14l3 3-3 3"/>',
        process: '<path d="M3 8c3-3 5 3 8 0s5 3 8 0M3 16c3-3 5 3 8 0s5 3 8 0"/>',
        causal: '<path d="M4 6h5a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h5M16 14l4 4-4 4"/>',
        seed: '<path d="M12 21v-9M12 14c-5 0-7-3-7-7 5 0 7 3 7 7ZM12 11c0-5 3-7 7-7 0 5-3 7-7 7Z"/>',
        ban: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
        send: '<path d="m3 11 18-8-8 18-2-8zM11 13l5-5"/>',
        plug: '<path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
        brain: '<path d="M9 4a3 3 0 0 0-5 2.2A3.5 3.5 0 0 0 4.5 13 4 4 0 0 0 9 19M15 4a3 3 0 0 1 5 2.2 3.5 3.5 0 0 1-.5 6.8A4 4 0 0 1 15 19M9 4v16M15 4v16M9 8h3M12 12h3M9 16h3"/>',
        history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
        edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        chevron: '<path d="m7 9 5 5 5-5"/>',
        cube: '<path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10"/>',
        empty: '<circle cx="12" cy="12" r="8" stroke-dasharray="2.5 3"/><path d="M9 12h6"/>',
    };
    function icon(name, className = '') {
        const paths = iconPaths[name] || iconPaths.empty;
        return `<svg class="wsm-icon ${escape(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
    }
    const $ = (selector) => root?.querySelector(selector);
    const displayValue = (value) => {
        if (Array.isArray(value)) return value.join('、');
        if (typeof value === 'boolean') return value ? '是' : '否';
        if (value && typeof value === 'object') return Object.values(value).filter((item) => typeof item !== 'object').join('；');
        return String(value ?? '');
    };
    function formatCollection(items, definition) {
        if (!Array.isArray(items) || !items.length) return `暂无${definition.title}`;
        return items.map((item, index) => {
            const heading = displayValue(item?.[definition.identity]) || `${definition.title}${index + 1}`;
            const lines = [`${definition.title}：${heading}`];
            definition.fields.forEach(([key, label]) => {
                const value = displayValue(item?.[key]);
                if (value) lines.push(`${label}：${value}`);
            });
            return lines.join('\n');
        }).join('\n\n');
    }
    function formatHuman(state) {
        if (isWorldbookSection(active)) {
            const entry = currentWorldbookReport(state).entries?.find((item) => worldbookSectionId(item.key) === active) || {};
            const group = (title, values) => `【${title}】\n${(Array.isArray(values) && values.length) ? values.map((item) => `- ${item}`).join('\n') : '- （无）'}`;
            return [
                `世界书：${entry.bookName || '未命名世界书'}`,
                `条目：${entry.label || entry.key || '未命名条目'}`,
                '',
                group('核心规则', entry.core),
                '',
                group('触发情境', entry.triggers),
                '',
                group('条件规则', entry.rules),
                '',
                group('必要背景', entry.background),
            ].join('\n');
        }
        if (active === 'overview') return [
            `时间：${state.world?.time?.display || '未设定'}`,
            `地点：${state.world?.location?.current || '未设定'}`,
            `状态：${state.world?.location?.environment || '未设定'}`,
            `天气：${state.world?.location?.weather || '未设定'}`,
            ...(state.world?.facts || []).map((fact) => `安排：${fact}`),
        ].join('\n');
        if (active === 'map') return [
            `当前位置：${state.map?.currentLocationId || '未设定'}`,
            ...(state.map?.locations || []).map((item) => `地点：${item.id || ''}｜${item.name || ''}｜${item.area || ''}｜${item.status || 'known'}｜${item.description || ''}`),
            ...(state.map?.routes || []).map((item) => `路线：${item.from || ''}｜${item.to || ''}｜${item.status || 'open'}｜${item.description || ''}`),
        ].join('\n');
        if (definitions[active]) return formatCollection(state[definitions[active].stateKey || active], definitions[active]);
        if (active === 'planner') {
            const plan = state.planner?.plan || {};
            const dice = plan.diceRound;
            return [
                `时间推进：${plan.timeAdvanceMinutes ?? 0}分钟`,
                plan.sceneAssessment ? `场景判断：${plan.sceneAssessment.status || 'quiet'}｜需要推进=${plan.sceneAssessment.shouldAdvance === true ? '是' : '否'}｜${plan.sceneAssessment.intensity || 'none'}${(plan.sceneAssessment.evidence || []).length ? `｜${(plan.sceneAssessment.evidence || []).join('、')}` : ''}` : '',
                plan.advanceDecision ? `推进决定：${plan.advanceDecision.mode || 'hold'}｜${plan.advanceDecision.direction || '保持当前场景'}｜${plan.advanceDecision.intensity || 'none'}${plan.advanceDecision.reason ? `｜${plan.advanceDecision.reason}` : ''}` : '',
                ...(plan.actorDecisions || []).map((value) => `行动判断：${value.characterId || '?'}｜${value.allowed === false ? '不允许' : '允许'}｜${value.action || '保持当前行动'}${value.reason ? `｜${value.reason}` : ''}`),
                ...(plan.backgroundQueue || []).map((value) => `后台队列：${value.sourceType || 'item'}:${value.sourceId || '?'}｜${value.decision || 'carry'}${value.reason ? `｜${value.reason}` : ''}`),
                ...(dice ? [
                    `骰子强度：${dice.intensity?.number || ''}/20｜${dice.intensity?.label || ''}`,
                    `骰子焦点：${dice.analysisFocus?.label || ''}（不检定）`,
                    `骰子方向：${dice.direction?.label || ''}｜${dice.direction?.number || ''}/20`,
                    `检定骰池：${(dice.checkPool || []).map((item) => item.number).join('、') || '无'}`,
                ] : []),
                ...(plan.npcActions || []).map((value) => `人物行动：${value}`),
                ...(plan.npcUpdates || []).map((value) => `人物活动：${value.characterId || value.name || '未知人物'}｜${value.mode || ''}｜${value.action || value.intentionalState || '保持原状态'}${value.reason ? `｜${value.reason}` : ''}`),
                ...(plan.processUpdates || []).map((value) => `进程变化：${displayValue(value)}`),
                ...(plan.causalUpdates || plan.causalRipples || []).map((value) => `因果影响：${value.cause || value.causeRef || value.rootCauseRef || '无根因'} → ${value.result || value.effect || '无变化'}（${value.status || 'developing'}）`),
                ...(plan.eligibleDevelopments || []).map((value) => `可以发展：${value}`),
                ...(plan.forbiddenDevelopments || []).map((value) => `不要发生：${value}`),
                plan.notes ? `备注：${plan.notes}` : '',
                state.planner?.error ? `错误：${state.planner.error}` : '',
            ].filter(Boolean).join('\n');
        }
        if (active === 'injection') return String(state.planner?.injection || '暂无注入内容')
            .replace(/^\s*<WORLD_STATE>\s*/i, '')
            .replace(/\s*<\/WORLD_STATE>\s*$/i, '');
        return '';
    }
    function parseWorldbookText(raw) {
        const input = String(raw || '');
        const read = (title, nextTitle) => {
            const end = nextTitle ? `(?=\\n\\s*【${nextTitle}】|$)` : '$';
            const match = input.match(new RegExp(`【${title}】\\s*\\n([\\s\\S]*?)${end}`));
            if (!match) return [];
            return match[1].split(/\r?\n/).map((line) => line.replace(/^\s*[-*•]\s*/, '').trim()).filter((line) => line && line !== '（无）');
        };
        return {
            core: read('核心规则', '触发情境'),
            triggers: read('触发情境', '条件规则'),
            rules: read('条件规则', '必要背景'),
            background: read('必要背景'),
        };
    }
    function splitValues(value) { return String(value || '').split(/[、,，;；|]/).map((item) => item.trim()).filter(Boolean); }
    function lineMap(value) {
        const map = {};
        String(value).split(/\r?\n/).forEach((line) => {
            const match = line.match(/^\s*([^：:【】]+)[：:]\s*(.*?)\s*】?$/);
            if (match) (map[match[1].trim()] ||= []).push(match[2].trim());
        });
        return map;
    }
    function parseCollection(raw, previous, definition) {
        if (/^\s*暂无/.test(raw)) return [];
        return String(raw).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).map((block, index) => {
            const heading = block.match(/^【[^：:]+[：:]\s*(.*?)】/m)?.[1]?.trim()
                || block.match(new RegExp(`^${definition.title}[：:]\\s*(.*?)$`, 'm'))?.[1]?.trim()
                || '';
            const map = lineMap(block);
            const old = previous.find((item) => displayValue(item?.[definition.identity]) === heading) || previous[index] || {};
            const item = WSM.Storage.clone(old);
            if (heading && definition.identity !== 'status') item[definition.identity] = heading;
            definition.fields.forEach(([key, label]) => {
                const value = map[label]?.at(-1);
                if (value === undefined) return;
                const arrayKeys = ['goals','tasks','evidence','knownBy','unknownTo','ownerIds','dependencies','consequences','participantIds','developments','conditions','effectsIfTriggered','blockedReasons','history','participants','actualChanges','drivers','decayConditions','resolutionConditions','steps','affectedIds','evidenceRefs'];
                if (Array.isArray(old?.[key]) || arrayKeys.includes(key)) item[key] = splitValues(value);
                else if (typeof old?.[key] === 'boolean' || key === 'present') item[key] = /^(是|true|yes|在场)$/i.test(value);
                else if (typeof old?.[key] === 'number') item[key] = Number(value) || 0;
                else item[key] = value;
            });
            if (!item.id) item.id = `${active}-${Date.now()}-${index}`;
            return item;
        });
    }
    function parseHuman(raw, state) {
        const map = lineMap(raw);
        if (active === 'overview') {
            state.world ||= {}; state.world.time ||= {}; state.world.location ||= {};
            if (map['时间']?.length) state.world.time.display = map['时间'].at(-1);
            if (map['地点']?.length) state.world.location.current = map['地点'].at(-1);
            if (map['状态']?.length) state.world.location.environment = map['状态'].at(-1);
            if (map['天气']?.length) state.world.location.weather = map['天气'].at(-1);
            state.world.facts = map['安排'] || [];
        } else if (active === 'map') {
            const parseParts = (value) => String(value || '').split(/[|｜]/).map((item) => item.trim());
            state.map ||= { currentLocationId: '', locations: [], routes: [] };
            state.map.currentLocationId = map['当前位置']?.at(-1) || '';
            state.map.locations = (map['地点'] || []).map((value, index) => {
                const [id, name, area, status, description] = parseParts(value);
                return { id: id || `location-${Date.now()}-${index}`, name: name || id || '未命名地点', area: area || '', status: status || 'known', description: description || '' };
            });
            state.map.routes = (map['路线'] || []).map((value) => {
                const [from, to, status, description] = parseParts(value);
                return { from: from || '', to: to || '', status: status || 'open', description: description || '' };
            }).filter((item) => item.from && item.to);
        } else if (definitions[active]) {
            const stateKey = definitions[active].stateKey || active;
            state[stateKey] = parseCollection(raw, Array.isArray(state[stateKey]) ? state[stateKey] : [], definitions[active]);
        } else if (active === 'injection') {
            state.planner.injection = `<WORLD_STATE>\n${String(raw).trim()}\n</WORLD_STATE>`;
        } else if (active === 'planner') {
            state.planner.plan ||= {};
            state.planner.plan.timeAdvanceMinutes = Number(map['时间推进']?.at(-1)?.match(/-?\d+/)?.[0] || 0);
            state.planner.plan.npcActions = map['人物行动'] || [];
            state.planner.plan.eligibleDevelopments = map['可以发展'] || [];
            state.planner.plan.forbiddenDevelopments = map['不要发生'] || [];
            state.planner.plan.notes = map['备注']?.at(-1) || '';
        }
        return state;
    }
    const statusLabels = {
        active: '进行中', dormant: '暂未活动', resolved: '已结束', pending: '待开始', blocked: '受阻', done: '已完成', failed: '未完成',
        armed: '等待条件', eligible: '条件已满足', triggered: '已触发', expired: '已失效', open: '持续中', paused: '已暂停', decaying: '逐渐减弱',
        developing: '正在形成', arrived: '已经抵达', discarded: '路径不成立', reached: '已经抵达', deferred: '尚未抵达', sufficient: '因果充分', insufficient: '因果不足', confirmed: '已确认', believed: '人物相信', rumor: '传闻',
    };
    const mapStatusLabels = { known: '已知', visited: '已到访', unavailable: '暂不可达', open: '可通行', blocked: '路线受阻', unknown: '状况未知' };
    const friendly = (value) => statusLabels[String(value || '').toLowerCase()] || String(value || '');
    function chips(values, empty = '') {
        const items = Array.isArray(values) ? values.filter(Boolean) : (values ? [values] : []);
        return items.length ? `<div class="wsm-chips">${items.map((item) => `<span>${escape(friendly(item))}</span>`).join('')}</div>` : empty;
    }
    function resolveRef(state, ref) {
        const key = String(ref || '');
        const normalized = key.toLowerCase();
        if (['user','<user>'].includes(normalized) && state.identities?.user) return state.identities.user;
        if (['char','character','<char>'].includes(normalized) && state.identities?.char) return state.identities.char;
        for (const group of ['characters','tasks','events','triggers','threads','processes','causalEffects','knowledge']) {
            const found = (state[group] || []).find((item) => String(item?.id) === key);
            if (found) return found.name || found.title || found.information || found.effect || found.potentialEffect || key;
        }
        return key;
    }
    function isSnapshotDuplicate(state, value) {
        const normalize = (item) => String(item || '').replace(/[\s，。；：:、]/g, '').toLowerCase();
        const target = normalize(value);
        const world = state.world || {};
        const snapshots = [world.time?.display, world.location?.current, world.location?.environment, world.location?.weather, ...(world.facts || [])].map(normalize).filter(Boolean);
        return !!target && snapshots.some((item) => item === target || (target.length >= 12 && (item.includes(target) || target.includes(item))));
    }
    function card(title, subtitle, body, options = {}) {
        const badge = options.badge ? `<span class="wsm-card-badge">${escape(friendly(options.badge))}</span>` : '';
        return `<details class="wsm-game-card" ${options.open === false ? '' : 'open'}><summary><div class="wsm-card-icon">${icon(options.icon || 'empty')}</div><div><b>${escape(title || '未命名')}</b>${subtitle ? `<small>${escape(subtitle)}</small>` : ''}</div>${badge}<span class="wsm-expand">${icon('chevron')}</span></summary><div class="wsm-card-body">${body || '<p class="wsm-muted">暂无详细信息</p>'}</div></details>`;
    }
    function labeled(label, value) {
        if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '';
        return `<div class="wsm-readable-row"><span>${escape(label)}</span><div>${Array.isArray(value) ? chips(value) : escape(friendly(value))}</div></div>`;
    }
    function renderGameView(state) {
        const empty = (label) => `<div class="wsm-empty-state"><span>${icon('empty')}</span><b>暂无${label}</b><small>世界会在满足因果和时间条件后自然产生内容。</small></div>`;
        if (active === 'overview') {
            const world = state.world || {};
            const facts = (world.facts || []).length ? `<div class="wsm-world-facts"><b>${icon('note')}<span>已有安排与事实</span></b>${(world.facts || []).map((fact) => `<span>${escape(fact)}</span>`).join('')}</div>` : '';
            return `<section class="wsm-world-summary"><div class="wsm-world-fields">
                <div><span>${icon('clock')}</span><small>当前时间</small><b>${escape(world.time?.display || '未设定')}</b></div>
                <div><span>${icon('pin')}</span><small>当前位置</small><b>${escape(world.location?.current || '未设定')}</b></div>
                <div><span>${icon('weather')}</span><small>天气</small><b>${escape(world.location?.weather || '未设定')}</b></div>
                <div><span>${icon('home')}</span><small>现场状态</small><b>${escape(world.location?.environment || '未设定')}</b></div>
            </div>${facts}</section>`;
        }
        if (active === 'map') {
            const mapState = state.map || {};
            const locations = mapState.locations || [];
            const byId = new Map(locations.map((item) => [item.id, item]));
            const current = byId.get(mapState.currentLocationId);
            const locationCards = locations.map((item) => `<article class="wsm-map-location ${item.id === mapState.currentLocationId ? 'active' : ''}"><span>${icon(item.id === mapState.currentLocationId ? 'pin' : 'map')}</span><div><small>${escape(item.area || '区域未明')}</small><b>${escape(item.name || item.id || '未命名地点')}</b>${item.description ? `<p>${escape(item.description)}</p>` : ''}</div><em>${escape(mapStatusLabels[item.status] || item.status || '已知')}</em></article>`).join('');
            const routes = (mapState.routes || []).map((route) => `<div class="wsm-map-route ${route.status === 'blocked' ? 'blocked' : ''}"><b>${escape(byId.get(route.from)?.name || route.from || '?')}</b><span>→</span><b>${escape(byId.get(route.to)?.name || route.to || '?')}</b><small>${escape(route.description || mapStatusLabels[route.status] || '可通行')}</small></div>`).join('');
            return `<section class="wsm-map-panel"><header><span>${icon('pin')}</span><div><small>当前位置</small><b>${escape(current?.name || state.world?.location?.current || '未设定')}</b></div></header><div class="wsm-map-locations">${locationCards || '<p class="wsm-muted">还没有已知地点</p>'}</div>${routes ? `<div class="wsm-map-routes"><h4>通行路线</h4>${routes}</div>` : ''}</section>`;
        }
        if (active === 'characters') return (state.characters || []).map((item) => card(resolveRef(state, item.id) || item.name || item.id, item.present ? '正在当前场景' : `位于 ${item.location || '未知地点'}`, [labeled('当前状态', item.status), labeled('姿势与朝向', item.pose), labeled('衣物状态', item.clothing), labeled('手持物', item.heldItems), labeled('伤势', item.injuries), labeled('资源', item.resources), labeled('正在做', item.currentAction), labeled('当前目标', item.goals), labeled('相关事务', item.tasks), labeled('备注', item.notes)].join(''), { icon: 'user', badge: item.present ? '在场' : '离场' })).join('') || empty('人物');
        if (active === 'activities') {
            const groups = (state.npcActivities || []).reduce((result, item) => { (result[item.characterId || 'unknown'] ||= []).push(item); return result; }, {});
            return Object.entries(groups).map(([characterId, entries]) => {
                const recent = entries.slice(-5).reverse();
                return card(resolveRef(state, characterId), recent[0]?.action || '暂无活动', `<div class="wsm-activity-trail">${recent.map((item, index) => `<div><time>${index + 1}</time><span>${icon('pin')}<small>${escape(item.location || '地点未明')}</small><b>${escape(item.action || '活动未记录')}</b></span></div>`).join('')}</div>`, { icon: 'process' });
            }).join('') || empty('NPC活动轨迹');
        }
        if (active === 'relationships') return (state.relationships || []).map((item) => card(`${resolveRef(state,item.from)} → ${resolveRef(state,item.to)}`, item.type || '人物关系', `${labeled('目前关系', item.status)}${labeled('形成依据', item.evidence)}`, { icon: 'heart' })).join('') || empty('人物关系');
        if (active === 'knowledge') return (state.knowledge || []).map((item) => card(item.information || '未命名信息', item.source ? `来源/渠道：${item.source}` : '', `${labeled('已经确认', (item.knownBy || []).map((id) => resolveRef(state,id)))}${labeled('相信但未证实', (item.believedBy || []).map((id) => resolveRef(state,id)))}${labeled('有所怀疑', (item.suspectedBy || []).map((id) => resolveRef(state,id)))}${labeled('存在误解', (item.misunderstoodBy || []).map((id) => resolveRef(state,id)))}${labeled('知情但隐瞒', (item.concealedBy || []).map((id) => resolveRef(state,id)))}${labeled('仍不知道', (item.unknownTo || []).map((id) => resolveRef(state,id)))}${labeled('证据', item.evidence)}${labeled('发现路径', item.discoveryPaths)}${labeled('成熟条件', item.maturityConditions)}`, { icon: 'lock', badge: item.certainty })).join('') || empty('知识记录');
        if (active === 'tasks') return (state.tasks || []).map((item) => card(item.title, item.deadline ? `截止：${item.deadline}` : '没有明确截止时间', `${labeled('负责人', (item.ownerIds || []).map((id) => resolveRef(state,id)))}${labeled('当前进展', item.progress)}${labeled('开始前需要', item.dependencies)}${labeled('可能影响', item.consequences)}`, { icon: 'check', badge: item.status })).join('') || empty('任务');
        if (active === 'events') return (state.events || []).map((item) => {
            const developments = (item.developments || []).filter((value) => !isSnapshotDuplicate(state, value));
            return card(item.title, item.location || '影响范围未明确', `${labeled('最新进展', developments)}${labeled('相关人物', (item.participantIds || []).map((id) => resolveRef(state,id)))}`, { icon: 'event' });
        }).join('') || empty('世界事件');
        if (active === 'triggers') return (state.triggers || []).map((item) => card(item.title, '等待自然条件', `${labeled('需要满足', item.conditions)}${labeled('满足后可能', item.effectsIfTriggered)}${labeled('目前尚缺', item.blockedReasons)}`, { icon: 'flag', badge: item.status })).join('') || empty('可触发事件');
        if (active === 'threads') return (state.threads || []).map((item) => card(item.title, item.stakes || '长期发展的事务', `${labeled('相关人物', (item.participantIds || []).map((id) => resolveRef(state,id)))}${labeled('自然下一步', item.nextNaturalStep)}${labeled('已有发展', item.history)}`, { icon: 'thread', badge: item.status })).join('') || empty('长期线程');
        if (active === 'processes') return (state.processes || []).map((item) => card(item.title, item.currentDirection || '自然延续中', `${labeled('为什么仍在继续', item.drivers)}${labeled('可能逐渐淡去', item.decayConditions)}${labeled('自然结束条件', item.resolutionConditions)}${Number(item.progress?.max) > 0 ? labeled('进度钟', `${Number(item.progress?.current || 0)}/${Number(item.progress.max)}${item.progress?.lastChangeReason ? ` · ${item.progress.lastChangeReason}` : ''}`) : ''}`, { icon: 'process', badge: item.status })).join('') || empty('世界进程');
        if (active === 'causalEffects') return (state.causalEffects || []).map((item) => card(item.result || '尚未形成局部结果', `起因：${item.cause || resolveRef(state,item.causeRef) || '未知'}`, `${labeled('寻常经过', item.steps)}${labeled('影响到谁', (item.affectedIds || []).map((id) => resolveRef(state,id)))}${labeled('尚缺条件', item.reachCondition)}${labeled('可验证依据', (item.evidenceRefs || []).map((id) => resolveRef(state,id)))}`, { icon: 'causal', badge: item.status })).join('') || empty('因果影响');
        if (active === 'timeline') return `<div class="wsm-timeline">${(state.timeline || []).slice().reverse().map((item, index) => `<article><time>${(state.timeline || []).length - index}</time><div><b>${escape(item.summary || '无摘要')}</b><small>${escape(item.location || '')}</small>${chips((item.participants || []).map((id) => resolveRef(state,id)))}</div></article>`).join('')}</div>` || empty('时间线');
        if (active === 'planner') {
            const plan = state.planner?.plan || {};
            const dice = plan.diceRound;
            const assessment = plan.sceneAssessment || {};
            const decision = plan.advanceDecision || {};
            const corePanel = `<section class="wsm-board"><h4>${icon('brain')}<span>四模块调度</span></h4>
                <div class="wsm-board-item"><b>场景：${escape(assessment.status || '未判断')}</b><small>${assessment.shouldAdvance === true ? '需要推进' : '允许保持'} · 强度 ${escape(assessment.intensity || 'none')}</small></div>
                <div class="wsm-board-item"><b>决定：${escape(decision.mode || 'hold')}</b><small>${escape(decision.direction || decision.reason || '保持当前场景')}</small></div>
                ${(plan.actorDecisions || []).map((item) => `<div class="wsm-board-item"><b>${escape(resolveRef(state, item.characterId) || item.characterId || '未知人物')}：${item.allowed === false ? '不允许行动' : '允许行动'}</b><small>${escape(item.action || '保持当前行动')} · ${escape(item.reason || '')}</small></div>`).join('')}
                ${(plan.backgroundQueue || []).map((item) => `<div class="wsm-board-item"><b>${escape(`${item.sourceType || 'item'}:${item.sourceId || '?'}`)}</b><small>${escape(item.decision || 'carry')} · ${escape(item.reason || '')}</small></div>`).join('')}
            </section>`;
            const dicePanel = dice ? `<section class="wsm-board"><h4>${icon('event')}<span>本轮骰子推进</span></h4>
                <div class="wsm-board-item"><b>剧情强度：${escape(dice.intensity?.number || '')}/20</b><small>${escape(dice.intensity?.label || '')}，只控制变化幅度</small></div>
                <div class="wsm-board-item"><b>分析焦点：${escape(dice.analysisFocus?.label || '')}</b><small>不掷骰；信息隔离也不掷骰</small></div>
                <div class="wsm-board-item"><b>剧情方向：${escape(dice.direction?.label || '')} ${escape(dice.direction?.number || '')}/20</b><small>数字表示方向强度，不判定成败</small></div>
                <div class="wsm-board-item"><b>检定骰池</b><small>${escape((dice.checkPool || []).map((item) => item.number).join(' → ') || '无')}（必须顺序使用）</small></div>
            </section>` : '';
            return `${corePanel}${dicePanel}<div class="wsm-judgement-grid"><section><h4>${icon('clock')}<span>时间判断</span></h4><b>${escape(String(plan.timeAdvanceMinutes ?? 0))} 分钟</b></section><section><h4>${icon('check')}<span>可以自然发展</span></h4>${chips(plan.eligibleDevelopments, '<span class="wsm-muted">没有指定</span>')}</section><section><h4>${icon('ban')}<span>不应发生</span></h4>${chips(plan.forbiddenDevelopments, '<span class="wsm-muted">没有指定</span>')}</section></div>${plan.notes ? `<section class="wsm-board"><h4>后台备注</h4><div class="wsm-board-item">${escape(plan.notes)}</div></section>` : ''}`;
        }
        if (active === 'sources') {
            const info = state.runtime?.sourceSummary || {};
            const loaded = info.loadedWorldbooks || [];
            const failed = info.failedWorldbooks || [];
            const counts = info.worldbookEntryCounts || {};
            return `<div class="wsm-source-grid">
                <section class="wsm-board"><h4>基础输入</h4><div class="wsm-board-item">角色卡：${info.characterCard ? '已读取' : '未读取'}<br>Persona：${info.persona ? '已读取' : '未读取'}<br>酒馆正文：已读取 ${escape(String(info.chatMessages || 0))} / ${escape(String(info.chatTotalMessages || 0))} 条${info.chatTruncated ? '（已按设置截取）' : ''}</div></section>
                <section class="wsm-board"><h4>已读取世界书</h4>${loaded.length ? loaded.map((name) => `<div class="wsm-board-item"><b>${escape(name)}</b><small>${escape(String(counts[name] || 0))} 条启用条目</small></div>`).join('') : '<div class="wsm-board-item">没有读到任何世界书</div>'}</section>
                ${failed.length ? `<section class="wsm-board"><h4>发现但读取失败</h4>${failed.map((name) => `<div class="wsm-board-item">${escape(name)}</div>`).join('')}</section>` : ''}
                <section class="wsm-board"><h4>注入边界</h4><div class="wsm-board-item">最终注入由上述输入、已经结算的当前状态和本轮 Planner 约束生成。时间线只在面板展示，不进入正文注入。</div></section>
            </div>`;
        }
        if (active === 'worldbookEmpty') return empty('已拆解世界书条目');
        if (isWorldbookSection(active)) {
            const report = currentWorldbookReport(state);
            const delivery = report.delivery || {};
            return `<section class="wsm-injection-preview wsm-worldbook-text-module"><h4>${icon('note')}<span>拆解规则文本</span></h4><pre>${escape(formatHuman(state))}</pre></section>
                <section class="wsm-board"><h4>${icon('send')}<span>注入说明</span></h4><div class="wsm-board-item"><b>${report.routedText ? '该条目会参与逐轮相关性筛选' : '当前只有拆解缓存，尚无本轮路由结果'}</b><small>${delivery.at ? `${delivery.injected ? '最近一轮已写入正文请求' : '最近一轮未写入正文请求'} · ${delivery.fallback ? '使用缓存降级' : '使用正常路由'}` : '生成正文时只发送本轮相关规则，不会把所有拆解条目全文都注入。'}</small></div></section>`;
        }
        if (active === 'injection') return `<section class="wsm-injection-preview"><h4>${icon('send')}<span>将发送给正文模型</span></h4><pre>${escape(formatHuman(state))}</pre></section>`;
        return empty('内容');
    }
    function notify(message, type = 'info') {
        if (window.toastr?.[type]) window.toastr[type](message);
        else console[type === 'error' ? 'error' : 'info']('[WorldStateMachine]', message);
    }
    function categoryForSection(section) {
        return Object.entries(categories).find(([, item]) => item.sections.includes(section))?.[0] || 'world';
    }
    function renderNavigation() {
        const tabRoot = root.querySelector('.wsm-tabs');
        if (tabRoot) tabRoot.innerHTML = Object.entries(sectionMap)
            .filter(([id]) => id !== 'worldbookEmpty')
            .map(([id, [label]]) => `<button class="wsm-tab" data-tab="${escape(id)}">${escape(label)}</button>`).join('');
        root.querySelectorAll('.wsm-category-button').forEach((button) => button.classList.toggle('active', button.dataset.categorySelect === activeCategory));
        root.querySelectorAll('.wsm-tab').forEach((button) => {
            button.hidden = !categories[activeCategory].sections.includes(button.dataset.tab);
            button.classList.toggle('active', button.dataset.tab === active);
        });
    }
    function renderSettingsTabs() {
        root.querySelectorAll('[data-settings-tab]').forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === activeSettingsTab));
        root.querySelectorAll('[data-settings-section]').forEach((section) => { section.hidden = section.dataset.settingsSection !== activeSettingsTab; });
        const footer = $('#wsm-settings-modal footer');
        if (footer) footer.hidden = activeSettingsTab === 'history';
    }
    function renderInjectionModuleSettings(settings) {
        const modules = settings.injectionModules || WSM.Defaults.INJECTION_MODULES;
        $('#wsm-injection-module-list').innerHTML = Object.entries(categories).map(([categoryId, category]) => {
            const rows = Object.entries(WSM.Defaults.INJECTION_MODULES).filter(([, module]) => module.category === categoryId).map(([id, defaultModule]) => {
                const config = Object.assign({}, defaultModule, modules[id] || {});
                return `<label class="wsm-injection-row"><input type="checkbox" data-module-enabled="${id}" ${config.enabled !== false ? 'checked' : ''}><span>${escape(config.label)}</span></label>`;
            }).join('');
            return `<details class="wsm-injection-group" open><summary>${icon(category.icon)}<span>${category.label}类</span></summary>${rows}</details>`;
        }).join('');
    }
    function renderModulePromptSettings(settings) {
        const prompts = Object.assign({}, WSM.Defaults.MODULE_PROMPTS, settings.modulePrompts || {});
        $('#wsm-module-prompt-list').innerHTML = Object.entries(promptGroups).map(([categoryId, moduleIds]) => {
            const fields = moduleIds.map((id) => `<label class="wsm-module-prompt"><b>${escape(promptLabels[id] || id)}</b><textarea data-module-prompt="${id}" rows="3">${escape(prompts[id] || '')}</textarea></label>`).join('');
            return `<details class="wsm-prompt-group" ${categoryId === 'world' ? 'open' : ''}><summary>${icon(categories[categoryId].icon)}<span>${categories[categoryId].label}模块</span></summary><div>${fields}</div></details>`;
        }).join('');
    }
    async function renderWorldbookCompilerSettings(settings = WSM.Settings.get(), force = false) {
        const config = WSM.WorldbookCompiler.normalizeConfig(settings.worldbookCompiler);
        $('#wsm-worldbook-compiler-enabled').checked = config.enabled;
        $('#wsm-worldbook-compiler-budget').value = config.budget;
        $('#wsm-worldbook-compiler-context').value = config.contextMessages;
        $('#wsm-worldbook-compiler-fail-closed').checked = config.failClosed;
        const list = $('#wsm-worldbook-compiler-list');
        const status = WSM.WorldbookCompiler.getLastStatus();
        $('#wsm-worldbook-compiler-status').textContent = status.message || '尚未运行';
        list.innerHTML = '<div class="wsm-board-item">正在读取当前已启用世界书…</div>';
        try {
            if (force || !worldbookEntriesCache.length) worldbookEntriesCache = await WSM.Context.listWorldbookEntries();
            const selected = new Set(config.entryKeys);
            const groups = worldbookEntriesCache.reduce((map, entry) => {
                (map[entry.bookName] ||= []).push(entry);
                return map;
            }, {});
            list.innerHTML = Object.entries(groups).map(([bookName, entries]) => `<details class="wsm-injection-group" open>
                <summary>${icon('note')}<span>${escape(bookName)}（${entries.length} 条）</span></summary>
                ${entries.map((entry) => `<label class="wsm-worldbook-entry-row ${selected.has(entry.key) ? 'active' : ''}"><input type="checkbox" data-worldbook-entry-key value="${escape(entry.key)}" ${selected.has(entry.key) ? 'checked' : ''}><span><b>${escape(entry.comment || entry.keys?.join('、') || `条目 ${entry.id}`)}</b><small>${escape(String(entry.content || '').slice(0, 140))}</small></span></label>`).join('')}
            </details>`).join('') || '<div class="wsm-board-item">当前没有可读取的已启用世界书。请先在酒馆中启用世界书，再点“刷新条目”。</div>';
        } catch (error) {
            list.innerHTML = `<div class="wsm-board-item">读取失败：${escape(error.message)}</div>`;
        }
    }
    function historyHtml() {
        const items = WSM.Storage.history();
        const latest = items[0];
        return `<section class="wsm-rollback-panel"><b>${icon('history')}<span>回滚上一轮生成结果</span></b><p>恢复到上一轮正文生成前的世界状态。后台最多保留最近 10 轮，发送给 AI 时只使用当前最新状态。</p>${latest ? `<small>可回滚：${new Date(latest.at).toLocaleString()} · 当前保留 ${items.length}/10 轮</small><button data-action="rollback-previous">回滚上一轮</button>` : '<small>还没有可回滚的生成结果。</small>'}</section>`;
    }
    function modalHtml() {
        const tabs = Object.entries(sectionMap).map(([id, [label]]) => `<button class="wsm-tab" data-tab="${id}">${label}</button>`).join('');
        const categoryButtons = Object.entries(categories).map(([id, item]) => `<button class="wsm-category-button" data-category-select="${id}"><span>${icon(item.icon)}</span><b>${item.label}</b></button>`).join('');
        return `<div id="wsm-modal" class="wsm-modal" hidden>
            <div class="wsm-shell">
                <header class="wsm-header"><div><b>WORLD ENGINE</b><span id="wsm-status">未初始化</span></div><div class="wsm-actions">
                    <button data-action="initialize">初始化 / 重建</button><button data-action="settings">设置</button><button data-action="history">回滚上一轮</button><button class="wsm-icon-button" data-action="close" aria-label="关闭">${icon('close')}</button>
                </div></header>
                <nav class="wsm-category-bar">${categoryButtons}</nav>
                <div class="wsm-body"><nav class="wsm-tabs">${tabs}</nav><main class="wsm-main">
                    <div id="wsm-section-title"></div><div class="wsm-view-toolbar"><button data-action="toggle-edit">${icon('edit')}<span>编辑当前栏目</span></button></div>
                    <div id="wsm-game-view"></div><textarea id="wsm-editor" spellcheck="false" hidden></textarea>
                    <div class="wsm-editor-actions" hidden><button data-action="save-section">保存修改</button><button data-action="reload">放弃修改</button></div>
                </main></div>
            </div></div>
            <div id="wsm-settings-modal" class="wsm-submodal" hidden><div class="wsm-dialog"><header><b>世界状态机设置</b><button class="wsm-icon-button" data-action="close-settings" aria-label="关闭">${icon('close')}</button></header>
                <nav class="wsm-settings-tabs"><button data-settings-tab="api">${icon('plug')}<span>API</span></button><button data-settings-tab="dice">${icon('event')}<span>骰子</span></button><button data-settings-tab="worldbook">${icon('note')}<span>拆解世界书</span></button><button data-settings-tab="injection">${icon('send')}<span>注入模块</span></button><button data-settings-tab="prompts">${icon('brain')}<span>内置提示词</span></button><button data-settings-tab="history">${icon('history')}<span>上一轮回滚</span></button></nav>
                <section class="wsm-settings-section" data-settings-section="api">
                    <label>OpenAI 兼容 API 地址<input id="wsm-endpoint" type="text" placeholder="https://example.com/v1"></label>
                    <div class="wsm-grid"><label>模型<input id="wsm-model" type="text"></label><label>API Key<input id="wsm-key" type="password"></label><label>温度<input id="wsm-temperature" type="number" step="0.05"></label><label>最大 Tokens<input id="wsm-max-tokens" type="number"></label><label>读取最近正文条数<input id="wsm-recent-messages" type="number" min="2" max="200"></label><label>注入深度<input id="wsm-injection-depth" type="number" min="0"></label><label>注入最大字符<input id="wsm-injection-max" type="number" min="500"></label></div>
                    <p class="wsm-settings-help">Planner 会直接读取酒馆当前聊天的 user/assistant 正文；初始化或重建时读取完整聊天，普通轮次读取这里设置的最近条数。</p>
                    <label class="wsm-check"><input id="wsm-enabled" type="checkbox">启用自动状态机</label>
                    <label class="wsm-check"><input id="wsm-block-on-planner-error" type="checkbox">Planner失败时严格阻止正文生成</label>
                </section>
                <section class="wsm-settings-section" data-settings-section="dice">
                    <label class="wsm-check"><input id="wsm-dice-enabled" type="checkbox">启用骰子推进系统</label>
                    <p class="wsm-settings-help">默认关闭。启用后，程序每轮预先生成剧情强度、分析焦点、剧情方向和 1–4 枚顺序检定骰。关闭时不生成骰子，也不向 Planner 或正文模型发送骰子规则。</p>
                    <section class="wsm-rollback-panel"><b>${icon('check')}<span>什么时候检定</span></b><p>只有结果同时具备不确定性、现实阻力和有意义的成败后果时才消耗检定骰。日常必然行为、无压力过渡、显而易见的信息、普通对话和一般思考不检定。</p><small>1=大失败，2–10=失败，11–19=成功，20=大成功。</small></section>
                </section>
                <section class="wsm-settings-section" data-settings-section="worldbook">
                    <p class="wsm-settings-help">只处理下方勾选的条目：首次或原文变化时调用当前 API 拆解并缓存；每轮根据实际正文路由相关规则。勾选条目的原文会从 Planner 与正文模型请求中删除，只发送本轮精简结果。</p>
                    <label class="wsm-check"><input id="wsm-worldbook-compiler-enabled" type="checkbox">启用拆解世界书</label>
                    <div class="wsm-grid"><label>每轮精简字数<input id="wsm-worldbook-compiler-budget" type="number" min="120" max="2000"></label><label>用于匹配的正文条数<input id="wsm-worldbook-compiler-context" type="number" min="2" max="30"></label></div>
                    <label class="wsm-check"><input id="wsm-worldbook-compiler-fail-closed" type="checkbox" checked disabled>无法确认原文已安全处理时，固定阻止正文请求</label>
                    <div class="wsm-worldbook-compiler-tools"><button type="button" data-action="refresh-worldbook-entries">刷新条目</button><button type="button" data-action="compile-worldbook-entries">立即拆解已勾选条目</button><button type="button" data-action="clear-worldbook-cache">清空拆解缓存</button><small id="wsm-worldbook-compiler-status">尚未运行</small></div>
                    <div id="wsm-worldbook-compiler-list"></div>
                </section>
                <section class="wsm-settings-section" data-settings-section="injection"><p class="wsm-settings-help">勾选需要发送给正文模型的状态模块。</p><div id="wsm-injection-module-list"></div></section>
                <section class="wsm-settings-section" data-settings-section="prompts">
                    <p class="wsm-settings-help">总规则控制整体流程；模块规则会发送给 Planner 和结算器。已勾选且非空的模块还会把自己的模块规则连同状态数据一起注入正文模型。</p>
                    <details class="wsm-prompt-group"><summary>${icon('brain')}<span>全局总规则</span></summary><div>
                        <label class="wsm-core-prompt"><b>世界推演总规则</b><textarea id="wsm-planner-prompt"></textarea></label>
                        <label class="wsm-core-prompt"><b>正文事实结算总规则</b><textarea id="wsm-reconciler-prompt"></textarea></label>
                    </div></details>
                    <div id="wsm-module-prompt-list"></div>
                </section>
                <section class="wsm-settings-section" data-settings-section="history"><div id="wsm-settings-history-list"></div></section>
                <footer><button data-action="reset-prompts">恢复新版默认规则</button><button data-action="test-api">测试连接</button><button data-action="save-settings">保存</button></footer>
            </div></div>
            <div id="wsm-history-modal" class="wsm-submodal" hidden><div class="wsm-dialog wsm-history"><header><b>版本快照</b><button class="wsm-icon-button" data-action="close-history" aria-label="关闭">${icon('close')}</button></header><div id="wsm-history-list"></div></div></div>`;
    }
    function render() {
        const state = WSM.Storage.load();
        syncWorldbookSections(state);
        const [title] = sectionMap[active] || sectionMap.worldbookEmpty;
        $('#wsm-status').textContent = state.initialized ? `REV ${state.revision} · ${state.world?.time?.display || '时间未定'}` : '等待初始化';
        $('#wsm-section-title').innerHTML = `<h3>${escape(title)}</h3><small>${editMode ? '使用简单中文修改；保存时会自动转换为内部状态。' : '点击卡片可以展开或收起详情。技术字段已自动隐藏或转换成人类可读内容。'}</small>`;
        $('#wsm-game-view').innerHTML = renderGameView(state);
        if (!editMode && sectionHelp[active]) $('#wsm-section-title small').textContent = sectionHelp[active];
        $('#wsm-game-view').hidden = editMode;
        $('#wsm-editor').value = formatHuman(state);
        $('#wsm-editor').hidden = !editMode;
        $('.wsm-editor-actions').hidden = !editMode;
        const toolbar = $('.wsm-view-toolbar');
        const editButton = toolbar?.querySelector('[data-action="toggle-edit"]');
        const worldbookModule = isWorldbookSection(active);
        toolbar.hidden = editMode || active === 'sources' || active === 'worldbookEmpty';
        editButton?.classList.toggle('wsm-pencil-only', worldbookModule);
        if (editButton) {
            editButton.title = worldbookModule ? '修改本条拆解规则' : '编辑当前栏目';
            editButton.setAttribute('aria-label', editButton.title);
        }
        renderNavigation();
    }
    function open() { $('#wsm-modal').hidden = false; render(); }
    function close() { $('#wsm-modal').hidden = true; }
    async function saveSection() {
        const state = WSM.Storage.load();
        const raw = $('#wsm-editor').value;
        try {
            if (isWorldbookSection(active)) {
                const entry = currentWorldbookReport(state).entries?.find((item) => worldbookSectionId(item.key) === active);
                if (!entry?.key) throw new Error('找不到当前拆解条目');
                WSM.WorldbookCompiler.updateCompiledEntry(entry.key, parseWorldbookText(raw));
                editMode = false;
                notify('拆解规则已保存；下一轮会重新筛选并注入', 'success');
                render();
                return;
            }
            parseHuman(raw, state);
            await WSM.Storage.save(state, `manual:${active}`, { snapshot: false });
            editMode = false;
            notify('状态已保存', 'success');
            render();
        } catch (error) { notify(`保存失败：${error.message}`, 'error'); }
    }
    function fillSettings(tabName = 'api') {
        const s = WSM.Settings.get();
        activeSettingsTab = tabName;
        $('#wsm-endpoint').value = s.endpoint || '';
        $('#wsm-model').value = s.model || '';
        $('#wsm-key').value = s.apiKey || '';
        $('#wsm-temperature').value = s.temperature ?? 0.15;
        $('#wsm-max-tokens').value = s.maxTokens || 5000;
        $('#wsm-recent-messages').value = s.recentMessages || 12;
        $('#wsm-injection-depth').value = s.injectionDepth || 0;
        $('#wsm-injection-max').value = s.injectionMaxChars || 3500;
        $('#wsm-enabled').checked = s.enabled !== false;
        $('#wsm-block-on-planner-error').checked = s.blockOnPlannerError === true;
        $('#wsm-dice-enabled').checked = s.diceEnabled === true;
        $('#wsm-planner-prompt').value = s.plannerPrompt || '';
        $('#wsm-reconciler-prompt').value = s.reconcilerPrompt || '';
        renderInjectionModuleSettings(s);
        renderModulePromptSettings(s);
        void renderWorldbookCompilerSettings(s);
        $('#wsm-settings-history-list').innerHTML = historyHtml();
        renderSettingsTabs();
        $('#wsm-settings-modal').hidden = false;
    }
    async function saveSettings(closeAfter = true) {
        const current = WSM.Settings.get();
        const injectionModules = WSM.Storage.clone(current.injectionModules || WSM.Defaults.INJECTION_MODULES);
        root.querySelectorAll('[data-module-enabled]').forEach((input) => { injectionModules[input.dataset.moduleEnabled].enabled = input.checked; });
        const modulePrompts = Object.assign({}, current.modulePrompts || WSM.Defaults.MODULE_PROMPTS);
        root.querySelectorAll('[data-module-prompt]').forEach((input) => { modulePrompts[input.dataset.modulePrompt] = input.value.trim(); });
        const compilerChoices = Array.from(root.querySelectorAll('[data-worldbook-entry-key]'));
        const worldbookCompiler = WSM.WorldbookCompiler.normalizeConfig({
            enabled: $('#wsm-worldbook-compiler-enabled').checked,
            entryKeys: compilerChoices.length ? compilerChoices.filter((input) => input.checked).map((input) => input.value) : current.worldbookCompiler?.entryKeys,
            budget: Number($('#wsm-worldbook-compiler-budget').value || 500),
            contextMessages: Number($('#wsm-worldbook-compiler-context').value || 8),
            failClosed: $('#wsm-worldbook-compiler-fail-closed').checked,
        });
        WSM.Settings.update({
            endpoint: $('#wsm-endpoint').value.trim(), model: $('#wsm-model').value.trim(), apiKey: $('#wsm-key').value.trim(),
            temperature: Number($('#wsm-temperature').value), maxTokens: Number($('#wsm-max-tokens').value), enabled: $('#wsm-enabled').checked,
            blockOnPlannerError: $('#wsm-block-on-planner-error').checked,
            diceEnabled: $('#wsm-dice-enabled').checked,
            recentMessages: Math.max(2, Number($('#wsm-recent-messages').value || 12)),
            injectionDepth: Number($('#wsm-injection-depth').value || 0), injectionMaxChars: Number($('#wsm-injection-max').value || 3500), injectionModules, modulePrompts,
            plannerPrompt: $('#wsm-planner-prompt').value, reconcilerPrompt: $('#wsm-reconciler-prompt').value, worldbookCompiler,
        });
        const state = WSM.Storage.load();
        state.planner.injection = WSM.Injection.compose(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
        await WSM.Storage.save(state, 'injection-settings', { snapshot: false });
        if (closeAfter) $('#wsm-settings-modal').hidden = true;
        notify('设置已保存', 'success');
    }
    function showHistory() {
        $('#wsm-history-list').innerHTML = historyHtml();
        $('#wsm-history-modal').hidden = false;
    }
    async function handleAction(action) {
        if (action === 'close') close();
        if (action === 'settings') fillSettings();
        if (action === 'close-settings') $('#wsm-settings-modal').hidden = true;
        if (action === 'save-settings') await saveSettings();
        if (action === 'reset-prompts') {
            $('#wsm-planner-prompt').value = WSM.Defaults.PLANNER_PROMPT;
            $('#wsm-reconciler-prompt').value = WSM.Defaults.RECONCILER_PROMPT;
            root.querySelectorAll('[data-module-prompt]').forEach((input) => { input.value = WSM.Defaults.MODULE_PROMPTS[input.dataset.modulePrompt] || ''; });
            notify('已载入新版生态叙事与因果规则，点击保存后生效');
        }
        if (action === 'history') fillSettings('history');
        if (action === 'rollback-previous') {
            if (!window.confirm('确定回滚上一轮生成结果？这不会删除 SillyTavern 中的聊天消息。')) return;
            await WSM.Storage.rollbackPreviousGeneration();
            render();
            fillSettings('history');
            notify('已回滚上一轮生成结果', 'success');
        }
        if (action === 'close-history') $('#wsm-history-modal').hidden = true;
        if (action === 'toggle-edit') { editMode = true; render(); }
        if (action === 'reload') { editMode = false; render(); }
        if (action === 'save-section') await saveSection();
        if (action === 'initialize') {
            notify('正在读取设定并建立世界状态…');
            await WSM.Engine.plan({ force: true, initialize: true });
            render();
            notify('初始化完成', 'success');
        }
        if (action === 'test-api') {
            await saveSettings(false);
            try { await WSM.Api.test(); notify('API 连接成功', 'success'); }
            catch (error) { notify(`API 测试失败：${error.message}`, 'error'); }
        }
        if (action === 'refresh-worldbook-entries') {
            await renderWorldbookCompilerSettings(WSM.Settings.get(), true);
            notify('世界书条目已刷新', 'success');
        }
        if (action === 'compile-worldbook-entries') {
            await saveSettings(false);
            try {
                const result = await WSM.WorldbookCompiler.compileConfig(WSM.Settings.get().worldbookCompiler, { force: true });
                await renderWorldbookCompilerSettings(WSM.Settings.get());
                notify(`已拆解 ${result.count} 条世界书`, 'success');
            } catch (error) { notify(`拆解失败：${error.message}`, 'error'); }
        }
        if (action === 'clear-worldbook-cache') {
            WSM.WorldbookCompiler.clearCache();
            await renderWorldbookCompilerSettings(WSM.Settings.get());
            notify('拆解缓存已清空', 'success');
        }
    }
    function mountButton() {
        if (document.getElementById('wsm-launcher')) return;
        const button = document.createElement('button');
        button.id = 'wsm-launcher';
        button.title = '打开芝芝状态机系统';
        button.innerHTML = `<span>${icon('cube')}</span><b>WORLD</b>`;
        button.addEventListener('click', open);
        document.body.appendChild(button);
    }
    function mountWandMenuItem() {
        if (document.getElementById('wsm-wand-menu-item')) return true;
        const menu = document.getElementById('extensionsMenu');
        if (!(menu instanceof HTMLElement)) return false;

        const container = document.createElement('div');
        container.id = 'wsm-wand-container';
        container.className = 'extension_container interactable';
        container.tabIndex = 0;

        const item = document.createElement('a');
        item.id = 'wsm-wand-menu-item';
        item.className = 'list-group-item';
        item.href = '#';
        item.title = '打开芝芝状态机系统';
        item.innerHTML = '<i class="fa-solid fa-cubes-stacked"></i><span>芝芝状态机系统</span>';
        item.addEventListener('click', (event) => {
            event.preventDefault();
            open();
            menu.style.display = 'none';
        });
        container.appendChild(item);
        menu.appendChild(container);
        return true;
    }
    function mountWandMenuItemWhenReady() {
        if (mountWandMenuItem()) return;
        const timer = window.setInterval(() => {
            if (mountWandMenuItem()) window.clearInterval(timer);
        }, 500);
    }
    function mount() {
        if (document.getElementById('wsm-root')) return;
        root = document.createElement('div');
        root.id = 'wsm-root';
        root.innerHTML = modalHtml();
        root.addEventListener('click', async (event) => {
            const category = event.target.closest('[data-category-select]')?.dataset.categorySelect;
            if (category) {
                activeCategory = category;
                if (!categories[category].sections.includes(active)) active = categories[category].sections[0] || (category === 'worldbook' ? 'worldbookEmpty' : 'overview');
                editMode = false;
                render();
                return;
            }
            const settingsTab = event.target.closest('[data-settings-tab]')?.dataset.settingsTab;
            if (settingsTab) { activeSettingsTab = settingsTab; renderSettingsTabs(); if (settingsTab === 'worldbook') await renderWorldbookCompilerSettings(); return; }
            const tab = event.target.closest('[data-tab]');
            if (tab) { active = tab.dataset.tab; activeCategory = categoryForSection(active); editMode = false; render(); return; }
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (action) { await handleAction(action); return; }
        });
        document.body.appendChild(root);
        mountButton();
        mountWandMenuItemWhenReady();
        window.addEventListener('wsm-state-changed', () => { if (!$('#wsm-modal')?.hidden) render(); });
    }
    WSM.UI = { mount, open, render };
})();
