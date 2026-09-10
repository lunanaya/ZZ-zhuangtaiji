(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
    const aliases = {
        '姓名或名称':'名称','姓名':'名称','人物':'名称','事项':'名称','组织':'名称','势力':'名称',
        '所在地':'位置','当前位置':'位置','当前所在地':'位置','活动地点':'位置','地点':'位置',
        '是否在场':'在场','当前处境':'处境','当前行动':'行动','当前活动':'行动','移动过程':'移动',
        '关系起点':'主体','关系终点':'对象','身份关系':'关系','当前认知':'态度','当前关系认知':'态度',
        '确认知情者':'知情','尚不知情者':'不知情','传播范围':'公开','信息':'内容',
        '不知情者':'不知情','未知者':'不知情','不知道':'不知情','部分知情':'已知部分','部分知情者':'已知部分',
        '误解者':'误解','怀疑者':'怀疑','相信者':'相信','发现条件':'获知条件','知识边界':'认知边界',
        '约定时间':'时间','预计时间':'时间','具体时间':'时间','当前时间':'时间','截止时间':'截止',
        '参与者':'参与','相关人物':'参与','所属人物':'参与','前置条件':'条件','完成条件':'完成',
        '负责人':'领袖','管辖范围':'范围','可调用资源':'资源','当前目标':'目标','当前进展':'进展',
        '上级地点':'上级','当前地点':'位置','地图名称':'名称','路线变化':'路线',
        '触发后影响':'影响','阻碍原因':'阻碍','下一阶段条件':'条件','待决定事项':'决策',
        '推动因素':'动力','当前方向':'趋势','解决条件':'结束','起因':'原因','结果':'后果',
    };
    const fieldNames = new Set(('名称 位置 在场 身份 处境 状态 行动 移动 目标 主体 对象 关系 态度 矛盾 边界 条件 例外 规则 范围 影响 原因 路径 后果 内容 知情 不知情 怀疑 误解 公开 来源 时间 日期 季节 天气 环境 截止 参与 进展 完成 阻碍 决策 类型 领袖 资源 盟友 对手 动力 趋势 结束 上级 说明 用途 开放 耗时 路线 已完成 当前 下一步 保密 秘密 补充 持续状态 重要物品').split(' '));
    '已知部分 获知条件 获知渠道 未知部分 认知边界 相信'.split(' ').forEach(key => fieldNames.add(key));
    '扣子状态 未满足条件'.split(' ').forEach(key => fieldNames.add(key));
    '允许 禁止 解除条件 玩家接受 实施者 准备条件 到场条件 时间条件 一次性 生命周期 有效至 锚定 固定日期 本地时间核验 本地权限核验 本地触发核验 前置核验 解除检查 已满足 受阻 待核实 行动权限 移动核验 出发 目的地 耗时分钟 持有 历史归档 归档时间'.split(' ').forEach(key => fieldNames.add(key));
    const types = {
        world:['世界状态','◷'], worldRules:['硬规则','§'], factAnchors:['事实锚点','◆'], resourceConstraints:['资源与约束','▣'],
        organizations:['组织与势力','⚑'], map:['场景地图','⌖'], characters:['人物概况','◉'], npcActivities:['NPC活动','➜'],
        relationships:['人物关系','↔'], knowledge:['知识与秘密','◇'], schedules:['已有安排','◷'], tasks:['主角任务','☑'],
        triggers:['剧情扣子','◇'], threads:['长期线程','⌁'], progression:['剧情推进','➜'], processes:['世界进程','↗'],
        causalEffects:['因果影响','→'], timeline:['时间线','◷'], planner:['后台判断','◇'], worldbook:['世界书补充','§'],
    };
    const labels = {worldRules:'规则',factAnchors:'已确立事实',resourceConstraints:'当前约束',organizations:'势力记录',characters:'人物记录',npcActivities:'活动记录',relationships:'关系记录',knowledge:'知识记录',schedules:'既定安排',tasks:'当前目标',triggers:'待回应事项',threads:'未决线程',progression:'当前阶段',processes:'演变中的进程',causalEffects:'持续影响',timeline:'历史节点',planner:'本轮判断'};

    // The view is a disposable projection. Never rewrite stored sentences or
    // ask an LLM for layout metadata. Unrecognized prose stays visible in full.
    function parse(raw) {
        raw = String(raw || '').trim();
        const fields = [];
        const prose = [];
        let title = '';
        const pipe = /[|｜]/.test(raw);
        const segments = raw.split(pipe ? /｜|(?<!\|)\|(?!\|)/ : /[；;\n]/);
        for (let index = 0; index < segments.length; index++) {
            const segment = segments[index].trim();
            if (!segment) continue;
            const match = segment.match(/^([^:：]{1,14})[:：]([\s\S]*)$/);
            const key = match ? aliases[match[1].trim()] || match[1].trim() : '';
            if (match && fieldNames.has(key)) {
                if (key === '名称' && !title) title = match[2].trim();
                else fields.push([key, match[2].trim()]);
            } else if (pipe && index === 0) title = segment;
            else prose.push(segment);
        }
        return {raw, title, fields, prose};
    }
    const field = (record, ...keys) => [...new Set(record.fields.filter(([key]) => keys.includes(key)).map(([,value])=>value).filter(Boolean))].join('；');
    const without = (record, keys) => record.fields.filter(([key]) => !keys.includes(key));
    const rx = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    function personName(record,known=[]) {
        if (record.title) return record.title;
        const named=known.find(name => record.raw.startsWith(name));
        if (named) return named;
        return record.raw.match(/^([^，。；|｜：:]{2,12}?)(?:是|担任|目前|当前|现在|喜欢|讨厌|拥有|位于|身处|正在|负责)/)?.[1] || '';
    }
    function legacyPlace(record) {
        if (/(?:不|未|将|计划|准备|可能|假如|如果)[^。；]*?(?:身处|位于)/.test(record.raw)) return null;
        const location=record.raw.match(/(?:目前身处|当前身处|身处|目前位于|当前位于|位于)([^，。；]+?)(?:内[。]?|。|$)/)?.[1];
        if (!location || !location.includes('的')) return null;
        const names=location.split('的').map(value=>value.trim()).filter(Boolean);
        // Only explicit containment (“行馆的书房”), no invented geography.
        return names.length > 1 ? {...record,title:names.join(' > ')} : null;
    }
    function project(records,module,state) {
        const characterRows=(state.memory?.characters || []).map(parse);
        const known=[...new Set([state.identities?.user,state.identities?.char,...characterRows.map(record=>personName(record))].filter(Boolean))].sort((a,b)=>b.length-a.length);
        if (module === 'map') return records.map(record => {
            const place=legacyPlace(record);
            if (place) return place;
            const route=record.raw.match(/^([^，。；]+?)(?:通向|通往)([^，。；]+)[。]?$/);
            return route ? {...record,fields:[...record.fields,['路线',`${route[1]} → ${route[2]}`]]} : record;
        });
        if (module === 'characters' || module === 'npcActivities') {
            const places=(state.memory?.map || []).map(parse).map(record=>legacyPlace(record)||record).map(record=>record.title).filter(value=>value.includes(' > '));
            const grouped=new Map(), result=[];
            for (const record of records) {
                const name=personName(record,known);
                const next={...record,title:name || record.title,fields:[...record.fields],prose:[...record.prose]};
                if (name && !field(next,'身份')) {
                    const identity=record.raw.match(new RegExp(`^${rx(name)}(?:是|担任)([^，。；]+)`))?.[1];
                    if (identity) next.fields.push(['身份',identity]);
                }
                if (!field(next,'位置')) {
                    const direct=record.raw.match(new RegExp(`^${rx(name)}(?:当前所在地是|现在住在|当前位于|目前位于|位于)([^，。；|｜]+)[。]?$`))?.[1];
                    const place=places.find(path => new RegExp(`(?:目前正在|目前在|当前在|正在|身处|位于|现在在)${rx(path.replace(/ > /g,''))}`).test(record.raw));
                    if (direct || place) next.fields.push(['位置',direct || place]);
                }
                if (module === 'npcActivities' && !field(next,'位置')) {
                    // An explicit work location may be embedded in a short
                    // activity sentence. This describes the activity's site,
                    // not proof that a supervisor is physically present there.
                    const activityPlace = record.raw.match(/在([^，。；|｜]{1,24}?)的(?:安保|护卫|巡查|巡逻|值守|守卫|调查|接待|救援|运输)/)?.[1];
                    const hypothetical = /(?:不|未|将|拟|计划|准备|可能|预计|如果|假如|曾经|过去|昨日|昨天)[^，。；]*在/.test(record.raw);
                    if (activityPlace && !hypothetical) next.fields.push(['位置',activityPlace]);
                }
                if (!name || !grouped.has(name)) {
                    result.push(next);
                    if (name) grouped.set(name,next);
                } else {
                    const existing=grouped.get(name);
                    next.fields.forEach(pair=>{if(!existing.fields.some(old=>old[0]===pair[0] && old[1]===pair[1])) existing.fields.push(pair);});
                    existing.prose.push(...next.prose);
                }
            }
            return result;
        }
        if (module === 'relationships') return records.map(record => {
            if (record.title || field(record,'主体','对象')) return record;
            // Direction comes from explicit “A对B”, not from sentiment guesses.
            const targets=known.map(rx).join('|');
            if (!targets) return record;
            const match=record.raw.match(new RegExp(`^([^，。；]{1,18}?)对(${targets})(?:有|的|是|仍|保持|怀有|产生|抱有)`));
            if (match) return {...record,title:`${match[1]} → ${match[2]}`};
            const pair=record.raw.match(new RegExp(`^([^，。；]{1,18}?)与(${targets})(?:政见不合|处于政治对立|互相|彼此)`));
            return pair ? {...record,title:`${pair[1]} ↔ ${pair[2]}`} : record;
        });
        return records;
    }
    function details(fields) {
        return fields.length ? `<dl class="wsm-mv-fields">${fields.filter(([,value]) => value).map(([key,value]) => `<div${['条件','例外','边界','不知情','阻碍','决策'].includes(key) ? ' class="wsm-mv-important"' : ''}><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : '';
    }
    const prose = record => record.prose.length ? `<p class="wsm-mv-prose">${esc(record.prose.join('；'))}</p>` : '';
    const badge = (value, kind = '') => value ? `<span class="wsm-mv-badge ${kind}">${esc(value)}</span>` : '';
    const heading = (title, symbol, extra = '') => `<header class="wsm-mv-heading"><span class="wsm-mv-symbol" aria-hidden="true">${symbol}</span><h4>${esc(title)}</h4>${extra}</header>`;
    function card(record, module, index, body = '', omit = []) {
        return `<article class="wsm-mv-card wsm-mv-${module}">${heading(record.title || labels[module] || types[module]?.[0], types[module]?.[1] || '◇', badge(field(record,'状态','类型')))}${body}${details(without(record,['状态','类型',...omit]))}${prose(record)}</article>`;
    }
    function empty(module) {
        return `<div class="wsm-empty-state"><b>暂无${esc(types[module]?.[0] || '记录')}</b><small>读取已有资料后，有依据的内容会显示在这里。</small></div>`;
    }
    function person(record, index) {
        let name = record.title;
        let location = field(record,'位置');
        // Only lift an unambiguous location sentence, never guess a surname or
        // location from arbitrary prose. The original sentence remains below.
        const match = record.raw.match(/^([^，。；|｜]{1,24}?)(?:当前所在地是|现在住在|当前位于|目前位于|位于)([^，。；|｜]+)[。]?$/);
        if (!name && match) { name = match[1]; location = match[2]; }
        const title = name || `人物记录 ${index + 1}`;
        return `<article class="wsm-mv-card wsm-mv-person"><header class="wsm-mv-person-head"><span class="wsm-mv-avatar" aria-hidden="true">${esc(name?.slice(0,1) || '人')}</span><div><h4>${esc(title)}</h4>${field(record,'身份') ? `<p>${esc(field(record,'身份'))}</p>` : ''}</div>${badge(field(record,'在场') ? `在场：${field(record,'在场')}` : '')}</header><div class="wsm-mv-location"><span aria-hidden="true">⌖</span><span>${esc(location || '位置未记录')}</span></div>${details(without(record,['位置','身份','在场']))}${prose(record)}</article>`;
    }
    function relation(record,index) {
        const link = record.title.match(/^(.+?)\s*(↔|→|←|->|<->)\s*(.+)$/);
        let from = field(record,'主体'), to = field(record,'对象'), arrow = '→';
        if (link) { from=link[1]; arrow=link[2] === '<->' ? '↔' : link[2] === '->' ? '→' : link[2]; to=link[3]; }
        if (!from || !to) return card(record,'relationships',index);
        const title = `<div class="wsm-mv-relation" aria-label="${esc(`${from} ${arrow} ${to}`)}"><strong>${esc(from)}</strong><span class="wsm-mv-arrow" aria-hidden="true">${arrow}</span><strong>${esc(to)}</strong></div>`;
        return `<article class="wsm-mv-card wsm-mv-relationships">${title}${record.title && !link ? `<h4>${esc(record.title)}</h4>` : ''}${details(without(record,['主体','对象']))}${prose(record)}</article>`;
    }
    function faction(record,index) {
        // Individual affiliation sentences remain readable but are not
        // promoted into invented faction names.
        return card(record,'organizations',index,
            `<div class="wsm-mv-faction-tags">${badge(field(record,'范围') ? `范围：${field(record,'范围')}` : '')}${badge(field(record,'领袖') ? `领袖：${field(record,'领袖')}` : '')}</div>`,['范围','领袖']);
    }
    function organizationView(records) {
        const factions=[], notes=[];
        records.forEach(record => {
            const title=record.title || record.raw.match(/^([^，。；]{2,18}?(?:集团|公司|家族|联军|卫所|军|党|会|部))(?:由|负责|掌控|控制|占据|正在|计划|与|的目标)/)?.[1];
            if (title) factions.push({...record,title});
            else notes.push(record);
        });
        return `${factions.length ? `<div class="wsm-mv-grid wsm-mv-two-columns">${factions.map(faction).join('')}</div>` : '<div class="wsm-empty-state"><b>尚无各方势力概况</b><small>现有记录未说明各方组织的目标、范围与资源；后续读取会按组织整理。</small></div>'}${notes.length ? `<details class="wsm-mv-legacy-notes"><summary>其他组织相关记录 · ${notes.length}</summary>${notes.map((record,index)=>card(record,'organizations',index)).join('')}</details>` : ''}`;
    }
    function chain(parts) {
        const valid = parts.filter(([,value]) => value);
        return valid.length ? `<div class="wsm-mv-chain">${valid.map(([label,value],index) => `${index ? '<span class="wsm-mv-arrow" aria-hidden="true">→</span>' : ''}<section><small>${esc(label)}</small><p>${esc(value)}</p></section>`).join('')}</div>` : '';
    }
    function semanticCard(record,module,index) {
        if (module === 'characters') return person(record,index);
        if (module === 'relationships') return relation(record,index);
        if (module === 'organizations') return faction(record,index);
        if (module === 'npcActivities') return card(record,module,index,`<div class="wsm-mv-location">⌖ ${esc(field(record,'位置') || '活动地点未记录')}</div>${chain([['移动',field(record,'移动')],['当前活动',field(record,'行动')]])}`,['位置','移动','行动']);
        if (module === 'knowledge') {
            const boundaries = [['不知情','不知情者'],['已知部分','只知道的部分'],['未知部分','仍不知道的部分'],['误解','误解'],['怀疑','怀疑但未证实'],['认知边界','认知边界'],['获知条件','获知条件'],['知情','知情者']];
            return card(record,module,index,`<div class="wsm-mv-knowledge">${boundaries.filter(([key]) => field(record,key)).map(([key,label]) => `<section${key !== '知情' ? ' class="wsm-mv-important"' : ''}><small>${label}</small><b>${esc(field(record,key))}</b></section>`).join('')}</div>`,boundaries.map(([key]) => key));
        }
        if (module === 'causalEffects') return card(record,module,index,chain([['起因',field(record,'原因')],['现实路径',field(record,'路径')],['持续后果',field(record,'后果')]]),['原因','路径','后果']);
        if (module === 'triggers') {
            const checks = record.triggerCheck?.checks || [];
            const verification = checks.length && field(record,'状态') !== '已触发' ? `<details class="wsm-mv-legacy-notes"><summary>查看条件核验</summary>${details(checks.map(c => [c.label,`${c.status === 'met' ? '已满足' : c.status === 'blocked' ? '未满足' : '未能自动判断'}：${c.detail.replace(/（需AI判断）$/,'')}`]))}</details>` : '';
            return `<article class="wsm-mv-card wsm-mv-triggers">${heading(record.title || '剧情扣子','◇')}${details([['触发条件',field(record,'条件')],['可能影响',field(record,'影响')],['状态',field(record,'扣子状态') || field(record,'状态')],['未满足条件',field(record,'未满足条件')]])}${details(without(record,['条件','影响','状态','扣子状态','未满足条件']))}${prose(record)}${verification}</article>`;
        }
        if (module === 'processes') return card(record,module,index,chain([['推动因素',field(record,'动力')],['当前趋势',field(record,'趋势')],['结束条件',field(record,'结束')]]),['动力','趋势','结束']);
        if (module === 'progression') return card(record,module,index,chain([['已完成',field(record,'已完成')],['当前阶段',field(record,'当前')],['等待决定',field(record,'决策')]]),['已完成','当前','决策']);
        if (module === 'tasks') return card(record,module,index,`${field(record,'目标') ? `<p class="wsm-mv-objective">${esc(field(record,'目标'))}</p>` : ''}${chain([['当前进展',field(record,'进展')],['完成条件',field(record,'完成')]])}`,['目标','进展','完成']);
        return card(record,module,index);
    }
    function world(records) {
        const keys = ['时间','日期','季节','位置','天气','环境'];
        const fields = records.flatMap(record => record.fields.filter(([key]) => keys.includes(key)));
        // Nested labels in old migrated world snapshots still retain their
        // literal contents. No default weather/location is generated here.
        const tiles = fields.map(([key,value]) => `<div><small>${esc(key)}</small><b>${esc(value)}</b></div>`).join('');
        const remaining = records.map(record => ({...record,fields:without(record,keys)})).filter(record => record.title || record.fields.length || record.prose.length);
        return `${tiles ? `<section class="wsm-mv-world">${tiles}</section>` : ''}${remaining.map((record,index) => card(record,'world',index)).join('')}`;
    }
    function agenda(records,module) {
        return `<div class="wsm-mv-agenda ${module === 'timeline' ? 'wsm-mv-history' : ''}">${records.map((record,index) => {
            const date = field(record,'时间','日期','截止');
            return `<div class="wsm-mv-agenda-row"><div class="wsm-mv-date"><span aria-hidden="true">${module === 'timeline' ? '●' : '◷'}</span><time>${esc(date || (module === 'timeline' ? '时间未记录' : '时间待确认'))}</time></div>${card({...record,fields:without(record,['时间','日期','截止'])},module,index)}</div>`;
        }).join('')}</div>`;
    }
    function mapPaths(records) {
        const paths = [], loose = [];
        for (const record of records) {
            const path = record.title || field(record,'路径') || (/^[^。；\n]+[>＞][^。；\n]+$/.test(record.raw) ? record.raw : '');
            if (path && /\s*[>＞/]\s*/.test(path) && !/https?:/.test(path)) {
                const names = path.split(/\s*[>＞/]\s*/).map(value => value.trim()).filter(Boolean);
                if (names.length > 1 && names.length <= 16) { paths.push({names,record}); continue; }
            }
            const name = record.title;
            const parent = field(record,'上级');
            if (name && parent && name !== parent) { paths.push({names:[parent,name],record}); continue; }
            if (name && !/[。；]/.test(name)) { paths.push({names:[name],record}); continue; }
            loose.push(record);
        }
        // Join explicit parent/child pairs only when that parent has one path.
        // Ambiguous same-name places remain separate; cycles cannot recurse.
        const expanded=paths.map(entry => {
            let names=[...entry.names];
            const visited=new Set(names);
            for (let depth=0;depth<16;depth++) {
                const candidates=paths.filter(other=>other !== entry && other.names.length>1 && other.names.at(-1)===names[0]);
                const unique=[...new Map(candidates.map(other=>[other.names.join('\u0000'),other])).values()];
                if (unique.length !== 1) break;
                const prefix=unique[0].names.slice(0,-1);
                if (prefix.some(name=>visited.has(name))) break;
                prefix.forEach(name=>visited.add(name));
                names=[...prefix,...names];
            }
            return {...entry,names};
        });
        return {paths:expanded,loose};
    }
    function mapView(records,state) {
        const {paths,loose} = mapPaths(records);
        const roots = new Map();
        const worldRecords = (state.memory?.world || []).map(parse);
        const current = worldRecords.map(record => field(record,'位置')).find(Boolean)
            || records.find(record => state.identities?.user && record.raw.includes(state.identities.user) && /目前身处|当前身处/.test(record.raw))?.title || '';
        const occupants = project((state.memory?.characters || []).map(parse),'characters',state).filter(record => record.title && field(record,'位置'));
        for (const {names,record} of paths) {
            let children=roots, node;
            for (const name of names) {
                if (!children.has(name)) children.set(name,{name,children:new Map(),records:[]});
                node=children.get(name); children=node.children;
            }
            node.records.push(record);
        }
        const matches = (location,path) => {
            const normalized = location.split(/\s*[>＞/]\s*/).filter(Boolean);
            return normalized.length > 1 ? normalized.join(' > ') === path.join(' > ') : location === path.at(-1);
        };
        const counts = new Map();
        const count = nodes => nodes.forEach(node => {counts.set(node.name,(counts.get(node.name)||0)+1); count(node.children);});
        count(roots);
        const unambiguous = (location,path) => matches(location,path) && (/[>＞/]/.test(location) || counts.get(path.at(-1)) === 1);
        const tree = (nodes,path=[]) => `<ul>${[...nodes.values()].map(node => {
            const fullPath=[...path,node.name];
            const here=current && unambiguous(current,fullPath);
            const people=occupants.filter(record => unambiguous(field(record,'位置'),fullPath)).map(record => record.title);
            const description=node.records.map(record => `${details(without(record,['上级','路径']))}${prose(record)}`).join('');
            const label=`<span class="wsm-mv-map-name">${esc(node.name)}</span>${here ? badge('当前位置','wsm-mv-here') : ''}${people.map(name=>badge(name)).join('')}`;
            return `<li>${node.children.size ? `<details open><summary>${label}</summary>${description}${tree(node.children,fullPath)}</details>` : `<div class="wsm-mv-map-leaf">${label}</div>${description}`}</li>`;
        }).join('')}</ul>`;
        const routeCard=(record,index) => {
            const route=field(record,'路线').match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
            return route ? card({...record,title:record.title || '通行路线'},'map',index,chain([['起点',route[1]],['终点',route[2]]]),['路线']) : card(record,'map',index);
        };
        return `${current ? `<div class="wsm-mv-location wsm-mv-map-current">⌖ 当前位置：${esc(current)}</div>` : ''}${roots.size ? `<nav class="wsm-mv-map-tree" aria-label="地点层级">${tree(roots)}</nav>` : ''}${loose.length ? `<section class="wsm-mv-map-notes"><h4>地点与路线记录</h4>${loose.map(routeCard).join('')}</section>` : ''}`;
    }
    function render(state,section) {
        if (!WSM.PlainMemory?.isPlain(state)) return null;
        const module=WSM.PlainMemory.sectionModule(section);
        if (!types[module]) return null;
        const values=WSM.PlainMemory.rows(state,section).map(row => WSM.StateLogic?.annotate(state,module,row) || row);
        if (module === 'timeline') for (const entry of state.runtime?.sentenceArchive || []) values.push(`${entry.text}｜历史归档：${entry.reason}｜归档时间：${WSM.StateLogic?.format(entry.at) || '未明确'}`);
        const records=project(values.map(parse),module,state);
        if (module === 'triggers' && WSM.StateLogic) records.forEach(record => { record.triggerCheck = WSM.StateLogic.trigger(state,record.raw); });
        if (!records.length) return empty(module);
        let html;
        if (module === 'map') html=mapView(records,state);
        else if (module === 'world') html=world(records);
        else if (module === 'organizations') html=organizationView(records);
        else if (['timeline','schedules'].includes(module)) html=agenda(records,module);
        else html=`<div class="wsm-mv-grid ${['organizations','characters','relationships','knowledge'].includes(module) ? 'wsm-mv-two-columns' : ''}">${records.map((record,index)=>semanticCard(record,module,index)).join('')}</div>`;
        return `<div class="wsm-memory-view" data-memory-view="${esc(module)}">${html}</div>`;
    }
    WSM.MemoryView={render,_test:{parse,mapPaths,project}};
})();
