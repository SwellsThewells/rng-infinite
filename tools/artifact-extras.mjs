// Ajouts réservés à la version autonome (tools/artifact.mjs) :
//   - tirages de 0 à 9 999 999 (7 chiffres) au lieu de 0 à 1 000 000 ;
//   - trois raretés au-dessus de Mythic : Cosmic (top 0,1 %), Celestial (top 0,01 %), Infinity (top 0,001 %) ;
//   - des badges en plus.
// rng-infinite.com et son classement n'en voient rien : les fichiers du site ne changent pas, la version
// autonome reçoit des copies modifiées au moment du build. Tous les scores de badges (ceux d'origine compris)
// sont recalculés sur les 10 000 000 nombres avec la règle du jeu d'origine : 100 × nombres possibles / nb.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';

export const MAX_ROLL = 9999999;
const SPAN = MAX_ROLL + 1;
export const NEW_TIERS = ['cosmic', 'celestial', 'infinity'];

// ---- nouveaux badges. check : source JS évaluée dans la portée du moteur, avec
// c = { n, s, L, d, cnt, sum, prod, distinct } et les fonctions du moteur (isPrime, isPalindrome, isSquare…).
const has = (id, label, emoji, text, desc) => ({ id, label, emoji, desc: desc || `Contains "${text}".`, check: `c => c.s.includes('${text}')` });
const exact = (id, label, emoji, n, desc) => ({ id, label, emoji, desc: desc || `Exactly ${Number(n).toLocaleString('en-US')}.`, check: `c => c.n === ${n}` });
export const BADGES = [
  // Arithmétique
  { id: 'NINE_LIVES', label: 'Nine Lives', emoji: '🐈', desc: 'Divisible by 9.', check: 'c => c.n > 0 && c.n % 9 === 0' },
  { id: 'PERFECT_SUM', label: 'Perfect Sum', emoji: '🧮', desc: 'The digit sum is a perfect square.', check: 'c => c.sum > 0 && isSquare(c.sum)' },
  { id: 'HARMONY', label: 'Harmony', emoji: '⚖️', desc: 'At least 2 digits, and their sum equals their product.', check: 'c => c.L >= 2 && c.sum === c.prod' },
  { id: 'LUCKY_ROOT', label: 'Lucky Root', emoji: '🌱', desc: 'The digital root is 7 (add the digits until one is left).', check: 'c => c.n % 9 === 7' },
  { id: 'BAKERS_DOZEN', label: "Baker's Dozen", emoji: '🥖', desc: 'The digits add up to 13.', check: 'c => c.sum === 13' },
  { id: 'HITCHHIKER', label: 'Hitchhiker', emoji: '🛸', desc: 'The digits add up to 42.', check: 'c => c.sum === 42' },
  { id: 'MAX_POWER', label: 'Max Power', emoji: '🔋', desc: 'The digits add up to 55 or more.', check: 'c => c.sum >= 55' },
  { id: 'TRIANGULAR', label: 'Triangular', emoji: '🔺', desc: 'A triangular number (1, 3, 6, 10, 15…).',
    check: 'c => { const k = Math.round((Math.sqrt(8 * c.n + 1) - 1) / 2); return c.n > 0 && k * (k + 1) / 2 === c.n; }' },
  { id: 'TETRAHEDRAL', label: 'Tetrahedral', emoji: '🔻', desc: 'A tetrahedral number (1, 4, 10, 20, 35…): cannonballs stacked in a pyramid.',
    check: 'c => { if (c.n < 1) return false; let k = Math.round(Math.cbrt(6 * c.n)); for (let j = k - 1; j <= k + 1; j++) if (j > 0 && j * (j + 1) * (j + 2) / 6 === c.n) return true; return false; }' },
  { id: 'HAPPY', label: 'Happy Number', emoji: '😊', desc: 'Replacing it with the sum of the squares of its digits over and over reaches 1.',
    check: 'c => { let x = c.n; for (let i = 0; i < 20 && x !== 1 && x !== 4; i++) { let t = 0; while (x > 0) { const q = x % 10; t += q * q; x = (x - q) / 10; } x = t; } return x === 1; }' },
  { id: 'CATALAN', label: 'Catalan Number', emoji: '🌳', desc: 'A Catalan number (1, 2, 5, 14, 42, 132…).', check: 'c => EXTRA_SETS.CATALAN.has(c.n)' },
  { id: 'LUCAS', label: 'Lucas Number', emoji: '🧬', desc: 'A Lucas number (2, 1, 3, 4, 7, 11, 18…), the Fibonacci numbers\' cousins.', check: 'c => EXTRA_SETS.LUCAS.has(c.n)' },
  { id: 'NARCISSISTIC', label: 'Narcissistic', emoji: '🪞', desc: 'Equals the sum of its digits, each raised to the number of digits (153 = 1³ + 5³ + 3³).',
    check: 'c => c.n >= 10 && c.d.reduce((t, x) => t + x ** c.L, 0) === c.n' },
  { id: 'PERFECT_NUMBER', label: 'Perfect Number', emoji: '💎', desc: 'Equals the sum of its divisors: 6, 28, 496, 8128 or 33,550,336… only four fit here.',
    check: 'c => c.n === 6 || c.n === 28 || c.n === 496 || c.n === 8128' },
  // Nombres premiers
  { id: 'TWIN_PRIME', label: 'Twin Prime', emoji: '👯', desc: 'A prime with another prime 2 away.', check: 'c => isPrime(c.n) && (isPrime(c.n - 2) || isPrime(c.n + 2))' },
  { id: 'EMIRP', label: 'Emirp', emoji: '🔄', desc: 'A prime that is a different prime written backwards.',
    check: "c => { if (!isPrime(c.n)) return false; const r = Number(c.s.split('').reverse().join('')); return r !== c.n && isPrime(r); }" },
  { id: 'PALPRIME', label: 'Palprime', emoji: '🪩', desc: 'A prime that reads the same both ways.', check: 'c => c.n > 9 && isPalindrome(c.s) && isPrime(c.n)' },
  { id: 'SOPHIE_GERMAIN', label: 'Sophie Germain Prime', emoji: '🎓', desc: 'A prime p where 2p + 1 is also prime.', check: 'c => isPrime(c.n) && isPrime(2 * c.n + 1)' },
  // Chiffres
  { id: 'SEVEN_DIGITS', label: 'Seven Digits', emoji: '7️⃣', desc: 'Has exactly seven digits.', check: 'c => c.L === 7' },
  { id: 'EVEN_STEVEN', label: 'Even Steven', emoji: '🟰', desc: 'At least 3 digits, all even.', check: 'c => c.L >= 3 && c.d.every(x => x % 2 === 0)' },
  { id: 'ODD_SQUAD', label: 'Odd Squad', emoji: '🎭', desc: 'At least 3 digits, all odd.', check: 'c => c.L >= 3 && c.d.every(x => x % 2 === 1)' },
  { id: 'PRIME_TIME', label: 'Prime Time', emoji: '🔑', desc: 'At least 3 digits, all prime (2, 3, 5, 7).', check: 'c => c.L >= 3 && c.d.every(x => x === 2 || x === 3 || x === 5 || x === 7)' },
  { id: 'TERNARY', label: 'Ternary', emoji: '🔱', desc: 'At least 4 digits, using only 0, 1 and 2.', check: 'c => c.L >= 4 && c.d.every(x => x <= 2)' },
  { id: 'OCTAL', label: 'Octal', emoji: '🐙', desc: 'Seven digits and no 8 or 9.', check: 'c => c.L === 7 && c.cnt[8] === 0 && c.cnt[9] === 0' },
  { id: 'SEVEN_WONDERS', label: 'Seven Wonders', emoji: '🗿', desc: 'Seven digits, all different.', check: 'c => c.L === 7 && c.distinct === 7' },
  { id: 'LUCKY_FRAME', label: 'Lucky Frame', emoji: '🖼️', desc: 'Starts and ends with 7.', check: 'c => c.L >= 2 && c.d[0] === 7 && c.d[c.L - 1] === 7' },
  { id: 'LUCKY_SCATTER', label: 'Lucky Scatter', emoji: '🌟', desc: 'Exactly three 7s, not all side by side.', check: "c => c.cnt[7] === 3 && !c.s.includes('777')" },
  { id: 'ZIGZAG', label: 'Zigzag', emoji: '⚡', desc: 'At least 5 digits that go up, down, up, down… (or the other way).',
    check: 'c => { if (c.L < 5) return false; for (let i = 1; i < c.L; i++) { const a = c.d[i] - c.d[i - 1]; if (a === 0) return false; if (i > 1 && Math.sign(a) === Math.sign(c.d[i - 1] - c.d[i - 2])) return false; } return true; }' },
  { id: 'PYRAMID', label: 'Pyramid', emoji: '🔼', desc: 'A palindrome whose digits climb to the middle and back down (1234321).',
    check: 'c => { if (c.L < 3 || c.L % 2 === 0 || !isPalindrome(c.s)) return false; for (let i = 1; i <= (c.L - 1) / 2; i++) if (c.d[i] <= c.d[i - 1]) return false; return true; }' },
  { id: 'CENTER_STAGE', label: 'Center Stage', emoji: '🎤', desc: 'Seven digits, and the middle one is bigger than all the others.',
    check: 'c => c.L === 7 && c.d.every((x, i) => i === 3 || x < c.d[3])' },
  { id: 'FULCRUM', label: 'Fulcrum', emoji: '🎚️', desc: 'Seven digits, and the first three add up to the same as the last three.',
    check: 'c => c.L === 7 && c.d[0] + c.d[1] + c.d[2] === c.d[4] + c.d[5] + c.d[6]' },
  // Dans le nombre
  has('UNLUCKY', 'Unlucky', '🐈‍⬛', '13'),
  has('KILOBYTE', 'Kilobyte', '💾', '1024'),
  has('GAME_2048', '2048', '🧩', '2048'),
  has('SIXTEEN_BITS', 'Sixteen Bits', '🕹️', '65536'),
  has('MOON_LANDING', 'Moon Landing', '🌕', '1969'),
  has('ODYSSEY', 'Space Odyssey', '🛰️', '2001'),
  has('CHRISTMAS', 'Christmas', '🎄', '1225', 'Contains "1225" (December 25).'),
  has('HALLOWEEN', 'Halloween', '🎃', '1031', 'Contains "1031" (October 31).'),
  has('LEAP_DAY', 'Leap Day', '🐸', '0229', 'Contains "0229" (February 29).'),
  has('LOST', 'Lost', '🏝️', '4815', 'Contains "4815", the start of 4 8 15 16 23 42.'),
  has('VALJEAN', 'Prisoner 24601', '⛓️', '24601'),
  has('GOLDEN_SLICE', 'Golden Slice', '🥇', '1618', 'Contains "1618", the start of the golden ratio.'),
  has('FIB_RUN', 'Fibonacci Run', '🐚', '112358', 'Contains "112358" (1, 1, 2, 3, 5, 8).'),
  has('PI_SLICE_6', 'Pi Slice (6)', '🍰', '314159'),
  has('E_SLICE_6', 'E Slice (6)', '🧪', '271828'),
  has('TAU_SLICE_6', 'Tau Slice (6)', '⭕', '628318'),
  has('SEASONS_OF_LOVE', 'Seasons of Love', '🕯️', '525600', 'Contains "525600", the minutes in a year.'),
  { id: 'MEME_COMBO', label: 'Meme Combo', emoji: '🤪', desc: 'Contains "42069" or "69420".', check: "c => c.s.includes('42069') || c.s.includes('69420')" },
  // Un seul nombre
  exact('TAXICAB', 'Taxicab', '🚕', 1729, 'Exactly 1,729: the smallest number that is the sum of two cubes in two ways.'),
  exact('OVER_9000', "It's Over 9000", '💪', 9001),
  exact('KAPREKAR', "Kaprekar's Constant", '🌀', 6174),
  exact('HALFWAY', 'Halfway', '🌗', 5000000, 'Exactly 5,000,000, the middle of the range.'),
  exact('JENNY', 'Jenny', '☎️', 8675309, 'Exactly 8,675,309 (867-5309).'),
  exact('JACKPOT_SEVEN', 'Jackpot Seven', '🎰', 7777777),
  exact('SEQUENCE_7', 'Sequence (7)', '🪜', 1234567),
  exact('COUNTDOWN', 'Countdown', '🚀', 7654321),
  exact('PI_SEVEN', 'Pi (7)', '🥧', 3141592, 'Exactly 3,141,592: the first seven digits of pi.'),
  exact('E_SEVEN', 'Euler (7)', '📈', 2718281, "Exactly 2,718,281: the first seven digits of Euler's number."),
  exact('GOLDEN_SEVEN', 'Golden (7)', '🌻', 1618033, 'Exactly 1,618,033: the first seven digits of the golden ratio.'),
  exact('CALCULATOR_LEGEND', 'Calculator Legend', '🔢', 5318008, 'Exactly 5,318,008: turn the calculator upside down.'),
  exact('TOP_ROLL', 'Top Roll', '🏔️', 9999999, 'Exactly 9,999,999, the biggest possible roll.'),
];

