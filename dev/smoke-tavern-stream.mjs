import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { chatCompletionErrorMessage } from '../../../../../../src/endpoints/backends/chat-completion-error.js';

const activeSettings = {chat_completion_source:'openai', openai_model:'gemini-test', reverse_proxy:'https://configured.example/v1', proxy_password:'test-credential', openai_max_tokens:50000, stream_openai:false};
const original = structuredClone(activeSettings);
const pluginSettings = {useTavernApi:true, endpoint:'https://unused.example/v1', apiKey:'must-not-leak', model:'unused-model', maxTokens:9000};
let calls = 0;
let mode = 'success';
let requestSignal;
const chatModule = {
    oai_settings:activeSettings,
    getChatCompletionModel:settings => settings.openai_model,
    async createGenerationParameters(settings, model, type, messages) {
        assert.equal(type,'quiet');
        assert.equal(settings.openai_max_tokens,9000);
        assert.equal(settings.reasoning_effort,'low');
        return {generate_data:{model, messages, chat_completion_source:settings.chat_completion_source, reverse_proxy:settings.reverse_proxy, proxy_password:settings.proxy_password, max_tokens:settings.openai_max_tokens, stream:false, stop:['}'], tools:[{}], tool_choice:'auto'}};
    },
};
const sandbox = {
    console, URL, TextDecoder, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, chatModule,
    getRequestHeaders:() => ({'Content-Type':'application/json','X-CSRF-Token':'test-csrf'}),
    SillyTavern:{getContext:() => ({mainApi:'openai', generateRaw:() => {throw new Error('Must not use non-streaming generateRaw');}})},
    WorldStateMachine:{Settings:{get:() => pluginSettings}},
    async fetch(url, options) {
        calls++;
        assert.equal(url,'/api/backends/chat-completions/generate');
        const body = JSON.parse(options.body);
        assert.equal(body.stream,true);
        assert.equal(body.reverse_proxy,original.reverse_proxy);
        assert.equal(body.proxy_password,'test-credential');
        assert.equal(body.model,'gemini-test');
        assert.equal(body.max_tokens,9000);
        assert.equal(body.stop,undefined);
        assert.equal(body.tools,undefined);
        assert.doesNotMatch(options.body,/must-not-leak|unused.example|unused-model/);
        assert.equal(options.headers['X-CSRF-Token'],'test-csrf');
        requestSignal=options.signal;
        if (mode === 'error') return new Response('{"error":{"message":"context length exceeded"}}',{status:400,statusText:'<none>'});
        if (mode === 'abort') return new Promise((_,reject) => options.signal.addEventListener('abort',() => reject(Object.assign(new Error('cancelled'),{name:'AbortError'})),{once:true}));
        const text = '{"module":"characters","text":"张三住在京城"}\n{"end":true}';
        return new Response(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:mode === 'length' ? 'length' : 'stop'}]})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});
    },
};
sandbox.window=sandbox;
// Replace only the browser module loader with a fixture; run the real API code.
const source = (await fs.readFile(new URL('../src/api.js',import.meta.url),'utf8')).replace("import('/scripts/openai.js')",'Promise.resolve(window.chatModule)');
vm.runInNewContext(source,sandbox);
const api=sandbox.WorldStateMachine.Api;
const run = signal => api.withCallBudget(1,'test',() => api.complete('Read facts',{task:'PLAIN_MEMORY_REASON'},{stream:true,singleAttempt:true,jsonContract:'sentences',reasoningEffort:'low',signal}));
assert.equal((await run()).factStream.end,true);
assert.deepEqual(activeSettings,original,'shared chat settings must not change');
mode='error';
await assert.rejects(run(),/400.*context length exceeded/);
assert.equal(calls,2,'upstream errors do not trigger extra paid requests');
mode='length';
assert.equal((await run()).factStream.end,false,'token truncation cannot claim initialization completed');
mode='abort';
const controller=new AbortController();
const pending=run(controller.signal);
while(calls<4) await new Promise(resolve => setTimeout(resolve,0));
controller.abort();
await assert.rejects(pending,/取消/);
assert.equal(requestSignal.aborted,true,'cancel reaches the actual backend request');
assert.equal(await api._test.prepareTavernStreamBody({mainApi:'textgenerationwebui'},[],{},chatModule),null);
assert.equal(chatCompletionErrorMessage(400,'<none>',{error:{message:'Invalid max_tokens'}}),'HTTP 400: Invalid max_tokens');
assert.match(chatCompletionErrorMessage(503,'<none>',{},'<html>error</html>'),/^HTTP 503: Upstream/);
assert.match(chatCompletionErrorMessage(429,'Too Many Requests',{error:{message:'insufficient quota'}}),/429: insufficient quota/);
console.log('Tavern streaming, error details, isolation and cancellation passed');
