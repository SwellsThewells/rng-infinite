// POST /api/history  { playerId, secret, add?: [[nombre, timestamp], ...], fetch?: false }
// Historique complet d'un joueur, pour le retrouver sur tous ses appareils (joueurs connectés avec Google).
// Les tirages faits en ligne y sont ajoutés par /api/roll ; "add" y verse ceux que seul l'appareil connaissait
// (hors ligne, ou d'avant la synchronisation). Réponse : tous les tirages, du plus ancien au plus récent.
const { redis, ownsPlayer, historyKey, HISTORY_CAP, cors, send } = require('./_lib');

const MAX_ADD = 5000; // par requête ; le site découpe au-delà
const MIN_T = Date.UTC(2024, 0, 1);

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const playerId = String(body.playerId || '');
    const secret = String(body.secret || '');
    if (!/^[0-9a-f]{16}$/.test(playerId) || !/^[0-9a-f]{32}$/.test(secret)) return send(res, 400, { error: 'Invalid player' });
    if (!(await ownsPlayer(playerId, secret))) return send(res, 403, { error: 'This player id belongs to someone else' });

    const key = historyKey(playerId);
    const maxT = Date.now() + 86400000;
    const valid = (Array.isArray(body.add) ? body.add.slice(0, MAX_ADD) : []).filter(r =>
      Array.isArray(r) && Number.isInteger(r[0]) && r[0] >= 0 && r[0] <= 1000000 &&
      Number.isInteger(r[1]) && r[1] >= MIN_T && r[1] <= maxT);

    let stored = 0;
    if (valid.length) {
      const zadd = ['ZADD', key];
      for (const [n, t] of valid) zadd.push(t, `${t}:${n}`);
      [stored] = await redis([zadd, ['ZREMRANGEBYRANK', key, 0, -(HISTORY_CAP + 1)]]);
    }
    if (body.fetch === false) return send(res, 200, { stored: Number(stored) });

    const [members] = await redis([['ZRANGE', key, 0, -1]]);
    const rolls = members.map(m => {
      const [t, n] = m.split(':').map(Number);
      return [n, t];
    });
    return send(res, 200, { stored: Number(stored), rolls });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