// Ensembles précalculés, déclarés dans la portée du moteur à côté des badges.
const PRELUDE = `
  const EXTRA_SETS = (() => {
    const upTo = (next, a, b) => { const out = new Set(); while (a <= ${MAX_ROLL}) { out.add(a); [a, b] = [b, next(a, b)]; } return out; };
    const catalan = new Set();
    for (let n = 0, c = 1; c <= ${MAX_ROLL}; n++) { catalan.add(c); c = c * 2 * (2 * n + 1) / (n + 2); }
    return { CATALAN: catalan, LUCAS: upTo((a, b) => a + b, 2, 1) };
  })();`;

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
    ['const MAX_ROLL = 1000000;', `const MAX_ROLL = ${MAX_ROLL};`],
    ['COLOSSAL: c => c.n > 999000,', 'COLOSSAL: c => c.n > 9990000,'],
    // Badges : d'après le nombre de tirages possibles qui les obtiennent (score = 1e9 / nb).
    // Mythic 11 à 100 nombres, Cosmic 3 à 10, Celestial 2, Infinity un seul.
    ["[1e7, 'anomaly']];", "[1e7, 'anomaly'], [1e8, 'mythic'], [5e8, 'cosmic'], [1e9, 'celestial']];"],
    // Cartes : Mythic top 1 %, Cosmic top 0,1 %, Celestial top 0,01 %, Infinity top 0,001 %.
    ["[99, 'anomaly']];", "[99, 'anomaly'], [99.9, 'mythic'], [99.99, 'cosmic'], [99.999, 'celestial']];"],
    ["'anomaly', 'mythic'];", `'anomaly', 'mythic', ${NEW_TIERS.map(t => `'${t}'`).join(', ')}];`],
    ["return 'mythic';", "return 'infinity';", 2],
    ['  // ---------------------------------------------------------------- moteur',
      `  // Badges de la version autonome (tools/artifact-extras.mjs).${PRELUDE}\n  Object.assign(CHECKS, {\n${checks}\n  });\n\n  // ---------------------------------------------------------------- moteur`],
  ]);
}

