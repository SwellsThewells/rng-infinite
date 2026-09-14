// Génère les données Luau du jeu Roblox et les hash qui valident le port du moteur.
//   node tools/roblox.mjs
// Sorties :
//   roblox/src/ReplicatedStorage/RNG/BadgeMeta.luau   — badges (même ordre que js/badge-meta.js)
//   roblox/src/ReplicatedStorage/RNG/Percentiles.luau — table des percentiles réduite (même rareté et même « Top x % » pour tout score)
//   roblox/tests/Expected.luau                        — hash attendus, recalculés dans Studio par roblox/tests/validate.luau
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createEngine, TIER_ORDER } = require(path.join(ROOT, 'js/engine.js'));

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['js/badge-meta.js', 'js/percentiles.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox);
const { BADGE_META, SCORE_PERCENTILES, TIER_ODDS, SCORE_STATS } = JSON.parse(JSON.stringify(sandbox.window));

// Libellés adaptés aux règles de Roblox (drogue, allusions sexuelles) : mêmes id et scores, la validation ne change pas.
const OVERRIDES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/source/roblox-overrides.json'), 'utf8'));
for (const id of Object.keys(OVERRIDES)) if (!BADGE_META.some(b => b.id === id)) throw new Error('Override de badge inconnu : ' + id);

const engine = createEngine(BADGE_META, SCORE_PERCENTILES);
const index = new Map(engine.badges.map((b, i) => [b.id, i + 1]));
const TIER_RANK = Object.fromEntries(TIER_ORDER.map((t, i) => [t, i]));

// ---------------------------------------------------------------- sérialisation Luau
function lua(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'string') {
    const j = JSON.stringify(v);
    if (j.includes('\\u')) throw new Error('Échappement \\u non géré en Luau : ' + v);
    return j;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '{' + v.map(lua).join(', ') + '}';
  return '{' + Object.entries(v).filter(([, x]) => x !== null && x !== undefined && x !== false)
    .map(([k, x]) => `${k} = ${lua(x)}`).join(', ') + '}';
}
const HEADER = '-- Généré par tools/roblox.mjs — ne pas éditer.\n';
const write = (rel, text) => {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`  ${rel} (${(text.length / 1024).toFixed(1)} Ko)`);
};

// ---------------------------------------------------------------- percentiles réduits
// Le jeu n'utilise le percentile que pour la rareté de carte et le libellé « Top/Bottom x % » coloré :
// on ne garde que les entrées où l'un des deux change, ce qui donne exactement le même affichage pour tout score.
const CARD_TIERS = [[1, 'trash'], [50, 'common'], [75, 'uncommon'], [90, 'rare'], [95, 'epic'], [99, 'anomaly']];
const tierOfPct = p => { for (const [l, t] of CARD_TIERS) if (p < l) return t; return 'mythic'; };
const labelKey = p => [p >= 50 ? 1 : 2, p >= 50 ? Math.round(100 - p) : Math.round(p), p >= 95 ? 5 : p >= 80 ? 4 : p >= 50 ? 3 : p >= 20 ? 2 : 1];
const reduced = [];
let lastKey = null;
for (const e of SCORE_PERCENTILES) {
  const key = tierOfPct(e[1]) + ':' + labelKey(e[1]).join(',');
  if (key !== lastKey) { reduced.push(e); lastKey = key; }
}

console.log('Écriture :');
write('roblox/src/ReplicatedStorage/RNG/BadgeMeta.luau',
  HEADER + `-- ${BADGE_META.length} badges triés par score décroissant.\nreturn {\n` +
  BADGE_META.map(b => { const o = OVERRIDES[b.id] || {}; return '\t' + lua({ id: b.id, label: o.label ?? b.label, desc: o.desc ?? b.desc, emoji: o.emoji ?? b.emoji, score: b.score, family: b.family, custom: b.custom }); }).join(',\n') +
  '\n}\n');
write('roblox/src/ReplicatedStorage/RNG/Percentiles.luau',
  HEADER + `-- ${reduced.length} entrées {score, percentile} extraites des ${SCORE_PERCENTILES.length} de js/percentiles.js.\nreturn {\n` +
  `\tentries = {\n${reduced.map(e => '\t\t' + lua(e)).join(',\n')}\n\t},\n` +
  `\ttierOdds = ${lua(TIER_ODDS)},\n\tmeanEP = ${Math.round(SCORE_STATS.mean)},\n\tmedianEP = ${SCORE_STATS.median},\n}\n`);

// ---------------------------------------------------------------- hash de validation
const MOD = 2147483647;
const mix = (h, v) => (h * 31 + v) % MOD;

