import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class { constructor(type,options) {this.type=type;this.detail=options?.detail;} };
globalThis.dispatchEvent = () => {};
globalThis.addEventListener = () => {};
const local = new Map();
globalThis.localStorage = {getItem:key=>local.get(key),setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)};
const chats={a:{},b:{}};
let active='a';
const registered = new Map(), handlers = new Map();
const eventSource={on:(name,fn)=>handlers.set(name,fn),off:name=>handlers.delete(name)};
const context=()=>({chatId:active,characterId:0,name1:'旅人',name2:'陆衡',chatMetadata:chats[active],chat:[],saveChat:async()=>{},eventSource,
    setExtensionPrompt:(id,value)=>registered.set(id,value)});
globalThis.SillyTavern={getContext:context};
for (const name of ['defaults','facts','storage','state-logic','worldbook-memory','plain-memory','worldbook-semantic']) await import(`../src/${name}.js`);
const W=WorldStateMachine;
const settings={enabled:true,injectionModules:structuredClone(W.Defaults.INJECTION_MODULES),worldbookCompiler:{enabled:true,injectionPosition:'after_character',entryKeys:['书::1']}};
W.Settings={get:()=>settings};
W.Context={context,identityNames:()=>({user:'旅人',char:'陆衡'}),latestUserMessage:()=>({content:'去青石城向陆衡询问星砂。'})};
for (const name of ['worldbook-compiler','injection','engine','ui']) await import(`../src/${name}.js`);
const entry={key:'书::1',bookName:'书',comment:'完整世界观',content:'青石城位于北境。陆衡是医师，擅长针灸。不得进入内院，除非持有令牌。星砂在朔日发光。'};
const long={...entry,key:'书::2',content:'远方设定细节。'.repeat(2500)};
settings.worldbookCompiler.entryKeys.push(long.key);
let calls=0;
const newRows=[
    {module:'map',text:'北境 > 青石城'},
    {module:'characters',before:'陆衡｜当前位置：东港，正在出诊。',text:'陆衡｜身份：医师，擅长针灸｜当前位置：东港，正在出诊。'},
    {module:'worldRules',text:'不得进入内院，除非持有令牌。'},
    {module:'worldbook',before:'旧世界书地图：青石城位于北境。',text:''},
    {module:'worldbook',text:'星砂：朔日发光。'},
    {module:'worldbook',text:'远方设定细节。'},
];
W.Api={withCallBudget:async(max,label,fn)=>{assert.equal(max,1);return fn();},complete:async(prompt,payload,options)=>{
    calls++;
    assert.equal(payload.task,'PLAIN_MEMORY_WORLDBOOK_READ');
    assert.equal(options.jsonContract,'sentences');
    assert.equal(payload.worldbooks[1].text,long.content,'full long book is sent once, without splitting or sampling');
    assert.ok(!('units' in payload) && !('evidence' in payload));
    return {factStream:{facts:newRows,patches:[],end:true}};
}};
let state=W.Storage.load();
state.memory.characters=['陆衡｜当前位置：东港，正在出诊。'];
state.memory.worldbook=['旧世界书地图：青石城位于北境。'];
state.initialized=true;
await W.Storage.save(state,'fixture',{snapshot:false});
const result=await W.WorldbookCompiler.compileConfig(settings.worldbookCompiler,{entries:[entry,long]});
assert.equal(W.WorldbookCompiler._test.nativeEntryKey({world:'书',uid:1,key:['青石城']}),`${encodeURIComponent('书')}::1`,'native keyword array is not an entry ID');
assert.equal(result.count,2);
assert.equal(calls,1);
state=W.Storage.load();
assert.ok(state.memory.map.includes('北境 > 青石城'));
assert.ok(state.memory.characters.some(row=>row.includes('针灸') && row.includes('东港')));
assert.equal(state.memory.characters.length,1,'reuse existing replacement logic without duplicate character');
assert.equal(state.memory.worldbook.length,2,'misplaced old content moves out of supplement');
assert.equal(W.WorldbookMemory.fallback(state).length,0,'successfully read originals stop circulating');
assert.ok(W.WorldbookSemantic.hasRead(state,entry),'read marker survives storage');
const rawSource={worldbooks:[{name:entry.bookName,entries:[entry,long]}]};
assert.deepEqual(W.WorldbookMemory.forRead(state,rawSource).worldbooks,[],'completed compression prevents repeat original input');
const legacyState=structuredClone(state);
legacyState.runtime.worldbookRead[entry.key]=W.Facts.hash(entry.content);
assert.equal(W.WorldbookMemory.forRead(legacyState,rawSource).worldbooks[0].entries.length,1,'legacy extraction must be compressed once under the new contract');
const changedSource=structuredClone(rawSource);
changedSource.worldbooks[0].entries[1].content+='新增地点：西港。';
assert.deepEqual(W.WorldbookMemory.forRead(state,changedSource).worldbooks[0].entries.map(row=>row.key),[long.key],'only a changed entry is read again');
assert.ok(W.PlainMemory.canInitialize({...state,initialized:false}),'reading worldbooks first must not prevent later chat initialization');
const prompts=W.PlainMemory.composeByDepth(state);
assert.ok(prompts.worldbook.includes('星砂：朔日发光'));
assert.ok(!Object.values(prompts).join('\n').includes(entry.content));
assert.ok(!prompts.worldbook.includes('针灸'));
assert.ok([...registered.values()].join('\n').includes('针灸'));
assert.ok(![...registered.values()].join('\n').includes('星砂：朔日发光'),'supplement must not also use depth prompt');
const payload={globalLore:[],characterLore:[],chatLore:[],personaLore:[]};
const sameArray=payload.chatLore;
for (const [position,expected] of Object.entries(W.WorldbookSemantic.POSITIONS)) {
    assert.equal(W.WorldbookSemantic._test.nativePosition(position,true),expected);
    if (position.includes('character')) {
        settings.worldbookCompiler.injectionPosition=position;
        await W.WorldbookSemantic._test.injectNative(payload);
        assert.equal(payload.chatLore,sameArray);
        assert.equal(payload.chatLore.length,1);
        assert.equal(payload.chatLore[0].position,expected);
        assert.equal(payload.chatLore[0].ignoreBudget,true);
    } else assert.equal(W.WorldbookSemantic._test.nativePosition(position,false),1);
}
settings.enabled=false;
await W.WorldbookSemantic._test.injectNative(payload);
assert.equal(payload.chatLore.length,0);
settings.enabled=true;
const before=structuredClone(state.memory);
W.Api.complete=async()=>{throw new Error('mock failure');};
await assert.rejects(W.WorldbookSemantic.compile([entry]),/mock failure/);
assert.deepEqual(W.Storage.load().memory,before);
W.Api.complete=async()=>({factStream:{facts:[{module:'worldRules',text:'截断不应保存'}],end:false}});
await assert.rejects(W.WorldbookSemantic.compile([entry]),/未完整结束/);
assert.deepEqual(W.Storage.load().memory,before);
W.Api.complete=async()=>{
    const changed=W.Storage.load(); changed.memory.characters.push('新正文的动态状态');
    await W.Storage.save(changed,'concurrent',{snapshot:false});
    return {factStream:{facts:[],end:true}};
};
await assert.rejects(W.WorldbookSemantic.compile([entry]),/已变化/);
assert.ok(W.Storage.load().memory.characters.includes('新正文的动态状态'));
active='b';
assert.equal(W.WorldbookMemory.originals(W.Storage.load()).length,0);
assert.ok(!W.PlainMemory.composeByDepth(W.Storage.load()).worldbook);
active='a';
// Raw fallback must obey ST's current mounts and switches on every injection,
// even before the user rereads or the persisted source cache is refreshed.
const backup=W.Storage.load();
const rawKey=`${encodeURIComponent('B')}::9`;
const rawEntry={key:rawKey,bookName:'B',content:'ONLY LIVE ENABLED SOURCE'};
backup.runtime.worldbookSources[rawKey]=rawEntry;
settings.worldbookCompiler.entryKeys.push(rawKey);
await W.Storage.save(backup,'raw-fixture',{snapshot:false});
for (const [nativeEntries,selected,expected] of [
    [[],true,false],
    [[{world:'B',uid:9,content:rawEntry.content,disable:true}],true,false],
    [[{world:'B',uid:9,content:rawEntry.content,disable:false}],false,false],
    [[{world:'B',uid:9,content:rawEntry.content,disable:false}],true,false],
]) {
    settings.worldbookCompiler.entryKeys=settings.worldbookCompiler.entryKeys.filter(key=>key!==rawKey);
    if(selected) settings.worldbookCompiler.entryKeys.push(rawKey);
    const livePayload={globalLore:[],characterLore:nativeEntries,chatLore:[],personaLore:[]};
    await W.WorldbookSemantic._test.injectNative(livePayload);
    assert.equal(livePayload.chatLore.some(row=>row.content.includes(rawEntry.content)),expected);
    if(selected) assert.ok(!livePayload.characterLore.some(row=>row.content===rawEntry.content),'managed originals never reach native story prompts');
}
W.Context.listWorldbookEntries=async()=>[];
await assert.rejects(W.WorldbookSemantic.compile([entry]),/没有已勾选且开启/,'stale picker entries cannot reach API after unmount');
delete W.Context.listWorldbookEntries;
const html=W.UI._test.renderSectionForTest(W.Storage.load(),'worldbook');
assert.ok(html.includes('已拆解压缩'));
assert.ok(!/覆盖已通过|待核对|引用覆盖/.test(html));
console.log('PASS worldbook read: one request, existing sentence updates, original suppression, anchors, failures and chat isolation');
