import http from 'node:http';

const PORT = Number(process.env.WSM_MOCK_PORT || 8787);
const clone = (value) => JSON.parse(JSON.stringify(value));
const requests = [];

function readJson(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(raw || '{}')); }
            catch (error) { reject(error); }
        });
        req.on('error', reject);
    });
}

function addMinutes(state, minutes) {
    const next = clone(state);
    next.world ||= {};
    next.world.time ||= { display: '14:30', elapsedMinutes: 0 };
    next.world.time.elapsedMinutes = Number(next.world.time.elapsedMinutes || 0) + minutes;
    const match = String(next.world.time.display || '').match(/(\d{1,2}):(\d{2})/);
    if (match) {
        const total = (Number(match[1]) * 60 + Number(match[2]) + minutes) % 1440;
        next.world.time.display = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    }
    return next;
}

function npcCandidates(source = {}) {
    const reserved = new Set([source.identities?.user, source.identities?.char, 'user', 'char'].filter(Boolean));
    const values = [];
    for (const book of source.worldbooks || []) {
        for (const entry of book.entries || []) {
            values.push(...(Array.isArray(entry.keys) ? entry.keys : []));
            const commentName = String(entry.comment || '').match(/(?:姓名|人物)[：:]\s*([\p{Script=Han}·]{2,8})/u)?.[1];
            if (commentName) values.push(commentName);
        }
    }
    const profile = [source.character?.description, source.character?.scenario, source.persona].filter(Boolean).join('\n');
    for (const match of profile.matchAll(/(?:姓名|名字|同事|朋友|家人|经纪人|助理)[：:]\s*([\p{Script=Han}·]{2,8})/gu)) values.push(match[1]);
    return [...new Set(values.map((value) => String(value || '').trim()).filter((value) => value.length >= 2 && value.length <= 16 && !reserved.has(value)))].slice(0, 10);
}

function relatedNpcRecords(payload, location) {
    return npcCandidates(payload.source).map((name, index) => ({
        id: `npc-${index + 1}`,
        name,
        persona: '来自角色卡或世界书的既存相关人物',
        location: '按既有设定活动',
        present: false,
        status: '正常生活中',
        goals: ['延续自己的既有生活与事务'],
        currentAction: '进行与自身身份相符的日常活动',
        memories: [],
        notes: `Mock从设定资料提取；不因主角行动自动出现于${location}`,
    }));
}

function initialize(payload, preserveExisting = false) {
    const current = clone(payload.currentState || {});
    const charName = payload.source?.identities?.char || payload.source?.character?.name || '当前角色';
    const userName = payload.source?.identities?.user || '当前用户';
    const location = current.world?.location?.current || '当前场景';
    const extractedNpcs = relatedNpcRecords(payload, location);
    const baseCharacters = preserveExisting && Array.isArray(current.characters) ? current.characters : [
        { id: 'user', name: userName, location, present: true, status: '正常', goals: [], currentAction: '等待剧情继续', memories: [], notes: '' },
        { id: 'char', name: charName, location, present: true, status: '正常', goals: ['回应当前交流'], currentAction: `关注${userName}`, memories: [], notes: '' },
    ];
    const existingNames = new Set(baseCharacters.map((item) => item.name));
    return {
        ...current,
        initialized: true,
        world: preserveExisting && current.world ? current.world : {
            time: { display: '14:30', iso: '', timezone: 'Asia/Shanghai', elapsedMinutes: 0 },
            location: { current: '当前场景', environment: '根据最近聊天建立的测试环境', weather: '未明确' },
            facts: ['这是 Mock Planner 建立的测试状态'],
        },
        map: preserveExisting && current.map ? current.map : {
            currentLocationId: 'current-scene',
            locations: [{ id: 'current-scene', name: '当前场景', area: '测试区域', description: '根据最近聊天建立的地点', status: 'visited' }],
            routes: [],
        },
        identities: { user: userName, char: charName },
        characters: [...baseCharacters, ...extractedNpcs.filter((item) => !existingNames.has(item.name))],
        npcActivities: preserveExisting ? (current.npcActivities || []) : [{ id: 'activity-char-1', characterId: 'char', location: '当前场景', action: `正在关注${userName}并继续交流` }],
        relationships: preserveExisting ? (current.relationships || []) : [{ id: 'rel-1', from: 'user', to: 'char', type: '当前关系', status: '彼此仍在了解，交流自然但有所保留', evidence: [] }],
        knowledge: current.knowledge || [], tasks: current.tasks || [], events: current.events || [], triggers: current.triggers || [], threads: current.threads || [], processes: current.processes || [], causalEffects: current.causalEffects || [], timeline: current.timeline || [],
        lockedPaths: current.lockedPaths || [],
    };
}