// 1) Les 1 000 001 nombres, par blocs de 10 000 : total, rareté, libellé %, groupes et sous-badges.
const t0 = Date.now();
const blocks = [];
for (let b = 0; b <= 100; b++) {
  let h = 0;
  for (let n = b * 10000; n <= Math.min(b * 10000 + 9999, 1000000); n++) {
    const a = engine.analyze(n);
    const [kind, v, bucket] = labelKey(a.percentile);
    h = mix(h, n); h = mix(h, a.total); h = mix(h, TIER_RANK[a.tier]); h = mix(h, kind); h = mix(h, v); h = mix(h, bucket);
    h = mix(h, a.groups.length);
    for (const g of a.groups) {
      h = mix(h, index.get(g.badge.id));
      h = mix(h, g.subsidiary.length);
      for (const sb of g.subsidiary) h = mix(h, index.get(sb.id));
    }
  }
  blocks.push(h);
}
console.log(`Hash des 1 000 001 nombres : ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// 2) Échantillon : chiffres surlignés et ligne de détail de chaque badge obtenu.
const fmt = v => Math.round(v).toLocaleString('en-US');
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = k => String(k).split('').map(ch => SUP[ch]).join('');
const POWER_K = { SQUARE: 2, CUBE: 3, FOURTH_POWER: 4, FIFTH_POWER: 5, SIXTH_POWER: 6, SEVENTH_POWER: 7, EIGHTH_POWER: 8, NINTH_POWER: 9, TENTH_POWER: 10, ELEVENTH_POWER: 11, THIRTEENTH_POWER: 13, SEVENTEENTH_POWER: 17, NINETEENTH_POWER: 19 };
const BASES = { POWER_OF_TWO: 2, POWER_OF_THREE: 3, POWER_OF_FIVE: 5, POWER_OF_SEVEN: 7 };
const DIVS = { DOZEN: 12, LUCKY_SEVEN_DIV: 7, ELEVEN: 11 };
// Copie de badgeDetail (js/app.js), seule source de vérité pour ces libellés.
function badgeDetail(id, n) {
  const s = String(n);
  const digits = s.split('').map(Number);
  const sum = digits.reduce((a, b) => a + b, 0);
  const parts = () => engine.highlight(id, n).map(g => Number(g.map(i => s[i]).join('')));
  if (POWER_K[id]) return `${Math.round(Math.pow(n, 1 / POWER_K[id]))}${sup(POWER_K[id])}`;
  if (BASES[id]) { let k = 0, p = 1; while (p < n) { p *= BASES[id]; k++; } return `${BASES[id]}${sup(k)}`; }
  if (DIVS[id]) return `${fmt(n)} = ${DIVS[id]} × ${fmt(n / DIVS[id])}`;
  switch (id) {
    case 'EQUATION': {
      const [a, b, c] = parts();
      const op = a + b === c ? '+' : a - b === c ? '−' : a * b === c ? '×' : '÷';
      return `${a} ${op} ${b} = ${c}`;
    }
    case 'ARITHMETIC': { const v = parts(); const d = v[1] - v[0]; return `${v.join(' → ')}  (step ${d > 0 ? '+' : ''}${d})`; }
    case 'GEOMETRIC': { const v = parts(); return `${v.join(' → ')}  (×${+(v[1] / v[0]).toFixed(3)})`; }
    case 'CONSEC_PAIR_EXACT': case 'CONSEC_TRIPLE_EXACT': case 'CONSEC_TRIPLE_SCRAMBLED':
    case 'CONSEC_QUAD_EXACT': case 'CONSEC_QUAD_SCRAMBLED': case 'CONSEC_PAIR_ADJACENT':
    case 'CONSEC_PAIR_NEARBY': case 'CONSEC_TRIPLE_CONTAINS': case 'CONSEC_QUAD_CONTAINS':
      return parts().join(' · ');
    case 'HARSHAD': return `${fmt(n)} ÷ ${sum} = ${fmt(n / sum)}`;
    case 'PRONIC': { const k = Math.round((Math.sqrt(1 + 4 * n) - 1) / 2); return `${k} × ${k + 1}`; }
    case 'FACTORIAL': { let k = 1, f = 1; while (f < n) f *= ++k; return `${k}!`; }
    case 'OUROBOROS': { let k = 1; while (Math.pow(k, k) < n) k++; return `${k}${sup(k)}`; }
    case 'FEATHER': case 'HEAVY': case 'BLACKJACK': return `digit sum = ${sum}`;
    case 'SPY': return `sum ${sum} = product ${digits.reduce((a, b) => a * b, 1)}`;
    case 'BALANCED': {
      const h = s.length / 2;
      const l = digits.slice(0, h).reduce((a, b) => a + b, 0);
      return `${s.slice(0, h)} → ${l}  =  ${s.slice(h)} → ${l}`;
    }
    default: return '';
  }
}

const EXTRA = [1000000, 999999, 777777, 696969, 676767, 123456, 314159, 271828, 161803, 40320, 1337, 911, 13, 130514, 235235];
const sample = [];
for (let n = 0; n < 10000; n++) sample.push(n);
for (let i = 1; i <= 10000; i++) sample.push((i * 99991) % 1000001);
sample.push(...EXTRA);
const sampleBlocks = [];
for (let start = 0; start < sample.length; start += 1000) {
  let h = 0;
  for (const n of sample.slice(start, start + 1000)) {
    h = mix(h, n);
    for (const id of engine.analyze(n).earnedIds) {
      h = mix(h, index.get(id));
      const groups = engine.highlight(id, n);
      h = mix(h, groups.length);
      for (const g of groups) { h = mix(h, g.length); for (const i of g) h = mix(h, i + 1); }
      for (const byte of Buffer.from(badgeDetail(id, n), 'utf8')) h = mix(h, byte);
    }
  }
  sampleBlocks.push(h);
}

write('roblox/tests/Expected.luau',
  HEADER + '-- Hash attendus pour roblox/tests/validate.luau (voir tools/roblox.mjs).\nreturn {\n' +
  `\tblocks = ${lua(blocks)},\n\tsampleBlocks = ${lua(sampleBlocks)},\n\textra = ${lua(EXTRA)},\n` +
  `\tcustom = ${lua(Object.fromEntries(BADGE_META.filter(b => b.custom).map(b => [b.id, true])))},\n}\n`);
console.log(`Percentiles : ${reduced.length} entrées gardées sur ${SCORE_PERCENTILES.length} · échantillon ${sample.length} nombres`);
