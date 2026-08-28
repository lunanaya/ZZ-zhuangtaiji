(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    let worldInfoModulePromise = null;

    const text = (value) => String(value ?? '').trim();
    const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
    function worldbookEntryKey(bookName, entryId) {
        return `${encodeURIComponent(text(bookName))}::${encodeURIComponent(text(entryId))}`;
    }
    function context() { return window.SillyTavern?.getContext?.() || null; }
    function currentCharacter(ctx = context()) {
        return Array.isArray(ctx?.characters) ? ctx.characters[ctx.characterId] : null;
    }
    function compactCharacter(character) {
        if (!character) return null;
        const data = character.data || character;
        return {
            name: text(character.name || data.name),
            description: text(data.description),
            personality: text(data.personality),
            scenario: text(data.scenario),
            firstMessage: text(data.first_mes || data.firstMessage),
            exampleDialogue: text(data.mes_example || data.example_dialogue),
            creatorNotes: text(data.creator_notes),
            systemPrompt: text(data.system_prompt),
            postHistoryInstructions: text(data.post_history_instructions),
        };
    }
    function getPersona(ctx = context()) {
        return text(ctx?.persona || ctx?.userPersona || ctx?.persona_description || ctx?.user_description || ctx?.power_user?.persona_description || window.power_user?.persona_description);
    }
    function identityNames(ctx = context()) {
        const messages = Array.isArray(ctx?.chat) ? ctx.chat : [];
        const recentUserName = [...messages].reverse().find((item) => item?.is_user)?.name;
        const recentCharacterName = [...messages].reverse().find((item) => !item?.is_user && !item?.is_system)?.name;
        const character = compactCharacter(currentCharacter(ctx));
        return {
            user: text(ctx?.name1 || ctx?.userName || ctx?.playerName || window.name1 || recentUserName),
            char: text(character?.name || ctx?.name2 || ctx?.characterName || window.name2 || recentCharacterName),
        };
    }
    function normalizeMessage(message, index) {
        return {
            id: text(message?.extra?.gen_id ?? message?.send_date ?? index),
            role: message?.is_system ? 'system' : (message?.is_user ? 'user' : 'assistant'),
            name: text(message?.name),
            content: text(message?.mes ?? message?.content),
        };
    }
    function chat(ctx = context()) {
        return Array.isArray(ctx?.chat) ? ctx.chat.map(normalizeMessage).filter((item) => item.content) : [];
    }
    function latestUserMessage(ctx = context()) {
        return [...chat(ctx)].reverse().find((item) => item.role === 'user') || null;
    }
    function latestAssistantMessage(ctx = context()) {
        return [...chat(ctx)].reverse().find((item) => item.role === 'assistant') || null;
    }
    function nameCandidates(value) {
        if (Array.isArray(value)) return value.flatMap(nameCandidates);
        if (typeof value === 'string' || typeof value === 'number') return [text(value)];
        if (!value || typeof value !== 'object') return [];
        const directKeys = ['name', 'world', 'worldName', 'book', 'bookName'];
        const collectionKeys = ['books', 'worlds', 'selected', 'selectedWorlds', 'selected_world_info', 'globalSelect'];
        return [
            ...directKeys.flatMap((key) => nameCandidates(value[key])),
            ...collectionKeys.flatMap((key) => nameCandidates(value[key])),
        ];
    }
    async function loadWorldInfoModule() {
        if (typeof document === 'undefined') return null;
        if (!worldInfoModulePromise) {
            worldInfoModulePromise = import('/scripts/world-info.js').catch((error) => {
                worldInfoModulePromise = null;
                console.debug('[WorldStateMachine] world-info import failed', error);
                return null;
            });
        }
        return worldInfoModulePromise;
    }
    function selectedDomWorldNames() {
        try {
            return ['#world_info option:checked', '#world_editor_select option:checked']
                .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
                .map((option) => text(option.value) || text(option.textContent))
                .filter((value) => value && !/^(none|未选择|选择以编辑|-+)$/i.test(value));
        } catch (_error) { return []; }
    }
    async function enabledWorldNames(ctx = context(), character = currentCharacter(ctx)) {
        const settings = ctx?.extensionSettings || window.extension_settings || {};
        const charData = character?.data || character || {};
        const worldSettings = settings.world_info || settings.worldInfo || {};
        const worldModule = await loadWorldInfoModule();
        const candidates = [
            window.selected_world_info,
            worldModule?.selected_world_info,
            worldModule?.worldInfo?.selected_world_info,
            worldModule?.worldInfo?.selectedWorlds,
            worldSettings.globalSelect,
            worldSettings.selectedWorlds,
            worldSettings.selected_world_info,
            ctx?.worldInfo?.selectedWorlds,
            ctx?.worldInfo?.selected_world_info,
            ctx?.chatMetadata?.world_info,
            ctx?.chatMetadata?.worldInfo,
            charData?.extensions?.world,
            charData?.world,
            selectedDomWorldNames(),
        ];
        return unique(candidates.flatMap(nameCandidates));
    }
    function normalizeEntries(data) {
        const source = data?.entries || data?.data?.entries || data?.worldInfo?.entries || data?.worldInfoData?.entries || data?.world_info?.entries || {};
        return (Array.isArray(source) ? source : Object.values(source || {})).map((entry, index) => ({
            id: text(entry.uid ?? entry.id ?? index),
            keys: Array.isArray(entry.key) ? entry.key : (Array.isArray(entry.keys) ? entry.keys : [entry.key || entry.keys].filter(Boolean)),
            comment: text(entry.comment || entry.name || entry.title),
            content: text(entry.content || entry.text || entry.value),
            enabled: ![true, 1, 'true', '1'].includes(entry.disable) && ![true, 1, 'true', '1'].includes(entry.disabled) && ![false, 0, 'false', '0'].includes(entry.enabled),
            constant: entry.constant === true,
        })).filter((entry) => entry.enabled && entry.content);
    }
    async function readWorldbook(name, ctx = context()) {
        try {
            if (typeof ctx?.getWorldInfo === 'function') {
                const data = await ctx.getWorldInfo(name);
                const entries = normalizeEntries(data);
                if (entries.length) return { name, entries, source: 'context.getWorldInfo' };
            }
        } catch (error) { console.debug('[WorldStateMachine] getWorldInfo failed', name, error); }
        try {
            const module = await loadWorldInfoModule();
            if (typeof module?.loadWorldInfo === 'function') {
                const entries = normalizeEntries(await module.loadWorldInfo(name));
                if (entries.length) return { name, entries, source: 'world-info module' };
            }
            const moduleCache = module?.world_info?.[name] || module?.worldInfo?.[name];
            const moduleEntries = normalizeEntries(moduleCache);
            if (moduleEntries.length) return { name, entries: moduleEntries, source: 'world-info module cache' };
        } catch (error) { console.debug('[WorldStateMachine] world-info import failed', name, error); }
        const cached = window.world_info?.[name];
        const cachedEntries = normalizeEntries(cached);
        if (cachedEntries.length) return { name, entries: cachedEntries, source: 'window cache' };
        try {
            const headers = Object.assign({ 'Content-Type': 'application/json' }, typeof window.getRequestHeaders === 'function' ? window.getRequestHeaders() : {});
            const response = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name }) });
            if (response.ok) {
                const entries = normalizeEntries(await response.json());
                if (entries.length) return { name, entries, source: '/api/worldinfo/get' };
            }
        } catch (error) { console.debug('[WorldStateMachine] world-info API failed', name, error); }
        return { name, entries: [], source: 'unreadable' };
    }
    function embeddedCharacterBook(character = currentCharacter()) {
        const book = (character?.data || character || {})?.character_book;
        if (!book?.entries) return null;
        return { name: text(book.name) || '角色卡内嵌世界书', entries: normalizeEntries(book), source: 'character card' };
    }
    async function worldbooks(ctx = context()) {
        const requestedNames = await enabledWorldNames(ctx);
        const books = await Promise.all(requestedNames.map((name) => readWorldbook(name, ctx)));
        const embedded = embeddedCharacterBook(currentCharacter(ctx));
        if (embedded) books.push(embedded);
        const loaded = books.filter((book) => book.entries.length).map((book) => ({
            ...book,
            entries: book.entries.map((entry, index) => ({
                ...entry,
                key: worldbookEntryKey(book.name, entry.id || index),
                bookName: book.name,
            })),
        }));
        return {
            books: loaded,
            diagnostics: {
                requestedNames,
                loadedNames: loaded.map((book) => book.name),
                failedNames: books.filter((book) => !book.entries.length).map((book) => book.name),
                entryCounts: Object.fromEntries(loaded.map((book) => [book.name, book.entries.length])),
                readSources: Object.fromEntries(loaded.map((book) => [book.name, book.source])),
            },
        };
    }
    async function listWorldbookEntries(ctx = context()) {
        const result = await worldbooks(ctx);
        return result.books.flatMap((book) => book.entries.map((entry) => ({
            ...entry,
            bookName: book.name,
            bookSource: book.source,
        })));
    }
    async function buildSource(options = {}) {
        const ctx = context();
        const settings = WSM.Settings.get();
        const allChat = chat(ctx);
        const recentCount = Math.max(2, Number(settings.recentMessages || 12));
        const selectedChat = options.fullChat ? allChat : allChat.slice(-recentCount);
        const worldbookResult = await worldbooks(ctx);
        const source = {
            identities: identityNames(ctx),
            character: compactCharacter(currentCharacter(ctx)),
            persona: getPersona(ctx),
            worldbooks: worldbookResult.books,
            worldbookDiagnostics: worldbookResult.diagnostics,
            // This is the real SillyTavern conversation body, not a Planner
            // summary. Keep `chat` for API compatibility and expose its scope
            // explicitly so the Planner can ground scene reactions in prose.
            chat: selectedChat,
            tavernTextContext: {
                source: 'SillyTavern.getContext().chat',
                scope: options.fullChat ? 'full' : 'recent',
                totalMessages: allChat.length,
                includedMessages: selectedChat.length,
                truncated: selectedChat.length < allChat.length,
            },
            currentUserAction: latestUserMessage(ctx),
            latestAssistantText: latestAssistantMessage(ctx),
        };
        const limit = Math.max(10000, Number(settings.maxSourceChars || 60000));
        let serialized = JSON.stringify(source);
        if (serialized.length > limit) {
            source.worldbooks = source.worldbooks.map((book) => ({ ...book, entries: book.entries.slice(0, 100) }));
            serialized = JSON.stringify(source);
            while (serialized.length > limit && source.chat.length > 4) {
                source.chat.shift();
                source.tavernTextContext.includedMessages = source.chat.length;
                source.tavernTextContext.truncated = true;
                serialized = JSON.stringify(source);
            }
            if (serialized.length > limit) {
                source.worldbooks = source.worldbooks.map((book) => ({
                    ...book,
                    entries: book.entries.map((entry) => ({ ...entry, content: entry.content.slice(0, 3000) })).slice(0, 40),
                }));
                source.sourceTruncated = true;
            }
        }
        return source;
    }
    function sourceFingerprint(source) {
        const raw = JSON.stringify({ character: source.character, persona: source.persona, worldbooks: source.worldbooks });
        let hash = 2166136261;
        for (let i = 0; i < raw.length; i += 1) hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
        return (hash >>> 0).toString(16);
    }
    WSM.Context = { context, chat, latestUserMessage, latestAssistantMessage, identityNames, buildSource, sourceFingerprint, listWorldbookEntries, worldbookEntryKey };
})();
