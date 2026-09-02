(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const sectionMap = {
        overview: ['世界状态', (s) => ({ world: s.world, lockedPaths: s.lockedPaths || [] })],
        worldRules: ['硬规则 / 世界秩序', (s) => s.worldRules],
        factAnchors: ['事实锚点', (s) => s.factAnchors],
        resourceConstraints: ['资源 / 约束', (s) => s.resourceConstraints],
        organizations: ['组织 / 势力', (s) => s.organizations],
        map: ['场景地图', (s) => s.map],
        characters: ['人物概况', (s) => s.characters],
        activities: ['NPC活动轨迹', (s) => s.npcActivities],
        relationships: ['人物关系', (s) => s.relationships],
        knowledge: ['知识 / 秘密', (s) => s.knowledge],
        schedules: ['已有安排', (s) => s.schedules],
        tasks: ['当前任务', (s) => s.tasks],
        events: ['世界事件', (s) => s.events],
        triggers: ['可触发事件', (s) => s.triggers],
        threads: ['长期线程', (s) => s.threads],
        progression: ['剧情推进', (s) => s.progression],
        processes: ['世界进程', (s) => s.processes],
        causalEffects: ['因果影响', (s) => s.causalEffects],
        timeline: ['时间线', (s) => s.timeline],
        planner: ['本轮后台判断', (s) => s.planner],
        injection: ['最终注入', (s) => s.runtime?.finalInjectionOverride || s.planner?.injection || ''],
        sources: ['输入来源', (s) => s.runtime?.sourceSummary || {}],
        worldbookEmpty: ['本轮规则命中', () => ({})],
    };
    let root;
    let active = 'overview';
    let editMode = false;
    let activeCategory = 'world';
    let activeSettingsTab = 'api';
    let apiProfilesDraft = [];
    let activeApiProfileId = '';
    const apiModelsByProfile = new Map();
    let worldbookEntriesCache = [];
    let wandMenuClickBound = false;
    let externalWorldbookButtonBusy = false;
    let choiceSending = false;
    let activeMapMode = 'known';
    let activeMapSearch = '';
    const dynamicWorldbookSections = new Set();
    const categories = {
        map: { icon: 'map', label: '场景地图', sections: ['map'] },
        world: { icon: 'home', label: '世界', sections: ['overview','worldRules','resourceConstraints','organizations','factAnchors','events','processes','causalEffects'] },
        people: { icon: 'people', label: '人物', sections: ['characters','activities','relationships','knowledge'] },
        affairs: { icon: 'clipboard', label: '事务', sections: ['schedules','tasks','triggers','threads','progression','timeline'] },
        worldbook: { icon: 'note', label: '本轮规则命中', sections: [] },
        system: { icon: 'sliders', label: '系统', sections: ['sources','planner','injection'] },
    };
    const promptGroups = {
        world: ['world','worldRules','resourceConstraints','organizations','factAnchors','ambient','map','events','processes','causalEffects'],
        people: ['characters','npcActivities','relationships','knowledge'],
        affairs: ['schedules','tasks','triggers','threads','progression','timeline'],
        system: ['pacing','planner'],
    };
    const promptLabels = {
        world: '世界状态', worldRules: '硬规则 / 世界秩序', factAnchors: '事实锚点', resourceConstraints: '资源 / 约束', organizations: '组织 / 势力', ambient: '环境与路人反应', map: '场景地图', characters: '人物概况', npcActivities: 'NPC活动轨迹', relationships: '人物关系', knowledge: '知识与秘密',
        schedules: '已有安排', tasks: '当前任务', events: '世界事件', triggers: '可触发事件', threads: '长期线程', progression: '剧情推进', processes: '世界进程',
        causalEffects: '因果影响', timeline: '时间线', pacing: '剧情节奏', planner: '本轮后台判断', injection: '最终注入',
    };
    const sectionHelp = {
        overview: '只显示此刻的时间、季节、地点、天气、环境和当前正在生效的客观状态。',
        worldRules: '保存世界底层规则、身份与权力秩序、权限、条件、例外和冲突优先级；其他模块只引用规则ID。',
        factAnchors: '只保存正文已经永久确立、遗忘会造成逻辑错误的最终客观结果；与当前无关时不会常驻发送给正文 AI。',
        resourceConstraints: '只显示当前真正会限制行动的资金、权限、人手、关键持有物与地点封锁；不是完整资产清单。',
        organizations: '维护组织职责、负责人、管辖范围、可调用资源与当前处境，为政治世界提供合理分工。',
        map: '空间索引按世界、城市、区域、建筑和内部空间逐层显示；地图与列表都只在本地展示，不向正文 AI 发送。',
        activities: '每个核心人物或活跃NPC只保留一条当前活动快照；背景NPC不长期记录。',
        schedules: '只显示已经明确约定但尚未发生的未来安排；改变、取消或完成后更新原条目。',
        events: '显示正在发生或已经发生的重要节点；节点只回答“发生了什么”。',
        progression: '显示当前这一段剧情正在向哪里移动；只保留最新版本，不预写结果，也不替玩家决定。',
        processes: '显示仍在持续演变的世界级变化线，以及它为何推进、停滞或结束。',
        causalEffects: '显示既存事件或事实留下、目前仍会影响后续世界的后果。',
        timeline: '只记录已经真正发生的事，每件事只记一次。',
        planner: '只显示本轮后台对“可以发生”与“不应发生”的判断。',
        injection: '显示当前真正会发送给正文模型的全部注入；设置中未勾选的模块不会出现。小铅笔修改会覆盖下一次正文生成，结算后恢复自动合成。',
        sources: '显示最近一次推演实际读到的角色卡、Persona、酒馆正文和世界书；未列出的世界书没有进入 Planner。',
        worldbookEmpty: '本轮没有可显示的规则命中。若来源应当存在但编译失败，将明确显示 RULE_COMPILE_FAILED。',
    };

    const worldbookSectionId = (key) => `worldbookEntry:${encodeURIComponent(String(key || ''))}`;
    const isWorldbookSection = (id) => String(id || '').startsWith('worldbookEntry:');
    function currentWorldbookReport(state) {
        const persisted = state?.runtime?.worldbookInjection || null;
        return WSM.WorldbookCompiler?.getReport?.(persisted) || persisted || { entries: [] };
    }
    function finalInjectionText(state) {
        return WSM.Injection.preview(
            state,
            state.planner?.plan || {},
            state.planner?.moduleInjections || {},
        ) || '本轮没有需要额外注入的内容。';
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
        worldRules: { title: '硬规则', identity: 'statement', fields: [['statement','规则正文'],['scope','适用范围'],['conditions','条件'],['exceptions','例外'],['precedence','优先级'],['delivery','投递方式']] },
        factAnchors: { title: '事实锚点', identity: 'fact', fields: [['fact','事实'],['scope','影响范围']] },
        resourceConstraints: { title: '资源或约束', identity: 'condition', fields: [['subjectId','约束对象'],['kind','类型'],['condition','当前硬条件'],['status','状态'],['amount','数量或额度'],['scope','适用范围'],['consequence','不满足时']] },
        organizations: { title: '组织或势力', identity: 'name', fields: [['name','名称'],['kind','性质'],['leaderIds','负责人'],['jurisdiction','管辖范围'],['goals','当前目标'],['resources','可调用资源'],['situation','当前处境'],['relationshipRefs','组织关系引用']] },
        characters: { title: '人物', identity: 'name', fields: [['maintenanceLevel','维护等级'],['identity','身份'],['location','位置'],['present','在场'],['situation','重要处境'],['persistentConditions','持续状态'],['importantItems','重要物品'],['notes','连续性摘要']] },
        activities: { title: '活动', identity: 'action', stateKey: 'npcActivities', fields: [['characterId','人物'],['movement','移动过程'],['location','活动地点'],['action','当前活动'],['currentRole','当前作用']] },
        relationships: { title: '关系', identity: 'identityRelation', fields: [['from','主体'],['to','对象'],['identityRelation','身份关系'],['currentPerception','当前关系认知'],['formationBasis','形成依据'],['boundaries','阶段边界'],['evidence','依据']] },
        knowledge: { title: '信息', identity: 'information', fields: [['information','内容'],['holderIds','持有人'],['cognitiveStatus','认知状态'],['disclosure','公开状态'],['userVisible','玩家可见'],['source','来源/渠道'],['reliability','可靠性'],['evidence','证据'],['discoveryPaths','发现路径'],['maturityConditions','成熟条件']] },
        schedules: { title: '安排', identity: 'title', fields: [['title','事项'],['participantIds','参与者'],['expectedTime','预计时间'],['preconditions','前置条件'],['status','状态'],['source','来源'],['completionResult','完成结果']] },
        tasks: { title: '任务', identity: 'title', fields: [['title','名称'],['ownerIds','负责人'],['progress','当前进展'],['deadline','截止时间'],['dependencies','前置条件'],['consequences','影响']] },
        events: { title: '事件', identity: 'title', fields: [['title','名称'],['status','节点状态'],['summary','发生了什么'],['outcome','直接结果'],['location','地点'],['participantIds','相关人物'],['relatedProcessIds','关联进程']] },
        triggers: { title: '可触发事件', identity: 'title', fields: [['title','名称'],['conditions','触发条件'],['effectsIfTriggered','触发后'],['blockedReasons','尚未触发原因']] },
        threads: { title: '长期事务', identity: 'title', fields: [['title','名称'],['stakes','重要性'],['participantIds','相关人物'],['nextNaturalStep','自然下一步'],['history','已有发展']] },
        processes: { title: '世界进程', identity: 'title', fields: [['title','名称'],['kind','世界级类型'],['drivers','为什么仍在继续'],['decayConditions','可能逐渐淡去'],['resolutionConditions','自然结束条件'],['progress','进度钟'],['currentDirection','目前趋势']] },
        causalEffects: { title: '因果影响', identity: 'result', fields: [['causeRef','起因引用'],['cause','已经发生的起因'],['steps','必要因果路径'],['result','仍在生效的后果'],['affectedIds','影响对象'],['status','影响状态'],['reachCondition','尚缺条件'],['decayConditions','减弱或消失条件']] },
        timeline: { title: '记录', identity: 'summary', fields: [['summary','发生的事'],['granularity','记忆粒度'],['participants','相关人物'],['location','地点'],['actualChanges','实际变化']] },
    };

    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const formatDuration = (milliseconds) => {
        const seconds = Math.max(0, Number(milliseconds || 0)) / 1000;
        if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
        return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
    };
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
    const objectFieldLabels = Object.freeze({
        time: '时间', date: '日期', location: '地点', place: '地点', participants: '相关人物', activity: '发生的事',
        action: '行动', movement: '移动', name: '名称', status: '状态', effect: '影响', recovery: '恢复情况',
        significance: '重要性', summary: '摘要', description: '说明', result: '结果', cause: '起因', currentRole: '当前作用',
    });
    function parseEmbeddedJson(value) {
        const input = String(value || '').trim();
        if (!input || !/^[\[{]/.test(input) || !/[\]}]$/.test(input)) return null;
        try { return JSON.parse(input); } catch (_error) { /* try adjacent objects */ }
        if (input.startsWith('{') && input.endsWith('}')) {
            try { return JSON.parse(`[${input.replace(/}\s*{/g, '},{')}]`); } catch (_error) { return null; }
        }
        return null;
    }
    function displayObject(value) {
        return Object.entries(value || {}).filter(([, item]) => item !== '' && item != null && (!Array.isArray(item) || item.length)).map(([key, item]) => {
            const rendered = displayValue(item);
            return rendered ? `${objectFieldLabels[key] || key}：${rendered}` : '';
        }).filter(Boolean).join('；');
    }
    function displayValue(value) {
        if (Array.isArray(value)) return value.map((item) => displayValue(item)).filter(Boolean).join('、');
        if (typeof value === 'boolean') return value ? '是' : '否';
        if (value && typeof value === 'object') return displayObject(value);
        const input = String(value ?? '').trim();
        const parsed = parseEmbeddedJson(input);
        return parsed == null ? input : displayValue(parsed);
    }
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
            if (Array.isArray(entry.facts) && entry.facts.length) return [
                `世界书：${entry.bookName || '未命名世界书'}`,
                `条目：${entry.label || entry.key || '未命名条目'}`,
                `来源哈希：${entry.sourceHash || '未记录'}`,
                `原文字符：${entry.originalChars || 0}`,
                `编译字符：${entry.compiledChars || 0}`,
                `段落覆盖：${Object.entries(entry.coverage || {}).map(([paragraph, chunks]) => `${paragraph}→${(chunks || []).join('、')}`).join('；') || '未记录'}`,
                '',
                `【统一事实目录】\n${entry.facts.map((fact) => `- ${fact.factId}｜owner=${fact.owner}｜delivery=${fact.delivery}｜${WSM.Facts?.render?.(fact) || fact.statement}`).join('\n')}`,
                '',
                `【800–1200字语义分块】\n${entry.chunks.map((chunk) => `- ${chunk.id}｜覆盖${(chunk.paragraphIds || []).join('、')}｜factIds=${(chunk.factIds || []).join('、')}｜${chunk.text}`).join('\n')}`,
            ].join('\n');
            if (Array.isArray(entry.fragments)) return [
                `世界书：${entry.bookName || '未命名世界书'}`,
                `条目：${entry.label || entry.key || '未命名条目'}`,
                '',
                group('常驻核心', entry.core),
                '',
                `【按需语义片段】\n${entry.fragments.length ? entry.fragments.map((item) => `- [${item.type || 'other'}｜触发：${(item.cues || []).join('、') || '由片段语义匹配'}] ${item.text || ''}`).join('\n') : '- （无）'}`,
            ].join('\n');
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
            `季节：${state.world?.season || '待确认'}`,
            `地点：${state.world?.location?.current || '未设定'}`,
            `天气：${state.world?.location?.weather || '未设定'}`,
            `环境：${state.world?.location?.environment || '未设定'}`,
            ...(state.world?.currentConditions || []).map((fact) => `当前客观状态：${fact}`),
        ].join('\n');
        if (active === 'map') return [
            `地图名称：${state.map?.rootLabel || '大地图'}`,
            `当前位置：${state.map?.currentLocationId || '未设定'}`,
            ...(state.map?.locations || []).map((item) => `地点：${item.id || ''}｜${item.name || ''}｜${item.type || 'other'}｜${item.parentId || ''}｜${Number(item.x ?? 50)}｜${Number(item.y ?? 50)}｜${item.status || 'known'}｜${item.description || ''}｜${item.origin || ''}｜${item.priority || 'L1'}｜${item.activity || 'WARM'}｜${Number(item.updatedRevision || 0)}`),
            ...(state.map?.routes || []).map((item) => `路线：${item.from || ''}｜${item.to || ''}｜${item.status || 'open'}｜${item.description || ''}｜${Number(item.travelMinutes || 0)}｜${item.distance || ''}`),
        ].join('\n');
        if (active === 'progression') return [
            `当前方向：${state.progression?.direction || ''}`,
            `当前变化：${state.progression?.currentMovement || ''}`,
            ...(state.progression?.nextRequiredChanges || []).map((value) => `下一阶段仍需：${value}`),
            `用户决策点：${state.progression?.blockedByDecision || ''}`,
        ].join('\n');
        if (definitions[active]) return formatCollection(state[definitions[active].stateKey || active], definitions[active]);
        if (active === 'planner') {
            const plan = state.planner?.plan || {};
            const audit = state.reasoningAudit || {};
            const dice = plan.diceRound;
            return [
                `时间推进：${plan.timeAdvanceMinutes ?? 0}分钟`,
                plan.sceneAssessment ? `场景判断：${plan.sceneAssessment.status || 'quiet'}｜需要推进=${plan.sceneAssessment.shouldAdvance === true ? '是' : '否'}｜${plan.sceneAssessment.intensity || 'none'}${(plan.sceneAssessment.evidence || []).length ? `｜${(plan.sceneAssessment.evidence || []).join('、')}` : ''}` : '',
                plan.advanceDecision ? `推进决定：${plan.advanceDecision.mode || 'hold'}｜${plan.advanceDecision.direction || '保持当前场景'}｜${plan.advanceDecision.intensity || 'none'}${plan.advanceDecision.reason ? `｜${plan.advanceDecision.reason}` : ''}` : '',
                ...(plan.actorDecisions || []).map((value) => `行动判断：${value.characterId || '?'}｜${value.allowed === false ? '不允许' : '允许'}｜${value.action || '保持当前行动'}${value.reason ? `｜${value.reason}` : ''}`),
                ...(plan.backgroundQueue || []).map((value) => `后台队列：${value.sourceType || 'item'}:${value.sourceId || '?'}｜${value.decision || 'carry'}${value.reason ? `｜${value.reason}` : ''}`),
                ...(dice ? [
                    `共享随机种：${dice.seed || ''}/100`,
                    `共享骰池：${(dice.checkPool || []).map((item) => item.number).join('、') || '无'}（按需顺序使用）`,
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
        if (active === 'injection') return finalInjectionText(state);
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
        if (/【常驻核心】/.test(input) || /【按需语义片段】/.test(input)) {
            const core = (() => {
                const match = input.match(/【常驻核心】\s*\n([\s\S]*?)(?=\n\s*【按需语义片段】|$)/);
                return match ? match[1].split(/\r?\n/).map((line) => line.replace(/^\s*[-*•]\s*/, '').trim()).filter((line) => line && line !== '（无）') : [];
            })();
            const match = input.match(/【按需语义片段】\s*\n([\s\S]*?)$/);
            const fragments = match ? match[1].split(/\r?\n/).map((line) => line.replace(/^\s*[-*•]\s*/, '').trim()).filter((line) => line && line !== '（无）').map((line) => {
                const parsed = line.match(/^\[([^｜\]]+)(?:｜触发：([^\]]*))?\]\s*(.+)$/);
                return parsed ? { type: parsed[1].trim(), cues: splitValues(parsed[2] || ''), text: parsed[3].trim() } : { type: 'other', cues: [], text: line };
            }) : [];
            return { core, fragments, triggers: [], rules: [], background: [] };
        }
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
                const arrayKeys = ['aliases','affiliationRefs','authorityRefs','knowledgeRefs','motives','currentGoals','persistentConditions','importantItems','evidence','basis','knownBy','believedBy','suspectedBy','misunderstoodBy','unknownTo','ownerIds','dependencies','locationRefs','characterRefs','ruleRefs','resourceConstraintRefs','completionConditions','completedConditions','consequences','participantIds','relatedProcessIds','relatedFactIds','sourceRefs','scope','consumers','dependencyFactIds','conditions','exceptions','bondTypes','attachments','grievances','boundaries','reconciliationConditions','effectsIfTriggered','blockedReasons','history','participants','actualChanges','drivers','decayConditions','resolutionConditions','steps','affectedIds','evidenceRefs'];
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
            if (map['时间真实性']?.length) state.world.time.truthStatus = map['时间真实性'].at(-1);
            if (map['时间依据']?.length) state.world.time.basis = splitValues(map['时间依据'].at(-1));
            if (map['时间来源']?.length) state.world.time.sourceRefs = splitValues(map['时间来源'].at(-1));
            if (map['季节']?.length) state.world.season = map['季节'].at(-1);
            state.world.seasonMeta ||= {};
            if (map['季节真实性']?.length) state.world.seasonMeta.truthStatus = map['季节真实性'].at(-1);
            if (map['季节依据']?.length) state.world.seasonMeta.basis = splitValues(map['季节依据'].at(-1));
            if (map['季节来源']?.length) state.world.seasonMeta.sourceRefs = splitValues(map['季节来源'].at(-1));
            if (map['地点']?.length) state.world.location.current = map['地点'].at(-1);
            state.world.location.currentMeta ||= {};
            if (map['地点真实性']?.length) state.world.location.currentMeta.truthStatus = map['地点真实性'].at(-1);
            if (map['地点依据']?.length) state.world.location.currentMeta.basis = splitValues(map['地点依据'].at(-1));
            if (map['地点来源']?.length) state.world.location.currentMeta.sourceRefs = splitValues(map['地点来源'].at(-1));
            if (map['环境']?.length) state.world.location.environment = map['环境'].at(-1);
            state.world.location.environmentMeta ||= {};
            if (map['环境真实性']?.length) state.world.location.environmentMeta.truthStatus = map['环境真实性'].at(-1);
            if (map['环境依据']?.length) state.world.location.environmentMeta.basis = splitValues(map['环境依据'].at(-1));
            if (map['环境来源']?.length) state.world.location.environmentMeta.sourceRefs = splitValues(map['环境来源'].at(-1));
            if (map['天气']?.length) state.world.location.weather = map['天气'].at(-1);
            state.world.location.weatherMeta ||= {};
            if (map['天气真实性']?.length) state.world.location.weatherMeta.truthStatus = map['天气真实性'].at(-1);
            if (map['天气依据']?.length) state.world.location.weatherMeta.basis = splitValues(map['天气依据'].at(-1));
            if (map['天气来源']?.length) state.world.location.weatherMeta.sourceRefs = splitValues(map['天气来源'].at(-1));
            const previousConditionDetails = Array.isArray(state.world.currentConditionDetails) ? state.world.currentConditionDetails : [];
            state.world.currentConditions = (map['当前客观状态'] || []).slice(0, 8);
            const conditionMeta = (map['状态元数据'] || []).map((value) => {
                const [condition, truthStatus, basis, sourceRefs] = String(value).split(/[|｜]/).map((item) => item.trim());
                return { value: condition, truthStatus: truthStatus || 'unknown', basis: splitValues(basis), sourceRefs: splitValues(sourceRefs) };
            });
            state.world.currentConditionDetails = state.world.currentConditions.map((value) => conditionMeta.find((item) => item.value === value) || previousConditionDetails.find((item) => item.value === value) || { value, truthStatus: 'unknown', basis: ['面板未提供来源'], sourceRefs: [] });
        } else if (active === 'map') {
            const parseParts = (value) => String(value || '').split(/[|｜]/).map((item) => item.trim());
            state.map ||= { rootLabel: '大地图', currentLocationId: '', locations: [], routes: [] };
            state.map.rootLabel = map['地图名称']?.at(-1) || state.map.rootLabel || '大地图';
            state.map.currentLocationId = map['当前位置']?.at(-1) || '';
            const previousLocations = Array.isArray(state.map.locations) ? state.map.locations : [];
            state.map.locations = (map['地点'] || []).map((value, index) => {
                const parts = parseParts(value);
                if (parts.length >= 8) {
                    const [id, name, type, parentId, x, y, status, description, origin, priority, activity, updatedRevision] = parts;
                    const old = previousLocations.find((item) => item.id === id) || previousLocations[index] || {};
                    return { ...WSM.Storage.clone(old), id: id || `location-${Date.now()}-${index}`, name: name || id || '未命名地点', type: type || 'other', parentId: parentId || '', x: Math.max(0, Math.min(100, Number(x) || 0)), y: Math.max(0, Math.min(100, Number(y) || 0)), status: status || 'known', description: description || '', origin: origin || '', priority: priority || 'L1', activity: activity || 'WARM', updatedRevision: Number(updatedRevision) || 0 };
                }
                const [id, name, area, status, description] = parts;
                return { id: id || `location-${Date.now()}-${index}`, name: name || id || '未命名地点', area: area || '', type: 'other', parentId: '', x: 50, y: 50, status: status || 'known', description: description || '', sourceRefs: [] };
            });
            state.map.routes = (map['路线'] || []).map((value) => {
                const [from, to, status, description, travelMinutes, distance] = parseParts(value);
                return { from: from || '', to: to || '', status: status || 'open', description: description || '', travelMinutes: Number(travelMinutes) || 0, distance: distance || '' };
            }).filter((item) => item.from && item.to);
        } else if (active === 'progression') {
            state.progression ||= {};
            state.progression.direction = map['当前方向']?.at(-1) || '';
            state.progression.currentMovement = map['当前变化']?.at(-1) || '';
            state.progression.nextRequiredChanges = map['下一阶段仍需'] || [];
            if (map['依据']?.length) state.progression.basedOnRefs = map['依据'];
            state.progression.blockedByDecision = map['用户决策点']?.at(-1) || '';
            if (map['真实性']?.length) state.progression.truthStatus = map['真实性'].at(-1);
            if (map['判断依据']?.length) state.progression.basis = splitValues(map['判断依据'].at(-1));
            if (map['来源引用']?.length) state.progression.sourceRefs = splitValues(map['来源引用'].at(-1));
        } else if (definitions[active]) {
            const stateKey = definitions[active].stateKey || active;
            state[stateKey] = parseCollection(raw, Array.isArray(state[stateKey]) ? state[stateKey] : [], definitions[active]);
        } else if (active === 'injection') {
            state.runtime ||= {};
            state.runtime.finalInjectionOverride = WSM.Injection.normalizeFinalOverride(raw);
            state.planner ||= {};
            state.planner.injection = state.runtime.finalInjectionOverride;
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
        developing: '正在形成', active: '仍在生效', arrived: '仍在生效', ongoing: '正在发生', occurred: '已经发生', discarded: '路径不成立', reached: '仍在生效', deferred: '尚未形成', sufficient: '因果充分', insufficient: '因果不足', confirmed: '已确认', derived: '可确定推导', system_generated: '系统生成', suspected: '暂定推测', assumed: '运行暂定', unknown: '原文未说明', not_established: '尚未建立', not_applicable: '不适用', believed: '人物相信', rumor: '传闻',
    };
    const mapStatusLabels = { known: '已知', visited: '已到访', unavailable: '暂不可达', open: '可通行', blocked: '路线受阻', unknown: '状况未知' };
    const mapTypeLabels = { world: '世界', region: '区域', country: '国家', city: '城市', district: '城区', landmark: '城市地标', residence: '建筑·住所', workplace: '建筑·工作地', building: '建筑', room: '室内空间', other: '地点' };
    const friendly = (value) => statusLabels[String(value || '').toLowerCase()] || String(value || '');
    function chips(values, empty = '') {
        const items = Array.isArray(values) ? values.filter(Boolean) : (values ? [values] : []);
        return items.length ? `<div class="wsm-chips">${items.map((item) => displayValue(item)).filter(Boolean).map((item) => `<span>${escape(friendly(item))}</span>`).join('')}</div>` : empty;
    }
    function resolveRef(state, ref) {
        const key = String(ref || '');
        const normalized = key.toLowerCase();
        if (['user','<user>'].includes(normalized)) return WSM.Context?.identityNames?.()?.user || state.identities?.user || '<USER>';
        if (['char','character','<char>'].includes(normalized)) return '相关人物';
        for (const group of ['characters','organizations','schedules','tasks','events','triggers','threads','processes','causalEffects','knowledge']) {
            const found = (state[group] || []).find((item) => String(item?.id) === key);
            if (found) return found.name || found.title || found.information || found.effect || found.potentialEffect || key;
        }
        return key;
    }
    function isSnapshotDuplicate(state, value) {
        const normalize = (item) => String(item || '').replace(/[\s，。；：:、]/g, '').toLowerCase();
        const target = normalize(value);
        const world = state.world || {};
        const snapshots = [world.time?.display, world.season, world.location?.current, world.location?.environment, world.location?.weather, ...(world.currentConditions || [])].map(normalize).filter(Boolean);
        return !!target && snapshots.some((item) => item === target || (target.length >= 12 && (item.includes(target) || target.includes(item))));
    }
    function card(title, subtitle, body, options = {}) {
        const badge = options.badge ? `<span class="wsm-card-badge">${escape(friendly(options.badge))}</span>` : '';
        return `<details class="wsm-game-card" ${options.open === false ? '' : 'open'}><summary><div class="wsm-card-icon">${icon(options.icon || 'empty')}</div><div><b>${escape(title || '未命名')}</b>${subtitle ? `<small>${escape(subtitle)}</small>` : ''}</div>${badge}<span class="wsm-expand">${icon('chevron')}</span></summary><div class="wsm-card-body">${body || '<p class="wsm-muted">暂无详细信息</p>'}</div></details>`;
    }
    function labeled(label, value) {
        if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '';
        const rendered = displayValue(value);
        if (!rendered) return '';
        return `<div class="wsm-readable-row"><span>${escape(label)}</span><div>${Array.isArray(value) ? chips(value) : escape(friendly(rendered))}</div></div>`;
    }
    function userFacingItems(state, kind) {
        const items = kind === 'task' ? (state.tasks || []) : (state.triggers || []);
        const inactive = kind === 'task' ? new Set(['done', 'failed']) : new Set(['triggered', 'expired']);
        return items.filter((item) => {
            if (inactive.has(item?.status) || item?.userVisible === false) return false;
            if (item?.userVisible === true || kind === 'trigger') return true;
            const owners = Array.isArray(item?.ownerIds) ? item.ownerIds.map(String) : [];
            return !owners.length || owners.includes('user') || owners.includes(String(state.identities?.user || ''));
        });
    }
    const intentActionLabels = {
        focus: ['关注', '提高当前关注度，不预定结果'],
        intervene: ['介入', '尝试采取行动，不保证成功'],
        investigate: ['询问 / 调查', '尝试获得信息，受知识与权限限制'],
        travel: ['前往这里', '按现实路径尝试移动，不代表已抵达'],
        inspect: ['查看地点', '查看当前可见或可获知的空间信息'],
        findPeople: ['寻找这里的人', '尝试寻找，不读取后台人物轨迹'],
        actHere: ['在这里行动', '把地点作为行动目标，不预设具体结果'],
    };
    function interactionKey(module, item) {
        if (module === 'activities') return String(item?.characterId || item?.id || '');
        if (module === 'relationships') return String(item?.id || `${item?.from || ''}>${item?.to || ''}`);
        return String(item?.id || '');
    }
    function userKnowsKnowledge(state, item) {
        const currentUserName = String(WSM.Context?.identityNames?.()?.user || state?.identities?.user || '').trim().toLowerCase();
        const userNames = new Set(['user', '<user>', currentUserName].filter(Boolean));
        if (item?.userVisible === true) return true;
        const holders = [...(item?.holderIds || []), ...(item?.knownBy || [])];
        const cognitiveStatus = String(item?.cognitiveStatus || ((item?.knownBy || []).length ? 'confirmed' : '')).toLowerCase();
        return cognitiveStatus === 'confirmed' && holders.some((id) => userNames.has(String(id || '').trim().toLowerCase()));
    }
    function intentPanel(module, item, actions = ['focus','intervene','investigate'], level = 'strong') {
        if (!['tasks', 'triggers'].includes(module) || item?.placeholder === true) return '';
        const id = interactionKey(module, item);
        if (!id || !actions.length) return '';
        const heading = level === 'strong' ? '玩家意图' : '查询型交互';
        return `<section class="wsm-choice-panel wsm-intent-panel"><header><b>${icon('choice')}<span>${heading}</span></b><small>只发送尝试，不发送后台原文，不保证结果</small></header><div>${actions.map((action, index) => {
            const [label, description] = intentActionLabels[action] || [action, '表达玩家意图'];
            return `<button type="button" class="wsm-choice-button" data-wsm-intent-module="${escape(module)}" data-wsm-intent-item="${escape(id)}" data-wsm-intent-action="${escape(action)}" title="只向正文 AI 发送玩家意图"><span>${index + 1}</span><b>${escape(label)}</b><small>${escape(description)}</small></button>`;
        }).join('')}</div></section>`;
    }
    function mapForView(state) {
        const map = state.map || {};
        const dynamic = map.locations || [];
        const hasPersistedMap = dynamic.length > 0 || (map.baseLocations || []).length > 0;
        const catalog = hasPersistedMap ? {} : (WSM.WorldbookCompiler?.getStaticCatalog?.() || {});
        const base = [...(map.baseLocations || []), ...(catalog.locations || [])];
        const values = new Map();
        const semantics = new Map();
        const aliases = new Map();
        const resolveId = (id) => aliases.get(String(id || '')) || String(id || '');
        const addLocation = (item, index, layer) => {
            const itemId = String(item?.id || '');
            const parentId = resolveId(item?.parentId);
            const semantic = `${parentId}|${String(item?.name || '').trim().toLocaleLowerCase()}`;
            const matched = (itemId && values.has(itemId) ? itemId : '') || semantics.get(semantic);
            const key = matched || itemId || semantic || `location-${index}`;
            const previous = values.get(key) || {};
            const canonicalId = String(previous.id || itemId || key);
            values.set(key, { ...previous, ...item, id: canonicalId, parentId, aliases: [...new Set([...(previous.aliases || []), ...(item?.aliases || []), ...(itemId && itemId !== canonicalId ? [itemId] : [])])], layer });
            if (itemId) aliases.set(itemId, canonicalId);
            aliases.set(canonicalId, canonicalId);
            semantics.set(semantic, key);
        };
        base.forEach((item, index) => addLocation(item, index, 'worldbook'));
        dynamic.forEach((item, index) => addLocation(item, index, 'dynamic'));
        const routes = new Map();
        [...(catalog.routes || []), ...(map.routes || []), ...(map.routeOverlays || [])].forEach((item, index) => {
            const normalized = { ...item, from: resolveId(item?.from), to: resolveId(item?.to) };
            const key = String(item?.id || `${normalized.from}>${normalized.to}>${index}`);
            routes.set(key, { ...(routes.get(key) || {}), ...normalized });
        });
        const invalidPlaceName = (value) => {
            const name = String(value || '').trim();
            return !name || /^\d+(?:\.\d+)?$/.test(name) || /(?:→|->|⇒|☆?进度\s*:|nsfw\s*:)/i.test(name) || /^(?:前往|从).*(?:至|到)/.test(name);
        };
        let locations = [...values.values()].map((item, index) => ({
            ...item,
            x: Number.isFinite(Number(item.x)) ? Number(item.x) : 15 + ((index * 31) % 70),
            y: Number.isFinite(Number(item.y)) ? Number(item.y) : 18 + ((Math.floor(index / 3) * 31 + (index % 3) * 13) % 64),
        })).filter((item) => !invalidPlaceName(item.name));
        WSM.Storage?.normalizeMapHierarchy?.(locations, resolveId(map.currentLocationId), state.world?.location?.current || '');
        if (WSM.Settings.get().gptMode === true && map.currentLocationId) {
            const currentId = resolveId(map.currentLocationId);
            const allById = new Map(locations.map((item) => [item.id, item]));
            const current = allById.get(currentId);
            if (current) {
                const keep = new Set([current.id]);
                const walked = new Set();
                for (let cursor = allById.get(current.parentId); cursor && !walked.has(cursor.id); cursor = allById.get(cursor.parentId)) {
                    keep.add(cursor.id);
                    walked.add(cursor.id);
                }
                locations.filter((item) => item.parentId === current.parentId).forEach((item) => keep.add(item.id));
                locations = locations.filter((item) => keep.has(item.id));
            }
        }
        if (locations.some((item) => item.type === 'country')) locations = locations.filter((item) => item.type !== 'world');
        let hiddenUnplacedCount = 0;
        const countryIds = new Set(locations.filter((item) => item.type === 'country').map((item) => item.id));
        if (countryIds.size) {
            const cities = locations.filter((item) => item.type === 'city' && countryIds.has(item.parentId));
            locations.filter((item) => countryIds.has(item.parentId) && item.type !== 'city').forEach((item) => {
                const name = String(item.name || '');
                const matches = cities.filter((city) => {
                    const cityName = String(city.name || '');
                    const base = cityName.replace(/(?:市|城)$/, '');
                    return base.length >= 2 && (name.startsWith(base) || name.includes(`${base}城`));
                }).sort((a, b) => String(b.name || '').length - String(a.name || '').length);
                if (matches.length === 1 || (matches[0] && String(matches[0].name || '').length > String(matches[1]?.name || '').length)) item.parentId = matches[0].id;
            });
            const visibleIds = new Set([...countryIds, ...cities.map((item) => item.id)]);
            let changed = true;
            while (changed) {
                changed = false;
                locations.forEach((item) => {
                    const parentIsCountry = countryIds.has(item.parentId);
                    if (!visibleIds.has(item.id) && visibleIds.has(item.parentId) && (!parentIsCountry || item.type === 'city')) { visibleIds.add(item.id); changed = true; }
                });
            }
            hiddenUnplacedCount = locations.filter((item) => !visibleIds.has(item.id)).length;
            locations = locations.filter((item) => visibleIds.has(item.id));
        }
        return { ...map, currentLocationId: resolveId(map.currentLocationId), locations, routes: [...routes.values()], hiddenUnplacedCount };
    }
    function renderGameView(state) {
        const empty = (label) => {
            const module = definitions[active]?.stateKey || active;
            const coverage = state.moduleCoverage?.[module];
            const description = ({
                empty_confirmed: '完整资料已校准，当前确实没有适合持久化的记录。',
                coverage_only: '已检查相关对象，但尚未读取到已确立内容。',
                unknown: '当前为空，但尚不能证明原文确实没有；需要时会定点回查。',
                retrieval_failed: 'RULE_COMPILE_FAILED / RETRIEVAL_FAILED：来源应当存在但读取或解析失败，必须重试。',
                not_applicable: '当前模块对此对象不适用。',
                not_checked: '尚未执行初始化或完整校准。',
            })[coverage?.status] || '世界会在满足因果和时间条件后自然产生内容。';
            return `<div class="wsm-empty-state"><span>${icon('empty')}</span><b>暂无${label}</b><small>${escape(description)}</small></div>`;
        };
        if (active === 'overview') {
            const world = state.world || {};
            const facts = (world.currentConditions || []).length ? `<div class="wsm-world-facts"><b>${icon('note')}<span>当前客观状态</span></b>${(world.currentConditions || []).slice(0, 8).map((fact) => {
                return `<span>${escape(fact)}</span>`;
            }).join('')}</div>` : '';
            return `<section class="wsm-world-summary"><div class="wsm-world-fields">
                <div><span>${icon('clock')}</span><small>当前时间</small><b>${escape(world.time?.display || '未明确')}</b></div>
                <div><span>${icon('weather')}</span><small>当前季节</small><b>${escape(world.season || '未明确')}</b></div>
                <div><span>${icon('pin')}</span><small>当前位置</small><b>${escape(world.location?.current || '未明确')}</b></div>
                <div><span>${icon('weather')}</span><small>天气</small><b>${escape(world.location?.weather || '未明确')}</b></div>
                <div><span>${icon('home')}</span><small>环境</small><b>${escape(world.location?.environment || '未明确')}</b></div>
            </div>${facts}</section>`;
        }
        if (active === 'factAnchors') return (state.factAnchors || []).filter((item) => item?.fact).map((item) => card(displayValue(item.fact), displayValue(item.scope) || '长期客观结果', '', { icon: 'note' })).join('') || empty('事实锚点');
        if (active === 'worldRules') {
            const compiled = WSM.WorldbookCompiler?.getStaticCatalog?.()?.worldRules || [];
            const matched = new Set(state.reasoningAudit?.matchedRules || []);
            const allRules = WSM.Facts?.merge?.([...(state.worldRules || []), ...compiled]) || state.worldRules || [];
            const rules = allRules.filter((item) => matched.has(item.id) || matched.has(item.factId));
            return rules.map((item) => `<article class="wsm-rule-card">${escape(displayValue(item.statement || item.factId))}</article>`).join('') || empty('硬规则');
        }
        if (active === 'resourceConstraints') return (state.resourceConstraints || []).filter((item) => item?.condition && !['expired','satisfied'].includes(item?.status)).map((item) => card(displayValue(item.condition), displayValue(item.scope) || '当前硬条件', `${labeled('约束对象', resolveRef(state, item.subjectId) || item.subjectId)}${labeled('类型', ({ funds: '资金', permission: '权限', capacity: '人手 / 能力', possession: '关键持有物', access: '通行许可', blockade: '地点封锁', mobility: '行动限制', other: '其他' }[item.kind] || item.kind))}${labeled('数量 / 额度', item.amount)}${labeled('不满足时', item.consequence)}`, { icon: 'lock', badge: '当前有效' })).join('') || empty('资源或硬约束');
        if (active === 'map') {
            const mapState = mapForView(state);
            const knownIds = new Set((state.map?.locations || []).filter((item) => item.knownToPlayer !== false && item.status !== 'unknown').map((item) => item.id));
            let locations = (mapState.locations || []).filter((item) => activeMapMode === 'all' || knownIds.has(item.id) || ['known','visited'].includes(item.status) || item.knownToPlayer === true);
            const search = activeMapSearch.trim().toLocaleLowerCase();
            const allById = new Map(locations.map((item) => [item.id, item]));
            if (search) {
                const matched = locations.filter((item) => [item.name, ...(item.aliases || []), item.description, ...(item.sourceRefs || [])].some((value) => String(value || '').toLocaleLowerCase().includes(search)));
                const keep = new Set(matched.map((item) => item.id));
                matched.forEach((item) => {
                    const walked = new Set();
                    for (let cursor = allById.get(item.parentId); cursor && !walked.has(cursor.id); cursor = allById.get(cursor.parentId)) { keep.add(cursor.id); walked.add(cursor.id); }
                });
                locations = locations.filter((item) => keep.has(item.id));
            }
            const matchedLocationCount = locations.length;
            const displayLimit = 800;
            if (locations.length > displayLimit) {
                const sourceById = new Map(locations.map((item) => [item.id, item]));
                const selected = new Set();
                const addWithAncestors = (item) => {
                    const chain = [];
                    const walked = new Set();
                    for (let cursor = item; cursor && !walked.has(cursor.id); cursor = sourceById.get(cursor.parentId)) { chain.unshift(cursor); walked.add(cursor.id); }
                    for (const value of chain) {
                        if (selected.size >= displayLimit) break;
                        selected.add(value.id);
                    }
                };
                addWithAncestors(sourceById.get(mapState.currentLocationId));
                for (const item of locations) {
                    if (selected.size >= displayLimit) break;
                    addWithAncestors(item);
                }
                locations = locations.filter((item) => selected.has(item.id));
            }
            const byId = new Map(locations.map((item) => [item.id, item]));
            const currentPathIds = new Set();
            for (let cursor = byId.get(mapState.currentLocationId), guard = 0; cursor && guard < locations.length; cursor = byId.get(cursor.parentId), guard += 1) currentPathIds.add(cursor.id);
            const children = new Map();
            locations.forEach((item) => {
                const parentId = byId.has(item.parentId) ? item.parentId : '';
                if (!children.has(parentId)) children.set(parentId, []);
                children.get(parentId).push(item);
            });
            children.forEach((items) => items.sort((a, b) => Number(currentPathIds.has(b.id)) - Number(currentPathIds.has(a.id)) || String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-CN')));
            const positioned = new Map();
            const ordered = [];
            const place = (item, depth) => {
                if (!item || positioned.has(item.id)) return;
                positioned.set(item.id, { depth });
                ordered.push(item);
                (children.get(item.id) || []).forEach((child) => place(child, depth + 1));
            };
            (children.get('') || []).forEach((item) => place(item, 0));
            locations.forEach((item) => { if (!positioned.has(item.id)) place(item, 0); });
            const current = byId.get(mapState.currentLocationId);
            const renderTextLocation = (item, ancestry = new Set()) => {
                const point = positioned.get(item.id) || { depth: 0 };
                const nextAncestry = new Set(ancestry);
                nextAncestry.add(item.id);
                const descendants = (children.get(item.id) || []).filter((child) => !nextAncestry.has(child.id));
                const currentClass = item.id === mapState.currentLocationId ? ' current' : '';
                const heading = `<span class="wsm-map-tree-marker" aria-hidden="true"></span><div><div class="wsm-map-list-heading"><b>${escape(item.name || item.id)}</b><small>第 ${point.depth + 1} 级 · ${escape(mapTypeLabels[item.type] || item.type || '地点')} · ${escape(mapStatusLabels[item.status] || item.status || '已知')}</small></div>${item.description ? `<p title="${escape(item.description)}">${escape(item.description)}</p>` : ''}</div>`;
                if (!descendants.length) return `<article class="wsm-map-tree-leaf${currentClass}">${heading}</article>`;
                return `<details class="wsm-map-tree-branch${currentClass}"${search ? ' open' : ''}><summary>${heading}<em>${descendants.length} 个下级</em></summary><div class="wsm-map-tree-children">${descendants.map((child) => renderTextLocation(child, nextAncestry)).join('')}</div></details>`;
            };
            const textRoots = ordered.filter((item) => (positioned.get(item.id)?.depth || 0) === 0);
            const listRows = textRoots.map((item) => renderTextLocation(item)).join('');
            const view = `<div class="wsm-map-list" aria-label="纯文字地点层级">${listRows || '<p class="wsm-muted">没有匹配地点</p>'}</div>`;
            const limited = locations.length < matchedLocationCount ? ` · 为保持流畅，本视图显示 ${locations.length}/${matchedLocationCount}` : ` · 当前显示 ${locations.length}`;
            const unplaced = mapState.hiddenUnplacedCount ? ` · ${mapState.hiddenUnplacedCount} 个旧地点缺少城市归属，暂不混入层级` : '';
            return `<section class="wsm-map-panel"><header><span>${icon('pin')}</span><div><small>当前位置</small><b>${escape(current?.name || state.world?.location?.current || '未设定')}</b><small>已读取 ${escape(String(mapState.locations.length))} 个地点${escape(limited)}${escape(unplaced)} · 仅本地展示</small></div></header><div class="wsm-map-view-tools"><button type="button" data-map-mode="known" class="${activeMapMode === 'known' ? 'active' : ''}">角色认知地图</button><button type="button" data-map-mode="all" class="${activeMapMode === 'all' ? 'active' : ''}">全设定地图</button><input id="wsm-map-search" type="search" value="${escape(activeMapSearch)}" placeholder="搜索地点、别名或世界书来源"></div>${view}</section>`;
        }
        if (active === 'organizations') return (state.organizations || []).filter((item) => item?.name).map((item) => card(item.name, item.kind || '组织 / 势力', `${labeled('当前负责人', (item.leaderIds || []).map((id) => resolveRef(state,id)))}${labeled('管辖范围', item.jurisdiction)}${labeled('当前目标', item.goals)}${labeled('可调用资源', item.resources)}${labeled('当前处境', item.situation)}${labeled('相关组织关系', item.relationshipRefs)}`, { icon: 'people', badge: item.activity })).join('') || empty('组织 / 势力');
        if (active === 'characters') return (state.characters || []).filter((item) => item?.name || item?.id).map((item) => {
            const unknown = '未明确（原始资料未明确或需要定点回查）';
            const identity = displayValue(item.identity) || unknown;
            const location = displayValue(item.location) || unknown;
            const situation = displayValue(item.situation) || unknown;
            const recovery = (item.persistentConditions || []).map((condition) => condition?.recovery).filter(Boolean);
            const body = [
                labeled('身份', identity), labeled('当前位置', location), labeled('当前重要处境', situation),
                labeled('持续状态', item.persistentConditions), labeled('恢复状态', recovery),
                labeled('重要物品', item.importantItems), labeled('当前重要目标', item.currentGoals),
                labeled('关键权限', item.authorityRefs),
            ].join('');
            const badge = item.maintenanceLevel === 'active' ? '活跃NPC' : item.maintenanceLevel === 'background' ? '背景人物' : '核心人物';
            return card(resolveRef(state, item.id) || item.name || item.id, item.present ? '正在当前场景' : (displayValue(item.location) ? `位于 ${displayValue(item.location)}` : ''), body, { icon: 'user', badge });
        }).join('') || empty('人物');
        if (active === 'activities') {
            const characters = state.characters || [];
            const knownCharacter = (ref) => characters.find((item) => item?.id === ref || item?.name === ref || (item?.aliases || []).includes(ref));
            const groups = (state.npcActivities || []).reduce((result, item) => {
                const character = knownCharacter(item?.characterId);
                if (!character || character.present === true || (state.world?.location?.current && character.location === state.world.location.current)) return result;
                (result[character.id] ||= []).push(item);
                return result;
            }, {});
            return Object.entries(groups).map(([characterId, entries]) => {
                const current = entries.at(-1);
                return card(resolveRef(state, characterId), displayValue(current?.action) || '暂无活动', `<div class="wsm-activity-trail"><div><time>当前</time><span>${icon('pin')}<small>${escape(displayValue(current?.movement || current?.location) || '移动情况未明')}</small><b>${escape(displayValue(current?.action) || '活动未记录')}</b>${current?.location && current?.movement ? `<small>${escape(displayValue(current.location))}</small>` : ''}${current?.currentRole ? `<small>${escape(displayValue(current.currentRole))}</small>` : ''}</span></div></div>${labeled('依据', current?.basis || current?.sourceRefs)}`, { icon: 'process' });
            }).join('') || empty('NPC活动轨迹');
        }
        if (active === 'relationships') return (state.relationships || []).filter((item) => item?.from && item?.to && (item?.identityRelation || item?.currentPerception || item?.status)).map((item) => card(`${resolveRef(state,item.from)} → ${resolveRef(state,item.to)}`, item.identityRelation || '人物关系', `${labeled('身份关系', item.identityRelation)}${labeled('当前关系认知', item.currentPerception)}${labeled('形成依据', item.formationBasis)}${labeled('阶段边界', item.boundaries)}`, { icon: 'heart', badge: item.truthStatus })).join('') || empty('人物关系');
        if (active === 'knowledge') return (state.knowledge || []).filter((item) => item?.information).map((item) => card(displayValue(item.information), item.source ? `来源/渠道：${displayValue(item.source)}` : '', `${labeled('持有人', (item.holderIds || item.knownBy || []).map((id) => resolveRef(state,id)))}${labeled('认知状态', item.cognitiveStatus)}${labeled('公开状态', ({ confidential: '保密', restricted: '受限', public: '公开' }[item.disclosure] || item.disclosure))}${labeled('可靠性', item.reliability)}${labeled('玩家界面可见', item.userVisible === true ? '是' : '否')}${labeled('发现路径', item.discoveryPaths)}${labeled('成熟条件', item.maturityConditions)}${userKnowsKnowledge(state, item) ? '' : '<p class="wsm-muted">当前玩家角色未确认该信息；后台保留但不会泄露给正文。</p>'}`, { icon: 'lock', badge: item.cognitiveStatus || item.disclosure })).join('') || empty('知识记录');
        if (active === 'schedules') return (state.schedules || []).filter((item) => item?.title && !['completed','cancelled'].includes(item.status)).map((item) => card(item.title, item.expectedTime ? `预计：${item.expectedTime}` : '时间未明确', `${labeled('参与者', (item.participantIds || []).map((id) => resolveRef(state,id)))}${labeled('前置条件', item.preconditions)}${labeled('状态', item.status)}${labeled('来源', item.source)}`, { icon: 'clock', badge: item.status })).join('') || empty('已有安排');
        if (active === 'tasks') return userFacingItems(state, 'task').filter((item) => item?.title).map((item) => card(displayValue(item.title), item.deadline ? `截止：${displayValue(item.deadline)}` : '没有明确截止时间', `${labeled('为什么与你有关', item.userRelevance)}${labeled('负责人', (item.ownerIds || []).map((id) => resolveRef(state,id)))}${labeled('当前进展', item.progress)}${labeled('开始前需要', item.dependencies)}${labeled('完成条件（必须核验）', item.completionConditions)}${labeled('已核验完成条件', item.completedConditions)}${labeled('地点引用', item.locationRefs)}${labeled('人物引用', item.characterRefs)}${labeled('规则引用', item.ruleRefs)}${labeled('知识引用', item.knowledgeRefs)}${labeled('资源约束引用', item.resourceConstraintRefs)}${labeled('可能影响', item.consequences)}${intentPanel('tasks', item)}`, { icon: 'check', badge: item.status })).join('') || empty('已成立的主动任务');
        if (active === 'events') return (state.events || []).map((item) => card(item.title, item.location || '地点未明确', `${labeled('发生了什么', item.summary)}${labeled('直接结果', item.outcome)}${labeled('相关人物', (item.participantIds || []).map((id) => resolveRef(state,id)))}${labeled('关联世界进程', (item.relatedProcessIds || []).map((id) => resolveRef(state,id)))}`, { icon: 'event', badge: item.status })).join('') || empty('世界事件');
        if (active === 'triggers') return userFacingItems(state, 'trigger').map((item) => card(item.title, '来自当前世界的可互动机会', `${labeled('为什么你能注意到', item.userRelevance)}${labeled('需要满足', item.conditions)}${labeled('满足后可能', item.effectsIfTriggered)}${labeled('目前尚缺', item.blockedReasons)}${intentPanel('triggers', item)}`, { icon: 'flag', badge: item.status })).join('') || empty('当前可触发事件');
        if (active === 'threads') return (state.threads || []).map((item) => card(item.title, item.stakes || '长期发展的事务', `${labeled('相关人物', (item.participantIds || []).map((id) => resolveRef(state,id)))}${labeled('自然下一步', item.nextNaturalStep)}${labeled('已有发展', item.history)}`, { icon: 'thread', badge: item.status })).join('') || empty('长期线程');
        if (active === 'progression') {
            const item = state.progression || {};
            if (![item.direction, item.currentMovement, item.blockedByDecision].some(Boolean) && !(item.nextRequiredChanges || []).length) return empty('剧情推进方向');
            return card(item.direction || '当前剧情自然延续中', item.currentMovement || '尚未形成新的阶段变化', `${labeled('下一阶段仍需', item.nextRequiredChanges)}${labeled('必须等待用户决定', item.blockedByDecision)}`, { icon: 'process', badge: '当前版本' });
        }
        if (active === 'processes') {
            const cleanProcessText = (value) => {
                const text = displayValue(value);
                const labeledValue = text.match(/(?:^|[；;])\s*(?:progression|进程)[：:]\s*([^；;]+)/i)?.[1];
                return String(labeledValue || text).replace(/[；;]\s*(?:truthStatus|basis|sourceRefs)[：:][\s\S]*$/i, '').trim();
            };
            return (state.processes || []).map((item) => {
                const direction = cleanProcessText(item.currentDirection) || '自然延续中';
                let title = cleanProcessText(item.title) || '当前世界进程';
                if (title === direction) title = direction.split(/[，,。；;]/)[0].slice(0, 48) || '当前世界进程';
                return card(title, direction, `${labeled('为什么仍在继续', item.drivers)}${labeled('可能逐渐淡去', item.decayConditions)}${labeled('自然结束条件', item.resolutionConditions)}${Number(item.progress?.max) > 0 ? labeled('进度钟', `${Number(item.progress?.current || 0)}/${Number(item.progress.max)}${item.progress?.lastChangeReason ? ` · ${item.progress.lastChangeReason}` : ''}`) : ''}`, { icon: 'process', badge: item.status });
            }).join('') || empty('世界进程');
        }
        if (active === 'causalEffects') return (state.causalEffects || []).map((item) => card(item.result || '后果仍在形成', `起因：${item.cause || resolveRef(state,item.causeRef) || '未知'}`, `${labeled('必要因果路径', item.steps)}${labeled('影响对象', (item.affectedIds || []).map((id) => resolveRef(state,id)))}${labeled('尚缺条件', item.reachCondition)}${labeled('减弱或消失条件', item.decayConditions)}`, { icon: 'causal', badge: item.status })).join('') || empty('因果影响');
        if (active === 'timeline') return `<div class="wsm-timeline">${(state.timeline || []).filter((item) => item?.summary).slice().reverse().map((item, index) => `<article><time>${(state.timeline || []).length - index}</time><div><b>${escape(displayValue(item.summary) || '无摘要')}</b><small>${escape([item.granularity, displayValue(item.location)].filter(Boolean).join(' · '))}</small>${chips((item.participants || []).map((id) => resolveRef(state,id)))}${chips(item.relatedFactIds || [])}</div></article>`).join('')}</div>` || empty('时间线');
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
            const dicePanel = dice ? `<section class="wsm-board"><h4>${icon('event')}<span>本轮共享随机源</span></h4>
                <div class="wsm-board-item"><b>共享随机种：${escape(dice.seed || '')}/100</b><small>只在多个合理且确有不确定性的结果之间提供统一倾向</small></div>
                <div class="wsm-board-item"><b>共享骰池</b><small>${escape((dice.checkPool || []).map((item) => item.number).join(' → ') || '无')}（需要时按顺序使用，不按模块重复掷骰）</small></div>
                <div class="wsm-board-item"><b>与剧情推进独立</b><small>骰子不决定是否推进，也不能直接随机关系、知识、世界状态、时间线或因果影响</small></div>
            </section>` : '';
            const auditPanel = `<section class="wsm-board"><h4>${icon('brain')}<span>推演审计（仅本地）</span></h4>
                <div class="wsm-board-item"><b>本轮规则命中</b><small>${escape((audit.matchedRules || []).join('、') || '无')}</small></div>
                <div class="wsm-board-item"><b>冲突 / 陈旧状态</b><small>${escape([...(audit.conflicts || []), ...(audit.staleStates || [])].join('；') || '未发现')}</small></div>
                ${(audit.moduleDecisions || []).map((item) => `<div class="wsm-board-item"><b>${escape(item.module || '?')} · ${escape(item.operation || 'KEEP')}</b><small>${escape(item.reason || '')}</small></div>`).join('')}
            </section>`;
            return `${corePanel}${auditPanel}${dicePanel}<div class="wsm-judgement-grid"><section><h4>${icon('clock')}<span>时间判断</span></h4><b>${escape(String(plan.timeAdvanceMinutes ?? 0))} 分钟</b></section><section><h4>${icon('check')}<span>可以自然发展</span></h4>${chips(plan.eligibleDevelopments, '<span class="wsm-muted">没有指定</span>')}</section><section><h4>${icon('ban')}<span>不应发生</span></h4>${chips(plan.forbiddenDevelopments, '<span class="wsm-muted">没有指定</span>')}</section></div>${plan.notes ? `<section class="wsm-board"><h4>后台备注</h4><div class="wsm-board-item">${escape(plan.notes)}</div></section>` : ''}`;
        }
        if (active === 'sources') {
            const info = state.runtime?.sourceSummary || {};
            const loaded = info.loadedWorldbooks || [];
            const failed = info.failedWorldbooks || [];
            const counts = info.worldbookEntryCounts || {};
            const sourceRead = info.sourceRead || {};
            const fullRead = !!sourceRead.mode || sourceRead.chunked === true;
            const audit = WSM.Storage.historyAudit?.() || sourceRead.audit || {};
            const calibrated = sourceRead.mode === 'baseline-ledger-calibration';
            return `<div class="wsm-source-grid">
                <section class="wsm-board"><h4>基础输入</h4><div class="wsm-board-item">角色卡：${info.characterCard ? '已读取' : '未读取'}<br>Persona：${info.persona ? '已读取' : '未读取'}<br>酒馆正文：${escape(String(info.chatMessages || 0))} / ${escape(String(info.chatTotalMessages || 0))} 层${info.chatTruncated ? '（已按设置截取）' : ''}<br>${fullRead ? `原始资料 ${escape(String(sourceRead.originalChars || 0))} 字 → 运行资料 ${escape(String(sourceRead.includedChars || sourceRead.originalChars || 0))} 字 · API ${escape(String(sourceRead.requestAttempts || 0))} 次 · 缓存 ${escape(String(sourceRead.cacheHits || 0))} 次 · 总用时 ${escape(formatDuration(sourceRead.durationMs || 0))}` : '尚未执行手动完整读取'}</div></section>
                ${calibrated ? `<section class="wsm-board"><h4>来源审计</h4><div class="wsm-board-item">总可读取：${escape(String(audit.totalReadableMessages || 0))}<br>已处理：${escape(String(audit.processedMessages || 0))}<br>失败：${escape(String(Number(audit.failedMessages || 0) + Number(audit.failedChunks || 0)))}<br>隐藏但已纳入：${escape(String(audit.hiddenIncluded || 0))}<br>产生状态变化：${escape(String(audit.changedMessages || 0))}<br>无长期变化：${escape(String(audit.noLongTermChangeMessages || 0))}<br>摘要遗漏：${escape(String(audit.summaryOmissions || 0))}<br>摘要冲突：${escape(String(audit.summaryConflicts || 0))}<br>无来源状态：${escape(String(audit.sourceLessChanges || 0))}</div></section>` : ''}
                <section class="wsm-board"><h4>已读取世界书</h4>${loaded.length ? loaded.map((name) => `<div class="wsm-board-item"><b>${escape(name)}</b><small>${escape(String(counts[name] || 0))} 条启用条目</small></div>`).join('') : '<div class="wsm-board-item">没有读到任何世界书</div>'}</section>
                ${failed.length ? `<section class="wsm-board"><h4>发现但读取失败</h4>${failed.map((name) => `<div class="wsm-board-item">${escape(name)}</div>`).join('')}</section>` : ''}
                <section class="wsm-board"><h4>注入边界</h4><div class="wsm-board-item">最终注入由上述输入、已经结算的当前状态和本轮 Planner 约束生成。时间线只在面板展示，不进入正文注入。</div></section>
            </div>`;
        }
        if (active === 'worldbookEmpty') {
            const report = currentWorldbookReport(state);
            const source = state.runtime?.sourceSummary || {};
            const expected = (source.loadedWorldbooks || []).length > 0;
            if (expected && !(report.entries || []).length) return `<div class="wsm-empty-state"><span>${icon('ban')}</span><b>RULE_COMPILE_FAILED</b><small>世界书来源已经读取，但本轮没有可用的规则编译结果；这不是“没有规则”，请重新读取或在设置中定点拆解。</small></div>`;
            return empty('本轮规则命中');
        }
        if (isWorldbookSection(active)) {
            const report = currentWorldbookReport(state);
            const delivery = report.delivery || {};
            return `<section class="wsm-injection-preview wsm-worldbook-text-module"><h4>${icon('note')}<span>拆解规则文本</span></h4><pre>${escape(formatHuman(state))}</pre></section>
                <section class="wsm-board"><h4>${icon('send')}<span>注入说明</span></h4><div class="wsm-board-item"><b>${report.routedText ? '该条目会参与逐轮相关性筛选' : '当前只有拆解缓存，尚无本轮路由结果'}</b><small>${delivery.at ? `${delivery.injected ? '最近一轮已写入正文请求' : '最近一轮未写入正文请求'} · ${delivery.fallback ? '使用缓存降级' : '使用正常路由'}` : '生成正文时只发送本轮相关规则，不会把所有拆解条目全文都注入。'}</small></div></section>`;
        }
        if (active === 'injection') return `<section class="wsm-injection-preview"><h4>${icon('send')}<span>将发送给正文模型的全部内容</span></h4><pre>${escape(finalInjectionText(state))}</pre></section>`;
        return empty('内容');
    }
    function notify(message, type = 'info') {
        if (window.toastr?.[type]) window.toastr[type](message);
        else console[type === 'error' ? 'error' : 'info']('[WorldStateMachine]', message);
    }
    const interactionCollections = {
        characters: 'characters', activities: 'npcActivities', relationships: 'relationships', knowledge: 'knowledge',
        tasks: 'tasks', events: 'events', triggers: 'triggers', threads: 'threads', processes: 'processes',
        causalEffects: 'causalEffects', timeline: 'timeline',
    };
    const interactionActions = {
        characters: ['focus','intervene','investigate'], activities: ['focus','investigate'], relationships: ['focus','investigate'],
        knowledge: ['focus','investigate'], tasks: ['focus','intervene','investigate'], events: ['focus','intervene','investigate'],
        triggers: ['focus','intervene','investigate'], threads: ['focus','intervene','investigate'], processes: ['focus','intervene','investigate'],
        causalEffects: ['focus','investigate'], timeline: ['focus','investigate'],
    };
    function findInteractionItem(state, module, id) {
        const collection = state[interactionCollections[module]] || [];
        return collection.find((item) => interactionKey(module, item) === String(id || ''));
    }
    function intentSubject(state, module, item) {
        let value = '';
        if (module === 'characters') value = resolveRef(state, item.id) || item.name;
        else if (module === 'activities') value = resolveRef(state, item.characterId) || item.characterId;
        else if (module === 'relationships') value = `${resolveRef(state, item.from)}与${resolveRef(state, item.to)}`;
        else if (module === 'knowledge') value = item.information;
        else if (module === 'causalEffects') value = item.result || '这项持续影响';
        else if (module === 'timeline') value = item.summary || '这段往事';
        else value = item.title || '这项内容';
        return String(value || '这项内容').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
    }
    function buildIntentMessage(state, module, item, action) {
        const subject = intentSubject(state, module, item);
        const quoted = `“${subject}”`;
        const guard = '这只表达我的行动意图，不代表行动成功，也不代表我已经知道状态栏中的后台信息。请根据我当前实际掌握的知识、距离、权限、手段、时间、人物能力与世界规则裁定；不要直接把后台记录告诉我，也不要替我作进一步决定。';
        const messages = {
            characters: {
                focus: `接下来我想多留意与${quoted}有关的动向和自然互动机会。`,
                intervene: `我尝试以当前确实可行的方式寻找、联系或接近${quoted}。`,
                investigate: `我尝试询问${quoted}的近况，或通过自己能够使用的合理渠道了解情况。`,
            },
            activities: {
                focus: `接下来我想多留意${quoted}可能公开显露的动向。`,
                investigate: `我尝试通过当前合理渠道了解${quoted}现在的去向；不要把后台行程直接视为我已知的信息。`,
            },
            relationships: {
                focus: `接下来我想留意${quoted}之间的关系如何影响眼前互动。`,
                investigate: `我尝试通过实际互动、询问或观察，了解${quoted}之间的关系状况。`,
            },
            knowledge: {
                focus: `接下来我想重点留意与${quoted}有关的线索和现实影响。`,
                investigate: `我尝试核实或进一步调查自己已经知道的${quoted}。`,
            },
            tasks: {
                focus: `接下来我想优先关注任务${quoted}的进展和可行动机会。`,
                intervene: `我尝试围绕任务${quoted}采取一个当前可行的小步骤；不要直接判定任务完成。`,
                investigate: `我先查看、询问或调查任务${quoted}的当前进展、阻碍与必要条件。`,
            },
            events: {
                focus: `接下来我想关注事件${quoted}与当前处境的联系。`,
                intervene: `如果我能够合理接触到事件${quoted}，我尝试以当前身份和能力介入，但不预设结果。`,
                investigate: `我尝试通过可用渠道了解事件${quoted}目前公开或可调查的情况。`,
            },
            triggers: {
                focus: `接下来我想留意与${quoted}有关、自己能够察觉的机会。`,
                intervene: `我尝试主动接近或准备${quoted}所需的现实条件，但不把它直接视为已经触发。`,
                investigate: `我尝试调查与${quoted}有关的线索和可达条件。`,
            },
            threads: {
                focus: `接下来我想持续关注线索${quoted}。`,
                intervene: `如果当前存在合理入口，我尝试介入与${quoted}有关的事情，但不预设发展方向。`,
                investigate: `我尝试从自己已知的部分继续询问或调查${quoted}。`,
            },
            processes: {
                focus: `接下来我想关注世界变化${quoted}对当前生活可能产生的可感知影响。`,
                intervene: `如果我的身份、能力和现实渠道允许，我尝试对${quoted}采取有限介入；不要夸大个人影响力。`,
                investigate: `我尝试了解${quoted}中自己能够接触到的公开进展和现实影响。`,
            },
            causalEffects: {
                focus: `接下来我想留意是否存在与${quoted}有关的持续影响。`,
                investigate: `我尝试确认并调查${quoted}可能的现实原因；如果角色并不知道这项后台因果，不得直接揭示。`,
            },
            timeline: {
                focus: `接下来我想留意往事${quoted}是否与当前情况自然相关。`,
                investigate: `我尝试回忆、询问或调查与${quoted}有关的事情；不能改写历史，也不能把未知记录直接变成我的记忆。`,
            },
        };
        return `${messages[module]?.[action] || `我尝试关注${quoted}。`}\n\n${guard}`;
    }
    async function sendInteractiveIntent(module, itemId, action) {
        if (choiceSending) return;
        const allowed = interactionActions[module] || [];
        if (!allowed.includes(action)) { notify('这个模块不允许执行该操作', 'error'); return; }
        const state = WSM.Storage.load();
        const item = findInteractionItem(state, module, itemId);
        if (!item) { notify('这张卡片已经随状态更新，请重新选择', 'error'); render(); return; }
        if (module === 'knowledge' && !userKnowsKnowledge(state, item)) {
            notify('当前玩家角色尚未确认这条知识，不能通过状态栏发送给正文 AI', 'error');
            render();
            return;
        }
        if (module === 'events' && item.status !== 'ongoing' && action === 'intervene') {
            notify('已经发生的事件只能关注或调查，不能直接介入过去', 'error');
            render();
            return;
        }
        if (action === 'focus') {
            item.activity = 'HOT';
            item.updatedRevision = Number(state.revision || 0) + 1;
            await WSM.Storage.save(state, 'player-focus', { snapshot: false });
            await WSM.Engine?.syncRegisteredPrompt?.();
        }
        const textarea = document.querySelector('#send_textarea');
        const sendButton = document.querySelector('#send_but');
        if (!(textarea instanceof HTMLTextAreaElement) || !(sendButton instanceof HTMLElement)) {
            notify('没有找到酒馆正文输入框，请先打开一个角色聊天', 'error');
            return;
        }
        if (sendButton.hasAttribute('disabled') || sendButton.classList.contains('displayNone')) {
            notify('正文 API 尚未连接，连接后再发送这个意图', 'error');
            return;
        }
        if (textarea.value.trim() && !window.confirm('正文输入框中已有未发送内容。要用这个玩家意图覆盖并立即发送吗？')) return;
        choiceSending = true;
        try {
            textarea.value = buildIntentMessage(state, module, item, action);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            close();
            await new Promise((resolve) => window.setTimeout(resolve, 0));
            sendButton.click();
            notify(`已发送玩家意图：${intentActionLabels[action]?.[0] || action}`, 'success');
        } finally {
            window.setTimeout(() => { choiceSending = false; }, 800);
        }
    }
    function categoryForSection(section) {
        return Object.entries(categories).find(([, item]) => item.sections.includes(section))?.[0] || 'world';
    }
    function renderNavigation() {
        const tabRoot = root.querySelector('.wsm-tabs');
        const categorySections = categories[activeCategory]?.sections || [];
        const singlePanel = categorySections.length === 1;
        if (tabRoot) {
            tabRoot.innerHTML = Object.entries(sectionMap)
                .filter(([id]) => id !== 'worldbookEmpty')
                .map(([id, [label]]) => `<button class="wsm-tab" data-tab="${escape(id)}">${escape(label)}</button>`).join('');
            tabRoot.hidden = singlePanel;
        }
        root.querySelector('.wsm-body')?.classList.toggle('wsm-single-panel', singlePanel);
        root.querySelectorAll('.wsm-category-button').forEach((button) => button.classList.toggle('active', button.dataset.categorySelect === activeCategory));
        root.querySelectorAll('.wsm-tab').forEach((button) => {
            button.hidden = !categorySections.includes(button.dataset.tab);
            button.classList.toggle('active', button.dataset.tab === active);
        });
    }
    function renderSettingsTabs() {
        root.querySelectorAll('[data-settings-tab]').forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === activeSettingsTab));
        root.querySelectorAll('[data-settings-section]').forEach((section) => { section.hidden = section.dataset.settingsSection !== activeSettingsTab; });
        const footer = $('#wsm-settings-modal footer');
        if (footer) footer.hidden = activeSettingsTab === 'history';
        revealHorizontalItem(root.querySelector('.wsm-settings-tabs'), root.querySelector(`[data-settings-tab="${activeSettingsTab}"]`));
    }
    function revealHorizontalItem(container, item) {
        if (!(container instanceof HTMLElement) || !(item instanceof HTMLElement)) return;
        const left = item.offsetLeft;
        const right = left + item.offsetWidth;
        if (left < container.scrollLeft) container.scrollLeft = Math.max(0, left - 8);
        else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth + 8;
    }
    function bindHorizontalWheel(container) {
        if (!(container instanceof HTMLElement) || container.dataset.wsmHorizontalWheel === '1') return;
        container.dataset.wsmHorizontalWheel = '1';
        container.addEventListener('wheel', (event) => {
            if (container.scrollWidth <= container.clientWidth + 1) return;
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (!delta) return;
            const before = container.scrollLeft;
            container.scrollLeft += delta;
            if (container.scrollLeft !== before) event.preventDefault();
        }, { passive: false });
    }
    function bindHorizontalNavigation() {
        root.querySelectorAll('.wsm-settings-tabs,.wsm-category-bar,.wsm-actions,.wsm-tabs').forEach(bindHorizontalWheel);
    }
    function renderInjectionModuleSettings(settings) {
        const modules = settings.injectionModules || WSM.Defaults.INJECTION_MODULES;
        $('#wsm-injection-module-list').innerHTML = Object.entries(categories).map(([categoryId, category]) => {
            const rows = Object.entries(WSM.Defaults.INJECTION_MODULES).filter(([id, module]) => id !== 'map' && module.category === categoryId).map(([id, defaultModule]) => {
                const config = Object.assign({}, defaultModule, modules[id] || {});
                return `<label class="wsm-injection-row"><input type="checkbox" data-module-enabled="${id}" ${config.enabled !== false ? 'checked' : ''}><span>${escape(config.label)}<small>注入深度 ${escape(String(config.depth ?? module.depth ?? 2))}</small></span></label>`;
            }).join('');
            return rows ? `<details class="wsm-injection-group" open><summary>${icon(category.icon)}<span>${category.label}类</span></summary>${rows}</details>` : '';
        }).join('');
    }
    function renderModulePromptSettings(settings) {
        const prompts = Object.assign({}, WSM.Defaults.MODULE_PROMPTS, settings.modulePrompts || {});
        $('#wsm-module-prompt-list').innerHTML = Object.entries(promptGroups).map(([categoryId, moduleIds]) => {
            const fields = moduleIds.map((id) => `<label class="wsm-module-prompt"><b>${escape(promptLabels[id] || id)}</b><textarea data-module-prompt="${id}" rows="3">${escape(prompts[id] || '')}</textarea></label>`).join('');
            return `<details class="wsm-prompt-group" ${categoryId === 'world' ? 'open' : ''}><summary>${icon(categories[categoryId].icon)}<span>${categories[categoryId].label}模块</span></summary><div>${fields}</div></details>`;
        }).join('');
    }
    function selectedWorldbookCards(selectedNames, selectedEntryKeys = []) {
        const selected = new Set(selectedNames);
        const selectedKeys = new Set(selectedEntryKeys);
        const groups = worldbookEntriesCache.reduce((map, entry) => {
            if (selected.has(entry.bookName)) (map[entry.bookName] ||= []).push(entry);
            return map;
        }, {});
        return Object.entries(groups).map(([bookName, entries]) => `<details class="wsm-injection-group wsm-worldbook-book-group">
            <summary><span><b>${escape(bookName)}</b><small>已勾选 ${entries.filter((entry) => selectedKeys.has(entry.key)).length} / ${entries.length} 条（其中 ${entries.filter((entry) => entry.enabled).length} 条原文已启用）</small><em>${escape(entries[0]?.bookSource === 'character card' ? '角色卡内嵌' : '当前启用 / 角色绑定')}</em></span></summary>
            ${entries.map((entry) => `<label class="wsm-worldbook-entry-preview"><input type="checkbox" data-worldbook-entry-choice value="${escape(entry.key)}" ${selectedKeys.has(entry.key) ? 'checked' : ''}><span><b>${escape(entry.comment || entry.keys?.join('、') || `条目 ${entry.id}`)}${entry.enabled ? '' : '（原条目已禁用）'}</b><small>${entry.enabled ? '运行时可投影 · ' : '可预编译但运行时不注入 · '}${escape(String(entry.content || '').slice(0, 140))}</small></span></label>`).join('') || '<div class="wsm-board-item">这本书当前没有可读取条目。</div>'}
        </details>`).join('') || '<div class="wsm-board-item">尚未在下拉菜单中选择世界书；读取时不会发送世界书。</div>';
    }
    function worldbookSelectionConfig(config, selectedNames, selectedEntryKeys, candidateNames) {
        const selected = new Set(selectedNames);
        const availableKeys = new Set(worldbookEntriesCache.filter((entry) => selected.has(entry.bookName)).map((entry) => entry.key));
        return WSM.WorldbookCompiler.normalizeConfig({
            ...config,
            selectedBookNames: [...selected],
            knownBookNames: [...candidateNames],
            entryKeys: [...new Set(selectedEntryKeys)].filter((key) => availableKeys.has(key)),
            knownEntryKeys: worldbookEntriesCache.map((entry) => entry.key),
        });
    }
    function syncWorldbookPickerDisplay() {
        const choices = [...root.querySelectorAll('[data-worldbook-book-choice]')];
        const selectedNames = choices.filter((input) => input.checked).map((input) => input.value);
        const selectedEntryKeys = [...root.querySelectorAll('[data-worldbook-entry-choice]')].filter((input) => input.checked).map((input) => input.value);
        const label = root.querySelector('[data-worldbook-picker-label]');
        if (label) label.textContent = selectedNames.length ? `显示 ${selectedNames.length} 本，已勾选 ${selectedEntryKeys.length} 条` : '没有选择世界书，点击这里选择';
        const list = $('#wsm-worldbook-compiler-list');
        if (list) list.innerHTML = selectedWorldbookCards(selectedNames, selectedEntryKeys);
        return { selectedNames, selectedEntryKeys };
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
        list.innerHTML = '<div class="wsm-board-item">正在读取当前启用及角色绑定的世界书…</div>';
        try {
            // Always read the live ST selection. Reusing this cache is what made
            // a book from the previous character remain visible.
            worldbookEntriesCache = await WSM.Context.listWorldbookEntries({ includeDisabled: true });
            const candidateNames = [...new Set(worldbookEntriesCache.map((entry) => entry.bookName))];
            const known = new Set(config.knownBookNames);
            const selected = new Set(config.selectedBookNames.filter((name) => candidateNames.includes(name)));
            candidateNames.forEach((name) => { if (!known.has(name)) selected.add(name); });
            const visibleKeys = new Set(worldbookEntriesCache.filter((entry) => selected.has(entry.bookName)).map((entry) => entry.key));
            const selectedEntryKeys = config.entryKeys.filter((key) => visibleKeys.has(key));
            const nextConfig = worldbookSelectionConfig(config, selected, selectedEntryKeys, candidateNames);
            if (JSON.stringify(nextConfig) !== JSON.stringify(config)) WSM.Settings.update({ worldbookCompiler: nextConfig });
            const picker = $('#wsm-worldbook-picker');
            picker.innerHTML = candidateNames.length ? `<button type="button" class="wsm-worldbook-picker-button" data-action="toggle-worldbook-picker" aria-expanded="false"><span data-worldbook-picker-label></span><b>▾</b></button>
                <div class="wsm-worldbook-picker-menu" data-worldbook-picker-menu hidden>${candidateNames.map((bookName) => {
                    const entries = worldbookEntriesCache.filter((entry) => entry.bookName === bookName);
                    return `<label><input type="checkbox" data-worldbook-book-choice value="${escape(bookName)}" ${selected.has(bookName) ? 'checked' : ''}><span><b>${escape(bookName)}</b><small>${entries[0]?.bookSource === 'character card' ? '角色卡内嵌世界书' : '酒馆当前启用或角色绑定'} · ${entries.filter((entry) => entry.enabled).length} 条已启用条目</small></span></label>`;
                }).join('')}</div>` : '<div class="wsm-board-item">当前没有全局启用或角色卡绑定的世界书。</div>';
            const label = root.querySelector('[data-worldbook-picker-label]');
            if (label) label.textContent = selected.size ? `显示 ${selected.size} 本，已勾选 ${selectedEntryKeys.length} 条` : '没有选择世界书，点击这里选择';
            list.innerHTML = selectedWorldbookCards(selected, selectedEntryKeys);
        } catch (error) {
            $('#wsm-worldbook-picker').innerHTML = '';
            list.innerHTML = `<div class="wsm-board-item">读取失败：${escape(error.message)}</div>`;
        }
    }
    function historyHtml() {
        const items = WSM.Storage.history();
        const latest = items[0];
        return `<section class="wsm-rollback-panel"><b>${icon('history')}<span>回滚上一轮状态版本</span></b><p>恢复到上一轮正文生成或手动整理前的世界状态。后台最多保留最近 10 轮，发送给 AI 时只使用当前最新状态。</p>${latest ? `<small>可回滚：${new Date(latest.at).toLocaleString()} · 当前保留 ${items.length}/10 轮</small><button data-action="rollback-previous">回滚上一轮</button>` : '<small>还没有可回滚的状态版本。</small>'}</section>`;
    }
    function modalHtml() {
        const tabs = Object.entries(sectionMap).map(([id, [label]]) => `<button class="wsm-tab" data-tab="${id}">${label}</button>`).join('');
        const categoryButtons = Object.entries(categories).map(([id, item]) => `<button class="wsm-category-button" data-category-select="${id}"><span>${icon(item.icon)}</span><b>${item.label}</b></button>`).join('');
        return `<div id="wsm-modal" class="wsm-modal" hidden>
            <div class="wsm-shell">
                <button id="wsm-main-close" class="wsm-icon-button" data-action="close" aria-label="关闭">${icon('close')}</button>
                <header class="wsm-header"><div class="wsm-actions">
                    <div class="wsm-read-action"><button id="wsm-read-current" data-action="read-current">读取当前聊天</button><section id="wsm-operation-status" class="wsm-operation-status" role="status" aria-live="polite"><div class="wsm-operation-current"><b></b><small></small></div><div class="wsm-operation-steps" aria-label="读取步骤"></div></section></div><button id="wsm-clear-read" data-action="clear-read">清空读取</button><button data-action="gpt-local-fix">本地重建</button><button data-action="organize">整理状态</button><button data-action="settings">设置</button><button data-action="history">回滚上一轮</button>
                </div></header>
                <nav class="wsm-category-bar">${categoryButtons}</nav>
                <div class="wsm-body"><nav class="wsm-tabs">${tabs}</nav><main class="wsm-main">
                    <div class="wsm-section-heading"><div id="wsm-section-title"></div><div class="wsm-view-toolbar"><button class="wsm-icon-button wsm-pencil-only" data-action="toggle-edit" aria-label="编辑当前栏目" title="编辑当前栏目">${icon('edit')}</button></div></div>
                    <div id="wsm-game-view"></div><textarea id="wsm-editor" spellcheck="false" hidden></textarea>
                    <div class="wsm-editor-actions" hidden><button data-action="save-section">保存修改</button><button data-action="reload">放弃修改</button></div>
                </main></div>
            </div></div>
            <div id="wsm-settings-modal" class="wsm-submodal" hidden><div class="wsm-dialog"><header><b>世界状态机设置</b><button class="wsm-icon-button" data-action="close-settings" aria-label="关闭">${icon('close')}</button></header>
                <nav class="wsm-settings-tabs"><button data-settings-tab="api">${icon('plug')}<span>API</span></button><button data-settings-tab="source">${icon('clipboard')}<span>分解正文</span></button><button data-settings-tab="pacing">${icon('process')}<span>剧情节奏</span></button><button data-settings-tab="dice">${icon('event')}<span>骰子</span></button><button data-settings-tab="worldbook">${icon('note')}<span>拆解世界书</span></button><button data-settings-tab="injection">${icon('send')}<span>注入模块</span></button><button data-settings-tab="prompts">${icon('brain')}<span>内置提示词</span></button><button data-settings-tab="history">${icon('history')}<span>上一轮回滚</span></button></nav>
                <section class="wsm-settings-section" data-settings-section="api">
                    <label class="wsm-check"><input id="wsm-use-tavern-api" type="checkbox">使用酒馆默认 API（当前连接与模型）</label>
                    <p class="wsm-settings-help">启用后无需另填地址、模型或 Key，状态机直接跟随酒馆主界面当前使用的 API；请求只包含状态机所需内容。</p>
                    <label class="wsm-check"><input id="wsm-gpt-mode" type="checkbox">GPT 模式（仅使用 GPT 时勾选）</label>
                    <p class="wsm-settings-help">默认关闭，Gemini 保持原来的读取方式。勾选后，GPT 会在本地把旧聊天整理成分层时间块并精简世界书冗余元数据，再分成最多 2 批；读取采用流式返回和低推理强度，避免反代超时或隐藏推理耗尽 JSON 输出。完整读取不超过 2 次 API。</p>
                    <div id="wsm-custom-api-fields">
                        <div class="wsm-api-profile-toolbar"><div id="wsm-api-profile-buttons"></div><button type="button" data-action="add-api-profile">＋ 新增 API</button><button type="button" data-action="delete-api-profile">删除当前</button></div>
                        <label>配置名称<input id="wsm-api-profile-name" type="text" placeholder="例如：主线路、备用线路"></label>
                        <label>OpenAI 兼容 API 地址<input id="wsm-endpoint" type="text" placeholder="https://example.com/v1"></label>
                        <label>API Key<input id="wsm-key" type="password" autocomplete="off"></label>
                        <div class="wsm-grid"><label>温度<input id="wsm-temperature" type="number" step="0.05"></label></div>
                        <div class="wsm-api-profile-actions"><button type="button" data-action="fetch-models">自动拉取模型</button><button type="button" data-action="test-custom-api">测试当前配置</button><small id="wsm-api-profile-status">尚未测试</small></div>
                        <label class="wsm-model-picker">模型<input id="wsm-model" type="text" list="wsm-model-options" placeholder="可手动输入或从下方完整列表选择"><datalist id="wsm-model-options"></datalist><select id="wsm-model-list" size="12" aria-label="已拉取的完整模型列表" hidden></select><small>自动拉取后，完整模型列表会显示在这里；也可以手动输入模型名。</small></label>
                    </div>
                    <label class="wsm-jailbreak-field">破限提示词（可选，可自行输入）<textarea id="wsm-jailbreak-prompt" placeholder="留空则不添加。这里的内容会附加到状态机的系统提示词中。"></textarea></label>
                    <p class="wsm-settings-help">该内容会发送给 Planner、结算器及需要调用 API 的拆解功能，请勿填写 API Key 等敏感信息。</p>
                    <label class="wsm-check"><input id="wsm-launcher-visible" type="checkbox">显示悬浮按钮</label>
                    <p class="wsm-settings-help">关闭后仍可从酒馆魔法棒菜单中的“芝芝状态机系统”打开。</p>
                    <label class="wsm-check"><input id="wsm-follow-tavern-font" type="checkbox">字体跟随酒馆</label>
                    <div class="wsm-grid"><label>自定义字体<input id="wsm-custom-font-family" type="text" placeholder='例如："Microsoft YaHei", sans-serif'></label><label>字体大小（百分比）<input id="wsm-font-scale" type="number" min="60" max="140" step="5"></label></div>
                    <p class="wsm-settings-help">只调整状态机文字，不改变面板大小和按钮的可点击范围。建议使用 80%–100%。</p>
                    <div class="wsm-grid"><label>单次输出 Tokens<input id="wsm-max-tokens" type="number" min="256" max="16384"></label><label>注入最大字符<input id="wsm-injection-max" type="number" min="500"></label></div>
                    <p class="wsm-settings-help">Tokens 是模型单次返回 JSON 的上限。普通正文生成前只做本地注入，正文完成后状态机最多 1 次；手动完整读取无论 Gemini 或 GPT 都最多 2 次串行 API，完成第一批即保存断点；世界书手动更新最多 1 次。</p>
                    <label class="wsm-check"><input id="wsm-enabled" type="checkbox">启用自动状态机</label>
                    <p class="wsm-settings-help">打开插件或切换聊天不会自动读取和初始化。只有点击“读取并初始化”或“重新读取 / 重建”才会读取完整资料。</p>
                    <label class="wsm-check"><input id="wsm-block-on-planner-error" type="checkbox">Planner失败时严格阻止正文生成</label>
                </section>
                <section class="wsm-settings-section" data-settings-section="source">
                    <p class="wsm-settings-help">“分解正文”页面只管理聊天正文的读取范围；它与“拆解世界书”的条目选择和缓存独立，不会把聊天楼层列成世界书条目。</p>
                    <div class="wsm-grid"><label>普通轮次读取最近正文条数（0=全部可见正文）<input id="wsm-recent-messages" type="number" min="0" max="200"></label></div>
                    <section class="wsm-rollback-panel"><b>${icon('clipboard')}<span>本地全量扫描，按模型选择压缩方式</span></b><p>只有点击“读取当前聊天”或“重新读取 / 重建”时才扫描完整聊天。插件本地遍历每个楼层并保留来源顺序；GPT 模式会把旧正文按时间块压缩、最近正文保留更高分辨率，然后仍只执行最多两批读取。普通生成每轮只在正文结束后结算一次。</p><small>角色卡、Persona、世界书和完整聊天原文不会被替换或删除，仍留在酒馆作为权威来源。运行状态只保留会影响连续性的 L3/L2 和当前 L1。</small></section>
                </section>
                <section class="wsm-settings-section" data-settings-section="pacing">
                    <p class="wsm-settings-help">控制正文模型每轮允许推进的最大幅度。关闭时保持正文模型原有节奏；该功能不会替模型规划剧情，也不会改变既定事实。</p>
                    <label>推进速度<select id="wsm-story-pacing-mode"><option value="off">关闭（使用正文模型原本节奏）</option><option value="verySlow">极慢</option><option value="slow">慢速</option><option value="medium">中速</option><option value="fast">快速</option></select></label>
                    <label class="wsm-check"><input id="wsm-pacing-scene-transition" type="checkbox">允许自动切换场景</label>
                    <label class="wsm-check"><input id="wsm-pacing-time-skip" type="checkbox">允许自动时间跳跃</label>
                    <section class="wsm-rollback-panel"><b>${icon('process')}<span>只控制幅度，不控制强度</span></b><p>快速不等于频繁制造大事；极慢也不等于人物停止生活。所有档位都只能沿既有事实、人物动机和当前场景自然推进。</p></section>
                    <section class="wsm-rollback-panel"><b>${icon('check')}<span>用户决策点必须停下</span></b><p>遇到是否跟随、签署、承诺、告白、离开、接受方案或改变立场等需要玩家亲自选择的节点，任何速度都必须等待用户决定。</p></section>
                </section>
                <section class="wsm-settings-section" data-settings-section="dice">
                    <label class="wsm-check"><input id="wsm-dice-enabled" type="checkbox">启用共享骰池</label>
                    <p class="wsm-settings-help">默认关闭。启用后，程序每轮生成一个共享随机种和 1–3 枚顺序骰，为多个合理未来提供统一随机源。它不决定剧情是否推进，也不修改“剧情节奏”设置。</p>
                    <section class="wsm-rollback-panel"><b>${icon('check')}<span>什么时候检定</span></b><p>只有结果同时具备不确定性、现实阻力和有意义的成败后果时才消耗检定骰。日常必然行为、无压力过渡、显而易见的信息、普通对话和一般思考不检定。</p><small>1=大失败，2–10=失败，11–19=成功，20=大成功。</small></section>
                </section>
                <section class="wsm-settings-section" data-settings-section="worldbook">
                    <p class="wsm-settings-help">这里只拆解世界书，不分解聊天正文。原文始终完整保留为唯一来源；勾中的条目会建立段落覆盖、统一事实目录与分类投影，运行时只抑制原生重复并由最终注入器按 factId 发送一次。其他条目继续保持酒馆原本的处理方式。</p>
                    <label class="wsm-check"><input id="wsm-worldbook-compiler-enabled" type="checkbox">启用拆解世界书</label>
                    <div class="wsm-grid"><label>每轮精简字数<input id="wsm-worldbook-compiler-budget" type="number" min="120" max="2000"></label><label>用于匹配的正文条数<input id="wsm-worldbook-compiler-context" type="number" min="2" max="30"></label></div>
                    <label class="wsm-check"><input id="wsm-worldbook-compiler-fail-closed" type="checkbox" checked disabled>无法确认原文已安全处理时，固定阻止正文请求</label>
                    <div id="wsm-worldbook-picker" class="wsm-worldbook-picker"></div>
                    <div class="wsm-worldbook-compiler-tools"><button type="button" data-action="refresh-worldbook-entries">刷新当前世界书</button><button type="button" data-action="compile-worldbook-entries">立即拆解已勾选条目</button><button type="button" data-action="clear-worldbook-cache">清空拆解缓存</button><small id="wsm-worldbook-compiler-status">尚未运行</small></div>
                    <div id="wsm-worldbook-compiler-list"></div>
                </section>
                <section class="wsm-settings-section" data-settings-section="injection"><p class="wsm-settings-help">勾选需要发送给正文模型的状态模块。状态按重要性固定分配到深度 0–4；已拆解世界书沿用原条目的世界书深度。</p><div id="wsm-injection-module-list"></div></section>
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
            <div id="wsm-organize-modal" class="wsm-submodal" hidden><div class="wsm-dialog"><header><b>整理状态</b><button class="wsm-icon-button" data-action="close-organize" aria-label="关闭">${icon('close')}</button></header><div class="wsm-settings-scroll">
                <section class="wsm-rollback-panel"><b>${icon('brain')}<span>智能整理</span></b><p>重新整理当前结构化状态：合并重复与旧版本、删除失效的临时信息，并压缩较早时间线。核心事实、重要秘密和仍在推进的事项会保留。</p><small>本地执行，不调用 AI，不重新总结或修改原始世界书。</small><button data-action="organize-smart">智能整理</button></section>
                <section class="wsm-rollback-panel"><b>${icon('check')}<span>清理临时信息</span></b><p>只移除已经失效且当前不再相关的临时信息；核心事实以及正在使用的任务、事件、线程和进程不会改变。</p><small>适合只想做保守清理时使用。</small><button data-action="organize-temporary">清理临时信息</button></section>
                <section class="wsm-rollback-panel"><b>${icon('history')}<span>可以撤销</span></b><p>整理前会自动建立版本快照，完成后生成新的 REV。效果不合适时可使用顶部“回滚上一轮”。</p></section>
            </div></div></div>
            <div id="wsm-history-modal" class="wsm-submodal" hidden><div class="wsm-dialog wsm-history"><header><b>版本快照</b><button class="wsm-icon-button" data-action="close-history" aria-label="关闭">${icon('close')}</button></header><div id="wsm-history-list"></div></div></div>`;
    }
    function render() {
        const state = WSM.Storage.load();
        syncWorldbookSections(state);
        const [title] = sectionMap[active] || sectionMap.worldbookEmpty;
        renderOperationStatus(WSM.Engine?.getProgress?.() || {}, state);
        $('#wsm-section-title').innerHTML = `<h3>${escape(title)}</h3>`;
        $('#wsm-game-view').innerHTML = renderGameView(state);
        $('#wsm-game-view').hidden = editMode;
        $('#wsm-editor').value = formatHuman(state);
        $('#wsm-editor').hidden = !editMode;
        $('.wsm-editor-actions').hidden = !editMode;
        const toolbar = $('.wsm-view-toolbar');
        const editButton = toolbar?.querySelector('[data-action="toggle-edit"]');
        const worldbookModule = isWorldbookSection(active);
        toolbar.hidden = editMode || active === 'sources' || active === 'worldbookEmpty';
        if (editButton) {
            editButton.title = worldbookModule ? '修改本条拆解规则' : (active === 'injection' ? '修改下一次最终注入' : '编辑当前栏目');
            editButton.setAttribute('aria-label', editButton.title);
        }
        renderNavigation();
        bindHorizontalNavigation();
        revealHorizontalItem(root.querySelector('.wsm-category-bar'), root.querySelector(`[data-category-select="${activeCategory}"]`));
    }
    function renderOperationStatus(progress = WSM.Engine?.getProgress?.() || {}, state = WSM.Storage.load()) {
        const status = $('#wsm-status');
        const operation = $('#wsm-operation-status');
        const readCurrent = $('#wsm-read-current');
        const clearRead = $('#wsm-clear-read');
        if (!operation || !readCurrent || !clearRead) return;
        if (status) {
            status.textContent = progress.state === 'running' ? '正在读取…' : (state.initialized ? `REV ${state.revision} · ${state.world?.time?.display || '时间未定'}` : '等待初始化');
            status.dataset.state = progress.state === 'success' || (state.initialized && progress.state !== 'running' && progress.state !== 'error') ? 'success' : (progress.state || 'idle');
        }
        const effectiveProgressState = progress.state === 'running' || progress.state === 'error' || progress.state === 'cancelled'
            ? progress.state
            : (progress.state === 'success' || state.initialized ? 'success' : 'idle');
        operation.dataset.state = effectiveProgressState;
        operation.querySelector('.wsm-operation-current>b').textContent = progress.message || (state.initialized ? '读取完成，基准快照已建立' : '读取进度：等待开始');
        const audit = WSM.Storage.historyAudit?.() || state.runtime?.sourceSummary?.sourceRead?.audit;
        const auditText = audit ? `正文 ${audit.processedMessages || 0}/${audit.totalReadableMessages || 0} 层 · 失败 ${Number(audit.failedMessages || 0) + Number(audit.failedChunks || 0)} · 隐藏纳入 ${audit.hiddenIncluded || 0} · API ${audit.requestAttempts || 0} 次 · 缓存 ${audit.cacheHits || 0} 次 · 总用时 ${formatDuration(audit.durationMs || 0)}` : '';
        const liveElapsed = progress.state === 'running' && progress.startedAt ? ` · 已用时 ${formatDuration(Date.now() - progress.startedAt)}` : '';
        operation.querySelector('.wsm-operation-current>small').textContent = `${progress.details || auditText || '点击后在此显示当前步骤。'}${liveElapsed}`;
        const history = operation.querySelector('.wsm-operation-steps');
        // The expanded trail is useful only while a read is actively running.
        // Once it finishes, the compact current row already contains the final
        // result and timing; keeping every completed phase below it adds noise.
        const steps = progress.state === 'running' && Array.isArray(progress.steps) ? progress.steps.slice(-6) : [];
        history.hidden = progress.state !== 'running' || steps.length < 2;
        history.innerHTML = steps.map((step, index) => {
            const latest = index === steps.length - 1;
            const visualState = latest ? String(step.state || 'running') : 'done';
            const marker = visualState === 'error' ? '×' : (visualState === 'cancelled' ? '■' : (visualState === 'done' || visualState === 'success' ? '✓' : '●'));
            return `<div data-state="${escape(visualState)}"><span>${marker}</span><b>${escape(step.message || '读取步骤')}</b>${step.details ? `<small>${escape(step.details)}</small>` : ''}</div>`;
        }).join('');
        const reading = WSM.Engine?.isReading?.() === true;
        readCurrent.textContent = reading ? '终止读取' : '读取当前聊天';
        readCurrent.dataset.action = reading ? 'cancel-read' : 'read-current';
        readCurrent.disabled = progress.state === 'running' && !reading;
        clearRead.disabled = progress.state === 'running';
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
            if (active === 'injection') {
                await WSM.WorldbookCompiler?.setWorldbookPrompts?.({});
                await WSM.Engine?.syncRegisteredPrompt?.();
            }
            editMode = false;
            notify(active === 'injection' ? '最终注入已保存，将用于下一次正文生成' : '状态已保存', 'success');
            render();
        } catch (error) { notify(`保存失败：${error.message}`, 'error'); }
    }
    function fillSettings(tabName = 'api') {
        const s = WSM.Settings.get();
        activeSettingsTab = tabName;
        apiProfilesDraft = WSM.Storage.clone(s.apiProfiles || []);
        activeApiProfileId = s.activeApiProfileId || apiProfilesDraft[0]?.id || '';
        $('#wsm-use-tavern-api').checked = s.useTavernApi !== false;
        $('#wsm-gpt-mode').checked = s.gptMode === true;
        $('#wsm-jailbreak-prompt').value = s.jailbreakPrompt || '';
        $('#wsm-follow-tavern-font').checked = s.followTavernFont !== false;
        $('#wsm-launcher-visible').checked = s.launcherVisible !== false;
        $('#wsm-custom-font-family').value = s.customFontFamily || '';
        $('#wsm-font-scale').value = Math.round(Number(s.fontScale || 0.9) * 100);
        loadActiveApiProfile();
        $('#wsm-temperature').value = s.temperature ?? 0.15;
        $('#wsm-max-tokens').value = s.maxTokens || 5000;
        $('#wsm-recent-messages').value = s.recentMessages ?? 12;
        $('#wsm-injection-max').value = s.injectionMaxChars || 3500;
        $('#wsm-enabled').checked = s.enabled !== false;
        $('#wsm-block-on-planner-error').checked = s.blockOnPlannerError === true;
        $('#wsm-dice-enabled').checked = s.diceEnabled === true;
        $('#wsm-story-pacing-mode').value = s.storyPacing?.mode || 'off';
        $('#wsm-pacing-scene-transition').checked = s.storyPacing?.allowSceneTransition === true;
        $('#wsm-pacing-time-skip').checked = s.storyPacing?.allowTimeSkip === true;
        $('#wsm-planner-prompt').value = s.plannerPrompt || '';
        $('#wsm-reconciler-prompt').value = s.reconcilerPrompt || '';
        renderInjectionModuleSettings(s);
        renderModulePromptSettings(s);
        void renderWorldbookCompilerSettings(s);
        $('#wsm-settings-history-list').innerHTML = historyHtml();
        renderSettingsTabs();
        syncApiModeFields();
        syncPacingFields();
        syncTypographyFields();
        $('#wsm-settings-modal').hidden = false;
    }
    function typographyFromForm() {
        return {
            followTavernFont: $('#wsm-follow-tavern-font')?.checked !== false,
            customFontFamily: $('#wsm-custom-font-family')?.value.trim() || 'Inter, "Microsoft YaHei", sans-serif',
            fontScale: Math.min(1.4, Math.max(0.6, Number($('#wsm-font-scale')?.value || 90) / 100)),
        };
    }
    function applyTypographySettings(settings) {
        if (!root) return;
        const scale = Math.min(1.4, Math.max(0.6, Number(settings?.fontScale || 0.9)));
        root.style.setProperty('--wsm-font-scale', String(scale));
        root.style.setProperty('--wsm-font-family', settings?.followTavernFont !== false ? 'inherit' : (settings?.customFontFamily || 'Inter, "Microsoft YaHei", sans-serif'));
    }
    function syncTypographyFields() {
        const follow = $('#wsm-follow-tavern-font')?.checked !== false;
        if ($('#wsm-custom-font-family')) $('#wsm-custom-font-family').disabled = follow;
        applyTypographySettings(typographyFromForm());
    }
    function activeApiProfile() {
        return apiProfilesDraft.find((profile) => profile.id === activeApiProfileId) || apiProfilesDraft[0];
    }
    function captureActiveApiProfile() {
        const profile = activeApiProfile();
        if (!profile) return;
        profile.name = $('#wsm-api-profile-name').value.trim() || profile.name || '未命名 API';
        profile.endpoint = $('#wsm-endpoint').value.trim();
        profile.model = $('#wsm-model').value.trim();
        profile.apiKey = $('#wsm-key').value.trim();
    }
    function renderApiProfileButtons() {
        const container = $('#wsm-api-profile-buttons');
        if (!container) return;
        container.innerHTML = apiProfilesDraft.map((profile) => `<button type="button" data-api-profile-id="${escape(profile.id)}" class="${profile.id === activeApiProfileId ? 'active' : ''}">${escape(profile.name || '未命名 API')}</button>`).join('');
    }
    function loadActiveApiProfile() {
        const profile = activeApiProfile();
        if (!profile) return;
        activeApiProfileId = profile.id;
        $('#wsm-api-profile-name').value = profile.name || '';
        $('#wsm-endpoint').value = profile.endpoint || '';
        $('#wsm-model').value = profile.model || '';
        $('#wsm-key').value = profile.apiKey || '';
        renderApiProfileButtons();
        renderModelList(profile);
        if ($('#wsm-api-profile-status')) $('#wsm-api-profile-status').textContent = '尚未测试';
    }
    function renderModelList(profile = activeApiProfile()) {
        const input = $('#wsm-model');
        const datalist = $('#wsm-model-options');
        const list = $('#wsm-model-list');
        if (!input || !datalist || !list) return;
        const models = apiModelsByProfile.get(profile?.id) || [];
        const current = input.value.trim();
        const choices = [...new Set([...(current ? [current] : []), ...models])];
        datalist.innerHTML = choices.map((model) => `<option value="${escape(model)}"></option>`).join('');
        list.innerHTML = choices.map((model) => `<option value="${escape(model)}">${escape(model)}</option>`).join('');
        list.hidden = choices.length === 0;
        if (current) list.value = current;
    }
    function apiProfilePatch() {
        captureActiveApiProfile();
        const profile = activeApiProfile();
        return {
            apiProfiles: WSM.Storage.clone(apiProfilesDraft), activeApiProfileId,
            endpoint: profile?.endpoint || '', apiKey: profile?.apiKey || '', model: profile?.model || '',
        };
    }
    function switchApiProfile(id) {
        if (!apiProfilesDraft.some((profile) => profile.id === id)) return;
        captureActiveApiProfile();
        activeApiProfileId = id;
        loadActiveApiProfile();
        WSM.Settings.update(apiProfilePatch());
    }
    function syncApiModeFields() {
        const useTavernApi = $('#wsm-use-tavern-api')?.checked !== false;
        const fields = $('#wsm-custom-api-fields');
        fields?.classList.toggle('wsm-disabled-fields', useTavernApi);
        fields?.querySelectorAll('input, select, button').forEach((input) => { input.disabled = useTavernApi; });
    }
    function syncPacingFields() {
        const enabled = $('#wsm-story-pacing-mode')?.value !== 'off';
        if ($('#wsm-pacing-scene-transition')) $('#wsm-pacing-scene-transition').disabled = !enabled;
        if ($('#wsm-pacing-time-skip')) $('#wsm-pacing-time-skip').disabled = !enabled;
    }
    async function saveSettings(closeAfter = true) {
        const current = WSM.Settings.get();
        const injectionModules = WSM.Storage.clone(current.injectionModules || WSM.Defaults.INJECTION_MODULES);
        root.querySelectorAll('[data-module-enabled]').forEach((input) => { injectionModules[input.dataset.moduleEnabled].enabled = input.checked; });
        const modulePrompts = Object.assign({}, current.modulePrompts || WSM.Defaults.MODULE_PROMPTS);
        root.querySelectorAll('[data-module-prompt]').forEach((input) => { modulePrompts[input.dataset.modulePrompt] = input.value.trim(); });
        const bookChoices = Array.from(root.querySelectorAll('[data-worldbook-book-choice]'));
        const entryChoices = Array.from(root.querySelectorAll('[data-worldbook-entry-choice]'));
        const selectedBookNames = bookChoices.length ? bookChoices.filter((input) => input.checked).map((input) => input.value) : (current.worldbookCompiler?.selectedBookNames || []);
        const selectedEntryKeys = entryChoices.length ? entryChoices.filter((input) => input.checked).map((input) => input.value) : (current.worldbookCompiler?.entryKeys || []);
        let worldbookCompiler = WSM.WorldbookCompiler.normalizeConfig({
            ...current.worldbookCompiler,
            enabled: $('#wsm-worldbook-compiler-enabled').checked,
            selectedBookNames,
            budget: Number($('#wsm-worldbook-compiler-budget').value || 500),
            contextMessages: Number($('#wsm-worldbook-compiler-context').value || 8),
            failClosed: $('#wsm-worldbook-compiler-fail-closed').checked,
        });
        if (bookChoices.length) worldbookCompiler = worldbookSelectionConfig(worldbookCompiler, selectedBookNames, selectedEntryKeys, [...new Set(worldbookEntriesCache.map((entry) => entry.bookName))]);
        WSM.Settings.update({
            ...apiProfilePatch(),
            useTavernApi: $('#wsm-use-tavern-api').checked,
            gptMode: $('#wsm-gpt-mode').checked,
            jailbreakPrompt: $('#wsm-jailbreak-prompt').value,
            ...typographyFromForm(),
            launcherVisible: $('#wsm-launcher-visible').checked,
            temperature: Number($('#wsm-temperature').value), maxTokens: Math.max(256, Math.min(16384, Number($('#wsm-max-tokens').value) || 5000)), enabled: $('#wsm-enabled').checked,
            autoInitialize: false,
            blockOnPlannerError: $('#wsm-block-on-planner-error').checked,
            diceEnabled: $('#wsm-dice-enabled').checked,
            storyPacing: {
                mode: $('#wsm-story-pacing-mode').value,
                allowSceneTransition: $('#wsm-pacing-scene-transition').checked,
                allowTimeSkip: $('#wsm-pacing-time-skip').checked,
            },
            recentMessages: Math.max(0, Math.min(200, Math.round(Number($('#wsm-recent-messages').value) || 0))),
            injectionMaxChars: Number($('#wsm-injection-max').value || 3500), injectionModules, modulePrompts,
            plannerPrompt: $('#wsm-planner-prompt').value, reconcilerPrompt: $('#wsm-reconciler-prompt').value, worldbookCompiler,
        });
        const state = WSM.Storage.load();
        state.runtime ||= {};
        state.planner ||= {};
        delete state.runtime.finalInjectionOverride;
        state.planner.injection = WSM.Injection.compose(state, state.planner?.plan || {}, state.planner?.moduleInjections || {});
        await WSM.Storage.save(state, 'injection-settings', { snapshot: false });
        await WSM.Engine?.syncRegisteredPrompt?.();
        if (closeAfter) $('#wsm-settings-modal').hidden = true;
        notify('设置已保存', 'success');
    }
    function showHistory() {
        $('#wsm-history-list').innerHTML = historyHtml();
        $('#wsm-history-modal').hidden = false;
    }
    async function handleAction(action) {
        if (action === 'close') close();
        if (action === 'organize') $('#wsm-organize-modal').hidden = false;
        if (action === 'gpt-local-fix') {
            try {
                await WSM.Engine.refreshGptLocalState();
                await WSM.Engine.syncRegisteredPrompt();
                render();
                notify('本地重建完成：未调用 API，已从原文恢复客观重大事件并清理主观臆测。', 'success');
            } catch (error) { notify(`本地重建失败：${error.message}`, 'error'); }
        }
        if (action === 'close-organize') $('#wsm-organize-modal').hidden = true;
        if (action === 'organize-smart' || action === 'organize-temporary') {
            const temporary = action === 'organize-temporary';
            const label = temporary ? '清理临时信息' : '智能整理';
            if (!window.confirm(`确定执行“${label}”？整理前会建立可回滚快照，不会修改原始世界书。`)) return;
            try {
                const result = await WSM.Storage.organizeState(temporary ? 'temporary' : 'smart');
                if (WSM.Settings.get().gptMode === true) await WSM.Engine?.refreshGptLocalState?.();
                await WSM.Engine?.syncRegisteredPrompt?.();
                $('#wsm-organize-modal').hidden = true;
                render();
                notify(`${label}完成：状态条目 ${result.beforeItems} → ${result.afterItems}，时间线 ${result.beforeTimeline} → ${result.afterTimeline}；已生成新 REV`, 'success');
            } catch (error) { notify(`${label}失败：${error.message}`, 'error'); }
        }
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
            if (!window.confirm('确定回滚上一轮状态版本？这不会删除 SillyTavern 中的聊天消息或修改原始世界书。')) return;
            await WSM.Storage.rollbackPreviousGeneration();
            render();
            fillSettings('history');
            notify('已回滚上一轮状态版本', 'success');
        }
        if (action === 'close-history') $('#wsm-history-modal').hidden = true;
        if (action === 'toggle-edit') { editMode = true; render(); }
        if (action === 'reload') { editMode = false; render(); }
        if (action === 'save-section') await saveSection();
        if (action === 'cancel-read') {
            WSM.Engine.cancelRead?.();
            renderOperationStatus();
        }
        if (action === 'clear-read') {
            if (!window.confirm('确定彻底清空本聊天的全部状态机内容？这会删除当前状态、硬规则、世界书拆解与注入缓存、剧情推进、读取缓存、已注册的AI注入和全部回滚版本；不会删除 SillyTavern 聊天消息、角色卡、Persona 或原始世界书。清空后再次“读取当前聊天”会从零建立全新状态。')) return;
            try {
                await WSM.Storage.clearAll();
                WSM.Engine.resetProgress?.();
                await WSM.Engine?.syncRegisteredPrompt?.();
                render();
                notify('已清空全部状态机内容；再次读取会建立全新状态', 'success');
            } catch (error) { notify(`清空失败：${error.message}`, 'error'); }
        }
        if (action === 'initialize') {
            if (!window.confirm('确定重新读取完整聊天并重建状态？当前状态会被新的读取结果替换。')) return;
            let planner;
            try { planner = await WSM.Engine.plan({ force: true, initialize: true, interactiveRead: true }); }
            catch (error) { WSM.Engine.reportProgress?.('读取或初始化失败', 'error', error.message); planner = { error: error.message }; }
            render();
        }
        if (action === 'read-current') {
            const initialized = WSM.Storage.load().initialized;
            WSM.Engine.reportProgress?.('正在准备读取当前聊天', 'running', '正在检查聊天、模型连接和资料来源…');
            let planner;
            try {
                planner = await WSM.Engine.plan({
                    force: true,
                    initialize: !initialized,
                    // Once a state exists, this is still a refresh (not a
                    // destructive rebuild), but it must read every chat item.
                    readFullChat: initialized,
                    interactiveRead: true,
                });
            }
            catch (error) { WSM.Engine.reportProgress?.('读取或初始化失败', 'error', error.message); planner = { error: error.message }; }
            if (planner?.error) WSM.Engine.reportProgress?.('读取当前聊天失败', 'error', planner.error);
            render();
        }
        if (action === 'test-api') {
            await saveSettings(false);
            try { await WSM.Api.test(); notify('API 连接成功', 'success'); }
            catch (error) { notify(`API 测试失败：${error.message}`, 'error'); }
        }
        if (action === 'add-api-profile') {
            captureActiveApiProfile();
            const id = `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
            apiProfilesDraft.push({ id, name: `API ${apiProfilesDraft.length + 1}`, endpoint: '', apiKey: '', model: '' });
            activeApiProfileId = id;
            loadActiveApiProfile();
            WSM.Settings.update(apiProfilePatch());
        }
        if (action === 'delete-api-profile') {
            if (apiProfilesDraft.length <= 1) { notify('至少需要保留一个自定义 API 配置', 'error'); return; }
            if (!window.confirm(`确定删除“${activeApiProfile()?.name || '当前 API'}”配置？`)) return;
            const index = apiProfilesDraft.findIndex((profile) => profile.id === activeApiProfileId);
            if (index >= 0) apiProfilesDraft.splice(index, 1);
            activeApiProfileId = apiProfilesDraft[Math.max(0, index - 1)]?.id || apiProfilesDraft[0].id;
            loadActiveApiProfile();
            WSM.Settings.update(apiProfilePatch());
            notify('已删除当前 API 配置');
        }
        if (action === 'fetch-models') {
            captureActiveApiProfile();
            const status = $('#wsm-api-profile-status');
            status.textContent = '正在拉取模型…';
            try {
                const models = await WSM.Api.listModels(activeApiProfile());
                apiModelsByProfile.set(activeApiProfileId, models);
                if (!$('#wsm-model').value && models[0]) $('#wsm-model').value = models[0];
                renderModelList(activeApiProfile());
                captureActiveApiProfile();
                WSM.Settings.update(apiProfilePatch());
                status.textContent = `已获取 ${models.length} 个模型，点击模型输入框选择`;
                notify(`已拉取 ${models.length} 个模型`, 'success');
            } catch (error) { status.textContent = `拉取失败：${error.message}`; notify(`模型拉取失败：${error.message}`, 'error'); }
        }
        if (action === 'test-custom-api') {
            captureActiveApiProfile();
            WSM.Settings.update(apiProfilePatch());
            const status = $('#wsm-api-profile-status');
            status.textContent = '正在测试…';
            try { await WSM.Api.test({ forceExternal: true }); status.textContent = '连接可用'; notify('当前自定义 API 可用', 'success'); }
            catch (error) { status.textContent = `测试失败：${error.message}`; notify(`API 测试失败：${error.message}`, 'error'); }
        }
        if (action === 'refresh-worldbook-entries') {
            await renderWorldbookCompilerSettings(WSM.Settings.get(), true);
            notify('当前启用及角色绑定的世界书已刷新', 'success');
        }
        if (action === 'toggle-worldbook-picker') {
            const menu = root.querySelector('[data-worldbook-picker-menu]');
            const button = root.querySelector('[data-action="toggle-worldbook-picker"]');
            if (menu) menu.hidden = !menu.hidden;
            button?.setAttribute('aria-expanded', String(menu ? !menu.hidden : false));
        }
        if (action === 'compile-worldbook-entries') {
            await saveSettings(false);
            const status = $('#wsm-worldbook-compiler-status');
            const button = root.querySelector('[data-action="compile-worldbook-entries"]');
            if (status) status.textContent = '正在一次性拆解已勾选世界书，请等待 API 返回…';
            if (button) button.disabled = true;
            try {
                const result = await WSM.WorldbookCompiler.compileConfig(WSM.Settings.get().worldbookCompiler, { force: true });
                await renderWorldbookCompilerSettings(WSM.Settings.get());
                notify(`已拆解 ${result.count} 条世界书`, 'success');
            } catch (error) {
                if (status) status.textContent = `拆解失败：${error.message}`;
                notify(`拆解失败：${error.message}`, 'error');
            } finally {
                const currentButton = root.querySelector('[data-action="compile-worldbook-entries"]');
                if (currentButton) currentButton.disabled = false;
            }
        }
        if (action === 'clear-worldbook-cache') {
            WSM.WorldbookCompiler.clearCache();
            await renderWorldbookCompilerSettings(WSM.Settings.get());
            notify('拆解缓存已清空', 'success');
        }
    }
    function launcherBounds(x, y, button = document.getElementById('wsm-launcher')) {
        const width = button?.offsetWidth || 46;
        const height = button?.offsetHeight || 46;
        return {
            x: Math.max(6, Math.min(window.innerWidth - width - 6, Number(x) || 6)),
            y: Math.max(6, Math.min(window.innerHeight - height - 6, Number(y) || 6)),
        };
    }
    function placeLauncher(button, position) {
        if (!button || !position) return;
        const next = launcherBounds(position.x, position.y, button);
        button.style.setProperty('left', `${next.x}px`, 'important');
        button.style.setProperty('top', `${next.y}px`, 'important');
        button.style.setProperty('right', 'auto', 'important');
        button.style.setProperty('bottom', 'auto', 'important');
    }
    function syncLauncherVisibility(settings = WSM.Settings.get()) {
        const button = document.getElementById('wsm-launcher');
        if (!button) return;
        button.hidden = settings.launcherVisible === false;
        placeLauncher(button, settings.launcherPosition || { x: window.innerWidth - 58, y: window.innerHeight - 122 });
    }
    function bindLauncherDrag(button) {
        let drag = null;
        let suppressClick = false;
        button.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const rect = button.getBoundingClientRect();
            drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
            button.setPointerCapture?.(event.pointerId);
            button.classList.add('is-dragging');
        });
        button.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (Math.hypot(dx, dy) > 4) drag.moved = true;
            placeLauncher(button, { x: drag.left + dx, y: drag.top + dy });
        });
        const finish = (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const moved = drag.moved;
            drag = null;
            button.classList.remove('is-dragging');
            if (!moved) return;
            suppressClick = true;
            const rect = button.getBoundingClientRect();
            WSM.Settings.update({ launcherPosition: launcherBounds(rect.left, rect.top, button) });
            window.setTimeout(() => { suppressClick = false; }, 0);
        };
        button.addEventListener('pointerup', finish);
        button.addEventListener('pointercancel', finish);
        button.addEventListener('click', (event) => {
            if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            open();
        });
    }
    function mountButton() {
        const existing = document.getElementById('wsm-launcher');
        if (existing) { syncLauncherVisibility(); return; }
        const button = document.createElement('button');
        button.id = 'wsm-launcher';
        button.title = '打开芝芝状态机系统';
        button.setAttribute('aria-label', '打开芝芝状态机系统；可拖动');
        button.innerHTML = `<span>${icon('cube')}</span>`;
        bindLauncherDrag(button);
        document.body.appendChild(button);
        syncLauncherVisibility();
    }
    function selectedExternalWorldbookName(select) {
        const option = select?.selectedOptions?.[0];
        // ST's editor select may use an internal id as value while showing the
        // real book name as its label.  The world-info API needs the latter.
        return String(option?.textContent || option?.label || option?.value || select?.value || '').trim();
    }
    async function compileExternalWorldbook(select, button) {
        if (externalWorldbookButtonBusy) return;
        const bookName = selectedExternalWorldbookName(select);
        if (!bookName) { notify('请先在世界书编辑器中选择一本世界书', 'error'); return; }
        externalWorldbookButtonBusy = true;
        button.disabled = true;
        button.textContent = '芝芝：正在读取条目…';
        try {
            const book = await WSM.Context.readWorldbook(bookName, undefined, { includeDisabled: true });
            const entries = book.entries || [];
            const availableEntries = await WSM.Context.listWorldbookEntries({ includeDisabled: true });
            const availableBookNames = [...new Set(availableEntries.map((entry) => entry.bookName))];
            if (!availableBookNames.includes(bookName)) throw new Error(`“${bookName}”只是编辑器当前打开的书，并未全局启用或绑定到当前角色；请先在酒馆启用/绑定，或在插件下拉菜单中选择当前可用世界书`);
            // One-click means exactly the book currently selected in ST's
            // editor. Replace the active entry selection instead of unioning it
            // with the previous book; old compiled cache may remain local, but
            // it must no longer be read, routed or injected.
            const readableEntries = entries.filter((entry) => entry.enabled && entry.content);
            if (!readableEntries.length) throw new Error(`未读取到“${bookName}”的条目内容（${(book.attempts || []).join('；') || '没有可用读取接口'}）`);
            const current = WSM.WorldbookCompiler.normalizeConfig(WSM.Settings.get().worldbookCompiler);
            const next = WSM.WorldbookCompiler.normalizeConfig({
                ...current,
                enabled: true,
                selectedBookNames: [bookName],
                knownBookNames: availableBookNames,
                entryKeys: [...new Set(readableEntries.map((entry) => entry.key))],
                knownEntryKeys: [...new Set(availableEntries.map((entry) => entry.key))],
            });
            WSM.Settings.update({ worldbookCompiler: next });
            button.textContent = `芝芝：正在拆解 ${readableEntries.length} 条…`;
            const result = await WSM.WorldbookCompiler.compileConfig(next, { force: true, entries: readableEntries });
            worldbookEntriesCache = [];
            notify(`“${bookName}”已一键拆解 ${result.count} 条；其他世界书已取消选择`, 'success');
        } catch (error) {
            button.textContent = '芝芝：未读取到内容（点重试）';
            button.title = `读取失败：${error.message}`;
            notify(`世界书一键拆解失败：${error.message}`, 'error');
        } finally {
            externalWorldbookButtonBusy = false;
            button.disabled = false;
            if (!button.textContent.includes('未读取到内容')) button.textContent = '芝芝：一键拆解本书';
        }
    }
    function mountExternalWorldbookButton() {
        const select = document.getElementById('world_editor_select');
        if (!(select instanceof HTMLSelectElement)) return false;
        let button = document.getElementById('wsm-worldbook-external-compile');
        if (!(button instanceof HTMLButtonElement)) {
            button = document.createElement('button');
            button.id = 'wsm-worldbook-external-compile';
            button.type = 'button';
            button.className = 'menu_button interactable';
            button.textContent = '芝芝：一键拆解本书';
            button.title = '拆解当前世界书的全部有内容条目；关闭条目只缓存，不会自动注入';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const currentSelect = document.getElementById('world_editor_select');
                if (currentSelect instanceof HTMLSelectElement) void compileExternalWorldbook(currentSelect, button);
            });
        }
        if (!button.isConnected || button.previousElementSibling !== select) select.insertAdjacentElement('afterend', button);
        return true;
    }
    function mountWandMenuItem() {
        if (document.getElementById('wsm-wand-menu-item')) return true;
        const menu = document.getElementById('extensionsMenu');
        if (!(menu instanceof HTMLElement)) return false;

        let container = document.getElementById('wsm-wand-container');
        if (!(container instanceof HTMLElement) || container.parentElement !== menu) container = document.createElement('div');
        container.id = 'wsm-wand-container';
        container.className = 'extension_container interactable';
        container.tabIndex = 0;
        container.replaceChildren();

        const item = document.createElement('a');
        item.id = 'wsm-wand-menu-item';
        item.className = 'list-group-item';
        item.href = '#';
        item.title = '打开芝芝状态机系统';
        item.innerHTML = '<i class="fa-solid fa-cubes-stacked"></i><span>芝芝状态机系统</span>';
        container.appendChild(item);
        menu.prepend(container);
        return true;
    }
    function bindWandMenuClick() {
        if (wandMenuClickBound) return;
        wandMenuClickBound = true;
        document.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target.closest('#wsm-wand-menu-item') : null;
            if (!target) return;
            event.preventDefault();
            event.stopPropagation();
            open();
            const menu = document.getElementById('extensionsMenu');
            if (menu instanceof HTMLElement) menu.style.display = 'none';
        }, true);
    }
    function mountWandMenuItemWhenReady() {
        bindWandMenuClick();
        mountWandMenuItem();
        // Some UI/theme extensions rebuild the wand menu after startup. Keep
        // this tiny idempotent check alive so our entry is restored if removed.
        window.setInterval(() => { mountWandMenuItem(); mountExternalWorldbookButton(); }, 1000);
    }
    function mount() {
        if (document.getElementById('wsm-root')) return;
        root = document.createElement('div');
        root.id = 'wsm-root';
        root.innerHTML = modalHtml();
        // Run before document/theme bubble handlers. Several mobile themes
        // stop delegated click events, which otherwise leaves visible controls inert.
        root.addEventListener('click', async (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const consume = () => { event.preventDefault(); };
            const intent = target.closest('[data-wsm-intent-action]');
            if (intent) {
                consume();
                await sendInteractiveIntent(intent.dataset.wsmIntentModule, intent.dataset.wsmIntentItem, intent.dataset.wsmIntentAction);
                return;
            }
            const worldbookChoice = target.closest('[data-worldbook-book-choice],[data-worldbook-entry-choice]');
            if (worldbookChoice) {
                // Keep the book picker/details open while selecting entries.
                event.stopPropagation();
                return;
            }
            const summary = target.closest('summary');
            if (summary && root.contains(summary) && summary.parentElement instanceof HTMLDetailsElement) {
                consume();
                summary.parentElement.open = !summary.parentElement.open;
                return;
            }
            const category = target.closest('[data-category-select]')?.dataset.categorySelect;
            if (category) {
                consume();
                activeCategory = category;
                if (!categories[category].sections.includes(active)) active = categories[category].sections[0] || (category === 'worldbook' ? 'worldbookEmpty' : 'overview');
                editMode = false;
                render();
                return;
            }
            const settingsTab = target.closest('[data-settings-tab]')?.dataset.settingsTab;
            if (settingsTab) { consume(); activeSettingsTab = settingsTab; renderSettingsTabs(); if (settingsTab === 'worldbook') await renderWorldbookCompilerSettings(); return; }
            const mapModeButton = target.closest('[data-map-mode]');
            if (mapModeButton) { consume(); activeMapMode = mapModeButton.dataset.mapMode === 'all' ? 'all' : 'known'; render(); return; }
            const tab = target.closest('[data-tab]');
            if (tab) { consume(); active = tab.dataset.tab; activeCategory = categoryForSection(active); editMode = false; render(); return; }
            const apiProfileId = target.closest('[data-api-profile-id]')?.dataset.apiProfileId;
            if (apiProfileId) { consume(); switchApiProfile(apiProfileId); return; }
            const action = target.closest('[data-action]')?.dataset.action;
            if (action) { consume(); await handleAction(action); return; }
        }, true);
        root.addEventListener('change', (event) => {
            if (event.target?.id === 'wsm-map-search') { activeMapSearch = event.target.value || ''; render(); return; }
            const changed = event.target instanceof HTMLInputElement ? event.target : null;
            if (changed?.matches('[data-worldbook-book-choice],[data-worldbook-entry-choice]')) {
                const current = WSM.WorldbookCompiler.normalizeConfig(WSM.Settings.get().worldbookCompiler);
                const candidateNames = [...new Set(worldbookEntriesCache.map((entry) => entry.bookName))];
                const selectedBookNames = [...root.querySelectorAll('[data-worldbook-book-choice]')].filter((input) => input.checked).map((input) => input.value);
                let selectedEntryKeys = [...root.querySelectorAll('[data-worldbook-entry-choice]')].filter((input) => input.checked).map((input) => input.value);
                if (changed.matches('[data-worldbook-book-choice]')) {
                    selectedEntryKeys = current.entryKeys.filter((key) => worldbookEntriesCache.some((entry) => entry.key === key && selectedBookNames.includes(entry.bookName)));
                    $('#wsm-worldbook-compiler-list').innerHTML = selectedWorldbookCards(selectedBookNames, selectedEntryKeys);
                }
                const next = worldbookSelectionConfig(current, selectedBookNames, selectedEntryKeys, candidateNames);
                WSM.Settings.update({ worldbookCompiler: next });
                const label = root.querySelector('[data-worldbook-picker-label]');
                if (label) label.textContent = selectedBookNames.length ? `显示 ${selectedBookNames.length} 本，已勾选 ${next.entryKeys.length} 条` : '没有选择世界书，点击这里选择';
                return;
            }
            if (event.target?.id === 'wsm-use-tavern-api') {
                syncApiModeFields();
                // API mode is operational, not a cosmetic draft. Persist it at
                // the moment the switch changes so closing Settings with the X
                // cannot leave a checked “follow ST” box while reads still use
                // the previous custom profile.
                WSM.Settings.update({ useTavernApi: event.target.checked });
            }
            if (event.target?.id === 'wsm-launcher-visible') {
                WSM.Settings.update({ launcherVisible: event.target.checked });
                syncLauncherVisibility();
            }
            if (event.target?.id === 'wsm-follow-tavern-font') syncTypographyFields();
            if (event.target?.id === 'wsm-story-pacing-mode') syncPacingFields();
            if (event.target?.id === 'wsm-api-profile-name') { captureActiveApiProfile(); renderApiProfileButtons(); }
            if (event.target?.id === 'wsm-model-list') {
                $('#wsm-model').value = event.target.value;
                captureActiveApiProfile();
            }
        });
        root.addEventListener('input', (event) => {
            if (event.target?.id === 'wsm-font-scale' || event.target?.id === 'wsm-custom-font-family') applyTypographySettings(typographyFromForm());
            if (event.target?.id === 'wsm-model') {
                const list = $('#wsm-model-list');
                if (list) list.value = event.target.value;
                captureActiveApiProfile();
            }
        });
        document.body.appendChild(root);
        bindHorizontalNavigation();
        applyTypographySettings(WSM.Settings.get());
        mountButton();
        mountWandMenuItemWhenReady();
        mountExternalWorldbookButton();
        window.addEventListener('wsm-state-changed', () => { if (!$('#wsm-modal')?.hidden) render(); });
        window.addEventListener('wsm-settings-changed', () => syncLauncherVisibility());
        window.addEventListener('resize', () => {
            const button = document.getElementById('wsm-launcher');
            if (!button || button.hidden) return;
            const rect = button.getBoundingClientRect();
            placeLauncher(button, launcherBounds(rect.left, rect.top, button));
        });
        // Reading large chats reports many small progress updates. Redrawing the
        // complete panel for each one can reset scroll/focus and, in some
        // SillyTavern themes, hide the status row before the final result is
        // rendered. Only this compact status row needs to change here.
        window.addEventListener('wsm-operation-progress', (event) => {
            if (!$('#wsm-modal')?.hidden) renderOperationStatus(event.detail || WSM.Engine?.getProgress?.() || {});
        });
    }
    function renderMapForTest(state) {
        const previous = active;
        active = 'map';
        try { return renderGameView(state); }
        finally { active = previous; }
    }
    WSM.UI = { mount, open, render, _test: { userKnowsKnowledge, buildIntentMessage, intentPanel, interactionActions, displayValue, renderMapForTest } };
})();
