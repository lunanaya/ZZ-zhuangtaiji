(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};

    function normalizeEndpoint(value) {
        let endpoint = String(value || '').trim().replace(/\/+$/, '');
        if (!endpoint) throw new Error('尚未设置 Planner API 地址');
        if (!/\/chat\/completions(?:\?|$)/.test(endpoint)) endpoint += '/chat/completions';
        return endpoint;
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
    async function complete(system, payload, options = {}) {
        const settings = WSM.Settings.get();
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), Number(settings.timeoutMs || 90000));
        const headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
        const body = {
            model: settings.model,
            temperature: Number(settings.temperature ?? 0.15),
            max_tokens: Number(settings.maxTokens || 5000),
            stream: false,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: JSON.stringify(payload) },
            ],
        };
        if (!body.model) delete body.model;
        try {
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
    async function test() {
        const result = await complete('只输出 {"ok":true}', { task: 'connection_test' });
        return result?.ok === true;
    }
    WSM.Api = { complete, test };
})();
