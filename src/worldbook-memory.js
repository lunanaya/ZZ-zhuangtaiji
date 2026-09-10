(function () {
    'use strict';
    const W = window.WorldStateMachine = window.WorldStateMachine || {};
    const text = value => String(value ?? '').trim();
    const key = (name, entry, index) => text(entry.key) || `${encodeURIComponent(name)}::${encodeURIComponent(entry.id ?? index)}`;
    function entries(source) {
        return (source?.worldbooks || []).flatMap(book => (book.entries || []).filter(entry => text(entry.content)).map((entry, index) => ({
            key:key(book.name, entry, index), bookName:text(book.name), title:text(entry.comment || entry.name || entry.title),
            content:text(entry.content), keys:Array.isArray(entry.keys) ? entry.keys.map(text).filter(Boolean) : [],
            constant:entry.constant === true,
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
        const next = {...previous};
        entries(source).forEach(entry => { next[entry.key] = entry; });
        if (JSON.stringify(previous) === JSON.stringify(next)) return false;
        state.runtime ||= {};
        state.runtime.worldbookSources = next;
        return true;
    }
    async function restoreSource(state, source) {
        const saved = originals(state);
        const live = entries(source);
        const merged = new Map(saved.map(entry => [entry.key, entry]));
        const selected = new Set(W.Settings.get().worldbookCompiler?.entryKeys || []);
        const names = new Set([...saved.map(entry => entry.bookName), ...(state.runtime?.sourceSummary?.loadedWorldbooks || [])]);
        for (const id of selected) {
            try { names.add(decodeURIComponent(String(id).split('::')[0])); } catch (_) { /* malformed old key */ }
        }
        const recoveryFailures = [];
        // Only restore already-read books or explicitly selected entries. Never
        // scan every file in the user's library, or enable native worldbooks.
        for (const name of names) {
            const legacy = !saved.some(entry => entry.bookName === name) && (state.runtime?.sourceSummary?.loadedWorldbooks || []).includes(name);
            const missing = saved.some(entry => entry.bookName === name && !live.some(row => row.key === entry.key))
                || [...selected].some(id => String(id).startsWith(`${encodeURIComponent(name)}::`) && !live.some(row => row.key === id));
            if (!legacy && !missing) continue;
            let book;
            try { book = await W.Context.readWorldbook?.(name, W.Context.context(), {includeDisabled:true}); }
            catch (_) { /* persisted originals remain available during read failures */ }
            if (!book?.entries?.length) { recoveryFailures.push(name); continue; }
            for (const entry of entries({worldbooks:[book]})) {
                if (legacy || merged.has(entry.key) || selected.has(entry.key)) merged.set(entry.key, entry);
            }
        }
        live.forEach(entry => merged.set(entry.key, entry));
        const books = new Map();
        for (const entry of merged.values()) {
            if (!books.has(entry.bookName)) books.set(entry.bookName, {name:entry.bookName, entries:[], source:'当前原书或本聊天已接管原文'});
            books.get(entry.bookName).entries.push({...entry, comment:entry.title});
        }
        const worldbooks = [...books.values()];
        const unavailableNames = [...names].filter(name => !books.has(name));
        const diagnostics = source.worldbookDiagnostics || {};
        return {...source, worldbooks, worldbookDiagnostics:{...diagnostics,
            loadedNames:worldbooks.map(book => book.name),
            entryCounts:Object.fromEntries(worldbooks.map(book => [book.name, book.entries.length])),
            retainedNames:[...new Set(saved.map(entry => entry.bookName))], recoveryFailures, unavailableNames,
        }};
    }
    function fallback(state, delivered = []) {
        const result = [];
        const seen = new Set();
        for (const entry of originals(state)) {
            if (W.WorldbookSemantic?.hasRead(state,entry)) continue;
            // A reference, a topic match or a summary is not proof of full
            // coverage. Omit only an original reproduced verbatim this turn.
            if (seen.has(entry.content) || delivered.some(row => String(row).includes(entry.content))) continue;
            seen.add(entry.content);
            result.push({...entry, transmission:transmission(entry.content)});
        }
        return result;
    }
    W.WorldbookMemory = {entries, retain, restoreSource, originals, fallback, transmission, _test:{expand, verify}};
})();
