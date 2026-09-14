import assert from 'node:assert/strict';
globalThis.window=globalThis;globalThis.WorldStateMachine={};
globalThis.CustomEvent=class {constructor(type,options){this.type=type;this.detail=options?.detail;}};
globalThis.dispatchEvent=()=>{};
const local=new Map();
globalThis.localStorage={getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)};
const ctx={chatId:'fidelity',characterId:0,name1:'访客',name2:'陆衡',chatMetadata:{},chat:[],saveChat:async()=>{}};
globalThis.SillyTavern={getContext:()=>ctx};
for(const name of ['defaults','facts','storage','state-logic','worldbook-memory','plain-memory','worldbook-semantic'])await import(`../src/${name}.js`);
const W=WorldStateMachine,P=W.PlainMemory;
const settings={enabled:true,injectionModules:W.Defaults.INJECTION_MODULES,worldbookCompiler:{enabled:true}};
W.Settings={get:()=>settings};
const person='陆衡｜温和寡言，擅长针灸，闲时修木船；与叶川私交好，商谈时仍优先医馆利益；位置：东港';
const city='青石城｜北境河港，修船业与药材贸易发达；旧城生活缓慢，节庆时开放水市';
const rules=['医生不得查阅非本人接诊病历；患者授权或依法协诊时例外。','居民有独立职业和社交，不默认围绕访客行动。','财富提供资源，不自动赋予强控制欲、超常能力或支配权。'];
const raw=[person,city,...rules,'地理说明。'.repeat(1600),'末尾独有例外：冬季封港期间仅救援船可通行。'].join('\n');
const entry={key:`${encodeURIComponent('原书')}::1`,id:1,bookName:'原书',title:'人物与制度',content:raw};
settings.worldbookCompiler.entryKeys=[entry.key];
const source={character:{name:'陆衡',description:'陆衡在东港行医。'},persona:'访客',worldbooks:[{name:'原书',entries:[entry]}],chat:[]};
W.Context={context:()=>ctx,identityNames:()=>({user:'访客',char:'陆衡'}),latestUserMessage:()=>({content:'继续'}),
 selectedWorldbooks:async()=>({books:source.worldbooks,diagnostics:{failedNames:[]}})};
let state=P.normalize({storageFormat:P.FORMAT,initialized:true,memory:{world:['位置：东港'],characters:['陆衡｜医师｜位置：东港'],worldRules:['社会遵循惯例。']}});
state.runtime.worldbookRead={[entry.key]:`logic-v2:${W.Facts.hash(raw)}`};
state=await W.Storage.save(state,'fixture',{snapshot:false});
const calls=[];
W.Api={complete:async(system,payload,options)=>{
 calls.push({system,payload,options});
 if(payload.task!=='PLAIN_MEMORY_WORLDBOOK_READ')return {factStream:{facts:[],end:true}};
 assert.equal(payload.worldbooks[0].text,raw,'all original text, including the last exception, reaches the reader');
 assert.equal(options.jsonContract,'sentences');
 assert.ok(!('coverage' in payload)&&!('units' in payload),'no new output/report protocol');
 return {factStream:{facts:[{module:'characters',before:'陆衡｜医师｜位置：东港',text:person},
  {module:'worldRules',before:'社会遵循惯例。',text:rules[0]},...rules.slice(1).map(text=>({module:'worldRules',text})),
  {module:'map',text:city},{module:'worldRules',text:'冬季封港期间仅救援船可通行。'}],end:true}};
}};
assert.equal(W.WorldbookSemantic.hasRead(state,entry),false);
state=(await W.WorldbookSemantic.read(state,[entry])).state;
assert.equal(calls.length,1,'worldbook reread remains one request');
assert.deepEqual(state.memory.characters,[person]);
assert.ok(state.memory.map.includes(city));
assert.ok(state.memory.worldRules.includes(rules[0]));
assert.ok(state.memory.worldRules.includes(rules[1]));
assert.ok(state.memory.worldRules.includes(rules[2]));
assert.ok(state.memory.worldRules.includes('冬季封港期间仅救援船可通行。'));
assert.equal(W.WorldbookSemantic.hasRead(state,entry),true);
assert.equal(W.WorldbookMemory.originals(state)[0].content,raw,'backup remains exact');
state=await W.Storage.save(state,'worldbook-read',{snapshot:false});
const reloaded=P.normalize(P.pack(state));
assert.deepEqual(reloaded.memory,state.memory,'save/serialize never turns detailed facts into a summary');
const moved=P.apply(reloaded,[{module:'characters',before:person,text:person.replace('位置：东港','位置：医馆')}]);
assert.deepEqual(moved.errors,[]);
assert.ok(moved.state.memory.characters[0].includes('商谈时仍优先医馆利益'));
assert.ok(moved.state.memory.characters[0].includes('闲时修木船'));
assert.ok(moved.state.memory.map.includes(city));

for(const task of ['PLAIN_MEMORY_READ','PLAIN_MEMORY_REASON','PLAIN_MEMORY_ORGANIZE'])await P._test.request('',{task,source,memory:state.memory});
for(const {system} of calls){
 assert.match(system,/逐项精简表达，不写整书摘要/);
 assert.match(system,/不把整批人物压成姓名与身份名单/);
 assert.match(system,/全局运作规则放worldRules/);
 assert.match(system,/不能替代财富与人格、私人关系与组织利益/);
 assert.match(system,/不再次整体概括/);
 assert.match(system,/旧记录若是模型的整理计划/);
 assert.doesNotMatch(system,/随后对worldbook的剩余设定再次合并压缩/);
}
await P._test.request('',{task:'PLAIN_MEMORY_SETTLE',memory:state.memory,assistantMessage:{content:'陆衡走进医馆。'},source});
const settle=calls.at(-1);
assert.equal(settle.payload.source,undefined,'ordinary settlement still excludes original sources');
assert.deepEqual(settle.payload.memory,state.memory,'all stored detail reaches the updating model');
assert.match(settle.system,/不能以新位置、衣着或当前动作覆盖整条稳定设定/);
assert.match(settle.system,/世界书补充不重新概括/);
assert.ok(settle.system.length<4096);
console.log('Worldbook fidelity passed: full selected original, tail exception, one-call reread, detailed fixture roundtrip, receipt migration, shared rules and unchanged settlement protocol. Mock model output; not a real-model completeness evaluation.');
