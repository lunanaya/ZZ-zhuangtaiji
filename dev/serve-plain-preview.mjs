import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer(async (request,response) => {
    try {
        const route = decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
        if (!/^\/(?:preview\.html|(?:src|dev)\/[\w-]+\.js|styles\/[\w-]+\.css)$/.test(route)) {
            response.writeHead(404); response.end(); return;
        }
        const content = await readFile(path.join(root, route.slice(1)));
        const type = route.endsWith('.html') ? 'text/html' : route.endsWith('.css') ? 'text/css' : 'text/javascript';
        response.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store'});
        response.end(content);
    } catch (_) { response.writeHead(404); response.end(); }
});
server.listen(18871,'127.0.0.1',() => console.log('Local mock preview: http://127.0.0.1:18871/preview.html'));
