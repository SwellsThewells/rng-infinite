// GET /api/leaderboard?period=day|week|all&me=<playerId>
// Top 50 des meilleurs tirages de la période, la place du joueur s'il est plus loin, et le nombre de tirages du jour.
const { redis, scopes, dayKey, cors, send, flushDue } = require('./_lib');

const LIMIT = 50;

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  await flushDue();
  if (req.method !== 'GET') return send(res, 405, { error: 'Use GET' });
  try {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const period = ['day', 'week', 'all'].includes(params.get('period')) ? params.get('period') : 'day';
    const me = /^[0-9a-f]{16}$/.test(params.get('me') || '') ? params.get('me') : '';
    const t = Date.now();
    const scope = scopes(t).find(p => p.period === period);

    const [flat, rolls, rollsToday, players, myRank] = await redis([
      ['ZREVRANGE', scope.lb, 0, LIMIT - 1, 'WITHSCORES'],
      ['GET', scope.total],
      ['GET', `rolls:day:${dayKey(t)}`],
      ['ZCARD', scope.lb],
      ['ZREVRANK', scope.lb, me || '-'],
    ]);
    const ids = [];
    for (let i = 0; i < flat.length; i += 2) ids.push(flat[i]);
    const meOutsideTop = me && myRank !== null && Number(myRank) >= LIMIT;
    const wanted = meOutsideTop ? [...ids, me] : ids;

    let details = [], names = [], counts = [], titles = [];
    if (wanted.length) {
      [details, names, counts, titles] = await redis([
        ['HMGET', scope.best, ...wanted],
        ['HMGET', 'names', ...wanted],
        ['HMGET', scope.count, ...wanted],
        ['HMGET', 'titles', ...wanted],
      ]);
    }

    // Les identifiants ne sortent jamais du serveur : seul un drapeau "me" signale la ligne du joueur.
    // rolls = nombre de tirages du joueur sur la période (compté depuis le 2026-09-21, 0 pour les tirages d'avant).
    const toEntry = (id, i, rank) => {
      if (!details[i]) return null;
      const d = JSON.parse(details[i]);
      return { rank, name: names[i] || 'Player', title: titles[i] || null, n: d.n, s: d.s, t: d.t, rolls: Number(counts[i] || 0), me: id === me };
    };
    const entries = ids.map((id, i) => toEntry(id, i, i + 1)).filter(Boolean);
    const mine = meOutsideTop ? toEntry(me, ids.length, Number(myRank) + 1) : null;

    return send(res, 200, {
      period, entries, mine,
      rolls: Number(rolls || 0),
      players: Number(players || 0),
      rollsToday: Number(rollsToday || 0),
    });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