const TOP = "tier === 'mythic' || tier === 'cosmic' || tier === 'celestial' || tier === 'infinity'";
export function patchApp(src) {
  return patch(src, 'js/app.js', [
    ["const TIERS_DESC = ['mythic',", "const TIERS_DESC = ['infinity', 'celestial', 'cosmic', 'mythic',"],
    ['anomaly: 5, mythic: 6 };', 'anomaly: 5, mythic: 6, cosmic: 7, celestial: 8, infinity: 9 };'],
    ["anomaly: '🟧', mythic: '🟥' };", "anomaly: '🟧', mythic: '🟥', cosmic: '🌌', celestial: '💠', infinity: '♾️' };"],
    ["      mythic: { count: 240, speed: 12, colors: ['#ec4899', '#a855f7', '#22d3ee', '#f43f5e', '#fde047'] },",
      "      mythic: { count: 240, speed: 12, colors: ['#ec4899', '#a855f7', '#22d3ee', '#f43f5e', '#fde047'] },\n" +
      "      cosmic: { count: 400, speed: 14, colors: ['#facc15', '#818cf8', '#22d3ee', '#ffffff', '#c084fc', '#fde68a'] },\n" +
      "      celestial: { count: 520, speed: 15, colors: ['#e0f2fe', '#7dd3fc', '#ffffff', '#bae6fd', '#38bdf8', '#f0f9ff'], sparks: true },\n" +
      "      infinity: { count: 700, speed: 17, colors: ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#d946ef', '#ffffff'] },"],
    ["      if (tier === 'mythic') {\n        const f = document.createElement('div');\n        f.className = 'flash';\n        f.style.background = ",
      `      if (${TOP}) {\n        const f = document.createElement('div');\n        f.className = 'flash';\n        f.style.background = ` +
      "tier === 'infinity' ? 'conic-gradient(from 0deg at 50% 30%, rgba(239,68,68,.45), rgba(234,179,8,.45), rgba(34,197,94,.45), rgba(6,182,212,.45), rgba(99,102,241,.45), rgba(217,70,239,.45), rgba(239,68,68,.45))'\n" +
      "          : tier === 'celestial' ? 'radial-gradient(circle at 50% 30%, rgba(255,255,255,.8), rgba(125,211,252,.45) 40%, rgba(14,165,233,.15) 70%, transparent)'\n" +
      "          : tier === 'cosmic' ? 'radial-gradient(circle at 50% 30%, rgba(250,204,21,.55), rgba(99,102,241,.4) 40%, rgba(15,23,42,.25) 70%, transparent)'\n          : "],
    ["anomaly: '#f97316', mythic: '#ec4899' };", "anomaly: '#f97316', mythic: '#ec4899', cosmic: '#facc15', celestial: '#7dd3fc', infinity: '#d946ef' };"],
    ["a.tier === 'anomaly' || a.tier === 'mythic' ? 'shake'", "a.tier === 'anomaly' || TIER_RANK[a.tier] >= TIER_RANK.mythic ? 'shake'"],
    ["if (tier === 'mythic') sinceMythic = i;", "if (TIER_RANK[tier] >= TIER_RANK.mythic) sinceMythic = i;"],
    ["const blocks = ['mythic', 'anomaly',", "const blocks = ['infinity', 'celestial', 'cosmic', 'mythic', 'anomaly',"],
    ["...['mythic', 'anomaly', 'epic', 'rare'].map(", "...['infinity', 'celestial', 'cosmic', 'mythic', 'anomaly', 'epic', 'rare'].map("],
    ["['anomaly', 'top 5–1%'], ['mythic', 'top 1%']];",
      "['anomaly', 'top 5–1%'], ['mythic', 'top 1–0.1%'], ['cosmic', 'top 0.1–0.01%'], ['celestial', 'top 0.01–0.001%'], ['infinity', 'top 0.001% (100 numbers)']];"],
    ["['mythic', 'under 0.001% (1 in 100,000+)']];",
      "['mythic', 'found by 11 to 100 of the 10,000,000 numbers'], ['cosmic', 'found by 3 to 10 numbers'], ['celestial', 'found by exactly 2 numbers'], ['infinity', 'found by a single number']];"],
    // Top x % plus précis pour les raretés du haut.
    ["`Top ${Math.round(100 - p) || '<1'}%`", "`Top ${100 - p >= 1 ? Math.round(100 - p) : 100 - p >= 0.001 ? +(100 - p).toPrecision(1) : '<0.001'}%`"],
    // 7 chiffres.
    ["'??????'.split('')", "'???????'.split('')", 2],
    ['const slotCount = Math.max(6, a.str.length);', 'const slotCount = Math.max(7, a.str.length);'],
    ['const slotCount = Math.max(6, ...sides', 'const slotCount = Math.max(7, ...sides'],
    ['buckets[Math.min(9, Math.floor(r[0] / 100000))]++;', 'buckets[Math.min(9, Math.floor(r[0] / 1000000))]++;'],
    ['(N * (k === 9 ? 100001 : 100000)) / 1000001', '(N * 1000000) / 10000000'],
    ["(k === 0 ? '0' : k + '00K')", "(k === 0 ? '0' : k + 'M')"],
    ['${fmt(k * 100000)} – ${fmt(k === 9 ? 1000000 : (k + 1) * 100000 - 1)}', '${fmt(k * 1000000)} – ${fmt((k + 1) * 1000000 - 1)}'],
    ['draws a number from 0 to 1,000,000.', 'draws a number from 0 to 9,999,999.'],
    // Les scores sont 10 fois plus grands : la course à l'XP des duels aussi.
    ['const XP_TARGETS = [25000, 50000, 100000, 250000, 1000000];', 'const XP_TARGETS = [250000, 500000, 1000000, 2500000, 10000000];'],
    ['? Number(d.xp) : 50000,', '? Number(d.xp) : 500000,'],
  ]);
}

