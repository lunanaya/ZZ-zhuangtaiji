import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
globalThis.CustomEvent = class {constructor(type,options){this.type=type;this.detail=options?.detail;}};
globalThis.dispatchEvent = () => {};
globalThis.addEventListener = () => {};
const data = new Map();
globalThis.localStorage = {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
const books = {
    A:{entries:{1:{uid:1,content:'城门允许通行'},2:{uid:2,content:'关闭的医师设定',disable:true},3:{uid:3,content:'北城在山脚'}}},
    B:{entries:{1:{uid:1,content:'另一张角色卡'}}},
    EXTRA:{entries:{1:{uid:1,content:'额外书设定'},2:{uid:2,content:'额外书关闭条目',disable:true}}},
};
const reads = [];
const ctx = {chatId:'selection',characterId:0,characters:[{avatar:'a.png',data:{extensions:{world:'A'}}}],chat:[],chatMetadata:{},
    getWorldInfoNames:()=>Object.keys(books),loadWorldInfo:async name=>{reads.push(name);return books[name];},saveChat:async()=>{},setExtensionPrompt:()=>{}};
globalThis.SillyTavern = {getContext:()=>ctx};
globalThis.selected_world_info = [];
for (const name of ['defaults','facts','storage','worldbook-memory','plain-memory','worldbook-semantic','context']) await import(`../src/${name}.js`);
const W = WorldStateMachine;
const settings = {enabled:true,worldbookCompiler:{enabled:true,entryKeys:[],knownEntryKeys:['A::1','A::2'],selectedBookNames:['A']}};
W.Settings = {get:()=>settings,update:()=>assert.fail('catalog/source reads must not change choices')};
const keys = source => W.WorldbookMemory.entries(source).map(entry=>entry.key);
const source = async () => {const current = await W.Context.selectedWorldbooks();return {worldbooks:current.books};};
const before = structuredClone(settings);
assert.deepEqual(keys(await source()),['A::1','A::3'],'legacy empty whitelist restores enabled mounted defaults');
const catalog = await W.Context.worldbookCatalog();
assert.deepEqual(catalog.mountedNames,['A']);
assert.deepEqual(catalog.availableNames,['A','B','EXTRA']);
assert.equal(catalog.books[0].entries.length,3,'disabled entries are visible for explicit opt-in');
assert.equal(reads.includes('EXTRA'),false,'listing library names does not read unselected books');
assert.deepEqual(settings,before,'read-only migration keeps settings untouched');

settings.worldbookCompiler = W.Context.editableWorldbookSelection(settings.worldbookCompiler,catalog.books[0].entries);
let config = settings.worldbookCompiler;
config.entryOverrides['A::1'] = false;
config.entryOverrides['A::2'] = true;
assert.deepEqual(keys(await source()),['A::2','A::3'],'manual override can omit enabled and include disabled entries');
const pending = await source();
const state = W.Storage.load();
W.WorldbookMemory.retain(state,pending);
assert.deepEqual(keys(W.WorldbookMemory.forRead(state,pending)),['A::2','A::3'],'selected disabled entries survive the full source/read pipeline');
assert.equal(books.A.entries[2].disable,true,'plugin selection never changes native switches');

config.entryOverrides['A::2'] = false; config.entryOverrides['A::3'] = false;
assert.deepEqual(keys(await source()),[],'explicit all-off stays empty rather than restoring defaults');
config.entryOverrides = {};
config.excludedBookNames = ['A'];
assert.deepEqual(keys(await source()),[],'whole-book opt-out applies before reading');
config.excludedBookNames = [];
config.extraBookNames = ['EXTRA'];
assert.deepEqual(keys(await source()),['A::1','A::3','EXTRA::1'],'explicit extra books participate with enabled defaults');
ctx.characters[0].data.extensions.world = 'B';
assert.deepEqual(keys(await source()),['B::1','EXTRA::1'],'switching cards drops old mounts but keeps explicit extras');
config.extraBookNames = [];
assert.deepEqual(keys(await source()),['B::1']);
assert.deepEqual(await W.Context.listWorldbookEntries({bookName:'A'}),[],'old selection alone cannot revive an unmounted book');

ctx.characters[0].data.extensions.world = 'A';
config.entryOverrides = {'A::2':true};
let calls = 0;
W.Api = {withCallBudget:async(max,label,fn)=>{assert.equal(max,1);return fn();},complete:async(_prompt,payload)=>{
    calls++;
    assert.equal(payload.worldbooks.length,1,'manual subset is respected');
    assert.equal(payload.worldbooks[0].text,'关闭的医师设定');
    return {factStream:{facts:[{module:'characters',text:'医师擅长针灸'}],patches:[],end:true}};
}};
const selected = (await W.Context.selectedWorldbooks()).books.flatMap(book=>book.entries);
await W.WorldbookSemantic.compile(selected.filter(entry=>entry.id==='2'));
let saved = W.Storage.load();
assert.deepEqual(W.WorldbookMemory.originals(saved).map(entry=>entry.key),['A::1','A::2','A::3'],'manual subset must not erase other selected source backups');
assert.deepEqual(saved.memory.characters,['医师擅长针灸']);
assert.equal(W.WorldbookSemantic.hasRead(saved,selected[1]),true);
assert.deepEqual(keys(W.WorldbookMemory.forRead(saved,await source())),['A::1','A::2','A::3'],'completed records stay available to plugin reasoning');
assert.equal(calls,1);

W.Api.complete = async()=>{calls++;config.entryOverrides['A::1']=false;return {factStream:{facts:[{module:'world',text:'不应写入'}],patches:[],end:true}};};
await assert.rejects(W.WorldbookSemantic.compile([selected[0]]),/选择在读取期间已变化/);
assert.deepEqual(W.Storage.load().memory,saved.memory,'changing selection during API generation prevents stale writes');
assert.equal(calls,2);
console.log('PASS worldbook selection: legacy empty recovery, enabled defaults, explicit all-off, disabled opt-in, extra books, card isolation, source receipts and concurrent selection. Real API calls: 0.');
