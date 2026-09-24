// Version autonome du jeu en une seule page HTML : le site + les fonctions /api qui tournent dans le navigateur.
//   node tools/artifact.mjs [sortie.html]   (par défaut : dist/rng-infinite.html)
// Tout est inliné (CSS, JS, émoticônes en data:). Les appels /api/* sont interceptés et servis par les vraies
// fonctions de api/, branchées sur le faux Redis de tools/fake-redis.mjs, sauvegardé dans le localStorage.
// Tirages, pièces, boutique, succès et duels contre les bots marchent ; le classement ne contient que ce navigateur.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist/rng-infinite.html'));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Un "</script>" dans du JS inliné fermerait la balise : "<\/script>" est équivalent en JS.
const safe = js => js.replace(/<\/script/gi, '<\\/script');

// Modules déjà chargés comme globales par la page : les fonctions /api les réutilisent au lieu d'une seconde copie.
const GLOBALS = {
  'js/engine.js': 'RNGEngine',
  'js/achievements.js': 'RNGAchievements',
  'js/shop.js': 'RNGShop',
  'js/config.js': 'RNG_CONFIG',
  'data/badge-meta.json': 'BADGE_META',
  'data/percentiles.json': 'SCORE_PERCENTILES',
};
const API_NAMES = ['roll', 'leaderboard', 'auth', 'history', 'name', 'profile', 'room', 'title', 'shop'];
const modules = ['api/_lib.js', ...API_NAMES.map(n => `api/${n}.js`)]
  .map(rel => `${JSON.stringify(rel)}: function (module, exports, require) {\n${read(rel)}\n}`)
  .join(',\n');

const backend = `
(function () {
  'use strict';
  ${read('tools/fake-redis.mjs').replace(/^export /m, '')}

  // ---- faux Redis persistant (Map = hash / zset, Set, Array = liste, sinon chaîne)
  const STORE_KEY = 'rnginf.server.v1';
  const memory = fakeRedis();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    for (const [k, t, v] of saved) memory.db.set(k, t === 'm' ? new Map(v) : t === 's' ? new Set(v) : v);
  } catch (e) {}
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const out = [];
      for (const [k, v] of memory.db) out.push([k, v instanceof Map ? 'm' : v instanceof Set ? 's' : 'v', v instanceof Map || v instanceof Set ? [...v] : v]);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (e) {}
    }, 300);
  };

  // ---- ce que les fonctions attendent de Node
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const len = ((bytes.length + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(len);
    m.set(bytes); m[bytes.length] = 0x80;
    const bits = bytes.length * 8;
    const dv = new DataView(m.buffer);
    dv.setUint32(len - 8, Math.floor(bits / 0x100000000)); dv.setUint32(len - 4, bits >>> 0);
    const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < len; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) >>> 0; });
    }
    return h.map(v => v.toString(16).padStart(8, '0')).join('');
  }
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const crypto = {
    randomBytes(n) {
      const b = crypto.getRandomValues(new Uint8Array(n));
      b.toString = () => hex(b);
      return b;
    },
    getRandomValues: a => window.crypto.getRandomValues(a),
    // Tirage uniforme dans [min, max) sans biais de modulo.
    randomInt(min, max) {
      const span = max - min, limit = Math.floor(0x100000000 / span) * span, u = new Uint32Array(1);
      do window.crypto.getRandomValues(u); while (u[0] >= limit);
      return min + (u[0] % span);
    },
    createHash: () => ({ update(s) { this.s = String(s); return this; }, digest() { return sha256Hex(this.s); } }),
  };
  const process = { env: { KV_REST_API_URL: 'http://fake-redis.local', KV_REST_API_TOKEN: 'local' } };
  const fetch = (url, opts) => (url === 'http://fake-redis.local/pipeline'
    ? Promise.resolve({ ok: true, json: async () => { const r = memory.run(JSON.parse(opts.body)); save(); return r; } })
    : Promise.reject(new Error('offline')));

  const FACTORIES = {
${modules}
  };
  const GLOBALS = ${JSON.stringify(GLOBALS)};
  const cache = {};
  function load(id) {
    if (GLOBALS[id]) return window[GLOBALS[id]];
    if (cache[id]) return cache[id].exports;
    const module = cache[id] = { exports: {} };
    FACTORIES[id].call(module.exports, module, module.exports, spec => load(resolve(id, spec)));
    return module.exports;
  }
  function resolve(from, spec) {
    if (spec === 'node:crypto' || spec === 'crypto') return '#crypto';
    const parts = from.split('/').slice(0, -1);
    for (const seg of spec.split('/')) {
      if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
    }
    const id = parts.join('/');
    return /\\.(js|json)$/.test(id) ? id : id + '.js';
  }
  cache['#crypto'] = { exports: crypto };

  // ---- les appels /api/* de la page vont aux fonctions locales
  const handlers = {};
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const match = /^\\/api\\/([a-z]+)/.exec(url);
    if (!match) return realFetch(input, options);
    const name = match[1];
    return new Promise(done => {
      const headers = {};
      const res = {
        statusCode: 200,
        setHeader: (k, v) => { headers[k] = v; },
        end: body => done(new Response(res.statusCode === 204 ? null : body || '', { status: res.statusCode, headers })),
      };
      let body = {};
      try { body = options.body ? JSON.parse(options.body) : {}; } catch (e) {}
      const req = { method: (options.method || 'GET').toUpperCase(), url, body, headers: {} };
      try {
        if (!API_NAMES.includes(name)) throw Object.assign(new Error('Not found'), { status: 404 });
        const handler = handlers[name] || (handlers[name] = load('api/' + name + '.js'));
        Promise.resolve(handler(req, res)).catch(err => done(new Response(JSON.stringify({ error: err.message }), { status: 500 })));
      } catch (err) {
        done(new Response(JSON.stringify({ error: err.message }), { status: err.status || 500 }));
      }
    });
  };
  const API_NAMES = ${JSON.stringify(API_NAMES)};
})();
`;

