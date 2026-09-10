import assert from 'node:assert/strict';

globalThis.window=globalThis;
globalThis.WorldStateMachine={};
globalThis.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options?.detail;}};
globalThis.dispatchEvent=()=>{};
globalThis.addEventListener=()=>{};
const cache=new Map();
globalThis.localStorage={getItem:key=>cache.get(key),setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)};
const raw='唐临是针灸医师，不能使用火系法术；只有持有蓝色令牌的人才可进内院。';
const long='古桥每逢雨季关闭，晴天可通行。'.repeat(700)+'独有尾部条件：封桥期间仅救援船获准通行。';
const books={
    MAIN:{entries:{1:{uid:1,content:raw},2:{uid:2,content:'DISABLED_MUST_NOT_SEND',disable:true},3:{uid:3,content:long}}},
    GLOBAL:{entries:{1:{uid:1,content:'诊所每逢朔日免诊金。'}}},
    EXTRA:{entries:{1:{uid:1,content:'外地商队使用蓝色令牌作为通行凭证。'}}},
};
const ctx={chatId:'grounding',characterId:0,characters:[{avatar:'main.png',data:{name:'唐临',description:'唐临擅长针灸，初始在北城。',extensions:{world:'MAIN'}}}],
    persona:'旅人',name1:'旅人',chatMetadata:{},chat:[{is_user:true,mes:'我递出蓝色令牌。'},{is_user:false,mes:'唐临已到东港，接过令牌并允许进入。'}],
    loadWorldInfo:async name=>books[name],getWorldInfoNames:()=>Object.keys(books),saveChat:async()=>{},setExtensionPrompt:()=>{}};
globalThis.SillyTavern={getContext:()=>ctx};
globalThis.selected_world_info=['GLOBAL'];
globalThis.getRequestHeaders=()=>({'Content-Type':'application/json'});
for(const module of ['defaults','facts','storage','state-logic','worldbook-memory','plain-memory','worldbook-semantic','context','api']) await import(`../src/${module}.js`);
const W=WorldStateMachine;
const settings={enabled:true,useTavernApi:false,endpoint:'https://mock.invalid/v1',maxTokens:9000,summaryTag:'',injectionModules:structuredClone(W.Defaults.INJECTION_MODULES),
    worldbookCompiler:{enabled:true,entryKeys:['MAIN::1'],knownEntryKeys:['MAIN::1'],injectionPosition:'after_character'}};
