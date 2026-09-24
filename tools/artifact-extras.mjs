// Ajouts réservés à la version autonome (tools/artifact.mjs) : la rareté Cosmic et des badges en plus.
// rng-infinite.com et son classement n'en voient rien : les fichiers du site ne changent pas, la version
// autonome reçoit des copies modifiées au moment du build. Le score de chaque nouveau badge est tiré de sa
// fréquence réelle sur les 1 000 001 nombres, comme pour ceux du jeu d'origine (100 × 1 000 001 / nb).
import vm from 'node:vm';

// ---- nouveaux badges : id, libellé, description, emoji, test (source JS évaluée dans la portée du moteur :
// c = { n, s, L, d, cnt, sum, prod, distinct }, et les fonctions du moteur comme isPrime).
export const BADGES = [
  { id: 'NINE_LIVES', label: 'Nine Lives', emoji: '🐈', desc: 'Divisible by 9.', check: 'c => c.n > 0 && c.n % 9 === 0' },
  { id: 'UNLUCKY', label: 'Unlucky', emoji: '🐈‍⬛', desc: 'Contains "13".', check: "c => c.s.includes('13')" },
  { id: 'CLOCK', label: 'Clock', emoji: '🕒', desc: 'Exactly 4 digits that read as a time on a 24-hour clock (HH:MM).',
    check: 'c => c.L === 4 && c.d[0] * 10 + c.d[1] < 24 && c.d[2] < 6' },
  { id: 'PERFECT_SUM', label: 'Perfect Sum', emoji: '🧮', desc: 'The digit sum is a perfect square.',
    check: 'c => c.sum > 0 && Number.isInteger(Math.sqrt(c.sum))' },
  { id: 'HARMONY', label: 'Harmony', emoji: '⚖️', desc: 'At least 2 digits, and their sum equals their product.',
    check: 'c => c.L >= 2 && c.sum === c.prod' },
  { id: 'EVEN_STEVEN', label: 'Even Steven', emoji: '🟰', desc: 'At least 3 digits, all even.',
    check: 'c => c.L >= 3 && c.d.every(x => x % 2 === 0)' },
  { id: 'ODD_SQUAD', label: 'Odd Squad', emoji: '🎭', desc: 'At least 3 digits, all odd.',
    check: 'c => c.L >= 3 && c.d.every(x => x % 2 === 1)' },
  { id: 'PRIME_TIME', label: 'Prime Time', emoji: '🔑', desc: 'At least 3 digits, all prime (2, 3, 5, 7).',
    check: 'c => c.L >= 3 && c.d.every(x => x === 2 || x === 3 || x === 5 || x === 7)' },
  { id: 'TWIN_PRIME', label: 'Twin Prime', emoji: '👯', desc: 'A prime with another prime 2 away.',
    check: 'c => isPrime(c.n) && (isPrime(c.n - 2) || isPrime(c.n + 2))' },
  { id: 'EMIRP', label: 'Emirp', emoji: '🔄', desc: 'A prime that is a different prime written backwards.',
    check: "c => { const r = Number(c.s.split('').reverse().join('')); return r !== c.n && isPrime(c.n) && isPrime(r); }" },
  { id: 'TRIANGULAR', label: 'Triangular', emoji: '🔺', desc: 'A triangular number (1, 3, 6, 10, 15…).',
    check: 'c => { const k = Math.round((Math.sqrt(8 * c.n + 1) - 1) / 2); return c.n > 0 && k * (k + 1) / 2 === c.n; }' },
  { id: 'NARCISSISTIC', label: 'Narcissistic', emoji: '🪞', desc: 'Equals the sum of its digits, each raised to the number of digits (153 = 1³ + 5³ + 3³).',
    check: 'c => c.n >= 10 && c.d.reduce((t, x) => t + x ** c.L, 0) === c.n' },
  { id: 'PERFECT_NUMBER', label: 'Perfect Number', emoji: '💎', desc: 'Equals the sum of its divisors: 6, 28, 496 or 8128.',
    check: 'c => c.n === 6 || c.n === 28 || c.n === 496 || c.n === 8128' },
  { id: 'KAPREKAR', label: "Kaprekar's Constant", emoji: '🌀', desc: 'Exactly 6174.', check: 'c => c.n === 6174' },
  { id: 'HALFWAY', label: 'Halfway', emoji: '🌗', desc: 'Exactly 500,000.', check: 'c => c.n === 500000' },
];

// ---- remplacements dans les fichiers du site (chacun doit trouver exactement le nombre de cibles indiqué)
function patch(src, file, pairs) {
  for (const [from, to, times = 1] of pairs) {
    const found = src.split(from).length - 1;
    if (found !== times) throw new Error(`${file} : « ${from.slice(0, 60)} » trouvé ${found} fois au lieu de ${times}`);
    src = src.split(from).join(to);
  }
  return src;
}

