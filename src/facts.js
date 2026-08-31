(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

    const OWNER_ORDER = Object.freeze([
        'worldRules', 'world', 'factAnchors', 'resourceConstraints', 'characters',
        'npcActivities', 'relationships', 'knowledge', 'map', 'tasks', 'events',
        'triggers', 'threads', 'processes', 'causalEffects', 'worldbook', 'pacing', 'planner',
        'timeline',
    ]);
    const OWNERS = new Set(OWNER_ORDER);
    const DELIVERIES = new Set(['resident', 'conditional', 'lookup', 'local']);
    const text = (value) => String(value ?? '').trim();
    const list = (value) => [...new Set((Array.isArray(value) ? value : (value ? [value] : [])).map(text).filter(Boolean))];

    function hash(value) {
        const input = text(value);
        let result = 2166136261;
        for (let index = 0; index < input.length; index += 1) result = Math.imul(result ^ input.charCodeAt(index), 16777619);
        return (result >>> 0).toString(36);
    }
    function slug(value) {
        const normalized = text(value).toLocaleLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '_').replace(/^_+|_+$/g, '');
        return normalized.slice(0, 42) || 'fact';
    }
    function stableFactId(value = {}, fallbackOwner = 'worldbook') {
        const explicit = text(value.factId || value.id);
        if (explicit) return explicit;
        const statement = text(value.statement || value.information || value.fact || value.text || value.condition || value.title || value.name);
        const source = list(value.sourceRefs)[0] || fallbackOwner;
        return `${fallbackOwner}_${slug(statement)}_${hash(`${source}|${statement}`)}`;
    }
    function normalize(value = {}, fallback = {}) {
        const source = value && typeof value === 'object' && !Array.isArray(value) ? value : { statement: value };
        const statement = text(source.statement || source.information || source.fact || source.text || source.condition || source.summary || source.title || fallback.statement);
        const ownerCandidate = text(source.owner || fallback.owner || 'worldbook');
        const owner = OWNERS.has(ownerCandidate) ? ownerCandidate : 'worldbook';
        const deliveryCandidate = text(source.delivery || fallback.delivery || 'conditional').toLowerCase();
        const fact = {
            factId: stableFactId({ ...source, statement }, owner),
            owner,
            consumers: list(source.consumers || fallback.consumers),
            delivery: DELIVERIES.has(deliveryCandidate) ? deliveryCandidate : 'conditional',
            scope: list(source.scope || fallback.scope),
            sourceRefs: list(source.sourceRefs || fallback.sourceRefs),
            dependencyFactIds: list(source.dependencyFactIds || source.dependencies || fallback.dependencyFactIds),
            statement,
            conditions: list(source.conditions || fallback.conditions),
            exceptions: list(source.exceptions || fallback.exceptions),
            precedence: Math.max(0, Math.min(100, Math.round(Number(source.precedence ?? fallback.precedence ?? 50) || 0))),
            cues: list(source.cues || source.keywords || source.triggers || fallback.cues),
            depth: Math.max(0, Math.min(100, Math.round(Number(source.depth ?? fallback.depth ?? 4) || 0))),
            type: text(source.type || fallback.type || (owner === 'worldRules' ? 'rule' : 'fact')),
            priority: text(source.priority || fallback.priority || 'L2').toUpperCase(),
            knowledgeBoundary: source.knowledgeBoundary && typeof source.knowledgeBoundary === 'object'
                ? {
                    knownBy: list(source.knowledgeBoundary.knownBy),
                    believedBy: list(source.knowledgeBoundary.believedBy),
                    suspectedBy: list(source.knowledgeBoundary.suspectedBy),
                    misunderstoodBy: list(source.knowledgeBoundary.misunderstoodBy),
                    unknownTo: list(source.knowledgeBoundary.unknownTo),
                    discoveryPaths: list(source.knowledgeBoundary.discoveryPaths),
                    maturityConditions: list(source.knowledgeBoundary.maturityConditions),
                }
                : null,
        };
        if (!fact.consumers.includes(owner)) fact.consumers.unshift(owner);
        return fact;
    }
    function merge(values = []) {
        const byId = new Map();
        values.map((item) => normalize(item)).filter((item) => item.statement).forEach((item) => {
            const previous = byId.get(item.factId);
            if (!previous) { byId.set(item.factId, item); return; }
            const chosen = item.precedence >= previous.precedence ? item : previous;
            byId.set(item.factId, {
                ...previous,
                ...chosen,
                consumers: list([...previous.consumers, ...item.consumers]),
                scope: list([...previous.scope, ...item.scope]),
                sourceRefs: list([...previous.sourceRefs, ...item.sourceRefs]),
                dependencyFactIds: list([...previous.dependencyFactIds, ...item.dependencyFactIds]),
                conditions: list([...previous.conditions, ...item.conditions]),
                exceptions: list([...previous.exceptions, ...item.exceptions]),
                cues: list([...previous.cues, ...item.cues]),
            });
        });
        return [...byId.values()];
    }
    function render(value, state = {}) {
        const fact = normalize(value);
        if (!fact.statement) return '';
        if (fact.owner === 'worldRules' || fact.type === 'rule' || fact.exceptions.length || fact.conditions.length) {
            return [
                fact.statement,
                fact.scope.length ? `适用范围：${fact.scope.join('、')}` : '',
                fact.conditions.length ? `条件：${fact.conditions.join('；')}` : '',
                fact.exceptions.length ? `例外：${fact.exceptions.join('；')}` : '',
            ].filter(Boolean).join('｜');
        }
        if (fact.owner === 'knowledge' && fact.knowledgeBoundary) {
            const boundary = fact.knowledgeBoundary;
            const resolve = (id) => {
                const key = text(id).toLowerCase();
                if (['user','<user>'].includes(key)) return text(state?.identities?.user) || id;
                if (['char','character','<char>'].includes(key)) return text(state?.identities?.char) || id;
                return id;
            };
            return [
                `秘密/信息：${fact.statement}`,
                boundary.knownBy.length ? `确认者：${boundary.knownBy.map(resolve).join('、')}` : '',
                boundary.believedBy.length ? `相信者：${boundary.believedBy.map(resolve).join('、')}` : '',
                boundary.suspectedBy.length ? `怀疑者：${boundary.suspectedBy.map(resolve).join('、')}` : '',
                boundary.misunderstoodBy.length ? `误解者：${boundary.misunderstoodBy.map(resolve).join('、')}` : '',
                boundary.unknownTo.length ? `未知者：${boundary.unknownTo.map(resolve).join('、')}` : '',
                boundary.discoveryPaths.length ? `发现路径：${boundary.discoveryPaths.join('；')}` : '',
                boundary.maturityConditions.length ? `揭示条件：${boundary.maturityConditions.join('；')}` : '',
            ].filter(Boolean).join('｜');
        }
        return fact.statement;
    }
    function requiredByContext(fact, context = '') {
        if (fact.delivery === 'resident') return true;
        if (fact.delivery === 'local') return false;
        const input = text(context).toLocaleLowerCase();
        const cues = list([...(fact.cues || []), ...(fact.scope || [])]);
        return cues.some((cue) => input.includes(cue.toLocaleLowerCase()));
    }
    function expandDependencies(selected = [], catalog = []) {
        const byId = new Map(merge(catalog).map((fact) => [fact.factId, fact]));
        const output = new Map(merge(selected).map((fact) => [fact.factId, fact]));
        const queue = [...output.values()];
        while (queue.length) {
            const current = queue.shift();
            current.dependencyFactIds.forEach((id) => {
                if (output.has(id) || !byId.has(id)) return;
                const dependency = byId.get(id);
                output.set(id, dependency);
                queue.push(dependency);
            });
        }
        return [...output.values()];
    }

    WSM.Facts = { OWNER_ORDER, OWNERS, DELIVERIES, hash, slug, stableFactId, normalize, merge, render, requiredByContext, expandDependencies, list };
})();
