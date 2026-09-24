// Version autonome du jeu en une seule page HTML : le site + les fonctions /api qui tournent dans le navigateur.
//   node tools/artifact.mjs [sortie.html]   (par défaut : dist/rng-infinite.html) : pour un artifact claude.ai
//   node tools/artifact.mjs --page          → standalone/index.html, page web complète (rngdle-infinite.vercel.app)
// Tout est inliné (CSS, JS, émoticônes en data:). Les appels /api/* sont interceptés et servis par les vraies
// fonctions de api/, branchées sur le faux Redis de tools/fake-redis.mjs, sauvegardé dans le localStorage.
// Tirages, pièces, boutique, succès et duels contre les bots marchent ; le classement ne contient que ce navigateur.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Extras from './artifact-extras.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// --page : document HTML complet, à servir tel quel ; sinon le contenu seul, que l'artifact enveloppe lui-même.
const PAGE = args.includes('--page');
const OUT = path.resolve(args.find(a => !a.startsWith('--')) || path.join(ROOT, PAGE ? 'standalone/index.html' : 'dist/rng-infinite.html'));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Tirages à 7 chiffres, raretés Cosmic/Celestial/Infinity et badges en plus (tools/artifact-extras.mjs) :
// dans l'artifact seulement, pas dans --page.
const EXTRAS = !PAGE;
const PATCHES = {
  'js/engine.js': Extras.patchEngine,
  'js/app.js': Extras.patchApp,
  'js/shop.js': Extras.patchShop,
  'js/achievements.js': Extras.patchAchievements,
  'js/store.js': Extras.patchStore,
  ...Extras.patchServer,
};
let data = null;
if (EXTRAS) {
  const t0 = Date.now();
  data = await Extras.buildData(Extras.patchEngine(read('js/engine.js')), JSON.parse(read('data/badge-meta.json')), path.join(ROOT, 'tools/.cache'));
  console.log(`${data.badgeCount} badges${data.cached ? ' (cache)' : ''}, dont en plus : ${data.extra.map(b => `${b.id} ${b.score}`).join(', ')}`);
  console.log(`Cotes par rareté : ${Object.entries(data.tierOdds).map(([t, p]) => `${t} ${(p * 100).toFixed(3)}%`).join(', ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
// Un fichier du site tel que la version autonome le reçoit.
const source = rel => {
  if (EXTRAS && rel === 'js/badge-meta.js') return data.badgeMetaJS;
  if (EXTRAS && rel === 'js/percentiles.js') return data.percentilesJS;
  return EXTRAS && PATCHES[rel] ? PATCHES[rel](read(rel)) : read(rel);
};
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
  .map(rel => `${JSON.stringify(rel)}: function (module, exports, require) {\n${source(rel)}\n}`)
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
    // [clé, type, valeur, expiration] ; les délais (cooldown:…, react:…, verrous) gardent leur heure d'expiration.
    // Les sauvegardes d'avant n'avaient pas d'expiration : ces clés-là restaient pour toujours et bloquaient les tirages.
    const TRANSIENT = /^(cooldown|react):|:lock$/;
    for (const [k, t, v, exp] of saved) {
      if (exp ? exp <= Date.now() : TRANSIENT.test(k)) continue;
      memory.db.set(k, t === 'm' ? new Map(v) : t === 's' ? new Set(v) : v);
      if (exp) memory.expires.set(k, exp);
    }
  } catch (e) {}
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const out = [];
      for (const [k, v] of memory.db) {
        const exp = memory.expires.get(k);
        if (exp && exp <= Date.now()) continue;
        const entry = [k, v instanceof Map ? 'm' : v instanceof Set ? 's' : 'v', v instanceof Map || v instanceof Set ? [...v] : v];
        out.push(exp ? entry.concat(exp) : entry);
      }
      try { localStorage.setItem(STORE_KEY, JSON.stringify(out)); } catch (e) {}
      if (window.RNG_ACCOUNT) window.RNG_ACCOUNT.changed();
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

// ---- "Sign in with Claude" : le joueur (données du site + base locale) est sauvegardé dans la base de l'artifact,
// dans le sous-arbre privé du compte claude.ai (data/users/<id>/), et rechargé sur n'importe quel appareil.
const account = `
(function () {
  'use strict';
  // Hors d'un artifact claude.ai (page servie seule), pas de compte : tout reste dans ce navigateur.
  if (!window.claude || !window.claude.use) return;
  const KEYS = ['rnginf.v1', 'rnginf.server.v1']; // données du site (js/store.js) et base du serveur local
  const FLAG = 'rnginf.cloud.v1';                  // { savedAt } tant que ce navigateur est connecté
  const PART = 60000;                              // caractères par document (256 Kio max, même en UTF-8)
  const DELAY = 4000;                              // regroupe les modifications avant d'envoyer
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const flag = () => { try { return JSON.parse(get(FLAG)); } catch (e) { return null; } };

  let conn = null, name = '', timer = null, saving = null, dirty = false;

  function connect() {
    if (!conn) {
      conn = (async () => {
        const claude = window.claude;
        const [user, db] = claude && claude.use ? await Promise.all([claude.use('user'), claude.use('db')]) : [null, null];
        const uid = user && await user.id();
        if (!db || !uid) throw new Error('Sign-in with Claude is not available on this page');
        name = await user.name();
        const base = 'data/users/' + uid;
        return { db, head: db.doc(base + '/save'), part: i => db.doc(base + '/part-' + i) };
      })();
      conn.catch(() => { conn = null; });
    }
    return conn;
  }

  async function readCloud(c) {
    const head = await c.head.get();
    if (!head.exists) return null;
    const { savedAt, parts } = head.data();
    const docs = await Promise.all(Array.from({ length: parts }, (_, i) => c.part(i).get()));
    if (docs.some(d => !d.exists)) throw new Error('Your saved player is incomplete, try again');
    return { savedAt, data: JSON.parse(docs.map(d => d.data().s).join('')) };
  }

  async function writeCloud() {
    const c = await connect();
    dirty = false;
    const savedAt = Date.now();
    const text = JSON.stringify(Object.fromEntries(KEYS.map(k => [k, get(k)])));
    const parts = Math.max(1, Math.ceil(text.length / PART));
    for (let i = 0; i < parts; i++) await c.part(i).set({ s: text.slice(i * PART, (i + 1) * PART) });
    await c.head.set({ savedAt, parts });
    if (flag()) put(FLAG, JSON.stringify({ savedAt }));
  }

  function save() {
    if (saving) { dirty = true; return saving; }
    saving = writeCloud()
      .catch(err => { dirty = true; console.warn('cloud save', err); })
      .finally(() => { saving = null; if (dirty && flag()) schedule(); });
    return saving;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(save, DELAY); }

  function load(cloud) {
    KEYS.forEach(k => put(k, cloud.data[k] ?? null));
    put(FLAG, JSON.stringify({ savedAt: cloud.savedAt }));
    location.reload();
  }

  window.RNG_ACCOUNT = {
    label: 'Claude',
    signedIn: () => !!flag(),
    who: () => name,
    changed() { if (flag()) { dirty = true; schedule(); } },
    async signIn() {
      const c = await connect();
      const cloud = await readCloud(c);
      if (cloud) { load(cloud); return new Promise(() => {}); } // la page se recharge avec le joueur sauvegardé
      put(FLAG, JSON.stringify({ savedAt: 0 }));
      await save();
      return 'Signed in: your progress now saves to your Claude account';
    },
    async signOut() {
      clearTimeout(timer);
      await save();
      if (dirty) throw new Error('Could not save to your account, try signing out again');
      KEYS.concat(FLAG).forEach(k => put(k, null));
      location.reload();
      return new Promise(() => {});
    },
  };

  // Connecté : si le compte a été sauvegardé depuis un autre appareil, on le recharge ici.
  if (flag()) {
    connect().then(readCloud).then(cloud => {
      if (cloud && cloud.savedAt > (flag() || {}).savedAt) load(cloud);
    }).catch(err => console.warn('cloud load', err));
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty && flag()) save(); });
  window.addEventListener('load', () => { if (window.Store) window.Store.onChange(() => window.RNG_ACCOUNT.changed()); });
})();
`;

// ---- Niveaux : 1 point de niveau par tirage, multiplié selon la rareté de la carte (×5 au plus).
// Calculés depuis l'historique (Store.rolls) : rien de plus à sauvegarder, et ils suivent la connexion Claude.
const levels = `
(function () {
  'use strict';
  const MULT = { trash: 1, common: 1, uncommon: 2, rare: 3, epic: 4, anomaly: 5, mythic: 5${EXTRAS ? Extras.NEW_TIERS.map(t => `, ${t}: 5`).join('') : ''} };
  const need = level => 10 + 5 * (level - 1); // points pour passer du niveau "level" au suivant
  const engine = RNGEngine.createEngine(window.BADGE_META, window.SCORE_PERCENTILES);
  const tierOf = r => engine.cardTier(r[1]);
  const pointsOf = r => MULT[tierOf(r)] || 1;
  const sum = rolls => rolls.reduce((s, r) => s + pointsOf(r), 0);
  function levelOf(total) {
    let level = 1, into = total;
    while (into >= need(level)) { into -= need(level); level++; }
    return { level, into, need: need(level) };
  }

  const chip = document.createElement('button');
  chip.className = 'lv-chip';
  chip.id = 'lv-chip';
  chip.innerHTML = '<span class="lv-num"></span><span class="lv-bar"><i></i></span>';
  const panel = document.createElement('div');
  panel.className = 'lv-panel';
  panel.hidden = true;
  const pop = document.createElement('div');
  pop.className = 'lv-pop';
  pop.hidden = true;
  const right = document.querySelector('.topbar-right');
  right.insertBefore(chip, document.getElementById('player-btn'));
  document.body.append(panel, pop);

  let total = sum(Store.rolls), seen = Store.rolls.length;

  function render() {
    const s = levelOf(total);
    chip.querySelector('.lv-num').textContent = 'Lv ' + s.level;
    chip.querySelector('.lv-bar i').style.width = (100 * s.into / s.need).toFixed(1) + '%';
    const label = 'Level ' + s.level + ': ' + s.into + ' / ' + s.need + ' level XP to level ' + (s.level + 1);
    chip.title = label;
    chip.setAttribute('aria-label', label);
    panel.innerHTML = '<b>Level ' + s.level + '</b><span class="lv-sub">' + s.into + ' / ' + s.need + ' to level ' + (s.level + 1) +
      ' · ' + total.toLocaleString('en-US') + ' level XP total</span>' +
      '<span class="lv-sub">Every roll gives 1 level XP, multiplied by its rarity:</span><ul>' +
      Object.entries(MULT).map(([t, m]) => '<li><span class="pill" data-tier="' + t + '">' + t + '</span><b>×' + m + '</b></li>').join('') +
      '</ul>';
    return s;
  }

  let popTimer = null;
  function showGain(points, tier, before, after) {
    const up = after.level > before.level;
    pop.dataset.tier = tier;
    pop.innerHTML = '<b>+' + points + ' level XP</b>' + (points > 1 ? '<span>' + tier + ' ×' + points + '</span>' : '') +
      (up ? '<strong>Level up! Lv ' + after.level + '</strong>' : '');
    pop.classList.toggle('up', up);
    pop.hidden = false;
    pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show');
    chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
    clearTimeout(popTimer);
    popTimer = setTimeout(() => { pop.hidden = true; }, up ? 3200 : 1900);
  }

  // Le tirage est enregistré juste avant la révélation (body.locked) : on attend qu'elle commence puis se termine,
  // pour ne rien dévoiler. Sans révélation dans la seconde et demie (tirage de duel), on l'affiche quand même.
  let pending = null;
  const revealing = () => document.body.classList.contains('locked');
  function flush() {
    if (!pending) return;
    if (revealing()) { pending.sawReveal = true; return; }
    if (!pending.sawReveal && Date.now() - pending.at < 1500) return;
    const { points, tier, before } = pending;
    pending = null;
    showGain(points, tier, before, render());
  }
  new MutationObserver(flush).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  Store.onChange(() => {
    const rolls = Store.rolls;
    if (rolls.length === seen) return;
    if (rolls.length < seen || rolls.length - seen > 3) { // historique vidé, importé ou synchronisé
      total = sum(rolls); seen = rolls.length; pending = null; render();
      return;
    }
    const before = pending ? pending.before : levelOf(total);
    const added = rolls.slice(seen);
    const points = sum(added) + (pending ? pending.points : 0);
    total += sum(added);
    seen = rolls.length;
    pending = { points, tier: tierOf(added[added.length - 1]), before, at: Date.now(), sawReveal: revealing() };
    setTimeout(flush, 1600);
  });

  chip.addEventListener('click', e => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      const r = chip.getBoundingClientRect();
      panel.style.top = (r.bottom + 8) + 'px';
      panel.style.right = Math.max(16, innerWidth - r.right) + 'px';
    }
  });
  document.addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target)) panel.hidden = true; });
  render();
})();
`;

const levelsCSS = `
.lv-chip { display: inline-flex; flex-direction: column; justify-content: center; gap: 3px; height: 2rem; padding: 0 .6rem; margin-right: .4rem;
  border: 1px solid var(--outline); border-radius: 8px; background: var(--surface); color: var(--prose); cursor: pointer; font: inherit; }
