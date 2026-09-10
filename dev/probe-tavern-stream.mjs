import fs from 'node:fs/promises';
const settings = JSON.parse(await fs.readFile(new URL('../../../../../../data/default-user/settings.json',import.meta.url),'utf8')).oai_settings;
if (settings.chat_completion_source !== 'openai') throw new Error('Probe only supports the configured OpenAI-compatible connection');
const base = 'http://127.0.0.1:8011';
const csrfResponse = await fetch(`${base}/csrf-token`);
const {token} = await csrfResponse.json();
const cookies = csrfResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const started = Date.now();
const response = await fetch(`${base}/api/backends/chat-completions/generate`,{
    method:'POST', signal:AbortSignal.timeout(45000),
    headers:{'Content-Type':'application/json','X-CSRF-Token':token,Cookie:cookies},
    body:JSON.stringify({chat_completion_source:'openai',model:settings.openai_model,
        reverse_proxy:settings.reverse_proxy,proxy_password:settings.proxy_password,
        max_tokens:1024,stream:true,messages:[{role:'user',content:'Reply with exactly the JSON object {"ok":true}.'}],
    }),
});
const raw = await response.text();
const events = raw.split('\n').filter(line => line.startsWith('data:')).map(line => {try{return JSON.parse(line.slice(5));}catch{return null;}}).filter(Boolean);
const output = events.map(event => event.choices?.[0]?.delta?.content || '').join('');
const error = events.find(event => event.error)?.error;
console.log(JSON.stringify({httpStatus:response.status,contentType:response.headers.get('content-type'),durationMs:Date.now()-started,eventCount:events.length,outputChars:output.length,ok:output.includes('"ok"') && output.includes('true'),error:typeof error === 'object' ? error.message : error, ...(!response.ok ? {detail:raw.slice(0,600)} : {})}));
