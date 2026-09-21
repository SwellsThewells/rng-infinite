// Serveur de dev : le site + les fonctions /api, avec une base Redis en mémoire (aucun compte nécessaire).
//   node tools/dev.mjs   →   http://localhost:8124
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fakeRedis } from './fake-redis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8124);
const require = createRequire(import.meta.url);

// Les fonctions parlent à "Upstash" : on intercepte ces appels vers le faux Redis, le reste passe (clés Google…).
process.env.KV_REST_API_URL = 'http://fake-redis.local';
process.env.KV_REST_API_TOKEN = 'dev';
const memory = fakeRedis();
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => (url === 'http://fake-redis.local/pipeline'
  ? Promise.resolve({ ok: true, json: async () => memory.run(JSON.parse(opts.body)) })
  : realFetch(url, opts));

const API = Object.fromEntries(['roll', 'leaderboard', 'auth', 'history', 'name', 'profile'].map(name => [name, require(path.join(ROOT, `api/${name}.js`))]));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const handler = API[url.pathname.slice(5)];
    if (!handler) { res.statusCode = 404; return res.end('{"error":"Not found"}'); }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    req.body = raw ? JSON.parse(raw) : {};
    return handler(req, res);
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(PORT, () => console.log(`RNG∞ dev : http://localhost:${PORT} (API + Redis en mémoire)`));
