// Sauvegarde de la version autonome (standalone/, servie sur Vercel), liée à un compte Google.
// La partie tourne dans le navigateur ; ce point d'accès ne fait que garder une copie compressée du joueur
// (le "code de sauvegarde") pour la retrouver sur un autre appareil.
//   GET  /api/save                                            → { googleClientId } ("" : connexion Google non configurée)
//   POST /api/save { action: 'signin', credential }           → { account, secret, save: { savedAt, code } | null }
//   POST /api/save { action: 'load', account, secret }        → { save }
//   POST /api/save { action: 'store', account, secret, code } → { savedAt }
// Réglages Vercel : GOOGLE_CLIENT_ID (client OAuth "Web" dont les origines autorisées incluent le site)
// et la base Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN), comme le reste de /api.
const crypto = require('node:crypto');
const { redis, verifyGoogleToken, sha256, cors, send } = require('./_lib');

// Seulement un client déclaré pour ce déploiement : celui par défaut du site d'origine refuserait cette adresse.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const MAX_CODE = 900000; // caractères ; une requête Upstash reste sous 1 Mo
const saveKey = account => `standalone:${account}`;
const secretsKey = account => `standalone:${account}:secrets`;

async function owns(account, secret) {
  if (!/^[0-9a-f]{32}$/.test(account) || !/^[0-9a-f]{32}$/.test(secret)) return false;
  const [member] = await redis([['SISMEMBER', secretsKey(account), sha256(secret)]]);
  return Number(member) === 1;
}

async function readSave(account) {
  const [savedAt, code] = await redis([['HGET', saveKey(account), 'savedAt'], ['HGET', saveKey(account), 'code']]);
  return code ? { savedAt: Number(savedAt) || 0, code } : null;
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method === 'GET') return send(res, 200, { googleClientId: CLIENT_ID });
  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST' });
  if (!CLIENT_ID) return send(res, 503, { error: 'Google sign-in is not set up on this site' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    if (body.action === 'signin') {
      let google;
      try {
        google = await verifyGoogleToken(body.credential || '', CLIENT_ID);
      } catch (err) {
        return send(res, 401, { error: 'Google sign-in failed, try again' });
      }
      // Identifiant opaque du compte : l'identifiant Google lui-même n'est pas stocké.
      const account = sha256(`google:${google.sub}`).slice(0, 32);
      const secret = crypto.randomBytes(16).toString('hex'); // un secret par appareil connecté
      await redis([['SADD', secretsKey(account), sha256(secret)]]);
      return send(res, 200, { account, secret, save: await readSave(account) });
    }

    const account = String(body.account || ''), secret = String(body.secret || '');
    if (!(await owns(account, secret))) return send(res, 403, { error: 'Signed out: sign in with Google again' });

    if (body.action === 'load') return send(res, 200, { save: await readSave(account) });

    if (body.action === 'store') {
      const code = String(body.code || '');
      if (!/^RNG1\.[A-Za-z0-9_-]+$/.test(code)) return send(res, 400, { error: 'Invalid save' });
      if (code.length > MAX_CODE) return send(res, 413, { error: 'Your save is too big to sync (export your history instead)' });
      const savedAt = Date.now();
      await redis([['HSET', saveKey(account), 'code', code, 'savedAt', savedAt]]);
      return send(res, 200, { savedAt });
    }

    return send(res, 400, { error: 'Unknown action' });
  } catch (err) {
    return send(res, err.status || 500, { error: err.message });
  }
};
