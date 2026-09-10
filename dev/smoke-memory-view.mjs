import assert from 'node:assert/strict';
globalThis.window=globalThis;
globalThis.WorldStateMachine={};
await import('../src/defaults.js');
await import('../src/storage.js');
await import('../src/state-logic.js');
await import('../src/plain-memory.js');
await import('../src/memory-view.js');
await import('./memory-view-fixture.js');
const WSM=WorldStateMachine;
const state=WSM.PlainMemory.normalize({storageFormat:'sentences-v1',memory:memoryViewFixture,identities:{user:'林知夏',char:'夏以昼'},planner:{notes:['等待主角决定。']}});
const before=JSON.stringify(state);
for(const module of [...WSM.PlainMemory.MODULES,'planner']) {
    const html=WSM.MemoryView.render(state,module);
    assert.match(html,new RegExp(`data-memory-view="${module}"`),module);
    assert.doesNotMatch(html,/undefined|NaN|\[object Object\]/,module);
}
assert.equal(JSON.stringify(state),before,'rendering must not change memory, reminders or injection state');
assert.match(WSM.MemoryView.render(state,'map'),/aria-label="地点层级"/);
assert.equal((WSM.MemoryView.render(state,'map').match(/wsm-mv-map-name">昭国</g)||[]).length,1,'shared ancestors merge');
assert.match(WSM.MemoryView.render(state,'map'),/当前位置/);
assert.match(WSM.MemoryView.render(state,'characters'),/wsm-mv-location/);
assert.match(WSM.MemoryView.render(state,'relationships'),/夏以昼 → 林知夏/);
assert.match(WSM.MemoryView.render(state,'relationships'),/林知夏 → 夏以昼/);
assert.equal((WSM.MemoryView.render(state,'organizations').match(/class="wsm-mv-card wsm-mv-organizations"/g)||[]).length,3);
assert.match(WSM.MemoryView.render(state,'knowledge'),/不知情者/);
assert.match(WSM.MemoryView.render(state,'worldRules'),/皇帝特许/,'rule exceptions remain visible');
assert.match(WSM.MemoryView.render(state,'tasks'),/尚缺沿途仓单/);
assert.match(WSM.MemoryView.render(state,'timeline'),/wsm-mv-history/);
assert.match(WSM.MemoryView.render(state,'causalEffects'),/现实路径/);
const legacy=WSM.PlainMemory.normalize({storageFormat:'sentences-v1',identities:{user:'夏寻樨',char:'夏以昼'},memory:{
    map:['夏以昼与夏寻樨目前身处淮州行馆的书房内。'],
    characters:['夏以昼是昭国皇帝，瞳孔为上紫下橙的渐变色，目前正在淮州行馆书房批阅奏折。','夏以昼喜欢吃苹果，最讨厌香菜。'],
    relationships:['夏以昼对夏寻樨有极强的占有欲和保护欲，将其视为唯一伴侣。','有人可能与其他人意见不同。'],
    organizations:['林曳担任兵部尚书，是夏以昼的绝对心腹。'],
}});
const legacyBefore=JSON.stringify(legacy);
const people=WSM.MemoryView.render(legacy,'characters');
assert.equal((people.match(/wsm-mv-person-head/g)||[]).length,1,'same character gets one overview');
assert.match(people,/淮州行馆 &gt; 书房/);
assert.match(people,/最讨厌香菜/,'legacy prose remains intact');
assert.match(WSM.MemoryView.render(legacy,'map'),/地点层级/);
assert.doesNotMatch(WSM.MemoryView.render(legacy,'map'),/>昭国</,'do not invent missing country levels');
assert.match(WSM.MemoryView.render(legacy,'relationships'),/夏以昼 → 夏寻樨/);
assert.doesNotMatch(WSM.MemoryView.render(legacy,'organizations'),/<h4>林曳<\/h4>/,'membership does not become a faction');
assert.equal(JSON.stringify(legacy),legacyBefore);
const ambiguous=WSM.PlainMemory.normalize({storageFormat:'sentences-v1',memory:{map:['甲国 > 京城 > 书房','乙国 > 京城 > 书房'],world:['位置：书房']}});
assert.doesNotMatch(WSM.MemoryView.render(ambiguous,'map'),/wsm-mv-here/,'ambiguous leaf names cannot choose a current node');
const pairs=WSM.MemoryView._test.mapPaths(['国家 > 城市','书房｜上级：城市'].map(WSM.MemoryView._test.parse));
assert.deepEqual(pairs.paths[1].names,['国家','城市','书房']);
const malicious=WSM.PlainMemory.normalize({storageFormat:'sentences-v1',memory:{characters:['<img src=x onerror=alert(1)>｜位置：<script>alert(2)</script>']}});
assert.doesNotMatch(WSM.MemoryView.render(malicious,'characters'),/<img|<script/);
assert.match(WSM.MemoryView.render(malicious,'characters'),/&lt;img/);
assert.equal(WSM.MemoryView.render(state,'sources'),null,'system diagnostics retain their existing views');
const conflict=WSM.PlainMemory.normalize({storageFormat:'sentences-v1',memory:{characters:['张三｜位置：京城','张三｜位置：北境']}});
assert.match(WSM.MemoryView.render(conflict,'characters'),/京城；北境/,'a local view cannot silently resolve conflicting locations');
const negated=WSM.PlainMemory.normalize({storageFormat:'sentences-v1',memory:{map:['张三并未身处行馆的书房内。']}});
assert.doesNotMatch(WSM.MemoryView.render(negated,'map'),/aria-label="地点层级"/,'negated presence is not a positive location');
await import('../src/ui.js');
const activityLocation=WSM.PlainMemory.normalize({storageFormat:'sentences-v1',memory:{
    characters:['林曳担任兵部尚书。'], npcActivities:['林曳负责圣驾在淮州城内的安保及随行护卫。'],
}});
assert.match(WSM.MemoryView.render(activityLocation,'activities'),/wsm-mv-location">⌖ 淮州城内<\/div>/);
assert.doesNotMatch(WSM.MemoryView.render(activityLocation,'characters'),/⌖ 淮州城内/,'responsibility location does not prove physical presence');
for (const prefix of ['林曳计划','林曳未','林曳曾经']) {
    activityLocation.memory.npcActivities=[`${prefix}负责在淮州城内的安保。`];
    assert.doesNotMatch(WSM.MemoryView.render(activityLocation,'activities'),/wsm-mv-location">⌖ 淮州城内<\/div>/);
}
activityLocation.memory.npcActivities=['林曳｜活动地点：淮州城门（推测）｜行动：安排护卫'];
assert.match(WSM.MemoryView.render(activityLocation,'activities'),/⌖ 淮州城门（推测）/);
assert.match(WSM.UI._test.renderSectionForTest(state,'overview'),/wsm-mv-world/);
assert.match(WSM.UI._test.renderSectionForTest(state,'activities'),/当前活动/);
assert.match(WSM.UI._test.renderMapForTest(state),/地点层级/,'the real UI selects the semantic view');
console.log('All memory views passed: hierarchy, faction identity, character grouping, relationship direction, legacy preservation, ambiguity, escaping and no mutation.');
