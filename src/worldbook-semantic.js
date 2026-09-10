(function () {
    'use strict';
    const W = window.WorldStateMachine = window.WorldStateMachine || {};
    const text = value => String(value ?? '').trim();
    const POSITIONS = { before_character: 0, after_character: 1, before_author: 2, after_author: 3 };
    // Receipts label the current compression contract for the picker; they
    // never authorize hiding selected originals from plugin readers.
    const fingerprint = entry => `logic-v2:${W.Facts.hash(entry.content)}`;
    const COMPRESSION = `世界书处理流程：先逐条理解完整设定，把叙述改写成AI可直接执行的简洁逻辑，再分配主归属。删除重复表述与修辞，合并同义设定；主体、关系方向、触发前提、行为、后果、否定、例外、时间和知识边界必须保留。不能靠截断、删掉独有条件或原文符号替换来冒充语义压缩，不输出思考过程。
分配依据是内容归属：人物、地图、规则、关系、认知边界、资源等能自然归入memory栏目的设定，整理后放入对应栏目；不按当前出场、关键词、重要性或使用频率删掉其他设定。其余无法自然归栏的世界观、背景和细节合并压缩到memory.worldbook。栏目与worldbook合起来必须覆盖原书全部独有信息，同一事实只保留一份。可以精简措辞、合并重复，不能删掉未归栏的内容来缩短结果；条件、否定、例外、数量、时间、适用范围和关系方向不变。不要求每条展示来源、证据链或逐级溯源，只输出便于AI使用的简洁内容。
随后对worldbook的剩余设定再次合并压缩，去掉已由其他栏目承担的重复内容，保留其独有信息及必要关联。正文只接收栏目中的关键内容与压缩后的补充，原书不作为兜底注入。没有固定字数、字数上限、压缩比例或每栏条数，不凑栏目、不编造逻辑；简短且不可再缩的原子规则无需改写凑比例。旧记忆里过长的世界书段落也按此流程压缩；移动时用before删除旧条，不留完整原文副本。`;
    function hasRead(state, entry) { return state.runtime?.worldbookRead?.[entry.key] === fingerprint(entry); }
    function markRead(state, source) {
        state.runtime.worldbookRead ||= {};
        const entries = Array.isArray(source) ? source : W.WorldbookMemory.entries(source);
        let changed = false;
        entries.forEach(entry => {
            const value = fingerprint(entry);
            if (state.runtime.worldbookRead[entry.key] !== value) changed = true;
            state.runtime.worldbookRead[entry.key] = value;
        });
        return changed;
    }
    async function read(start, entries, options = {}) {
        const chatKey = W.Storage.currentChatKey();
        const chat = JSON.stringify(W.Context.context()?.chat || []);
        const selectionSnapshot = JSON.stringify(W.Settings.get().worldbookCompiler || {});
        const selected = new Set(entries.map(entry => entry.key));
        // A caller's cached picker is not authority for mounts or entry switches.
        let currentSource;
        if (W.Context.selectedWorldbooks) {
            const current = await W.Context.selectedWorldbooks();
            if (current.diagnostics.failedNames.length) throw new Error(`世界书读取失败：${current.diagnostics.failedNames.join('、')}`);
            currentSource = {worldbooks:current.books};
            entries = current.books.flatMap(book => book.entries);
        } else if (W.Context.listWorldbookEntries) entries = await W.Context.listWorldbookEntries();
        const config = W.Settings.get().worldbookCompiler;
        entries = entries.filter(entry => selected.has(entry.key) && (W.Context.isWorldbookEntrySelected
            ? W.Context.isWorldbookEntrySelected(entry,config)
            : entry.enabled !== false && (config?.enabled !== true || config.entryKeys?.includes(entry.key))));
        if (!entries.length) throw new Error('没有选中可拆解的世界书条目，请在设置 → 世界书中选择');
        if (options.signal?.aborted) throw new Error('读取已取消');
        if (selectionSnapshot !== JSON.stringify(W.Settings.get().worldbookCompiler || {})) throw new Error('世界书选择在读取期间已变化，请重新拆解');
        const lockedModules = W.PlainMemory.MODULES.filter(module => start.lockedPaths.some(path => path === 'memory' || path === `memory.${module}` || path.startsWith(`memory.${module}.`)));
        options.progress?.(`正在读取 ${entries.length} 条世界书并分流到栏目（API 1/1）`);
        const response = await W.Api.complete(
            `${COMPRESSION}
沿用已有记忆逻辑：补充遗漏，已有相同内容不重复；需要合并或修正旧条时用before替换，保留旧条中仍有效的信息。稳定设定不能把正文已改变的当前位置、状态或关系改回初始值。只拆解设定，不推进剧情，不推演缺项，不要求填满无关栏目。lockedModules保持原样。
沿用句子JSONL格式，每行一个对象：新增{"module":"characters","text":"人物｜身份：…｜能力：…"}；更新{"module":"characters","before":"旧句全文","text":"更新后的完整句子"}；删除用before并令text为空字符串。不变不输出。最后一行{"end":true}。只返回栏目与文本，不附加来源引用、覆盖报告或审计字段。`,
            {task:'PLAIN_MEMORY_WORLDBOOK_READ',memory:start.memory,columns:W.PlainMemory.LABELS,lockedModules,
                worldbooks:entries.map(entry => ({book:entry.bookName,title:entry.comment || entry.title,text:entry.content}))},
            {singleAttempt:true,jsonContract:'sentences',timeoutMs:300000,reasoningEffort:'low',stream:true,omitJailbreak:true,signal:options.signal},
        );
        if (options.signal?.aborted) throw new Error('读取已取消');
        if (W.Storage.currentChatKey() !== chatKey || W.Settings.get().enabled === false
            || W.Storage.load().revision !== start.revision || JSON.stringify(W.Context.context()?.chat || []) !== chat) {
            throw new Error('聊天或状态在读取期间已变化，结果未覆盖新状态');
        }
        if (selectionSnapshot !== JSON.stringify(W.Settings.get().worldbookCompiler || {})) throw new Error('世界书选择在读取期间已变化，本次结果未写入');
        if (!response?.factStream?.end) throw new Error('世界书读取响应未完整结束，旧状态保留；本次不自动重试');
        const records = [...(response.factStream.facts || []),...(response.factStream.patches || [])];
        if (records.some(row => row.module === 'planner')) throw new Error('世界书读取返回了任务外的推演内容，旧状态保留');
        const applied = W.PlainMemory.apply(start,records);
        if (applied.errors.length) throw new Error(`世界书读取未写入：${applied.errors.join('；')}`);
        const state = applied.state;
        const books = new Map();
        entries.forEach(entry => {
            if (!books.has(entry.bookName)) books.set(entry.bookName,{name:entry.bookName,entries:[]});
            books.get(entry.bookName).entries.push(entry);
        });
        W.WorldbookMemory.retain(state,currentSource || {worldbooks:[...books.values()]});
        markRead(state,entries);
        delete state.runtime.finalInjectionOverride;
        state.planner.turnKey = '';
        return {state,changed:applied.changed,count:entries.length};
    }
    async function compile(entries, options = {}) {
        const applied = await W.Api.withCallBudget(1, 'worldbook-read', () => read(W.Storage.load(), entries, options));
        await W.Storage.save(applied.state,'worldbook-read',{snapshot:true});
        await W.Engine?.syncRegisteredPrompt?.();
        return {count:applied.count,changed:applied.changed};
    }
    let eventSource = null;
    let eventName = '';
    function nativePosition(position, noteActive = true) {
        const value = POSITIONS[position] ?? 1;
        return (value === 2 || value === 3) && !noteActive ? 1 : value;
    }
    async function injectNative(payload) {
        // Arrays belong to the native reader; mutate them in place.
        for (const key of ['globalLore','characterLore','chatLore','personaLore']) {
            if (!Array.isArray(payload[key])) continue;
            for (let index = payload[key].length - 1; index >= 0; index--) {
                if (payload[key][index].world === '__WSM_SUPPLEMENT__') payload[key].splice(index,1);
            }
        }
        if (W.Settings.get().enabled === false) return;
        const state = W.Storage.load();
        // Idempotent when the compiler listener already filtered this payload.
        // Managed originals must not leak when extraction is incomplete either.
        W.WorldbookCompiler?.filterNativeWorldbookEntries?.(payload);
        const content = W.PlainMemory.composeByDepth(state).worldbook;
        if (!text(content)) return;
        const position = W.Settings.get().worldbookCompiler?.injectionPosition || 'after_character';
        let noteActive = true;
        if (position === 'before_author' || position === 'after_author') {
            try { noteActive = (await import('/scripts/authors-note.js')).shouldWIAddPrompt; }
            catch (_) { noteActive = false; }
        }
        payload.chatLore ||= [];
        payload.chatLore.push({uid:-91077,world:'__WSM_SUPPLEMENT__',comment:'世界书补充',content,
            key:[],keysecondary:[],constant:true,disable:false,position:nativePosition(position,noteActive),order:100,
            selective:false,probability:100,useProbability:false,ignoreBudget:true,
            preventRecursion:true,excludeRecursion:true,delayUntilRecursion:false,sticky:0,cooldown:0,delay:0});
    }
    function install() {
        const ctx = W.Context?.context?.();
        const source = ctx?.eventSource;
        if (!source?.on || source === eventSource) return;
        if (eventSource?.off) eventSource.off(eventName,injectNative);
        eventName = ctx.eventTypes?.WORLDINFO_ENTRIES_LOADED || 'worldinfo_entries_loaded';
        source.on(eventName,injectNative);
        eventSource = source;
    }
    W.WorldbookSemantic = {read,compile,markRead,hasRead,install,COMPRESSION,POSITIONS,_test:{nativePosition,injectNative}};
})();