export function patchEngine(src) {
  const checks = BADGES.map(b => `    ${b.id}: ${b.check},`).join('\n');
  return patch(src, 'js/engine.js', [
    // Cosmic : cartes du top 0,1 % ; badges trouvés moins d'une fois sur 1 000 000 (score ≥ 100 000 000).
    ["[1e7, 'anomaly']];", "[1e7, 'anomaly'], [1e8, 'mythic']];"],
    ["[99, 'anomaly']];", "[99, 'anomaly'], [99.9, 'mythic']];"],
    ["'anomaly', 'mythic'];", "'anomaly', 'mythic', 'cosmic'];"],
    ["return 'mythic';", "return 'cosmic';", 2],
    ['  // ---------------------------------------------------------------- moteur',
      `  // Badges de la version autonome (tools/artifact-extras.mjs).\n  Object.assign(CHECKS, {\n${checks}\n  });\n\n  // ---------------------------------------------------------------- moteur`],
  ]);
}

export function patchApp(src) {
  return patch(src, 'js/app.js', [
    ["const TIERS_DESC = ['mythic',", "const TIERS_DESC = ['cosmic', 'mythic',"],
    ['anomaly: 5, mythic: 6 };', 'anomaly: 5, mythic: 6, cosmic: 7 };'],
    ["anomaly: '🟧', mythic: '🟥' };", "anomaly: '🟧', mythic: '🟥', cosmic: '🌌' };"],
    ["      mythic: { count: 240, speed: 12, colors: ['#ec4899', '#a855f7', '#22d3ee', '#f43f5e', '#fde047'] },",
      "      mythic: { count: 240, speed: 12, colors: ['#ec4899', '#a855f7', '#22d3ee', '#f43f5e', '#fde047'] },\n" +
      "      cosmic: { count: 420, speed: 15, colors: ['#facc15', '#818cf8', '#22d3ee', '#ffffff', '#c084fc', '#fde68a'] },"],
    ["      if (tier === 'mythic') {\n        const f = document.createElement('div');\n        f.className = 'flash';\n        f.style.background = ",
      "      if (tier === 'mythic' || tier === 'cosmic') {\n        const f = document.createElement('div');\n        f.className = 'flash';\n        f.style.background = tier === 'cosmic'\n          ? 'radial-gradient(circle at 50% 30%, rgba(250,204,21,.55), rgba(99,102,241,.4) 40%, rgba(15,23,42,.25) 70%, transparent)'\n          : "],
    ["anomaly: '#f97316', mythic: '#ec4899' };", "anomaly: '#f97316', mythic: '#ec4899', cosmic: '#facc15' };"],
    ["a.tier === 'anomaly' || a.tier === 'mythic' ? 'shake'", "a.tier === 'anomaly' || a.tier === 'mythic' || a.tier === 'cosmic' ? 'shake'"],
    ["if (tier === 'mythic') sinceMythic = i;", "if (tier === 'mythic' || tier === 'cosmic') sinceMythic = i;"],
    ["const blocks = ['mythic', 'anomaly',", "const blocks = ['cosmic', 'mythic', 'anomaly',"],
    ["...['mythic', 'anomaly', 'epic', 'rare'].map(", "...['cosmic', 'mythic', 'anomaly', 'epic', 'rare'].map("],
    ["['anomaly', 'top 5–1%'], ['mythic', 'top 1%']];", "['anomaly', 'top 5–1%'], ['mythic', 'top 1–0.1%'], ['cosmic', 'top 0.1%']];"],
    ["['mythic', 'under 0.001% (1 in 100,000+)']];",
      "['mythic', '0.0001–0.001% (1 in 100,000+)'], ['cosmic', 'under 0.0001% (1 in 1,000,000+)']];"],
  ]);
}

export const patchShop = src => patch(src, 'js/shop.js', [['anomaly: 25, mythic: 100 };', 'anomaly: 25, mythic: 100, cosmic: 250 };']]);

export const patchAchievements = src => patch(src, 'js/achievements.js', [
  ["'anomaly', 'mythic'];", "'anomaly', 'mythic', 'cosmic'];"],
  // Un Cosmic compte aussi comme Mythic pour ces deux succès.
  ["test: st => num(st['t:mythic']) >= 1 },", "test: st => atLeast(st, 'mythic') >= 1 },"],
  ["desc: 'Roll 10 Mythics', test: st => num(st['t:mythic']) >= 10 },",
    "desc: 'Roll 10 Mythics or better', test: st => atLeast(st, 'mythic') >= 10 },\n" +
    "    { id: 'cosmic', emoji: '🌌', title: 'Cosmic', desc: 'Roll a Cosmic (top 0.1%)', test: st => num(st['t:cosmic']) >= 1 },"],
]);

export const patchServerLib = src => patch(src, 'api/_lib.js', [["'anomaly', 'mythic'];", "'anomaly', 'mythic', 'cosmic'];"]]);

