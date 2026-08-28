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
    async function completeViaTavern(messages, settings, signal) {
        const context = window.SillyTavern?.getContext?.();
        if (typeof context?.generateRaw !== 'function') {
            throw new Error('当前 SillyTavern 版本不支持默认 API 调用，请更新酒馆或关闭“使用酒馆默认 API”');
        }
        const content = await awaitWithSignal(context.generateRaw({
            prompt: messages,
            responseLength: Number(settings.maxTokens || 5000),
        }), signal);
        if (!String(content || '').trim()) throw new Error('酒馆默认 API 返回了空内容');
        return extractJson(content);
    }
    async function complete(system, payload, options = {}) {
        const settings = WSM.Settings.get();
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), Number(settings.timeoutMs || 90000));
        const messages = [
            { role: 'system', content: systemPrompt(system, settings.jailbreakPrompt) },
            { role: 'user', content: JSON.stringify(payload) },
        ];
        const headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
        const body = {
            model: settings.model,
            temperature: Number(settings.temperature ?? 0.15),
            max_tokens: Number(settings.maxTokens || 5000),
            stream: false,
            messages,
        };
        if (!body.model) delete body.model;
        try {
            if (settings.useTavernApi !== false && options.forceExternal !== true) return await completeViaTavern(messages, settings, options.signal || controller.signal);
            const response = await fetch(normalizeEndpoint(settings.endpoint), {
                method: 'POST', headers, body: JSON.stringify(body), signal: options.signal || controller.signal,
            });
            const raw = await response.text();
            if (!response.ok) throw new Error(`Planner API ${response.status}: ${raw.slice(0, 500)}`);
            let data;
            try { data = JSON.parse(raw); } catch (_) { data = { output_text: raw }; }
            return extractJson(responseText(data) || raw);
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('Planner API 请求超时或已取消');
            throw error;
        } finally { window.clearTimeout(timeout); }
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
    WSM.Api = { complete, test, listModels };
})();