export const patchStore = src => patch(src, 'js/store.js', [['const MAX_ROLL = 1000000;', `const MAX_ROLL = ${MAX_ROLL};`]]);

export const patchShop = src => patch(src, 'js/shop.js', [
  ['anomaly: 25, mythic: 100 };', 'anomaly: 25, mythic: 100, cosmic: 250, celestial: 1000, infinity: 5000 };'],
]);

export const patchAchievements = src => patch(src, 'js/achievements.js', [
  ["'anomaly', 'mythic'];", `'anomaly', 'mythic', ${NEW_TIERS.map(t => `'${t}'`).join(', ')}];`],
  // Les raretés du dessus comptent aussi comme Mythic pour ces deux succès.
  ["test: st => num(st['t:mythic']) >= 1 },", "test: st => atLeast(st, 'mythic') >= 1 },"],
  ["desc: 'Roll 10 Mythics', test: st => num(st['t:mythic']) >= 10 },",
    "desc: 'Roll 10 Mythics or better', test: st => atLeast(st, 'mythic') >= 10 },\n" +
    "    { id: 'cosmic', emoji: '🌌', title: 'Cosmic', desc: 'Roll a Cosmic or better (top 0.1%)', test: st => atLeast(st, 'cosmic') >= 1 },\n" +
    "    { id: 'celestial', emoji: '💠', title: 'Celestial', desc: 'Roll a Celestial or better (top 0.01%)', test: st => atLeast(st, 'celestial') >= 1 },\n" +
    "    { id: 'infinity', emoji: '♾️', title: 'Infinite', desc: 'Roll an Infinity (top 0.001%, 1 in 100,000)', test: st => num(st['t:infinity']) >= 1 },"],
  ["desc: 'Roll a number worth 1,000,000 XP or more', test: st => num(st.best) >= 1000000 },",
    "desc: 'Roll a number worth 10,000,000 XP or more', test: st => num(st.best) >= 10000000 },"],
]);

