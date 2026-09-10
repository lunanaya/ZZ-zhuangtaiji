import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
globalThis.window=globalThis;
globalThis.WorldStateMachine={version:'test',Settings:{get:()=>({useTavernApi:false,endpoint:'https://private.invalid/v1',apiKey:'PRIVATE_KEY',model:'PRIVATE_MODEL',maxTokens:5000})}};
globalThis.SillyTavern={getContext:()=>({getRequestHeaders:()=>({})})};
globalThis.getRequestHeaders=()=>({});
await import('../src/api.js');
const api=WorldStateMachine.Api;
const complete=(...args)=>api.withCallBudget(1,'diagnostic-test',()=>api.complete(...args));
const realNow=Date.now;
let now=1000,calls=0;
Date.now=()=>now;
const packet=(event)=>new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
globalThis.fetch=async()=>{
    calls++; now=1020;
    const packets=[
        [1030,new TextEncoder().encode(': ping\n\n')],
        [1050,packet({choices:[{delta:{reasoning_content:'PRIVATE_REASONING'}}]})],
        [1080,packet({choices:[{delta:{content:'{"module":"characters","text":"PRIVATE_STORY"}\n'}}]})],
        [1120,packet({choices:[{delta:{content:'{"end":true}'}}]})],
    ];
    return {ok:true,status:200,body:{getReader:()=>({
        read:async()=>{const [at,value]=packets.shift();now=at;return {done:false,value};},
        cancel:async()=>{},
    })}};
};
try {
    const result=await complete('PRIVATE_INSTRUCTION',{task:'PLAIN_MEMORY_READ',source:{worldbooks:[{name:'PRIVATE_BOOK',entries:[{text:'PRIVATE_SOURCE'}]}]}},
        {singleAttempt:true,stream:true,jsonContract:'sentences'});
    assert.equal(result.factStream.end,true);
    const row=api.getDiagnostics().requests[0];
    assert.equal(row.firstPacketMs,30,'heartbeat counts as packet arrival');
    assert.equal(row.firstTextMs,80,'heartbeat and reasoning are not visible text');
    assert.equal(row.durationMs,120);
    assert.equal(row.reasoningChars,'PRIVATE_REASONING'.length);
    assert.equal(row.worldbookBooks,1);
    assert.equal(row.worldbookEntries,1);
    assert.equal(row.worldbookChars,'PRIVATE_SOURCE'.length);
    assert.equal(row.route,'independent');
    assert.equal(row.ended,true);
    assert.equal(calls,1);
    api.recordValidation({phase:2,complete:false,ended:true,recordCount:2,errorCount:1,replacementErrors:1,missingModules:['factAnchors','resourceConstraints']});
    assert.equal(api.getDiagnostics().validations[0].replacementErrors,1);
    assert.doesNotMatch(JSON.stringify(api.getDiagnostics()),/PRIVATE_|private\.invalid/,'diagnostics exclude source, prompt, model, address and credentials');
    row.route='tampered';
    assert.equal(api.getDiagnostics().requests[0].route,'independent','returned snapshots cannot mutate diagnostics');
    globalThis.fetch=async()=>{calls++;now+=10;throw new Error('PRIVATE_ERROR');};
    await assert.rejects(complete('secret',{task:'PLAIN_MEMORY_REASON'},{singleAttempt:true}),/PRIVATE_ERROR/);
    assert.equal(api.getDiagnostics().requests.at(-1).outcome,'error');
    assert.doesNotMatch(JSON.stringify(api.getDiagnostics()),/PRIVATE_ERROR/);
    for(let i=0;i<8;i++)await assert.rejects(complete('secret',{task:'PLAIN_MEMORY_READ'},{singleAttempt:true}));
    assert.equal(api.getDiagnostics().requests.length,6,'request history stays bounded');
    assert.equal(calls,10,'diagnostics never add requests');
} finally {Date.now=realNow;}
const ui=await readFile(new URL('../src/ui.js',import.meta.url),'utf8');
assert.match(ui,/<details id="wsm-read-diagnostics">/);
assert.match(ui,/textarea\.focus\(\); textarea\.select\(\)/,'manual copy works when clipboard permission is unavailable');
console.log('PASS read diagnostics: packet/text timing, privacy, failure, bounded history and manual-copy fallback');