// ---- la page
const emotes = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'img/emotes')).filter(f => f.endsWith('.png'))
  .map(f => [f.slice(0, -4), `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'img/emotes', f)).toString('base64')}`]));

let html = read('index.html');
const scripts = [...html.matchAll(/<script src="(js\/[\w-]+\.js)(?:\?v=\w+)?"><\/script>/g)].map(m => m[1]);
if (!scripts.includes('js/app.js')) throw new Error('index.html : scripts introuvables');

const inlineScript = rel => {
  let js = read(rel);
  if (rel === 'js/app.js') {
    js = js.split('img/emotes/${id}.png').join('${window.RNG_EMOTES[id]}');
    if (js.includes('img/emotes/')) throw new Error('app.js : chemin d\'émoticône non remplacé');
  }
  let out = `<script>\n${safe(js)}\n</script>`;
  // Pas de connexion Google ici : le script de Google est bloqué et le compte vit dans ce navigateur.
  if (rel === 'js/config.js') out += `\n<script>window.RNG_CONFIG.googleClientId = '';</script>`;
  if (rel === 'js/app.js') out = `<script>window.RNG_EMOTES = ${JSON.stringify(emotes)};</script>\n<script>\n${safe(backend)}\n</script>\n` + out;
  return out;
};

html = html
  // La page est enveloppée dans son propre squelette : on ne garde que le contenu.
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<link rel="canonical"[^>]*>\s*/i, '')
  // Redirection vers rng-infinite.com : sans objet ici.
  .replace(/<script>\s*\/\/ Adresse officielle[\s\S]*?<\/script>\s*/, '')
  .replace(/<link rel="stylesheet" href="css\/style\.css[^"]*">/, () => `<style>\n${read('css/style.css')}\n</style>`)
  .replace(/<script src="(js\/[\w-]+\.js)(?:\?v=\w+)?"><\/script>/g, (_, rel) => inlineScript(rel));

// <title> en tête : seuls les premiers Ko sont lus pour nommer la page.
const title = /<title>[^<]*<\/title>\s*/.exec(html)[0];
html = title + html.replace(title, '');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`${path.relative(ROOT, OUT) || OUT} : ${(html.length / 1024).toFixed(0)} Ko`);
