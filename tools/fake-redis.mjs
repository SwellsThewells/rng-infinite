// Faux Redis en mémoire : seulement les commandes utilisées par /api, avec la sémantique de Redis.
// Sert aux tests (tools/test-api.mjs) et au serveur de dev (tools/dev.mjs).
export function fakeRedis() {
  const db = new Map();
  const zset = k => db.get(k) || (db.set(k, new Map()), db.get(k));
  const hash = zset; // un hash est aussi une Map champ → valeur
  const set = k => db.get(k) || (db.set(k, new Set()), db.get(k));
  const list = k => db.get(k) || (db.set(k, []), db.get(k));
  const asc = k => [...zset(k).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  const range = (len, a, b) => {
    const s = Number(a) < 0 ? len + Number(a) : Number(a);
    const e = Number(b) < 0 ? len + Number(b) : Number(b);
    return [Math.max(0, s), e];
  };

  // Expiration paresseuse de SET … PX (le délai entre deux tirages) : la clé disparaît à sa prochaine lecture.
  const expires = new Map();
  const alive = k => {
    if (expires.has(k) && expires.get(k) <= Date.now()) { db.delete(k); expires.delete(k); }
    return db.has(k);
  };

  const COMMANDS = {
    SET(k, v, ...opts) {
      if (opts.includes('NX') && alive(k)) return null;
      db.set(k, v);
      const px = opts.indexOf('PX');
      if (px >= 0) expires.set(k, Date.now() + Number(opts[px + 1])); else expires.delete(k);
      return 'OK';
    },
    GET: k => (alive(k) ? db.get(k) : null),
    DEL: (...keys) => keys.filter(k => db.delete(k)).length,
    INCR(k) { const v = Number(db.get(k) || 0) + 1; db.set(k, String(v)); return v; },
    EXPIRE: () => 1,
    HSET(k, ...pairs) {
      let added = 0;
      for (let i = 0; i < pairs.length; i += 2) { if (!hash(k).has(pairs[i])) added++; hash(k).set(pairs[i], pairs[i + 1]); }
      return added;
    },
    HSETNX(k, f, v) { if (hash(k).has(f)) return 0; hash(k).set(f, v); return 1; },
    HGET: (k, f) => (db.has(k) && db.get(k).has(f) ? db.get(k).get(f) : null),
    HMGET: (k, ...fields) => fields.map(f => COMMANDS.HGET(k, f)),
    HGETALL: k => (db.has(k) ? [...db.get(k).entries()].flat() : []),
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
    ZREVRANGE(k, a, b, ...opts) {
      const all = asc(k).reverse();
      const [s, e] = range(all.length, a, b);
      const out = all.slice(s, e + 1);
      return opts.includes('WITHSCORES') ? out.flatMap(([m, score]) => [m, String(score)]) : out.map(([m]) => m);
    },
    RPUSH(k, ...values) { const l = list(k); l.push(...values); return l.length; },
    LLEN: k => (db.has(k) ? db.get(k).length : 0),
    LRANGE(k, a, b) {
      const l = db.get(k) || [];
      const [s, e] = range(l.length, a, b);
      return l.slice(s, e + 1);
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