const serverRange = file => src => patch(src, file, [['randomInt(0, 1000001)', `randomInt(0, ${SPAN})`]]);
export const patchServer = {
  'api/_lib.js': src => patch(src, 'api/_lib.js', [["'anomaly', 'mythic'];", `'anomaly', 'mythic', ${NEW_TIERS.map(t => `'${t}'`).join(', ')}];`]]),
  'api/roll.js': serverRange('api/roll.js'),
  'api/room.js': src => patch(serverRange('api/room.js')(src), 'api/room.js', [
    ['const XP_TARGETS = [25000, 50000, 100000, 250000, 1000000];', 'const XP_TARGETS = [250000, 500000, 1000000, 2500000, 10000000];'],
  ]),
  'api/history.js': src => patch(src, 'api/history.js', [['r[0] <= 1000000', `r[0] <= ${MAX_ROLL}`]]),
};

export const CSS = `
:root {
  --tier-cosmic: oklch(45.7% .24 277); --chart-cosmic: #4f46e5;
  --tier-celestial: oklch(50% .13 237); --chart-celestial: #0284c7;
  --tier-infinity: oklch(48% .25 320); --chart-infinity: #c026d3;
}
.dark {
  --tier-cosmic: oklch(78.5% .115 274); --chart-cosmic: #818cf8;
  --tier-celestial: oklch(84% .1 230); --chart-celestial: #7dd3fc;
  --tier-infinity: oklch(76% .17 320); --chart-infinity: #e879f9;
}
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
[data-tier="celestial"] {
  --t-from: #f0f9ff; --t-via: #ffffff; --t-to: #e0f2fe; --t-border: #38bdf8;
  --t-glow: 0 0 20px rgba(56, 189, 248, .45), 0 0 44px rgba(255, 255, 255, .9), 0 0 60px rgba(125, 211, 252, .35);
  --t-text: #0c4a6e; --t-pill-text: #0369a1; --t-pill-bg: #f0f9ff; --t-pill-border: #7dd3fc;
  --t-hl: #bae6fd; --t-hl-border: #0284c7; --t-accent: var(--tier-celestial); --t-shimmer: 1;
}
.dark [data-tier="celestial"] {
  --t-from: #0c4a6e; --t-via: #e0f2fe; --t-to: #0c4a6e; --t-border: #7dd3fc;
  --t-glow: 0 0 24px rgba(125, 211, 252, .6), 0 0 48px rgba(224, 242, 254, .35);
  --t-text: #082f49; --t-pill-text: #bae6fd; --t-pill-bg: rgba(12, 74, 110, .5); --t-pill-border: rgba(125, 211, 252, .6);
  --t-hl: #0369a1; --t-hl-border: #7dd3fc;
}
[data-tier="infinity"] {
  --t-from: #fecaca; --t-via: #fef08a; --t-to: #c7d2fe; --t-border: #d946ef;
  --t-glow: 0 0 20px rgba(217, 70, 239, .45), 0 0 40px rgba(34, 211, 238, .35), 0 0 64px rgba(250, 204, 21, .3);
  --t-text: #111827; --t-pill-text: #a21caf; --t-pill-bg: #fdf4ff; --t-pill-border: #f0abfc;
  --t-hl: #f0abfc; --t-hl-border: #c026d3; --t-accent: var(--tier-infinity); --t-shimmer: 1;
}
.dark [data-tier="infinity"] {
  --t-from: #7f1d1d; --t-via: #1e1b4b; --t-to: #134e4a; --t-border: #e879f9;
  --t-glow: 0 0 24px rgba(232, 121, 249, .55), 0 0 48px rgba(34, 211, 238, .35), 0 0 72px rgba(250, 204, 21, .25);
  --t-text: #fdf4ff; --t-pill-text: #f5d0fe; --t-pill-bg: rgba(112, 26, 117, .45); --t-pill-border: rgba(232, 121, 249, .6);
  --t-hl: #a21caf; --t-hl-border: #f0abfc;
}
/* Infinity : le bord de la carte fait défiler l'arc-en-ciel. */
.num-card[data-tier="infinity"] { border-color: transparent; background-image: linear-gradient(var(--t-from), var(--t-to)), conic-gradient(from var(--inf-a, 0deg), #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444);
  background-origin: border-box; background-clip: padding-box, border-box; animation: inf-spin 3s linear infinite; }
@property --inf-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
@keyframes inf-spin { to { --inf-a: 360deg; } }
[data-tier="cosmic"] .card-stage.lit .rays { opacity: .6; animation-duration: 6s; }
[data-tier="celestial"] .card-stage.lit .rays { opacity: .7; animation-duration: 5s; }
[data-tier="infinity"] .card-stage.lit .rays { opacity: .75; animation-duration: 3.5s;
  background: repeating-conic-gradient(from 0deg, #ef4444 0deg 5deg, transparent 5deg 10deg, #eab308 10deg 15deg, transparent 15deg 20deg, #22c55e 20deg 25deg, transparent 25deg 30deg, #06b6d4 30deg 35deg, transparent 35deg 40deg, #6366f1 40deg 45deg, transparent 45deg 50deg, #d946ef 50deg 55deg, transparent 55deg 60deg); }
@media (prefers-reduced-motion: reduce) { .num-card[data-tier="infinity"] { animation: none; } }
`;

