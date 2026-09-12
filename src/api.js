(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    let activeCallBudget = null;
    let scriptModulePromise = null;
    let chatModulePromise = null;
    const requestDiagnostics = [];
    const validationDiagnostics = [];
    const diagnosticNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    function getDiagnostics() {
        return {version:String(WSM.version || ''), capturedAt:new Date().toISOString(),
            requests:requestDiagnostics.map(row => ({...row, durationMs:row.durationMs ?? Date.now()-row.startedAt})),
            validations:validationDiagnostics.map(row => ({...row, missingModules:[...row.missingModules]}))};
    }
    function recordValidation({phase, complete, ended, recordCount, errorCount, replacementErrors, missingModules, issueKinds}) {
        validationDiagnostics.push({phase:Number(phase), complete:!!complete, ended:!!ended,
            recordCount:Number(recordCount), errorCount:Number(errorCount), replacementErrors:Number(replacementErrors),
            missingModules:(missingModules || []).filter(key => /^[a-zA-Z]+$/.test(key)),
            issueKinds:[...new Set((issueKinds || []).filter(key => /^(?:interruption|invalid_tail|missing_end|missing_modules|replacement_error|validation_error)$/.test(key)))], at:Date.now()});
        if (validationDiagnostics.length > 6) validationDiagnostics.shift();
    }

    async function prepareTavernStreamBody(context, messages, settings, chatModule = null) {
        if (context?.mainApi !== 'openai') return null;
        if (!chatModule) {
            if (!chatModulePromise) chatModulePromise = import('/scripts/openai.js').catch((error) => {
                chatModulePromise = null;
                throw error;
            });
            chatModule = await chatModulePromise;
        }
        // Reuse the active connection, including its proxy/auth settings.
        // generateRaw always disables streaming for quiet requests.
        // Other native wire formats retain their existing adapter.
        if (!['openai', 'custom'].includes(chatModule.oai_settings?.chat_completion_source)) return null;
        const localSettings = {
            ...chatModule.oai_settings,
            openai_max_tokens: settings.maxTokens,
            reasoning_effort: settings.taskReasoningEffort || chatModule.oai_settings.reasoning_effort,
            show_thoughts: false,
        };
        const model = chatModule.getChatCompletionModel(localSettings);
        const { generate_data } = await chatModule.createGenerationParameters(localSettings, model, 'quiet', messages);
        generate_data.stream = true;
        // Internal JSONL must not inherit chat stop strings or tools.
        delete generate_data.stop;
        delete generate_data.tools;
        delete generate_data.tool_choice;
        return generate_data;
    }

    async function requestHeaders() {
        if (typeof window.getRequestHeaders === 'function') return window.getRequestHeaders();
        if (!scriptModulePromise) scriptModulePromise = import('/script.js').catch((error) => {
            scriptModulePromise = null;
            throw error;
        });
        const module = await scriptModulePromise;
        if (typeof module?.getRequestHeaders !== 'function') throw new Error('当前酒馆未提供 CSRF 请求头方法，请刷新酒馆页面');
        return module.getRequestHeaders();
    }

    async function withCallBudget(maxCalls, label, operation) {
        if (activeCallBudget) throw new Error('已有 API 任务正在执行，请等待完成后再操作；未发送额外请求');
        const budget = { label: String(label || 'operation'), max: Math.max(0, Math.floor(Number(maxCalls) || 0)), used: 0 };
        activeCallBudget = budget;
        try { return await operation(budget); }
        finally { if (activeCallBudget === budget) activeCallBudget = null; }
    }

    function consumeCallBudget(options = {}) {
        const budget = options.callBudget || activeCallBudget;
        // Fail closed: every billable completion must belong to an operation
        // that declared its cap. This prevents a new feature from accidentally
        // bypassing the user's charge limit in a later release.
        if (!budget) throw new Error('已阻止未声明调用额度的 API 请求，避免意外扣费');
        if (budget.used >= budget.max) throw new Error(`已达到本次操作的 API 调用上限（${budget.max} 次），已阻止额外扣费`);
        budget.used += 1;
        return budget;
    }

    function normalizeEndpoint(value) {
        let endpoint = String(value || '').trim().replace(/\/+$/, '');
        if (!endpoint) throw new Error('尚未设置 Planner API 地址');
        if (!/\/chat\/completions(?:\?|$)/.test(endpoint)) endpoint += '/chat/completions';
        return endpoint;
    }
    function endpointBase(value) {
        const endpoint = new URL(normalizeEndpoint(value), window.location?.href || 'http://localhost/');
        endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions\/?$/, '');
        endpoint.search = '';
        endpoint.hash = '';
        return endpoint.href.replace(/\/+$/, '');
    }
    function modelsEndpoint(value) {
        const endpoint = new URL(normalizeEndpoint(value), window.location?.href || 'http://localhost/');
        endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions\/?$/, '/models');
        endpoint.search = '';
        return endpoint.href;
    }
    const STATE_ROOT_KEYS = ['identities','world','map','organizations','characters','npcActivities','relationships','knowledge','schedules','tasks','events','triggers','threads','processes','causalEffects','timeline','sceneState','reasoningAudit'];
    const WORLD_DETAIL_KEYS = ['time','season','seasonMeta','location','environment','weather','currentConditions','currentConditionDetails'];
    const EVIDENCE_ROOT_KEYS = ['sourceRefs','canon','worldRules','chronology','timeline','anchors','resourceConstraints','organizations','characters','npcActivities','relationships','knowledge','schedules','locations','tasks','events','triggers','threads','processes','causal','progression','currentScene','uncertainties','messageResults','changes','conflicts','summaryChecks'];
    function objectKeyCount(value, keys) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
        return keys.reduce((count, key) => count + (Object.prototype.hasOwnProperty.call(value, key) ? 1 : 0), 0);
    }
    function contractScore(value, contract) {
        if (!contract || !value || typeof value !== 'object' || Array.isArray(value)) return contract ? 0 : 1;
        const envelopes = [value, value.result, value.data, value.output].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
        if (contract === 'state') {
            for (let index = 0; index < envelopes.length; index += 1) {
                if (envelopes[index].state && typeof envelopes[index].state === 'object' && !Array.isArray(envelopes[index].state)) return index ? 90 : 100;
            }
            return objectKeyCount(value, STATE_ROOT_KEYS) >= 3 ? 50 : 0;
        }
        if (contract === 'evidence') {
            if (value.evidence && typeof value.evidence === 'object') return 100 + Math.min(30, objectKeyCount(value.evidence, EVIDENCE_ROOT_KEYS));
            if (value.digest && typeof value.digest === 'object') return 95 + Math.min(30, objectKeyCount(value.digest, EVIDENCE_ROOT_KEYS));
            for (let index = 1; index < envelopes.length; index += 1) {
                const nested = envelopes[index];
                if (nested.evidence && typeof nested.evidence === 'object') return 90 + Math.min(30, objectKeyCount(nested.evidence, EVIDENCE_ROOT_KEYS));
                if (nested.digest && typeof nested.digest === 'object') return 85 + Math.min(30, objectKeyCount(nested.digest, EVIDENCE_ROOT_KEYS));
            }
            return objectKeyCount(value, EVIDENCE_ROOT_KEYS) >= 3 ? 50 : 0;
        }
        if (contract === 'digest') {
            if (value.digest && typeof value.digest === 'object') return 100;
            return objectKeyCount(value, EVIDENCE_ROOT_KEYS) >= 3 ? 50 : 0;
        }
        if (contract === 'delta') {
            for (let index = 0; index < envelopes.length; index += 1) {
                const item = envelopes[index];
                if (Object.prototype.hasOwnProperty.call(item, 'stateDelta')) return index ? 90 : 100;
                if (Object.prototype.hasOwnProperty.call(item, 'delta')) return index ? 80 : 85;
                if (item.state && typeof item.state === 'object' && !Array.isArray(item.state)) return index ? 70 : 75;
            }
            if (objectKeyCount(value, STATE_ROOT_KEYS) >= 1) return 50;
            // A few OpenAI-compatible endpoints ignore the requested wrapper
            // and return the changed `world` module itself. Keep that JSON as
            // a usable delta candidate; the engine wraps it into statePatch.
            return objectKeyCount(value, WORLD_DETAIL_KEYS) >= 2 ? 45 : 0;
        }
        if (contract === 'facts') {
            if (value.factStream && typeof value.factStream === 'object') return 100;
            if (Array.isArray(value.facts) || value.type === 'fact' || value.type === 'patch' || value.end === true) return 90;
            return 0;
        }
        return 1;
    }
    function contractRichness(value, contract) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
        const root = contract === 'evidence'
            ? (value.evidence || value.digest || value.result?.evidence || value.result?.digest || value.data?.evidence || value.data?.digest || value.output?.evidence || value.output?.digest || value)
            : contract === 'delta'
                ? (value.stateDelta || value.delta || value.result?.stateDelta || value.result?.delta || value.data?.stateDelta || value.data?.delta || value.output?.stateDelta || value.output?.delta || value)
            : contract === 'state'
                ? (value.state || value)
                : value;
        if (!root || typeof root !== 'object' || Array.isArray(root)) return 0;
        const keys = contract === 'evidence' ? EVIDENCE_ROOT_KEYS : STATE_ROOT_KEYS;
        const returnedKeys = keys.filter((key) => Object.prototype.hasOwnProperty.call(root, key)).length;
        const populatedItems = keys.reduce((sum, key) => sum + (Array.isArray(root[key]) ? Math.min(32, root[key].length) : (root[key] && typeof root[key] === 'object' ? 1 : 0)), 0);
        let serializedLength = 0;
        try { serializedLength = JSON.stringify(root).length; } catch (_) { /* cyclic provider object */ }
        return returnedKeys * 1000000 + populatedItems * 10000 + Math.min(9999, serializedLength);
    }
    function contractLabel(contract) {
        if (contract === 'state') return '包含 state 的世界状态结果';
        if (contract === 'evidence') return '包含 evidence/digest 的资料证据';
        if (contract === 'digest') return '包含 digest 的资料摘要';
        if (contract === 'delta') return '包含 stateDelta（或直接状态模块）的增量结算结果';
        if (contract === 'facts') return '至少一条完整事实记录或结束标记';
        return '有效结果';
    }

    function parseFactLines(value) {
        if (value?.factStream && typeof value.factStream === 'object') return value.factStream;
        const records = [];
        const addRecord = (record) => {
            if (!record || typeof record !== 'object' || Array.isArray(record)) return;
            if (Array.isArray(record.facts)) record.facts.forEach(addRecord);
            if (Array.isArray(record.records)) record.records.forEach(addRecord);
            if (record.type || record.kind || record.module || record.target || record.end === true || record.checkpoint != null) records.push(record);
        };
        if (value && typeof value === 'object') addRecord(value);
        const cleaned = typeof value === 'string'
            ? String(value || '').replace(/<think(?:ing)?\b[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:jsonl|ndjson|json)?/gi, '').trim()
            : '';
        if (cleaned) {
            // Scan complete top-level objects instead of splitting only on
            // newlines. Providers sometimes join JSONL records into a single
            // SSE chunk, and a truncated final record must not invalidate the
            // complete records before it.
            for (let start = 0; start < cleaned.length; start += 1) {
                if (cleaned[start] !== '{') continue;
                let depth = 0;
                let inString = false;
                let escaped = false;
                for (let index = start; index < cleaned.length; index += 1) {
                    const char = cleaned[index];
                    if (inString) {
                        if (escaped) escaped = false;
                        else if (char === '\\') escaped = true;
                        else if (char === '"') inString = false;
                        continue;
                    }
                    if (char === '"') { inString = true; continue; }
                    if (char === '{') depth += 1;
                    else if (char === '}') {
                        depth -= 1;
                        if (depth === 0) {
                            try { addRecord(JSON.parse(cleaned.slice(start, index + 1))); } catch (_) { /* discard only this malformed record */ }
                            start = index;
                            break;
                        }
                    }
                }
            }
        }
        const facts = [];
        const patches = [];
        const checkedModules = new Set();
        const candidateModules = new Set();
        const moduleCoverage = {};
        const coverageBasis = {};
        let end = false;
        let maxCheckpoint = 0;
        records.forEach((record) => {
            if (record.end === true || String(record.type || '').toLowerCase() === 'end') {
                end = true;
                (Array.isArray(record.checkedModules) ? record.checkedModules : []).forEach((module) => checkedModules.add(String(module || '').trim()));
                (Array.isArray(record.candidateModules) ? record.candidateModules : []).forEach((module) => candidateModules.add(String(module || '').trim()));
                if (record.moduleCoverage && typeof record.moduleCoverage === 'object' && !Array.isArray(record.moduleCoverage)) {
                    Object.entries(record.moduleCoverage).forEach(([module, status]) => {
                        moduleCoverage[String(module || '').trim()] = String(status || '').trim();
                        checkedModules.add(String(module || '').trim());
                        if (/^(?:H|has_records)$/i.test(String(status || '').trim())) candidateModules.add(String(module || '').trim());
                    });
                }
                if (record.coverageBasis && typeof record.coverageBasis === 'object' && !Array.isArray(record.coverageBasis)) {
                    Object.entries(record.coverageBasis).forEach(([module, basis]) => { coverageBasis[String(module || '').trim()] = String(basis || '').trim(); });
                }
                maxCheckpoint = Math.max(maxCheckpoint, Number(record.checkpoint || record.processedThrough || record.through || 0));
                return;
            }
            if (record.checkpoint != null || String(record.type || '').toLowerCase() === 'checkpoint') {
                maxCheckpoint = Math.max(maxCheckpoint, Number(record.checkpoint || record.sourceIndex || record.processedThrough || record.through || 0));
                return;
            }
            if (record.target || String(record.type || '').toLowerCase() === 'patch') patches.push(record);
            else facts.push(record);
            if (record.module) candidateModules.add(String(record.module).trim());
            maxCheckpoint = Math.max(maxCheckpoint, Number(record.sourceIndex || 0));
        });
        return {
            facts, patches, end, maxCheckpoint,
            checkedModules: [...checkedModules].filter(Boolean),
            candidateModules: [...candidateModules].filter(Boolean),
            moduleCoverage,
            coverageBasis,
            completeRecords: records.length,
        };
    }
    function escapeStrayJsonQuotes(value) {
        let output = '';
        let inString = false;
        for (let index = 0; index < value.length; index += 1) {
            const char = value[index];
            if (!inString) {
                output += char;
                if (char === '"') inString = true;
                continue;
            }
            if (char === '\\') {
                output += char;
                if (index + 1 < value.length) output += value[++index];
                continue;
            }
            if (char === '"') {
                let nextIndex = index + 1;
                while (nextIndex < value.length && /\s/.test(value[nextIndex])) nextIndex += 1;
                const next = value[nextIndex] || '';
                if (!next || [':', ',', '}', ']'].includes(next)) {
                    output += char;
                    inString = false;
                } else output += '\\"';
                continue;
            }
            output += char;
        }
        return output;
    }
    function parseLenientJsonObject(value) {
        let input = String(value || '').trim();
        if (!input) return null;
        input = input.replace(/<think(?:ing)?\b[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
        const danglingClose = Math.max(input.toLowerCase().lastIndexOf('</think>'), input.toLowerCase().lastIndexOf('</thinking>'));
        if (danglingClose >= 0) input = input.slice(input.indexOf('>', danglingClose) + 1).trim();
        const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced) input = fenced[1].trim();
        const first = input.indexOf('{');
        const last = input.lastIndexOf('}');
        if (first < 0 || last <= first) return null;
        const body = input.slice(first, last + 1);
        const variants = [
            body,
            body.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1'),
        ];
        for (const candidate of variants) {
            try { return JSON.parse(candidate); } catch (_) { /* try conservative quote repair */ }
            try { return JSON.parse(escapeStrayJsonQuotes(candidate)); } catch (_) { /* keep strict failure */ }
        }
        return null;
    }
    function parseSentenceLines(value) {
        const facts = [];
        let ended = false;
        let invalid = false;
        const checked = new Set();
        const add = (row) => {
            if (Array.isArray(row)) { row.forEach(add); return; }
            if (!row || typeof row !== 'object') { invalid = true; return; }
            if (row.factStream) { add(row.factStream.facts || []); if (row.factStream.end) add({end:true}); return; }
            if (row.end === true && !row.facts && !row.records && !row.memory) { ended = true; (Array.isArray(row.checkedModules) ? row.checkedModules : []).forEach(key => checked.add(key)); return; }
            if (ended) { invalid = true; ended = false; }
            if (Array.isArray(row.facts) || Array.isArray(row.records)) { add(row.facts || row.records); if (row.end === true) add({end:true}); return; }
            if (row.memory && typeof row.memory === 'object') {
                for (const [module, rows] of Object.entries(row.memory)) for (const text of Array.isArray(rows) ? rows : []) add({module,text});
                if (row.end === true) add({end:true});
                return;
            }
            if (typeof row.module !== 'string' || typeof row.text !== 'string' || (row.before !== undefined && typeof row.before !== 'string')) { invalid = true; return; }
            // Extra provider fields never enter persistence. Only the complete
            // sentence and an optional exact replacement locator are accepted.
            facts.push({module:row.module, text:row.text, ...(row.before !== undefined ? {before:row.before} : {})});
        };
        if (value && typeof value === 'object') add(value);
        else {
            const input = String(value || '').replace(/<think(?:ing)?\b[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:jsonl|ndjson|json)?/gi, '').trim();
            let cursor = 0;
            while (cursor < input.length) {
                if (/\s/.test(input[cursor])) { cursor++; continue; }
                if (!['{','['].includes(input[cursor])) { invalid = true; cursor++; continue; }
                const start = cursor;
                const stack = [];
                let quoted = false, escaped = false, closed = false;
                for (; cursor < input.length; cursor++) {
                    const ch = input[cursor];
                    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
                    if (ch === '"') quoted = true;
                    else if (ch === '{') stack.push('}');
                    else if (ch === '[') stack.push(']');
                    else if (ch === '}' || ch === ']') {
                        if (stack.pop() !== ch) { invalid = true; break; }
                        if (!stack.length) { closed = true; break; }
                    }
                }
                if (!closed) { invalid = true; break; } // Never mine nested objects from a broken tail.
                try { add(JSON.parse(input.slice(start, cursor + 1))); } catch (_) { invalid = true; }
                cursor++;
            }
        }
        return {facts, patches:[], end:ended && !invalid, checkedModules:[...checked], invalid};
    }
    function extractJson(value, options = {}) {
        const contract = String(options.jsonContract || '');
        if (contract === 'sentences') {
            const factStream = parseSentenceLines(value);
            if (!factStream.facts.length && !factStream.end) throw new Error('模型没有返回完整的事实句子；旧状态已保留');
            return {factStream};
        }
        if (contract === 'facts') {
            const factStream = parseFactLines(value);
            if (factStream.facts.length || factStream.patches.length || factStream.end || factStream.maxCheckpoint > 0) return { factStream };
            // Keep compatibility with cached/mocked evidence responses while
            // the on-disk cache rolls from the former large-object protocol to
            // the fact stream protocol.
            if (value && typeof value === 'object') return value;
            throw new Error('Planner 返回中没有可保存的完整事实行');
        }
        const candidates = [];
        const addCandidate = (candidate) => {
            if (candidate && typeof candidate === 'object') candidates.push(candidate);
        };
        if (value && typeof value === 'object') addCandidate(value);
        const cleaned = typeof value === 'string'
            ? String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
            : '';
        if (cleaned) {
            try {
                const parsed = JSON.parse(cleaned);
                // A complete response that already satisfies the requested
                // top-level envelope cannot be improved by rescanning every
                // nested object or by running truncation repair over the same
                // text. Provider envelopes such as result.evidence keep the
                // existing candidate-selection path and return shape.
                const topLevelContract = contract === 'evidence'
                    ? ((parsed?.evidence && typeof parsed.evidence === 'object') || (parsed?.digest && typeof parsed.digest === 'object'))
                    : contract === 'digest'
                        ? parsed?.digest && typeof parsed.digest === 'object'
                        : contract === 'state'
                            ? parsed?.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state)
                            : contract === 'delta'
                                ? Object.prototype.hasOwnProperty.call(parsed || {}, 'stateDelta')
                                    || Object.prototype.hasOwnProperty.call(parsed || {}, 'delta')
                                    || (parsed?.state && typeof parsed.state === 'object' && !Array.isArray(parsed.state))
                                : false;
                if (!contract || topLevelContract) return parsed;
                addCandidate(parsed);
            } catch (_) { /* scan embedded JSON */ }

            // A reasoning response may contain several valid JSON objects: an
            // example or echoed evidence first, and the actual answer last.
            // Collect every balanced candidate, then choose by the contract the
            // caller requested instead of blindly accepting the first object.
            for (let start = 0; start < cleaned.length; start += 1) {
                const opening = cleaned[start];
                if (opening !== '{' && opening !== '[') continue;
                const stack = [opening];
                let inString = false;
                let escaped = false;
                for (let index = start + 1; index < cleaned.length; index += 1) {
                    const char = cleaned[index];
                    if (inString) {
                        if (escaped) escaped = false;
                        else if (char === '\\') escaped = true;
                        else if (char === '"') inString = false;
                        continue;
                    }
                    if (char === '"') { inString = true; continue; }
                    if (char === '{' || char === '[') stack.push(char);
                    else if (char === '}' || char === ']') {
                        const expected = char === '}' ? '{' : '[';
                        if (stack[stack.length - 1] !== expected) break;
                        stack.pop();
                        if (!stack.length) {
                            try { addCandidate(JSON.parse(cleaned.slice(start, index + 1))); } catch (_) { /* try the next opening */ }
                            break;
                        }
                    }
                }
            }
        }
        // Delta responses are often cut immediately after a complete
        // stateDelta when the provider spends part of the output budget on
        // hidden reasoning. Recover only complete object/array boundaries;
        // never keep a half-written collection operation.
        const repairedCandidate = cleaned && ['state','evidence','delta'].includes(contract)
            ? repairTruncatedJson(cleaned, contract)
            : null;
        if (repairedCandidate) addCandidate(repairedCandidate);
        // Add the complete lenient parse after a truncation candidate so an
        // equally valid but more complete repaired envelope wins the existing
        // later-candidate tie break (for example it retains actualChanges).
        const lenientCandidate = cleaned ? parseLenientJsonObject(cleaned) : null;
        if (lenientCandidate) addCandidate(lenientCandidate);
        if (!candidates.length) throw new Error('Planner 返回的不是有效 JSON');
        if (!contract) return candidates[0];
        let best = null;
        let bestScore = 0;
        candidates.forEach((candidate) => {
            const score = contractScore(candidate, contract);
            // Prefer the later candidate on ties: reasoning/examples usually
            // precede the model's final answer.
            if (score >= bestScore && score > 0) { best = candidate; bestScore = score; }
        });
        // Providers sometimes return every inner card correctly but omit only
        // the final array/object closers. Recover complete module boundaries
        // locally before reporting dozens of unrelated inner JSON objects. Do
        // this even when an earlier, tiny evidence example was balanced: the
        // previous early return selected that example and discarded the later
        // real answer merely because its final closers were truncated.
        // This is deterministic and never spends another API call.
        if (repairedCandidate) {
            const repaired = repairedCandidate;
            if (repaired) {
                const repairedScore = contractScore(repaired, contract);
                if (!best || repairedScore > bestScore || (repairedScore === bestScore && contractRichness(repaired, contract) > contractRichness(best, contract))) return repaired;
            }
        }
        if (best) return best;
        const roots = [...new Set(candidates.flatMap((candidate) => Object.keys(candidate || {}).slice(0, 8)))].slice(0, 12);
        throw new Error(`Planner 返回了 ${candidates.length} 个 JSON，但没有找到${contractLabel(contract)}${roots.length ? `；检测到根字段：${roots.join('、')}` : ''}`);
    }
    function repairTruncatedJson(value, contract = 'state') {
        const cleaned = String(value || '').trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/\s*```$/, '');
        let best = null;
        let bestLength = -1;
        for (let start = 0; start < cleaned.length; start += 1) {
            if (cleaned[start] !== '{') continue;
            const stack = [];
            const checkpoints = [];
            let inString = false;
            let escaped = false;
            let invalid = false;
            for (let index = start; index < cleaned.length; index += 1) {
                const char = cleaned[index];
                if (inString) {
                    if (escaped) escaped = false;
                    else if (char === '\\') escaped = true;
                    else if (char === '"') inString = false;
                    continue;
                }
                if (char === '"') { inString = true; continue; }
                if (char === '{') stack.push('}');
                else if (char === '[') stack.push(']');
                else if (char === '}' || char === ']') {
                    if (stack.at(-1) !== char) { invalid = true; break; }
                    stack.pop();
                    if (stack.length <= 1) checkpoints.push({ end: index + 1, closers: [...stack] });
                    if (!stack.length) break;
                } else if (char === ',' && stack.length <= 2) {
                    // Recover only at a whole root/state-module boundary. A
                    // deeper comma could retain a semantically half-built item.
                    checkpoints.push({ end: index, closers: [...stack] });
                }
            }
            if (invalid) continue;
            for (let index = checkpoints.length - 1; index >= 0; index -= 1) {
                const checkpoint = checkpoints[index];
                const candidateText = `${cleaned.slice(start, checkpoint.end).trimEnd()}${checkpoint.closers.slice().reverse().join('')}`;
                try {
                    const candidate = JSON.parse(candidateText);
                    if (contractScore(candidate, contract) <= 0) continue;
                    if (candidateText.length > bestLength) { best = candidate; bestLength = candidateText.length; }
                    break;
                } catch (_) { /* try the previous safe module boundary */ }
            }
        }
        return best;
    }
    function contentText(value) {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.map((item) => contentText(item)).filter(Boolean).join('\n');
        if (value && typeof value === 'object') return contentText(value.text ?? value.content ?? value.output_text ?? '');
        return '';
    }
    function responseText(data) {
        return contentText(data?.choices?.[0]?.message?.content)
            || contentText(data?.choices?.[0]?.text)
            || contentText(data?.output_text)
            || contentText(data?.output)
            || contentText(data?.content);
    }
    function sseContent(event) {
        const choice = event?.choices?.[0] || {};
        const type = String(event?.type || ''), deltaType = String(event?.delta?.type || '');
        return contentText(choice?.delta?.content) || contentText(choice?.message?.content)
            || contentText(choice?.text) || contentText(event?.output_text)
            || (type === 'response.output_text.delta' ? contentText(event?.delta) : '')
            || (type === 'content_block_delta' && !/thinking|reasoning/i.test(deltaType) ? contentText(event?.delta?.text) : '')
            || contentText(event?.delta?.content);
    }
    // Scan each new character once. Retain only the current JSON frame until
    // it closes, rather than repeatedly parsing the accumulated response.
    function jsonFrames(onFrame) {
        let depth = 0, quoted = false, escaped = false, pieces = [];
        return text => {
            let start = depth ? 0 : -1;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if (!depth) {
                    if (char === '{' || char === '[') { start = i; depth = 1; }
                    continue;
                }
                if (quoted) {
                    if (escaped) escaped = false;
                    else if (char === '\\') escaped = true;
                    else if (char === '"') quoted = false;
                    continue;
                }
                if (char === '"') quoted = true;
                else if (char === '{' || char === '[') depth++;
                else if (char === '}' || char === ']') {
                    if (--depth === 0) {
                        pieces.push(text.slice(start,i+1));
                        onFrame(pieces.join(''));
                        pieces = []; start = -1;
                    }
                }
            }
            if (depth && start >= 0) pieces.push(text.slice(start));
        };
    }
    function sseReasoningText(event) {
        const eventType = String(event?.type || '');
        const deltaType = String(event?.delta?.type || '');
        return contentText(event?.choices?.[0]?.delta?.reasoning_content ?? event?.choices?.[0]?.delta?.reasoning
            ?? (eventType.includes('reasoning') || eventType.includes('thinking') || /thinking|reasoning/i.test(deltaType) ? event?.delta?.thinking ?? event?.delta : ''));
    }
    function parseSseResponse(raw, interrupted = false) {
        const chunks = [];
        let finishReason = '';
        let reasoningChars = 0;
        let usage;
        let errorEnvelope = null;
        String(raw || '').split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            try {
                const event = JSON.parse(payload);
                if (event.usage) usage = event.usage;
                if (event?.error && !errorEnvelope) errorEnvelope = event;
                if (String(event?.type || '') === 'response.failed' && !errorEnvelope) {
                    errorEnvelope = { error: event?.response?.error || event?.error || { message: 'Responses API reported failure' } };
                }
                const choice = event?.choices?.[0] || {};
                const eventType = String(event?.type || '');
                reasoningChars += sseReasoningText(event).length;
                const text = sseContent(event);
                if (text) chunks.push(text);
                if (choice?.finish_reason) finishReason = String(choice.finish_reason);
                else if (['response.completed','message_stop','message_delta'].includes(eventType)) finishReason = String(event?.delta?.stop_reason || event?.response?.status || 'stop');
            } catch (_) { /* Ignore comments and incomplete trailing SSE lines. */ }
        });
        if (errorEnvelope) return errorEnvelope;
        return { choices: [{ message: { content: chunks.join('') }, finish_reason: finishReason }], usage, reasoningChars, streamInterrupted: interrupted };
    }
    async function readForwardedResponse(response, streaming, meta = {}) {
        if (!streaming || typeof response?.body?.getReader !== 'function' || typeof TextDecoder === 'undefined') {
            return { raw: await awaitWithSignal(response.text(), meta.signal), interrupted: false };
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const rawChunks = [], visibleChunks = [];
        let receivedChars = 0, lastReported = 0, lastReportAt = 0;
        let complete = false, receiptSeen = false;
        const sentences = jsonFrames(frame => {
            const parsed = parseSentenceLines(frame);
            if (parsed.end) receiptSeen = true;
            if (!parsed.invalid && parsed.facts.length) meta.onSentence?.(parsed.facts);
        });
        const consumeEvent = frame => {
            if (frame === '[DONE]') { complete = true; return; }
            try {
                const event = JSON.parse(frame);
                if (event.error || event.choices?.some(choice => (choice.index ?? 0) === 0 && choice.finish_reason)
                    || ['response.completed','response.failed','message_stop'].includes(String(event.type || ''))) complete = true;
                const text = sseContent(event);
                if (text) meta.onVisible?.(text.length);
                const reasoning = sseReasoningText(event);
                if (reasoning) meta.onReasoning?.(reasoning.length);
                if (text || reasoning) meta.onActivity?.(text ? 'text' : 'reasoning');
                if (meta.jsonContract === 'sentences') {
                    if (text) { visibleChunks.push(text); sentences(text); }
                }
            } catch (_) { /* Only a complete, valid SSE envelope supplies text. */ }
        };
        let prefix = '', lineMode = 'prefix', eventFrames = jsonFrames(consumeEvent);
        const consumeFragment = fragment => {
            let offset = 0;
            if (lineMode === 'prefix') {
                for (; offset < fragment.length; offset++) {
                    const char = fragment[offset];
                    prefix += char;
                    if (char === ':') { lineMode = prefix.trim() === 'data:' ? 'data' : 'ignore'; offset++; break; }
                    if (prefix.trim().length > 5) { lineMode = 'ignore'; break; }
                }
            }
            if (lineMode === 'data') eventFrames(fragment.slice(offset));
        };
        try {
            while (true) {
                const { value, done } = await awaitWithSignal(reader.read(), meta.signal);
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                meta.onPacket?.(text.length);
                rawChunks.push(text); receivedChars += text.length;
                receiptSeen = false;
                const fragments = text.split('\n');
                for (let i = 0; i < fragments.length; i++) {
                    consumeFragment(fragments[i]);
                    if (i < fragments.length - 1) { prefix = ''; lineMode = 'prefix'; eventFrames = jsonFrames(consumeEvent); }
                }
                // Validate the full protocol only when a new complete receipt
                // arrives, never on every token or on an SSE id containing "end".
                if (!complete && receiptSeen && parseSentenceLines(visibleChunks.join('')).end) complete = true;
                if (complete) {
                    return { raw:rawChunks.join(''), interrupted: false };
                }
                if (receivedChars - lastReported >= 1000 && Date.now() - lastReportAt >= 250) {
                    lastReported = receivedChars; lastReportAt = Date.now();
                    if (meta.reportProgress) meta.reportProgress();
                    else WSM.Engine?.reportProgress?.('正在流式接收响应', 'running', `任务 ${meta.task || 'unknown'} · 已接收约 ${receivedChars} 字 · 仍是同一次 API`);
                }
            }
            rawChunks.push(decoder.decode());
            return { raw:rawChunks.join(''), interrupted: false };
        } catch (error) {
            const raw = rawChunks.join('');
            if (!raw.trim()) throw error;
            const interruptionReason = typeof meta.interruptionReason === 'function' ? meta.interruptionReason() : 'upstream';
            if (interruptionReason === 'cancelled') throw error;
            console.warn('[WorldStateMachine] 流式连接中断', { task: meta.task, receivedChars: raw.length, interruptionReason, reason: String(error?.message || error) });
            return { raw, interrupted: true, interruptionReason };
        } finally {
            // Do not depend on fetch abort propagation or await a hung cancel.
            try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) { /* already closed */ }
        }
    }
    function providerResponseError(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data) || data?.choices?.length) return '';
        if (!data.error && !data.quota_error && !data.message) return '';
        const values = [data.error?.message, data.error, data.quota_error?.message, data.quota_error, data.message];
        for (const value of values) {
            if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500);
            if (value && typeof value === 'object') {
                const nested = contentText(value.message ?? value.detail ?? value.error ?? '');
                if (nested) return nested.slice(0, 500);
            }
        }
        return '接口返回了错误对象';
    }
    function systemPrompt(basePrompt, jailbreakPrompt) {
        const custom = String(jailbreakPrompt || '').trim();
        if (!custom) return String(basePrompt || '');
        return `${String(basePrompt || '')}\n\n[用户自定义附加指令]\n${custom}`;
    }
    function awaitWithSignal(promise, signal) {
        if (!signal) return promise;
        if (signal.aborted) return Promise.reject(Object.assign(new Error('请求已取消'), { name: 'AbortError' }));
        return new Promise((resolve, reject) => {
            const abort = () => reject(Object.assign(new Error('请求已取消'), { name: 'AbortError' }));
            signal.addEventListener('abort', abort, { once: true });
            Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        });
    }
    function isGptReasoningModel(model) {
        // Only alter parameters for an unambiguous official-style model id.
        // Provider labels such as "[按次]gpt-5.5" are routing aliases and have
        // already succeeded with ordinary max_tokens; forcing official GPT
        // parameters on an alias can make the proxy reject or time out.
        return /(?:^|\/)(?:gpt-5(?:[.-]|$)|o[134](?:[.-]|$))/i.test(String(model || ''));
    }
    function isRetryable(error) {
        const message = String(error?.message || error || '');
        return /gateway\s*time-?out|request\s*time-?out|请求超时|\b(?:502|503|504)\b|no message generated|返回了空内容|不是有效 JSON/i.test(message);
    }
    function isQuotaReservationError(error) {
        const message = String(error?.message || error || '');
        return /insufficient[_\s-]*(?:user[_\s-]*)?quota|预扣费额度失败|用户剩余额度|余额不足/i.test(message);
    }
    function quotaTokenBudgets(requested) {
        const maximum = Math.max(256, Math.round(Number(requested) || 5000));
        return [...new Set([maximum, 2048, 1024, 512].filter((value) => value <= maximum))];
    }
    function friendlyTavernError(error) {
        const message = String(error?.message || error || '未知错误').trim();
        if (/^(?:forbidden|access denied)$/i.test(message) || /\b403\b/.test(message)) {
            return new Error('酒馆默认 API 拒绝了请求（Forbidden/403）。当前资料可能触发所选模型或反代的内容策略，或该连接没有调用权限；请更换酒馆模型，或在插件 API 设置中改用可读取这些资料的独立 Planner API。');
        }
        return error instanceof Error ? error : new Error(message);
    }
    function structuredJsonSchema(contract = '') {
        const arrayProperty = { type: 'array', items: {} };
        const evidenceKeys = [
            'sourceRefs','canon','worldRules','chronology','timeline','anchors','resourceConstraints','organizations','characters',
            'npcActivities','relationships','knowledge','schedules','locations','tasks','events','triggers','threads','processes',
            'causal','progression','currentScene','uncertainties','matchedRules','derivedFacts','conflicts','staleStates',
            'actorFeasibility','causalCandidates','moduleCoverage','moduleDecisions',
        ];
        const value = contract === 'evidence' ? {
            type: 'object',
            properties: {
                evidence: {
                    type: 'object',
                    properties: Object.fromEntries(evidenceKeys.map((key) => [key, arrayProperty])),
                    required: evidenceKeys,
                    additionalProperties: true,
                },
            },
            required: ['evidence'],
            additionalProperties: true,
        } : contract === 'delta' ? {
            type: 'object',
            properties: {
                stateDelta: {
                    type: 'object',
                    properties: {
                        statePatch: {
                            type: 'object',
                            properties: Object.fromEntries(STATE_ROOT_KEYS.map((key) => [key, {}])),
                            additionalProperties: true,
                        },
                        collectionOps: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    module: { type: 'string' },
                                    op: { type: 'string' },
                                    id: { type: 'string' },
                                    value: {},
                                },
                                required: ['module','op','id'],
                                additionalProperties: true,
                            },
                        },
                    },
                    required: ['statePatch','collectionOps'],
                    additionalProperties: true,
                },
                timelineEntry: { type: 'object', additionalProperties: true },
                actualChanges: { type: 'array', maxItems: 6, items: {} },
            },
            required: ['stateDelta','actualChanges'],
            additionalProperties: true,
        } : { type: 'object', additionalProperties: true };
        return {
            name: 'world_state_machine_result',
            description: 'World State Machine JSON result',
            strict: false,
            returnInvalid: true,
            value,
        };
    }
    function tuneTavernGptRequest(context, messages, settings = {}) {
        const eventName = context?.eventTypes?.CHAT_COMPLETION_SETTINGS_READY;
        const eventSource = context?.eventSource;
        if (!eventName || typeof eventSource?.on !== 'function') return () => {};
        const marker = String(messages?.[1]?.content || '').slice(0, 200);
        const handler = (data) => {
            const ownsRequest = (Array.isArray(data?.messages) ? data.messages : []).some((message) => String(message?.content || '').includes(marker));
            const actualModel = String(data?.model || settings.model || '');
            const gptModeAlias = settings.gptMode === true && /gpt/i.test(actualModel);
            const supportsReasoningControl = /gemini|gpt-5|(?:^|[\s/\]])o[134](?:[.\/-]|$)|claude/i.test(actualModel);
            const taskReasoningEffort = String(settings.taskReasoningEffort || '').trim();
            if (!marker || !ownsRequest || !supportsReasoningControl || (!taskReasoningEffort && !isGptReasoningModel(data?.model) && !gptModeAlias)) return;
            // Internal state updates need reliable JSON, not lengthy hidden reasoning.
            // This hook also covers Gemini requests made through generateRaw.
            // options.reasoningEffort used to be lost on that path, so the
            // client's high/default thinking level consumed almost the entire
            // output budget before the JSON body began.
            data.reasoning_effort = taskReasoningEffort || 'low';
            data.include_reasoning = false;
            data.verbosity = 'low';
        };
        eventSource.on(eventName, handler);
        return () => eventSource.removeListener?.(eventName, handler);
    }
    function attemptSignal(parentSignal, timeoutMs, streaming = false, progressTimeout = false) {
        const controller = new AbortController();
        let abortReason = '';
        let timeoutKind = '';
        let timer;
        const startedAt = Date.now();
        const firstTextTimeoutMs = Math.min(timeoutMs, 180000);
        const idleTimeoutMs = Math.min(timeoutMs, progressTimeout ? 120000 : 60000);
        let textSeen = false, lastActivityAt = null;
        const abort = () => {
            if (controller.signal.aborted) return;
            abortReason = 'cancelled';
            controller.abort();
        };
        if (parentSignal?.aborted) {
            abortReason = 'cancelled';
            controller.abort();
        }
        else parentSignal?.addEventListener?.('abort', abort, { once: true });
        const armTimeout = () => {
            window.clearTimeout(timer);
            if (controller.signal.aborted) return;
            const deadlines = progressTimeout && streaming ? [] : [{at:startedAt + timeoutMs, kind:'total'}];
            if (streaming && !textSeen) deadlines.push({at:(progressTimeout ? lastActivityAt ?? startedAt : startedAt) + firstTextTimeoutMs, kind:'first_text'});
            // Before the first text, providers may pause between reasoning and
            // visible output. Give that phase its full first-text allowance;
            // an early reasoning fragment must not shorten it to 60 seconds.
            if (streaming && textSeen && lastActivityAt !== null) deadlines.push({at:lastActivityAt + idleTimeoutMs, kind:'idle'});
            const deadline = deadlines.reduce((a,b) => a.at <= b.at ? a : b);
            timer = window.setTimeout(() => {
                abortReason = 'timeout';
                timeoutKind = deadline.kind;
                controller.abort();
            }, Math.max(0, deadline.at - Date.now()));
        };
        armTimeout();
        return {
            signal: controller.signal,
            reason: () => abortReason || 'upstream',
            timeoutKind: () => timeoutKind,
            firstTextTimeoutMs, idleTimeoutMs, progressTimeout,
            touch: kind => {
                if (controller.signal.aborted) return;
                lastActivityAt = Date.now();
                if (kind === 'text') textSeen = true;
                armTimeout();
            },
            cleanup() {
                window.clearTimeout(timer);
                parentSignal?.removeEventListener?.('abort', abort);
            },
        };
    }
    function outputTokens(settings, options = {}) {
        const configured = Math.max(256, Number(settings.maxTokens ?? 9000) || 9000);
        const taskLimit = Math.max(256, Number(options.maxTokens ?? configured) || configured);
        // A task-level value is a ceiling, never permission to override the
        // user's configured output budget. The previous implementation forced
        // request B to 8000 even when Settings said 5000, causing pay-per-call
        // proxies to return quota_error immediately after request A succeeded.
        const requested = Math.min(configured, taskLimit);
        // This is an output budget, not an input-reading limit. Extremely large
        // values make providers reserve an impossible generation and can cause
        // a timeout before the first token is emitted.
        return Math.max(256, Math.min(16384, Number.isFinite(requested) ? Math.round(requested) : 5000));
    }
    async function tavernAttempt(context, messages, settings, parentSignal, timeoutMs, structured = false, jsonContract = '') {
        const removeTuning = tuneTavernGptRequest(context, messages, settings);
        const attempt = attemptSignal(parentSignal, timeoutMs);
        try {
            return await awaitWithSignal(context.generateRaw({
                prompt: messages,
                responseLength: Number(settings.maxTokens || 5000),
                trimNames: false,
                ...(structured ? { jsonSchema: structuredJsonSchema(jsonContract) } : {}),
            }), attempt.signal);
        } catch (error) {
            if (error?.name === 'AbortError' && !parentSignal?.aborted) throw new Error(`Planner API 单次请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
            throw error;
        } finally {
            attempt.cleanup();
            removeTuning();
        }
    }
    async function tavernAttemptWithQuotaBackoff(context, messages, settings, parentSignal, timeoutMs, structured, meta = {}) {
        const budgets = quotaTokenBudgets(settings.maxTokens);
        let lastError;
        for (let index = 0; index < budgets.length; index += 1) {
            const maxTokens = budgets[index];
            try {
                const content = await tavernAttempt(context, messages, { ...settings, maxTokens }, parentSignal, timeoutMs, structured, meta.jsonContract || '');
                return { content, maxTokens };
            } catch (error) {
                lastError = error;
                const next = budgets[index + 1];
                if (!next || !isQuotaReservationError(error) || parentSignal?.aborted) throw error;
                console.warn('[WorldStateMachine] 默认 API 预扣费额度不足，降低本次输出预算重试', {
                    task: meta.task || 'unknown', previousMaxTokens: maxTokens, nextMaxTokens: next,
                });
                WSM.Engine?.reportProgress?.('API 额度不足，正在降低输出预算重试', 'running', `任务 ${meta.task || 'unknown'} · ${maxTokens} → ${next} Tokens`);
            }
        }
        throw lastError;
    }
    async function completeViaTavern(messages, settings, signal, timeoutMs, meta = {}, singleAttempt = false, jsonContract = '') {
        const context = window.SillyTavern?.getContext?.();
        if (typeof context?.generateRaw !== 'function') {
            throw new Error('当前 SillyTavern 版本不支持默认 API 调用，请更新酒馆或关闭“使用酒馆默认 API”');
        }
        const startedAt = Date.now();
        let effectiveMaxTokens = Number(settings.maxTokens || 5000);
        try {
            // Evidence and delta calls deliberately receive ordinary JSON text
            // and validate it locally. Gemini and several compatible gateways
            // compile jsonSchema into a constrained-decoding state machine and
            // can reject even a compact delta schema with HTTP 400 "too many
            // states" before generation begins. Prompt-enforced JSON avoids that
            // provider-specific setup cost without changing the one-call contract.
            // JSONL fact streams must remain ordinary text. Wrapping them in a
            // root-object schema recreates the giant-JSON failure mode that the
            // stream transport is specifically designed to avoid.
            const useStructuredGeneration = !['evidence', 'delta', 'facts', 'sentences'].includes(jsonContract);
            const firstAttempt = singleAttempt
                ? { content: await tavernAttempt(context, messages, settings, signal, timeoutMs, useStructuredGeneration, jsonContract), maxTokens: effectiveMaxTokens }
                : await tavernAttemptWithQuotaBackoff(context, messages, settings, signal, timeoutMs, useStructuredGeneration, { ...meta, jsonContract });
            effectiveMaxTokens = firstAttempt.maxTokens;
            const content = firstAttempt.content;
            if (!String(content || '').trim()) throw new Error('酒馆默认 API 返回了空内容');
            return extractJson(content, { jsonContract });
        } catch (error) {
            if (singleAttempt) throw friendlyTavernError(error);
            if (!isRetryable(error) || signal?.aborted) throw friendlyTavernError(error);
            const reason = String(error?.message || error || '未知错误').slice(0, 300);
            const elapsed = Date.now() - startedAt;
            console.warn('[WorldStateMachine] 默认 API 结构化请求失败，切换兼容 JSON 模式重试', { ...meta, elapsedMs: elapsed, reason }, error);
            WSM.Engine?.reportProgress?.('结构化请求失败，正在切换兼容模式', 'running', `任务 ${meta.task || 'unknown'} · ${reason} · 输入 ${meta.inputChars || 0} 字 · 已等待 ${Math.round(elapsed / 1000)} 秒`);
            // The retry receives a fresh timeout budget instead of inheriting
            // whatever little time the first gateway used up. Some ST/provider
            // combinations return 502 when jsonSchema is present, so retry with
            // prompt-enforced JSON instead of repeating an unsupported option.
            try {
                const compatibleSettings = { ...settings, maxTokens: Math.min(Number(settings.maxTokens || 5000), effectiveMaxTokens) };
                const content = (await tavernAttemptWithQuotaBackoff(context, messages, compatibleSettings, signal, timeoutMs, false, meta)).content;
                if (!String(content || '').trim()) throw new Error('酒馆默认 API 兼容模式仍返回空内容');
                return extractJson(content, { jsonContract });
            } catch (retryError) {
                const retryReason = String(friendlyTavernError(retryError)?.message || retryError || '未知错误').slice(0, 300);
                throw new Error(`任务 ${meta.task || 'unknown'} 最终失败：结构化请求 ${reason}；兼容请求 ${retryReason}；输入 ${meta.inputChars || 0} 字`);
            }
        }
    }
    async function complete(system, payload, options = {}) {
        const callBudget = consumeCallBudget(options);
        const settings = WSM.Settings.get();
        // Full initialization may legitimately need several minutes, while an
        // ordinary one-turn delta must never leave a modal hanging that long.
        // A task-level timeout is therefore allowed to be shorter than the
        // legacy 180-second initialization floor.
        const taskTimeout = Number(options.timeoutMs || 0);
        const timeoutMs = taskTimeout > 0
            ? Math.max(5000, taskTimeout)
            : Math.max(180000, Number(settings.timeoutMs || 0));
        const maxTokens = outputTokens(settings, options);
        const requestSettings = Object.assign({}, settings, {
            maxTokens,
            taskReasoningEffort: options.reasoningEffort || '',
        });
        const messages = [
            { role: 'system', content: systemPrompt(system, options.omitJailbreak === true ? '' : settings.jailbreakPrompt) },
            { role: 'user', content: JSON.stringify(payload) },
        ];
        const meta = {
            task: String(payload?.task || payload?.phase || 'completion'),
            stage: payload?.sourceBatchIndex || 0,
            inputChars: messages.reduce((sum, message) => sum + String(message.content || '').length, 0),
            maxTokens,
        };
        const requestStartedAt = Date.now();
        const inputWorldbooks = Array.isArray(payload?.source?.worldbooks) ? payload.source.worldbooks
            : Array.isArray(payload?.worldbooks) ? payload.worldbooks : [];
        const inputWorldbookEntries = inputWorldbooks.flatMap(book => Array.isArray(book.entries) ? book.entries : [book]);
        const diagnostic = {startedAt:requestStartedAt, task:/^[A-Z_]+$/.test(meta.task) ? meta.task : 'OTHER',
            route:'pending', inputChars:meta.inputChars, maxTokens, stream:options.stream === true,
            firstPacketMs:null, firstTextMs:null, receivedChars:0, streamedTextChars:0,
            lastPacketMs:null, lastActivityMs:null, timeoutKind:'', timeoutMs,
            worldbookBooks:new Set(inputWorldbooks.filter(book => !Array.isArray(book.entries) || book.entries.length)
                .map(book => book.name ?? book.book)).size,
            worldbookEntries:inputWorldbookEntries.length,
            worldbookChars:inputWorldbookEntries.reduce((sum,entry) => sum + String(entry.text ?? entry.content ?? '').length,0),
            visibleChars:null, reasoningChars:null, outputTokens:null, reasoningTokens:null,
            httpStatus:null, finishReason:'', ended:null, interrupted:false, failure:'', outcome:'running', durationMs:null,
            reasoningEffort:options.reasoningEffort || '', continuationAttempt:Number(options.continuationAttempt || 0),
            timeoutPolicy:options.progressTimeout === true ? 'activity' : 'fixed'};
        requestDiagnostics.push(diagnostic);
        if (requestDiagnostics.length > 6) requestDiagnostics.shift();
        const finish = value => {
            diagnostic.ended = value?.factStream ? value.factStream.end === true : null;
            diagnostic.outcome = diagnostic.ended === false ? 'partial' : 'received';
            return value;
        };
        const requestIdentity = `运行 v${WSM.version || '未知'} · 请求 ${new Date(requestStartedAt).toISOString()} · 配置 ${settings.maxTokens ?? 9000} / 本次 ${maxTokens} Tokens`;
        const headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
        const body = {
            model: settings.model,
            temperature: Number(settings.temperature ?? 0.15),
            max_tokens: maxTokens,
            stream: options.stream === true,
            messages,
        };
        if (options.reasoningEffort) {
            // Some OpenAI-compatible routing aliases (for example labels with
            // billing prefixes) still forward reasoning_effort even though
            // their model id is not an official OpenAI id. Keep max_tokens for
            // alias compatibility, but suppress sampling and lengthy hidden
            // reasoning for bounded internal state tasks.
            body.reasoning_effort = String(options.reasoningEffort);
            if (!/gemini/i.test(String(body.model || ''))) {
                body.verbosity = 'low';
                delete body.temperature;
            }
        }
        if (!body.model) delete body.model;
        if (isGptReasoningModel(body.model)) {
            body.max_completion_tokens = body.max_tokens;
            body.reasoning_effort = 'low';
            body.verbosity = 'low';
            delete body.max_tokens;
            delete body.temperature;
        }
        try {
            const useTavern = settings.useTavernApi !== false && options.forceExternal !== true;
            const tavernBody = useTavern && options.stream === true
                ? await prepareTavernStreamBody(window.SillyTavern?.getContext?.(), messages, requestSettings)
                : null;
            diagnostic.route = useTavern ? (tavernBody ? 'tavern-stream' : 'tavern-native') : 'independent';
            if (useTavern && !tavernBody) {
                diagnostic.timeoutPolicy = 'fixed'; // This adapter exposes no streaming activity callbacks.
                return finish(await completeViaTavern(messages, requestSettings, options.signal, timeoutMs, meta, options.singleAttempt === true, options.jsonContract));
            }
            const attempt = attemptSignal(options.signal, timeoutMs, options.stream === true, options.progressTimeout === true);
            if (options.stream === true) Object.assign(diagnostic, {firstTextTimeoutMs:attempt.firstTextTimeoutMs, idleTimeoutMs:attempt.idleTimeoutMs});
            const reportStreamProgress = () => {
                const elapsed = Date.now() - requestStartedAt;
                const silence = elapsed - (diagnostic.lastActivityMs ?? 0);
                const title = diagnostic.firstTextMs !== null ? '正在接收正文'
                    : diagnostic.reasoningChars > 0 ? '模型正在推理，尚未输出正文'
                    : diagnostic.httpStatus === null ? '正在等待 API 响应' : '已连接，等待模型正文';
                WSM.Engine?.reportProgress?.(title, 'running',
                    `任务 ${meta.task} · 输入世界书 ${diagnostic.worldbookEntries} 条 / ${diagnostic.worldbookChars} 字 · 已等待 ${Math.floor(elapsed/1000)} 秒 · 正文 ${diagnostic.streamedTextChars} 字 / 推理 ${diagnostic.reasoningChars || 0} 字 · ${Math.floor(silence/1000)} 秒无新增内容 · ${diagnostic.firstTextMs === null ? `${attempt.progressTimeout ? '首正文前静默' : '首正文'}上限 ${Math.round(attempt.firstTextTimeoutMs/1000)} 秒（正文到达后启用停流计时） · ` : `停流上限 ${Math.round(attempt.idleTimeoutMs/1000)} 秒 · `}${attempt.progressTimeout ? '有正文或推理进展时持续接收' : `总上限 ${Math.round(timeoutMs/1000)} 秒`} · 同一次 API`, {replaceCurrent:true});
            };
            const progressTimer = options.stream === true ? window.setInterval(reportStreamProgress, 1000) : null;
            let response;
            let raw;
            let streamInterrupted = false;
            try {
                // Browser-to-provider requests frequently fail with CORS or a
                // connection reset before the model sees a large prompt. Route
                // custom OpenAI-compatible profiles through ST's local backend,
                // exactly as ST does for its own chat-completion requests.
                // Never retry by falling back to a direct request: the proxy may
                // already have reached the provider and a fallback could charge
                // the user twice.
                const proxyBody = tavernBody || {
                    ...body,
                    chat_completion_source: 'openai',
                    reverse_proxy: endpointBase(settings.endpoint),
                    proxy_password: settings.apiKey || '',
                };
                // Do not attach json_schema for the frequent post-generation
                // delta. The prompt already defines the exact envelope and the
                // local parser validates/repairs complete JSON boundaries. This
                // is substantially faster and avoids Gemini's schema-state 400.
                if (!tavernBody && body.reasoning_effort) {
                    // ST's OpenAI branch drops reasoning_effort for aliases
                    // outside its official-model allowlist. Its supported
                    // custom adapter forwards these fields to the SAME endpoint.
                    proxyBody.chat_completion_source = 'custom';
                    proxyBody.custom_url = endpointBase(settings.endpoint);
                    proxyBody.custom_include_headers = JSON.stringify({ Authorization: `Bearer ${settings.apiKey || ''}` });
                    proxyBody.custom_include_body = JSON.stringify({ reasoning_effort: body.reasoning_effort, ...(body.verbosity ? { verbosity: body.verbosity } : {}) });
                    delete proxyBody.reverse_proxy;
                    delete proxyBody.proxy_password;
                }
                meta.model = proxyBody.model;
                const proxyHeaders = await awaitWithSignal(requestHeaders(), attempt.signal);
                attempt.signal.throwIfAborted();
                response = await awaitWithSignal(fetch('/api/backends/chat-completions/generate', {
                    method: 'POST', headers: proxyHeaders, body: JSON.stringify(proxyBody), signal: attempt.signal,
                }), attempt.signal);
                diagnostic.httpStatus = response.status;
                const forwarded = await readForwardedResponse(response, options.stream === true, { ...meta,
                    onPacket:chars => { diagnostic.lastPacketMs = Date.now()-requestStartedAt; diagnostic.firstPacketMs ??= diagnostic.lastPacketMs; diagnostic.receivedChars += chars; },
                    onVisible:chars => { diagnostic.firstTextMs ??= Date.now()-requestStartedAt; diagnostic.streamedTextChars += chars; diagnostic.visibleChars = diagnostic.streamedTextChars; },
                    onReasoning:chars => { diagnostic.reasoningChars = (diagnostic.reasoningChars || 0) + chars; },
                    jsonContract: options.jsonContract, signal:attempt.signal, reportProgress:reportStreamProgress,
                    onSentence:options.onSentence,
                    interruptionReason: attempt.reason, onActivity:kind => { diagnostic.lastActivityMs = Date.now()-requestStartedAt; attempt.touch(kind); } });
                raw = forwarded.raw;
                streamInterrupted = forwarded.interrupted;
                diagnostic.interrupted = streamInterrupted;
                if (streamInterrupted) diagnostic.failure = 'stream';
                meta.interruptionReason = forwarded.interruptionReason || '';
            } catch (error) {
                if (error?.name === 'AbortError') {
                    const reason = attempt.reason();
                    if (reason === 'cancelled') throw new Error(`任务 ${meta.task} 已由用户取消`);
                    if (reason === 'timeout') {
                        const detail = attempt.timeoutKind() === 'first_text' ? `${Math.round(attempt.firstTextTimeoutMs/1000)} 秒内未收到首条正文`
                            : attempt.timeoutKind() === 'idle' ? `连续 ${Math.round(attempt.idleTimeoutMs/1000)} 秒没有新增正文或推理`
                            : `单次请求达到 ${Math.round(timeoutMs/1000)} 秒总上限`;
                        throw new Error(`任务 ${meta.task} 请求超时：${detail}；本次请求已停止，不会自动重试`);
                    }
                }
                throw error;
            } finally {
                diagnostic.timeoutKind = attempt.timeoutKind();
                if (diagnostic.timeoutKind) diagnostic.failure = 'timeout';
                if (progressTimer !== null) window.clearInterval(progressTimer);
                attempt.cleanup();
            }
            if (!response.ok) throw new Error(`Planner API 后端转发失败 ${response.status}: ${raw.slice(0, 500)}`);
            let data;
            try { data = JSON.parse(raw); }
            catch (_) { data = /^\s*data:/m.test(raw) ? parseSseResponse(raw, streamInterrupted) : { output_text: raw }; }
            const finishReason = String(data?.choices?.[0]?.finish_reason || '');
            const visibleChars = responseText(data).length;
            Object.assign(diagnostic, {visibleChars, reasoningChars:diagnosticNumber(data.reasoningChars),
                outputTokens:diagnosticNumber(data.usage?.completion_tokens),
                reasoningTokens:diagnosticNumber(data.usage?.completion_tokens_details?.reasoning_tokens),
                finishReason:['stop','length','tool_calls','content_filter','max_tokens',''].includes(finishReason) ? finishReason : 'other'});
            console.info('[WorldStateMachine] 请求诊断 ' + JSON.stringify({
                ...meta, stream: options.stream === true,
                durationMs: Date.now() - requestStartedAt, finishReason,
                visibleChars, reasoningChars: data.reasoningChars || 0,
                outputTokens: data.usage?.completion_tokens ?? null,
                reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
                interrupted: streamInterrupted,
            }));
            const providerError = providerResponseError(data);
            if (providerError) throw new Error(`Planner API 拒绝了任务 ${meta.task}：${providerError}；输入 ${meta.inputChars} 字，输出上限 ${maxTokens} Tokens，流式 ${options.stream === true ? '已开启' : '未开启'}`);
            const visibleOutput = responseText(data) || '';
            const budgetExhausted = /length|max[_\s-]*tokens/i.test(finishReason);
            // A number of mobile/proxy stacks omit the final SSE marker, and
            // some providers report `length` even after closing a useful JSON
            // module. Always run the conservative local parser first. Its
            // truncation repair keeps only whole root/module boundaries; an
            // unfinished card or array is never committed.
            if (streamInterrupted || budgetExhausted) {
                try {
                    const recovered = extractJson(visibleOutput || raw, { jsonContract: options.jsonContract });
                    if (options.jsonContract === 'sentences' && recovered.factStream) {
                        recovered.factStream.end = false;
                        recovered.factStream.interruption = diagnostic.timeoutKind || (budgetExhausted ? 'output_limit' : 'stream');
                    }
                    WSM.Engine?.reportProgress?.(
                        streamInterrupted ? diagnostic.timeoutKind ? '流式等待超时，已保留完整记录' : '流式结束标记缺失，已安全接收' : '模型输出到达上限，已安全抢救',
                        'running',
                        `任务 ${meta.task} · 只保留闭合的JSON模块 · 可见输出 ${visibleOutput.length} 字 · 未额外请求API`,
                    );
                    return finish(recovered);
                } catch (_recoveryError) {
                    if (streamInterrupted) {
                        const interruptionLabel = meta.interruptionReason === 'timeout'
                            ? diagnostic.timeoutKind === 'first_text' ? '首条正文等待超时'
                                : diagnostic.timeoutKind === 'idle' ? '连续无新增正文或推理，等待超时' : '单次请求总时限已到，等待超时'
                            : meta.interruptionReason === 'cancelled' ? '用户取消' : '上游或反代断流';
                        const recordLabel = options.jsonContract === 'sentences' ? '完整JSONL记录' : '完整JSON模块';
                        throw new Error(`任务 ${meta.task} ${interruptionLabel}；已收到正文 ${visibleChars} 字，推理 ${data.reasoningChars || 0} 字，但尚未形成一个可安全保存的${recordLabel}；本批未写入，此前已保存内容保留`);
                    }
                    if (meta.task === 'SOURCE_READ_SEQUENTIAL_BATCH') throw new Error(`任务 ${meta.task} 接口明确报告输出预算耗尽；上限 ${maxTokens} Tokens，正文 ${visibleChars} 字，推理 ${data.reasoningChars || 0} 字，且未形成可安全保存的完整JSON模块；本批未写入。${requestIdentity}`);
                }
            }
            try {
                return finish(extractJson(visibleOutput || raw, { jsonContract: options.jsonContract }));
            } catch (error) {
                const finishReason = String(data?.choices?.[0]?.finish_reason || '');
                if (/length|max[_\s-]*tokens/i.test(finishReason)) {
                    const repairContract = ['state', 'evidence'].includes(options.jsonContract) ? options.jsonContract : '';
                    const repaired = repairContract ? repairTruncatedJson(visibleOutput, repairContract) : null;
                    if (repaired) {
                        WSM.Engine?.reportProgress?.('模型输出到达上限，已安全接收完整证据模块', 'running', `任务 ${meta.task} · 已丢弃尾部未闭合模块 · 本地将合并完整模块并补齐状态结构 · 可见输出 ${visibleOutput.length} 字`);
                        return finish(repaired);
                    }
                    throw new Error(`任务 ${meta.task} 输出达到上限，未形成完整的${contractLabel(options.jsonContract)}；输入 ${meta.inputChars} 字，输出上限 ${maxTokens} Tokens，可见输出 ${visibleOutput.length} 字`);
                }
                throw error;
            }
        } catch (error) {
            diagnostic.outcome = options.signal?.aborted ? 'cancelled' : 'error';
            diagnostic.failure = options.signal?.aborted ? 'cancelled'
                : /超时|timeout/i.test(String(error?.message)) ? 'timeout'
                : /failed to fetch|load failed|network/i.test(String(error?.message)) ? 'network'
                : diagnostic.httpStatus >= 400 ? 'http' : 'response_or_validation';
            if (error?.name === 'AbortError') throw new Error(`任务 ${meta.task} 请求超时或已取消；输入 ${meta.inputChars} 字，本次不会自动重试`);
            const message = String(error?.message || error || '未知网络错误');
            if (/failed to fetch|load failed|networkerror|network request failed|network connection.*lost/i.test(message)) {
                console.warn('[WorldStateMachine] 网络请求失败', {task:meta.task, durationMs:Date.now()-requestStartedAt, reason:message});
                throw new Error(`连接中断，未取得本步可用响应（${message}）。已有状态保留；本次未确认完成，不会自动重试。请检查酒馆连接及 API/反代网络。`);
            }
            throw error;
        } finally { diagnostic.durationMs = Date.now()-requestStartedAt; }
    }
    async function listModels(profile = {}) {
        const settings = Object.assign({}, WSM.Settings.get(), profile || {});
        // Use the same local backend as generation: browser CORS permissions
        // must not determine whether a working API can list its models.
        const response = await fetch('/api/backends/chat-completions/status', {
            method: 'POST', headers: await requestHeaders(),
            body: JSON.stringify({
                chat_completion_source: 'openai',
                reverse_proxy: endpointBase(settings.endpoint),
                proxy_password: settings.apiKey || '',
            }),
        });
        const raw = await response.text();
        if (!response.ok) throw new Error(`模型列表 ${response.status}: ${raw.slice(0, 500)}`);
        let data;
        try { data = JSON.parse(raw); } catch (_) { throw new Error('模型列表返回的不是有效 JSON'); }
        const providerError = providerResponseError(data);
        if (providerError) throw new Error(`模型列表接口失败：${providerError}`);
        // OpenAI-compatible providers unfortunately use several different
        // response envelopes. Collect every conventional list instead of
        // stopping at the first one, so a provider's nested `data.models` or
        // `result.items` list is not silently omitted from the picker.
        const lists = [];
        const visited = new Set();
        const collect = (value) => {
            if (!value || typeof value !== 'object' || visited.has(value)) return;
            visited.add(value);
            if (Array.isArray(value)) {
                lists.push(value);
                return;
            }
            ['data', 'models', 'items', 'result'].forEach((key) => collect(value[key]));
        };
        collect(data);
        const models = lists.flatMap((items) => items)
            .map((item) => String(typeof item === 'string' ? item : (item?.id || item?.name || item?.model || '')))
            .map((item) => item.trim())
            .filter(Boolean);
        if (!models.length) throw new Error('接口没有返回可用模型');
        return [...new Set(models)].sort((a, b) => a.localeCompare(b));
    }
    async function test(options = {}) {
        return withCallBudget(1, 'connection-test', async () => {
            const result = await complete('只输出 {"ok":true}', { task: 'connection_test' }, { stream: true, ...options, singleAttempt: true });
            return result?.ok === true;
        });
    }
    WSM.Api = { complete, test, listModels, withCallBudget, requestHeaders, getDiagnostics, recordValidation, _test: { prepareTavernStreamBody, outputTokens, quotaTokenBudgets, isQuotaReservationError, consumeCallBudget, extractJson, repairTruncatedJson, parseFactLines, parseLenientJsonObject, parseSseResponse, responseText, providerResponseError, isGptReasoningModel, contractScore } };
})();