export const CSS = `
:root { --tier-cosmic: oklch(45.7% .24 277); --chart-cosmic: #4f46e5; }
.dark { --tier-cosmic: oklch(78.5% .115 274); --chart-cosmic: #818cf8; }
[data-tier="cosmic"] {
  --t-from: #1e1b4b; --t-via: #312e81; --t-to: #0f172a; --t-border: #facc15;
  --t-glow: 0 0 18px rgba(250, 204, 21, .35), 0 0 34px rgba(99, 102, 241, .3);
  --t-text: #fef9c3; --t-pill-text: #4338ca; --t-pill-bg: #eef2ff; --t-pill-border: #a5b4fc;
  --t-hl: #a5b4fc; --t-hl-border: #4f46e5; --t-accent: var(--tier-cosmic); --t-shimmer: 1;
}
.dark [data-tier="cosmic"] {
  --t-from: #1e1b4b; --t-via: #312e81; --t-to: #020617; --t-border: #eab308;
  --t-glow: 0 0 22px rgba(250, 204, 21, .45), 0 0 40px rgba(129, 140, 248, .35);
  --t-text: #fef9c3; --t-pill-text: #c7d2fe; --t-pill-bg: rgba(30, 27, 75, .6); --t-pill-border: rgba(129, 140, 248, .6);
  --t-hl: #4338ca; --t-hl-border: #a5b4fc;
}
[data-tier="cosmic"] .card-stage.lit .rays { opacity: .6; animation-duration: 6s; }
`;

// ---- données : les nouveaux badges comptés sur tous les nombres, puis percentiles, cotes et moyennes recalculés.
export function buildData(engineSrc, baseMeta) {
  const module = { exports: {} };
  vm.runInNewContext(engineSrc, { module, globalThis: {} });
  const { createEngine, TIER_ORDER } = module.exports;
  const SPAN = 1000001;

  // 1. Fréquence des nouveaux badges seuls → score naturel.
  const probe = createEngine(BADGES.map(b => ({ id: b.id, label: b.label, desc: b.desc, emoji: b.emoji, score: 1, family: null })), null);
  const counts = new Map(BADGES.map(b => [b.id, 0]));
  for (let n = 0; n < SPAN; n++) probe.scoreOf(n, b => counts.set(b.id, counts.get(b.id) + 1));
  const extra = BADGES.map(b => {
    if (!counts.get(b.id)) throw new Error(`badge ${b.id} : aucun nombre ne l'obtient`);
    return { id: b.id, label: b.label, desc: b.desc, emoji: b.emoji, score: Math.round((100 * SPAN) / counts.get(b.id)), family: null, custom: true };
  });
  const meta = baseMeta.concat(extra).sort((a, b) => b.score - a.score);

  // 2. Totaux de tous les nombres avec tous les badges (même méthode que tools/build.mjs).
  const engine = createEngine(meta, null);
  const index = new Map(engine.badges.map((b, i) => [b.id, i]));
  const all = new Float64Array(engine.badges.length);
  const totals = new Float64Array(SPAN);
  for (let n = 0; n < SPAN; n++) totals[n] = engine.scoreOf(n, b => { all[index.get(b.id)]++; });

  const sorted = Float64Array.from(totals).sort();
  const table = [];
  let lastPct = -1;
  for (let i = 0; i < SPAN; i++) {
    if (i > 0 && sorted[i] === sorted[i - 1]) continue;
    const pct = (100 * i) / SPAN;
    // Plus fin dans la queue : Cosmic se joue au 1/1000e de pourcent près.
    if (table.length === 0 || pct - lastPct >= (pct >= 99 ? 0.0001 : 0.01)) {
      table.push([sorted[i], Math.round(pct * 10000) / 10000]);
      lastPct = pct;
    }
  }
  const withPct = createEngine(meta, table);
  const tierOdds = Object.fromEntries(TIER_ORDER.map(t => [t, 0]));
  let pctSum = 0;
  for (let n = 0; n < SPAN; n++) {
    tierOdds[withPct.cardTier(totals[n])]++;
    pctSum += withPct.percentileOf(totals[n]);
  }
  for (const t of TIER_ORDER) tierOdds[t] /= SPAN;
  const badgeOdds = Object.fromEntries(engine.badges.map((b, i) => [b.id, all[i] / SPAN]));

  const digitCounts = new Array(10).fill(0);
  let digitTotal = 0;
  for (let n = 0; n < SPAN; n++) {
    const s = String(n);
    for (let i = 0; i < s.length; i++) digitCounts[s.charCodeAt(i) - 48]++;
    digitTotal += s.length;
  }

  const stats = { mean: totals.reduce((a, b) => a + b, 0) / SPAN, median: sorted[Math.floor(SPAN / 2)], meanPct: pctSum / SPAN };
  return {
    extra, tierOdds,
    badgeMetaJS: `window.BADGE_META = ${JSON.stringify(meta)};\nwindow.BADGE_ODDS = ${JSON.stringify(badgeOdds)};\n`,
    percentilesJS: `window.SCORE_PERCENTILES = ${JSON.stringify(table)};\nwindow.TIER_ODDS = ${JSON.stringify(tierOdds)};\n` +
      `window.SCORE_STATS = ${JSON.stringify(stats)};\nwindow.DIGIT_ODDS = ${JSON.stringify(digitCounts.map(x => x / digitTotal))};\n`,
  };
}