function makeResult(payload) {
    if (payload.task === 'connection_test') return { ok: true };
    if (payload.phase === 'POST_GENERATION_RECONCILE') {
        const state = clone(payload.preState || {});
        const message = payload.actualAssistantMessage || {};
        const summary = `Mock结算：${String(message.content || '正文已生成').slice(0, 60)}`;
        return {
            state,
            actualChanges: ['已读取实际正文；Mock只追加一条时间线，不把Planner计划冒充事实'],
            timelineEntry: { summary, participants: ['user', 'char'], location: state.world?.location?.current || '', evidence: ['来自实际助手正文'] },
        };
    }

    const rebuilding = payload.phase === 'REFRESH_WORLD';
    const base = payload.phase === 'INITIALIZE_WORLD' ? initialize(payload) : rebuilding ? initialize(payload, true) : clone(payload.currentState || initialize(payload));
    const state = payload.phase === 'PRE_GENERATION_PLAN' ? addMinutes(base, 5) : base;
    if (payload.phase === 'PRE_GENERATION_PLAN') {
        state.npcActivities = Array.isArray(state.npcActivities) ? state.npcActivities : [];
        state.npcActivities.push({ id: `activity-char-${Date.now()}`, characterId: 'char', location: state.world?.location?.current || '', action: '继续当前已有行动' });
        state.npcActivities = state.npcActivities.filter((item) => item.characterId !== 'char').concat(state.npcActivities.filter((item) => item.characterId === 'char').slice(-5));
    }
    return {
        state,
        plan: {
            timeAdvanceMinutes: payload.phase === 'PRE_GENERATION_PLAN' ? 5 : 0,
            sceneAssessment: { status: 'quiet', shouldAdvance: false, intensity: 'none', evidence: ['当前交流仍在自然延续'] },
            actorDecisions: [{ characterId: 'char', action: '继续当前交流', motiveRef: 'currentAction', knowledgeRefs: [], capable: true, hasOpportunity: true, allowed: true, reason: '人物在场且正在交流' }],
            backgroundQueue: [],
            advanceDecision: { mode: 'continue', sourceRefs: ['char'], actorId: 'char', intensity: 'none', direction: '继续当前交流', reason: '无需制造额外事件' },
            npcUpdates: (state.characters || []).map((item) => ({ characterId: item.id, mode: item.present ? 'realtime' : 'carry', action: item.currentAction || '保持原状态', reason: item.present ? '当前场景内' : '后台更新时间未到' })),
            triggeredEventIds: [],
            eligibleDevelopments: ['继续当前交流'],
            forbiddenDevelopments: ['突然出现无关NPC', '无因果依据的事故或冲突'],
            notes: rebuilding ? 'Mock已保留旧事实并从角色卡与世界书补建相关NPC。' : '这是本地Mock结果，用来验证插件闭环。',
        },
        injection: `<WORLD_STATE>\n时间：${state.world?.time?.display || '未设定'}\n地点：${state.world?.location?.current || '未设定'}\n本轮：继续当前交流；不要突然制造第三人、事故或重大事件。\n</WORLD_STATE>`,
    };
}

function send(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, service: 'world-state-machine-mock' });
    if (req.method === 'GET' && req.url === '/requests') return send(res, 200, requests);
    if (req.method === 'POST' && req.url === '/reset') {
        requests.length = 0;
        return send(res, 200, { ok: true });
    }
    if (req.method !== 'POST' || !req.url?.replace(/\/+$/, '').endsWith('/chat/completions')) return send(res, 404, { error: 'Use POST /v1/chat/completions' });
    try {
        const body = await readJson(req);
        const userContent = [...(body.messages || [])].reverse().find((item) => item.role === 'user')?.content || '{}';
        let payload = null;
        try { payload = JSON.parse(userContent); }
        catch { /* Main prose generation is not a Planner JSON request. */ }
        const isPlanner = payload && typeof payload === 'object' && (payload.phase || payload.task === 'connection_test');
        requests.push({ at: new Date().toISOString(), kind: isPlanner ? 'planner' : 'prose', body });
        if (requests.length > 100) requests.splice(0, requests.length - 100);
        const content = isPlanner
            ? JSON.stringify(makeResult(payload))
            : '她抬眼看向WSM测试，轻轻点了点头。\n\n“我听见了。我们从眼前的事继续吧。”';
        send(res, 200, { id: `mock-${Date.now()}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
        console.log(isPlanner ? `[Mock Planner] ${payload.phase || 'connection_test'} -> 200` : '[Mock Prose] chat.completions -> 200');
    } catch (error) {
        send(res, 400, { error: String(error?.message || error) });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`World State Machine Mock Planner: http://127.0.0.1:${PORT}/v1`);
    console.log('Press Ctrl+C to stop.');
});
