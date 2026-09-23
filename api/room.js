// Duel en direct avec un code : deux joueurs tirent en même temps, manche par manche, et voient les deux tirages
// se révéler ensemble. Chaque manche va au plus gros tirage ; le premier à 3 manches gagne (5 au plus, égalité
// départagée au total d'XP). Les tirages sont des tirages normaux (historique, compteurs, classement), faits par
// le serveur au même instant pour les deux joueurs dès que les deux sont prêts.
//   POST /api/room { action: 'create' | 'join' | 'ready' | 'rematch', code?, playerId, secret, name }
//   GET  /api/room?code=<code>&me=<playerId>   (sondé toutes les ~1,5 s par les joueurs et les spectateurs)
const crypto = require('node:crypto');
const { engine, redis, cleanName, claimPlayer, claimName, recordRoll, cors, send } = require('./_lib');

const MAX_ROUNDS = 5;
const TO_WIN = 3;
const LEAD_MS = 2500; // délai avant la révélation commune : les deux joueurs ont le temps de recevoir la manche
const GAP_MS = 8000; // écart minimal entre deux manches, comme le délai entre deux tirages
const TTL = 86400; // une salle est gardée un jour après sa dernière action
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I, 32 signes
const roomKey = code => `room:${code}`;
const roundsKey = code => `room:${code}:rounds`;
const isCode = code => /^[A-Z2-9]{5}$/.test(code);
const isPlayerId = id => /^[0-9a-f]{16}$/.test(String(id || ''));
const newCode = () => Array.from(crypto.randomBytes(5), b => ALPHABET[b % 32]).join('');

async function load(code) {
  const [flat, rounds] = await redis([['HGETALL', roomKey(code)], ['LRANGE', roundsKey(code), 0, -1]]);
  const h = {};
  for (let i = 0; i < (flat || []).length; i += 2) h[flat[i]] = flat[i + 1];
  if (!h.a) return null;
  const ready = v => (v == null ? -1 : Number(v));
  return {
    code, a: h.a, b: h.b || null, next: h.next || null, nextBy: h.nextBy == null ? null : Number(h.nextBy), created: Number(h.created),
    readyA: ready(h.readyA), readyB: ready(h.readyB), rounds: (rounds || []).map(r => JSON.parse(r)),
  };
}

function score(rounds) {
  const wins = [0, 0], totals = [0, 0];
  const list = rounds.map(r => {
    const sa = engine.scoreOf(r.na), sb = engine.scoreOf(r.nb);
    totals[0] += sa;
    totals[1] += sb;
    const winner = sa === sb ? null : sa > sb ? 0 : 1;
    if (winner !== null) wins[winner]++;
    return { a: { n: r.na, s: sa }, b: { n: r.nb, s: sb }, t: r.t, revealAt: r.revealAt, winner };
  });
  const done = wins[0] >= TO_WIN || wins[1] >= TO_WIN || rounds.length >= MAX_ROUNDS;
  let winner = null;
  if (done && wins[0] !== wins[1]) winner = wins[0] > wins[1] ? 0 : 1;
  else if (done && totals[0] !== totals[1]) winner = totals[0] > totals[1] ? 0 : 1;
  return { list, wins, totals, done, winner };
}

// Les deux joueurs sont prêts pour la manche suivante : un seul appel (verrou par manche) tire les deux nombres.
async function advance(room, now = Date.now()) {
  const k = room.rounds.length;
  if (!room.b || room.readyA !== k || room.readyB !== k || score(room.rounds).done) return room;
  const last = room.rounds[k - 1];
  if (last && now < last.revealAt + GAP_MS) return room;
  const [lock] = await redis([['SET', `${roomKey(room.code)}:draw:${k}`, '1', 'NX', 'EX', TTL]]);
  if (lock !== 'OK') return (await load(room.code)) || room;
  const round = { na: crypto.randomInt(0, 1000001), nb: crypto.randomInt(0, 1000001), t: now, revealAt: now + LEAD_MS };
  await redis([
    ['RPUSH', roundsKey(room.code), JSON.stringify(round)],
    ['EXPIRE', roundsKey(room.code), TTL],
    ['EXPIRE', roomKey(room.code), TTL],
    // Pas de tirage normal en parallèle pendant la manche.
    ['SET', `cooldown:${room.a}`, '1', 'PX', GAP_MS],
    ['SET', `cooldown:${room.b}`, '1', 'PX', GAP_MS],
  ]);
  await Promise.all([recordRoll(room.a, round.na, round.t), recordRoll(room.b, round.nb, round.t)]);
  room.rounds.push(round);
  return room;
}

