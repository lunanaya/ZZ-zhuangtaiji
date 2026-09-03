(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    let activeCallBudget = null;
    let scriptModulePromise = null;

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
        if (activeCallBudget) return operation(activeCallBudget);
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
        return '有效结果';
    }
    function extractJson(value, options = {}) {
        const contract = String(options.jsonContract || '');
        const candidates = [];
        const addCandidate = (candidate) => {
            if (candidate && typeof candidate === 'object') candidates.push(candidate);
        };
        if (value && typeof value === 'object') addCandidate(value);
        const cleaned = typeof value === 'string'
            ? String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
            : '';
        if (cleaned) {
            try { addCandidate(JSON.parse(cleaned)); } catch (_) { /* scan embedded JSON */ }

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
        if (cleaned && ['state','evidence'].includes(contract)) {
            const repaired = repairTruncatedJson(cleaned, contract);
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
            || contentText(data?.content);
    }
    function parseSseResponse(raw, interrupted = false) {
        const chunks = [];
        let finishReason = interrupted ? 'length' : '';
        let errorEnvelope = null;
        String(raw || '').split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            try {
                const event = JSON.parse(payload);
                if (event?.error && !errorEnvelope) errorEnvelope = event;
                const choice = event?.choices?.[0] || {};
                const text = contentText(choice?.delta?.content)
                    || contentText(choice?.message?.content)
                    || contentText(choice?.text)
                    || contentText(event?.output_text);
                if (text) chunks.push(text);
                if (choice?.finish_reason) finishReason = String(choice.finish_reason);
            } catch (_) { /* Ignore comments and incomplete trailing SSE lines. */ }
        });
        if (errorEnvelope && !chunks.length) return errorEnvelope;
        return { choices: [{ message: { content: chunks.join('') }, finish_reason: finishReason }] };
    }
    async function readForwardedResponse(response, streaming, meta = {}) {
        if (!streaming || typeof response?.body?.getReader !== 'function' || typeof TextDecoder === 'undefined') {
            return { raw: await response.text(), interrupted: false };
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let raw = '';
        let lastReported = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                raw += decoder.decode(value, { stream: true });
                if (raw.length - lastReported >= 1000) {
                    lastReported = raw.length;
                    WSM.Engine?.reportProgress?.('请求 B 正在流式返回证据', 'running', `任务 ${meta.task || 'unknown'} · 已接收约 ${raw.length} 字 · 仍是同一次 API`);
                }
            }
            raw += decoder.decode();
            return { raw, interrupted: false };
        } catch (error) {
            if (!raw.trim()) throw error;
            console.warn('[WorldStateMachine] 流式响应在尾部中断，尝试保留已完成证据模块', { task: meta.task, receivedChars: raw.length, reason: String(error?.message || error) });
            return { raw, interrupted: true };
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
                actualChanges: { type: 'array', items: {} },
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
            const gptModeAlias = settings.gptMode === true && /gpt/i.test(String(data?.model || settings.model || ''));
            if (!marker || !ownsRequest || (!isGptReasoningModel(data?.model) && !gptModeAlias)) return;
            // Internal state updates need reliable JSON, not lengthy hidden reasoning.
            // Keeping reasoning low prevents GPT reasoning models from exhausting the
            // reverse proxy timeout before they begin emitting the state object.
            data.reasoning_effort = 'low';
            data.verbosity = 'low';
        };
        eventSource.on(eventName, handler);
        return () => eventSource.removeListener?.(eventName, handler);
    }
    function attemptSignal(parentSignal, timeoutMs) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (parentSignal?.aborted) controller.abort();
        else parentSignal?.addEventListener?.('abort', abort, { once: true });
        const timer = window.setTimeout(abort, timeoutMs);
        return {
            signal: controller.signal,
            cleanup() {
                window.clearTimeout(timer);
                parentSignal?.removeEventListener?.('abort', abort);
            },
        };
    }
    function outputTokens(settings, options = {}) {
        const configured = Math.max(256, Number(settings.maxTokens ?? 5000) || 5000);
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
            // Source-reading calls deliberately receive the model's JSON text and
            // validate it locally. Several SillyTavern/provider combinations reject
            // the large evidence jsonSchema with HTTP 400 before the model is ever
            // called. The reader has a strict two-call budget, so an incompatible
            // structured attempt must not consume one of those calls. Smaller
            // state-update calls can still use ST's native structured generation.
            const useStructuredGeneration = jsonContract !== 'evidence';
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
        const requestSettings = Object.assign({}, settings, { maxTokens });
        const messages = [
            { role: 'system', content: systemPrompt(system, settings.jailbreakPrompt) },
            { role: 'user', content: JSON.stringify(payload) },
        ];
        const meta = {
            task: String(payload?.task || payload?.phase || 'completion'),
            inputChars: messages.reduce((sum, message) => sum + String(message.content || '').length, 0),
            maxTokens,
        };
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
            body.verbosity = 'low';
            delete body.temperature;
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
            if (settings.useTavernApi !== false && options.forceExternal !== true) return await completeViaTavern(messages, requestSettings, options.signal, timeoutMs, meta, options.singleAttempt === true || !!callBudget, options.jsonContract);
            const attempt = attemptSignal(options.signal, timeoutMs);
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
                const proxyBody = {
                    ...body,
                    chat_completion_source: 'openai',
                    reverse_proxy: endpointBase(settings.endpoint),
                    proxy_password: settings.apiKey || '',
                };
                const proxyHeaders = await requestHeaders();
                response = await fetch('/api/backends/chat-completions/generate', {
                    method: 'POST', headers: proxyHeaders, body: JSON.stringify(proxyBody), signal: attempt.signal,
                });
                const forwarded = await readForwardedResponse(response, options.stream === true, meta);
                raw = forwarded.raw;
                streamInterrupted = forwarded.interrupted;
            } finally { attempt.cleanup(); }
            if (!response.ok) throw new Error(`Planner API 后端转发失败 ${response.status}: ${raw.slice(0, 500)}`);
            let data;
            try { data = JSON.parse(raw); }
            catch (_) { data = /^\s*data:/m.test(raw) ? parseSseResponse(raw, streamInterrupted) : { output_text: raw }; }
            const providerError = providerResponseError(data);
            if (providerError) throw new Error(`Planner API 拒绝了任务 ${meta.task}：${providerError}；输入 ${meta.inputChars} 字，输出上限 ${maxTokens} Tokens，流式 ${options.stream === true ? '已开启' : '未开启'}`);
            try {
                return extractJson(responseText(data) || raw, { jsonContract: options.jsonContract });
            } catch (error) {
                const finishReason = String(data?.choices?.[0]?.finish_reason || '');
                if (/length|max[_\s-]*tokens/i.test(finishReason)) {
                    const visibleOutput = responseText(data) || '';
                    const repairContract = ['state', 'evidence'].includes(options.jsonContract) ? options.jsonContract : '';
                    const repaired = repairContract ? repairTruncatedJson(visibleOutput, repairContract) : null;
                    if (repaired) {
                        WSM.Engine?.reportProgress?.('模型输出到达上限，已安全接收完整证据模块', 'running', `任务 ${meta.task} · 已丢弃尾部未闭合模块 · 本地将合并完整模块并补齐状态结构 · 可见输出 ${visibleOutput.length} 字`);
                        return repaired;
                    }
                    throw new Error(`任务 ${meta.task} 输出达到上限，未形成完整的${contractLabel(options.jsonContract)}；输入 ${meta.inputChars} 字，输出上限 ${maxTokens} Tokens，可见输出 ${visibleOutput.length} 字`);
                }
                throw error;
            }
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error(`任务 ${meta.task} 请求超时或已取消；输入 ${meta.inputChars} 字，本次不会自动重试`);
            const message = String(error?.message || error || '未知网络错误');
            if (/failed to fetch/i.test(message)) throw new Error(`任务 ${meta.task} 无法连接酒馆后端转发接口；输入 ${meta.inputChars} 字。模型尚未返回响应，本次不会自动重试：${message}`);
            throw error;
        }
    }
    async function listModels(profile = {}) {
        const settings = Object.assign({}, WSM.Settings.get(), profile || {});
        const headers = { Accept: 'application/json' };
        if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
        const response = await fetch(modelsEndpoint(settings.endpoint), { method: 'GET', headers });
        const raw = await response.text();
        if (!response.ok) throw new Error(`模型列表 ${response.status}: ${raw.slice(0, 500)}`);
        let data;
        try { data = JSON.parse(raw); } catch (_) { throw new Error('模型列表返回的不是有效 JSON'); }
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
            const result = await complete('只输出 {"ok":true}', { task: 'connection_test' }, { ...options, singleAttempt: true });
            return result?.ok === true;
        });
    }
    WSM.Api = { complete, test, listModels, withCallBudget, requestHeaders, _test: { outputTokens, quotaTokenBudgets, isQuotaReservationError, consumeCallBudget, extractJson, repairTruncatedJson, parseSseResponse, responseText, providerResponseError, isGptReasoningModel, contractScore } };
})();
