// GET /api/profile?name=<nom>
// Profil public d'un joueur, ouvert depuis le classement : ses meilleurs tirages et sa collection de badges.
// Calculé à partir de son historique (hist:<id>), comme ses propres pages History et Badges ; le classement,
// lui, ne compte que les tirages faits par le serveur. Ni l'identifiant ni la liste complète des tirages ne sortent d'ici.
const { engine, redis, cleanName, findPlayer, historyKey, rollSet, readStats, Achievements, cors, send } = require('./_lib');

const BEST_LIMIT = 10;

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return send(res, 405, { error: 'Use GET' });
  try {
    const name = cleanName(new URL(req.url, 'http://localhost').searchParams.get('name'));
    if (!name) return send(res, 400, { error: 'Missing player name' });
    const id = await findPlayer(name);
    if (!id) return send(res, 404, { error: 'No player with this name' });

    const [members, shownName, bestAll, rank, title] = await redis([
      ['ZRANGE', historyKey(id), 0, -1],
      ['HGET', 'names', id],
      ['HGET', 'best:all', id],
      ['ZREVRANK', 'lb:all', id],
      ['HGET', 'titles', id],
    ]);
    const achievements = Achievements.unlocked(await readStats(id));

    // Historique trié par date ; le meilleur tirage all-time y est ajouté s'il date d'avant l'historique serveur.
    // Comparé par nombre seul : un vieux tirage envoyé par l'appareil porte l'heure de l'appareil, pas celle du serveur.
    if (bestAll) {
      const d = JSON.parse(bestAll);
      if (!members.some(m => m.endsWith(`:${d.n}`))) members.push(`${d.t}:${d.n}`);
    }
    // Les doublons d'un même tirage déjà en base (voir rollSet) ne comptent qu'une fois.
    const known = rollSet();
    const rolls = members.map(m => m.split(':').map(Number)).sort((a, b) => a[0] - b[0]).filter(([t, n]) => known.add(n, t));

    // ~20 µs par nombre distinct : 2 s au pire pour un historique plein (100 000 tirages).
    const analyses = new Map();
    const analyze = n => analyses.get(n) || (analyses.set(n, engine.analyze(n)), analyses.get(n));
    let lifetime = 0, percentileSum = 0;
    const badges = {}, tiers = {};
    for (const [, n] of rolls) {
      const a = analyze(n);
      lifetime += a.total;
      percentileSum += a.percentile;
      tiers[a.tier] = (tiers[a.tier] || 0) + 1;
      for (const b of a.earnedIds) {
        if (badges[b]) badges[b][0]++;
        else badges[b] = [1, n];
      }
    }
    const best = rolls
      .map(([t, n]) => ({ n, s: analyze(n).total, t }))
      .sort((x, y) => y.s - x.s || x.t - y.t)
      .slice(0, BEST_LIMIT);

    return send(res, 200, {
      name: shownName || name,
      rolls: rolls.length,
      lifetime,
      since: rolls.length ? rolls[0][0] : null,
      last: rolls.length ? rolls[rolls.length - 1][0] : null,
      rank: rank === null ? null : Number(rank) + 1,
      // Chance = percentile moyen des tirages (50 attendu) ; tiers = nombre de tirages par rareté de carte.
      luck: rolls.length ? Math.round((percentileSum / rolls.length) * 10) / 10 : null,
      tiers,
      best,
      badges,
      achievements, // succès débloqués (stats du serveur) et titre équipé
      title: title || null,
    });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
