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
        tasks: ['主角任务', (s) => s.tasks],
        triggers: ['世界剧情扣子', (s) => s.triggers],
        threads: ['长期线程', (s) => s.threads],
        progression: ['剧情推进', (s) => s.progression],
        processes: ['世界进程', (s) => s.processes],
        causalEffects: ['因果影响', (s) => s.causalEffects],
        timeline: ['时间线', (s) => s.timeline],
        planner: ['本轮后台判断', (s) => s.planner],
        injection: ['最终注入', (s) => s.runtime?.finalInjectionOverride || s.planner?.injection || ''],
        sources: ['输入来源', (s) => s.runtime?.sourceSummary || {}],
        worldbookEmpty: ['本轮规则命中', () => ({})],
        worldbook: ['世界书补充', (s) => s.memory?.worldbook || []],
    };
    let root;
    let active = 'overview';
    let editMode = false;
    let activeCategory = 'world';
    let activeSettingsTab = 'api';
    let apiProfilesDraft = [];
    let activeApiProfileId = '';
    const apiModelsByProfile = new Map();
    let wandMenuClickBound = false;
    let choiceSending = false;
    let clearReadPending = false;
    let activeMapMode = 'known';
    let activeMapSearch = '';
    const dynamicWorldbookSections = new Set();
    const categories = {
        map: { icon: 'map', label: '场景地图', sections: ['map'] },
        world: { icon: 'home', label: '世界', sections: ['overview','worldRules','resourceConstraints','organizations','factAnchors','processes','causalEffects'] },
        people: { icon: 'people', label: '人物', sections: ['characters','activities','relationships','knowledge'] },
        affairs: { icon: 'clipboard', label: '事务', sections: ['schedules','tasks','triggers','threads','progression','timeline'] },
        worldbook: { icon: 'note', label: '世界书补充', sections: [] },
        system: { icon: 'sliders', label: '系统', sections: ['sources','planner','injection'] },
    };
    const promptGroups = {
        world: ['world','worldRules','resourceConstraints','organizations','factAnchors','ambient','map','processes','causalEffects'],
        people: ['characters','npcActivities','relationships','knowledge'],
        affairs: ['schedules','tasks','triggers','threads','progression','timeline'],
        system: ['pacing','planner'],
    };
    const promptLabels = {
        world: '世界状态', worldRules: '硬规则 / 世界秩序', factAnchors: '事实锚点', resourceConstraints: '资源 / 约束', organizations: '组织 / 势力', ambient: '环境与路人反应', map: '场景地图', characters: '人物概况', npcActivities: 'NPC活动轨迹', relationships: '人物关系', knowledge: '知识与秘密',
        schedules: '已有安排', tasks: '主角任务', triggers: '世界剧情扣子', threads: '长期线程', progression: '剧情推进', processes: '世界进程',
        causalEffects: '因果影响', timeline: '时间线', pacing: '剧情节奏', planner: '本轮后台判断', injection: '最终注入',
    };
    const sectionHelp = {
        overview: '填写“此刻是什么样”：时间、季节、地点、天气、环境和当前客观状态。已经发生的节点放入时间线；仍在发展的世界级变化放入世界进程；永久规则放入硬规则。',
        worldRules: '填写不随当前场景轻易改变的法律、礼法、身份秩序、权限与世界底层规则，并同时保留适用条件和例外。当前有没有钱、人手、物品或通行资格放入资源 / 约束。',
        factAnchors: '只填写正文已经永久确立、遗忘会造成逻辑错误的最终结果。发生过程放入时间线；人物身份、关系、知识和世界书原始设定不要在这里重复。',
        resourceConstraints: '填写当前真正会阻止或消耗行动的资金、权限、人手、关键持有物、通行资格与地点封锁。它是“当前是否做得到”，不是永久规则或完整资产清单。',
        organizations: '按组织、阵营或集团展示各方势力：目标、领袖、控制范围、资源和对外关系。个人属于哪一方写入人物概况；不要把单个人的归属当成一方势力。',
        map: '填写地点父子层级、当前位置、路线、耗时、开放状态与进入规则引用。完整地图留在本地；正文只在移动、问路或权限相关时收到最小路线切片。地点历史放时间线。',
        characters: '填写人物当前卡片：身份、动机、目标、可用性、大致落点、重要处境、持续状态与重要物品。具体正在做什么、怎样移动放入 NPC 活动轨迹。',
        activities: '填写核心人物或活跃 NPC 此刻实际在做什么、在哪里活动、怎样移动；每人只留一条最新快照。最终落点回写人物概况，未来约定放已有安排。',
        relationships: '填写有方向的“主体如何看待对象”以及正式身份关系和形成依据；A→B 与 B→A 分开。具体知道什么放知识 / 秘密，禁止好感度或信任度评分。',
        knowledge: '重点记录char和相关NPC不知道什么、只知道哪部分、误解成什么，以及需要怎样才能获知；同时保留确已知情者。作者、玩家或AI读到设定不等于人物知道，缺少获知渠道时不得让人物按已知行动。人物态度放人物关系。',
        schedules: '填写已经明确承诺、预约、下令或确定日期、但尚未发生的未来事项。现在能够主动推进的事务放当前任务；仅仅可能发生的事不能建立安排。',
        tasks: '填写主角的主线与支线目标。主线是贯穿核心方向的长期目标，支线是具体辅助或独立目标；NPC自己的目标不放入此栏。',
        triggers: '填写世界已经向主角留下、但主角尚未回应或执行的剧情扣子，例如邀请、约见或明确请求；不是随机未来预测。',
        threads: '填写围绕玩家经历、目标或未解决问题持续多轮的长期故事线。具体可执行事项放任务；一次条件节点放触发器；不依赖玩家也会演变的宏观变化放世界进程。',
        progression: '只填写当前这一段剧情已经形成的移动方向、下一阶段仍缺什么，以及必须停下等待玩家的决策点。它不是剧情预案、任务、长期线程或已发生结果。',
        processes: '填写有实际事件和参与者支撑的组织、政治、经济、舆论或环境变化，记录已观察到的阶段与停止条件。人物情感或人格标签不是世界进程，不据此预设发展方向。',
        causalEffects: '填写已经确认的起因、已发生的作用过程和当前具体影响。正在形成的变化须有已观察到的依据与尚缺条件，不把主观动机、预测或关系结局当作持续后果。',
        timeline: '只填写已经确认发生的历史节点，每件事一次，仅供回顾、不注入正文。仍在继续发展的世界级变化放世界进程，永久结果同步到对应状态模块或事实锚点。',
        planner: '只显示本轮后台对“可以发生”与“不应发生”的判断。',
        injection: '显示当前真正会发送给正文模型的全部注入；设置中未勾选的模块不会出现。小铅笔修改会覆盖下一次正文生成，结算后恢复自动合成。',
        sources: '显示最近一次推演实际读到的角色卡、Persona、酒馆正文和世界书；未列出的世界书没有进入 Planner。',
        worldbookEmpty: '本轮没有可显示的规则命中。若来源应当存在但编译失败，将明确显示 RULE_COMPILE_FAILED。',
        worldbook: '世界书先拆解压缩，关键内容归栏，其余设定再次压缩后留在补充；原文只作本地备份。注入位置在设置的“注入模块”中调整。',
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
        if (WSM.PlainMemory?.isPlain(state)) {
            categories.worldbook.sections = ['worldbook'];
            if (activeCategory === 'worldbook') active = 'worldbook';
            return {entries:[]};
        }
        const report = currentWorldbookReport(state);
        const entries = Array.isArray(report.entries) ? report.entries : [];
        categories.worldbook.sections = entries.map((entry, index) => {
            const id = worldbookSectionId(entry.key || index);
            dynamicWorldbookSections.add(id);
            sectionMap[id] = [entry.label || `拆解条目 ${index + 1}`, () => entry];
            sectionHelp[id] = `来自「${entry.bookName || '世界书'}」；这里显示并编辑该条目的拆解规则，保存后下一轮会重新路由。`;
            return id;
        });
        if (WSM.PlainMemory?.isPlain(state)) categories.worldbook.sections.unshift('worldbook');
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
        tasks: { title: '主角任务', identity: 'title', fields: [['title','名称'],['questType','主线 / 支线'],['objective','主角目标'],['progress','当前进展'],['deadline','截止时间'],['dependencies','前置条件'],['consequences','影响']] },
        triggers: { title: '世界剧情扣子', identity: 'title', fields: [['title','名称'],['hook','剧情入口'],['conditions','回应条件'],['effectsIfTriggered','可能影响'],['blockedReasons','尚未回应原因']] },
        threads: { title: '长期事务', identity: 'title', fields: [['title','名称'],['stakes','重要性'],['participantIds','相关人物'],['nextNaturalStep','自然下一步'],['history','已有发展']] },
        processes: { title: '世界进程', identity: 'title', fields: [['title','名称'],['kind','世界级类型'],['drivers','为什么仍在继续'],['decayConditions','可能逐渐淡去'],['resolutionConditions','自然结束条件'],['progress','进度钟'],['currentDirection','目前趋势']] },
        causalEffects: { title: '因果影响', identity: 'result', fields: [['causeRef','起因引用'],['cause','已经发生的起因'],['steps','必要因果路径'],['result','仍在生效的后果'],['affectedIds','影响对象'],['status','影响状态'],['reachCondition','尚缺条件'],['decayConditions','减弱或消失条件']] },
        timeline: { title: '记录', identity: 'summary', fields: [['time','具体时间'],['summary','发生的事'],['granularity','记忆粒度'],['participants','相关人物'],['location','地点'],['actualChanges','实际变化']] },
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
        if (WSM.PlainMemory?.isPlain(state) && WSM.PlainMemory.sectionModule(active)) return WSM.PlainMemory.rows(state, active).join('\n');
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
        if (WSM.PlainMemory?.isPlain(state) && WSM.PlainMemory.edit(state, active, raw)) return;
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
        developing: '正在形成', active: '仍在生效', arrived: '仍在生效', ongoing: '正在发生', occurred: '已经发生', discarded: '路径不成立', reached: '仍在生效', deferred: '尚未形成', suggested: '候选方向', possible: '可能入口', sufficient: '因果充分', insufficient: '因果不足', confirmed: '已确认', derived: '可确定推导', system_generated: '系统生成', suspected: '暂定推测', assumed: '运行暂定', unknown: '原文未说明', not_established: '尚未建立', not_applicable: '不适用', believed: '人物相信', rumor: '传闻',
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
        for (const group of ['characters','organizations','schedules','tasks','triggers','threads','processes','causalEffects','knowledge']) {
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
            if (kind === 'task' && /^(?:无|暂无|没有|无待办(?:事项)?|暂无待办(?:事项)?|未明确|不适用|none|n\/?a)[。！!？?、；;\s]*$/i.test(String(item?.title || '').trim())) return false;
            if (inactive.has(item?.status) || item?.userVisible === false) return false;
            if (kind === 'trigger') {
                if (item?.candidateOnly === true || item?.status === 'possible') return true;
                const hookText = [item?.title, item?.hook, ...(Array.isArray(item?.conditions) ? item.conditions : [])]
                    .map((value) => String(value || '').replace(/<br\s*\/?>/gi, '；').trim()).filter(Boolean).join('；');
                const establishedEntry = /(?:邀请|邀约|约见|召见|请(?:你|主角|前往|赴|参加)|请求|委托|拜托|要求(?:你|主角|答复|选择)|命令(?:你|主角)|询问(?:你|主角)|追问|要不要|愿不愿|是否愿意|可愿|想不想|等待(?:你|主角)?.{0,12}(?:来电|来信|回复|答复|决定|选择|回应)|需要(?:你|主角).{0,12}(?:决定|选择|回应))/.test(hookText);
                const speculative = /(?:可能|也许|或许|猜测|大概|或将|产生探究欲|感到担忧|感到不安)/.test(hookText);
                if (!establishedEntry || speculative) return false;
            }
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
    function dynamicIntentOptions(module, item) {
        const provided = Array.isArray(item?.actionOptions) ? item.actionOptions : [];
        const normalized = provided.map((option, index) => ({
            id: String(option?.id || `option-${index + 1}`).trim(),
            label: String(option?.label || '').trim().slice(0, 30),
            intent: String(option?.intent || '').trim().slice(0, 500),
            description: String(option?.description || '').trim().slice(0, 100),
            requirements: Array.isArray(option?.requirements) ? option.requirements.filter(Boolean).slice(0, 4) : [],
        })).filter((option) => option.id && option.label && option.intent).slice(0, 4);
        if (normalized.length) return normalized;
        const title = String(item?.title || '当前事项').trim().slice(0, 50);
        if (module === 'tasks') {
            const dependency = Array.isArray(item?.dependencies) ? item.dependencies.find(Boolean) : '';
            return [
                { id: 'advance', label: `推进「${title}」`, intent: `我准备为“${title}”采取当前条件下最直接可行的一步。`, description: item?.progress ? `从当前进展继续：${String(item.progress).slice(0, 60)}` : '从当前进度继续推进', requirements: [] },
                ...(dependency ? [{ id: 'resolve-dependency', label: `先处理：${String(dependency).slice(0, 18)}`, intent: `我准备先处理“${title}”的前置条件：${dependency}。`, description: '先解除已知阻碍', requirements: [dependency] }] : []),
            ];
        }
        const hook = String(item?.hook || (Array.isArray(item?.conditions) ? item.conditions[0] : '') || title).trim();
        const place = String(hook.match(/(?:前往|赴|到|去往|进入|参加)([^，。；]{2,18})/)?.[1] || '').trim();
        if (/(?:邀请|邀约|约见|召见|前往|赴约|参加)/.test(hook)) return [
            { id: 'accept-invitation', label: place ? `准备前往${place}` : `接受「${title.slice(0, 18)}」`, intent: `我准备接受这一已知邀约并按现实条件行动：${hook}。`, description: place ? `规划并尝试前往${place}` : '接受邀约并开始准备', requirements: Array.isArray(item?.conditions) ? item.conditions.slice(0, 2) : [] },
            { id: 'confirm-arrangement', label: '先确认时间与安排', intent: `我准备先向邀请方确认“${title}”的时间、地点和必要条件，再决定如何赴约。`, description: '先补足主角可知的行动条件', requirements: [] },
        ];
        if (/(?:请求|委托|拜托)/.test(hook)) return [
            { id: 'take-request', label: `接下「${title.slice(0, 18)}」`, intent: `我准备接下这项明确请求，并从当前可行的第一步开始：${hook}。`, description: '接受请求并开始行动', requirements: [] },
            { id: 'ask-request-details', label: '询问目标与限制', intent: `我准备先询问这项请求的目标、时限和限制条件：${hook}。`, description: '确认细节后再行动', requirements: [] },
        ];
        if (/(?:询问|追问|答复|回答)/.test(hook)) return [
            { id: 'answer-directly', label: `直接答复「${title.slice(0, 16)}」`, intent: `我准备根据自己当前知道且愿意公开的信息直接答复：${hook}。`, description: '由主角决定实际说出的内容', requirements: [] },
            { id: 'clarify-question', label: '先确认对方所问', intent: `我准备先请对方说明具体想知道什么，再决定答复范围：${hook}。`, description: '厘清问题与信息边界', requirements: [] },
        ];
        return [
            { id: 'act-on-hook', label: `着手处理「${title.slice(0, 16)}」`, intent: `我准备针对这个已成立的剧情入口采取与其内容相符的第一步：${hook}。`, description: `从“${title.slice(0, 24)}”的现有条件开始`, requirements: [] },
            { id: 'check-hook-conditions', label: '先确认现有条件', intent: `我准备先确认“${title}”当前已经成立的条件和可行路径。`, description: '核实现状，不预判结果', requirements: [] },
        ];
    }
    function intentPanel(module, item, _actions, level = 'strong') {
        if (!['tasks', 'triggers'].includes(module) || item?.placeholder === true) return '';
        const id = interactionKey(module, item);
        const actions = dynamicIntentOptions(module, item);
        if (!id || !actions.length) return '';
        const heading = level === 'strong' ? '玩家意图' : '查询型交互';
        return `<section class="wsm-choice-panel wsm-intent-panel"><header><b>${icon('choice')}<span>${heading}</span></b><small>由本轮推演按具体内容生成；只发送尝试，不保证结果</small></header><div>${actions.map((action, index) => {
            return `<button type="button" class="wsm-choice-button" data-wsm-intent-module="${escape(module)}" data-wsm-intent-item="${escape(id)}" data-wsm-intent-action="${escape(action.id)}" title="只向正文 AI 发送玩家意图"><span>${index + 1}</span><b>${escape(action.label)}</b><small>${escape(action.description || action.intent)}</small></button>`;
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
        if (active === 'worldbook' && WSM.PlainMemory?.isPlain(state)) {
            const originals = WSM.WorldbookMemory?.originals(state) || [];
            const supplement = WSM.PlainMemory.rows(state, 'worldbook');
            const config = WSM.Settings.get().injectionModules?.worldbook;
            return `<section class="wsm-board"><h4>已接管 ${originals.length} 条世界书</h4><p>${config?.enabled === false ? '世界书补充注入已关闭。' : '先拆解压缩，关键内容进入对应栏目；其余设定再次压缩后保留在这里。原文仅作本地备份，不发给正文 AI。'}</p></section>
                ${supplement.map(row => `<article class="wsm-memory-card"><p>${escape(row)}</p></article>`).join('')}
                ${originals.map(entry => {
                    const read = WSM.WorldbookSemantic?.hasRead(state,entry);
                    return `<details class="wsm-game-card"><summary>${escape(entry.bookName)} · ${escape(entry.title || '世界书条目')} · ${read ? '已拆解压缩' : '待拆解压缩'} · 本地原文备份 ${entry.content.length} 字符</summary><div class="wsm-card-body"><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(entry.content)}</pre></div></details>`;
                }).join('')}`;
        }
        const memoryView = WSM.MemoryView?.render(state, active);
        if (memoryView != null) return memoryView;
        if (WSM.PlainMemory?.isPlain(state) && WSM.PlainMemory.sectionModule(active)) {
            const rows = WSM.PlainMemory.rows(state, active);
            const label = WSM.PlainMemory.LABELS[WSM.PlainMemory.sectionModule(active)] || '后台判断';
            return rows.length ? rows.map(value => `<article class="wsm-memory-card"><p>${escape(value)}</p></article>`).join('')
                : `<div class="wsm-empty-state"><b>${escape(label)}等待填写</b><small>初始化第二次推演或下一次正文更新会补齐此栏目。</small></div>`;
        }
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
            const rules = allRules.filter((item) => item?.statement || item?.factId);
            return rules.map((item) => `<article class="wsm-rule-card${matched.has(item.id) || matched.has(item.factId) ? ' wsm-rule-card-matched' : ''}">${escape(displayValue(item.statement || item.factId))}</article>`).join('') || empty('硬规则');
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
                return card(resolveRef(state, characterId), displayValue(current?.action) || '暂无活动', `<div class="wsm-activity-trail"><div><time>当前</time><span>${icon('pin')}<small>${escape(displayValue(current?.movement || current?.location) || '移动情况未明')}</small><b>${escape(displayValue(current?.action) || '活动未记录')}</b>${current?.location && current?.movement ? `<small>${escape(displayValue(current.location))}</small>` : ''}${current?.currentRole ? `<small>${escape(displayValue(current.currentRole))}</small>` : ''}</span></div></div>`, { icon: 'process' });
            }).join('') || empty('NPC活动轨迹');
        }
        if (active === 'relationships') return (state.relationships || []).filter((item) => item?.from && item?.to && (item?.identityRelation || item?.currentPerception || item?.status)).map((item) => card(`${resolveRef(state,item.from)} → ${resolveRef(state,item.to)}`, item.identityRelation || '人物关系', `${labeled('身份关系', item.identityRelation)}${labeled('当前关系认知', item.currentPerception)}${labeled('形成依据', item.formationBasis)}${labeled('阶段边界', item.boundaries)}`, { icon: 'heart', badge: item.truthStatus })).join('') || empty('人物关系');
        if (active === 'knowledge') return (state.knowledge || []).filter((item) => item?.information).map((item) => card(displayValue(item.information), item.source ? `来源/渠道：${displayValue(item.source)}` : '', `${labeled('持有人', (item.holderIds || item.knownBy || []).map((id) => resolveRef(state,id)))}${labeled('未知者', (item.unknownTo || []).map((id) => resolveRef(state,id)))}${labeled('怀疑者', (item.suspectedBy || []).map((id) => resolveRef(state,id)))}${labeled('认知状态', item.cognitiveStatus)}${labeled('公开状态', ({ confidential: '保密', restricted: '受限', public: '公开' }[item.disclosure] || item.disclosure))}${labeled('可靠性', item.reliability)}${labeled('玩家界面可见', item.userVisible === true ? '是' : '否')}${labeled('发现路径', item.discoveryPaths)}${labeled('成熟条件', item.maturityConditions)}${userKnowsKnowledge(state, item) ? '' : '<p class="wsm-muted">当前玩家角色尚未确认该信息；系统只把它作为认知边界，禁止正文让玩家角色凭空知晓。</p>'}`, { icon: 'lock', badge: item.cognitiveStatus || item.disclosure })).join('') || empty('知识记录');
        if (active === 'schedules') return (state.schedules || []).filter((item) => item?.title && !['completed','cancelled'].includes(item.status)).map((item) => card(item.title, item.expectedTime ? `预计：${item.expectedTime}` : '时间未明确', `${labeled('参与者', (item.participantIds || []).map((id) => resolveRef(state,id)))}${labeled('前置条件', item.preconditions)}${labeled('状态', item.status)}${labeled('来源', item.source)}`, { icon: 'clock', badge: item.status })).join('') || empty('已有安排');
        if (active === 'tasks') return userFacingItems(state, 'task').filter((item) => item?.title).map((item) => card(displayValue(item.title), item.candidateOnly ? '根据当前状态推测的可选方向' : (item.deadline ? `截止：${displayValue(item.deadline)}` : '没有明确截止时间'), `${labeled('任务类型', item.questType === 'main' ? '主线' : '支线')}${labeled('主角目标', item.objective)}${labeled('为什么与你有关', item.userRelevance)}${labeled('当前进展', item.progress)}${labeled('开始前需要', item.dependencies)}${labeled('完成条件（必须核验）', item.completionConditions)}${labeled('已核验完成条件', item.completedConditions)}${labeled('可能影响', item.consequences)}${intentPanel('tasks', item)}`, { icon: 'check', badge: item.candidateOnly ? '候选方向' : (item.questType === 'main' ? '主线' : '支线') })).join('') || empty('主角当前没有已成立的任务');
        if (active === 'triggers') return userFacingItems(state, 'trigger').map((item) => card(item.title, item.candidateOnly ? '根据当前世界推测的可能入口' : '世界已经留下、等待你回应的剧情扣子', `${labeled('剧情入口', item.hook)}${labeled('为什么你能注意到', item.userRelevance)}${labeled('回应条件', item.conditions)}${labeled('目前尚缺', item.blockedReasons)}${intentPanel('triggers', item)}`, { icon: 'flag', badge: item.candidateOnly ? '可能入口' : item.status })).join('') || empty('当前没有等待主角回应的剧情扣子');
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
        if (active === 'timeline') return `<div class="wsm-timeline">${(state.timeline || []).filter((item) => item?.summary).slice().reverse().map((item) => `<article><time>${escape(displayValue(item.time || item.date || item.timestamp) || '时间未明确')}</time><div><b>${escape(displayValue(item.summary) || '无摘要')}</b><small>${escape([item.granularity, displayValue(item.location)].filter(Boolean).join(' · '))}</small>${chips((item.participants || []).map((id) => resolveRef(state,id)))}${chips(item.relatedFactIds || [])}</div></article>`).join('')}</div>` || empty('时间线');
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
                <section class="wsm-board"><h4>已读取世界书</h4>${loaded.length ? loaded.map((name) => `<div class="wsm-board-item"><b>${escape(name)}</b><small>${escape(String(counts[name] || 0))} 条已读取条目</small></div>`).join('') : '<div class="wsm-board-item">没有读到任何世界书</div>'}</section>
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
        tasks: 'tasks', triggers: 'triggers', threads: 'threads', processes: 'processes',
        causalEffects: 'causalEffects', timeline: 'timeline',
    };
    const interactionActions = {
        characters: ['focus','intervene','investigate'], activities: ['focus','investigate'], relationships: ['focus','investigate'],
        knowledge: ['focus','investigate'], tasks: [],
        triggers: [], threads: ['focus','intervene','investigate'], processes: ['focus','intervene','investigate'],
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
        if (['tasks', 'triggers'].includes(module)) {
            const option = dynamicIntentOptions(module, item).find((candidate) => candidate.id === action);
            return `${option?.intent || `我准备回应${quoted}。`}\n\n${guard}`;
        }
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
        const state = WSM.Storage.load();
        const item = findInteractionItem(state, module, itemId);
        if (!item) { notify('这张卡片已经随状态更新，请重新选择', 'error'); render(); return; }
        const dynamicOption = ['tasks', 'triggers'].includes(module) ? dynamicIntentOptions(module, item).find((candidate) => candidate.id === action) : null;
        if (!allowed.includes(action) && !dynamicOption) { notify('这个模块不允许执行该操作', 'error'); return; }
        if (module === 'knowledge' && !userKnowsKnowledge(state, item)) {
            notify('当前玩家角色尚未确认这条知识，不能通过状态栏发送给正文 AI', 'error');
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
            notify(`已发送玩家意图：${dynamicOption?.label || intentActionLabels[action]?.[0] || action}`, 'success');
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
                const placement = id === 'worldbook' ? '使用本页设置的世界书补充位置' : `注入深度 ${config.depth ?? defaultModule.depth ?? 2}`;
                return `<label class="wsm-injection-row"><input type="checkbox" data-module-enabled="${id}" ${config.enabled !== false ? 'checked' : ''}><span>${escape(config.label)}<small>${escape(placement)}</small></span></label>`;
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
    function modalHtml() {
        const tabs = Object.entries(sectionMap).map(([id, [label]]) => `<button class="wsm-tab" data-tab="${id}">${label}</button>`).join('');
        const categoryButtons = Object.entries(categories).map(([id, item]) => `<button class="wsm-category-button" data-category-select="${id}"><span>${icon(item.icon)}</span><b>${item.label}</b></button>`).join('');
        return `<div id="wsm-modal" class="wsm-modal" hidden>
            <div class="wsm-shell">
                <button id="wsm-main-close" class="wsm-icon-button" data-action="close" aria-label="关闭">${icon('close')}</button>
                <header class="wsm-header"><div class="wsm-actions">
                    <button id="wsm-read-current" data-action="read-current">读取当前聊天</button><button id="wsm-read-previous" data-action="read-previous">读取上一轮正文</button><button id="wsm-clear-read" data-action="clear-read">清空读取</button><button data-action="organize">整理状态</button><button data-action="settings">设置</button>
                </div></header>
                <div class="wsm-scroll-page">
                    <div class="wsm-read-progress-region"><section id="wsm-operation-status" class="wsm-operation-status" role="status" aria-live="polite"><div class="wsm-operation-current"><b></b><small></small></div><div class="wsm-operation-steps" aria-label="读取步骤"></div></section><small id="wsm-read-floor" class="wsm-read-floor" aria-live="polite"></small><details id="wsm-read-diagnostics"><summary data-action="show-read-diagnostics">读取诊断</summary><button type="button" data-action="copy-read-diagnostics">复制读取诊断</button><small id="wsm-diagnostic-copy-status">仅记录本页面最近 6 次请求的耗时和计数；不含密钥、地址或聊天原文。刷新后重新记录。</small><textarea id="wsm-diagnostic-text" aria-label="读取诊断，可手动复制" rows="6" readonly style="width:100%;box-sizing:border-box"></textarea></details></div>
                    <nav class="wsm-category-bar">${categoryButtons}</nav>
                    <div class="wsm-body"><nav class="wsm-tabs">${tabs}</nav><main class="wsm-main">
                        <div class="wsm-section-heading"><div id="wsm-section-title"></div><div class="wsm-view-toolbar"><button class="wsm-icon-button wsm-pencil-only" data-action="toggle-edit" aria-label="编辑当前栏目" title="编辑当前栏目">${icon('edit')}</button></div></div>
                        <p id="wsm-section-help" class="wsm-section-help"></p>
                        <div id="wsm-game-view"></div><textarea id="wsm-editor" spellcheck="false" hidden></textarea>
                        <div class="wsm-editor-actions" hidden><button data-action="save-section">保存修改</button><button data-action="reload">放弃修改</button></div>
                    </main></div>
                </div>
            </div></div>
            <div id="wsm-settings-modal" class="wsm-submodal" hidden><div class="wsm-dialog"><header><b>世界状态机设置</b><button class="wsm-icon-button" data-action="close-settings" aria-label="关闭">${icon('close')}</button></header>
                <nav class="wsm-settings-tabs"><button data-settings-tab="api">${icon('plug')}<span>API</span></button><button data-settings-tab="source">${icon('clipboard')}<span>分解正文</span></button><button data-settings-tab="pacing">${icon('process')}<span>剧情节奏</span></button><button data-settings-tab="dice">${icon('event')}<span>骰子</span></button><button data-settings-tab="injection">${icon('send')}<span>注入模块</span></button><button data-settings-tab="prompts">${icon('brain')}<span>内置提示词</span></button></nav>
                <section class="wsm-settings-section" data-settings-section="api">
                    <label class="wsm-check"><input id="wsm-use-tavern-api" type="checkbox">使用酒馆默认 API（当前连接与模型）</label>
                    <p class="wsm-settings-help">启用后无需另填地址、模型或 Key，状态机直接跟随酒馆主界面当前使用的 API；请求只包含状态机所需内容。</p>
                    <label class="wsm-check"><input id="wsm-gpt-mode" type="checkbox">GPT 模式（仅使用 GPT 时勾选）</label>
                    <p class="wsm-settings-help">所有模型均按栏目保存事实句子。初始化两次：先读取设定与事实，再推演NPC活动和世界状态并补齐栏目。截断时保留完整句子，不自动追加调用。</p>
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
                    <div class="wsm-grid"><label>单次输出 Tokens<input id="wsm-max-tokens" type="text" inputmode="numeric" pattern="[0-9０-９]+"></label><label>旧结构模式注入字符预算<input id="wsm-injection-max" type="number" min="500"><small>当前句子模式完整回传相关记录，通过更新和失效清理控制积累，不按字符截断。</small></label></div>
                    <p id="wsm-effective-settings" class="wsm-settings-help"></p>
                    <p class="wsm-settings-help">Tokens 是单次返回上限。初始化使用2次调用：读取事实，再推演并补齐所有栏目。后续正文前零次，正文后1次合并结算、栏目补全和自主世界推演；只输出变化句子。截断时保留完整句子并提示未完成，不自动追加调用。</p>
                    <label class="wsm-check"><input id="wsm-enabled" type="checkbox">插件总开关</label>
                    <p class="wsm-settings-help">关闭后停止自动读取、状态 API、世界书处理与正文注入，但保留已有状态和面板；重新打开即可继续使用。打开插件或切换聊天仍不会自动初始化。</p>
                    <label class="wsm-check" hidden><input id="wsm-block-on-planner-error" type="checkbox">兼容旧设置</label>
                </section>
                <section class="wsm-settings-section" data-settings-section="source">
                    <p class="wsm-settings-help">初始化固定两步：第一步拆解压缩当前启用或绑定的世界书，结合角色卡和正文将关键内容归栏；第二步将剩余补充再次压缩，并使用压缩结果推理；最多 2 次 API。下方只调整正文读取范围，不裁剪世界书。</p>
                    <label>聊天总结标签（留空读取全文）<input id="wsm-summary-tag" type="text" maxlength="64" placeholder="meow_FM"></label>
                    <p class="wsm-settings-help">填写标签名后采用混合读取：最近若干层读取可见正文，更早楼层只读取该总结标签；留空则全部读取正文。</p>
                    <div class="wsm-grid"><label>普通轮次扫描最近楼层数（0=全部）<input id="wsm-recent-messages" type="number" min="0" max="200"></label><label>其中最近全文楼层数<input id="wsm-recent-full-text-messages" type="number" min="1" max="20"></label></div>
                    <section class="wsm-rollback-panel"><b>${icon('clipboard')}<span>近层正文、远层总结</span></b><p>默认最近 5 层读取可见原文；5 层之外只读取 meow_FM（或你填写的标签），没有标签的旧楼层会跳过。这个范围用于完整初始化；普通轮次只读取刚生成的最新正文和完整旧状态。</p><small>正文一生成完成便在后台读取。重 roll 会回滚旧候选对应的状态，再读取当前新候选；发送下一条消息不会等待状态 API。</small></section>
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
                <section class="wsm-settings-section" data-settings-section="injection"><label>世界书补充注入位置<select id="wsm-worldbook-injection-position"><option value="after_character">角色定义之后</option><option value="before_character">角色定义之前</option><option value="before_author">作者注释之前</option><option value="after_author">作者注释之后</option></select></label><p class="wsm-settings-help">世界书拆解压缩后，关键内容沿用对应栏目位置；其余压缩设定留在世界书补充；作者注释本轮未启用时，补充放在角色定义之后。</p><p class="wsm-settings-help">勾选需要发送给正文模型的状态模块。深度 0–4 表示注入位置和作用时机，不等于 L1/L2/L3 重要等级；归栏后的世界书设定沿用对应栏目位置，世界书补充可在本页选择作者注释或角色定义前后。时间线和完整后台数据库始终不注入。</p><div id="wsm-injection-module-list"></div></section>
                <section class="wsm-settings-section" data-settings-section="prompts">
                    <p class="wsm-settings-help">总规则控制整体流程；模块规则会发送给 Planner 和结算器。已勾选且非空的模块还会把自己的模块规则连同状态数据一起注入正文模型。</p>
                    <details class="wsm-prompt-group"><summary>${icon('brain')}<span>全局总规则</span></summary><div>
                        <label class="wsm-core-prompt"><b>世界推演总规则</b><textarea id="wsm-planner-prompt"></textarea></label>
                        <label class="wsm-core-prompt"><b>正文事实结算总规则</b><textarea id="wsm-reconciler-prompt"></textarea></label>
                    </div></details>
                    <div id="wsm-module-prompt-list"></div>
                </section>
                <footer><button data-action="reset-prompts">恢复新版默认规则</button><button data-action="test-api">测试连接</button><button data-action="save-settings">保存</button></footer>
            </div></div>
            <div id="wsm-organize-modal" class="wsm-submodal" hidden><div class="wsm-dialog"><header><b>整理状态</b><button class="wsm-icon-button" data-action="close-organize" aria-label="关闭">${icon('close')}</button></header><div class="wsm-settings-scroll">
                <section class="wsm-rollback-panel"><b>${icon('brain')}<span>智能整理</span></b><p>合并意思重复的记录，整理同一人物的概况，修正栏目归属与有明确依据的旧状态。保留重要历史、条件、例外和未完成事项。</p><small>调用 1 次 AI，只提交当前记忆、只返回必要改动；整理前保留回滚快照。完成后显示实际调整的栏目。</small><button data-action="organize-smart">智能整理 · 1 次 API</button></section>
                <section class="wsm-rollback-panel" ${WSM.PlainMemory ? 'hidden' : ''}><b>${icon('check')}<span>清理临时信息</span></b><p>只移除失效临时信息。</p><button data-action="organize-temporary">清理临时信息</button></section>
                <section class="wsm-rollback-panel"><b>${icon('history')}<span>自动保留快照</span></b><p>整理前仍会自动建立版本快照，供删除楼层时自动恢复对应状态。</p></section>
            </div></div></div>`;
    }
    function render() {
        const state = WSM.Storage.load();
        syncWorldbookSections(state);
        const [title] = sectionMap[active] || sectionMap.worldbookEmpty;
        renderOperationStatus(WSM.Engine?.getProgress?.() || {}, state);
        $('#wsm-section-title').innerHTML = `<h3>${escape(title)}</h3>`;
        const help = $('#wsm-section-help');
        if (help) {
            help.textContent = sectionHelp[active] || '';
            help.hidden = !help.textContent;
        }
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
    function syncEnabledControls(settings = WSM.Settings.get()) {
        if (!root) return;
        const enabled = settings.enabled !== false;
        const settingsToggle = $('#wsm-enabled');
        if (settingsToggle) settingsToggle.checked = enabled;
        ['#wsm-read-previous', '[data-action="organize"]', '[data-action="organize-smart"]'].forEach((selector) => {
            const control = root.querySelector(selector);
            if (control) control.disabled = !enabled || WSM.Engine?.getProgress?.().state === 'running';
        });
        const readCurrent = $('#wsm-read-current');
        if (readCurrent) {
            const progress = WSM.Engine?.getProgress?.() || {};
            const reading = WSM.Engine?.isReading?.() === true;
            const allowed = WSM.PlainMemory ? WSM.PlainMemory.canInitialize(WSM.Storage.load()) : !WSM.Storage.load().initialized;
            readCurrent.disabled = !enabled || (!reading && (!allowed || progress.state === 'running'));
            readCurrent.title = reading ? '终止本次操作' : allowed ? '首次读取当前聊天并初始化（最多2次API）' : '初始化已锁定；后续用读取上一轮正文更新，清空读取后可重新初始化';
        }
    }
    function renderOperationStatus(progress = WSM.Engine?.getProgress?.() || {}, state = WSM.Storage.load()) {
        if (WSM.PlainMemory?.isPlain(state) && state.runtime?.plainReadIncomplete && !['running','cancelled'].includes(progress.state) && !/^智能整理/.test(progress.message || '')) {
            const legacyReceipt = /等待完整结束回执/.test(state.planner?.error || '');
            progress = {...progress, state:'error', message:'本次读取已结束，已保存内容仍有待修正项', details:legacyReceipt
                ? '本次请求已结束。旧版未区分结束标记缺失与旧句替换校验失败，无法仅凭旧提示确定原因；不会继续等待或自动重试。'
                : state.planner?.error || '本次已结束，现有内容保留。'};
        }
        const status = $('#wsm-status');
        const operation = $('#wsm-operation-status');
        const readCurrent = $('#wsm-read-current');
        const clearRead = $('#wsm-clear-read');
        const readFloor = $('#wsm-read-floor');
        if (!operation || !readCurrent || !clearRead) return;
        if (readFloor) {
            const floor = Math.min(WSM.Context.context()?.chat?.length ?? Infinity, Math.max(0, Math.floor(Number(
                WSM.Engine.readFloor?.(state)
                ?? state.runtime?.lastReadFloor
                ?? state.runtime?.lastPreviousBodyFloor
                ?? state.runtime?.sourceSummary?.sourceRead?.coveredChatMessages
                ?? state.runtime?.sourceSummary?.chatMessages
                ?? 0
            ))));
            readFloor.textContent = floor ? `正文已读取至第 ${floor} 层` : '正文尚未建立读取位置';
        }
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
        clearRead.disabled = progress.state === 'running';
        syncEnabledControls();
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
        $('#wsm-max-tokens').value = s.maxTokens ?? WSM.Settings.defaults.maxTokens;
        $('#wsm-effective-settings').textContent = `本页运行 v${WSM.version || '未知'} · 当前已应用 ${s.maxTokens} Tokens · 修改输入框后需点击保存。不同酒馆账号的设置互不同步。`;
        $('#wsm-summary-tag').value = s.summaryTag ?? 'meow_FM';
        $('#wsm-recent-messages').value = s.recentMessages ?? 12;
        $('#wsm-recent-full-text-messages').value = s.recentFullTextMessages ?? 5;
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
        $('#wsm-worldbook-injection-position').value = WSM.WorldbookCompiler.normalizeConfig(s.worldbookCompiler).injectionPosition;
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
        const outputBudget = WSM.Settings.parseOutputTokens($('#wsm-max-tokens').value);
        const rawSummaryTag = $('#wsm-summary-tag')?.value.trim() || '';
        const summaryTag = WSM.Context?.normalizeSummaryTag?.(rawSummaryTag) ?? rawSummaryTag;
        if (rawSummaryTag && !summaryTag) throw new Error('总结标签格式无效；请只填写标签名，例如 meow_FM，或留空读取全文');
        const injectionModules = WSM.Storage.clone(current.injectionModules || WSM.Defaults.INJECTION_MODULES);
        root.querySelectorAll('[data-module-enabled]').forEach((input) => { injectionModules[input.dataset.moduleEnabled].enabled = input.checked; });
        const modulePrompts = Object.assign({}, current.modulePrompts || WSM.Defaults.MODULE_PROMPTS);
        root.querySelectorAll('[data-module-prompt]').forEach((input) => { modulePrompts[input.dataset.modulePrompt] = input.value.trim(); });
        const worldbookCompiler = WSM.WorldbookCompiler.normalizeConfig({
            ...current.worldbookCompiler,
            injectionPosition: $('#wsm-worldbook-injection-position').value,
        });
        WSM.Settings.update({
            ...apiProfilePatch(),
            useTavernApi: $('#wsm-use-tavern-api').checked,
            gptMode: $('#wsm-gpt-mode').checked,
            jailbreakPrompt: $('#wsm-jailbreak-prompt').value,
            ...typographyFromForm(),
            launcherVisible: $('#wsm-launcher-visible').checked,
            temperature: Number($('#wsm-temperature').value), maxTokens: outputBudget, enabled: $('#wsm-enabled').checked,
            autoInitialize: false,
            blockOnPlannerError: false,
            diceEnabled: $('#wsm-dice-enabled').checked,
            storyPacing: {
                mode: $('#wsm-story-pacing-mode').value,
                allowSceneTransition: $('#wsm-pacing-scene-transition').checked,
                allowTimeSkip: $('#wsm-pacing-time-skip').checked,
            },
            summaryTag,
            recentMessages: Math.max(0, Math.min(200, Math.round(Number($('#wsm-recent-messages').value) || 0))),
            recentFullTextMessages: Math.max(1, Math.min(20, Math.round(Number($('#wsm-recent-full-text-messages').value) || 5))),
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
        await WSM.Settings.persist();
        $('#wsm-effective-settings').textContent = `本页运行 v${WSM.version || '未知'} · 当前已应用 ${WSM.Settings.get().maxTokens} Tokens · 已交由酒馆后台保存`;
        if (closeAfter) $('#wsm-settings-modal').hidden = true;
        notify(`设置已应用：${WSM.Settings.get().maxTokens} Tokens；已交由酒馆后台保存，请留意酒馆的保存失败提示`, 'success');
    }
    function confirmClearRead() {
        // Embedded browsers may suppress window.confirm and return false silently.
        const host = root || document.getElementById('wsm-root');
        if (!host) throw new Error('状态机面板尚未加载，请刷新页面');
        const overlay = document.createElement('div');
        overlay.id = 'wsm-clear-read-confirm';
        overlay.className = 'wsm-submodal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'wsm-clear-read-title');
        overlay.setAttribute('aria-describedby', 'wsm-clear-read-description');
        overlay.innerHTML = `<div class="wsm-dialog"><header><b id="wsm-clear-read-title">清空本聊天的读取状态？</b></header>
            <div class="wsm-settings-scroll" id="wsm-clear-read-description"><p>将删除本聊天的状态机记忆、硬规则、世界书拆解与注入缓存、剧情推进、读取缓存、已注册的 AI 注入和全部回滚版本。清空后可重新读取当前聊天。</p><p>此操作无法通过插件回滚。酒馆聊天消息、角色卡、Persona 和原始世界书会保留。</p></div>
            <footer><button type="button" data-clear-choice="cancel">取消</button><button type="button" data-clear-choice="confirm">确认清空</button></footer></div>`;
        const previousFocus = document.activeElement;
        const cancel = overlay.querySelector('[data-clear-choice="cancel"]');
        const confirm = overlay.querySelector('[data-clear-choice="confirm"]');
        return new Promise((resolve) => {
            const finish = (accepted) => {
                overlay.remove();
                if (previousFocus?.isConnected) previousFocus.focus();
                resolve(accepted);
            };
            cancel.addEventListener('click', () => finish(false));
            confirm.addEventListener('click', () => finish(true));
            overlay.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
                if (event.key === 'Tab') {
                    event.preventDefault();
                    (document.activeElement === cancel ? confirm : cancel).focus();
                }
            });
            host.appendChild(overlay);
            cancel.focus();
        });
    }
    async function clearReadWithConfirmation() {
        if (clearReadPending) return false;
        clearReadPending = true;
        const busy = () => WSM.Engine?.getProgress?.()?.state === 'running' || WSM.Engine?.isReading?.() === true;
        try {
            if (busy()) throw new Error('正在读取或处理状态，请等待结束或先终止读取');
            const chatKey = WSM.Storage.currentChatKey();
            if (!await confirmClearRead()) return false;
            if (chatKey !== WSM.Storage.currentChatKey()) throw new Error('聊天已切换，请在需要清空的聊天中重新操作');
            if (busy()) throw new Error('确认期间开始了读取或状态处理，请等待结束后再清空');
            await WSM.Storage.clearAll();
            WSM.Engine.resetProgress?.();
            await WSM.Engine?.syncRegisteredPrompt?.();
            return true;
        } finally { clearReadPending = false; }
    }
    async function handleAction(action) {
        if (action === 'show-read-diagnostics' || action === 'copy-read-diagnostics') {
            const report = WSM.Api.getDiagnostics?.() || {requests:[],validations:[]};
            const output = JSON.stringify(report,null,2);
            const textarea = $('#wsm-diagnostic-text');
            textarea.value = output;
            const status = $('#wsm-diagnostic-copy-status');
            if (!report.requests.length) status.textContent = '本页面尚无请求记录；下次正常读取后再复制，无需清空记忆。';
            if (action === 'copy-read-diagnostics') {
                try {
                    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
                    await navigator.clipboard.writeText(output);
                    status.textContent = report.requests.length ? '已复制读取诊断。' : '已复制；本页面尚无请求记录。';
                } catch (_) {
                    textarea.focus(); textarea.select();
                    status.textContent = '浏览器不允许自动复制，请长按或手动复制下方已选中的诊断。';
                }
            }
            return;
        }
        if (action === 'close') close();
        if (action === 'organize') $('#wsm-organize-modal').hidden = false;
        if (action === 'close-organize') $('#wsm-organize-modal').hidden = true;
        if (action === 'organize-smart' || action === 'organize-temporary') {
            const temporary = action === 'organize-temporary';
            const label = temporary ? '清理临时信息' : '智能整理';
            if (temporary && !window.confirm(`确定执行“${label}”？整理前会建立可回滚快照，不会修改原始世界书。`)) return;
            try {
                if (!temporary) $('#wsm-organize-modal').hidden = true;
                const result = await WSM.Storage.organizeState(temporary ? 'temporary' : 'smart');
                if (WSM.Settings.get().gptMode === true) await WSM.Engine?.refreshGptLocalState?.();
                await WSM.Engine?.syncRegisteredPrompt?.();
                $('#wsm-organize-modal').hidden = true;
                render();
                notify(result.details || `${label}完成：状态条目 ${result.beforeItems} → ${result.afterItems}，时间线 ${result.beforeTimeline} → ${result.afterTimeline}；已生成新 REV`, 'success');
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
        if (action === 'toggle-edit') { editMode = true; render(); }
        if (action === 'reload') { editMode = false; render(); }
        if (action === 'save-section') await saveSection();
        if (action === 'cancel-read') {
            WSM.Engine.cancelRead?.();
            renderOperationStatus();
        }
        if (action === 'clear-read') {
            try {
                if (!await clearReadWithConfirmation()) return;
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
            WSM.Engine.reportProgress?.('正在准备读取当前聊天', 'running', '正在检查聊天、模型连接和资料来源…');
            let planner;
            try {
                planner = await WSM.Engine.plan({
                    force: true,
                    initialize: true,
                    interactiveRead: true,
                });
            }
            catch (error) { WSM.Engine.reportProgress?.('读取或初始化失败', 'error', error.message); planner = { error: error.message }; }
            if (planner?.error) WSM.Engine.reportProgress?.('读取当前聊天失败', 'error', planner.error);
            else if (WSM.Engine.getProgress?.().state === 'running' && WSM.Engine.isReading?.() !== true) {
                WSM.Engine.reportProgress?.('读取当前聊天未完成', 'error', '读取任务已经结束，但没有产生完成状态；本次不会把旧档位结果当成新档位结果。');
            }
            render();
        }
        if (action === 'read-previous') {
            const button = root.querySelector('[data-action="read-previous"]');
            if (button) button.disabled = true;
            try {
                const result = await WSM.Engine.readPreviousBody();
                await WSM.Engine?.syncRegisteredPrompt?.();
                render();
                notify(`第 ${result?.floor || '?'} 层助手正文已读取并更新插件状态`, 'success');
            } catch (error) {
                WSM.Engine.reportProgress?.('上一轮正文读取失败', 'error', error.message);
                notify(`读取失败：${error.message}`, 'error');
            } finally {
                if (button) button.disabled = false;
            }
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
        window.setInterval(() => { mountWandMenuItem(); }, 1000);
    }
    function renderTurnReadPopup(progress = {}) {
        let popup = document.getElementById('wsm-turn-read-popup');
        const activeChat = WSM.Storage?.currentChatKey?.() || '';
        const visible = progress.state === 'running' && (!progress.chatKey || progress.chatKey === activeChat);
        if (!visible) { popup?.remove(); return; }
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'wsm-turn-read-popup';
            popup.setAttribute('role', 'status');
            popup.setAttribute('aria-live', 'polite');
            popup.textContent = '正在读取';
            document.body.appendChild(popup);
        }
    }
    function mount() {
        window.addEventListener('wsm-turn-read-progress', event => renderTurnReadPopup(event.detail));
        window.addEventListener('wsm-operation-progress', event => {
            if (event.detail?.state !== 'running') renderTurnReadPopup();
        });
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
            const summary = target.closest('summary');
            if (summary && root.contains(summary) && summary.parentElement instanceof HTMLDetailsElement) {
                consume();
                summary.parentElement.open = !summary.parentElement.open;
                if (summary.parentElement.open && summary.dataset.action === 'show-read-diagnostics') await handleAction('show-read-diagnostics');
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
            if (settingsTab) { consume(); activeSettingsTab = settingsTab; renderSettingsTabs(); return; }
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
            if (event.target?.id === 'wsm-enabled') {
                const enabled = event.target.checked;
                WSM.Settings.update({ enabled });
                syncEnabledControls();
                notify(enabled
                    ? '状态机已开启；已有状态与正文注入已恢复'
                    : '状态机已关闭；不会自动读取、调用状态 API 或注入正文，已有状态仍保留', 'success');
                return;
            }
            const changed = event.target instanceof HTMLInputElement ? event.target : null;
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
        window.addEventListener('wsm-state-changed', () => { if (!$('#wsm-modal')?.hidden) render(); });
        window.addEventListener('wsm-settings-changed', () => { syncLauncherVisibility(); syncEnabledControls(); });
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
    function renderSectionForTest(state, section) {
        const previous = active; active = section;
        try { return renderGameView(state); } finally { active = previous; }
    }
    WSM.UI = { mount, open, render, _test: { modalHtml, userKnowsKnowledge, buildIntentMessage, dynamicIntentOptions, intentPanel, interactionActions, displayValue, renderMapForTest, renderSectionForTest, clearReadWithConfirmation } };
})();
