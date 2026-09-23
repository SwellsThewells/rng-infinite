// Duel en direct avec un code, de 2 à 10 joueurs : tout le monde tire en même temps, manche par manche, et voit les
// tirages de tous se révéler ensemble. Deux modes :
//   - rounds : chaque manche va au plus gros tirage (égalité en tête : personne) ; le premier à N manches gagne (1 à 10) ;
//   - xp     : le premier à atteindre un total d'XP gagne (si plusieurs le franchissent ensemble : le plus gros total).
// Les tirages sont des tirages normaux (historique, compteurs, classement), faits par le serveur au même instant pour
// tous les joueurs. Une manche part quand tout le monde est prêt, ou 15 s après le premier joueur prêt : un absent ne
// bloque pas la partie (son nombre est tiré quand même, comme celui des autres).
//   POST /api/room { action: 'create' | 'join' | 'start' | 'ready' | 'rematch', code?, size?, mode?, target?, playerId, secret, name }
//   GET  /api/room?code=<code>&me=<playerId>   (sondé toutes les ~1,5 s par les joueurs et les spectateurs)
const crypto = require('node:crypto');
const { engine, redis, cleanName, claimPlayer, claimName, recordRoll, cors, send } = require('./_lib');

const MIN_PLAYERS = 2, MAX_PLAYERS = 10;
const MAX_WINS = 10;
const XP_TARGETS = [25000, 50000, 100000, 250000, 1000000];
const MAX_ROUNDS = 100; // garde-fou : au-delà, le plus de manches (puis d'XP) gagne
const LEAD_MS = 2500; // délai avant la révélation commune : tout le monde a le temps de recevoir la manche
const GAP_MS = 8000; // écart minimal entre deux manches, comme le délai entre deux tirages
const AUTO_MS = 15000; // la manche part toute seule 15 s après le premier joueur prêt
const TTL = 86400; // une salle est gardée un jour après sa dernière action
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I, 32 signes
const roomKey = code => `room:${code}`;
const playersKey = code => `room:${code}:players`;
const roundsKey = code => `room:${code}:rounds`;
const isCode = code => /^[A-Z2-9]{5}$/.test(code);
const isPlayerId = id => /^[0-9a-f]{16}$/.test(String(id || ''));
const newCode = () => Array.from(crypto.randomBytes(5), b => ALPHABET[b % 32]).join('');

// Règles de la partie, bornées : taille 2-10, 1-10 manches gagnantes, ou un des paliers d'XP proposés.
function rules(body) {
  const size = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(Number(body.size) || 2)));
  const mode = body.mode === 'xp' ? 'xp' : 'rounds';
  const target = mode === 'xp'
    ? (XP_TARGETS.includes(Number(body.target)) ? Number(body.target) : XP_TARGETS[1])
    : Math.min(MAX_WINS, Math.max(1, Math.round(Number(body.target) || 3)));
  return { size, mode, target };
}

// Une salle : son hash (règles, hôte, "ready:<id>" = manche pour laquelle le joueur est prêt, "first:<k>" = heure du
// premier prêt), la liste ordonnée des joueurs { id, name } et la liste des manches { t, revealAt, n: [un nombre par joueur] }.
async function load(code) {
  const [flat, players, rounds] = await redis([
    ['HGETALL', roomKey(code)], ['LRANGE', playersKey(code), 0, -1], ['LRANGE', roundsKey(code), 0, -1],
  ]);
  const h = {};
  for (let i = 0; i < (flat || []).length; i += 2) h[flat[i]] = flat[i + 1];
  if (!h.host) return null;
  return {
    code, h, host: h.host, size: Number(h.size), mode: h.mode, target: Number(h.target), started: h.started === '1',
    players: (players || []).map(p => JSON.parse(p)), rounds: (rounds || []).map(r => JSON.parse(r)),
  };
}

// Index du seul maximum, ou null s'il y a égalité en tête.
function argmax(values) {
  const best = Math.max(...values);
  const top = values.map((v, i) => (v === best ? i : -1)).filter(i => i >= 0);
  return top.length === 1 ? top[0] : null;
}

