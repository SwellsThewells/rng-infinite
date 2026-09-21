// Teste les fonctions /api sans Vercel ni Upstash ni Google : fetch est remplacé par un faux Redis en mémoire
// et par de fausses clés Google.
//   node tools/test-api.mjs
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fakeRedis } from './fake-redis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';

// Fausse paire de clés "Google" : les jetons de test sont signés avec, et fetch sert la clé publique.
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const { privateKey: googlePrivate, publicKey: googlePublic } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const googleJwk = { ...googlePublic.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };

const { db, zset, run } = fakeRedis();
let calls = 0;
globalThis.fetch = async (url, opts) => {
  if (url === GOOGLE_CERTS_URL) return { ok: true, json: async () => ({ keys: [googleJwk] }) };
  assert.equal(url, 'https://fake-redis.test/pipeline');
  assert.equal(opts.headers.Authorization, 'Bearer test-token');
  calls++;
  const cmds = JSON.parse(opts.body);
  cmds.forEach(c => c.forEach(x => assert.equal(typeof x, 'string', 'toutes les valeurs partent en texte')));
  return { ok: true, json: async () => run(cmds) };
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
const auth = require(path.join(ROOT, 'api/auth.js'));
const history = require(path.join(ROOT, 'api/history.js'));
const { engine } = require(path.join(ROOT, 'api/_lib.js'));

const alice = { playerId: 'a'.repeat(16), secret: '1'.repeat(32), name: 'Alice' };
const bob = { playerId: 'b'.repeat(16), secret: '2'.repeat(32), name: '  Bob<script>  ' };

// 1. Premier tirage : nombre valide, XP recalculé par le moteur, classé 1er du jour.
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
// Le délai se lève seul après 8 s, comme sur Upstash (sinon le serveur de dev refuse tout 2e tirage).
const realNow = Date.now;
Date.now = () => realNow() + 8001;
assert.equal(run([['SET', `cooldown:${alice.playerId}`, '1', 'PX', 8000, 'NX']])[0].result, 'OK');
Date.now = realNow;

// 3. Entrées invalides.
assert.equal((await call(roll, { method: 'POST', body: { ...bob, name: '   ' } })).status, 400);
assert.equal((await call(roll, { method: 'POST', body: { ...bob, playerId: 'xyz' } })).status, 400);
assert.equal((await call(roll, { method: 'GET' })).status, 405);
assert.equal((await call(roll, { method: 'OPTIONS' })).status, 204);

// 4. Bob tire ; le nom est nettoyé.
r = await call(roll, { method: 'POST', body: bob });
assert.equal(r.status, 200);
const bobFirst = r.body;

// 5. Le classement du jour trie par XP, compte les tirages et ne révèle aucun identifiant.
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

// 6. Un tirage plus faible ne remplace pas le meilleur ; le compteur augmente quand même.
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
assert.equal(r.body.entries.find(e => e.name === 'Alice').rolls, 2);

// 7. Périodes et paramètres inconnus.
for (const period of ['week', 'all', 'nimportequoi']) {
  r = await call(leaderboard, { url: `/api/leaderboard?period=${period}` });
  assert.equal(r.status, 200);
  assert.ok(['day', 'week', 'all'].includes(r.body.period));
}

// 8. Connexion Google.
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
function googleToken(claims, key = googlePrivate) {
  const head = b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
  const body = b64({
    iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + 3600, email_verified: true, ...claims,
  });
  return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
const signIn = (claims, device) => call(auth, { method: 'POST', body: { credential: googleToken(claims), ...device } });

// Alice relie son compte : elle garde son joueur (et son nom), et le secret reçu permet de tirer.
r = await signIn({ sub: 'g-alice', email: 'alice@example.com', given_name: 'Alice' }, { playerId: alice.playerId, secret: alice.secret });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.playerId, alice.playerId);
assert.equal(r.body.name, 'Alice');
assert.equal(r.body.email, 'alice@example.com');
const aliceSession = r.body.secret;
db.delete(`cooldown:${alice.playerId}`);
r = await call(roll, { method: 'POST', body: { playerId: alice.playerId, secret: aliceSession, name: 'Alice' } });
assert.equal(r.status, 200, 'le secret reçu à la connexion permet de tirer');

// Sur un autre appareil jamais utilisé, le même compte retrouve le joueur d'Alice.
r = await signIn({ sub: 'g-alice' }, { playerId: 'c'.repeat(16), secret: '3'.repeat(32) });
assert.equal(r.body.playerId, alice.playerId);
assert.notEqual(r.body.secret, aliceSession, 'un secret par appareil');

// Le secret de l'appareil d'origine reste valable.
db.delete(`cooldown:${alice.playerId}`);
assert.equal((await call(roll, { method: 'POST', body: alice })).status, 200);

// Un autre compte Google sur l'appareil d'Alice n'hérite pas de son joueur.
r = await signIn({ sub: 'g-carol' }, { playerId: alice.playerId, secret: aliceSession });
assert.equal(r.status, 200);
assert.notEqual(r.body.playerId, alice.playerId);

// Un appareil qui prétend être Bob sans son secret ne récupère pas le joueur de Bob.
r = await signIn({ sub: 'g-mallory' }, { playerId: bob.playerId, secret: '4'.repeat(32) });
assert.notEqual(r.body.playerId, bob.playerId);

// Jetons refusés : autre clé, autre application, expiré, pas un jeton.
const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const badTokens = [
  googleToken({ sub: 'x' }, otherKey),
  googleToken({ sub: 'x', aud: 'another-app.apps.googleusercontent.com' }),
  googleToken({ sub: 'x', exp: Math.floor(Date.now() / 1000) - 10 }),
  'not-a-token',
];
for (const credential of badTokens) {
  assert.equal((await call(auth, { method: 'POST', body: { credential } })).status, 401);
}

// 9. Historique : les tirages en ligne y sont déjà ; un appareil peut y verser les siens, sans doublon.
const aliceTab = { playerId: alice.playerId, secret: aliceSession };
r = await call(history, { method: 'POST', body: aliceTab });
assert.equal(r.status, 200, JSON.stringify(r.body));
const before = r.body.rolls;
assert.equal(before.length, 4, 'chacun des 4 tirages en ligne d\'Alice est dans son historique');
assert.ok(before.some(([n, t]) => n === aliceFirst.n && t === aliceFirst.t));

const t0 = Date.UTC(2026, 8, 20, 12);
const upload = [[42, t0], [42, t0], [1337, t0 + 1], [-5, t0], [7, 123], ['x', t0], [8, Date.now() + 3 * 86400000]];
r = await call(history, { method: 'POST', body: { ...aliceTab, add: upload } });
assert.equal(r.body.stored, 2, 'doublons et entrées invalides ignorés');
assert.equal(r.body.rolls.length, before.length + 2);
assert.ok(r.body.rolls.every((x, i, all) => i === 0 || all[i - 1][1] <= x[1]), 'du plus ancien au plus récent');

r = await call(history, { method: 'POST', body: { ...aliceTab, add: [[42, t0]], fetch: false } });
assert.equal(r.body.stored, 0, 'renvoyer un tirage déjà connu ne crée pas de doublon');
assert.equal(r.body.rolls, undefined);

assert.equal((await call(history, { method: 'POST', body: { ...aliceTab, secret: '9'.repeat(32) } })).status, 403);
assert.equal((await call(history, { method: 'POST', body: { playerId: 'nope', secret: 'x' } })).status, 400);
assert.equal((await call(history, { method: 'GET' })).status, 405);

// 10. Noms uniques, sans tenir compte des majuscules, accents, espaces et ponctuation.
const nameApi = require(path.join(ROOT, 'api/name.js'));
const setName = (who, name) => call(nameApi, { method: 'POST', body: { playerId: who.playerId, secret: who.secret, name } });
assert.equal((await setName(alice, 'Sacha')).status, 200);
for (const clash of ['sacha', ' SACHA ', 'Sâcha', 'Sa-cha!']) {
  assert.equal((await setName(bob, clash)).status, 409, `"${clash}" est le même nom que "Sacha"`);
}
// Tirer sous un nom pris est refusé, sans déclencher de délai : Bob retire aussitôt avec son propre nom.
db.delete(`cooldown:${bob.playerId}`);
assert.equal((await call(roll, { method: 'POST', body: { ...bob, name: 'SACHA' } })).status, 409);
assert.equal((await call(roll, { method: 'POST', body: bob })).status, 200);
// Changer de nom libère l'ancien ; le classement affiche le nouveau.
assert.equal((await setName(alice, 'Alice')).status, 200);
assert.equal((await setName(bob, 'Sacha')).status, 200);
r = await call(leaderboard, { url: '/api/leaderboard?period=all' });
assert.deepEqual(r.body.entries.map(e => e.name).sort(), ['Alice', 'Sacha']);
assert.equal((await setName(bob, '   ')).status, 400);
assert.equal((await setName({ ...bob, secret: '9'.repeat(32) }, 'Zed')).status, 403);

// 11. Profil public : trouvé par nom (majuscules/accents ignorés), calculé depuis l'historique, sans identifiant.
const profile = require(path.join(ROOT, 'api/profile.js'));
r = await call(profile, { url: '/api/profile?name=ALICE' });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.name, 'Alice');
const aliceHist = (await call(history, { method: 'POST', body: aliceTab })).body.rolls;
const aliceScores = aliceHist.map(([n]) => engine.scoreOf(n));
assert.equal(r.body.rolls, aliceHist.length);
assert.equal(r.body.lifetime, aliceScores.reduce((x, y) => x + y, 0));
assert.equal(r.body.since, aliceHist[0][1]);
assert.equal(r.body.best[0].s, Math.max(...aliceScores));
assert.ok(r.body.best.length <= 10 && r.body.best.every((x, i, all) => i === 0 || all[i - 1].s >= x.s), 'meilleurs tirages triés');
const aliceBadges = aliceHist.flatMap(([n]) => engine.analyze(n).earnedIds);
assert.deepEqual(Object.keys(r.body.badges).sort(), [...new Set(aliceBadges)].sort());
assert.equal(Object.values(r.body.badges).reduce((x, [c]) => x + c, 0), aliceBadges.length, 'chaque badge compté autant de fois qu\'obtenu');
assert.equal(typeof r.body.rank, 'number');
assert.ok(!JSON.stringify(r.body).includes(alice.playerId), 'aucun id dans le profil');

// Ancien joueur sans clé name:* : retrouvé par le hash "names", son meilleur tirage compte même hors historique.
const legacy = 'c'.repeat(16);
run([['HSET', 'names', legacy, 'Émile'], ['HSET', 'best:all', legacy, JSON.stringify({ n: 777777, s: engine.scoreOf(777777), t: t0 })]]);
r = await call(profile, { url: '/api/profile?name=emile' });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.name, 'Émile');
assert.equal(r.body.rolls, 1);
assert.equal(r.body.best[0].n, 777777);
assert.equal(r.body.rank, null);
assert.equal((await call(profile, { url: '/api/profile?name=Nobody' })).status, 404);
assert.equal((await call(profile, { url: '/api/profile' })).status, 400);
assert.equal((await call(profile, { method: 'POST' })).status, 405);

console.log(`OK —${calls} allers-retours Redis simulés, tirages ${aliceFirst.n} (${aliceFirst.s} XP) et ${bobFirst.n} (${bobFirst.s} XP)`);