.lv-chip:hover { border-color: var(--outline-strong); }
.lv-chip:focus-visible { outline: 2px solid var(--chart-accent); outline-offset: 2px; }
.lv-num { white-space: nowrap; font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; font-variant-numeric: tabular-nums; line-height: 1; }
.lv-bar { display: block; width: 3.2rem; height: 4px; border-radius: 2px; background: var(--surface-raised); overflow: hidden; }
.lv-bar i { display: block; height: 100%; background: var(--chart-accent); border-radius: 2px; transition: width .5s ease; }
.lv-chip.bump { animation: lv-bump .5s ease; }
@keyframes lv-bump { 40% { transform: scale(1.12); } }
.lv-panel { position: fixed; z-index: 60; width: min(17rem, calc(100vw - 32px)); padding: .8rem .9rem; display: flex; flex-direction: column; gap: .35rem;
  background: var(--surface); color: var(--prose); border: 1px solid var(--outline); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.14); font-size: .8rem; }
.lv-panel .lv-sub { color: var(--prose-2); }
.lv-panel ul { list-style: none; margin: .2rem 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: .3rem .8rem; }
.lv-panel li { display: flex; align-items: center; justify-content: space-between; gap: .4rem; }
.lv-panel li b { font-variant-numeric: tabular-nums; }
.lv-pop { position: fixed; z-index: 65; top: calc(env(safe-area-inset-top, 0px) + 3.6rem); right: 16px; display: flex; flex-direction: column; align-items: flex-end; gap: .15rem;
  padding: .5rem .75rem; border-radius: 10px; background: var(--surface); border: 1px solid var(--outline); box-shadow: 0 6px 18px rgba(0,0,0,.12); pointer-events: none; }
