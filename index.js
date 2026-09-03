(function () {
    'use strict';

    const VERSION = '0.16.9';
    const baseUrl = new URL('./', import.meta.url).href;
    const modules = [
        'src/defaults.js',
        'src/facts.js',
        'src/settings.js',
        'src/storage.js',
        'src/dice.js',
        'src/context.js',
        'src/api.js',
        'src/worldbook-compiler.js',
        'src/source-reader.js',
        'src/injection.js',
        'src/engine.js',
        'src/ui.js',
    ];

    if (window.WorldStateMachine?.loaded) return;
    window.WorldStateMachine = Object.assign(window.WorldStateMachine || {}, {
        loaded: true,
        version: VERSION,
        baseUrl,
    });
    let resolveReady;
    const ready = new Promise((resolve) => { resolveReady = resolve; });
    // Some ST builds resolve the manifest interceptor immediately after loading
    // index.js. Keep a stable callable in place while feature modules load.
    window.WorldStateMachine_interceptGeneration = async (...args) => {
        await ready;
        return window.WorldStateMachine.Engine?.interceptor?.(...args);
    };

    const loadScript = (path) => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const url = new URL(path, baseUrl);
        url.searchParams.set('v', VERSION);
        script.src = url.href;
        script.async = false;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`无法加载模块：${path}`));
        document.head.appendChild(script);
    });

    async function boot() {
        try {
            for (const path of modules) await loadScript(path);
            await window.WorldStateMachine.Engine.init();
            resolveReady();
            window.WorldStateMachine.UI.mount();
            console.info(`[WorldStateMachine] v${VERSION} ready`);
        } catch (error) {
            resolveReady();
            console.error('[WorldStateMachine] 启动失败', error);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
