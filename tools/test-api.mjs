// Teste les fonctions /api sans Vercel ni Upstash : fetch est remplacé par un faux Redis en mémoire.
//   node tools/test-api.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';

// ---------------------------------------------------------------- faux Redis (seulement les commandes utilisées)
const db = new Map();
const zset = k => db.get(k) || (db.set(k, new Map()), db.get(k));
const hash = k => db.get(k) || (db.set(k, new Map()), db.get(k));
const sortedDesc = k => [...zset(k).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
const COMMANDS = {
  SET(k, v, ...opts) {
    if (opts.includes('NX') && db.has(k)) return null;
    db.set(k, v);
    return 'OK';
  },
  GET: k => (db.has(k) ? db.get(k) : null),
  INCR(k) { const v = Number(db.get(k) || 0) + 1; db.set(k, String(v)); return v; },
  EXPIRE: () => 1,
  HSET(k, f, v) { hash(k).set(f, v); return 1; },
  HMGET: (k, ...fs) => fs.map(f => (db.has(k) && db.get(k).has(f) ? db.get(k).get(f) : null)),
  ZSCORE: (k, m) => (db.has(k) && db.get(k).has(m) ? String(db.get(k).get(m)) : null),
  ZADD(k, score, m) { const z = zset(k), added = z.has(m) ? 0 : 1; z.set(m, Number(score)); return added; },
  ZREVRANK: (k, m) => { const i = sortedDesc(k).findIndex(([id]) => id === m); return i < 0 ? null : i; },
  ZREVRANGE: (k, a, b) => sortedDesc(k).slice(Number(a), Number(b) + 1).flatMap(([m, s]) => [m, String(s)]),
  ZCARD: k => (db.has(k) ? db.get(k).size : 0),
  HINCRBY(k, f, by) { const h = hash(k), v = Number(h.get(f) || 0) + Number(by); h.set(f, String(v)); return v; },
};
let calls = 0;
globalThis.fetch = async (url, opts) => {
  assert.equal(url, 'https://fake-redis.test/pipeline');
  assert.equal(opts.headers.Authorization, 'Bearer test-token');
  calls++;
  const cmds = JSON.parse(opts.body);
  cmds.forEach(c => c.forEach(x => assert.equal(typeof x, 'string', 'toutes les valeurs partent en texte')));
  return { ok: true, json: async () => cmds.map(([cmd, ...args]) => ({ result: COMMANDS[cmd](...args) })) };
};

// ---------------------------------------------------------------- appel d'une fonction comme le ferait Vercel
function call(handler, { method = 'GET', url = '/', body } = {}) {
  return new Promise(resolve => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: data => resolve({ status: res.statusCode, headers, body: data ? JSON.parse(data) : null }),
    };
    Promise.resolve(handler({ method, url, body }, res));
  });
}

const roll = require(path.join(ROOT, 'api/roll.js'));
const leaderboard = require(path.join(ROOT, 'api/leaderboard.js'));
const { engine } = require(path.join(ROOT, 'api/_lib.js'));

const alice = { playerId: 'a'.repeat(16), secret: '1'.repeat(32), name: 'Alice' };
const bob = { playerId: 'b'.repeat(16), secret: '2'.repeat(32), name: '  Bob<script>  ' };

// 1. Premier tirage : nombre valide, EP recalculé par le moteur, classé 1er du jour.
let r = await call(roll, { method: 'POST', body: alice });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.ok(Number.isInteger(r.body.n) && r.body.n >= 0 && r.body.n <= 1000000);
assert.equal(r.body.s, engine.scoreOf(r.body.n));
assert.equal(r.body.bestToday, true);
assert.equal(r.body.dayRank, 1);
assert.equal(r.headers['access-control-allow-origin'], '*');
const aliceFirst = r.body;

// 2. Retirer tout de suite : refusé (anti-spam), et l'identifiant d'Alice est protégé par son secret.
r = await call(roll, { method: 'POST', body: alice });
assert.equal(r.status, 429);
r = await call(roll, { method: 'POST', body: { ...alice, secret: '9'.repeat(32) } });
assert.equal(r.status, 403);

// 3. Entrées invalides.
assert.equal((await call(roll, { method: 'POST', body: { ...bob, name: '   ' } })).status, 400);
assert.equal((await call(roll, { method: 'POST', body: { ...bob, playerId: 'xyz' } })).status, 400);
assert.equal((await call(roll, { method: 'GET' })).status, 405);
assert.equal((await call(roll, { method: 'OPTIONS' })).status, 204);

// 4. Bob tire ; le nom est nettoyé.
r = await call(roll, { method: 'POST', body: bob });
assert.equal(r.status, 200);
const bobFirst = r.body;

// 5. Le classement du jour trie par EP et ne révèle aucun identifiant.
r = await call(leaderboard, { url: `/api/leaderboard?period=day&me=${alice.playerId}` });
assert.equal(r.status, 200);
assert.equal(r.body.entries.length, 2);
assert.equal(r.body.rollsToday, 2);
assert.equal(r.body.rolls, 2);
assert.equal(r.body.players, 2);
assert.deepEqual(r.body.entries.map(e => e.rolls), [1, 1]);
const [first, second] = r.body.entries;
assert.ok(first.s >= second.s);
assert.deepEqual(r.body.entries.map(e => e.rank), [1, 2]);
assert.equal(r.body.entries.find(e => e.me).name, 'Alice');
assert.equal(r.body.entries.find(e => !e.me).name, 'Bobscript');
assert.ok(!JSON.stringify(r.body).includes(alice.playerId), 'aucun id dans la réponse');

// 6. Un tirage plus faible ne remplace pas le meilleur ; un plus fort le remplace (jour, semaine, all-time).
const bestKey = [...db.keys()].find(k => k.startsWith('lb:day:'));
db.delete(`cooldown:${alice.playerId}`);
zset(bestKey).set(alice.playerId, 1e12); // on simule un meilleur score imbattable
r = await call(roll, { method: 'POST', body: alice });
assert.equal(r.body.bestToday, false);
const aliceSecond = r.body;
r = await call(leaderboard, { url: '/api/leaderboard?period=all' });
const expectedBest = aliceSecond.s > aliceFirst.s ? aliceSecond : aliceFirst;
assert.equal(r.body.entries.find(e => e.name === 'Alice').n, expectedBest.n);
assert.equal(r.body.rolls, 3);
assert.equal(r.body.players, 2);
assert.equal(r.body.entries.find(e => e.name === 'Alice').rolls, 2, 'le compteur augmente même quand le tirage ne bat pas le record');

// 7. Périodes et paramètres inconnus.
for (const period of ['week', 'all', 'nimportequoi']) {
  r = await call(leaderboard, { url: `/api/leaderboard?period=${period}` });
  assert.equal(r.status, 200);
  assert.ok(['day', 'week', 'all'].includes(r.body.period));
}

console.log(`OK — ${calls} allers-retours Redis simulés, tirages ${aliceFirst.n} (${aliceFirst.s} EP) et ${bobFirst.n} (${bobFirst.s} EP)`);
