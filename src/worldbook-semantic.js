(function () {
    'use strict';
    const W = window.WorldStateMachine = window.WorldStateMachine || {};
    const text = value => String(value ?? '').trim();
    const POSITIONS = { before_character: 0, after_character: 1, before_author: 2, after_author: 3 };
    // Receipts label the current compression contract for the picker; they
    // never authorize hiding selected originals from plugin readers.
    const fingerprint = entry => `compact-v3:${W.Facts.hash(entry.content)}`;
    const COMPRESSION = `世界书处理采用逐项精简表达，不写整书摘要、目录或只有大意的概括。阅读全部选中原文，每个独有信息都要留下可独立理解的短句；只删重复表述和不承载设定的修辞，不追求固定压缩比例、字数或每栏条数。不能因为当前场景用不到就省略，不能依赖本地原文备份或以后再读来补足本次遗漏。
分配依据是内容归属：设定放人物、地图、规则、关系等原有栏目，无法自然归栏的内容放memory.worldbook。栏目与worldbook合起来必须覆盖原书全部独有信息，同一事实只保留一份。不同人物、城市或独立规则分别记录，不把整批人物压成姓名与身份名单，不把整批城市压成名称与单一标签。每人保留原书给出的外貌特征、性格、能力、喜好、背景经历、独立事务、关系及立场边界；每地保留产业、生活生态、文化、空间关系与特殊条件。保留未出场人物，世界书独有信息不适用常驻角色卡的重复精简例外。
全局运作规则放worldRules，保留适用对象、触发条件、行为边界、否定、例外、时间与因果。“遵循现实逻辑”“豪门没有绝对特权”不能替代财富与人格、私人关系与组织利益、校园与成年社会边界等不同规则。条件与例外必须跟随所属规则；相近内容只有含义及条件相同才合并。
例如“甲内向、爱修模型，与乙私交好，但合作时先维护本公司利益”可精简为“甲｜内向，爱修模型；与乙私交好，合作时优先本公司利益”，不能缩成“甲｜乙的朋友”。不得把个人爱好改成正文里的一次行为，把亲近改成全心依赖，或补出原书没有的立场、动机和结局。
后续核对只补漏、纠错和去重，不再次整体概括已经精简的世界书。不把设定更新成只剩当前动作：用before更新位置、活动或关系时，保留仍有效的其他细节；确需移栏，先确保目标栏完整接住再删除旧条。结束前对照原文检查独有内容是否均在记忆中，遗漏直接补写短句，不输出覆盖表、来源编号、新字段或思考过程。只保存故事世界内容；旧记录若是模型的整理计划、格式说明或工作过程，用before删除，不能当作世界进程。沿用module/text/before及end的JSONL格式。`;
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
