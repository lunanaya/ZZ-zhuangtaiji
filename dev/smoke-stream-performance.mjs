import assert from 'node:assert/strict';

globalThis.window=globalThis;
globalThis.getRequestHeaders=()=>({});
let progressReports=0;
globalThis.WorldStateMachine={Settings:{get:()=>({useTavernApi:false,endpoint:'https://example.invalid/v1',model:'test',maxTokens:5000})},Engine:{reportProgress:()=>progressReports++}};
await import('../src/api.js');
const api=WorldStateMachine.Api;
const encoder=new TextEncoder();
const nativeParse=JSON.parse;
const nativeNow=Date.now;

async function measure(count) {
    // "backend" makes v0.16.82 reparse every accumulated packet even before
    // the actual receipt. Thousands of small packets model a streaming gateway.
    const texts=Array.from({length:count},(_,i)=>JSON.stringify({module:'world',text:`记录${i}：当前状态保持。`})+'\n');
    texts.push('{"end":true}');
    const packets=texts.map(content=>encoder.encode('data: '+JSON.stringify({id:'backend-stream',choices:[{delta:{content}}]})+'\n\n'));
    const wireBytes=packets.reduce((n,packet)=>n+packet.length,0);
    globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){packets.forEach(packet=>controller.enqueue(packet));controller.close();}}));
    let parsedChars=0,parseCalls=0;
    progressReports=0;
    JSON.parse=function(input,...args){parseCalls++;parsedChars+=String(input).length;return nativeParse.call(JSON,input,...args);};
    Date.now=()=>10000;
    try {
        const result=await api.withCallBudget(1,'performance',()=>api.complete('test',{task:'PLAIN_MEMORY_READ'},{stream:true,jsonContract:'sentences',singleAttempt:true}));
        assert.equal(result.factStream.end,true);
        assert.equal(result.factStream.facts.length,count);
        assert.equal(result.factStream.facts.at(-1).text,`记录${count-1}：当前状态保持。`);
        assert.ok(parsedChars<wireBytes*5,'JSON parsing work must stay proportional to received data');
        assert.ok(parseCalls<count*6,'each packet/record is parsed only a bounded number of times');
        assert.equal(progressReports,1,'burst packets must not trigger a render per packet');
        return {packets:packets.length,wireBytes,parseCalls,parsedChars};
    } finally {JSON.parse=nativeParse;Date.now=nativeNow;}
}
const small=await measure(1000),large=await measure(2000);
assert.ok(large.parsedChars/small.parsedChars<2.2,'doubling stream length must not quadruple parsing work');
console.log(JSON.stringify({small,large,parseGrowth:large.parsedChars/small.parsedChars}));
console.log('Streaming work scales linearly; progress updates are throttled. Real API calls: 0.');