// État public, sans identifiant : `me` marque le côté du joueur qui regarde.
async function view(room, me) {
  const [names] = await redis([['HMGET', 'names', room.a, room.b || room.a]]);
  const sc = score(room.rounds);
  const k = room.rounds.length;
  const side = (id, ready, i) => (id ? { name: names[i] || 'Player', me: id === me, ready: ready === k && !sc.done, wins: sc.wins[i], total: sc.totals[i] } : null);
  const last = room.rounds[k - 1];
  return {
    code: room.code,
    status: !room.b ? 'waiting' : sc.done ? 'done' : 'playing',
    toWin: TO_WIN,
    maxRounds: MAX_ROUNDS,
    players: [side(room.a, room.readyA, 0), side(room.b, room.readyB, 1)],
    rounds: sc.list,
    winner: sc.winner,
    next: room.next, // code de la revanche, une fois lancée par l'un des deux (nextBy : 0 ou 1)
    nextBy: room.nextBy,
    nextAt: last ? last.revealAt + GAP_MS : 0,
    now: Date.now(),
  };
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const code = String(params.get('code') || '').toUpperCase();
      const me = isPlayerId(params.get('me')) ? params.get('me') : '';
      const room = isCode(code) ? await load(code) : null;
      if (!room) return send(res, 404, { error: 'No duel with this code' });
      return send(res, 200, await view(await advance(room), me));
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const playerId = String(body.playerId || '');
    const secret = String(body.secret || '');
    const name = cleanName(body.name);
    if (!isPlayerId(playerId) || !/^[0-9a-f]{32}$/.test(secret)) return send(res, 400, { error: 'Invalid player' });
    if (!name) return send(res, 400, { error: 'Pick a player name first' });
    if (!(await claimPlayer(playerId, secret))) return send(res, 403, { error: 'This player id belongs to someone else' });
    if (!(await claimName(playerId, name))) return send(res, 409, { error: 'This name is already taken, pick another one' });

    // Nouvelle salle ; pour une revanche, l'adversaire y est déjà et la partie commence tout de suite.
    async function createRoom(opponent) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const [created] = await redis([['HSETNX', roomKey(code), 'a', playerId]]);
        if (Number(created) !== 1) continue;
        const fields = ['created', Date.now()];
        if (opponent) fields.push('b', opponent);
        await redis([['HSET', roomKey(code), ...fields], ['EXPIRE', roomKey(code), TTL]]);
        return code;
      }
      return null;
    }

    if (body.action === 'create') {
      const code = await createRoom(null);
      if (!code) return send(res, 503, { error: 'Could not create a duel, try again' });
      return send(res, 200, await view(await load(code), playerId));
    }

    const code = String(body.code || '').trim().toUpperCase();
    let room = isCode(code) ? await load(code) : null;
    if (!room) return send(res, 404, { error: 'No duel with this code' });
    const side = room.a === playerId ? 'A' : room.b === playerId ? 'B' : null;

    if (body.action === 'join') {
      if (!side) {
        if (room.b) return send(res, 422, { error: 'This duel already has two players' });
        const [joined] = await redis([['HSETNX', roomKey(code), 'b', playerId]]);
        if (Number(joined) !== 1) return send(res, 422, { error: 'This duel already has two players' });
        room.b = playerId;
      }
      return send(res, 200, await view(room, playerId));
    }

    if (body.action === 'ready') {
      if (!side) return send(res, 422, { error: 'You are not in this duel' });
      if (!room.b) return send(res, 422, { error: 'Wait for your opponent to join' });
      if (score(room.rounds).done) return send(res, 422, { error: 'This duel is over' });
      const k = room.rounds.length;
      await redis([['HSET', roomKey(code), `ready${side}`, k]]);
      room[`ready${side}`] = k;
      room = await advance(room);
      return send(res, 200, await view(room, playerId));
    }
    // Revanche : une seule nouvelle salle par duel, même si les deux la demandent en même temps.
    if (body.action === 'rematch') {
      if (!side || !room.b) return send(res, 422, { error: 'You are not in this duel' });
      if (!score(room.rounds).done) return send(res, 422, { error: 'This duel is not over yet' });
      let next = room.next;
      if (!next) {
        const code2 = await createRoom(side === 'A' ? room.b : room.a);
        if (!code2) return send(res, 503, { error: 'Could not create a duel, try again' });
        const [won] = await redis([['HSETNX', roomKey(code), 'next', code2]]);
        if (Number(won) === 1) {
          next = code2;
          await redis([['HSET', roomKey(code), 'nextBy', side === 'A' ? 0 : 1]]);
        }
        else {
          await redis([['DEL', roomKey(code2)]]);
          [next] = await redis([['HGET', roomKey(code), 'next']]);
        }
      }
      return send(res, 200, await view(await load(next), playerId));
    }
    return send(res, 400, { error: 'Unknown action' });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