// ---- données : fréquence de chaque badge sur les 10 000 000 nombres → scores, puis percentiles et cotes.
// Découpé sur tous les cœurs (worker_threads) et mis en cache dans tools/.cache (la première fois : quelques minutes).
const WORKER = `
const { workerData, parentPort } = require('node:worker_threads');
const vm = require('node:vm');
const { engineSrc, meta, start, end, mode } = workerData;
const module = { exports: {} };
vm.runInNewContext(engineSrc, { module, globalThis: {} });
const engine = module.exports.createEngine(meta, null);
if (mode === 'count') {
  const index = new Map(engine.badges.map((b, i) => [b.id, i]));
  const counts = new Float64Array(engine.badges.length);
  const ids = engine.badges.map(b => b.id);
  for (let n = start; n < end; n++) engine.scoreOf(n, b => { counts[index.get(b.id)]++; });
  parentPort.postMessage({ ids, counts });
} else {
  const totals = new Float64Array(end - start);
  for (let n = start; n < end; n++) totals[n - start] = engine.scoreOf(n);
  parentPort.postMessage({ totals }, [totals.buffer]);
}
`;

function runWorkers(engineSrc, meta, mode) {
  const threads = Math.max(1, os.cpus().length);
  const size = Math.ceil(SPAN / threads);
  return Promise.all(Array.from({ length: threads }, (_, i) => new Promise((resolve, reject) => {
    const w = new Worker(WORKER, { eval: true, workerData: { engineSrc, meta, start: i * size, end: Math.min(SPAN, (i + 1) * size), mode } });
    w.once('message', resolve);
    w.once('error', reject);
  })));
}

