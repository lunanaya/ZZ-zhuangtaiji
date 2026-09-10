(function () {
    'use strict';
    const W = window.WorldStateMachine = window.WorldStateMachine || {};
    const DAY = 86400000;
    const NUMBER = '[零〇一二两三四五六七八九十百千\\d]+';
    const str = value => String(value ?? '').trim();
    const copy = value => JSON.parse(JSON.stringify(value));
    const uncertain = value => /推测|推断|假设|可能|尚待证实|未证实|听说|传闻|怀疑/.test(value);
    function number(value) {
        if (/^\d+$/.test(value)) return +value;
        const digits = '零一二三四五六七八九';
        if (/^[零〇一二两三四五六七八九]+$/.test(value)) return +[...value.replace(/〇/g,'零').replace(/两/g,'二')].map(c => digits.indexOf(c)).join('');
        let sum = 0, digit = 0;
        for (const char of str(value).replace(/〇/g, '零').replace(/两/g, '二')) {
            if (digits.includes(char)) digit = digits.indexOf(char);
            else if ('十百千'.includes(char)) { sum += (digit || 1) * ({十:10, 百:100, 千:1000})[char]; digit = 0; }
            else return NaN;
        }
        return sum + digit;
    }
    // Tags are an optional, readable contract. Untagged prose is never treated
    // as executable code, and duplicate/conflicting tags remain unresolved.
    function parse(value) {
        const parts = str(value).split(/｜|(?<!\|)\|(?!\|)/).map(str);
        const fields = Object.create(null);
        const prose = [];
        let title = '';
        for (const part of parts) {
            const match = part.match(/^([^：:]+)[：:]\s*(.*)$/);
            if (match) (fields[match[1].trim()] ||= []).push(match[2].trim());
            else if (!title) title = part;
            else if (part) prose.push(part);
        }
        return {raw:str(value), title, fields, prose, get(key) { return fields[key]?.length === 1 ? fields[key][0] : ''; }};
    }
    function date(value) {
        const input = str(value).replace(/^(?:当前时间|当前日期|时间|日期)[：:\s]*/, '');
        const absolute = input.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?(?:[T\s]+\d{1,2}[:：]\d{2})?/);
        if (absolute) {
            if (/上午|下午|晚上|傍晚|早上|中午|凌晨/.test(input)) return null;
            const at = W.Storage.storyTimestamp(absolute[0]);
            return at == null ? null : {calendar:'gregorian', at, precision:/[:：]\d{2}/.test(absolute[0]) ? 'minute' : 'day', label:absolute[0]};
        }
        const era = input.match(new RegExp(`([^\\s｜|：:，。；>]{1,16}?)(${NUMBER})年\\s*([春夏秋冬])(?:季)?\\s*第?(${NUMBER})[日天](?:\\s+(\\d{1,2})[:：](\\d{2}))?`));
        if (!era) return null;
        const [, name, yearText, season, dayText, hour, minute] = era;
        const year = number(yearText), day = number(dayText);
        if (!(year > 0 && day > 0) || (hour != null && (+hour > 23 || +minute > 59))) return null;
        // No invented lunar dates or season lengths. Comparisons are valid only
        // inside the same named year/season until the story supplies a calendar.
        return {calendar:`era:${name}:${year}:${season}`, at:day * DAY + ((+hour || 0) * 60 + (+minute || 0)) * 60000,
            precision:hour == null ? 'day' : 'minute', prefix:`${name}${yearText}年${season}`, label:era[0]};
    }
    function clock(state) {
        const candidates = (state.memory?.world || []).filter(row => !uncertain(row)).map(row => {
            const record = parse(row);
            return date(record.get('时间') || record.get('当前时间') || row);
        }).filter(Boolean);
        if (!candidates.length) return null;
        const first = candidates[0];
        return candidates.every(item => item.calendar === first.calendar && item.at === first.at) ? first : null;
    }
    function timeText(row) {
        const r = parse(row);
        return r.get('时间') || r.get('约定时间') || r.get('截止时间') || r.get('有效至') ||
            row.match(new RegExp(`(?:今天|今日|明天|明日|后天|后日|${NUMBER}[日天]后|${NUMBER}小时后|${NUMBER}分钟后)(?:\\s*\\d{1,2}[:：]\\d{2})?`))?.[0] || date(row)?.label || '';
    }
    function resolve(value, anchor) {
        const absolute = date(value);
        if (absolute) return str(value) === absolute.label ? absolute : null;
        if (!anchor || !value || /上午|下午|晚上|傍晚|早上|中午|凌晨/.test(value)) return null;
        const rel = value.match(new RegExp(`^(今天|今日|明天|明日|后天|后日|(${NUMBER})([日天]|小时|分钟)后)(?:\\s*(\\d{1,2})[:：](\\d{2}))?$`));
        if (!rel) return null;
        const [, token, amount, unit, hour, minute] = rel;
        if (hour != null && (+hour > 23 || +minute > 59)) return null;
        const n = amount ? number(amount) : /后天|后日/.test(token) ? 2 : /明天|明日/.test(token) ? 1 : 0;
        const byDay = !unit || /[日天]/.test(unit);
        if (!byDay && anchor.precision !== 'minute') return null;
        const at = byDay ? Math.floor(anchor.at / DAY) * DAY + n * DAY + ((+hour || 0) * 60 + (+minute || 0)) * 60000
            : anchor.at + n * (unit === '小时' ? 3600000 : 60000);
        return {...anchor, at, precision:byDay && hour == null ? 'day' : 'minute', label:''};
    }
    function format(time) {
        if (!time) return '时间待核实';
        if (time.calendar === 'gregorian') return new Date(time.at).toISOString().slice(0, time.precision === 'day' ? 10 : 16).replace('T', ' ') + (time.precision === 'day' ? '（时辰未定）' : '');
        const day = Math.floor(time.at / DAY), minutes = Math.floor((time.at % DAY) / 60000);
        return `${time.prefix}第${day}日` + (time.precision === 'day' ? '（时辰未定）' : ` ${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`);
    }
    const comparable = (a,b) => a && b && a.calendar === b.calendar;
    function deadlineState(now, target) {
        if (!comparable(now,target)) return '时间待核实';
        if (target.precision === 'day') {
            const days = Math.floor(target.at / DAY) - Math.floor(now.at / DAY);
            return days > 0 ? `还有${days}日` : days === 0 ? '今日到期，时辰未定，尚未确认完成' : `超期${-days}日，尚未确认完成`;
        }
        if (now.precision !== 'minute') return '当前时辰未定';
        const minutes = Math.ceil((target.at - now.at) / 60000);
        return minutes > 0 ? `还有${minutes}分钟` : minutes === 0 ? '已到期，尚未确认完成' : `超期${-minutes}分钟，尚未确认完成`;
    }
    function records(state, modules) { return modules.flatMap(module => (state.memory?.[module] || []).map(parse)); }
    function lookup(state, kind, subject) {
        const candidates = records(state, kind === '位置' ? ['characters'] : kind === '资源' ? ['resourceConstraints'] : ['schedules','tasks','triggers','processes','causalEffects','factAnchors']);
        const [owner, resource] = subject.split('/');
        if (kind === '状态' && !candidates.some(r => r.title === owner)) {
            const ended = [...(state.runtime?.sentenceArchive || [])].reverse().find(entry => entry.reason !== '被明确更新或删除' && parse(entry.text).title === owner);
            if (ended) candidates.push(parse(ended.text));
        }
        const values = candidates.filter(r => !uncertain(r.raw) && (r.title === owner || r.get('对象') === owner))
            .filter(r => kind !== '资源' || r.get('资源') === resource)
            .map(r => kind === '位置' ? r.get('位置') : kind === '资源' ? r.get('持有') : r.get('状态')).filter(Boolean);
        return values.length && new Set(values).size === 1 ? values[0] : null;
    }
    const result = (status, detail) => ({status, detail});
    function evaluate(expression, state) {
        const input = str(expression);
        if (!input) return result('unknown','条件未明确');
        // AND binds more tightly than OR; no eval and no implicit fuzzy match.
        if (input.includes(' || ') || input.includes(' && ')) {
            const or = input.includes(' || '), parts = input.split(or ? ' || ' : ' && ').map(item => evaluate(item,state));
            const status = or ? parts.some(x => x.status === 'met') ? 'met' : parts.every(x => x.status === 'blocked') ? 'blocked' : 'unknown'
                : parts.some(x => x.status === 'blocked') ? 'blocked' : parts.every(x => x.status === 'met') ? 'met' : 'unknown';
            return result(status,parts.map(x => x.detail).join(or ? ' 或 ' : '；'));
        }
        const fact = input.match(/^事实\((.+)\)$/);
        if (fact) return result(records(state,['factAnchors','worldRules']).some(r => r.raw === fact[1] && !uncertain(r.raw)) ? 'met' : 'unknown',input);
        const match = input.match(/^(位置|资源|状态)\(([^()]+)\)\s*(>=|<=|!=|=|>|<)\s*([^()]+)$/);
        if (!match) return result('unknown',`${input}（需AI判断）`);
        const [,kind,subject,op,expected] = match;
        const actual = lookup(state,kind,subject);
        if (actual == null) return result('unknown',`${input}（缺少唯一的已确认值）`);
        let met;
        if (kind === '资源') {
            if (![actual,expected.trim()].every(v => /^-?\d+(?:\.\d+)?$/.test(v) && Number.isFinite(+v))) return result('unknown',`${input}（数值或单位不明确）`);
            const a = +actual, b = +expected;
            met = ({'>=':a >= b,'<=':a <= b,'>':a > b,'<':a < b,'=':a === b,'!=':a !== b})[op];
        } else if (op === '=' || op === '!=') met = op === '=' ? actual === expected.trim() : actual !== expected.trim();
        else return result('unknown',`${input}（不支持此比较）`);
        return result(met ? 'met' : 'blocked',`${input}；当前：${actual}`);
    }
    function trigger(state, row) {
        const r = parse(row), checks = [];
        const add = (label, check) => checks.push({...check, label});
        const has = label => Object.hasOwn(r.fields,label);
        const actor = r.get('实施者');
        if (has('实施者')) add('实施者',result(actor && records(state,['characters','organizations']).some(x => x.title === actor && !uncertain(x.raw)) ? 'met' : 'unknown',actor || '未明确'));
        for (const label of ['准备条件','到场条件','条件']) if (has(label)) add(label,evaluate(r.get(label),state));
        if (has('时间条件')) {
            const time = r.get('时间条件'), parsedTime = date(time), target = parsedTime?.label === time ? parsedTime : null, now = clock(state);
            add('时间条件',time === '无时间限制' ? result('met',time) : !comparable(now,target) || (target.precision === 'minute' && now.precision !== 'minute')
                ? result('unknown',time || '未明确') : result(now.at >= target.at ? 'met' : 'blocked',`最早时间：${format(target)}`));
        }
        if (has('例外')) add('例外',result('unknown',r.get('例外') || '未明确'));
        // A hook may remain a loose possibility. Missing optional fields are
        // not failed checks; an empty checklist is not proof of readiness.
        const developed = ['准备条件','到场条件','时间条件','条件'].some(has);
        const status = checks.some(c => c.status === 'blocked') ? 'blocked' : developed && checks.every(c => c.status === 'met') ? 'met' : 'unknown';
        const label = status === 'blocked' ? '条件尚未满足' : status === 'met' ? '已列条件满足，尚未确认发生' : developed ? '待剧情推进确认' : '扣子尚未展开';
        return {status, checks, label};
    }
    function permission(state, row) {
        const r = parse(row);
        const released = r.get('解除条件') ? evaluate(r.get('解除条件'),state) : null;
        return {r, released, status:uncertain(row) || r.get('例外') ? 'unknown' : released?.status === 'met' ? 'released' : 'active'};
    }
    function action(state, actor, intent, destination = '') {
        const checks = [];
        for (const row of state.memory?.resourceConstraints || []) {
            const p = permission(state,row), r = p.r;
            if ((r.get('对象') || r.title) !== actor || p.status === 'released') continue;
            const prohibited = r.get('禁止').split(/[、，,]/).map(str).filter(Boolean);
            if (prohibited.includes(intent)) checks.push(result(p.status === 'unknown' || r.get('例外') ? 'unknown' : 'blocked',`禁止：${intent}${r.get('例外') ? `；例外：${r.get('例外')}` : ''}${r.get('解除条件') ? `；解除条件：${r.get('解除条件')}` : ''}`));
            if (destination && r.get('允许')) {
                const inside = r.get('允许').split(/[、，,]/).map(str).includes(destination);
                checks.push(result(p.status === 'unknown' || r.get('例外') ? 'unknown' : inside ? 'met' : 'unknown',`已知允许范围：${r.get('允许')}；目标：${destination}`));
            }
        }
        return {status:checks.some(c => c.status === 'blocked') ? 'blocked' : 'unknown', checks};
    }
    function route(state, origin, destination) {
        if (!origin || !destination) return result('unknown','出发地或目的地未明确');
        if (origin === destination) return {...result('met','已在目标地点'),minutes:0};
        const edges = [];
        for (const r of records(state,['map'])) {
            if (uncertain(r.raw)) continue;
            const parts = (r.get('路线') || r.title).match(/^(.+?)\s*(→|↔|->)\s*(.+)$/);
            if (!parts || !/^(是|开放|可通行)$/.test(r.get('开放'))) continue;
            if (r.get('条件') && evaluate(r.get('条件'),state).status !== 'met' || r.get('例外')) continue;
            const minutes = /^\d+(?:\.\d+)?$/.test(r.get('耗时分钟')) ? +r.get('耗时分钟') : null;
            edges.push({from:str(parts[1]),to:str(parts[3]),minutes});
            if (parts[2] === '↔') edges.push({from:str(parts[3]),to:str(parts[1]),minutes});
        }
        // Search only observed, explicitly open edges; missing routes are unknown.
        const queue = [{place:origin,path:[origin],minutes:0}], visited = new Set();
        while (queue.length) {
            queue.sort((a,b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity));
            const current = queue.shift();
            if (current.place === destination) return {...result('met',`已知可通行路径：${current.path.join(' → ')}${current.minutes == null ? '；耗时待核实' : `；至少需${current.minutes}分钟（按已知路线）`}`),minutes:current.minutes};
            if (visited.has(current.place)) continue;
            visited.add(current.place);
            for (const edge of edges.filter(e => e.from === current.place)) queue.push({place:edge.to,path:[...current.path,edge.to],minutes:edge.minutes == null || current.minutes == null ? null : current.minutes+edge.minutes});
        }
        return result('unknown','未找到已确认可通行的完整路线；不能据此断言不连通或已到达');
    }
    function locked(state,module) { return (state.lockedPaths || []).some(p => p === 'memory' || p === `memory.${module}` || p.startsWith(`memory.${module}.`)); }
    const key = (module,row) => W.PlainMemory._test.sentenceKey(module,row);
    function timing(state,module,row) {
        const id = key(module,row), stored = state.runtime?.sentenceTiming?.[id];
        if (stored) return stored.target;
        const legacy = state.runtime?.sentenceTimes?.[id], phrase = timeText(row);
        if (Number.isFinite(legacy)) return {calendar:'gregorian',at:legacy,precision:/[:：]\d{2}/.test(phrase) ? 'minute' : 'day'};
        return resolve(phrase,date(parse(row).get('锚定')));
    }
    function prepare(previous,next) {
        next.runtime ||= {};
        const oldClock = clock(previous), now = clock(next);
        next.runtime.storyClock = {current:now, elapsedMinutes:comparable(now,oldClock) && now.at >= oldClock.at && now.precision === 'minute' && oldClock.precision === 'minute' ? (now.at-oldClock.at)/60000 : null};
        const oldTiming = previous.runtime?.sentenceTiming || {};
        const pendingTiming = next.runtime.sentenceTiming || {};
        next.runtime.sentenceTiming = {};
        next.runtime.sentenceTimes = {};
        for (const module of ['schedules','tasks','resourceConstraints','causalEffects']) for (const row of next.memory[module] || []) {
            const id = key(module,row), phrase = timeText(row), r = parse(row);
            if (!phrase) continue;
            // before replacement transfers the original anchor, including partial
            // reads. A different explicit date is a reschedule, not a reread.
            let old = pendingTiming[id] || oldTiming[id];
            if (!old && Number.isFinite(previous.runtime?.sentenceTimes?.[id])) old = {phrase,anchor:null,target:{calendar:'gregorian',at:previous.runtime.sentenceTimes[id],precision:/[:：]\d{2}/.test(phrase) ? 'minute' : 'day'}};
            if (!old && r.title) {
                const matches = (previous.memory?.[module] || []).filter(text => parse(text).title === r.title && timeText(text) === phrase);
                if (matches.length === 1) old = oldTiming[key(module,matches[0])];
            }
            const existed = previous.memory?.[module]?.includes(row);
            const anchor = date(r.get('锚定')) || (existed && !old ? null : now);
            const keep = old?.phrase === phrase && (old.target || !date(r.get('锚定')));
            const target = keep ? old.target : resolve(phrase,anchor);
            next.runtime.sentenceTiming[id] = keep ? copy(old) : {phrase, anchor, target};
            if (target?.calendar === 'gregorian') next.runtime.sentenceTimes[id] = target.at;
        }
        const archive = copy(previous.runtime?.sentenceArchive || []);
        const archived = new Set(archive.map(item => `${item.module}:${item.text}:${item.reason}`));
        const addHistory = (module,text,reason) => {
            const id = `${module}:${text}:${reason}`;
            if (archived.has(id)) return;
            archive.push({module,text,reason,at:now,turn:Number(next.runtime.memoryTurn || 0)}); archived.add(id);
        };
        // A newly supplied, fully covered snapshot supersedes its old version.
        // Partial records, two competing new versions and guesses remain intact.
        for (const module of ['world','characters','npcActivities']) {
            if (locked(next,module)) continue;
            const added = (next.memory[module] || []).filter(row => !previous.memory?.[module]?.includes(row)).map(parse);
            next.memory[module] = (next.memory[module] || []).filter(row => {
                if (!previous.memory?.[module]?.includes(row)) return true;
                const old = parse(row);
                const worldSnapshot = module === 'world' && !old.title && Object.keys(old.fields).every(field => ['时间','当前时间','位置','当前位置','季节','天气','环境'].includes(field));
                if ((!old.title && !worldSnapshot) || old.prose.length || !Object.keys(old.fields).length) return true;
                const replacements = added.filter(r => r.title === old.title && !uncertain(r.raw) &&
                    !r.prose.length &&
                    Object.keys(old.fields).every(field => r.get(field) && old.fields[field].length === 1) &&
                    (module === 'world' ? worldSnapshot : module === 'characters' ? r.get('位置') : r.get('行动') && r.get('活动地点')));
                return replacements.length !== 1;
            });
        }
        for (const module of W.PlainMemory.MODULES) {
            if (locked(next,module)) continue;
            for (const row of previous.memory?.[module] || []) if (!next.memory[module].includes(row)) addHistory(module,row,'被明确更新或删除');
            next.memory[module] = next.memory[module].filter(row => {
                const r = parse(row);
                let reason = '';
                const temporary = r.get('生命周期') === '临时';
                const terminal = /^(?:已完成|已取消|已结束|已失效|已撤销|completed|cancelled|resolved|expired)$/.test(r.get('状态'));
                if (['schedules','tasks','triggers','threads','progression','npcActivities','processes','causalEffects'].includes(module) && terminal) reason = `${uncertain(row) ? '推测记录退出，非已确认结果；' : ''}状态：${r.get('状态')}`;
                if (!uncertain(row) && module === 'triggers' && r.get('一次性') === '是' && r.get('状态') === '已触发') reason = '一次性触发已消耗';
                if (!uncertain(row) && ['resourceConstraints','causalEffects'].includes(module)) {
                    const target = timing(next,module,row);
                    const expired = temporary && r.get('有效至') && comparable(now,target) && (target.precision === 'day' ? now.at >= target.at + DAY : now.precision === 'minute' && now.at >= target.at);
                    if (expired) reason = '明确有效期已结束';
                    if (r.get('解除条件') && evaluate(r.get('解除条件'),next).status === 'met' && !r.get('例外')) reason = '明确解除条件已满足';
                    if (temporary && terminal) reason = `状态：${r.get('状态')}`;
                }
                if (reason) addHistory(module,row,reason);
                return !reason;
            });
        }
        next.runtime.sentenceArchive = archive;
        const active = new Set(W.PlainMemory.MODULES.flatMap(module => next.memory[module].map(row => key(module,row))));
        for (const field of ['sentenceTiming','sentenceTimes','sentenceDelivery']) next.runtime[field] = Object.fromEntries(Object.entries(next.runtime[field] || {}).filter(([id]) => active.has(id) || id.startsWith('history:')));
        return next;
    }
    function annotate(state,module,row) {
        const r = parse(row), extras = [];
        if (['npcActivities','threads','progression','processes','causalEffects','resourceConstraints'].includes(module)) {
            for (const label of ['消退条件','结束条件']) if (r.get(label)) {
                const check = evaluate(r.get(label),state);
                extras.push(`本地${label}核验：${statusLabel(check.status)}；${check.detail}；变化程度和是否结束仍须结合实际进展判断`);
            }
        }
        if (['schedules','tasks'].includes(module)) {
            const target = timing(state,module,row);
            if (target) extras.push(`固定日期：${format(target)}`,`本地时间核验：${deadlineState(clock(state),target)}`);
        }
        if (module === 'tasks' && r.get('玩家接受') !== '是') extras.push('任务归属待核实：未确认玩家明确接受，不得代为承诺');
        if (module === 'resourceConstraints' && (r.get('允许') || r.get('禁止'))) {
            const p = permission(state,row);
            extras.push(`本地权限核验：${p.status === 'released' ? '解除条件已满足' : p.status === 'unknown' ? '推测权限待证实' : '约束仍有效'}`);
            if (p.released) extras.push(`解除检查：${p.released.detail}（${statusLabel(p.released.status)}）`);
            if (r.get('例外')) extras.push('例外适用需另行判断');
        }
        if (module === 'triggers') {
            const check = trigger(state,row);
            extras.push(`扣子状态：${r.get('状态') === '已触发' ? '已触发（按剧情记录）' : check.label}`);
            if (r.get('状态') !== '已触发' && check.status === 'blocked') extras.push(`未满足条件：${check.checks.filter(c => c.status === 'blocked').map(c => `${c.label}：${c.detail}`).join('；')}`);
        } else if (r.get('前置条件')) {
            const c = evaluate(r.get('前置条件'),state); extras.push(`前置核验：${statusLabel(c.status)}；${c.detail}`);
        }
        if (module === 'npcActivities') {
            const check = action(state,r.title,r.get('行动'),r.get('目的地'));
            extras.push(...check.checks.map(c => `行动权限：${statusLabel(c.status)}；${c.detail}`));
            if (r.get('目的地')) {
                const path = route(state,r.get('出发') || lookup(state,'位置',r.title),r.get('目的地'));
                extras.push(`移动核验：${path.detail}`);
                const elapsed = state.runtime?.storyClock?.elapsedMinutes;
                if (path.minutes != null && elapsed != null && elapsed < path.minutes) extras.push(`本次仅经过${elapsed}分钟，不足以从出发地完成该行程；此前已在途的进度须另行核实`);
            }
        }
        return row + (extras.length ? `｜${extras.join('｜')}` : '');
    }
    function statusLabel(status) { return ({met:'已满足',blocked:'受阻',unknown:'待核实'})[status]; }
    function due(state,module,row) {
        const now = clock(state), target = timing(state,module,row);
        if (!comparable(now,target)) return null;
        if (target.precision === 'day' ? Math.floor(now.at/DAY) >= Math.floor(target.at/DAY) : now.precision === 'minute' && now.at >= target.at - 1800000) return `${target.calendar}:${target.at}`;
        return null;
    }
    function context(state) {
        const currentText = [...Object.values(state.memory || {}).flat(), str(W.Context?.latestUserMessage?.()?.content)].join('\n');
        return {clock:state.runtime?.storyClock || {current:clock(state)},
            recentResults:(state.runtime?.sentenceArchive || []).filter(entry => {
                const title = parse(entry.text).title;
                return entry.reason !== '被明确更新或删除' && (Number(entry.turn || 0) === Number(state.runtime?.memoryTurn || 0) || title.length >= 2 && currentText.includes(title));
            })
                .map(({module,text,reason}) => ({module,text,reason})),
            anchoredTimes:Object.entries(state.runtime?.sentenceTiming || {}).map(([id,value]) => ({key:id,...value})),
            checks:['resourceConstraints','schedules','tasks','triggers','npcActivities','threads','progression','processes','causalEffects'].flatMap(module => (state.memory?.[module] || []).map(row => annotate(state,module,row)))};
    }
    W.StateLogic = {parse, date, clock, timeText, resolve, format, deadlineState, evaluate, trigger, permission, action, route, prepare, annotate, due, context, uncertain};
})();
