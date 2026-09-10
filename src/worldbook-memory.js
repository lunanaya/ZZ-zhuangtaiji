(function () {
    'use strict';
    const W = window.WorldStateMachine = window.WorldStateMachine || {};
    const text = value => String(value ?? '').trim();
    const key = (name, entry, index) => text(entry.key) || `${encodeURIComponent(name)}::${encodeURIComponent(entry.id ?? index)}`;
    function entries(source) {
        return (source?.worldbooks || []).flatMap(book => (book.entries || []).filter(entry => (entry.enabled !== false || entry.selectedForRead === true) && text(entry.content)).map((entry, index) => ({
            key:key(book.name, entry, index), bookName:text(book.name), title:text(entry.comment || entry.name || entry.title),
            content:text(entry.content), keys:Array.isArray(entry.keys) ? entry.keys.map(text).filter(Boolean) : [],
            constant:entry.constant === true,
            enabled:entry.enabled !== false,
        })));
    }
    function originals(state) { return Object.values(state?.runtime?.worldbookSources || {}).filter(entry => entry?.key && text(entry.content)); }
    const compactCache = new Map();
    const COMPACT_NOTICE = '规则简写：将“原文顺序”中的符号逐一替换成对应“规则短语”，按原顺序整体理解；前提、否定、例外和重复出现均保留，不新增设定。\n';
    function expand(packed) {
        if (!packed || typeof packed['原文顺序'] !== 'string' || !packed['规则短语'] || Array.isArray(packed['规则短语'])) return null;
        const definitions = Object.entries(packed['规则短语']);
        if (!definitions.length || definitions.some(([token, value]) => !token || typeof value !== 'string' || !value)) return null;
        // Definitions are literal source fragments, never recursive rules.
        if (definitions.some(([, value]) => definitions.some(([token]) => value.includes(token)))) return null;
        let body = packed['原文顺序'];
        for (const [token, value] of definitions) body = body.split(token).join(value);
        return body;
    }
    function verify(source, packed) {
        if (!packed || Object.keys(packed).sort().join('|') !== '原文顺序|规则短语') return false;
        const definitions = packed['规则短语'];
        if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) return false;
        if (typeof packed['原文顺序'] !== 'string') return false;
        // Reject even unused additions: an extra definition would still send
        // unsupported information to the story model.
        if (Object.entries(definitions).some(([token, value]) => !token || typeof value !== 'string'
            || !value || source.includes(token) || !source.includes(value)
            || packed['原文顺序'].split(token).length < 3)) return false;
        return expand(packed) === source;
    }
    function transmission(value) {
        const source = String(value ?? '');
        if (compactCache.has(source)) return compactCache.get(source);
        let prefix = '〔规';
        while (source.includes(prefix)) prefix += '#';
        // Work with whole sentences and clauses, not guessed synonyms or
        // extracted keywords. Repeated prerequisites can share one definition.
        const candidates = new Set([
            ...(source.match(/[^。！？!?\r\n]+[。！？!?]?/g) || []),
            ...(source.match(/[^。！？!?；;，,：:\r\n]+[。！？!?；;，,：:]?/g) || []),
        ].map(part => part.trim().replace(/^(?:\d+[.)、]|[-*•])\s*/, '')).filter(part => part.length >= 8));
        const ranked = [...candidates].map(part => ({part, score:(source.split(part).length - 2) * part.length}))
            .filter(item => item.score > 0).sort((a,b) => b.score - a.score || b.part.length - a.part.length);
        const definitions = {};
        let body = source;
        let count = 0;
        for (const {part} of ranked) {
            if (count >= 32) break;
            const token = `${prefix}${count + 1}〕`;
            const occurrences = body.split(part).length - 1;
            if (occurrences < 2 || occurrences * (part.length - token.length) <= JSON.stringify({[token]:part}).length + 2) continue;
            body = body.split(part).join(token);
            definitions[token] = part;
            count++;
        }
        const packed = {'规则短语':definitions, '原文顺序':body};
        const compact = COMPACT_NOTICE + JSON.stringify(packed);
        const accepted = compact.length < source.length && verify(source,packed);
        Object.freeze(definitions);
        Object.freeze(packed);
        const result = Object.freeze({text:accepted ? compact : source, mode:accepted ? 'compact' : 'original',
            originalChars:source.length, sentChars:accepted ? compact.length : source.length, packed:accepted ? packed : null});
        // Derived cache only: no extra revisions, model calls or saved copies.
        if (compactCache.size >= 32) compactCache.delete(compactCache.keys().next().value);
        compactCache.set(source,result);
        return result;
    }
    function retain(state, source) {
        const previous = state.runtime?.worldbookSources || {};
        const next = {};
        entries(source).forEach(entry => { next[entry.key] = entry; });
        if (JSON.stringify(previous) === JSON.stringify(next)) return false;
        state.runtime ||= {};
        state.runtime.worldbookSources = next;
        return true;
    }
    async function restoreSource(state, source) {
        // Context resolves current mounts and explicit extra selections.
        // Historical summaries and retained originals never expand that scope.
        const diagnostics = source.worldbookDiagnostics || {};
        return {...source, worldbookDiagnostics:{...diagnostics,
            retainedNames:[], recoveryFailures:[], unavailableNames:diagnostics.failedNames || []}};
    }
    function fallback(state, delivered = []) {
        // Source backups are for local inspection and unfinished extraction,
        // never a fallback prompt for the story model.
        return [];
    }
    function forRead(state, source) {
        return {...source,worldbooks:(source?.worldbooks || []).map(book => ({...book,
            // Receipts describe previous work, not permission to hide sources
            // from the plugin. Story injection is handled separately.
            entries:(book.entries || []).filter(entry => entry.enabled !== false || entry.selectedForRead === true)
        })).filter(book => book.entries.length)};
    }
    W.WorldbookMemory = {entries, retain, restoreSource, originals, fallback, forRead, transmission, _test:{expand, verify}};
})();