export async function buildData(engineSrc, baseMeta, cacheDir) {
  const key = crypto.createHash('sha1').update(engineSrc).update(JSON.stringify(baseMeta)).update(JSON.stringify(BADGES)).digest('hex').slice(0, 16);
  const cacheFile = path.join(cacheDir, `extras-${key}.json`);
  if (fs.existsSync(cacheFile)) return { ...JSON.parse(fs.readFileSync(cacheFile, 'utf8')), cached: true };

  const module = { exports: {} };
  vm.runInNewContext(engineSrc, { module, globalThis: {} });
  const { createEngine, TIER_ORDER } = module.exports;

  // 1. Combien de nombres obtiennent chaque badge (anciens et nouveaux) → score = 100 × 10 000 000 / nb.
  const known = new Set(baseMeta.map(b => b.id));
  const probeMeta = baseMeta.map(b => ({ ...b, score: 1 })).concat(
    BADGES.filter(b => !known.has(b.id)).map(b => ({ id: b.id, label: b.label, desc: b.desc, emoji: b.emoji, score: 1, family: null, custom: true })));
  const counts = new Map();
  for (const part of await runWorkers(engineSrc, probeMeta, 'count')) part.ids.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + part.counts[i]));
  const dead = probeMeta.filter(b => !counts.get(b.id)).map(b => b.id);
  if (dead.some(id => !known.has(id))) throw new Error(`badges obtenus par aucun nombre : ${dead.join(', ')}`);
  const meta = probeMeta.filter(b => counts.get(b.id)) // un badge d'origine devenu impossible (aucun ici) serait retiré
    .map(b => ({ ...b, score: Math.round((100 * SPAN) / counts.get(b.id)),
      desc: b.id === 'COLOSSAL' ? 'A number greater than 9,990,000.' : b.desc }))
    .sort((a, b) => b.score - a.score);

  // 2. Total de chaque nombre avec ces scores.
  const totals = new Float64Array(SPAN);
  let offset = 0;
  for (const part of await runWorkers(engineSrc, meta, 'total')) { totals.set(part.totals, offset); offset += part.totals.length; }

  const sorted = Float64Array.from(totals).sort();
  const table = [];
  let lastPct = -1;
  for (let i = 0; i < SPAN; i++) {
    if (i > 0 && sorted[i] === sorted[i - 1]) continue;
    const pct = (100 * i) / SPAN;
    // Plus fin dans la queue : Infinity se joue au 1/1000e de pourcent près.
    const step = pct >= 99.9 ? 0.00001 : pct >= 99 ? 0.0001 : 0.01;
    if (table.length === 0 || pct - lastPct >= step) {
      table.push([sorted[i], Math.round(pct * 100000) / 100000]);
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
  const badgeOdds = Object.fromEntries(meta.map(b => [b.id, counts.get(b.id) / SPAN]));

  const digitCounts = new Array(10).fill(0);
  let digitTotal = 0;
  for (let n = 0; n < SPAN; n++) {
    const s = String(n);
    for (let i = 0; i < s.length; i++) digitCounts[s.charCodeAt(i) - 48]++;
    digitTotal += s.length;
  }
  const stats = { mean: totals.reduce((a, b) => a + b, 0) / SPAN, median: sorted[Math.floor(SPAN / 2)], meanPct: pctSum / SPAN };
  const out = {
    extra: meta.filter(b => !known.has(b.id)).map(b => ({ id: b.id, score: b.score })), tierOdds, badgeCount: meta.length,
    badgeMetaJS: `window.BADGE_META = ${JSON.stringify(meta)};\nwindow.BADGE_ODDS = ${JSON.stringify(badgeOdds)};\n`,
    percentilesJS: `window.SCORE_PERCENTILES = ${JSON.stringify(table)};\nwindow.TIER_ODDS = ${JSON.stringify(tierOdds)};\n` +
      `window.SCORE_STATS = ${JSON.stringify(stats)};\nwindow.DIGIT_ODDS = ${JSON.stringify(digitCounts.map(x => x / digitTotal))};\n`,
  };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}
