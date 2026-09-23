// GET  /api/duel?id=<id>&me=<playerId>   → un duel
// GET  /api/duel?me=<playerId>           → les 10 derniers duels du joueur
// POST /api/duel { playerId, secret, opponent }  → défie un joueur (renvoie le duel en cours s'il y en a déjà un entre eux)
// Les tirages se font avec POST /api/roll { …, duel: <id> } : ce sont des tirages normaux, comptés en plus dans le duel.
const crypto = require('node:crypto');
const {
  redis, cleanName, claimPlayer, findPlayer, cors, send,
  DUEL_SIZE, DUEL_PLAY_MS, DUEL_TTL, duelKey, isDuelId, loadDuels, duelView,
} = require('./_lib');

const LIST_LIMIT = 10;
const isPlayerId = id => /^[0-9a-f]{16}$/.test(String(id || ''));

async function namesOf(duels) {
  const ids = [...new Set(duels.flatMap(d => [d.a, d.b]))];
  if (!ids.length) return {};
  const [names] = await redis([['HMGET', 'names', ...ids]]);
  return Object.fromEntries(ids.map((id, i) => [id, names[i]]));
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const me = isPlayerId(params.get('me')) ? params.get('me') : '';
      if (params.has('id')) {
        const id = params.get('id');
        const [d] = isDuelId(id) ? await loadDuels([id]) : [null];
        if (!d) return send(res, 404, { error: 'This duel does not exist or has expired' });
        return send(res, 200, duelView(d, await namesOf([d]), me));
      }
      if (!me) return send(res, 400, { error: 'Missing duel id or player' });
      const [ids] = await redis([['ZREVRANGE', `duels:${me}`, 0, LIST_LIMIT - 1]]);
      const duels = (await loadDuels(ids)).filter(Boolean);
      const names = await namesOf(duels);
      return send(res, 200, { duels: duels.map(d => duelView(d, names, me)) });
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const playerId = String(body.playerId || '');
    const secret = String(body.secret || '');
    if (!isPlayerId(playerId) || !/^[0-9a-f]{32}$/.test(secret)) return send(res, 400, { error: 'Invalid player' });
    if (!(await claimPlayer(playerId, secret))) return send(res, 403, { error: 'This player id belongs to someone else' });
    const opponentName = cleanName(body.opponent);
    const opponent = opponentName ? await findPlayer(opponentName) : null;
    if (!opponent) return send(res, 404, { error: 'No player with this name' });
    if (opponent === playerId) return send(res, 400, { error: "You can't duel yourself" });

    // Un seul duel en cours par paire de joueurs : défier à nouveau renvoie celui qui tourne.
    const pairKey = `duelpair:${[playerId, opponent].sort().join(':')}`;
    const [current] = await redis([['GET', pairKey]]);
    if (current) {
      const [d] = await loadDuels([current]);
      if (d && duelView(d, {}, '').status === 'active') return send(res, 200, { id: current, existing: true });
    }

    const id = crypto.randomBytes(6).toString('base64url');
    const t = Date.now();
    await redis([
      ['HSET', duelKey(id), 'a', playerId, 'b', opponent, 'size', DUEL_SIZE, 'created', t],
      ['EXPIRE', duelKey(id), DUEL_TTL],
      ['ZADD', `duels:${playerId}`, t, id],
      ['ZADD', `duels:${opponent}`, t, id],
      ['ZREMRANGEBYRANK', `duels:${playerId}`, 0, -51],
      ['ZREMRANGEBYRANK', `duels:${opponent}`, 0, -51],
      ['SET', pairKey, id, 'PX', DUEL_PLAY_MS],
    ]);
    return send(res, 200, { id, existing: false });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
