(function () {
    'use strict';
    const W = window.WorldStateMachine = window.WorldStateMachine || {};
    const text = value => String(value ?? '').trim();
    const POSITIONS = { before_character: 0, after_character: 1, before_author: 2, after_author: 3 };
    const fingerprint = entry => W.Facts.hash(entry.content);
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
        const lockedModules = W.PlainMemory.MODULES.filter(module => start.lockedPaths.some(path => path === 'memory' || path === `memory.${module}` || path.startsWith(`memory.${module}.`)));
        options.progress?.(`正在读取 ${entries.length} 条世界书并分流到栏目（API 1/1）`);
        const response = await W.Api.complete(
            `完整读取worldbooks，按现有memory栏目直接分流，使用简洁自然语言保存所有独有设定。地图、地理层级和路线归map；主要和次要人物归characters，次要人物简短概况；规则、制度及运行规律归worldRules；组织归organizations；关系归relationships；秘密与知情范围归knowledge；其他内容按columns归栏。只有无法归入其他栏目的内容才简写放入worldbook，不复制大段原文。
沿用已有记忆逻辑：补充遗漏，已有相同内容不重复；需要合并或修正旧条时用before替换，保留旧条中仍有效的信息。旧worldbook里能归栏的内容移到对应栏目并删除原条。稳定设定不能把正文已改变的当前位置、状态或关系改回初始值；保留条件、否定、例外和知识边界。只读取设定，不推进剧情，不推演缺项，不要求填满无关栏目。lockedModules保持原样。
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
        W.WorldbookMemory.retain(state,{worldbooks:[...books.values()]});
        markRead(state,entries);
        delete state.runtime.finalInjectionOverride;
        state.planner.turnKey = '';
        return {state,changed:applied.changed};
    }
    async function compile(entries, options = {}) {
        const applied = await W.Api.withCallBudget(1, 'worldbook-read', () => read(W.Storage.load(), entries, options));
        await W.Storage.save(applied.state,'worldbook-read',{snapshot:true});
        await W.Engine?.syncRegisteredPrompt?.();
        return {count:entries.length,changed:applied.changed};
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
        const content = W.PlainMemory.composeByDepth(W.Storage.load()).worldbook;
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
    W.WorldbookSemantic = {read,compile,markRead,hasRead,install,POSITIONS,_test:{nativePosition,injectNative}};
})();
