// Offline inspection only: no provider requests and no state writes.
import fs from 'node:fs';
import path from 'node:path';
globalThis.window=globalThis;
globalThis.WorldStateMachine={};
globalThis.fetch=async()=>{throw new Error('Offline audit must not call an API');};
await import('../src/defaults.js');
await import('../src/storage.js');
await import('../src/state-logic.js');
await import('../src/plain-memory.js');
await import('../src/injection.js');
const WSM=WorldStateMachine;
const settings=JSON.parse(fs.readFileSync(path.resolve('../../../../../data/default-user/settings.json'),'utf8')).extension_settings?.worldStateMachine || {};
WSM.Settings={get:()=>({enabled:settings.enabled,injectionMaxChars:settings.injectionMaxChars,injectionModules:settings.injectionModules,storyPacing:settings.storyPacing,worldbookCompiler:{enabled:false}})};
WSM.Context={latestUserMessage:()=>({content:'继续'})};
const header=JSON.parse(fs.readFileSync('_backups/state-audit-20260910/chat-after-baseline.jsonl','utf8').split('\n')[0]);
const state=WSM.PlainMemory.normalize(Object.values(header.chat_metadata.worldStateMachine.chatStores)[0].state);
const injection=WSM.Injection.compose(state);
const stats={revision:state.revision,rows:Object.values(state.memory).flat().length,memoryChars:Object.values(state.memory).flat().join('\n').length,pluginInjectionChars:injection.length,
    clockParsed:WSM.Storage.storyTimestamp(state.memory.world.join('\n')),
    relativeTimeParsed:WSM.Storage.resolveReminderTime('三日后',Date.UTC(2026,8,10)),
    currentNpcActivitySelected:WSM.PlainMemory._test.selection(state,'npcActivities',state.memory.npcActivities[0]),
    outgoing:injection,
};
fs.writeFileSync('_backups/state-audit-20260910/outgoing-audit.json',JSON.stringify(stats,null,2));
console.log(JSON.stringify(stats,null,2));