.lv-pop b { font-size: .9rem; font-weight: 800; color: var(--tier-common); }
.lv-pop span { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--prose-2); }
.lv-pop strong { font-size: .95rem; font-weight: 900; letter-spacing: .04em; color: var(--chart-accent); }
${['trash','common','uncommon','rare','epic','anomaly','mythic'].concat(EXTRAS ? Extras.NEW_TIERS : []).map(t => `.lv-pop[data-tier="${t}"] b { color: var(--tier-${t}); }`).join('\n')}
.lv-pop.up { border-color: var(--chart-accent); }
.lv-pop.show { animation: lv-in .35s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes lv-in { from { opacity: 0; transform: translateY(-8px) scale(.95); } }
.lv-pop[hidden], .lv-panel[hidden] { display: none; }
@media (max-width: 480px) { .lv-bar { display: none !important; } .lv-chip { margin-right: .15rem; } .player-btn { padding: 0 .5rem; } .player-btn span { max-width: 4.5rem; } }
@media (max-width: 720px) { .lv-bar { width: 2.4rem; } .lv-chip { padding: 0 .45rem; margin-right: .25rem; } }
@media (prefers-reduced-motion: reduce) { .lv-chip.bump, .lv-pop.show { animation: none; } .lv-bar i { transition: none; } }
`;

// ---- la page
const emotes = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'img/emotes')).filter(f => f.endsWith('.png'))
  .map(f => [f.slice(0, -4), `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'img/emotes', f)).toString('base64')}`]));

let html = read('index.html');
const scripts = [...html.matchAll(/<script src="(js\/[\w-]+\.js)(?:\?v=\w+)?"><\/script>/g)].map(m => m[1]);
if (!scripts.includes('js/app.js')) throw new Error('index.html : scripts introuvables');

const inlineScript = rel => {
  let js = source(rel);
  if (rel === 'js/app.js') {
    js = js.split('img/emotes/${id}.png').join('${window.RNG_EMOTES[id]}');
    if (js.includes('img/emotes/')) throw new Error('app.js : chemin d\'émoticône non remplacé');
  }
  let out = `<script>\n${safe(js)}\n</script>`;
  // Pas de connexion Google ici : le script de Google est bloqué et le compte vit dans ce navigateur.
  if (rel === 'js/config.js') out += `\n<script>window.RNG_CONFIG.googleClientId = '';</script>`;
  if (rel === 'js/app.js') out += `\n<script>\n${safe(levels)}\n</script>`;
  if (rel === 'js/app.js') out = `<script>window.RNG_EMOTES = ${JSON.stringify(emotes)};</script>\n<script>\n${safe(backend)}\n</script>\n<script>\n${safe(account)}\n</script>\n` + out;
  return out;
};

html = html
  // La page est enveloppée dans son propre squelette : on ne garde que le contenu.
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace('roll a number from 0 to 1,000,000', () => EXTRAS ? 'roll a number from 0 to 9,999,999' : 'roll a number from 0 to 1,000,000')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<link rel="canonical"[^>]*>\s*/i, '')
  // Redirection vers rng-infinite.com : sans objet ici.
  .replace(/<script>\s*\/\/ Adresse officielle[\s\S]*?<\/script>\s*/, '')
  .replace(/<link rel="stylesheet" href="css\/style\.css[^"]*">/, () => `<style>\n${read('css/style.css')}\n${levelsCSS}\n${EXTRAS ? Extras.CSS : ''}\n</style>`)
  .replace(/<script src="(js\/[\w-]+\.js)(?:\?v=\w+)?"><\/script>/g, (_, rel) => inlineScript(rel));

// <title> en tête : seuls les premiers Ko sont lus pour nommer la page.
const title = /<title>[^<]*<\/title>\s*/.exec(html)[0];
html = title + html.replace(title, '');

if (PAGE) {
  html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${html.replace(/(<\/title>\s*[\s\S]*?)(<header class="topbar">)/, '$1</head>\n<body>\n$2')}
</body>
</html>
`;
  if (!html.includes('</head>\n<body>')) throw new Error('--page : début du <body> introuvable');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`${path.relative(ROOT, OUT) || OUT} : ${(html.length / 1024).toFixed(0)} Ko`);
