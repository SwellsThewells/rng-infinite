// POST /api/title { playerId, secret, title }
// Équipe le titre d'un succès débloqué (affiché au classement, sur le profil et en duel) ; title vide = aucun titre.
// Vérifié sur les stats tenues par le serveur : on ne peut pas s'équiper un succès qu'on n'a pas.
const { redis, ownsPlayer, readStats, Achievements, cors, send, flushDue } = require('./_lib');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  await flushDue();
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const playerId = String(body.playerId || '');
    const secret = String(body.secret || '');
    const title = String(body.title || '');
    if (!/^[0-9a-f]{16}$/.test(playerId) || !/^[0-9a-f]{32}$/.test(secret)) return send(res, 400, { error: 'Invalid player' });
    if (!(await ownsPlayer(playerId, secret))) return send(res, 403, { error: 'This player id belongs to someone else' });
    const achievements = Achievements.unlocked(await readStats(playerId));
    if (!title) {
      await redis([['HDEL', 'titles', playerId]]);
      return send(res, 200, { title: null, achievements });
    }
    if (!Achievements.byId.has(title)) return send(res, 400, { error: 'Unknown title' });
    if (!achievements.includes(title)) return send(res, 422, { error: 'Unlock this achievement first' });
    await redis([['HSET', 'titles', playerId, title]]);
    return send(res, 200, { title, achievements });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