function score(room) {
  const count = room.players.length;
  const wins = Array(count).fill(0), totals = Array(count).fill(0);
  const list = room.rounds.map(r => {
    const s = r.n.map(n => engine.scoreOf(n));
    s.forEach((v, i) => { totals[i] += v; });
    const winner = argmax(s);
    if (winner !== null) wins[winner]++;
    return { t: r.t, revealAt: r.revealAt, n: r.n, s, winner };
  });
  let done = false, winner = null;
  if (room.mode === 'xp' && totals.some(v => v >= room.target)) {
    done = true;
    winner = argmax(totals);
  } else if (room.mode !== 'xp' && wins.some(v => v >= room.target)) {
    done = true;
    winner = wins.findIndex(v => v >= room.target);
  } else if (room.rounds.length >= MAX_ROUNDS) {
    done = true;
    winner = argmax(wins);
    if (winner === null) winner = argmax(totals);
  }
  return { list, wins, totals, done, winner };
}

const readyFor = (room, id) => (room.h[`ready:${id}`] == null ? -1 : Number(room.h[`ready:${id}`]));

// Lance la manche suivante si tout le monde est prêt (ou 15 s après le premier prêt). Un seul appel (verrou par
// manche) tire les nombres de tous les joueurs au même instant.
async function advance(room, now = Date.now()) {
  if (!room.started || score(room).done) return room;
  const k = room.rounds.length;
  const ready = room.players.filter(p => readyFor(room, p.id) === k).length;
  if (!ready) return room;
  const first = Number(room.h[`first:${k}`] || now);
  if (ready < room.players.length && now < first + AUTO_MS) return room;
  const last = room.rounds[k - 1];
  if (last && now < last.revealAt + GAP_MS) return room;
  const [lock] = await redis([['SET', `${roomKey(room.code)}:draw:${k}`, '1', 'NX', 'EX', TTL]]);
  if (lock !== 'OK') return (await load(room.code)) || room;
  const round = { t: now, revealAt: now + LEAD_MS, n: room.players.map(() => crypto.randomInt(0, 1000001)) };
  await redis([
    ['RPUSH', roundsKey(room.code), JSON.stringify(round)],
    ...[roomKey(room.code), playersKey(room.code), roundsKey(room.code)].map(key => ['EXPIRE', key, TTL]),
    // Pas de tirage normal en parallèle pendant la manche.
    ...room.players.map(p => ['SET', `cooldown:${p.id}`, '1', 'PX', GAP_MS]),
  ]);
  await Promise.all(room.players.map((p, i) => recordRoll(p.id, round.n[i], round.t)));
  room.rounds.push(round);
  return room;
}

