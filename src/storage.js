(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    const META_KEY = 'worldStateMachine';
    const HISTORY_LIMIT = 10;

    const clone = (value) => {
        try { return structuredClone(value); }
        catch (_) { return JSON.parse(JSON.stringify(value)); }
    };
    const RETENTION_LIMITS = Object.freeze({
        currentConditions: 8, factAnchors: 16, worldRules: 64, resourceConstraints: 10, organizations: 24, locations: 256, routes: 256, characters: 24, npcActivities: 24,
        relationships: 24, knowledge: 24, schedules: 12, tasks: 8, triggers: 6,
        threads: 8, processes: 8, causalEffects: 10, timeline: 24,
    });
    const MEMORY_MODULES = ['worldRules','factAnchors','resourceConstraints','organizations','characters','npcActivities','relationships','knowledge','schedules','tasks','triggers','threads','processes','causalEffects','timeline'];
    const PRIORITY_DEFAULTS = Object.freeze({
        worldRules: 'L3', factAnchors: 'L3', resourceConstraints: 'L2', organizations: 'L2', characters: 'L2', npcActivities: 'L1', relationships: 'L2', knowledge: 'L2', schedules: 'L2', tasks: 'L2',
        triggers: 'L1', threads: 'L2', processes: 'L2', causalEffects: 'L2', timeline: 'L1',
    });
    const TRUTH_STATUS_SET = new Set(Object.keys(WSM.Defaults?.TRUTH_STATUSES || {
        confirmed: 1, derived: 1, system_generated: 1, suspected: 1, assumed: 1,
        unknown: 1, not_established: 1, not_applicable: 1, failed: 1,
    }));
    const HIGH_RISK_MODULES = new Set(['worldRules','factAnchors','resourceConstraints','organizations','characters','relationships','knowledge','schedules','tasks','currentConditions']);
    const CONJECTURAL_TRUTH = new Set(['system_generated','suspected','assumed','unknown','not_established','failed']);
    function stringList(value) {
        const values = Array.isArray(value) ? value : (value == null || value === '' ? [] : [value]);
        return [...new Set(values.map((item) => readableText(item)).filter(Boolean))];
    }
    function evidenceRefs(item) {
        return stringList([...(Array.isArray(item?.sourceRefs) ? item.sourceRefs : []), ...(Array.isArray(item?.evidenceRefs) ? item.evidenceRefs : []), ...(Array.isArray(item?.evidence) ? item.evidence : [])]);
    }
    function normalizeTruthStatus(module, item = {}) {
        const raw = String(item.truthStatus || '').trim().toLowerCase();
        if (TRUTH_STATUS_SET.has(raw)) return raw;
        if (item.readFailed === true || item.status === 'read_failed') return 'failed';
        if (module === 'relationships' && item.coverageOnly === true) return 'not_established';
        const certainty = String(item.certainty || '').trim().toLowerCase();
        if (['suspected','claim','believed','rumor','misunderstood'].includes(certainty)) return 'suspected';
        if (evidenceRefs(item).length) return 'confirmed';
        if (module === 'relationships' && (item.status || item.type)) return 'suspected';
        if (module === 'conditions') return 'suspected';
        if (module === 'characters' && ['user','char','character','<user>','<char>'].includes(String(item.id || '').toLowerCase())) return 'confirmed';
        if (HIGH_RISK_MODULES.has(module) || module === 'characters') return 'unknown';
        return 'assumed';
    }
    function normalizeTruthItem(module, value) {
        const item = Object.assign({}, value || {});
        item.sourceRefs = stringList(item.sourceRefs);
        item.basis = stringList(item.basis);
        item.truthStatus = normalizeTruthStatus(module, item);
        const policyKey = ({ worldRules: 'worldRules', factAnchors: 'factAnchors', resourceConstraints: 'resourceConstraints', characters: 'characterIdentity', relationships: 'relationships', knowledge: 'knowledge', tasks: 'tasks', npcActivities: 'npcActivities' })[module];
        const allowed = WSM.Defaults?.INFERENCE_POLICIES?.[policyKey]?.allow;
        if (Array.isArray(allowed) && !allowed.includes(item.truthStatus)) item.truthStatus = HIGH_RISK_MODULES.has(module) ? 'unknown' : 'assumed';
        const configuredIdentity = module === 'characters' && ['user','char','character','<user>','<char>'].includes(String(item.id || '').toLowerCase());
        if (item.truthStatus === 'confirmed' && !evidenceRefs(item).length && !configuredIdentity) {
            item.truthStatus = module === 'relationships' ? 'suspected' : (HIGH_RISK_MODULES.has(module) ? 'unknown' : 'assumed');
            if (!item.basis.length) item.basis = ['旧状态没有绑定可核对来源，等待定点回查'];
        }
        if (item.truthStatus === 'derived' && !item.basis.length) {
            item.truthStatus = HIGH_RISK_MODULES.has(module) ? 'unknown' : 'assumed';
            item.basis = ['缺少可复算的推导依据'];
        }
        if (item.truthStatus === 'system_generated' && HIGH_RISK_MODULES.has(module)) {
            item.truthStatus = 'unknown';
            item.basis = ['该模块禁止系统自由生成，等待原文或设定依据'];
        }
        if (CONJECTURAL_TRUTH.has(item.truthStatus) && String(item.priority || '').toUpperCase() === 'L3') item.priority = 'L2';
        return item;
    }
    function truthMeta(value, fallbackStatus = 'unknown', fallbackBasis = []) {
        const meta = value && typeof value === 'object' && !Array.isArray(value) ? Object.assign({}, value) : {};
        const status = String(meta.truthStatus || fallbackStatus).trim().toLowerCase();
        meta.truthStatus = TRUTH_STATUS_SET.has(status) ? status : fallbackStatus;
        meta.basis = stringList(meta.basis).length ? stringList(meta.basis) : stringList(fallbackBasis);
        meta.sourceRefs = stringList(meta.sourceRefs);
        return meta;
    }
    function validateTruthMeta(value, allowed, fallbackStatus = 'unknown', label = '字段') {
        const meta = truthMeta(value, fallbackStatus);
        if (!allowed.includes(meta.truthStatus)) {
            meta.truthStatus = fallbackStatus;
            meta.basis = [`${label}不允许使用原真实性状态，等待合格依据`];
            meta.sourceRefs = [];
        }
        if (meta.truthStatus === 'confirmed' && !meta.sourceRefs.length) {
            meta.truthStatus = fallbackStatus;
            meta.basis = [`${label}标记为已确认但没有来源，等待定点回查`];
        }
        if (meta.truthStatus === 'derived' && !meta.basis.length) {
            meta.truthStatus = fallbackStatus;
            meta.basis = [`${label}缺少可复算的推导依据`];
        }
        return meta;
    }
    function enforceTruthTransition(previous, candidate, module) {
        const before = normalizeTruthItem(module, previous || {});
        const after = normalizeTruthItem(module, candidate || {});
        if (after.truthStatus === 'confirmed' && before.truthStatus !== 'confirmed' && !evidenceRefs(after).length) {
            after.truthStatus = before.truthStatus || 'unknown';
            after.basis = after.basis.length ? after.basis : before.basis;
        }
        if (after.truthStatus === 'confirmed' && evidenceRefs(after).length) after.coverageOnly = false;
        if (module === 'relationships' && after.truthStatus === 'suspected' && after.status !== '尚未读取到已确立的关系') after.coverageOnly = false;
        return after;
    }
    function coverageId(from, to) {
        const input = `${from}>${to}`;
        let hash = 2166136261;
        for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
        return `relationship-coverage-${(hash >>> 0).toString(36)}`;
    }
    function ensureRelationshipCoverage(state) {
        // Coverage belongs in moduleCoverage, not in the relationship data shown
        // to users or injected into the model.  Older builds materialized every
        // unchecked pair as a fake relationship card, which made a successful
        // read look as if the source had stated "尚未读取到".  Strip those legacy
        // records and keep only relationships backed by actual evidence.
        state.relationships = (Array.isArray(state.relationships) ? state.relationships : [])
            .filter((item) => item?.coverageOnly !== true && !String(item?.id || '').startsWith('relationship-coverage-'));
    }
    const COVERAGE_PATHS = Object.freeze({
        currentConditions: ['world','currentConditions'], worldRules: ['worldRules'], factAnchors: ['factAnchors'], resourceConstraints: ['resourceConstraints'], organizations: ['organizations'], locations: ['map','locations'],
        characters: ['characters'], npcActivities: ['npcActivities'], relationships: ['relationships'], knowledge: ['knowledge'], schedules: ['schedules'], tasks: ['tasks'],
        triggers: ['triggers'], threads: ['threads'], progression: ['progression'], processes: ['processes'], causalEffects: ['causalEffects'], timeline: ['timeline'],
    });
    function refreshModuleCoverage(state) {
        const previous = state.moduleCoverage && typeof state.moduleCoverage === 'object' && !Array.isArray(state.moduleCoverage) ? state.moduleCoverage : {};
        const audit = state.runtime?.sourceSummary?.sourceRead?.audit;
        const completeAudit = Number(audit?.failedMessages || 0) === 0
            && Number(audit?.totalReadableMessages || 0) > 0
            && Number(audit?.processedMessages || 0) === Number(audit?.totalReadableMessages || 0);
        const next = {};
        Object.entries(COVERAGE_PATHS).forEach(([module, path]) => {
            const values = path.reduce((value, key) => value?.[key], state);
            const items = Array.isArray(values) ? values : (module === 'progression' && values && typeof values === 'object' && (values.direction || values.currentMovement) ? [values] : []);
            const realItems = items.filter((item) => item?.placeholder !== true && (module !== 'relationships' || item?.coverageOnly !== true));
            const old = previous[module] && typeof previous[module] === 'object' ? previous[module] : {};
            let status;
            if (realItems.length) status = 'has_records';
            else if (module === 'relationships' && items.length) status = 'coverage_only';
            else if (!state.initialized) status = 'not_checked';
            else if (['retrieval_failed','failed'].includes(old.status)) status = 'retrieval_failed';
            else if (old.status === 'not_applicable') status = 'not_applicable';
            else if (old.status === 'unknown') status = 'unknown';
            else if (['empty_confirmed','checked_empty'].includes(old.status)) status = 'empty_confirmed';
            else if (completeAudit) status = 'empty_confirmed';
            else status = 'unknown';
            const basis = ({
                has_records: `已保存${realItems.length}条有效记录`,
                coverage_only: '已检查主要人物组合，但尚未读取到已确立关系',
                empty_confirmed: '完整资料校准已覆盖可读取来源，当前确实没有适合持久化的记录',
                unknown: '当前数组为空，但没有足够依据证明原文确实没有',
                retrieval_failed: old.basis || '资料应当存在但读取或解析失败，必须定点重试',
                not_applicable: old.basis || '当前模块对此对象不适用',
                not_checked: '尚未执行初始化或完整校准',
            })[status];
            next[module] = { status, basis, checkedRevision: Number(state.revision || 0) };
        });
        state.moduleCoverage = next;
        return state;
    }
    function defaultActivity(module, item) {
        if (module === 'worldRules') return item?.delivery === 'resident' ? 'HOT' : 'WARM';
        if (module === 'factAnchors') return 'COLD';
        if (module === 'characters') return item?.present === true ? 'HOT' : 'WARM';
        if (module === 'npcActivities') return 'HOT';
        if (module === 'tasks') return item?.status === 'active' ? 'HOT' : 'WARM';
        if (module === 'triggers') return item?.status === 'eligible' ? 'HOT' : 'WARM';
        if (module === 'causalEffects') return item?.status === 'active' ? 'HOT' : 'WARM';
        if (module === 'timeline') return 'COLD';
        return 'WARM';
    }
    function prepareLifecycle(values, module, revision) {
        return (Array.isArray(values) ? values : []).map((item) => {
            const next = normalizeTruthItem(module, item);
            next.sourceRefs = next.sourceRefs.slice(-4);
            next.basis = next.basis.slice(-4);
            const priority = String(next.priority || '').toUpperCase();
            const activity = String(next.activity || '').toUpperCase();
            next.priority = ['L1','L2','L3'].includes(priority)
                ? priority : (module === 'characters' && next.maintenanceLevel === 'core' ? 'L3' : PRIORITY_DEFAULTS[module]);
            next.activity = ['HOT','WARM','COLD'].includes(activity) ? activity : defaultActivity(module, next);
            if (!Number.isFinite(Number(next.updatedRevision))) next.updatedRevision = revision;
            const age = Math.max(0, revision - Number(next.updatedRevision || revision));
            if (next.activity === 'HOT' && age > 4) next.activity = 'WARM';
            if (next.activity === 'WARM' && age > 12) next.activity = 'COLD';
            return next;
        }).filter((item) => module === 'timeline' || item.priority !== 'L1' || item.activity !== 'COLD');
    }
    function itemKey(item, index) {
        if (item && typeof item === 'object') return String(item.id || item.key || item.title || item.name || item.information || `${index}`);
        return String(item ?? '');
    }
    function uniqueRecent(values, limit, keyOf = itemKey) {
        const seen = new Set();
        return (Array.isArray(values) ? values : []).map((item, index) => ({ item, index })).reverse().filter(({ item, index }) => {
            const key = keyOf(item, index);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(0, limit).reverse().map(({ item }) => item);
    }
    function semanticText(value) {
        const raw = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
        return raw.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '').slice(0, 400);
    }
    const readableLabels = Object.freeze({
        time: '时间', date: '日期', location: '地点', place: '地点', participants: '相关人物', activity: '发生的事', action: '行动',
        movement: '移动', name: '名称', status: '状态', effect: '影响', recovery: '恢复情况', significance: '重要性', summary: '摘要',
        description: '说明', result: '结果', cause: '起因', currentRole: '当前作用',
    });
    function parseJsonish(value) {
        const input = String(value || '').trim();
        if (!input || !/^[\[{]/.test(input) || !/[\]}]$/.test(input)) return null;
        try { return JSON.parse(input); } catch (_error) { /* try adjacent records */ }
        if (input.startsWith('{') && input.endsWith('}')) {
            try { return JSON.parse(`[${input.replace(/}\s*{/g, '},{')}]`); } catch (_error) { return null; }
        }
        return null;
    }
    function readableText(value) {
        if (Array.isArray(value)) return value.map(readableText).filter(Boolean).join('、');
        if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => {
            const rendered = readableText(item);
            return rendered ? `${readableLabels[key] || key}：${rendered}` : '';
        }).filter(Boolean).join('；');
        const input = String(value ?? '').trim();
        const parsed = parseJsonish(input);
        return parsed == null ? input : readableText(parsed);
    }
    const TECHNICAL_CARD_NAMES = new Set(['truthstatus','basis','sourcerefs','priority','activity','admission','lifecycle','owner','delivery','consumers','updatedrevision']);
    function isTechnicalOrganizationCard(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const name = String(item.name || '').replace(/[\s_-]+/g, '').toLowerCase();
        if (!TECHNICAL_CARD_NAMES.has(name)) return false;
        const id = String(item.id || '').replace(/[\s_-]+/g, '').toLowerCase();
        const situation = String(item.situation || '').replace(/[\s_-]+/g, '').toLowerCase();
        return !id || id === name || situation.startsWith(`${name}:`) || situation.startsWith(`${name}：`);
    }
    function semanticRecent(values, limit, keyOf = itemKey) {
        const kept = [];
        (Array.isArray(values) ? values : []).slice().reverse().forEach((item, reverseIndex) => {
            const key = semanticText(keyOf(item, values.length - reverseIndex - 1));
            if (!key) return;
            const duplicate = kept.some(({ key: existing }) => key === existing
                || (Math.min(key.length, existing.length) >= 12 && (key.includes(existing) || existing.includes(key))));
            if (!duplicate) kept.push({ item, key });
        });
        return kept.slice(0, limit).reverse().map(({ item }) => item);
    }
    function hasText(value) { return String(value ?? '').trim().length > 0; }
    function isNegativePlaceholder(value) {
        return /^(?:无|暂无|没有|无待办(?:事项)?|暂无待办(?:事项)?|未明确|不适用|none|n\/?a)[。！!？?、；;\s]*$/i.test(String(value ?? '').trim());
    }
    function validMemoryItem(module, item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        if (module === 'worldRules') return hasText(item.statement);
        if (module === 'factAnchors') return hasText(item.fact);
        if (module === 'resourceConstraints') return hasText(item.condition) && !['expired','satisfied'].includes(String(item.status || '').toLowerCase());
        if (module === 'organizations') return hasText(item.name);
        if (module === 'characters') return hasText(item.name) || hasText(item.id);
        if (module === 'npcActivities') return hasText(item.characterId) && hasText(item.action);
        if (module === 'relationships') return hasText(item.from) && hasText(item.to) && item.from !== item.to && hasText(item.identityRelation || item.currentPerception || item.status || item.type);
        if (module === 'knowledge') return hasText(item.information);
        if (module === 'schedules') return hasText(item.title) && !['cancelled','completed'].includes(String(item.status || '').toLowerCase());
        if (module === 'tasks') return hasText(item.title) && !isNegativePlaceholder(item.title);
        if (module === 'triggers') return hasText(item.title) && (hasText(item.userRelevance) || (item.conditions || []).some(hasText));
        if (module === 'threads') return hasText(item.title) && hasText(item.stakes || item.nextNaturalStep || item.status);
        if (module === 'processes') return hasText(item.title) && hasText(item.currentDirection || item.status);
        if (module === 'causalEffects') return hasText(item.result) && hasText(item.cause || item.causeRef);
        if (module === 'timeline') return hasText(item.summary);
        return true;
    }
    function memoryKey(module, item, index) {
        if (module === 'worldRules') return item?.factId || item?.id || item?.statement;
        if (module === 'factAnchors') return item?.fact;
        if (module === 'resourceConstraints') return item?.id || `${item?.subjectId || ''}>${item?.kind || ''}>${item?.scope || ''}`;
        if (module === 'organizations') return item?.name || item?.id;
        if (module === 'characters') return item?.name || item?.id;
        if (module === 'npcActivities') return item?.characterId;
        if (module === 'relationships') return `${item?.from || ''}>${item?.to || ''}`;
        if (module === 'knowledge') return item?.information;
        if (module === 'schedules') return item?.id || item?.title;
        if (module === 'tasks' || module === 'triggers' || module === 'threads' || module === 'processes') return item?.title;
        if (module === 'causalEffects') return item?.causeRef || `${item?.cause || ''}>${item?.result || ''}`;
        if (module === 'timeline') return item?.summary;
        return itemKey(item, index);
    }
    function trimArray(value, limit, fromEnd = true) {
        const items = Array.isArray(value) ? value.filter((item) => item !== '' && item != null) : [];
        const unique = uniqueRecent(items, Math.max(limit, items.length), (item) => typeof item === 'string' ? item.trim() : itemKey(item));
        return fromEnd ? unique.slice(-limit) : unique.slice(0, limit);
    }
    function trimFields(item, fields = {}) {
        const next = Object.assign({}, item || {});
        Object.entries(fields).forEach(([key, limit]) => { next[key] = trimArray(next[key], limit); });
        return next;
    }
    function activeFirst(values, limit, important = () => false, keyOf = itemKey) {
        const unique = uniqueRecent(values, Math.max(limit, (values || []).length), keyOf);
        if (unique.length <= limit) return unique;
        const core = unique.filter((item) => String(item?.priority || '').toUpperCase() === 'L3');
        const others = unique.filter((item) => !core.includes(item));
        const activityScore = (item) => ({ HOT: 3, WARM: 2, COLD: 1 }[String(item?.activity || '').toUpperCase()] || 0);
        const ranked = others.map((item, index) => ({ item, index }))
            .sort((a, b) => Number(important(b.item)) - Number(important(a.item)) || activityScore(b.item) - activityScore(a.item) || b.index - a.index)
            .map(({ item }) => item);
        const capacity = core.length >= limit ? core.length + Math.min(8, ranked.length) : limit;
        const selected = new Set([...core, ...ranked].slice(0, capacity));
        return unique.filter((item) => selected.has(item));
    }
    function removeExpiredL1(values, revision, keep = () => false) {
        return (Array.isArray(values) ? values : []).filter((item) => {
            if (String(item?.priority || '').toUpperCase() !== 'L1' || keep(item)) return true;
            const touched = Number(item?.updatedRevision);
            return !Number.isFinite(touched) || Math.max(0, revision - touched) <= 16;
        });
    }
    function compactTimeline(values, limit) {
        const unique = uniqueRecent(values, Math.max(limit, (values || []).length), (item) => String(item?.summary || item?.id || ''));
        if (unique.length <= limit) return unique;
        const core = unique.filter((item) => String(item?.priority || '').toUpperCase() === 'L3');
        const recent = unique.slice(-16);
        const protectedSet = new Set([...core, ...recent]);
        const older = unique.filter((item) => !protectedSet.has(item));
        const compressed = [];
        for (let index = 0; index < older.length; index += 4) {
            const group = older.slice(index, index + 4);
            if (!group.length) continue;
            const first = group[0];
            const last = group.at(-1);
            const summary = group.map((item) => String(item?.summary || '').trim()).filter(Boolean).join('；').slice(0, 220);
            const firstTime = String(first?.time || first?.at || first?.date || '').trim();
            const lastTime = String(last?.time || last?.at || last?.date || '').trim();
            compressed.push({
                id: `timeline-summary-${String(first?.id || index)}-${String(last?.id || index)}`,
                summary: summary || '较早阶段的重要发展已合并',
                time: firstTime && lastTime && firstTime !== lastTime ? `${firstTime}—${lastTime}` : (lastTime || firstTime),
                priority: group.some((item) => String(item?.priority || '').toUpperCase() === 'L2') ? 'L2' : 'L1',
                granularity: 'phase',
                participants: trimArray(group.flatMap((item) => item?.participants || []), 10),
                location: group.map((item) => item?.location).filter(Boolean).at(-1) || '',
                relatedFactIds: trimArray(group.flatMap((item) => item?.relatedFactIds || []), 12),
                evidence: trimArray(group.flatMap((item) => item?.evidence || []), 8),
            });
        }
        const combined = [...core, ...compressed, ...recent];
        return uniqueRecent(combined, Math.max(limit, core.length + recent.length), (item) => String(item?.id || item?.summary || ''));
    }
    function ensureInitializedModuleCoverage(state) {
        // Empty collections are valid.  Never turn a coverage result into a
        // fabricated state record.  Besides confusing the UI, placeholder cards
        // prevented later evidence hydration because they looked like existing
        // entities.  This also migrates states written by older versions.
        MEMORY_MODULES.forEach((module) => {
            state[module] = (Array.isArray(state[module]) ? state[module] : [])
                .filter((item) => item?.placeholder !== true && !String(item?.id || '').startsWith('initial-empty-'));
        });
        state.map ||= { rootLabel: '大地图', currentLocationId: '', baseLocations: [], locations: [], routes: [], routeOverlays: [] };
        const dynamicLocations = (Array.isArray(state.map.locations) ? state.map.locations : []).filter((item) => item?.placeholder !== true);
        const baseLocations = Array.isArray(state.map.baseLocations) ? state.map.baseLocations : [];
        state.map.locations = dynamicLocations;
        if (![...dynamicLocations, ...baseLocations].some((item) => item?.id === state.map.currentLocationId)) state.map.currentLocationId = '';
        if (state.progression?.placeholder === true || String(state.progression?.id || '').startsWith('initial-empty-')) state.progression = {};
        return state;
    }
    function compactState(state) {
        const revision = Number(state.revision || 0);
        MEMORY_MODULES.forEach((module) => {
            const values = (Array.isArray(state[module]) ? state[module] : []).filter((item) => validMemoryItem(module, item));
            state[module] = semanticRecent(values, Math.max(RETENTION_LIMITS[module] || values.length, values.length), (item, index) => memoryKey(module, item, index));
        });
        MEMORY_MODULES.forEach((module) => { state[module] = prepareLifecycle(state[module], module, revision); });
        state.world.currentConditions = trimArray(state.world.currentConditions, RETENTION_LIMITS.currentConditions);
        const activeConditionSet = new Set(state.world.currentConditions);
        state.world.currentConditionDetails = (Array.isArray(state.world.currentConditionDetails) ? state.world.currentConditionDetails : [])
            .filter((item) => activeConditionSet.has(String(item?.value || ''))).slice(-RETENTION_LIMITS.currentConditions);
        state.factAnchors = activeFirst(state.factAnchors, RETENTION_LIMITS.factAnchors, () => false, (item) => semanticText(item?.fact))
            .map((item) => trimFields(item, { sourceRefs: 4 }));
        state.worldRules = activeFirst(state.worldRules, Math.max(RETENTION_LIMITS.worldRules, state.worldRules.length), (item) => item?.delivery === 'resident', (item) => String(item?.factId || item?.id || item?.statement || ''))
            .map((item) => trimFields(item, { consumers: 12, scope: 12, conditions: 8, exceptions: 8, dependencyFactIds: 12, sourceRefs: 8 }));
        state.resourceConstraints = activeFirst(removeExpiredL1(state.resourceConstraints.filter((item) => !['expired','satisfied'].includes(String(item?.status || '').toLowerCase())), revision, (item) => item?.status === 'active'), RETENTION_LIMITS.resourceConstraints, (item) => item?.status === 'active', (item) => String(item?.id || `${item?.subjectId || ''}>${item?.kind || ''}>${item?.scope || ''}`))
            .map((item) => trimFields(item, { sourceRefs: 4 }));
        state.progression ||= { priority: 'L2', activity: 'WARM', direction: '', currentMovement: '', nextRequiredChanges: [], basedOnRefs: [], blockedByDecision: '', updatedRevision: 0 };
        const progressionTouched = Number.isFinite(Number(state.progression.updatedRevision)) ? Number(state.progression.updatedRevision) : revision;
        const progressionAge = Math.max(0, revision - progressionTouched);
        if (state.progression.activity === 'HOT' && progressionAge > 4) state.progression.activity = 'WARM';
        if (state.progression.activity === 'WARM' && progressionAge > 12) state.progression.activity = 'COLD';
        state.progression.nextRequiredChanges = trimArray(state.progression.nextRequiredChanges, 6, false);
        state.progression.basedOnRefs = trimArray(state.progression.basedOnRefs, 10, false);

        const locationsById = new Map(state.map.locations.map((item) => [item.id, item]));
        const requiredLocationIds = new Set();
        let locationId = state.map.currentLocationId;
        while (locationId && !requiredLocationIds.has(locationId) && requiredLocationIds.size < RETENTION_LIMITS.locations) {
            requiredLocationIds.add(locationId);
            locationId = locationsById.get(locationId)?.parentId || '';
        }
        const keptLocationIds = new Set(requiredLocationIds);
        state.map.locations.filter((item) => item.priority === 'L3').forEach((candidate) => {
            const visited = new Set();
            for (let item = candidate; item && !visited.has(item.id); item = item.parentId ? locationsById.get(item.parentId) : null) {
                visited.add(item.id); keptLocationIds.add(item.id);
            }
        });
        const eligibleLocations = state.map.locations.filter((item) => {
            if (requiredLocationIds.has(item.id) || item.priority === 'L3') return true;
            const touched = Number(item.updatedRevision);
            const age = Number.isFinite(touched) ? Math.max(0, revision - touched) : 0;
            if (item.priority === 'L1' && (item.activity === 'COLD' || age > 16)) return false;
            if (item.priority === 'L2' && item.activity === 'COLD' && age > 40) return false;
            return true;
        });
        eligibleLocations.slice().reverse().forEach((candidate) => {
            if (keptLocationIds.has(candidate.id)) return;
            const chain = [];
            const visited = new Set();
            let item = candidate;
            while (item && !keptLocationIds.has(item.id) && !visited.has(item.id)) {
                visited.add(item.id);
                chain.push(item.id);
                item = item.parentId ? locationsById.get(item.parentId) : null;
            }
            if (keptLocationIds.size + chain.length <= RETENTION_LIMITS.locations) chain.forEach((id) => keptLocationIds.add(id));
        });
        const locationPool = state.map.locations.filter((item) => keptLocationIds.has(item.id));
        state.map.locations = locationPool.map((item) => trimFields(item, { currentCharacterIds: 12, sourceRefs: 4 }));
        state.map.routes = uniqueRecent(state.map.routes.filter((item) => keptLocationIds.has(item.from) && keptLocationIds.has(item.to)), RETENTION_LIMITS.routes, (item) => `${item.from}>${item.to}`);
        state.map.baseLocations = Array.isArray(state.map.baseLocations) ? state.map.baseLocations : [];
        state.map.routeOverlays = Array.isArray(state.map.routeOverlays) ? state.map.routeOverlays : [];

        const uniqueCharacters = uniqueRecent(state.characters, Math.max(RETENTION_LIMITS.characters, state.characters.length));
        const coreCharacters = uniqueCharacters.filter((item) => item?.maintenanceLevel === 'core' || ['user','char','<user>','<char>'].includes(String(item?.id || '').toLowerCase()));
        const activeCharacters = uniqueCharacters.filter((item) => !coreCharacters.includes(item));
        const keptCharacters = new Set([...coreCharacters, ...activeCharacters.filter((item) => item?.present === true), ...activeCharacters].slice(0, Math.max(RETENTION_LIMITS.characters, coreCharacters.length)));
        state.characters = uniqueCharacters.filter((item) => keptCharacters.has(item))
            .map((item) => trimFields(item, { aliases: 8, affiliationRefs: 8, authorityRefs: 8, knowledgeRefs: 12, motives: 6, currentGoals: 6, persistentConditions: 4, importantItems: 4, sourceRefs: 4 }));
        state.npcActivities = uniqueRecent(state.npcActivities, RETENTION_LIMITS.npcActivities, (item) => String(item?.characterId || item?.id || ''));
        state.organizations = activeFirst(removeExpiredL1(state.organizations, revision), RETENTION_LIMITS.organizations, (item) => String(item?.priority || '').toUpperCase() === 'L3', (item) => String(item?.name || item?.id || ''))
            .map((item) => trimFields(item, { leaderIds: 8, goals: 8, resources: 8, relationshipRefs: 8, basis: 4, sourceRefs: 6 }));
        state.relationships = activeFirst(removeExpiredL1(state.relationships, revision), RETENTION_LIMITS.relationships, (item) => item?.coverageOnly !== true, (item) => `${String(item?.from || '')}>${String(item?.to || '')}`)
            .map((item) => trimFields(item, { bondTypes: 6, attachments: 6, grievances: 6, boundaries: 8, reconciliationConditions: 8, evidence: 6, basis: 4, sourceRefs: 6 }));
        const uniqueKnowledge = uniqueRecent(state.knowledge, Math.max(RETENTION_LIMITS.knowledge, state.knowledge.length), (item) => String(item?.information || item?.id || ''));
        const coreKnowledge = uniqueKnowledge.filter((item) => String(item?.priority || '').toUpperCase() === 'L3');
        const otherKnowledge = uniqueKnowledge.filter((item) => !coreKnowledge.includes(item));
        const rankedKnowledge = otherKnowledge.slice().reverse().sort((a, b) => {
            const priority = (item) => ({ L3: 3, L2: 2, L1: 1 }[String(item?.priority || '').toUpperCase()] || 0);
            const activity = (item) => ({ HOT: 3, WARM: 2, COLD: 1 }[String(item?.activity || '').toUpperCase()] || 0);
            return priority(b) - priority(a) || activity(b) - activity(a);
        });
        const knowledgeCapacity = coreKnowledge.length >= RETENTION_LIMITS.knowledge
            ? coreKnowledge.length + Math.min(8, rankedKnowledge.length) : RETENTION_LIMITS.knowledge;
        const keptKnowledge = new Set([...coreKnowledge, ...rankedKnowledge].slice(0, knowledgeCapacity));
        state.knowledge = uniqueKnowledge.filter((item) => keptKnowledge.has(item)).map((item) => trimFields(item, {
            holderIds: 8, knownBy: 8, believedBy: 8, suspectedBy: 8, misunderstoodBy: 8, unknownTo: 8,
            relatedRefs: 6, evidence: 5, discoveryPaths: 4, maturityConditions: 4,
        }));
        state.schedules = activeFirst(removeExpiredL1(state.schedules, revision), RETENTION_LIMITS.schedules, (item) => ['agreed','scheduled','changed'].includes(String(item?.status || '').toLowerCase()), (item) => String(item?.id || item?.title || ''))
            .map((item) => trimFields(item, { participantIds: 8, preconditions: 8, basis: 4, sourceRefs: 6 }));
        state.tasks = activeFirst(removeExpiredL1(state.tasks.filter((item) => !['done','failed'].includes(item?.status)), revision, (item) => item?.status === 'active'), RETENTION_LIMITS.tasks, (item) => ['active','blocked'].includes(item?.status), (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { ownerIds: 6, dependencies: 8, locationRefs: 8, characterRefs: 8, ruleRefs: 8, knowledgeRefs: 8, resourceConstraintRefs: 8, completionConditions: 8, completedConditions: 8, consequences: 4, sourceRefs: 4 }));
        state.triggers = activeFirst(state.triggers.filter((item) => !['triggered','expired'].includes(item?.status)), RETENTION_LIMITS.triggers, (item) => item?.status === 'eligible', (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { conditions: 4, effectsIfTriggered: 4, blockedReasons: 3, sourceRefs: 4 }));
        state.threads = activeFirst(state.threads.filter((item) => item?.status !== 'resolved'), RETENTION_LIMITS.threads, (item) => item?.status === 'open', (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { participantIds: 8, history: 4 }));
        state.processes = activeFirst(state.processes.filter((item) => !['resolved','transformed'].includes(item?.status)), RETENTION_LIMITS.processes, (item) => ['active','decaying'].includes(item?.status), (item) => String(item?.title || item?.id || ''))
            .map((item) => trimFields(item, { drivers: 4, decayConditions: 3, resolutionConditions: 3 }));
        state.causalEffects = activeFirst(removeExpiredL1(state.causalEffects.filter((item) => !['resolved','discarded'].includes(item?.status)), revision, (item) => item?.status === 'active'), RETENTION_LIMITS.causalEffects, (item) => item?.status === 'active', (item) => String(item?.id || `${item?.causeRef || ''}|${item?.result || ''}`))
            .map((item) => trimFields(item, { steps: 4, affectedIds: 8, decayConditions: 3, evidenceRefs: 4 }));
        state.timeline = compactTimeline(state.timeline, RETENTION_LIMITS.timeline).map((item) => trimFields(item, { participants: 8, relatedFactIds: 12, evidence: 4, actualChanges: 4 }));
        return ensureInitializedModuleCoverage(state);
    }
    function context() { return window.SillyTavern?.getContext?.() || null; }
    function metadata() {
        const ctx = context();
        if (!ctx) return null;
        if (ctx.chatMetadata && typeof ctx.chatMetadata === 'object' && ctx.chatMetadata[META_KEY]) return ctx.chatMetadata;
        if (window.chat_metadata && typeof window.chat_metadata === 'object' && window.chat_metadata[META_KEY]) return window.chat_metadata;
        if (ctx.chatMetadata && typeof ctx.chatMetadata === 'object') return ctx.chatMetadata;
        if (window.chat_metadata && typeof window.chat_metadata === 'object') return window.chat_metadata;
        try { ctx.chatMetadata = {}; return ctx.chatMetadata; }
        catch (_) { return null; }
    }
    function currentChatKey() {
        const ctx = context();
        const raw = ctx?.chatId ?? ctx?.getCurrentChatId?.();
        if (raw !== undefined && raw !== null && String(raw).trim()) return String(raw).trim();
        if (ctx?.groupId !== undefined && ctx?.groupId !== null && String(ctx.groupId).trim()) return `group:${String(ctx.groupId).trim()}`;
        // On very large chats SillyTavern can expose chatMetadata before it
        // finishes exposing chatId. Metadata is already scoped to this chat,
        // so its sole persisted store is a safer key than an empty temporary
        // `character:*:unsaved` store.
        const persistedKeys = [...new Set([ctx?.chatMetadata, window.chat_metadata].flatMap((meta) => {
            const stores = meta?.[META_KEY]?.chatStores;
            return stores && typeof stores === 'object' && !Array.isArray(stores)
                ? Object.keys(stores).filter((key) => stores[key]?.state)
                : [];
        }))];
        if (persistedKeys.length === 1) return persistedKeys[0];
        if (ctx?.characterId !== undefined && ctx?.characterId !== null) return `character:${ctx.characterId}:unsaved`;
        return 'chat:unsaved';
    }
    function mapTypeFromName(name, fallback = 'other') {
        const value = String(name || '');
        if (/(世界|大陆|星球)$/.test(value)) return 'world';
        if (/(国|共和国|王国)$/.test(value)) return 'country';
        if (/(街市|市集|集市)$/.test(value)) return 'district';
        if (/(市|城|都市|州)$/.test(value)) return 'city';
        if (/(区|县|镇|乡|街区)$/.test(value)) return 'district';
        if (/(家|住宅|公寓|宅|别墅)$/.test(value)) return 'residence';
        if (/(公司|集团|事务所|工作室|学校|医院)$/.test(value)) return 'workplace';
        if (/(地标|广场|公园|园区|景区|码头|桥)$/.test(value)) return 'landmark';
        if (/(大楼|楼|馆|宫|殿|院|阁|塔|庙|寺|商场|车站|机场|酒店|旅馆|餐厅|咖啡馆|酒吧|店|营帐|帐)$/.test(value)) return 'building';
        if (/(房|室|厅|堂|厨房|玄关|走廊|内殿|内室|榻|门口)$/.test(value)) return 'room';
        return fallback;
    }
    const MAP_PARENT_GROUPS = Object.freeze({
        city: [['country']],
        region: [['country']],
        district: [['city'], ['country']],
        landmark: [['city'], ['country']],
        residence: [['district','landmark'], ['city'], ['country']],
        workplace: [['district','landmark'], ['city'], ['country']],
        building: [['district','landmark'], ['city'], ['country']],
        room: [['residence','workplace','building','room'], ['district','landmark'], ['city'], ['country']],
        other: [['country']],
    });
    const MAP_HIERARCHY_RANK = Object.freeze({ country: 0, city: 1, district: 2, landmark: 2, residence: 3, workplace: 3, building: 3, room: 4 });
    function normalizeMapHierarchy(locations, currentLocationId = '', currentPlace = '') {
        const list = Array.isArray(locations) ? locations : [];
        const byId = new Map(list.map((item) => [String(item?.id || ''), item]));
        const createsCycle = (child, parent) => {
            const walked = new Set([child.id]);
            for (let cursor = parent; cursor; cursor = byId.get(cursor.parentId)) {
                if (walked.has(cursor.id)) return true;
                walked.add(cursor.id);
            }
            return false;
        };
        const currentPath = [];
        const currentWalked = new Set();
        for (let cursor = byId.get(String(currentLocationId || '')); cursor && !currentWalked.has(cursor.id); cursor = byId.get(cursor.parentId)) {
            currentPath.push(cursor);
            currentWalked.add(cursor.id);
        }
        const ordered = [...list].sort((a, b) => (MAP_HIERARCHY_RANK[a.type] ?? 99) - (MAP_HIERARCHY_RANK[b.type] ?? 99));
        ordered.forEach((location) => {
            if (!location.type || location.type === 'other' || /(?:街市|市集|集市)$/.test(String(location.name || ''))) location.type = mapTypeFromName(location.name, location.type || 'other');
            const groups = MAP_PARENT_GROUPS[location.type];
            if (location.type === 'country') {
                // The country is the visible first layer. Legacy world wrappers
                // remain as independent reference nodes instead of swallowing it.
                location.parentId = '';
                return;
            }
            if (!groups) return;
            const existing = byId.get(location.parentId);
            if (location.type === 'other' && existing && !createsCycle(location, existing)) return;
            const validTypes = new Set(groups.flat());
            if (existing && validTypes.has(existing.type) && !createsCycle(location, existing)) return;
            location.parentId = '';
            for (const types of groups) {
                const compatible = list.filter((candidate) => candidate.id !== location.id && types.includes(candidate.type) && !createsCycle(location, candidate));
                if (!compatible.length) continue;
                const currentCompatible = currentPath.filter((candidate) => compatible.includes(candidate));
                const locationAppearsInCurrentPath = String(currentPlace || '').includes(String(location.name || ''));
                const chosen = locationAppearsInCurrentPath && currentCompatible.length
                    ? currentCompatible[0]
                    : (compatible.length === 1 ? compatible[0] : null);
                if (chosen) location.parentId = chosen.id;
                if (chosen) break;
            }
        });
        return list;
    }
    function stableMapId(prefix, value) {
        let hash = 2166136261;
        for (const char of String(value || '')) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
        return `${prefix}-${(hash >>> 0).toString(36)}`;
    }
    const mapPriorityScore = (value) => ({ L3: 3, L2: 2, L1: 1 }[String(value || '').toUpperCase()] || 0);
    const mapActivityScore = (value) => ({ HOT: 3, WARM: 2, COLD: 1 }[String(value || '').toUpperCase()] || 0);
    function defaultMapPriority(type) {
        if (['world','country','region','city'].includes(type)) return 'L3';
        if (['district','residence','workplace','building'].includes(type)) return 'L2';
        return 'L1';
    }
    function cleanSpatialDescription(value) {
        const parts = String(value || '').replace(/[\r\n]+/g, ' ').split(/[。；;]/).map((item) => item.trim()).filter(Boolean);
        const plotMeaning = /(主要场景|剧情|冲突|交锋|博弈|关键场所|发生地|最后交割|谈判地点|推动.*(?:剧情|故事)|见证了|曾在此)/;
        return parts.map((item) => item.split(/[，,]/).map((part) => part.trim()).filter((part) => part && !plotMeaning.test(part)).join('，')).filter(Boolean).join('；').slice(0, 100);
    }
    function cleanLocationOrigin(value) {
        return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().split(/[。；;]/)[0].slice(0, 80);
    }
    function locationIdentityKey(item) {
        return `${semanticText(item?.parentId).slice(0, 80)}|${semanticText(item?.name).slice(0, 120)}`;
    }
    function mergeMapLocations(locations) {
        const aliases = new Map();
        const merged = [];
        const byKey = new Map();
        (Array.isArray(locations) ? locations : []).forEach((item) => {
            item.parentId = aliases.get(item.parentId) || item.parentId;
            const key = locationIdentityKey(item);
            const existing = byKey.get(key);
            if (!existing) { byKey.set(key, item); merged.push(item); return; }
            aliases.set(item.id, existing.id);
            if (mapPriorityScore(item.priority) > mapPriorityScore(existing.priority)) existing.priority = item.priority;
            if (mapActivityScore(item.activity) > mapActivityScore(existing.activity)) existing.activity = item.activity;
            if (item.status === 'visited' || (existing.status !== 'visited' && item.status === 'unavailable')) existing.status = item.status;
            if (!existing.description && item.description) existing.description = item.description;
            if (!existing.origin && item.origin) existing.origin = item.origin;
            existing.updatedRevision = Math.max(Number(existing.updatedRevision || 0), Number(item.updatedRevision || 0));
            existing.sourceRefs = trimArray([...(existing.sourceRefs || []), ...(item.sourceRefs || [])], 4);
        });
        merged.forEach((item) => { item.parentId = aliases.get(item.parentId) || item.parentId; });
        return { locations: merged, aliases };
    }
    function envelope() {
        const meta = metadata();
        if (!meta) return { state: WSM.Defaults.createState(), history: [] };
        const chatKey = currentChatKey();
        const existing = meta[META_KEY];
        if (!existing?.chatStores || typeof existing.chatStores !== 'object' || Array.isArray(existing.chatStores)) {
            const legacy = existing?.state ? existing : null;
            meta[META_KEY] = { version: 2, chatStores: {} };
            if (legacy) meta[META_KEY].chatStores[chatKey] = legacy;
        }
        const stores = meta[META_KEY].chatStores;
        if (!stores[chatKey]?.state) stores[chatKey] = { chatKey, state: WSM.Defaults.createState(), history: [] };
        const box = stores[chatKey];
        box.chatKey = chatKey;
        box.history = Array.isArray(box.history) ? box.history : [];
        box.history = box.history.filter(isGenerationSnapshot).slice(0, HISTORY_LIMIT);
        return box;
    }
    function normalizeState(value) {
        const incomingVersion = Number(value?.schemaVersion || 0);
        const state = Object.assign(WSM.Defaults.createState(), clone(value || {}));
        state.identities = Object.assign({ user: '', char: '' }, state.identities || {});
        state.moduleCoverage = state.moduleCoverage && typeof state.moduleCoverage === 'object' && !Array.isArray(state.moduleCoverage) ? state.moduleCoverage : {};
        state.world = Object.assign(WSM.Defaults.createState().world, state.world || {});
        state.world.time = Object.assign({ display: '', iso: '', timezone: '', elapsedMinutes: 0, truthStatus: 'unknown', basis: [], sourceRefs: [] }, state.world.time || {});
        state.world.time = Object.assign(state.world.time, truthMeta(state.world.time, 'unknown'));
        state.world.location = Object.assign({
            current: '', currentMeta: { truthStatus: 'unknown', basis: [], sourceRefs: [] },
            environment: '', environmentMeta: { truthStatus: 'unknown', basis: [], sourceRefs: [] },
            weather: '', weatherMeta: { truthStatus: 'unknown', basis: [], sourceRefs: [] },
        }, state.world.location || {});
        state.world.season = String(state.world.season || '').trim();
        state.world.seasonMeta = truthMeta(state.world.seasonMeta, 'unknown');
        state.world.location.currentMeta = truthMeta(state.world.location.currentMeta, 'unknown');
        state.world.location.environmentMeta = truthMeta(state.world.location.environmentMeta, 'unknown');
        state.world.location.weatherMeta = truthMeta(state.world.location.weatherMeta, 'unknown');
        const rawCurrentConditions = Array.isArray(state.world.currentConditions) ? state.world.currentConditions : [];
        const savedConditionDetails = Array.isArray(state.world.currentConditionDetails) ? state.world.currentConditionDetails : [];
        state.world.currentConditions = rawCurrentConditions.map((item) => readableText(item?.value ?? item)).filter(Boolean);
        state.world.currentConditionDetails = state.world.currentConditions.map((condition, index) => {
            const embedded = rawCurrentConditions[index] && typeof rawCurrentConditions[index] === 'object' && !Array.isArray(rawCurrentConditions[index]) ? rawCurrentConditions[index] : {};
            const saved = savedConditionDetails.find((item) => String(item?.value || '') === condition) || {};
            return normalizeTruthItem('currentConditions', { ...saved, ...embedded, value: condition });
        });
        if (incomingVersion < 17 && Array.isArray(state.world.facts)) {
            state.factAnchors = [
                ...(Array.isArray(state.factAnchors) ? state.factAnchors : []),
                ...state.world.facts.filter(Boolean).map((fact, index) => ({
                    id: `legacy-fact-anchor-${index + 1}`,
                    fact: String(fact), priority: 'L3', activity: 'COLD', scope: '由旧版“已有安排与事实”迁移，等待后续整理归属', sourceRefs: [],
                })),
            ];
        }
        delete state.world.facts;
        state.map = Object.assign({ rootLabel: '大地图', currentLocationId: '', baseLocations: [], locations: [], routes: [], routeOverlays: [] }, state.map || {});
        // Compiler projections are resolved live from the immutable per-entry
        // cache by the map UI/injector. Do not copy them into chat state: doing
        // so would leave stale locations behind after a source entry changes.
        const baseLocationValues = (Array.isArray(state.map.baseLocations) ? state.map.baseLocations : [])
            .filter((item) => !String(item?.id || '').startsWith('location_wb_'));
        const baseLocationMap = new Map();
        baseLocationValues.forEach((item, index) => {
            const location = Object.assign({}, item || {});
            location.id = String(location.id || `worldbook-location-${index + 1}`);
            location.name = String(location.name || location.id);
            location.aliases = stringList(location.aliases);
            location.parentId = String(location.parentId || '');
            location.type = String(location.type || mapTypeFromName(location.name));
            location.description = cleanSpatialDescription(location.description);
            location.sourceRefs = stringList(location.sourceRefs);
            location.accessRuleRefs = stringList(location.accessRuleRefs);
            location.routeRefs = stringList(location.routeRefs);
            location.secretRefs = stringList(location.secretRefs);
            location.characterRefs = stringList(location.characterRefs);
            location.organizationRefs = stringList(location.organizationRefs);
            location.taskRefs = stringList(location.taskRefs);
            const key = `${location.parentId}|${location.name.toLocaleLowerCase()}`;
            const previous = baseLocationMap.get(key);
            baseLocationMap.set(key, previous ? {
                ...previous, ...location,
                aliases: stringList([...previous.aliases, ...location.aliases]),
                sourceRefs: stringList([...previous.sourceRefs, ...location.sourceRefs]),
                accessRuleRefs: stringList([...previous.accessRuleRefs, ...location.accessRuleRefs]),
                routeRefs: stringList([...previous.routeRefs, ...location.routeRefs]),
                secretRefs: stringList([...previous.secretRefs, ...location.secretRefs]),
                characterRefs: stringList([...previous.characterRefs, ...location.characterRefs]),
                organizationRefs: stringList([...previous.organizationRefs, ...location.organizationRefs]),
                taskRefs: stringList([...previous.taskRefs, ...location.taskRefs]),
            } : location);
        });
        state.map.baseLocations = [...baseLocationMap.values()];
        const rawLocations = Array.isArray(state.map.locations) ? state.map.locations : [];
        state.map.locations = rawLocations.map((item, index) => {
            const location = Object.assign({}, item || {});
            location.id = String(location.id || `location-${index + 1}`);
            location.name = String(location.name || location.id || '未命名地点');
            location.type = String(location.type || mapTypeFromName(location.name));
            location.parentId = String(location.parentId || '');
            location.area = String(location.area || '');
            location.status = String(location.status || 'known');
            location.description = cleanSpatialDescription(location.description);
            location.origin = cleanLocationOrigin(location.origin || location.establishedBy || '');
            const priority = String(location.priority || '').toUpperCase();
            const activity = String(location.activity || '').toUpperCase();
            location.priority = ['L1','L2','L3'].includes(priority) ? priority : defaultMapPriority(location.type);
            location.activity = ['HOT','WARM','COLD'].includes(activity) ? activity : (location.status === 'visited' ? 'HOT' : 'WARM');
            location.updatedRevision = Number.isFinite(Number(location.updatedRevision)) ? Number(location.updatedRevision) : Number(state.revision || 0);
            const locationAge = Math.max(0, Number(state.revision || 0) - location.updatedRevision);
            if (location.activity === 'HOT' && locationAge > 4) location.activity = 'WARM';
            if (location.activity === 'WARM' && locationAge > 12) location.activity = 'COLD';
            location.sourceRefs = stringList(location.sourceRefs);
            location.basis = stringList(location.basis);
            const rawTruth = String(location.truthStatus || '').toLowerCase();
            location.truthStatus = TRUTH_STATUS_SET.has(rawTruth) ? rawTruth : (location.sourceRefs.length ? 'confirmed' : 'unknown');
            if (!['confirmed','derived','unknown','failed','not_applicable'].includes(location.truthStatus)) location.truthStatus = 'unknown';
            if (location.truthStatus === 'derived' && !location.basis.length) {
                location.truthStatus = 'unknown';
                location.basis = ['命名地点缺少可复算的推导依据'];
            }
            if (CONJECTURAL_TRUTH.has(location.truthStatus) && location.priority === 'L3') location.priority = 'L2';
            location.x = Number.isFinite(Number(location.x)) ? Math.max(0, Math.min(100, Number(location.x))) : null;
            location.y = Number.isFinite(Number(location.y)) ? Math.max(0, Math.min(100, Number(location.y))) : null;
            return location;
        });
        const locationsByName = new Map(state.map.locations.map((item) => [item.name, item]));
        const usedIds = new Set(state.map.locations.map((item) => item.id));
        const ensureNamedLocation = (name, parentId = '', options = {}) => {
            const cleanName = String(name || '').trim();
            if (!cleanName || cleanName === '未设定') return null;
            let location = locationsByName.get(cleanName);
            if (location) {
                if (!location.parentId && parentId && location.id !== parentId) location.parentId = parentId;
                return location;
            }
            let id = stableMapId(options.prefix || 'location', cleanName);
            while (usedIds.has(id)) id = `${id}-location`;
            location = {
                id, name: cleanName, type: mapTypeFromName(cleanName, options.type || 'other'), parentId,
                x: null, y: null, area: '', description: String(options.description || ''),
                origin: String(options.origin || '当前状态自动建立'), status: options.status || 'known',
                priority: options.priority || 'L2', activity: options.activity || 'WARM',
                updatedRevision: Number(state.revision || 0), sourceRefs: stringList(options.sourceRefs),
                truthStatus: options.truthStatus || 'derived', basis: stringList(options.basis || [`由已保存的地点字段“${cleanName}”建立空间索引`]),
            };
            state.map.locations.push(location);
            locationsByName.set(cleanName, location);
            usedIds.add(id);
            return location;
        };
        // Models often return a readable parent name in parentId. Resolve it
        // into a stable node so children do not become invisible orphans.
        state.map.locations.slice().forEach((location) => {
            if (!location.parentId || usedIds.has(location.parentId)) return;
            const parent = ensureNamedLocation(location.parentId, '', { prefix: 'parent', priority: 'L3', origin: '由地点父级名称建立' });
            if (parent) location.parentId = parent.id;
        });
        state.map.locations.slice().forEach((location) => {
            if (location.parentId || !location.area || location.area === location.name) return;
            let parent = locationsByName.get(location.area);
            if (!parent) {
                let id = stableMapId('area', location.area);
                while (usedIds.has(id)) id = `${id}-area`;
                parent = { id, name: location.area, type: mapTypeFromName(location.area, 'region'), parentId: '', x: null, y: null, area: '', description: '', origin: '旧地图层级迁移', status: 'known', priority: 'L2', activity: 'WARM', updatedRevision: Number(state.revision || 0), sourceRefs: [], truthStatus: 'derived', basis: [`由旧地图区域“${location.area}”迁移`] };
                state.map.locations.push(parent);
                locationsByName.set(parent.name, parent);
                usedIds.add(parent.id);
            }
            location.parentId = parent.id;
        });
        // Older initialized revisions may already contain explicit location
        // fields in timeline/character snapshots while their dedicated
        // map array only contains a country root. Rebuild the spatial index
        // locally on load; this must never require another API read.
        const countryRoots = state.map.locations.filter((item) => item.type === 'country' && !item.parentId);
        const defaultCountryId = countryRoots.length === 1 ? countryRoots[0].id : '';
        const ensureLocationPath = (rawPlace, origin = '已保存状态中的地点', options = {}) => {
            const place = String(rawPlace || '').trim();
            if (!place || place === '未设定') return null;
            const parts = place.split(/\s*(?:·|＞|>|\/|\\)\s*/).map((part) => part.trim()).filter(Boolean);
            if (!parts.length) return null;
            let parentId = defaultCountryId && parts[0] !== countryRoots[0]?.name ? defaultCountryId : '';
            let leaf = null;
            parts.forEach((part, index) => {
                leaf = ensureNamedLocation(part, parentId, {
                    prefix: index === 0 ? 'place' : 'inside',
                    priority: options.priority || (index === 0 ? 'L3' : 'L2'),
                    activity: options.current && index === parts.length - 1 ? 'HOT' : 'WARM',
                    status: options.current && index === parts.length - 1 ? 'visited' : 'known',
                    origin: String(origin || '已保存状态中的地点').slice(0, 100),
                });
                if (leaf) parentId = leaf.id;
            });
            return leaf;
        };
        const savedLocationRecords = [
            ...(Array.isArray(state.timeline) ? state.timeline.slice(-16) : []),
            ...(Array.isArray(state.npcActivities) ? state.npcActivities : []),
            ...(Array.isArray(state.characters) ? state.characters : []),
        ];
        savedLocationRecords.forEach((item) => {
            const place = String(item?.location || item?.place || '').trim();
            if (!place) return;
            const actor = String(item?.characterId || item?.name || '').trim();
            const action = readableText(item?.summary || item?.action || item?.situation || '已保存状态中出现');
            ensureLocationPath(place, [actor, action].filter(Boolean).join('｜'));
        });
        // The current world location must always have a visible map path even
        // when the evidence extractor omitted the separate locations array.
        const currentPlace = String(state.world.location.current || '').trim();
        if (currentPlace && currentPlace !== '未设定') {
            const currentNode = ensureLocationPath(currentPlace, '当前场景位置', { current: true });
            if (currentNode) state.map.currentLocationId = currentNode.id;
        }
        normalizeMapHierarchy(state.map.locations, state.map.currentLocationId, currentPlace);
        const mergedMap = mergeMapLocations(state.map.locations);
        state.map.locations = mergedMap.locations;
        state.map.currentLocationId = mergedMap.aliases.get(String(state.map.currentLocationId || '')) || String(state.map.currentLocationId || '');
        const siblings = new Map();
        state.map.locations.forEach((location) => { (siblings.get(location.parentId) || siblings.set(location.parentId, []).get(location.parentId)).push(location); });
        siblings.forEach((items) => items.forEach((location, index) => {
            if (location.x === null) location.x = 15 + ((index * 31) % 70);
            if (location.y === null) location.y = 18 + ((Math.floor(index / 3) * 31 + (index % 3) * 13) % 64);
        }));
        state.map.routes = (Array.isArray(state.map.routes) ? state.map.routes : []).map((item) => ({
            ...item, from: mergedMap.aliases.get(String(item?.from || '')) || String(item?.from || ''), to: mergedMap.aliases.get(String(item?.to || '')) || String(item?.to || ''), status: String(item?.status || 'open'),
            description: String(item?.description || ''), travelMinutes: Number.isFinite(Number(item?.travelMinutes)) ? Number(item.travelMinutes) : 0,
            distance: String(item?.distance || ''),
        })).filter((item) => item.from && item.to);
        if (!state.initialized && ['未设定','未明确'].includes(state.world.time.display)) state.world.time.display = '';
        if (!state.initialized && ['未设定','未明确'].includes(state.world.location.current)) state.world.location.current = '';
        ['worldRules','factAnchors','resourceConstraints','organizations','characters','npcActivities','relationships','knowledge','schedules','tasks','events','triggers','threads','processes','causalEffects','timeline','lockedPaths'].forEach((key) => {
            state[key] = Array.isArray(state[key]) ? state[key] : [];
        });
        // v24 removes the redundant world-events module. Preserve every old
        // card locally: completed nodes become timeline history, while a card
        // explicitly marked ongoing becomes a current world process.
        const legacyEvents = state.events.map((item) => {
            const next = Object.assign({}, item || {});
            const developments = Array.isArray(next.developments) ? next.developments.filter(Boolean) : [];
            next.title = readableText(next.title || next.name);
            next.summary = readableText(next.summary || developments.at(-1) || next.description);
            next.outcome = readableText(next.outcome);
            next.status = String(next.status || '').toLowerCase();
            next.sourceRefs = stringList(next.sourceRefs);
            return next;
        }).filter((item) => item.title || item.summary || item.outcome);
        const semanticKey = (value) => String(value || '').replace(/[\s，。；：:、！？!?]/g, '').toLowerCase();
        const processKeys = new Set(state.processes.map((item) => semanticKey(item?.title || item?.currentDirection)).filter(Boolean));
        const timelineKeys = new Set(state.timeline.map((item) => semanticKey(item?.summary)).filter(Boolean));
        legacyEvents.forEach((item, index) => {
            const summary = [item.summary || item.title, item.outcome && item.outcome !== item.summary ? `结果：${item.outcome}` : ''].filter(Boolean).join('；');
            if (item.status === 'ongoing') {
                const key = semanticKey(item.title || summary);
                if (!key || processKeys.has(key)) return;
                state.processes.push({
                    id: item.id || `legacy-event-process-${index + 1}`, title: item.title || item.summary,
                    kind: item.kind || 'world_change', status: 'active', drivers: stringList(item.drivers),
                    decayConditions: stringList(item.decayConditions), resolutionConditions: stringList(item.resolutionConditions),
                    progress: item.progress || '', currentDirection: summary, participantIds: stringList(item.participantIds), location: readableText(item.location),
                    priority: item.priority || 'L2', activity: item.activity || 'WARM', truthStatus: item.truthStatus || 'confirmed',
                    basis: stringList(item.basis).length ? stringList(item.basis) : ['由旧版“世界事件”卡片无损迁移'], sourceRefs: item.sourceRefs,
                });
                processKeys.add(key);
                return;
            }
            const key = semanticKey(summary);
            if (!key || timelineKeys.has(key)) return;
            state.timeline.push({
                id: item.id ? `timeline-${item.id}` : `legacy-event-timeline-${index + 1}`, summary, granularity: 'event',
                time: readableText(item.time || item.at || item.date), participants: stringList(item.participantIds), location: readableText(item.location),
                priority: item.priority || 'L2', activity: 'COLD', truthStatus: item.truthStatus || 'confirmed',
                basis: stringList(item.basis).length ? stringList(item.basis) : ['由旧版“世界事件”卡片无损迁移'],
                sourceRefs: item.sourceRefs, evidence: item.sourceRefs,
            });
            timelineKeys.add(key);
        });
        state.events = [];
        const inferSeason = () => {
            const display = String(state.world.time.display || '');
            const named = display.match(/[春夏秋冬]季?/)?.[0];
            if (named) return { value: named.endsWith('季') ? named : `${named}季`, basis: [`时间字段明确包含“${named}”`] };
            const month = Number(display.match(/(?:^|\D)(1[0-2]|0?[1-9])月/)?.[1] || state.world.time.iso?.match(/^\d{4}-(1[0-2]|0[1-9])-/)?.[1]);
            if (!month) return null;
            const northern = month >= 3 && month <= 5 ? '春季' : month >= 6 && month <= 8 ? '夏季' : month >= 9 && month <= 11 ? '秋季' : '冬季';
            const location = String(state.world.location.current || '');
            if (/(澳大利亚|新西兰|南半球|阿根廷|智利|南非)/.test(location)) {
                return { value: ({ 春季: '秋季', 夏季: '冬季', 秋季: '春季', 冬季: '夏季' })[northern], basis: [`月份为${month}月`, `地点“${location}”位于南半球`] };
            }
            if (/(北半球|中国|日本|韩国|朝鲜|美国|加拿大|俄罗斯|英国|法国|德国|欧洲|北京|上海|东京|纽约|伦敦|巴黎|莫斯科)/.test(location)) {
                return { value: northern, basis: [`月份为${month}月`, `地点“${location}”位于北半球`] };
            }
            return null;
        };
        const unknownScalar = (value) => !String(value || '').trim() || /^(?:未设定|未明确|待确认|季节待确认|天气待确认)$/.test(String(value || '').trim());
        if (state.initialized) {
            state.world.time.display = unknownScalar(state.world.time.display) ? '未明确' : String(state.world.time.display).trim();
            if (state.world.time.display === '未明确') state.world.time = Object.assign(state.world.time, truthMeta(state.world.time, 'unknown', ['原文尚未明确当前时间']));
            else if (incomingVersion < 21 && state.world.time.truthStatus === 'unknown') state.world.time = Object.assign(state.world.time, truthMeta({ truthStatus: 'assumed', basis: ['旧状态未绑定时间来源，等待回查'] }, 'assumed'));

            state.world.location.current = unknownScalar(state.world.location.current) ? '未明确' : String(state.world.location.current).trim();
            state.world.location.environment = unknownScalar(state.world.location.environment) ? '未明确' : String(state.world.location.environment).trim();
            if (state.world.location.current === '未明确') state.world.location.currentMeta = truthMeta(state.world.location.currentMeta, 'unknown', ['原文尚未明确当前地点']);
            else if (incomingVersion < 21 && state.world.location.currentMeta.truthStatus === 'unknown') state.world.location.currentMeta = truthMeta({}, 'unknown', ['旧状态未绑定地点来源，等待回查']);
            if (state.world.location.environment === '未明确') state.world.location.environmentMeta = truthMeta(state.world.location.environmentMeta, 'unknown', ['原文尚未明确环境']);
            else if (incomingVersion < 21 && state.world.location.environmentMeta.truthStatus === 'unknown') state.world.location.environmentMeta = truthMeta({}, 'assumed', ['旧状态未绑定环境来源，等待回查']);

            if (unknownScalar(state.world.season)) {
                const inferred = inferSeason();
                state.world.season = inferred?.value || '未明确';
                state.world.seasonMeta = inferred
                    ? truthMeta({ truthStatus: 'derived', basis: inferred.basis }, 'derived')
                    : truthMeta({ truthStatus: 'unknown', basis: ['缺少可同时确定月份与南北半球的依据'] }, 'unknown');
            } else if (incomingVersion < 21 && state.world.seasonMeta.truthStatus === 'unknown') {
                state.world.seasonMeta = truthMeta({ truthStatus: 'assumed', basis: ['旧状态未绑定季节来源，等待日期与地点校验'] }, 'assumed');
            }

            if (unknownScalar(state.world.location.weather)) {
                state.world.location.weather = '多云';
                state.world.location.weatherMeta = truthMeta({
                    truthStatus: 'system_generated',
                    basis: [`原文未指定天气；以${state.world.location.current}、${state.world.season}、${state.world.time.display}为约束生成温和默认天气`],
                }, 'system_generated');
            } else if (incomingVersion < 21 && state.world.location.weatherMeta.truthStatus === 'unknown') {
                state.world.location.weatherMeta = truthMeta({ truthStatus: 'assumed', basis: ['旧状态未绑定天气来源；后续只允许连续变化'] }, 'assumed');
            }
            state.world.time = Object.assign(state.world.time, validateTruthMeta(state.world.time, ['confirmed','derived','assumed','unknown','failed','not_applicable'], 'unknown', '时间'));
            state.world.seasonMeta = validateTruthMeta(state.world.seasonMeta, WSM.Defaults?.INFERENCE_POLICIES?.season?.allow || ['confirmed','derived','assumed','unknown','failed'], 'unknown', '季节');
            state.world.location.currentMeta = validateTruthMeta(state.world.location.currentMeta, WSM.Defaults?.INFERENCE_POLICIES?.namedLocations?.allow || ['confirmed','derived','unknown','failed','not_applicable'], 'unknown', '地点');
            state.world.location.environmentMeta = validateTruthMeta(state.world.location.environmentMeta, ['confirmed','derived','system_generated','suspected','assumed','unknown','failed','not_applicable'], 'unknown', '环境');
            state.world.location.weatherMeta = validateTruthMeta(state.world.location.weatherMeta, WSM.Defaults?.INFERENCE_POLICIES?.weather?.allow || ['confirmed','derived','system_generated','assumed','unknown','failed'], 'unknown', '天气');
        }
        state.progression = Object.assign({}, WSM.Defaults.createState().progression, state.progression && typeof state.progression === 'object' && !Array.isArray(state.progression) ? state.progression : {});
        state.progression.priority = ['L1','L2','L3'].includes(String(state.progression.priority || '').toUpperCase()) ? String(state.progression.priority).toUpperCase() : 'L2';
        state.progression.activity = ['HOT','WARM','COLD'].includes(String(state.progression.activity || '').toUpperCase()) ? String(state.progression.activity).toUpperCase() : 'WARM';
        state.progression.direction = String(state.progression.direction || '').trim();
        state.progression.currentMovement = String(state.progression.currentMovement || '').trim();
        state.progression.nextRequiredChanges = Array.isArray(state.progression.nextRequiredChanges) ? state.progression.nextRequiredChanges.filter(Boolean).map(String) : [];
        state.progression.basedOnRefs = Array.isArray(state.progression.basedOnRefs) ? state.progression.basedOnRefs.filter(Boolean).map(String) : [];
        state.progression.blockedByDecision = String(state.progression.blockedByDecision || '').trim();
        const progressionRevision = Number(state.progression.updatedRevision);
        const hasProgression = !!(state.progression.direction || state.progression.currentMovement || state.progression.blockedByDecision || state.progression.nextRequiredChanges.length);
        state.progression.sourceRefs = stringList(state.progression.sourceRefs);
        state.progression.basis = stringList(state.progression.basis);
        if (!hasProgression) state.progression.truthStatus = 'not_applicable';
        else {
            state.progression = normalizeTruthItem('progression', state.progression);
            if (state.progression.truthStatus === 'assumed' && state.progression.basedOnRefs.length) {
                state.progression.truthStatus = 'derived';
                if (!state.progression.basis.length) state.progression.basis = ['由既存任务、线程、人物、事件或进程归纳'];
            }
        }
        state.progression.updatedRevision = Number.isFinite(progressionRevision) && (progressionRevision > 0 || !hasProgression)
            ? progressionRevision : Number(state.revision || 0);
        if (!state.causalEffects.length) {
            const legacyLinks = Array.isArray(state.causalLinks) ? state.causalLinks : [];
            const legacySeeds = Array.isArray(state.causalSeeds) ? state.causalSeeds : [];
            state.causalEffects = [
                ...legacyLinks.map((item, index) => ({
                    id: item.id || `legacy-causal-link-${index}`, causeRef: item.rootCauseRef || '', cause: item.rootCauseRef || '既存起因',
                    steps: Array.isArray(item.requiredSteps) ? item.requiredSteps : [], result: item.effect || '', affectedIds: [],
                    status: item.status === 'reached' ? 'active' : item.status === 'resolved' ? 'resolved' : 'developing', reachCondition: '', decayConditions: [], evidenceRefs: item.evidenceRefs || [],
                })),
                ...legacySeeds.map((item, index) => ({
                    id: item.id || `legacy-causal-seed-${index}`, causeRef: item.rootCauseRef || '', cause: item.rootCauseRef || '既存起因',
                    steps: [], result: item.potentialEffect || '', affectedIds: [], status: item.status === 'reached' ? 'active' : item.status === 'expired' ? 'discarded' : 'developing',
                    reachCondition: Array.isArray(item.naturalReachConditions) ? item.naturalReachConditions.join('；') : '', decayConditions: [], evidenceRefs: item.evidenceRefs || [],
                })),
            ];
        }
        delete state.causalLinks;
        delete state.causalSeeds;
        state.relationships = state.relationships.map((item) => {
            const relationship = Object.assign({}, item || {});
            delete relationship.closeness;
            delete relationship.trust;
            delete relationship.tension;
            return relationship;
        });
        state.npcActivities = uniqueRecent(state.npcActivities.filter((item) => item?.characterId && item?.action), RETENTION_LIMITS.npcActivities, (item) => String(item.characterId));
        state.runtime = Object.assign({}, WSM.Defaults.createState().runtime, state.runtime || {});
        state.runtime.npcLastUpdatedElapsedMinutes = Object.assign({}, state.runtime.npcLastUpdatedElapsedMinutes || {});
        // v22 adds fact ownership, hard rules, static/dynamic map projection,
        // richer relationships/tasks and NPC life fields. Existing facts stay
        // intact, but flag one explicit re-read so these projections can be
        // populated from their sources instead of guessed during migration.
        if (state.initialized && incomingVersion < 23) state.runtime.needsWorldRefresh = true;
        state.characters = state.characters.map((item) => {
            const character = Object.assign({}, item || {});
            const rawName = String(character.name || '').trim();
            const parsedName = rawName.split(/[：:]/)[0].trim();
            if (parsedName && parsedName !== rawName && parsedName.length <= 80) {
                character.name = parsedName;
                character.summary = String(character.summary || character.description || rawName).trim();
            }
            if (!character.description && character.summary) character.description = String(character.summary);
            if (!character.notes && (character.summary || character.description)) character.notes = String(character.summary || character.description);
            if (character.id && Number.isFinite(Number(character.lastUpdatedElapsedMinutes))) {
                state.runtime.npcLastUpdatedElapsedMinutes[character.id] = Number(character.lastUpdatedElapsedMinutes);
            }
            const stableId = String(character.id || '').toLowerCase();
            character.maintenanceLevel = ['core','active'].includes(character.maintenanceLevel)
                ? character.maintenanceLevel
                : (['user','char','character','<user>','<char>'].includes(stableId) || character.present === true ? 'core' : 'active');
            character.sourceRefs = stringList(character.sourceRefs);
            character.basis = stringList(character.basis);
            character.identity = String(character.identity || '').trim() || '未明确';
            character.aliases = stringList(character.aliases);
            character.affiliationRefs = stringList(character.affiliationRefs);
            character.authorityRefs = stringList(character.authorityRefs);
            character.knowledgeRefs = stringList(character.knowledgeRefs);
            character.motives = stringList(character.motives);
            character.currentGoals = stringList(character.currentGoals || character.goals);
            character.routine = readableText(character.routine);
            character.availability = readableText(character.availability);
            const identityHasSource = character.sourceRefs.length > 0;
            character.identityMeta = truthMeta(character.identityMeta, character.identity === '未明确' ? 'unknown' : (identityHasSource ? 'confirmed' : 'unknown'),
                character.identity === '未明确' ? ['原文或角色资料尚未明确身份'] : (identityHasSource ? ['身份来自已绑定的角色或原文来源'] : ['身份字段缺少来源，等待定点回查']));
            if (!['confirmed','derived','unknown','failed','not_applicable'].includes(character.identityMeta.truthStatus)) character.identityMeta.truthStatus = 'unknown';
            character.situation = readableText(character.situation || character.status);
            character.persistentConditions = Array.isArray(character.persistentConditions)
                ? character.persistentConditions.map((condition) => normalizeTruthItem('conditions', typeof condition === 'string' ? { name: condition } : condition))
                : (Array.isArray(character.injuries) ? character.injuries.map((value) => ({ name: String(value), effect: '', recovery: '根据时间、治疗和行动自然更新' })) : []);
            character.importantItems = Array.isArray(character.importantItems)
                ? character.importantItems.map((item) => normalizeTruthItem('resourceConstraints', typeof item === 'string' ? { name: item } : item))
                : (Array.isArray(character.heldItems) ? character.heldItems.map((value) => ({ name: String(value), status: '当前持有', significance: '由旧人物状态迁移，后续按剧情价值复核' })) : []);
            character.persistentConditions = character.persistentConditions.map((condition) => normalizeTruthItem('conditions', condition));
            character.importantItems = character.importantItems.map((item) => normalizeTruthItem('resourceConstraints', item));
            ['status','pose','clothing','heldItems','injuries','resources','goals','currentAction','memories'].forEach((field) => delete character[field]);
            delete character.lastUpdatedElapsedMinutes;
            return character;
        });
        state.knowledge = state.knowledge.map((item) => {
            const knowledge = Object.assign({}, item || {});
            knowledge.priority = ['L1','L2','L3'].includes(String(knowledge.priority || '').toUpperCase()) ? String(knowledge.priority).toUpperCase() : 'L2';
            knowledge.disclosure = ['confidential','restricted','public'].includes(knowledge.disclosure)
                ? knowledge.disclosure
                : (Array.isArray(knowledge.concealedBy) && knowledge.concealedBy.length ? 'confidential' : 'restricted');
            delete knowledge.concealedBy;
            return knowledge;
        });
        Object.entries(PRIORITY_DEFAULTS).forEach(([module, fallback]) => {
            state[module] = state[module].map((item) => {
                const next = Object.assign({}, item || {});
                const priority = String(next.priority || '').toUpperCase();
                next.priority = ['L1','L2','L3'].includes(priority)
                    ? priority : (module === 'characters' && next.maintenanceLevel === 'core' ? 'L3' : fallback);
                const activity = String(next.activity || '').toUpperCase();
                next.activity = ['HOT','WARM','COLD'].includes(activity) ? activity : defaultActivity(module, next);
                return next;
            });
        });
        const charactersByName = new Map();
        state.characters.forEach((character, index) => {
            const name = String(character?.name || '').trim().toLocaleLowerCase();
            const key = name ? `name:${name}` : `id:${String(character?.id || index)}`;
            const previous = charactersByName.get(key);
            if (!previous) { charactersByName.set(key, character); return; }
            const canonicalId = [previous.id, character.id].find((id) => ['user','char','character'].includes(String(id || '').toLowerCase()));
            const merged = { ...previous, ...character, id: canonicalId || previous.id || character.id };
            ['sourceRefs'].forEach((field) => {
                const values = [...(Array.isArray(previous[field]) ? previous[field] : []), ...(Array.isArray(character[field]) ? character[field] : [])];
                if (values.length) merged[field] = [...new Set(values.map((item) => typeof item === 'string' ? item : JSON.stringify(item)))].map((item) => {
                    try { return JSON.parse(item); } catch (_) { return item; }
                });
            });
            charactersByName.set(key, merged);
        });
        state.characters = [...charactersByName.values()];
        state.npcActivities = state.npcActivities.map((item) => {
            const next = Object.assign({}, item);
            next.location = readableText(next.location);
            next.movement = readableText(next.movement);
            next.action = readableText(next.action);
            next.currentRole = readableText(next.currentRole);
            delete next.at;
            return next;
        });
        state.causalEffects = state.causalEffects.map((item) => {
            const next = Object.assign({}, item);
            if (next.status === 'arrived' || next.status === 'reached') next.status = 'active';
            next.decayConditions = Array.isArray(next.decayConditions) ? next.decayConditions : [];
            return next;
        });
        state.triggers = state.triggers.map((item) => {
            const next = Object.assign({}, item);
            next.title = String(next.title || next.name || next.id || '').trim();
            next.conditions = stringList(next.conditions);
            next.effectsIfTriggered = stringList(next.effectsIfTriggered);
            next.blockedReasons = stringList(next.blockedReasons);
            if (next.earliestAt && !next.conditions.some((condition) => String(condition).includes(next.earliestAt))) next.conditions = [...next.conditions, `世界时间达到${next.earliestAt}`];
            delete next.earliestAt;
            return next;
        });
        state.tasks = state.tasks.map((item) => {
            const next = { ...item };
            next.title = readableText(next.title || next.name);
            next.progress = readableText(next.progress);
            ['ownerIds','dependencies','locationRefs','characterRefs','ruleRefs','knowledgeRefs','resourceConstraintRefs','completionConditions','completedConditions','consequences'].forEach((field) => { next[field] = stringList(next[field]); });
            delete next.choices;
            return next;
        });
        state.triggers = state.triggers.map((item) => { const next = { ...item }; delete next.choices; return next; });
        state.processes = state.processes.map((item) => { const next = Object.assign({}, item); delete next.lastUpdatedAt; return next; });
        state.timeline = state.timeline.map((item) => { const next = Object.assign({}, item); next.time = readableText(next.time || next.at || next.date || next.timestamp); next.summary = readableText(next.summary); next.relatedFactIds = stringList(next.relatedFactIds); delete next.at; return next; });
        const chatByRef = new Map();
        (Array.isArray(context()?.chat) ? context().chat : []).forEach((message, index) => {
            [message?.id, message?.index, message?.send_date, message?.sendDate, index].filter((value) => value !== undefined && value !== null && String(value) !== '').forEach((value) => chatByRef.set(`chat:${String(value)}`, message));
        });
        const storyTimeFromMessage = (message) => {
            const content = String(message?.content ?? message?.mes ?? '');
            return readableText(
                content.match(/<time>\s*([^<\r\n]+?)\s*<\/time>/i)?.[1]
                || content.match(/(?:^|\n)\s*time\s*[：:]\s*([^<\r\n]+)/i)?.[1]
                || content.match(/(?:^|\n)\s*(?:时间地点|时间)\s*[：:]\s*([^<\r\n，,]+)/i)?.[1],
            );
        };
        state.timeline.forEach((item) => {
            if (item.time) return;
            const sourceMessage = stringList(item.sourceRefs || item.evidence).map((ref) => chatByRef.get(ref)).find(Boolean);
            item.time = storyTimeFromMessage(sourceMessage);
        });
        state.factAnchors = state.factAnchors.map((item) => ({ ...item, fact: readableText(item?.fact), scope: readableText(item?.scope) }));
        state.organizations = state.organizations.filter((item) => !isTechnicalOrganizationCard(item)).map((item) => ({
            ...item, name: readableText(item?.name), kind: readableText(item?.kind || 'other'), leaderIds: stringList(item?.leaderIds),
            jurisdiction: readableText(item?.jurisdiction), goals: stringList(item?.goals), resources: stringList(item?.resources),
            situation: readableText(item?.situation), relationshipRefs: stringList(item?.relationshipRefs),
        }));
        state.relationships = state.relationships.map((item) => ({
            ...item,
            participants: stringList(item?.participants || [item?.from, item?.to]),
            identityRelation: readableText(item?.identityRelation || item?.type).replace(/^(?:未明确|未知|unknown)$/i, ''),
            currentPerception: readableText(item?.currentPerception || item?.dynamicPattern).replace(/^(?:未明确|未知|unknown)$/i, ''),
            formationBasis: readableText(item?.formationBasis || item?.evidence),
            type: readableText(item?.type).replace(/^(?:未明确|未知|unknown)$/i, ''),
            bondTypes: stringList(item?.bondTypes),
            dynamicPattern: readableText(item?.dynamicPattern),
            mutuality: ['mutual','asymmetric','unknown'].includes(item?.mutuality) ? item.mutuality : 'unknown',
            status: readableText(item?.status).replace(/^(?:尚未读取到已确立的关系|未明确|未知|unknown)$/i, ''),
            coreContradiction: readableText(item?.coreContradiction),
            attachments: stringList(item?.attachments),
            grievances: stringList(item?.grievances),
            boundaries: stringList(item?.boundaries),
            reconciliationConditions: stringList(item?.reconciliationConditions),
            perspectives: item?.perspectives && typeof item.perspectives === 'object' && !Array.isArray(item.perspectives) ? item.perspectives : {},
            expressionPatterns: item?.expressionPatterns && typeof item.expressionPatterns === 'object' && !Array.isArray(item.expressionPatterns) ? item.expressionPatterns : {},
            evidence: Array.isArray(item?.evidence) ? item.evidence.map(readableText).filter(Boolean) : [],
        }));
        state.knowledge = state.knowledge.map((item) => {
            const knownBy = stringList(item?.knownBy);
            const holderIds = stringList(item?.holderIds?.length ? item.holderIds : knownBy);
            const cognitiveStatus = readableText(item?.cognitiveStatus || (knownBy.length ? 'confirmed' : item?.certainty || 'unknown')).toLowerCase();
            const userVisible = item?.userVisible === true || (holderIds.includes('user') && cognitiveStatus === 'confirmed');
            return { ...item, information: readableText(item?.information), holderIds, cognitiveStatus, userVisible, knownBy, source: readableText(item?.source), evidence: Array.isArray(item?.evidence) ? item.evidence.map(readableText).filter(Boolean) : [] };
        });
        state.schedules = state.schedules.map((item) => ({
            ...item, title: readableText(item?.title), participantIds: stringList(item?.participantIds), expectedTime: readableText(item?.expectedTime),
            preconditions: stringList(item?.preconditions), status: readableText(item?.status || 'agreed').toLowerCase(), source: readableText(item?.source), completionResult: readableText(item?.completionResult),
        })).filter((item) => item.title && !['cancelled','completed'].includes(item.status));
        state.sceneState = Object.assign({}, WSM.Defaults.createState().sceneState, state.sceneState || {});
        ['presentCharacterIds','completedActions','pendingResponses','obstacles','interactionPoints','endConditions'].forEach((field) => { state.sceneState[field] = stringList(state.sceneState[field]); });
        state.reasoningAudit = Object.assign({}, WSM.Defaults.createState().reasoningAudit, state.reasoningAudit || {});
        ['matchedRules','derivedFacts','conflicts','staleStates','actorFeasibility','causalCandidates','moduleDecisions'].forEach((field) => { state.reasoningAudit[field] = Array.isArray(state.reasoningAudit[field]) ? state.reasoningAudit[field] : []; });
        state.threads = state.threads.map((item) => ({ ...item, title: readableText(item?.title), stakes: readableText(item?.stakes), nextNaturalStep: readableText(item?.nextNaturalStep), history: Array.isArray(item?.history) ? item.history.map(readableText).filter(Boolean) : [] }));
        state.processes = state.processes.map((item) => ({ ...item, title: readableText(item?.title), currentDirection: readableText(item?.currentDirection), drivers: Array.isArray(item?.drivers) ? item.drivers.map(readableText).filter(Boolean) : [] }));
        state.causalEffects = state.causalEffects.map((item) => ({ ...item, cause: readableText(item?.cause), result: readableText(item?.result), steps: Array.isArray(item?.steps) ? item.steps.map(readableText).filter(Boolean) : [] }));
        state.worldRules = state.worldRules.map((item) => {
            const fact = WSM.Facts?.normalize?.(item, { owner: 'worldRules', delivery: item?.delivery || 'conditional' }) || item;
            return { ...item, ...fact, id: item?.id || fact.factId, owner: 'worldRules' };
        });
        const factStatements = {
            factAnchors: (item) => item.fact,
            resourceConstraints: (item) => item.condition,
            organizations: (item) => `${item.name}：${item.situation || item.jurisdiction || item.kind}`,
            characters: (item) => `${item.name || item.id}：${item.identity || ''}`,
            npcActivities: (item) => item.action,
            relationships: (item) => item.status || item.type,
            knowledge: (item) => item.information,
            schedules: (item) => item.title,
            tasks: (item) => item.title,
            triggers: (item) => item.title,
            threads: (item) => item.title,
            processes: (item) => item.currentDirection || item.title,
            causalEffects: (item) => item.result,
            timeline: (item) => item.summary,
        };
        Object.entries(factStatements).forEach(([module, statementOf]) => {
            state[module] = state[module].map((item) => {
                const fact = WSM.Facts?.normalize?.({ ...item, owner: module, statement: statementOf(item) }, { owner: module, delivery: item?.delivery || 'conditional' });
                if (!fact) return item;
                return {
                    ...item,
                    factId: item.factId || fact.factId,
                    owner: module,
                    consumers: stringList(item.consumers || fact.consumers),
                    delivery: item.delivery || fact.delivery,
                    dependencyFactIds: stringList(item.dependencyFactIds || fact.dependencyFactIds),
                };
            });
        });
        ensureRelationshipCoverage(state);
        state.schemaVersion = 24;
        return refreshModuleCoverage(compactState(state));
    }
    function load() {
        const box = envelope();
        const state = normalizeState(box.state);
        state.runtime ||= {};
        state.runtime.storageChatKey = box.chatKey || currentChatKey();
        return state;
    }
    function emptyHistoryMemory() {
        return {
            version: 1,
            status: 'idle',
            fingerprint: '',
            startedAt: 0,
            completedAt: 0,
            boundary: null,
            baseline: null,
            messages: {},
            chunks: {},
            ledger: [],
            conflicts: [],
            summaryChecks: [],
            audit: null,
            pendingMessages: null,
            pendingLedger: null,
            pendingConflicts: null,
            pendingSummaryChecks: null,
            pendingAudit: null,
        };
    }
    function historyMemoryBox() {
        const box = envelope();
        const current = box.historyMemory;
        if (!current || typeof current !== 'object' || Array.isArray(current)) box.historyMemory = emptyHistoryMemory();
        return box.historyMemory;
    }
    function loadHistoryMemory() { return clone(historyMemoryBox()); }
    async function beginHistoryCalibration(manifest = {}) {
        const box = envelope();
        const previous = historyMemoryBox();
        const reusable = previous.fingerprint && previous.fingerprint === String(manifest.fingerprint || '');
        const hasActiveBaseline = !!(previous.baseline?.state && Array.isArray(previous.ledger));
        const allowedChunkKeys = new Set((Array.isArray(manifest.chunkKeys) ? manifest.chunkKeys : []).map(String));
        // Chunk keys hash the prompt version, kind and exact source records, so
        // unchanged blocks remain safe to reuse even when appending new chat
        // floors changes the overall archive fingerprint.
        const reusableChunks = Object.fromEntries(Object.entries(previous.chunks || {})
            // Failed ancestors are tiny routing markers for deterministic
            // resume splitting. Keep them even when the current expanded queue
            // contains only their child keys, otherwise a later resume can
            // accidentally retry the known-bad large parent.
            .filter(([key, value]) => !allowedChunkKeys.size || allowedChunkKeys.has(key) || value?.status === 'failed'));
        box.historyMemory = {
            ...emptyHistoryMemory(),
            ...(hasActiveBaseline || reusable ? previous : {}),
            version: 1,
            status: hasActiveBaseline ? 'complete' : 'running',
            calibrationStatus: 'running',
            fingerprint: String(manifest.fingerprint || ''),
            startedAt: Date.now(),
            completedAt: 0,
            boundary: clone(previous.boundary || (!hasActiveBaseline ? manifest.boundary : null)),
            pendingBoundary: clone(manifest.boundary || null),
            messages: clone(hasActiveBaseline ? (previous.messages || {}) : (manifest.messages || previous.messages || {})),
            pendingMessages: clone(manifest.messages || {}),
            chunks: clone(reusableChunks),
            ledger: hasActiveBaseline || reusable ? clone(previous.ledger || []) : [],
            conflicts: hasActiveBaseline || reusable ? clone(previous.conflicts || []) : [],
            summaryChecks: hasActiveBaseline || reusable ? clone(previous.summaryChecks || []) : [],
            audit: clone(hasActiveBaseline ? previous.audit : (manifest.audit || null)),
            pendingLedger: null,
            pendingConflicts: null,
            pendingSummaryChecks: null,
            pendingAudit: clone(manifest.audit || null),
        };
        await persist();
        return clone(box.historyMemory);
    }
    function readHistoryCalibrationChunk(fingerprint, chunkKey) {
        const memory = historyMemoryBox();
        if (!fingerprint || memory.fingerprint !== String(fingerprint) || !chunkKey) return null;
        const chunk = memory.chunks?.[chunkKey];
        return chunk?.status === 'processed' && chunk.result ? clone(chunk) : null;
    }
    async function writeHistoryCalibrationChunk(fingerprint, chunkKey, value = {}) {
        if (!fingerprint || !chunkKey) return null;
        const memory = historyMemoryBox();
        if (memory.fingerprint !== String(fingerprint)) throw new Error('校准来源已经变化，拒绝把分块结果写入另一份聊天档案');
        memory.chunks ||= {};
        memory.chunks[chunkKey] = {
            key: chunkKey,
            status: value.status === 'failed' ? 'failed' : 'processed',
            kind: String(value.kind || 'chat'),
            index: Number(value.index || 0),
            total: Number(value.total || 0),
            sourceRefs: Array.isArray(value.sourceRefs) ? value.sourceRefs.map(String) : [],
            uniqueMessageIds: Array.isArray(value.uniqueMessageIds) ? value.uniqueMessageIds.map(String) : [],
            chars: Number(value.chars || 0),
            result: value.result && typeof value.result === 'object' ? clone(value.result) : null,
            error: String(value.error || ''),
            at: Date.now(),
        };
        await persist();
        return clone(memory.chunks[chunkKey]);
    }
    async function completeHistoryCalibration(value = {}) {
        const memory = historyMemoryBox();
        if (value.fingerprint && memory.fingerprint !== String(value.fingerprint)) throw new Error('聊天在校准期间发生变化；已保存已完成块，请重新开始以继续校准');
        // The ledger is complete here, but it does not become the active recall
        // authority until Engine has successfully replayed and saved its
        // baseline snapshot.  This keeps a failed hydration from mixing a new
        // ledger with the user's still-active old state.
        const failed = value.status === 'failed';
        memory.calibrationStatus = failed ? 'failed' : 'calibrated';
        memory.status = failed
            ? (memory.baseline?.state ? 'complete' : 'failed')
            : (memory.baseline?.state ? 'complete' : 'calibrated');
        memory.completedAt = Date.now();
        if (!failed) {
            memory.pendingLedger = Array.isArray(value.ledger) ? clone(value.ledger) : [];
            memory.pendingConflicts = Array.isArray(value.conflicts) ? clone(value.conflicts) : [];
            memory.pendingSummaryChecks = Array.isArray(value.summaryChecks) ? clone(value.summaryChecks) : [];
        }
        memory.pendingAudit = clone(value.audit || memory.pendingAudit);
        (Array.isArray(value.messageResults) ? value.messageResults : []).forEach((item) => {
            const id = String(item?.messageId || '').replace(/^chat:/, '');
            if (!id || !memory.pendingMessages?.[id]) return;
            memory.pendingMessages[id] = {
                ...memory.pendingMessages[id],
                processed: item.status !== 'read_failed',
                status: String(item.status || ''),
                changeIds: Array.isArray(item.changeIds) ? item.changeIds.map(String) : [],
            };
        });
        if (!failed && value.boundary) memory.boundary = clone(value.boundary);
        await persist();
        return clone(memory);
    }
    async function setHistoryBaseline(state, details = {}) {
        const memory = historyMemoryBox();
        const snapshot = clone(state || {});
        delete snapshot.planner;
        delete snapshot.runtime;
        memory.baseline = {
            createdAt: Date.now(),
            boundary: clone(details.boundary || memory.boundary || null),
            state: snapshot,
        };
        if (Array.isArray(memory.pendingLedger)) memory.ledger = memory.pendingLedger;
        if (Array.isArray(memory.pendingConflicts)) memory.conflicts = memory.pendingConflicts;
        if (Array.isArray(memory.pendingSummaryChecks)) memory.summaryChecks = memory.pendingSummaryChecks;
        if (memory.pendingMessages && typeof memory.pendingMessages === 'object') memory.messages = memory.pendingMessages;
        if (memory.pendingAudit) memory.audit = memory.pendingAudit;
        memory.status = 'complete';
        memory.calibrationStatus = 'complete';
        delete memory.pendingBoundary;
        memory.pendingMessages = null;
        memory.pendingLedger = null;
        memory.pendingConflicts = null;
        memory.pendingSummaryChecks = null;
        memory.pendingAudit = null;
        if (details.audit) memory.audit = clone(details.audit);
        await persist();
        return clone(memory.baseline);
    }
    async function setTwoPassHistoryBaseline(state, details = {}) {
        const box = envelope();
        const snapshot = clone(state || {});
        delete snapshot.planner;
        delete snapshot.runtime;
        const ledger = (Array.isArray(details.ledger) ? details.ledger : []).map((change, index) => ({
            ...clone(change),
            changeId: String(change?.changeId || `two-pass:${Date.now()}:${index}`),
            sourceRefs: Array.isArray(change?.sourceRefs) ? change.sourceRefs.map(String).filter(Boolean) : [],
            recordedAt: Number(change?.recordedAt || Date.now()),
        }));
        const messages = Object.fromEntries((Array.isArray(details.messages) ? details.messages : []).map((message, index) => {
            const id = String(message?.id ?? index);
            return [id, {
                id,
                index: Number(message?.index ?? index),
                role: String(message?.role || ''),
                hidden: message?.hidden === true,
                contentHash: String(message?.contentHash || ''),
                processed: true,
                status: 'covered_by_two_pass',
                changeIds: ledger.filter((change) => change.sourceRefs.includes(`chat:${id}`)).map((change) => change.changeId),
            }];
        }));
        box.historyMemory = {
            ...emptyHistoryMemory(),
            status: 'complete',
            calibrationStatus: 'complete',
            fingerprint: String(details.fingerprint || ''),
            startedAt: Date.now(),
            completedAt: Date.now(),
            boundary: clone(details.boundary || null),
            baseline: { createdAt: Date.now(), boundary: clone(details.boundary || null), state: snapshot },
            messages,
            ledger,
            audit: clone(details.audit || null),
        };
        await persist();
        return clone(box.historyMemory.baseline);
    }
    function appendHistoryChanges(changes = [], messageRecords = [], options = {}) {
        const memory = historyMemoryBox();
        memory.messages ||= {};
        const newMessages = [];
        (Array.isArray(messageRecords) ? messageRecords : []).forEach((message) => {
            const id = String(message?.id ?? '').trim();
            if (!id) return;
            const wasKnown = !!memory.messages[id];
            memory.messages[id] = {
                id,
                index: Number(message.index || 0),
                role: String(message.role || ''),
                hidden: message.hidden === true,
                contentHash: String(message.contentHash || ''),
                processed: true,
                changeIds: Array.isArray(message.changeIds) ? message.changeIds.map(String) : [],
            };
            if (!wasKnown) newMessages.push(memory.messages[id]);
        });
        const existing = new Set((memory.ledger || []).map((item) => String(item.changeId || '')));
        (Array.isArray(changes) ? changes : []).forEach((change, index) => {
            if (!change || typeof change !== 'object') return;
            const sourceRefs = Array.isArray(change.sourceRefs) ? change.sourceRefs.map(String).filter(Boolean) : [];
            const changeId = String(change.changeId || `${options.prefix || 'change'}:${Date.now()}:${index}`);
            if (existing.has(changeId)) return;
            existing.add(changeId);
            memory.ledger.push({ ...clone(change), changeId, sourceRefs, recordedAt: Number(change.recordedAt || Date.now()) });
        });
        if (memory.audit && newMessages.length) {
            const changed = newMessages.filter((message) => message.changeIds.length).length;
            memory.audit.totalReadableMessages = Number(memory.audit.totalReadableMessages || 0) + newMessages.length;
            memory.audit.processedMessages = Number(memory.audit.processedMessages || 0) + newMessages.length;
            memory.audit.hiddenIncluded = Number(memory.audit.hiddenIncluded || 0) + newMessages.filter((message) => message.hidden).length;
            memory.audit.changedMessages = Number(memory.audit.changedMessages || 0) + changed;
            memory.audit.noLongTermChangeMessages = Number(memory.audit.noLongTermChangeMessages || 0) + newMessages.length - changed;
            memory.audit.incrementalChanges = Number(memory.audit.incrementalChanges || 0) + changes.length;
            memory.audit.lastIncrementalAt = Date.now();
        }
        if (newMessages.length) memory.lastProcessedMessageId = newMessages.at(-1).id;
        return clone(memory);
    }
    function historyTerms(value) {
        const input = String(value || '').toLocaleLowerCase();
        const ignored = new Set(['这个','那个','然后','现在','还是','可以','已经','什么','怎么','一下','进入','继续','用户','角色','当前']);
        const terms = new Set((input.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2,}/g) || []).filter((item) => !ignored.has(item)));
        for (const run of input.match(/[\u3400-\u9fff]{3,}/g) || []) {
            for (let index = 0; index < run.length - 1; index += 1) {
                const part = run.slice(index, index + 2);
                if (!ignored.has(part)) terms.add(part);
            }
        }
        return [...terms];
    }
    function changeText(change) {
        const value = change?.value ?? change?.patch ?? change?.summary ?? '';
        const rendered = readableText(value);
        return [change?.module, change?.entityId, change?.factId, rendered].map((item) => String(item || '').trim()).filter(Boolean).join('｜');
    }
    function evidenceExcerpt(content, terms, limit = 220) {
        const input = String(content || '').replace(/\s+/g, ' ').trim();
        if (input.length <= limit) return input;
        const lower = input.toLocaleLowerCase();
        const at = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
        const start = Math.max(0, at - Math.floor(limit * 0.35));
        const end = Math.min(input.length, start + limit);
        return `${start > 0 ? '…' : ''}${input.slice(start, end)}${end < input.length ? '…' : ''}`;
    }
    function retrieveHistory(query, options = {}) {
        const memory = historyMemoryBox();
        if (memory.status !== 'complete' || !Array.isArray(memory.ledger) || !memory.ledger.length) return { text: '', matches: [], evidence: [] };
        const terms = historyTerms(query);
        if (!terms.length) return { text: '', matches: [], evidence: [] };
        const userName = String(options.state?.identities?.user || '').toLocaleLowerCase();
        const recallAllowed = (change) => {
            if (String(change?.module) !== 'knowledge') return true;
            const value = change?.value || {};
            if (String(value.disclosure || '').toLowerCase() === 'public') return true;
            const known = [...(value.knownBy || []), ...(value.believedBy || []), ...(value.suspectedBy || [])].map((item) => String(item).toLocaleLowerCase());
            return known.some((item) => ['user','<user>'].includes(item) || (userName && item === userName));
        };
        const ranked = memory.ledger.filter(recallAllowed).map((change, index) => {
            const value = changeText(change).toLocaleLowerCase();
            let score = 0;
            terms.forEach((term) => {
                if (value.includes(term)) score += term.length >= 4 ? 10 : 3;
            });
            if (change.operation === 'remove') score += 1;
            return { change, index, score };
        }).filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || b.index - a.index)
            .slice(0, Math.max(1, Number(options.limit || 6)));
        if (!ranked.length) return { text: '', matches: [], evidence: [] };
        const refs = [...new Set(ranked.flatMap((item) => item.change.sourceRefs || []).filter((ref) => String(ref).startsWith('chat:')))];
        // Resolve only the 1–2 hit floors.  Do not normalize or copy the entire
        // archive on every turn merely to obtain two evidence excerpts.
        const wantedIds = refs.slice(0, Math.max(0, Number(options.evidenceCount ?? 2))).map((ref) => String(ref).slice(5));
        const hitMessages = WSM.Context?.messagesByIds
            ? WSM.Context.messagesByIds(wantedIds, WSM.Context.context?.(), { includeHidden: true })
            : (WSM.Context?.chat?.(WSM.Context.context?.(), { includeHidden: true }) || []).filter((message) => wantedIds.includes(String(message.id)));
        const byId = new Map(hitMessages.map((message) => [String(message.id), message]));
        const evidence = refs.slice(0, Math.max(0, Number(options.evidenceCount ?? 2))).map((ref) => {
            const id = String(ref).slice(5);
            const message = byId.get(id);
            return message ? { ref, role: message.role, excerpt: evidenceExcerpt(message.content, terms) } : null;
        }).filter(Boolean);
        const lines = ranked.map(({ change }) => {
            const source = (change.sourceRefs || []).slice(0, 2).join('、');
            const op = change.operation === 'remove' ? '已失效' : '历史记录';
            return `${op}${source ? `（${source}）` : ''}：${changeText(change)}`;
        });
        evidence.forEach((item) => lines.push(`原文证据（${item.ref}）：${item.excerpt}`));
        const maxChars = Math.max(200, Math.min(1200, Number(options.maxChars || 800)));
        return { text: lines.join('\n').slice(0, maxChars), matches: ranked.map((item) => clone(item.change)), evidence };
    }
    function historyAudit() {
        const memory = historyMemoryBox();
        return clone(memory.calibrationStatus === 'failed' && memory.pendingAudit ? memory.pendingAudit : memory.audit);
    }
    function readSourceReadCache(cacheKey) {
        if (!cacheKey) return null;
        const evidence = envelope()?.sourceReadCache?.[cacheKey]?.evidence;
        return evidence && typeof evidence === 'object' ? clone(evidence) : null;
    }
    function readSourceReadArchive(limit = 4) {
        const cache = envelope()?.sourceReadCache;
        if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return [];
        return Object.values(cache)
            .filter((item) => item?.evidence && typeof item.evidence === 'object')
            .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
            .slice(0, Math.max(1, Number(limit || 4)))
            .map((item) => clone(item.evidence));
    }
    async function writeSourceReadCache(cacheKey, evidence) {
        if (!cacheKey || !evidence || typeof evidence !== 'object') return;
        const box = envelope();
        const current = box.sourceReadCache && typeof box.sourceReadCache === 'object' && !Array.isArray(box.sourceReadCache)
            ? box.sourceReadCache : {};
        current[cacheKey] = { at: Date.now(), evidence: clone(evidence) };
        box.sourceReadCache = Object.fromEntries(Object.entries(current)
            .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0)).slice(0, 4));
        await persist();
    }
    async function persist() {
        const ctx = context();
        if (typeof ctx?.saveChat === 'function') await ctx.saveChat();
        else if (typeof window.saveChatConditional === 'function') await window.saveChatConditional();
        else window.saveMetadataDebounced?.();
    }
    async function save(next, reason = 'update', options = {}) {
        const activeChatKey = currentChatKey();
        const intendedChatKey = String(next?.runtime?.storageChatKey || '').trim();
        if (intendedChatKey && intendedChatKey !== activeChatKey) {
            throw new Error(`聊天已从“${intendedChatKey}”切换到“${activeChatKey}”，已阻止把旧聊天的状态写入新存档`);
        }
        const box = envelope();
        if (options.clearHistory === true) box.history = [];
        if (options.snapshot === true && box.state) {
            box.history.unshift({
                at: Date.now(), reason, kind: options.snapshotKind || 'generation',
                turnKey: String(options.snapshotTurnKey || ''),
                state: clone(box.state),
            });
            box.history = box.history.filter(isGenerationSnapshot).slice(0, HISTORY_LIMIT);
        }
        const state = normalizeState(next || WSM.Defaults.createState());
        state.runtime ||= {};
        state.runtime.storageChatKey = activeChatKey;
        state.revision = Number(state.revision || 0) + 1;
        state.updatedAt = Date.now();
        box.state = state;
        await persist();
        window.dispatchEvent(new CustomEvent('wsm-state-changed', { detail: { reason } }));
        return clone(state);
    }
    function isGenerationSnapshot(item) {
        return item?.kind === 'generation' || item?.kind === 'organization' || item?.reason === 'planner';
    }
    function isChatGenerationSnapshot(item) {
        if (item?.kind !== 'generation') return false;
        if (String(item?.turnKey || '')) return true;
        // Compatibility with snapshots written before turnKey was persisted.
        // These reasons are all pre-generation chat nodes; initialization and
        // organization snapshots remain deliberately excluded.
        return ['turn-reconcile-and-reason', 'planner', 'pre-generation-reasoning']
            .includes(String(item?.reason || ''));
    }
    function history() { return clone(envelope().history.filter(isGenerationSnapshot).slice(0, HISTORY_LIMIT)); }
    async function rollbackPreviousGeneration() {
        const box = envelope();
        const index = box.history.findIndex(isGenerationSnapshot);
        if (index < 0) throw new Error('还没有可回滚的上一轮生成结果');
        const [snap] = box.history.splice(index, 1);
        return save(snap.state, 'rollback-generation', { snapshot: false });
    }
    async function rollbackGenerations(count = 1) {
        const requested = Math.max(0, Math.floor(Number(count || 0)));
        if (!requested) return { state: load(), rolledBack: 0 };
        const box = envelope();
        // Prefer turnKey snapshots, while still recognizing chat nodes saved by
        // older plugin versions. Manual organization and initialization
        // snapshots must never be consumed by chat deletion.
        const indexes = [];
        for (let index = 0; index < box.history.length && indexes.length < requested; index += 1) {
            const item = box.history[index];
            if (isChatGenerationSnapshot(item)) indexes.push(index);
        }
        if (!indexes.length) return { state: load(), rolledBack: 0 };
        const target = box.history[indexes.at(-1)].state;
        const removed = new Set(indexes);
        box.history = box.history.filter((_item, index) => !removed.has(index));
        const state = await save(target, 'rollback-deleted-chat-generations', { snapshot: false });
        return { state, rolledBack: indexes.length };
    }
    async function clearAll() {
        const box = envelope();
        box.state = WSM.Defaults.createState();
        box.history = [];
        delete box.sourceReadCache;
        delete box.historyMemory;
        await persist();
        WSM.WorldbookCompiler?.clearCache?.();
        await WSM.WorldbookCompiler?.setWorldbookPrompts?.({});
        await WSM.Engine?.clearRegisteredPrompts?.();
        window.dispatchEvent(new CustomEvent('wsm-state-changed', { detail: { reason: 'clear-all' } }));
        return clone(box.state);
    }
    function memoryItemCount(state) {
        return MEMORY_MODULES.reduce((total, module) => total + (Array.isArray(state?.[module]) ? state[module].length : 0), 0);
    }
    async function organizeState(mode = 'smart') {
        const current = load();
        if (!current.initialized) throw new Error('状态尚未初始化');
        const next = clone(current);
        const beforeItems = memoryItemCount(next);
        const beforeTimeline = next.timeline.length;
        const temporaryOnly = mode === 'temporary';
        const ongoing = (module, item) => {
            const status = String(item?.status || '').toLowerCase();
            if (module === 'characters') return item?.present === true;
            if (module === 'tasks') return ['pending','active','blocked'].includes(status);
            if (module === 'triggers') return ['armed','eligible'].includes(status);
            if (module === 'threads') return ['open','paused'].includes(status);
            if (module === 'processes') return ['active','decaying','paused'].includes(status);
            if (module === 'causalEffects') return ['developing','active'].includes(status);
            return false;
        };
        MEMORY_MODULES.filter((module) => module !== 'timeline').forEach((module) => {
            next[module] = (next[module] || []).filter((item) => {
                const priority = String(item?.priority || '').toUpperCase();
                const activity = String(item?.activity || '').toUpperCase();
                return priority !== 'L1' || activity === 'HOT' || ongoing(module, item);
            });
        });
        if (!temporaryOnly) next.timeline = compactTimeline(next.timeline, 24);
        compactState(next);
        next.planner ||= {};
        if (WSM.Injection?.compose) next.planner.injection = WSM.Injection.compose(next, next.planner.plan || {}, next.planner.moduleInjections || {});
        const saved = await save(next, temporaryOnly ? 'organize-temporary' : 'organize-smart', { snapshot: true, snapshotKind: 'organization' });
        return {
            state: saved,
            mode: temporaryOnly ? 'temporary' : 'smart',
            beforeItems,
            afterItems: memoryItemCount(saved),
            beforeTimeline,
            afterTimeline: saved.timeline.length,
        };
    }
    function getPath(root, path) {
        return String(path).split('.').filter(Boolean).reduce((value, key) => value?.[key], root);
    }
    function setPath(root, path, value) {
        const keys = String(path).split('.').filter(Boolean);
        if (!keys.length) return;
        let target = root;
        for (let i = 0; i < keys.length - 1; i += 1) {
            target[keys[i]] = target[keys[i]] && typeof target[keys[i]] === 'object' ? target[keys[i]] : {};
            target = target[keys[i]];
        }
        target[keys.at(-1)] = clone(value);
    }
    function enforceLocks(previous, candidate) {
        const result = clone(candidate || previous);
        const locks = Array.isArray(previous?.lockedPaths) ? previous.lockedPaths : [];
        locks.forEach((path) => setPath(result, path, getPath(previous, path)));
        result.lockedPaths = clone(locks);
        return result;
    }
    WSM.Storage = {
        load, save, currentChatKey, history, rollbackPreviousGeneration, rollbackGenerations, clearAll, organizeState, enforceLocks, enforceTruthTransition, clone, normalizeMapHierarchy,
        readSourceReadCache, readSourceReadArchive, writeSourceReadCache,
        loadHistoryMemory, beginHistoryCalibration, readHistoryCalibrationChunk, writeHistoryCalibrationChunk,
        completeHistoryCalibration, setHistoryBaseline, setTwoPassHistoryBaseline, appendHistoryChanges, retrieveHistory, historyAudit,
        _test: { normalizeState, normalizeMapHierarchy, mapTypeFromName, compactState, compactTimeline, ensureInitializedModuleCoverage, memoryItemCount, RETENTION_LIMITS, historyTerms, evidenceExcerpt, changeText, normalizeTruthItem, ensureRelationshipCoverage, refreshModuleCoverage, truthMeta, currentChatKey, isChatGenerationSnapshot },
    };
})();
