(function () {
    'use strict';
    const WSM = window.WorldStateMachine = window.WorldStateMachine || {};
    let worldInfoModulePromise = null;

    const text = (value) => String(value ?? '').trim();
    const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
    function worldbookEntryKey(bookName, entryId) {
        return `${encodeURIComponent(text(bookName))}::${encodeURIComponent(text(entryId))}`;
    }
    function keyedEntries(bookName, entries) {
        return (entries || []).map((entry, index) => ({
            ...entry,
            key: entry.key || worldbookEntryKey(bookName, entry.id || index),
            bookName,
        }));
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
        const authoredUserName = [...(Array.isArray(ctx?.chat) ? ctx.chat : [])].reverse()
            .find((message) => message?.is_user === true && message?.is_system !== true)?.name;
        const messageUser = text(authoredUserName);
        const usableMessageUser = messageUser && !/^(?:user|用户|玩家|you|你|<user>)$/i.test(messageUser) ? messageUser : '';
        return {
            // SillyTavern's name1 is the active user/persona name. Resolve it
            // every time instead of freezing a name into the archive so a
            // persona rename is reflected before both reading and injection.
            user: usableMessageUser || text(ctx?.name1 || window.name1) || '<USER>',
            // A character-card title can be a version, pairing, collection or
            // filename rather than a person's name. Named people are extracted
            // from card/chat content instead of this metadata field.
            char: '',
        };
    }
    function visibleMessageContent(message) {
        const raw = String(message?.mes ?? message?.content ?? '');
        if (!raw) return '';
        let content = raw;

        // If the model explicitly wrapped its final answer, that boundary is
        // stronger than any heuristic. Accept the common wrappers used by
        // reasoning presets and prompt templates.
        const finalBlocks = [];
        const finalPattern = /<(response|final|answer|正文)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
        let finalMatch;
        while ((finalMatch = finalPattern.exec(content)) !== null) {
            const value = text(finalMatch[2]);
            if (value) finalBlocks.push(value);
        }
        if (finalBlocks.length) content = finalBlocks.join('\n');
        else {
            const markerMatches = [...content.matchAll(/(?:^|\n)\s*\[(?:response|final|answer|正文)\]\s*/gi)];
            const marker = markerMatches.at(-1);
            if (marker) content = content.slice((marker.index || 0) + marker[0].length);
        }

        // SillyTavern normally stores parsed reasoning separately in extra.
        // Remove an exact residual copy even if its original XML tags were
        // stripped by a preset or formatter before the plugin sees the chat.
        const separateReasoning = [
            message?.extra?.reasoning,
            message?.extra?.reasoning_content,
            message?.extra?.thinking,
            message?.reasoning,
            message?.reasoning_content,
            message?.thinking,
        ].map((value) => String(value ?? '')).filter((value) => value.trim());
        separateReasoning.forEach((reasoning) => {
            content = content.split(reasoning).join('\n');
        });

        // Cover both XML-like reasoning wrappers and the names most commonly
        // used by reasoning-capable providers. The visible final response and
        // story metadata tags are intentionally left intact.
        ['thinking', 'think', 'analysis', 'reasoning', 'thought', 'chain_of_thought'].forEach((tag) => {
            const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            content = content.replace(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, 'gi'), '\n');
        });
        return text(content);
    }
    function normalizeMessage(message, index, options = {}) {
        const hidden = message?.is_system === true;
        return {
            id: text(message?.extra?.gen_id ?? message?.send_date ?? index),
            // A hidden SillyTavern floor is still authored by the user or the
            // assistant.  Preserve that authorship during an explicit archive
            // calibration; normal prompt-facing reads continue to exclude it.
            role: hidden && options.preserveHiddenAuthor === true
                ? (message?.is_user ? 'user' : 'assistant')
                : (hidden ? 'system' : (message?.is_user ? 'user' : 'assistant')),
            name: text(message?.name),
            content: visibleMessageContent(message),
            index,
            hidden,
            timestamp: text(message?.send_date ?? message?.extra?.gen_id ?? ''),
        };
    }
    function chat(ctx = context(), options = {}) {
        // SillyTavern uses is_system=true for messages hidden from the prompt.
        // They remain excluded from ordinary reads.  Only the explicit complete
        // calibration path asks for includeHidden so archived evidence can be
        // indexed once without being re-sent on every turn.
        const values = Array.isArray(ctx?.chat) ? ctx.chat : [];
        return values
            .filter((message) => options.includeHidden === true || message?.is_system !== true)
            .map((message, index) => normalizeMessage(message, index, { preserveHiddenAuthor: options.includeHidden === true }))
            .filter((item) => item.content);
    }
    function latestUserMessage(ctx = context()) {
        return [...chat(ctx)].reverse().find((item) => item.role === 'user') || null;
    }
    function latestAssistantMessage(ctx = context()) {
        return [...chat(ctx)].reverse().find((item) => item.role === 'assistant') || null;
    }
    function normalizeSummaryTag(value) {
        const raw = text(value);
        if (!raw) return '';
        const wrapped = raw.match(/^<\/?([^<>\s/]+)(?:\s[^<>]*)?\/?>(?:\s*)$/);
        const tag = text(wrapped?.[1] || raw);
        return /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/.test(tag) ? tag : '';
    }
    function summaryContent(value, tag = 'meow_FM') {
        const raw = String(value ?? '');
        const normalizedTag = normalizeSummaryTag(tag);
        if (!normalizedTag) return text(raw);
        const blocks = [];
        const escapedTag = normalizedTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, 'gi');
        let match;
        while ((match = pattern.exec(raw)) !== null) {
            const content = text(match[1]);
            if (content) blocks.push(content);
        }
        return blocks.join('\n');
    }
    function meowFMContent(value) { return summaryContent(value, 'meow_FM'); }
    function configuredSummaryTag() {
        const settings = WSM.Settings?.get?.() || {};
        return Object.prototype.hasOwnProperty.call(settings, 'summaryTag') ? normalizeSummaryTag(settings.summaryTag) : 'meow_FM';
    }
    function meowMessage(message, requestedTag = configuredSummaryTag()) {
        if (!message) return null;
        const raw = String(message.content ?? message.mes ?? '');
        const tag = normalizeSummaryTag(requestedTag);
        const content = summaryContent(raw, tag);
        if (!content) return null;
        return {
            ...message,
            content: tag ? `<meow_FM data-source-tag="${tag}">\n${content}\n</meow_FM>` : content,
            memoryOnly: !!tag,
            summaryTag: tag,
            originalChars: raw.length,
        };
    }
    function recentFullTextMessage(message, requestedTag = configuredSummaryTag()) {
        if (!message) return null;
        const raw = String(message.content ?? message.mes ?? '');
        const tags = [...new Set(['thinking', 'meow_FM', 'INDRS', 'abstract', 'note', 'small_theater', normalizeSummaryTag(requestedTag)].filter(Boolean))];
        let content = raw;
        tags.forEach((tag) => {
            const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            content = content.replace(new RegExp(`<${escaped}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${escaped}>`, 'gi'), '\n');
        });
        content = text(content);
        if (!content) return meowMessage(message, requestedTag);
        return { ...message, content, memoryOnly: false, summaryTag: '', originalChars: raw.length };
    }
    function messagesByIds(ids, ctx = context(), options = {}) {
        const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => text(id)).filter(Boolean));
        if (!wanted.size || !Array.isArray(ctx?.chat)) return [];
        const found = [];
        ctx.chat.forEach((message, index) => {
            if (message?.is_system === true && options.includeHidden !== true) return;
            const normalized = normalizeMessage(message, index, { preserveHiddenAuthor: options.includeHidden === true });
            if (wanted.has(normalized.id) && normalized.content) found.push(normalized);
        });
        return found;
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
            // #world_editor_select is merely the book currently open in ST's
            // editor. It is not enabled lore and must never revive the previous
            // book in this plugin's picker.
            return Array.from(document.querySelectorAll('#world_info option:checked'))
                .map((option) => text(option.textContent) || text(option.value))
                .filter((value) => value && !/(?:^none$|未选择|选择以编辑|^-+$)/i.test(value));
        } catch (_error) { return []; }
    }
    function characterBoundWorldNames(settings, character) {
        const charData = character?.data || character || {};
        const primary = nameCandidates(charData?.extensions?.world);
        const avatar = text(character?.avatar || charData?.avatar);
        const fileNames = new Set([avatar, avatar.replace(/\.[^.]+$/, '')].filter(Boolean));
        const charLore = settings?.world_info?.charLore || settings?.worldInfo?.charLore || [];
        const extras = (Array.isArray(charLore) ? charLore : []).filter((item) => fileNames.has(text(item?.name))).flatMap((item) => nameCandidates(item?.extraBooks));
        return unique([...primary, ...extras]);
    }
    async function enabledWorldNames(ctx = context(), character = currentCharacter(ctx)) {
        const settings = ctx?.extensionSettings || window.extension_settings || {};
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
            characterBoundWorldNames(settings, character),
            selectedDomWorldNames(),
        ];
        return unique(candidates.flatMap(nameCandidates));
    }
    function normalizeEntries(data, options = {}) {
        const source = Array.isArray(data) ? data : (data?.entries || data?.data?.entries || data?.world?.entries || data?.data?.world?.entries || data?.worldInfo?.entries || data?.worldInfoData?.entries || data?.world_info?.entries || {});
        const entryText = (value) => {
            if (typeof value === 'string') return text(value);
            if (Array.isArray(value)) return value.map(entryText).filter(Boolean).join('\n');
            if (value && typeof value === 'object') return text(value.content || value.text || value.value);
            return '';
        };
        const entries = (Array.isArray(source) ? source : Object.values(source || {})).map((entry, index) => ({
            id: text(entry.uid ?? entry.id ?? index),
            keys: Array.isArray(entry.key) ? entry.key : (Array.isArray(entry.keys) ? entry.keys : [entry.key || entry.keys].filter(Boolean)),
            comment: text(entry.comment || entry.name || entry.title),
            content: entryText(entry.content ?? entry.text ?? entry.value ?? entry.prompt),
            depth: Math.max(0, Math.min(100, Math.round(Number(entry.depth ?? entry.extensions?.depth ?? 4) || 0))),
            role: Number(entry.role ?? entry.extensions?.role ?? 0) || 0,
            enabled: ![true, 1, 'true', '1'].includes(entry.disable) && ![true, 1, 'true', '1'].includes(entry.disabled) && ![false, 0, 'false', '0'].includes(entry.enabled),
            constant: entry.constant === true,
        })).filter((entry) => entry.content);
        return options.includeDisabled === true ? entries : entries.filter((entry) => entry.enabled);
    }
    async function readWorldbook(name, ctx = context(), options = {}) {
        const attempts = [];
        try {
            if (typeof ctx?.getWorldInfo === 'function') {
                const data = await ctx.getWorldInfo(name);
                const entries = normalizeEntries(data, options);
                attempts.push(`context.getWorldInfo：${entries.length} 条`);
                if (entries.length) return { name, entries: keyedEntries(name, entries), source: 'context.getWorldInfo', attempts };
            }
        } catch (error) { attempts.push(`context.getWorldInfo：${text(error?.message || error)}`); console.debug('[WorldStateMachine] getWorldInfo failed', name, error); }
        try {
            const module = await loadWorldInfoModule();
            if (typeof module?.loadWorldInfo === 'function') {
                const entries = normalizeEntries(await module.loadWorldInfo(name), options);
                attempts.push(`world-info module：${entries.length} 条`);
                if (entries.length) return { name, entries: keyedEntries(name, entries), source: 'world-info module', attempts };
            }
            const moduleCache = module?.world_info?.[name] || module?.worldInfo?.[name];
            const moduleEntries = normalizeEntries(moduleCache, options);
            attempts.push(`world-info module cache：${moduleEntries.length} 条`);
            if (moduleEntries.length) return { name, entries: keyedEntries(name, moduleEntries), source: 'world-info module cache', attempts };
        } catch (error) { attempts.push(`world-info module：${text(error?.message || error)}`); console.debug('[WorldStateMachine] world-info import failed', name, error); }
        const cached = window.world_info?.[name];
        const cachedEntries = normalizeEntries(cached, options);
        attempts.push(`window cache：${cachedEntries.length} 条`);
        if (cachedEntries.length) return { name, entries: keyedEntries(name, cachedEntries), source: 'window cache', attempts };
        try {
            const headers = await WSM.Api?.requestHeaders?.() || { 'Content-Type': 'application/json' };
            const response = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({ name }) });
            if (response.ok) {
                const entries = normalizeEntries(await response.json(), options);
                attempts.push(`/api/worldinfo/get：${entries.length} 条`);
                if (entries.length) return { name, entries: keyedEntries(name, entries), source: '/api/worldinfo/get', attempts };
            }
        } catch (error) { attempts.push(`/api/worldinfo/get：${text(error?.message || error)}`); console.debug('[WorldStateMachine] world-info API failed', name, error); }
        return { name, entries: [], source: 'unreadable', attempts };
    }
    function embeddedCharacterBook(character = currentCharacter(), options = {}) {
        const book = (character?.data || character || {})?.character_book;
        if (!book?.entries) return null;
        const name = text(book.name) || '角色卡内嵌世界书';
        return { name, entries: keyedEntries(name, normalizeEntries(book, options)), source: 'character card' };
    }
    async function worldbooks(ctx = context(), options = {}) {
        const requestedNames = await enabledWorldNames(ctx);
        const books = await Promise.all(requestedNames.map((name) => readWorldbook(name, ctx, options)));
        const embedded = embeddedCharacterBook(currentCharacter(ctx), options);
        if (embedded) books.push(embedded);
        const loadedByName = new Map();
        books.filter((book) => book.entries.length).forEach((book) => {
            const normalized = book.entries.map((entry, index) => ({
                ...entry, key: worldbookEntryKey(book.name, entry.id || index), bookName: book.name,
            }));
            const previous = loadedByName.get(book.name);
            if (!previous) {
                loadedByName.set(book.name, { ...book, entries: normalized });
                return;
            }
            const byKey = new Map(previous.entries.map((entry) => [entry.key, entry]));
            normalized.forEach((entry) => { if (!byKey.has(entry.key)) byKey.set(entry.key, entry); });
            previous.entries = [...byKey.values()];
            if (!String(previous.source).includes(book.source)) previous.source = `${previous.source} + ${book.source}`;
        });
        const loaded = [...loadedByName.values()];
        return {
            books: loaded,
            diagnostics: {
                requestedNames,
                loadedNames: loaded.map((book) => book.name),
                failedNames: unique(books.filter((book) => !book.entries.length).map((book) => book.name)),
                entryCounts: Object.fromEntries(loaded.map((book) => [book.name, book.entries.length])),
                readSources: Object.fromEntries(loaded.map((book) => [book.name, book.source])),
            },
        };
    }
    async function listWorldbookEntries(options = {}, ctx = context()) {
        if (options?.bookName) {
            const book = await readWorldbook(options.bookName, ctx, { includeDisabled: options.includeDisabled === true });
            return book.entries.map((entry, index) => ({ ...entry, key: worldbookEntryKey(book.name, entry.id || index), bookName: book.name, bookSource: book.source }));
        }
        const result = await worldbooks(ctx, { includeDisabled: options?.includeDisabled === true });
        return result.books.flatMap((book) => book.entries.map((entry) => ({
            ...entry,
            bookName: book.name,
            bookSource: book.source,
        })));
    }
    async function listEnabledWorldNames(ctx = context()) { return enabledWorldNames(ctx); }
    async function buildSource(options = {}) {
        const ctx = context();
        const settings = WSM.Settings.get();
        const summaryTag = configuredSummaryTag();
        const visibleChat = chat(ctx);
        // Full-text mode means the visible authored conversation, not hidden
        // system/plugin floors. Tagged memories may still be indexed from
        // hidden floors during an explicit archive calibration.
        const allChat = options.includeHidden === true && summaryTag ? chat(ctx, { includeHidden: true }) : visibleChat;
        const configuredCount = Number(settings.recentMessages);
        const recentCount = Number.isFinite(configuredCount) ? Math.max(0, Math.min(200, Math.round(configuredCount))) : 12;
        const configuredFullTextCount = Number(settings.recentFullTextMessages);
        const recentFullTextCount = Number.isFinite(configuredFullTextCount) ? Math.max(1, Math.min(20, Math.round(configuredFullTextCount))) : 5;
        const readAllVisible = options.fullChat === true || recentCount === 0;
        const selectedRawChat = readAllVisible ? allChat : allChat.slice(-recentCount);
        const visiblePositions = selectedRawChat.map((message, index) => message.hidden ? -1 : index).filter((index) => index >= 0);
        const fullTextPositions = new Set(visiblePositions.slice(-recentFullTextCount));
        const selectedChat = selectedRawChat.map((message, index) => {
            if (!summaryTag) return { ...message, memoryOnly: false, summaryTag: '', originalChars: String(message.content || '').length };
            if (fullTextPositions.has(index)) return recentFullTextMessage(message, summaryTag);
            return meowMessage(message, summaryTag);
        }).filter(Boolean);
        const rawChat = Array.isArray(ctx?.chat) ? ctx.chat : [];
        const hiddenMessages = rawChat.filter((message) => message?.is_system === true).length;
        const worldbookResult = await worldbooks(ctx);
        let configuredBooks = null;
        if (settings.worldbookCompiler?.enabled === true) {
            // Compilation membership is independent from the native entry's
            // enabled flag. Use the all-entry catalog to preserve a disabled
            // entry's precompile checkbox, while `worldbookResult` below still
            // contains only enabled originals for runtime source/routing.
            const compilerEntries = await listWorldbookEntries({ includeDisabled: true }, ctx);
            const availableNames = unique(compilerEntries.map((entry) => entry.bookName));
            const knownNames = new Set((settings.worldbookCompiler?.knownBookNames || []).map(text).filter(Boolean));
            const selectedNames = new Set((settings.worldbookCompiler?.selectedBookNames || []).map(text).filter((name) => availableNames.includes(name)));
            availableNames.forEach((name) => { if (!knownNames.has(name)) selectedNames.add(name); });
            configuredBooks = selectedNames;
            const availableEntryKeys = new Set(compilerEntries.filter((entry) => selectedNames.has(entry.bookName)).map((entry) => entry.key));
            // Book selection only controls which books appear in the entry
            // picker. Never turn it into an implicit "select every entry".
            const entryKeys = (settings.worldbookCompiler?.entryKeys || []).map(String).filter((key) => availableEntryKeys.has(key));
            const nextCompiler = {
                ...settings.worldbookCompiler,
                selectedBookNames: [...selectedNames],
                knownBookNames: availableNames,
                entryKeys,
                knownEntryKeys: compilerEntries.map((entry) => entry.key),
            };
            if (JSON.stringify(nextCompiler) !== JSON.stringify(settings.worldbookCompiler)) WSM.Settings.update({ worldbookCompiler: nextCompiler });
        }
        if (configuredBooks) {
            worldbookResult.books = worldbookResult.books.filter((book) => configuredBooks.has(book.name));
            worldbookResult.diagnostics.requestedNames = worldbookResult.diagnostics.requestedNames.filter((name) => configuredBooks.has(name));
            worldbookResult.diagnostics.loadedNames = worldbookResult.books.map((book) => book.name);
            worldbookResult.diagnostics.failedNames = worldbookResult.diagnostics.failedNames.filter((name) => configuredBooks.has(name));
            worldbookResult.diagnostics.entryCounts = Object.fromEntries(worldbookResult.books.map((book) => [book.name, book.entries.length]));
            worldbookResult.diagnostics.readSources = Object.fromEntries(worldbookResult.books.map((book) => [book.name, book.source]));
        }
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
                scope: summaryTag
                    ? `${readAllVisible ? 'full' : 'recent'}-hybrid:${summaryTag}:latest-${recentFullTextCount}-full-text`
                    : `${readAllVisible ? 'full' : 'recent'}-message-text`,
                readMode: summaryTag ? 'hybrid-summary-tail' : 'full-text',
                summaryTag,
                recentFullTextMessages: recentFullTextCount,
                totalMessages: allChat.length,
                scannedMessages: selectedRawChat.length,
                includedMessages: selectedChat.length,
                meowMessages: summaryTag === 'meow_FM' ? selectedChat.filter((message) => message.memoryOnly === true).length : 0,
                summaryMessages: selectedChat.filter((message) => message.memoryOnly === true).length,
                fullTextMessages: selectedChat.filter((message) => message.memoryOnly === false).length,
                skippedWithoutMeow: selectedRawChat.length - selectedChat.length,
                truncated: selectedRawChat.length < allChat.length,
                hiddenMessages,
                visibleMessages: visibleChat.length,
                hiddenIncluded: options.includeHidden === true ? selectedChat.filter((message) => message.hidden).length : 0,
            },
            currentUserAction: [...selectedChat].reverse().find((item) => item.role === 'user') || null,
            latestAssistantText: [...selectedChat].reverse().find((item) => item.role === 'assistant') || null,
        };
        // Initialization can ask SourceReader to preserve every source item. It
        // will stream the material through bounded model calls instead of
        // silently dropping old chat messages here.
        if (options.preserveFull === true) return source;
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
    WSM.Context = { context, chat, messagesByIds, latestUserMessage, latestAssistantMessage, meowMessage, recentFullTextMessage, summaryContent, normalizeSummaryTag, identityNames, buildSource, sourceFingerprint, readWorldbook, listWorldbookEntries, listEnabledWorldNames, worldbookEntryKey, _test: { normalizeEntries, normalizeMessage, visibleMessageContent, meowFMContent, summaryContent, normalizeSummaryTag, recentFullTextMessage } };
})();
