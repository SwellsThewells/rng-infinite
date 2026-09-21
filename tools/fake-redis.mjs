// Faux Redis en mémoire : seulement les commandes utilisées par /api, avec la sémantique de Redis.
// Sert aux tests (tools/test-api.mjs) et au serveur de dev (tools/dev.mjs).
export function fakeRedis() {
  const db = new Map();
  const zset = k => db.get(k) || (db.set(k, new Map()), db.get(k));
  const hash = zset; // un hash est aussi une Map champ → valeur
  const set = k => db.get(k) || (db.set(k, new Set()), db.get(k));
  const asc = k => [...zset(k).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  const range = (len, a, b) => {
    const s = Number(a) < 0 ? len + Number(a) : Number(a);
    const e = Number(b) < 0 ? len + Number(b) : Number(b);
    return [Math.max(0, s), e];
  };

  const COMMANDS = {
    SET(k, v, ...opts) {
      if (opts.includes('NX') && db.has(k)) return null;
      db.set(k, v);
      return 'OK';
    },
    GET: k => (db.has(k) ? db.get(k) : null),
    DEL: (...keys) => keys.filter(k => db.delete(k)).length,
    INCR(k) { const v = Number(db.get(k) || 0) + 1; db.set(k, String(v)); return v; },
    EXPIRE: () => 1,
    HSET(k, f, v) { hash(k).set(f, v); return 1; },
    HGET: (k, f) => (db.has(k) && db.get(k).has(f) ? db.get(k).get(f) : null),
    HMGET: (k, ...fields) => fields.map(f => COMMANDS.HGET(k, f)),
    HINCRBY(k, f, by) { const h = hash(k), v = Number(h.get(f) || 0) + Number(by); h.set(f, String(v)); return v; },
    SADD(k, ...members) {
      const s = set(k);
      let added = 0;
      for (const m of members) if (!s.has(m)) { s.add(m); added++; }
      return added;
    },
    SISMEMBER: (k, m) => (db.has(k) && db.get(k).has(m) ? 1 : 0),
    ZADD(k, ...pairs) {
      const z = zset(k);
      let added = 0;
      for (let i = 0; i < pairs.length; i += 2) {
        if (!z.has(pairs[i + 1])) added++;
        z.set(pairs[i + 1], Number(pairs[i]));
      }
      return added;
    },
    ZSCORE: (k, m) => (db.has(k) && db.get(k).has(m) ? String(db.get(k).get(m)) : null),
    ZCARD: k => (db.has(k) ? db.get(k).size : 0),
    ZRANGE(k, a, b) {
      const all = asc(k);
      const [s, e] = range(all.length, a, b);
      return all.slice(s, e + 1).map(([m]) => m);
    },
    // Toujours appelé avec WITHSCORES par /api/leaderboard.
    ZREVRANGE(k, a, b) {
      const all = asc(k).reverse();
      const [s, e] = range(all.length, a, b);
      return all.slice(s, e + 1).flatMap(([m, score]) => [m, String(score)]);
    },
    ZREVRANK: (k, m) => { const i = asc(k).reverse().findIndex(([id]) => id === m); return i < 0 ? null : i; },
    ZREMRANGEBYRANK(k, a, b) {
      const all = asc(k);
      const [s, e] = range(all.length, a, b);
      const removed = e < s ? [] : all.slice(s, e + 1);
      removed.forEach(([m]) => zset(k).delete(m));
      return removed.length;
    },
  };

  // Même format de réponse que l'API REST "pipeline" d'Upstash.
  const run = commands => commands.map(([cmd, ...args]) => ({ result: COMMANDS[cmd](...args) }));
  return { db, zset, run };
}