W.Settings={get:()=>settings};
for(const module of ['worldbook-compiler','injection','engine']) await import(`../src/${module}.js`);
const firstSelection=await W.Context.selectedWorldbooks();
assert.deepEqual(firstSelection.books.flatMap(book=>book.entries.map(entry=>entry.key)),['GLOBAL::1','MAIN::1','MAIN::3'],'legacy nonempty lists cannot hide newly enabled books/entries');
settings.worldbookCompiler=W.Context.editableWorldbookSelection(settings.worldbookCompiler,firstSelection.books.flatMap(book=>book.entries));
settings.worldbookCompiler.extraBookNames=['EXTRA'];
const fullSource=await W.Context.buildSource({preserveFull:true});
const entries=fullSource.worldbooks.flatMap(book=>book.entries);
assert.equal(entries.length,4);
const seed=W.Storage.load();
W.WorldbookMemory.retain(seed,fullSource);
W.WorldbookSemantic.markRead(seed,fullSource);
await W.Storage.save(seed,'stale-read-receipts',{snapshot:false});
assert.ok(entries.every(entry=>W.WorldbookSemantic.hasRead(W.Storage.load(),entry)),'fixture has receipts before first initialization');
const requests=[];
globalThis.fetch=async(url,options)=>{
    assert.equal(url,'/api/backends/chat-completions/generate');
    const body=JSON.parse(options.body), payload=JSON.parse(body.messages[1].content), system=body.messages[0].content;
    requests.push({payload,system});
    const sent=payload.source.worldbooks.flatMap(book=>book.entries.map(entry=>entry.text));
    assert.deepEqual(sent,entries.map(entry=>entry.content),'all four selected original entries reach the actual wire payload without truncation');
    assert.ok(!JSON.stringify(payload).includes('DISABLED_MUST_NOT_SEND'));
    assert.equal(payload.source.character.description,ctx.characters[0].data.description);
    assert.equal(payload.source.persona,ctx.persona);
    assert.ok(payload.source.chat.some(row=>row.text===ctx.chat[1].mes),'authored body accompanies worldbook and character card');
    let rows;
    if(payload.task==='PLAIN_MEMORY_READ') {
        assert.match(system,/只整理来源已经给出的事实和设定/);
        assert.doesNotMatch(system,/所有栏目必须读取并填写|持续世界演化|推演缺项，标明/);
        assert.match(system,/栏目与worldbook合起来必须覆盖原书全部独有信息/);
        assert.ok(system.length<2500,'first pass does not inherit the large simulation/mandatory-fill prompt');
        rows=[{module:'characters',text:'唐临｜身份：针灸医师｜位置：东港｜限制：不能使用火系法术'},
            {module:'worldRules',text:'内院仅限持蓝色令牌者进入'},
            {module:'worldbook',text:'古桥雨季关闭，晴天通行；封桥时仅救援船获准通行。诊所朔日免诊金。商队以蓝色令牌通行。'}];
    } else {
        assert.equal(payload.task,'PLAIN_MEMORY_REASON');
        assert.ok(payload.memory.characters[0].includes('东港'));
        assert.ok(payload.memory.worldbook[0].includes('仅救援船'));
        assert.match(system,/结合始终可见的source世界书原文/);
        rows=payload.missingModules.map(module=>({module,text:`${W.PlainMemory.LABELS[module]}：测试用有效记录`}));
    }
    const output=rows.map(row=>JSON.stringify(row)).join('\n')+'\n{"end":true}';
    return new Response(`data: ${JSON.stringify({choices:[{delta:{content:output},finish_reason:'stop'}]})}\n\n`);
};
await W.Engine.plan({initialize:true});
assert.deepEqual(requests.map(row=>row.payload.task),['PLAIN_MEMORY_READ','PLAIN_MEMORY_REASON']);
const saved=W.Storage.load();
assert.equal(saved.runtime.plainReadIncomplete,false);
const diagnostics=W.Api.getDiagnostics().requests;
for(const row of diagnostics) {
    assert.equal(row.worldbookBooks,3);
    assert.equal(row.worldbookEntries,4);
    assert.equal(row.worldbookChars,entries.reduce((n,entry)=>n+entry.content.length,0));
}
const story=W.Injection.compose(saved);
assert.ok(story.includes('针灸医师'));
assert.ok(!story.includes(raw) && !story.includes(long),'full originals are not inserted into the story prompt');
const native={globalLore:[{world:'GLOBAL',uid:1,content:books.GLOBAL.entries[1].content}],characterLore:[{world:'MAIN',uid:1,content:raw}],chatLore:[],personaLore:[]};
await W.WorldbookSemantic._test.injectNative(native);
assert.equal(native.globalLore.length,0);
assert.equal(native.characterLore.length,0);
assert.equal(native.chatLore.length,1);
assert.ok(native.chatLore[0].content.includes('仅救援船'));
assert.ok(!native.chatLore[0].content.includes(long));
assert.deepEqual(W.PlainMemory._test.compactSource(fullSource,saved).worldbooks.flatMap(book=>book.entries.map(entry=>entry.text)),entries.map(entry=>entry.content),'post-read plugin inputs remain full despite story filtering');
console.log('PASS full grounding: real selection/source/prompt/HTTP pipeline, first-pass extraction, second-pass original+memory, stale receipt immunity, full long entry, compact story injection and exact input counts. Real API calls: 0.');
