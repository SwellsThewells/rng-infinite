// POST /api/roll  { playerId, secret, name }
// Le serveur tire le nombre (personne ne peut choisir son 1337), calcule l'EP avec le moteur du site,
// puis met à jour le meilleur tirage du joueur pour le jour, la semaine et tous les temps.
const crypto = require('node:crypto');
const { engine, redis, scopes, cleanName, sha256, cors, send, historyKey, HISTORY_CAP } = require('./_lib');

// Une révélation dure au moins ~10 s : 8 s minimum entre deux tirages ne gêne jamais un vrai joueur.
const COOLDOWN_MS = 8000;

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const playerId = String(body.playerId || '');
    const secret = String(body.secret || '');
    const name = cleanName(body.name);
    if (!/^[0-9a-f]{16}$/.test(playerId) || !/^[0-9a-f]{32}$/.test(secret)) return send(res, 400, { error: 'Invalid player' });
    if (!name) return send(res, 400, { error: 'Pick a player name first' });

    // Le premier tirage réserve l'identifiant ; ensuite seul le détenteur du secret peut tirer sous cet id.
    // Les appareils connectés avec Google ont chacun leur propre secret (ensemble player:<id>:secrets).
    const secretHash = sha256(secret);
    const [, owner, member, cooldown] = await redis([
      ['SET', `player:${playerId}:secret`, secretHash, 'NX'],
      ['GET', `player:${playerId}:secret`],
      ['SISMEMBER', `player:${playerId}:secrets`, secretHash],
      ['SET', `cooldown:${playerId}`, '1', 'PX', COOLDOWN_MS, 'NX'],
    ]);
    if (owner !== secretHash && Number(member) !== 1) return send(res, 403, { error: 'This player id belongs to someone else' });
    if (cooldown !== 'OK') return send(res, 429, { error: 'Too fast, wait for the reveal to finish' });

    const n = crypto.randomInt(0, 1000001);
    const s = engine.scoreOf(n);
    const t = Date.now();
    const periods = scopes(t);

    // Le cooldown garantit un seul tirage à la fois par joueur : lire puis écrire son meilleur score ne peut pas se croiser.
    const current = await redis(periods.map(p => ['ZSCORE', p.lb, playerId]));
    const improved = periods.filter((p, i) => current[i] === null || s > Number(current[i]));
    const entry = JSON.stringify({ n, s, t });
    const writes = [
      ['HSET', 'names', playerId, name],
      // Historique du joueur, retrouvé sur tous ses appareils une fois connecté avec Google.
      ['ZADD', historyKey(playerId), t, `${t}:${n}`],
      ['ZREMRANGEBYRANK', historyKey(playerId), 0, -(HISTORY_CAP + 1)],
    ];
    // Nombre de tirages de la période, au total et par joueur (affichés au classement).
    for (const p of periods) {
      writes.push(['INCR', p.total], ['HINCRBY', p.count, playerId, 1]);
      if (p.ttl) writes.push(['EXPIRE', p.total, p.ttl], ['EXPIRE', p.count, p.ttl]);
    }
    for (const p of improved) {
      writes.push(['ZADD', p.lb, s, playerId], ['HSET', p.best, playerId, entry]);
      if (p.ttl) writes.push(['EXPIRE', p.lb, p.ttl], ['EXPIRE', p.best, p.ttl]);
    }
    writes.push(['ZREVRANK', periods[0].lb, playerId]);
    const out = await redis(writes);
    const dayRank = out[out.length - 1];

    return send(res, 200, {
      n, s, t,
      bestToday: improved.some(p => p.period === 'day'),
      dayRank: dayRank === null ? null : Number(dayRank) + 1,
    });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
