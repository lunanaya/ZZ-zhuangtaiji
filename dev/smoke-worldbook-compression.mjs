import assert from 'node:assert/strict';
globalThis.window = globalThis;
globalThis.WorldStateMachine = {};
await import('../src/worldbook-memory.js');
const W = WorldStateMachine.WorldbookMemory;
const rule = '只有持有内院许可并通过守卫核验时才可进入，每日最多两次；持皇帝特许者例外。';
const source = Array.from({length:24},(_,i)=>`${i+1}. ${rule}\n`).join('')+'陆衡只听说过此事，尚未确认；这不是已经完成的行动。';
const compact = W.transmission(source);
assert.equal(compact.mode,'compact');
assert.ok(compact.sentChars < source.length);
assert.equal(W._test.expand(compact.packed),source,'all characters, order, repetition, conditions and exceptions must reconstruct exactly');
assert.ok(compact.text.includes('每日最多两次'));
assert.ok(compact.text.includes('持皇帝特许者例外'));
assert.ok(compact.text.includes('尚未确认'));
assert.equal(W._test.verify(source,compact.packed),true);
assert.equal(W.transmission(source),compact,'repeated turns reuse one derived encoding');
assert.equal(Object.isFrozen(compact.packed['规则短语']),true);
const mutated = structuredClone(compact.packed);
const firstToken = Object.keys(mutated['规则短语'])[0];
mutated['规则短语'][firstToken] = mutated['规则短语'][firstToken].replace('只有','只要');
assert.equal(W._test.verify(source,mutated),false,'changing a necessary condition into sufficient is rejected');
const added = structuredClone(compact.packed);
added['规则短语']['〔额外〕']='守卫可以任意撤销许可。';
assert.equal(W._test.verify(source,added),false,'unused invented definitions are also forbidden');
const omitted = structuredClone(compact.packed);
omitted['原文顺序'] = omitted['原文顺序'].replace('陆衡只听说过此事，尚未确认；','');
assert.equal(W._test.verify(source,omitted),false,'omitted knowledge boundaries fail');
const reordered = structuredClone(compact.packed);
reordered['原文顺序'] = reordered['原文顺序'].split('\n').reverse().join('\n');
assert.equal(W._test.verify(source,reordered),false,'causal/source order cannot change');
const recursive = structuredClone(compact.packed);
recursive['规则短语'][firstToken] = firstToken;
assert.equal(W._test.verify(source,recursive),false);
assert.equal(W._test.verify(source,{'规则短语':{},'原文顺序':source}),false);
assert.equal(W._test.verify(source,null),false);
assert.equal(W._test.verify(source,{...compact.packed,extra:'未经证实的信息'}),false);

const revised = source.replaceAll('每日最多两次','每日最多一次');
assert.equal(W._test.verify(revised,compact.packed),false,'source changes invalidate prior encodings');
assert.equal(W._test.expand(W.transmission(revised).packed),revised);
for (const original of ['', '雨停了。', '若遇雷雨，陆衡留在书房；否则前往城门。', '命令原文包含〔规1〕，不得当作系统符号。\n'+source,
    source.replaceAll('\n','\r\n'), source+'“引号”、\\斜线与 😀 均须保留。']) {
    const result=W.transmission(original);
    assert.equal(result.mode==='compact' ? W._test.expand(result.packed) : result.text,original);
    assert.ok(result.sentChars<=original.length,'including formatting, compression cannot make content longer');
}
assert.equal(W.transmission('雨停了。').mode,'original');
// A shared long condition can be abbreviated even when each conclusion differs.
const shared = Array.from({length:18},(_,i)=>`只有在每月初一且持有内院通行令并通过守卫核验时，才可领取第${i+1}种物资。`).join('\n');
assert.equal(W.transmission(shared).mode,'compact');
assert.equal(W._test.expand(W.transmission(shared).packed),shared);
const state={runtime:{worldbookSources:{one:{key:'one',content:source}}}};
assert.equal(W.fallback(state)[0].transmission.mode,'compact');
assert.equal(W.fallback(state,[source]).length,0,'full raw coverage still avoids duplicate delivery');
assert.equal(state.runtime.worldbookSources.one.content,source,'original remains immutable');
console.log(JSON.stringify({originalChars:source.length,sentChars:compact.sentChars,savedPercent:Math.round((1-compact.sentChars/source.length)*100),apiCalls:0}));
console.log('Verified rule shorthand: exact reconstruction, no additions/omissions/reordering, changed-source invalidation, literal symbols, fallback and shared prerequisites passed.');
