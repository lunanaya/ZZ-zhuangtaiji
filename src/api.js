(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

    function normalizeEndpoint(value) {
        let endpoint = String(value || '').trim().replace(/\/+$/, '');
        if (!endpoint) throw new Error('尚未设置 Planner API 地址');
        if (!/\/chat\/completions(?:\?|$)/.test(endpoint)) endpoint += '/chat/completions';
        return endpoint;
    }
    function modelsEndpoint(value) {
        const endpoint = new URL(normalizeEndpoint(value), window.location?.href || 'http://localhost/');
        endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions\/?$/, '/models');
        endpoint.search = '';
        return endpoint.href;
    }
    function extractJson(text) {
        const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        try { return JSON.parse(cleaned); } catch (_) { /* find object */ }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        throw new Error('Planner 返回的不是有效 JSON');
    }
    function responseText(data) {
        return data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.output_text ?? data?.content?.[0]?.text ?? '';
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
        return /(?:^|\/)(?:gpt-5(?:[.-]|$)|o[134](?:[.-]|$))/i.test(String(model || ''));
    }
    function isRetryable(error) {
        const message = String(error?.message || error || '');
        return /gateway\s*time-?out|request\s*time-?out|请求超时|\b(?:502|503|504)\b|no message generated|返回了空内容|不是有效 JSON/i.test(message);
    }
    function structuredJsonSchema() {
        return {
            name: 'world_state_machine_result',
            description: 'World State Machine JSON result',
            strict: false,
            returnInvalid: true,
            value: { type: 'object', additionalProperties: true },
        };
    }
    function tuneTavernGptRequest(context, messages) {
        const eventName = context?.eventTypes?.CHAT_COMPLETION_SETTINGS_READY;
        const eventSource = context?.eventSource;
        if (!eventName || typeof eventSource?.on !== 'function') return () => {};
        const marker = String(messages?.[1]?.content || '').slice(0, 200);
        const handler = (data) => {
            const ownsRequest = (Array.isArray(data?.messages) ? data.messages : []).some((message) => String(message?.content || '').includes(marker));
            if (!marker || !ownsRequest || !isGptReasoningModel(data?.model)) return;
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
        const requested = Number(options.maxTokens ?? settings.maxTokens ?? 5000);
        // This is an output budget, not an input-reading limit. Extremely large
        // values make providers reserve an impossible generation and can cause
        // a timeout before the first token is emitted.
        return Math.max(256, Math.min(16384, Number.isFinite(requested) ? Math.round(requested) : 5000));
    }
    async function tavernAttempt(context, messages, settings, parentSignal, timeoutMs, structured = false) {
        const removeTuning = tuneTavernGptRequest(context, messages);
        const attempt = attemptSignal(parentSignal, timeoutMs);
        try {
            return await awaitWithSignal(context.generateRaw({
                prompt: messages,
                responseLength: Number(settings.maxTokens || 5000),
                trimNames: false,
                ...(structured ? { jsonSchema: structuredJsonSchema() } : {}),
            }), attempt.signal);
        } catch (error) {
            if (error?.name === 'AbortError' && !parentSignal?.aborted) throw new Error(`Planner API 单次请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
            throw error;
        } finally {
            attempt.cleanup();
            removeTuning();
        }
    }
    async function completeViaTavern(messages, settings, signal, timeoutMs, meta = {}) {
        const context = window.SillyTavern?.getContext?.();
        if (typeof context?.generateRaw !== 'function') {
            throw new Error('当前 SillyTavern 版本不支持默认 API 调用，请更新酒馆或关闭“使用酒馆默认 API”');
        }
        const startedAt = Date.now();
        try {
            // State-machine calls always require JSON. Start with ST's native
            // structured generation instead of spending the first attempt on a
            // less reliable free-form JSON response.
            const content = await tavernAttempt(context, messages, settings, signal, timeoutMs, true);
            if (!String(content || '').trim()) throw new Error('酒馆默认 API 返回了空内容');
            return extractJson(content);
        } catch (error) {
            if (!isRetryable(error) || signal?.aborted) throw error;
            const reason = String(error?.message || error || '未知错误').slice(0, 300);
            const elapsed = Date.now() - startedAt;
            console.warn('[WorldStateMachine] 默认 API 结构化请求失败，切换兼容 JSON 模式重试', { ...meta, elapsedMs: elapsed, reason }, error);
            WSM.Engine?.reportProgress?.('结构化请求失败，正在切换兼容模式', 'running', `任务 ${meta.task || 'unknown'} · ${reason} · 输入 ${meta.inputChars || 0} 字 · 已等待 ${Math.round(elapsed / 1000)} 秒`);
            // The retry receives a fresh timeout budget instead of inheriting
            // whatever little time the first gateway used up. Some ST/provider
            // combinations return 502 when jsonSchema is present, so retry with
            // prompt-enforced JSON instead of repeating an unsupported option.
            try {
                const content = await tavernAttempt(context, messages, settings, signal, timeoutMs, false);
                if (!String(content || '').trim()) throw new Error('酒馆默认 API 兼容模式仍返回空内容');
                return extractJson(content);
            } catch (retryError) {
                const retryReason = String(retryError?.message || retryError || '未知错误').slice(0, 300);
                throw new Error(`任务 ${meta.task || 'unknown'} 最终失败：结构化请求 ${reason}；兼容请求 ${retryReason}；输入 ${meta.inputChars || 0} 字`);
            }
        }
    }
    async function complete(system, payload, options = {}) {
        const settings = WSM.Settings.get();
        const timeoutMs = Math.max(180000, Number(settings.timeoutMs || 0));
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
            stream: false,
            messages,
        };
        if (!body.model) delete body.model;
        if (isGptReasoningModel(body.model)) {
            body.max_completion_tokens = body.max_tokens;
            body.reasoning_effort = 'low';
            body.verbosity = 'low';
            delete body.max_tokens;
            delete body.temperature;
        }
        try {
            if (settings.useTavernApi !== false && options.forceExternal !== true) return await completeViaTavern(messages, requestSettings, options.signal, timeoutMs, meta);
            const attempt = attemptSignal(options.signal, timeoutMs);
            let response;
            let raw;
            try {
                response = await fetch(normalizeEndpoint(settings.endpoint), {
                    method: 'POST', headers, body: JSON.stringify(body), signal: attempt.signal,
                });
                raw = await response.text();
            } finally { attempt.cleanup(); }
            if (!response.ok) throw new Error(`Planner API ${response.status}: ${raw.slice(0, 500)}`);
            let data;
            try { data = JSON.parse(raw); } catch (_) { data = { output_text: raw }; }
            return extractJson(responseText(data) || raw);
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('Planner API 请求超时或已取消');
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
        const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []));
        const models = items.map((item) => String(typeof item === 'string' ? item : (item?.id || item?.name || ''))).filter(Boolean);
        if (!models.length) throw new Error('接口没有返回可用模型');
        return [...new Set(models)].sort((a, b) => a.localeCompare(b));
    }
    async function test(options = {}) {
        const result = await complete('只输出 {"ok":true}', { task: 'connection_test' }, options);
        return result?.ok === true;
    }
    WSM.Api = { complete, test, listModels, _test: { outputTokens } };
})();