// État public, sans identifiant : `me` marque le joueur qui regarde.
function view(room, me) {
  const sc = score(room);
  const k = room.rounds.length;
  const status = !room.started ? 'lobby' : sc.done ? 'done' : 'playing';
  const readyCount = room.players.filter(p => readyFor(room, p.id) === k).length;
  const first = room.h[`first:${k}`];
  const last = room.rounds[k - 1];
  return {
    code: room.code, status, size: room.size, mode: room.mode, target: room.target,
    players: room.players.map((p, i) => ({
      name: p.name, me: p.id === me, host: p.id === room.host,
      ready: status === 'playing' && readyFor(room, p.id) === k, wins: sc.wins[i], total: sc.totals[i],
    })),
    rounds: sc.list,
    winner: sc.winner,
    // La manche part d'elle-même à autoAt (si quelqu'un est prêt), jamais avant nextAt (8 s après la précédente).
    autoAt: status === 'playing' && readyCount && readyCount < room.players.length && first ? Number(first) + AUTO_MS : null,
    nextAt: last ? last.revealAt + GAP_MS : 0,
    next: room.h.next || null, // code de la revanche, une fois lancée
    nextBy: room.h.nextBy || null, // nom de celui qui l'a lancée
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
      return send(res, 200, view(await advance(room), me));
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

    // Nouvelle salle avec ses règles ; pour une revanche, tous les joueurs y sont déjà et la partie commence aussitôt.
    async function createRoom(r, players) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const [created] = await redis([['HSETNX', roomKey(code), 'host', playerId]]);
        if (Number(created) !== 1) continue;
        const list = players || [{ id: playerId, name }];
        await redis([
          ['HSET', roomKey(code), 'size', players ? list.length : r.size, 'mode', r.mode, 'target', r.target, 'created', Date.now(),
            'count', list.length, 'started', players ? 1 : 0, ...list.flatMap(p => [`m:${p.id}`, 1])],
          ['RPUSH', playersKey(code), ...list.map(p => JSON.stringify(p))],
          ['EXPIRE', roomKey(code), TTL],
          ['EXPIRE', playersKey(code), TTL],
        ]);
        return code;
      }
      return null;
    }

    if (body.action === 'create') {
      const code = await createRoom(rules(body), null);
      if (!code) return send(res, 503, { error: 'Could not create a duel, try again' });
      return send(res, 200, view(await load(code), playerId));
    }

    const code = String(body.code || '').trim().toUpperCase();
    let room = isCode(code) ? await load(code) : null;
    if (!room) return send(res, 404, { error: 'No duel with this code' });
    const member = room.players.some(p => p.id === playerId);

    if (body.action === 'join') {
      if (member) return send(res, 200, view(room, playerId));
      if (room.started) return send(res, 422, { error: 'This duel has already started' });
      // Une place à la fois : le marqueur de membre évite les doublons, le compteur évite de dépasser la taille.
      const [isNew] = await redis([['HSETNX', roomKey(code), `m:${playerId}`, 1]]);
      if (Number(isNew) !== 1) return send(res, 200, view((await load(code)) || room, playerId));
      const [count] = await redis([['HINCRBY', roomKey(code), 'count', 1]]);
      if (Number(count) > room.size) {
        await redis([['HINCRBY', roomKey(code), 'count', -1], ['HDEL', roomKey(code), `m:${playerId}`]]);
        return send(res, 422, { error: 'This duel is full' });
      }
      const writes = [['RPUSH', playersKey(code), JSON.stringify({ id: playerId, name })]];
      if (Number(count) === room.size) writes.push(['HSET', roomKey(code), 'started', 1]); // complet : la partie commence
      await redis(writes);
      return send(res, 200, view(await load(code), playerId));
    }

    if (body.action === 'start') {
      if (room.host !== playerId) return send(res, 422, { error: 'Only the host can start the duel' });
      if (room.started) return send(res, 200, view(room, playerId));
      if (room.players.length < MIN_PLAYERS) return send(res, 422, { error: 'Wait for at least one opponent' });
      // La partie se joue à ceux qui sont là ; la salle se ferme aux nouveaux venus.
      await redis([['HSET', roomKey(code), 'started', 1, 'size', room.players.length]]);
      return send(res, 200, view(await load(code), playerId));
    }

    if (body.action === 'ready') {
      if (!member) return send(res, 422, { error: 'You are not in this duel' });
      if (!room.started) return send(res, 422, { error: 'The duel has not started yet' });
      if (score(room).done) return send(res, 422, { error: 'This duel is over' });
      const k = room.rounds.length;
      await redis([['HSET', roomKey(code), `ready:${playerId}`, k], ['HSETNX', roomKey(code), `first:${k}`, Date.now()]]);
      room = await advance(await load(code));
      return send(res, 200, view(room, playerId));
    }

    // Revanche : une seule nouvelle salle par partie, mêmes joueurs et mêmes règles.
    if (body.action === 'rematch') {
      if (!member) return send(res, 422, { error: 'You are not in this duel' });
      if (!score(room).done) return send(res, 422, { error: 'This duel is not over yet' });
      let next = room.h.next || null;
      if (!next) {
        const code2 = await createRoom({ size: room.players.length, mode: room.mode, target: room.target }, room.players);
        if (!code2) return send(res, 503, { error: 'Could not create a duel, try again' });
        const [won] = await redis([['HSETNX', roomKey(code), 'next', code2]]);
        if (Number(won) === 1) {
          next = code2;
          await redis([['HSET', roomKey(code), 'nextBy', name]]);
        } else {
          await redis([['DEL', roomKey(code2), playersKey(code2)]]);
          [next] = await redis([['HGET', roomKey(code), 'next']]);
        }
      }
      return send(res, 200, view(await load(next), playerId));
    }
    return send(res, 400, { error: 'Unknown action' });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
