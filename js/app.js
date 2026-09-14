/* RNG∞ — interface : tirage animé, historique, stats, collection, réglages. */
(function () {
  'use strict';

  const Engine = RNGEngine.createEngine(window.BADGE_META, window.SCORE_PERCENTILES);
  const TIERS_DESC = ['mythic', 'anomaly', 'epic', 'rare', 'uncommon', 'common', 'trash'];
  const TIER_RANK = { trash: 0, common: 1, uncommon: 2, rare: 3, epic: 4, anomaly: 5, mythic: 6 };
  const TIER_EMOJI = { trash: '🟫', common: '⬜', uncommon: '🟩', rare: '🟦', epic: '🟪', anomaly: '🟧', mythic: '🟥' };
  // Rythme de révélation du site d'origine (ms). Chaque vitesse applique un facteur à toutes ces durées.
  const REVEAL = {
    digitStart: 2000, digitBase: 1000, digitMax: 2000,
    badgeStart: 1000, badgeBase: 500, badgeMax: 1500, badgeEp: 500,
    summary: 1500, rarity: 1000, stats: 250, lifetimeShow: 1000, lifetimePause: 1500, lifetimeTick: 1500, end: 500,
  };
  const SPEEDS = { dramatic: 1, normal: 0.6, fast: 0.25, instant: 0 };
  const SPEED_LABELS = { dramatic: 'original', normal: 'normal', fast: 'fast', instant: 'instant' };
  // Chaque chiffre suivant se fait attendre un peu plus ; idem pour les badges, jusqu'au plus rare.
  const digitDelay = (i, count) => REVEAL.digitBase + (REVEAL.digitMax - REVEAL.digitBase) * Math.pow(i / (count - 1), 2);
  const badgeDelay = (i, count) => (count <= 1 ? REVEAL.badgeBase
    : REVEAL.badgeBase + (REVEAL.badgeMax - REVEAL.badgeBase) * Math.pow(i / (count - 1), 1.5));
  const GROUP_COLORS = [['#93c5fd', '#2563eb'], ['#c4b5fd', '#7c3aed'], ['#fdba74', '#ea580c'], ['#f9a8d4', '#db2777'], ['#fcd34d', '#b45309'], ['#86efac', '#15803d']];
  const LABELS = new Map(Engine.badges.map(b => [b.id, b.label.toLowerCase()]));

  const app = document.getElementById('app');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let currentView = 'home';
  let session = null;

  // ---------------------------------------------------------------- utilitaires
  const $ = (sel, el = document) => el.querySelector(sel);
  const fmt = v => Math.round(v).toLocaleString('en-US');
  const compact = v => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const plural = (k, word) => `${fmt(k)} ${word}${k === 1 ? '' : 's'}`;
  const pctStr = p => {
    const v = p * 100;
    if (v === 0) return '0%';
    if (v < 0.01) return v.toFixed(4).replace(/0+$/, '') + '%';
    if (v < 1) return v.toFixed(2) + '%';
    return v.toFixed(1) + '%';
  };
  const oneIn = p => (p > 0 ? '1 in ' + fmt(1 / p) : '—');
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sup = k => String(k).split('').map(ch => SUP[ch]).join('');
  const tierPill = tier => `<span class="pill" data-tier="${tier}">${tier}</span>`;

  function relTime(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 172800) return 'yesterday';
    if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const fullDate = t => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // Analyses mises en cache : un nombre donne toujours le même résultat.
  const cache = new Map();
  function analysis(n) {
    let a = cache.get(n);
    if (!a) {
      a = Engine.analyze(n);
      cache.set(n, a);
      if (cache.size > 20000) cache.delete(cache.keys().next().value);
    }
    return a;
  }

  // Index de collection : badges obtenus et nombres déjà tirés.
  const Collection = {
    built: false,
    badges: new Map(),
    seen: new Map(),
    ensure() { if (!this.built) this.rebuild(); return this; },
    rebuild() {
      this.badges.clear();
      this.seen.clear();
      Store.rolls.forEach((r, i) => this.add(r, i));
      this.built = true;
    },
    add(r, i) {
      for (const id of analysis(r[0]).earnedIds) {
        let e = this.badges.get(id);
        if (!e) this.badges.set(id, (e = { count: 0, first: i, last: i }));
        e.count++;
        e.last = i;
      }
      const list = this.seen.get(r[0]);
      if (list) list.push(i); else this.seen.set(r[0], [i]);
    },
  };

  const lifetimeEP = () => Store.rolls.reduce((acc, r) => acc + r[1], 0);

  function bestRollIndex() {
    let best = -1;
    Store.rolls.forEach((r, i) => { if (best < 0 || r[1] > Store.rolls[best][1]) best = i; });
    return best;
  }

  function topRollIndices(k) {
    return Store.rolls.map((r, i) => i).sort((a, b) => Store.rolls[b][1] - Store.rolls[a][1] || a - b).slice(0, k);
  }

  // ---------------------------------------------------------------- badges : rendu
  function digitTiles(n, id) {
    const s = String(n);
    const groups = Engine.highlight(id, n);
    const owner = new Map();
    groups.forEach((g, gi) => g.forEach(i => { if (!owner.has(i)) owner.set(i, gi); }));
    const multi = groups.length > 1;
    return s.split('').map((ch, i) => {
      if (!owner.has(i)) return `<span class="dt">${ch}</span>`;
      if (!multi) return `<span class="dt on">${ch}</span>`;
      const [bg, bd] = GROUP_COLORS[owner.get(i) % GROUP_COLORS.length];
      return `<span class="dt on" style="background:${bg};border-color:${bd}">${ch}</span>`;
    }).join('');
  }

  const POWER_K = { SQUARE: 2, CUBE: 3, FOURTH_POWER: 4, FIFTH_POWER: 5, SIXTH_POWER: 6, SEVENTH_POWER: 7, EIGHTH_POWER: 8, NINTH_POWER: 9, TENTH_POWER: 10, ELEVENTH_POWER: 11, THIRTEENTH_POWER: 13, SEVENTEENTH_POWER: 17, NINETEENTH_POWER: 19 };
  const BASES = { POWER_OF_TWO: 2, POWER_OF_THREE: 3, POWER_OF_FIVE: 5, POWER_OF_SEVEN: 7 };
  const DIVS = { DOZEN: 12, LUCKY_SEVEN_DIV: 7, ELEVEN: 11 };

  // Petite ligne d'explication sous certains badges ("7 × 9 = 63", "2¹⁰"...).
  function badgeDetail(id, n) {
    const s = String(n);
    const digits = s.split('').map(Number);
    const sum = digits.reduce((a, b) => a + b, 0);
    const parts = () => Engine.highlight(id, n).map(g => Number(g.map(i => s[i]).join('')));
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

  function badgeCardHTML(group, n, opts) {
    const b = group.badge;
    const detail = badgeDetail(b.id, n);
    const isNew = opts.newIds && opts.newIds.has(b.id);
    const anim = opts.animate ? ' reveal' : '';
    const delay = opts.animate ? ` style="animation-delay:${opts.delay}ms"` : '';
    const subs = group.subsidiary.map(sb => `
      <div class="sub-badge${opts.animate ? ' fade-in' : ''}"${delay}>
        <span>└</span><span>${sb.emoji}</span>
        <span class="name" data-badge="${sb.id}" style="cursor:pointer">${esc(sb.label)}</span>
        ${opts.newIds && opts.newIds.has(sb.id) ? '<span class="new-tag">NEW</span>' : ''}
        <span class="earned">(earned)</span>
      </div>`).join('');
    return `<div class="badge-group">
      <div class="badge-card${anim}" data-tier="${b.tier}"${delay}>
        <div class="badge-head">
          <div class="badge-title">
            <span class="emoji">${b.emoji}</span>
            <span class="name" data-badge="${b.id}" style="cursor:pointer">${esc(b.label)}</span>
            ${tierPill(b.tier)}
            ${isNew ? '<span class="new-tag">NEW</span>' : ''}
          </div>
          <span class="ep-pill">+${fmt(b.score)} EP</span>
        </div>
        <div class="badge-desc">${esc(b.desc)}</div>
        ${detail ? `<div class="badge-extra">${esc(detail)}</div>` : ''}
        <div class="digits">${digitTiles(n, b.id)}</div>
      </div>${subs}</div>`;
  }

  function breakdownHTML(n, a, opts = {}) {
    const count = a.earnedIds.length;
    const stagger = opts.stagger || 0;
    return `
      <section class="breakdown">
        <h2 class="section-title">Badge breakdown</h2>
        <div class="section-sub">${plural(count, 'badge')} earned</div>
        <div class="list">${a.groups.map((g, i) => badgeCardHTML(g, n, { newIds: opts.newIds, animate: opts.animate, delay: i * stagger })).join('')}</div>
      </section>`;
  }

  function shareText(a) {
    const top = Engine.topLabel(a.percentile);
    const lines = [`RNG∞ 🎲 ${a.str}`, '', `${TIER_EMOJI[a.tier]} ${a.tier.toUpperCase()}${top ? ' • ' + cap(top.toLowerCase()) : ''}`, ''];
    a.groups.slice(0, 3).forEach(g => lines.push(`${TIER_EMOJI[g.badge.tier]} ${g.badge.emoji} ${g.badge.label}`));
    if (a.groups.length > 3) lines.push(`+${a.groups.length - 3} more`);
    lines.push('', `${fmt(a.total)} EP`, location.origin + location.pathname);
    return lines.join('\n');
  }

  async function share(a) {
    const text = shareText(a);
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share) {
      try { await navigator.share({ text }); } catch (e) { /* annulé */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch (e) {
      openModal(`<h2>Share</h2><textarea class="input" style="width:100%;height:12rem;padding:.6rem;font-family:var(--font-mono)" readonly>${esc(text)}</textarea>`);
    }
  }

  // ---------------------------------------------------------------- effets
  const FX = (() => {
    const canvas = $('#fx');
    const ctx = canvas.getContext('2d');
    let parts = [];
    let raf = 0;
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    addEventListener('resize', resize);
    resize();
    const CONF = {
      epic: { count: 60, speed: 7, colors: ['#a855f7', '#d8b4fe', '#7c3aed', '#f0abfc'] },
      anomaly: { count: 120, speed: 9, colors: ['#f97316', '#fdba74', '#fbbf24', '#ea580c'] },
      mythic: { count: 240, speed: 12, colors: ['#ec4899', '#a855f7', '#22d3ee', '#f43f5e', '#fde047'] },
    };
    function tick() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(p => p.life < p.max);
      for (const p of parts) {
        p.life++;
        p.vy += 0.22;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      raf = parts.length ? requestAnimationFrame(tick) : 0;
    }
    function celebrate(tier, el) {
      const c = CONF[tier];
      if (!c || reducedMotion || !el) return;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      for (let i = 0; i < c.count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = c.speed * (0.35 + Math.random());
        parts.push({
          x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - c.speed * 0.35,
          w: 4 + Math.random() * 5, h: 6 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
          color: c.colors[i % c.colors.length], life: 0, max: 70 + Math.random() * 60,
        });
      }
      if (tier === 'mythic') {
        const f = document.createElement('div');
        f.className = 'flash';
        f.style.background = 'radial-gradient(circle at 50% 30%, rgba(236,72,153,.5), rgba(168,85,247,.3) 40%, rgba(34,211,238,.12) 70%, transparent)';
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 1000);
      }
      if (parts.length > 600) parts.splice(0, parts.length - 600);
      if (!raf) raf = requestAnimationFrame(tick);
    }
    function clear() {
      parts = [];
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
    return { celebrate, clear };
  })();

  // Un nouveau countUp sur le même élément annule le précédent.
  function countUp(el, from, to, duration, format) {
    const token = (el._countToken = (el._countToken || 0) + 1);
    if (!duration || reducedMotion) { el.textContent = format(to); return; }
    const t0 = performance.now();
    const step = now => {
      if (!el.isConnected || el._countToken !== token) return;
      const k = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = format(from + (to - from) * eased);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- tooltip
  const tip = $('#tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - w - 8)) + 'px';
    tip.style.top = (y + 16 + h > innerHeight - 8 ? y - h - 12 : y + 16) + 'px';
  }
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) showTip(el.dataset.tip, e.clientX, e.clientY); else if (!tip.hidden) tip.hidden = true;
  });
  document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  // ---------------------------------------------------------------- modale
  function closeModal() {
    const root = $('#modal-root');
    if (!root.firstChild) return;
    root.innerHTML = '';
    document.body.style.overflow = '';
  }
  function openModal(html, onMount) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><button class="modal-close" aria-label="Close">×</button>${html}</div></div>`;
    const backdrop = root.firstChild;
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop || e.target.closest('.modal-close')) closeModal();
    });
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(backdrop.querySelector('.modal'));
  }

  function openRollModal(index) {
    const r = Store.rolls[index];
    if (!r) return;
    Collection.ensure();
    const a = analysis(r[0]);
    const occ = Collection.seen.get(r[0]) || [];
    const top = Engine.topLabel(a.percentile);
    openModal(`
      <div class="result" data-tier="${a.tier}" style="padding-top:.2rem">
        <div class="eyebrow">Roll #${fmt(index + 1)} · ${fullDate(r[2])}</div>
        <div style="margin-top:.9rem"><span class="num-card lg" data-tier="${a.tier}">${a.str}</span></div>
        <div class="result-meta">${tierPill(a.tier)}${top ? `<span class="dot">•</span><span class="top">${top}</span>` : ''}</div>
        <div class="ep-big">${fmt(a.total)} EP</div>
        ${occ.length > 1 ? `<p class="repeat-note">Rolled ${occ.length}× in your history: ${occ.map(i => `<a href="javascript:void 0" data-roll="${i}">#${fmt(i + 1)}</a>`).join(', ')}</p>` : ''}
        <div class="result-actions"><button class="btn" data-share>${shareIcon()} Share</button></div>
        ${breakdownHTML(r[0], a)}
      </div>`, m => m.querySelector('[data-share]').addEventListener('click', () => share(a)));
  }

  function openBadgeModal(id) {
    const b = Engine.byId.get(id);
    if (!b) return;
    Collection.ensure();
    const e = Collection.badges.get(id);
    const odds = window.BADGE_ODDS[id];
    const holders = [];
    if (e) {
      for (let i = Store.rolls.length - 1; i >= 0 && holders.length < 40; i--) {
        if (analysis(Store.rolls[i][0]).earnedIds.includes(id)) holders.push(i);
      }
    }
    const family = b.family ? Engine.badges.filter(x => x.family === b.family).sort((x, y) => y.score - x.score) : [];
    openModal(`
      <div style="text-align:center">
        <div style="font-size:2.6rem;line-height:1.2">${b.emoji}</div>
        <h2 style="margin:.35rem 0 .5rem">${esc(b.label)}</h2>
        <div class="pill-row">${tierPill(b.tier)}<span class="ep-pill">+${fmt(b.score)} EP</span></div>
        <p class="badge-desc" style="font-size:.74rem;margin:.8rem 0 1rem">${esc(b.desc)}</p>
      </div>
      <div class="kv"><span class="k">Odds</span><span class="v">${oneIn(odds)} · ${pctStr(odds)}</span></div>
      <div class="kv"><span class="k">You earned it</span><span class="v">${e ? plural(e.count, 'time') : 'Not yet'}</span></div>
      ${e ? `<div class="kv"><span class="k">First found</span><span class="v"><a href="javascript:void 0" data-roll="${e.first}">${Store.rolls[e.first][0]}</a> · ${relTime(Store.rolls[e.first][2])}</span></div>` : ''}
      ${family.length > 1 ? `
        <div class="kv"><span class="k">Family</span><span class="v" style="font-family:var(--font-sans);font-weight:500;text-align:right;line-height:1.7">
          ${family.map(f => `<span class="badge-pill" data-tier="${f.tier}" data-badge="${f.id}" style="cursor:pointer;${f.id === id ? 'font-weight:700' : ''}">${f.emoji} ${esc(f.label)}</span>`).join(' ')}
        </span></div>
        <p class="panel-note" style="margin:.2rem 0 0">Only the highest-scoring badge of a family counts toward EP; the others show as “earned”.</p>` : ''}
      ${holders.length ? `<div class="eyebrow" style="margin:1.1rem 0 .6rem">Your rolls with this badge${e.count > holders.length ? ` (latest ${holders.length})` : ''}</div>
        <div class="pill-row" style="justify-content:flex-start">${holders.map(i => `<button class="num-card sm" data-tier="${Engine.cardTier(Store.rolls[i][1])}" data-roll="${i}">${Store.rolls[i][0]}</button>`).join('')}</div>` : ''}
    `);
  }

  function openSettings() {
    const s = Store.settings;
    const seg = (name, options, value, labels = {}) => `<div class="seg" data-seg="${name}">${options.map(o => `<button data-v="${o}" class="${o === value ? 'on' : ''}">${labels[o] || o}</button>`).join('')}</div>`;
    openModal(`
      <h2>Player & settings</h2>
      <div class="field">
        <label for="set-name">Player name</label>
        <input class="input" id="set-name" maxlength="20" autocomplete="off" value="${esc(Store.player.name)}" placeholder="Player">
        <span class="panel-note">Used on the leaderboard once it goes online.</span>
      </div>
      <div class="field"><label>Roll animation</label>${seg('speed', ['dramatic', 'normal', 'fast', 'instant'], s.speed, SPEED_LABELS)}</div>
      <div class="field"><label>Theme</label>${seg('theme', ['light', 'system', 'dark'], s.theme)}</div>
      <div class="danger-zone">
        <button class="btn" id="set-export">Export history</button>
        <button class="btn" id="set-import">Import</button>
        <button class="btn danger" id="set-clear">Clear history</button>
        <input type="file" id="set-file" accept="application/json,.json" hidden>
      </div>
      <div class="actions"><button class="btn" id="set-done">Done</button></div>
    `, m => {
      const name = m.querySelector('#set-name');
      name.addEventListener('input', () => { Store.setPlayerName(name.value); });
      m.querySelectorAll('[data-seg]').forEach(group => {
        group.addEventListener('click', e => {
          const btn = e.target.closest('button');
          if (!btn) return;
          group.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
          Store.setSetting(group.dataset.seg, btn.dataset.v);
          if (group.dataset.seg === 'theme') applyTheme();
        });
      });
      m.querySelector('#set-done').addEventListener('click', closeModal);
      m.querySelector('#set-export').addEventListener('click', exportHistory);
      const file = m.querySelector('#set-file');
      m.querySelector('#set-import').addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        try {
          const added = Store.importJSON(await f.text(), n => analysis(n).total);
          Collection.built = false;
          toast(`Imported ${plural(added, 'roll')}`);
          closeModal();
          route();
        } catch (err) {
          toast('That file is not a valid RNG∞ export.');
        }
      });
      m.querySelector('#set-clear').addEventListener('click', () => {
        const k = Store.rolls.length;
        if (!k) { toast('History is already empty.'); return; }
        if (!confirm(`Delete all ${fmt(k)} rolls from this device? Export first if you want to keep them.`)) return;
        Store.clearRolls();
        Collection.built = false;
        closeModal();
        toast('History cleared');
        route();
      });
    });
  }

  function exportHistory() {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rng-infinite-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const shareIcon = () => '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>';

  // ---------------------------------------------------------------- accueil
  function renderHome() {
    currentView = 'home';
    const rolls = Store.rolls;
    const best = bestRollIndex();
    const name = Store.player.name;
    const recent = rolls.slice(-12).map((r, k) => ({ r, i: rolls.length - Math.min(12, rolls.length) + k })).reverse();
    app.innerHTML = `
      <div class="page">
        <section class="hero">
          <div class="qmarks" aria-hidden="true">${'??????'.split('').map(c => `<span>${c}</span>`).join('')}</div>
          <p class="tagline">Infinite rolls. One number at a time. What will yours be?</p>
          <button class="btn-roll" id="roll-btn">Generate</button>
          <p class="hint">
            ${rolls.length ? `${plural(rolls.length, 'roll')} · ${fmt(lifetimeEP())} lifetime EP · ` : ''}
            ${name ? `playing as <b>${esc(name)}</b> · ` : '<a href="javascript:void 0" id="pick-name">pick a name</a> · '}
            press <kbd>Space</kbd>
          </p>
          ${best >= 0 ? featureCardHTML(best) : ''}
          ${recent.length > 1 ? `
            <div class="recent-strip">
              <div class="eyebrow">Recent rolls</div>
              <div class="chips">${recent.map(({ r, i }) => `<button class="num-card sm" data-tier="${Engine.cardTier(r[1])}" data-roll="${i}">${r[0]}</button>`).join('')}</div>
            </div>` : ''}
        </section>
      </div>`;
    $('#roll-btn').addEventListener('click', startRoll);
    const pick = $('#pick-name');
    if (pick) pick.addEventListener('click', openSettings);
  }

  function featureCardHTML(i) {
    const r = Store.rolls[i];
    const a = analysis(r[0]);
    const pills = a.groups.slice(0, 7).map(g => `<span class="badge-pill" data-tier="${g.badge.tier}">${g.badge.emoji} ${esc(g.badge.label)}</span>`).join('');
    const more = a.earnedIds.length - Math.min(7, a.groups.length);
    return `
      <div class="feature-card" data-tier="${a.tier}" data-roll="${i}" style="cursor:pointer">
        <div class="eyebrow">Your best roll</div>
        <span class="num-card md" data-tier="${a.tier}">${a.str}</span>
        <div class="feature-meta">roll #${fmt(i + 1)} · ${relTime(r[2])}</div>
        <div class="pill-row">${pills}${more > 0 ? `<span class="more">+${more} more</span>` : ''}</div>
        <div class="ep-big" style="display:inline-block;font-size:.85rem">${fmt(a.total)} EP</div>
      </div>`;
  }

  // ---------------------------------------------------------------- tirage
  // Pendant la révélation, Espace saute l'animation ; une fois la rareté affichée, il relance.
  function startRoll(force) {
    if (session && !session.finished) {
      if (force !== true && !session.canReroll) { session.skip(); return; }
      session.cancel();
    }
    closeModal();
    Collection.ensure();
    const n = Engine.roll();
    const a = analysis(n);
    const previous = (Collection.seen.get(n) || []).slice();
    const newIds = new Set(a.earnedIds.filter(id => !Collection.badges.has(id)));
    const isFirst = Store.rolls.length === 0;
    const lifetimeBefore = lifetimeEP();
    // Le tirage est enregistré avant l'animation : quitter la page ne permet pas de relancer.
    const { saved } = Store.addRoll(n, a.total);
    const index = Store.rolls.length - 1;
    Collection.add(Store.rolls[index], index);
    if (!saved) toast('Could not save — storage is full. Export your history from the player menu.');
    session = playReveal({ n, a, previous, newIds: isFirst ? null : newIds, isFirst, lifetimeBefore, index });
  }

  function notesHTML(ctx, a) {
    const notes = [];
    if (ctx.isFirst) notes.push('<p class="new-note">First roll on this device — welcome!</p>');
    if (ctx.newIds && ctx.newIds.size) {
      const list = [...ctx.newIds].map(id => Engine.byId.get(id)).sort((x, y) => y.score - x.score);
      notes.push(`<p class="new-note">✨ ${plural(list.length, 'new badge')}: ${list.slice(0, 4).map(b => `${b.emoji} ${esc(b.label)}`).join(', ')}${list.length > 4 ? '…' : ''}</p>`);
    }
    if (ctx.previous.length) {
      const lastIdx = ctx.previous[ctx.previous.length - 1];
      notes.push(`<p class="repeat-note">You've rolled <b class="mono">${a.str}</b> before — ${ctx.previous.length}× (last ${relTime(Store.rolls[lastIdx][2])}, <a href="javascript:void 0" data-roll="${lastIdx}">#${fmt(lastIdx + 1)}</a>)</p>`);
    }
    return notes.join('');
  }

  // Révélation en étapes chronométrées, comme l'original :
  // chiffres → badges un par un (EP qui monte) → compteur de badges → rareté → TOP x % → EP à vie.
  // Chaque étape est idempotente : "skip" exécute d'un coup celles qui restent, sans animation.
  function playReveal(ctx) {
    currentView = 'result';
    const { n, a } = ctx;
    const k = SPEEDS[Store.settings.speed] ?? SPEEDS.normal;
    const slotCount = Math.max(6, a.str.length);
    const padded = a.str.padStart(slotCount, '0');
    const lead = slotCount - a.str.length;
    const top = Engine.topLabel(a.percentile);
    const ascending = a.groups.slice().reverse();

    app.innerHTML = `
      <div class="vignette" id="r-vignette"></div>
      <div class="page">
        <section class="result" data-tier="${a.tier}">
          <div class="num-card lg neutral charging" id="num-card" title="Click to skip">
            ${Array.from({ length: slotCount }, () => '<span class="slot spinning">0</span>').join('')}
          </div>
          <div class="result-meta invisible" id="r-meta">${tierPill(a.tier)}${top ? `<span class="dot">•</span><span class="top">${top}</span>` : ''}</div>
          <div class="ep-big pending" id="r-ep">??? EP</div>
          <div class="lifetime invisible" id="r-life">
            <div class="lifetime-row"><span class="v" id="r-life-v">${fmt(ctx.lifetimeBefore)}</span><span class="delta" id="r-life-delta" hidden>+${fmt(a.total)}</span></div>
            <div class="l">Your lifetime EP</div>
          </div>
          <div class="result-actions invisible" id="r-actions">
            <button class="btn" id="r-share">${shareIcon()} Share</button>
            <button class="btn-roll small" id="r-again">Roll again</button>
          </div>
          <p class="hint" id="r-hint">click the number or press <kbd>Space</kbd> to skip</p>
          <div id="r-notes" style="text-align:center"></div>
          <section class="breakdown" id="r-breakdown" hidden>
            <h2 class="section-title">Badge breakdown</h2>
            <div class="section-sub invisible" id="r-count">${plural(a.earnedIds.length, 'badge')} earned</div>
            <div class="list" id="r-list"></div>
          </section>
        </section>
      </div>`;

    const card = $('#num-card');
    const slots = Array.from(card.querySelectorAll('.slot'));
    const ep = $('#r-ep');
    const vignette = $('#r-vignette');
    const steps = [];
    const timers = [];
    let clock = 0, revealed = 0, running = 0, finished = false, canReroll = false;
    const step = (delay, run) => { clock += delay * k; steps.push({ at: clock, run, done: false }); };
    const show = (el, cls) => { el.classList.remove('invisible'); if (cls && !reducedMotion) el.classList.add(cls); };

    const spin = setInterval(() => {
      for (let i = revealed; i < slotCount; i++) slots[i].textContent = String((Math.random() * 10) | 0);
    }, 55);
    requestAnimationFrame(() => vignette.classList.add('on'));

    // 1. Chiffres de gauche à droite, chacun un peu plus lent que le précédent.
    const revealDigit = i => () => {
      const el = slots[i];
      el.textContent = padded[i];
      el.classList.remove('spinning');
      el.classList.add('revealed');
      if (i < lead) el.classList.add('ghost');
      revealed = i + 1;
    };
    step(REVEAL.digitStart, revealDigit(0));
    for (let i = 1; i < slotCount; i++) step(digitDelay(i - 1, slotCount), revealDigit(i));
    step(0, quick => {
      clearInterval(spin);
      card.classList.remove('charging');
      if (!lead) return;
      const collapse = () => slots.slice(0, lead).forEach(el => el.classList.add('collapsed'));
      if (quick) collapse(); else setTimeout(collapse, 260);
    });

    // 2. Badges un par un, du moins rare au plus rare : chacun s'insère en haut et fait monter l'EP.
    ascending.forEach((g, i) => {
      step(i === 0 ? REVEAL.badgeStart : badgeDelay(i - 1, ascending.length), quick => {
        $('#r-breakdown').hidden = false;
        $('#r-list').insertAdjacentHTML('afterbegin', badgeCardHTML(g, n, { newIds: ctx.newIds, animate: !quick && !reducedMotion, delay: 0 }));
        const from = running;
        running += g.badge.score;
        countUp(ep, from, running, quick ? 0 : REVEAL.badgeEp * k, v => `${fmt(v)} EP`);
      });
    });

    // 3. Résumé, rareté, TOP x %, EP à vie.
    step(REVEAL.summary, () => {
      show($('#r-count'), 'fade-in');
      $('#r-notes').innerHTML = notesHTML(ctx, a);
    });
    step(REVEAL.rarity, () => {
      card.classList.remove('neutral');
      card.removeAttribute('title');
      if (!reducedMotion) card.classList.add(a.tier === 'anomaly' || a.tier === 'mythic' ? 'shake' : 'reveal-pulse');
      ep.classList.remove('pending');
      countUp(ep, 0, a.total, 0, v => `${fmt(v)} EP`);
      FX.celebrate(a.tier, card);
      show($('#r-actions'), 'fade-in');
      $('#r-hint').innerHTML = '<kbd>Space</kbd> to roll again · click a badge name for details';
      canReroll = true;
    });
    step(REVEAL.stats, () => show($('#r-meta'), 'pop-in'));
    step(REVEAL.lifetimeShow, () => show($('#r-life'), 'fade-in'));
    step(REVEAL.lifetimePause, quick => {
      const delta = $('#r-life-delta');
      delta.hidden = false;
      if (!quick && !reducedMotion) delta.classList.add('float-up');
      countUp($('#r-life-v'), ctx.lifetimeBefore, ctx.lifetimeBefore + a.total, quick ? 0 : REVEAL.lifetimeTick * k, fmt);
    });
    step(REVEAL.lifetimeTick + REVEAL.end, () => {
      vignette.classList.remove('on');
      finished = true;
    });

    const runStep = (s, quick) => { if (!s.done) { s.done = true; s.run(quick); } };
    function skip() {
      if (finished) return;
      timers.forEach(clearTimeout);
      steps.forEach(s => runStep(s, true));
    }

    card.addEventListener('click', skip);
    $('#r-share').addEventListener('click', () => share(a));
    $('#r-again').addEventListener('click', () => startRoll(true));

    if (k === 0) skip();
    else steps.forEach(s => timers.push(setTimeout(() => runStep(s, false), s.at)));

    return {
      get finished() { return finished; },
      get canReroll() { return canReroll; },
      skip,
      cancel() { timers.forEach(clearTimeout); clearInterval(spin); finished = true; },
    };
  }

  // ---------------------------------------------------------------- historique
  const histState = { q: '', tier: 'all', sort: 'new', limit: 100 };

  function emptyStateHTML() {
    return `<div class="panel empty"><div style="font-size:2rem">🎲</div><p>No rolls yet.</p><a class="btn" href="#/">Go roll</a></div>`;
  }

  function renderHistory() {
    currentView = 'history';
    const total = Store.rolls.length;
    if (!total) {
      app.innerHTML = `<div class="page"><h1 class="page-title">Roll history</h1>${emptyStateHTML()}</div>`;
      return;
    }
    Collection.ensure();
    const tierOptions = [['all', 'All rarities'], ['rare+', 'Rare or better'], ...TIERS_DESC.map(t => [t, cap(t)])];
    const sortOptions = [['new', 'Newest first'], ['old', 'Oldest first'], ['high', 'Highest EP'], ['low', 'Lowest EP']];
    const options = (list, value) => list.map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('');
    app.innerHTML = `
      <div class="page">
        <h1 class="page-title">Roll history</h1>
        <div class="toolbar">
          <input class="input grow" id="h-q" type="search" placeholder="Search a number or a badge…" value="${esc(histState.q)}">
          <select class="select" id="h-tier" aria-label="Rarity">${options(tierOptions, histState.tier)}</select>
          <select class="select" id="h-sort" aria-label="Sort">${options(sortOptions, histState.sort)}</select>
        </div>
        <div class="count-line" id="h-count"></div>
        <div class="table-card" id="h-list"></div>
      </div>`;
    const redraw = () => { histState.limit = 100; drawHistoryList(); };
    $('#h-q').addEventListener('input', e => { histState.q = e.target.value; redraw(); });
    $('#h-tier').addEventListener('change', e => { histState.tier = e.target.value; redraw(); });
    $('#h-sort').addEventListener('change', e => { histState.sort = e.target.value; redraw(); });
    drawHistoryList();
  }

  function filteredRolls() {
    let items = Store.rolls.map((r, i) => ({ n: r[0], s: r[1], t: r[2], i, tier: Engine.cardTier(r[1]) }));
    if (histState.tier === 'rare+') items = items.filter(x => TIER_RANK[x.tier] >= 3);
    else if (histState.tier !== 'all') items = items.filter(x => x.tier === histState.tier);
    const q = histState.q.trim().toLowerCase();
    if (q) {
      const digits = q.replace(/[\s,]/g, '');
      if (/^\d+$/.test(digits)) items = items.filter(x => String(x.n).includes(digits));
      else items = items.filter(x => analysis(x.n).earnedIds.some(id => LABELS.get(id).includes(q)));
    }
    const sorters = {
      new: (a, b) => b.i - a.i,
      old: (a, b) => a.i - b.i,
      high: (a, b) => b.s - a.s || b.i - a.i,
      low: (a, b) => a.s - b.s || b.i - a.i,
    };
    return items.sort(sorters[histState.sort]);
  }

  function drawHistoryList() {
    const rows = filteredRolls();
    const shown = rows.slice(0, histState.limit);
    $('#h-count').textContent = `${fmt(rows.length)} of ${plural(Store.rolls.length, 'roll')}`;
    $('#h-list').innerHTML = shown.length
      ? shown.map(rowHTML).join('') + (rows.length > shown.length
        ? `<div class="load-more"><button class="btn" id="h-more">Load more (${fmt(rows.length - shown.length)} left)</button></div>` : '')
      : '<div class="empty">No roll matches.</div>';
    const more = $('#h-more');
    if (more) more.addEventListener('click', () => { histState.limit += 100; drawHistoryList(); });
  }

  function rowHTML(x) {
    const a = analysis(x.n);
    const reps = (Collection.seen.get(x.n) || []).length;
    return `
      <div class="row" data-roll="${x.i}">
        <span class="idx">#${fmt(x.i + 1)}</span>
        <span><span class="num-card sm" data-tier="${x.tier}">${a.str}</span></span>
        <span class="mid">${tierPill(x.tier)}<span class="emojis">${a.groups.slice(0, 4).map(g => g.badge.emoji).join(' ')}</span>${reps > 1 ? `<span class="muted" style="font-size:.66rem" title="Rolled ${reps} times">×${reps}</span>` : ''}</span>
        <span class="right"><span class="ep-pill">${fmt(x.s)} EP</span><span class="when" title="${fullDate(x.t)}">${relTime(x.t)}</span></span>
      </div>`;
  }

  // ---------------------------------------------------------------- stats
  function computeStats() {
    const rolls = Store.rolls;
    const N = rolls.length;
    const scores = rolls.map(r => r[1]);
    const sorted = scores.slice().sort((a, b) => a - b);
    const tierCounts = Object.fromEntries(TIERS_DESC.map(t => [t, 0]));
    const digitCounts = new Array(10).fill(0);
    const buckets = new Array(10).fill(0);
    let pctSum = 0, digitTotal = 0;
    let sinceRare = null, sinceEpic = null, sinceMythic = null, dry = 0, longestDry = 0;
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    let today = 0;
    rolls.forEach((r, i) => {
      const tier = Engine.cardTier(r[1]);
      tierCounts[tier]++;
      pctSum += Engine.percentileOf(r[1]);
      const s = String(r[0]);
      for (let k = 0; k < s.length; k++) digitCounts[s.charCodeAt(k) - 48]++;
      digitTotal += s.length;
      buckets[Math.min(9, Math.floor(r[0] / 100000))]++;
      if (TIER_RANK[tier] >= 3) { sinceRare = i; dry = 0; } else { dry++; longestDry = Math.max(longestDry, dry); }
      if (TIER_RANK[tier] >= 4) sinceEpic = i;
      if (tier === 'mythic') sinceMythic = i;
      if (r[2] >= startOfDay) today++;
    });
    const since = i => (i === null ? 'never' : fmt(N - 1 - i));
    let rarest = null;
    for (const id of Collection.badges.keys()) {
      if (!rarest || window.BADGE_ODDS[id] < window.BADGE_ODDS[rarest]) rarest = id;
    }
    let repeats = 0;
    for (const list of Collection.seen.values()) if (list.length > 1) repeats++;
    return {
      N, today, tierCounts, digitCounts, digitTotal, buckets, rarest, repeats, longestDry,
      lifetime: scores.reduce((a, b) => a + b, 0),
      median: sorted[Math.floor((N - 1) / 2)],
      luck: pctSum / N,
      sinceRare: since(sinceRare), sinceEpic: since(sinceEpic), sinceMythic: since(sinceMythic),
      top: topRollIndices(10),
      first: rolls[0][2],
    };
  }

  function roundedTop(x, yTop, w, h, r) {
    if (h <= 0.5) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${yTop + h}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yTop + h}Z`;
  }

  // Barres verticales mono-teinte + trait pointillé "attendu".
  function barChartSVG({ labels, values, expected, tickFormat, tips }) {
    const W = 360, H = 190, m = { l: 40, r: 6, t: 12, b: 24 };
    const plotW = W - m.l - m.r, plotH = H - m.t - m.b, base = m.t + plotH;
    const max = Math.max(...values, ...expected) * 1.15 || 1;
    const band = plotW / values.length, gap = Math.max(3, band * 0.3), bw = band - gap;
    const y = v => base - (v / max) * plotH;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    for (let k = 0; k <= 3; k++) {
      const v = (max / 1.15) * (k / 3);
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--chart-grid)" stroke-width="1"/>`;
      svg += `<text x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${tickFormat(v)}</text>`;
    }
    values.forEach((v, i) => {
      const x0 = m.l + i * band;
      svg += `<rect class="hit" x="${x0}" y="${m.t}" width="${band}" height="${plotH + m.b}" data-tip="${esc(tips[i])}"/>`;
    });
    values.forEach((v, i) => {
      const x0 = m.l + i * band + gap / 2;
      svg += `<path class="mark" d="${roundedTop(x0, y(v), bw, base - y(v), 4)}" fill="var(--chart-accent)"/>`;
      const ey = y(expected[i]);
      svg += `<line class="mark" x1="${x0 - 2}" x2="${x0 + bw + 2}" y1="${ey}" y2="${ey}" stroke="var(--prose-2)" stroke-width="2" stroke-dasharray="3 2"/>`;
      svg += `<text class="lbl" x="${x0 + bw / 2}" y="${H - 7}" text-anchor="middle">${labels[i]}</text>`;
    });
    return svg + '</svg>';
  }

  // Nuage de points EP par tirage, échelle log.
  function epChartSVG() {
    const rolls = Store.rolls;
    const start = Math.max(0, rolls.length - 300);
    const pts = rolls.slice(start);
    const W = 680, H = 230, m = { l: 46, r: 14, t: 12, b: 24 };
    const plotW = W - m.l - m.r, plotH = H - m.t - m.b;
    const maxScore = Math.max(...pts.map(r => r[1]));
    const lo = 3, hi = Math.max(6, Math.ceil(Math.log10(maxScore)));
    const y = v => m.t + ((hi - Math.log10(Math.max(v, 1000))) / (hi - lo)) * plotH;
    const step = pts.length > 1 ? plotW / (pts.length - 1) : 0;
    const x = i => (pts.length > 1 ? m.l + i * step : m.l + plotW / 2);
    const LABEL = { 3: '1K', 4: '10K', 5: '100K', 6: '1M', 7: '10M', 8: '100M', 9: '1B' };
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    for (let e = lo; e <= hi; e++) {
      svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(10 ** e)}" y2="${y(10 ** e)}" stroke="var(--chart-grid)"/>`;
      svg += `<text x="${m.l - 7}" y="${y(10 ** e) + 3.5}" text-anchor="end">${LABEL[e]}</text>`;
    }
    const med = window.SCORE_STATS.median;
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(med)}" y2="${y(med)}" stroke="var(--prose-3)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    svg += `<text class="halo" x="${W - m.r}" y="${y(med) - 5}" text-anchor="end">typical roll · ${compact(med)} EP</text>`;
    const hitW = pts.length > 1 ? step : plotW;
    pts.forEach((r, i) => {
      const a = analysis(r[0]);
      const tipHtml = `<b>${a.str}</b> · roll #${fmt(start + i + 1)}<br>${fmt(r[1])} EP · ${a.tier.toUpperCase()}`;
      svg += `<rect class="hit" x="${x(i) - hitW / 2}" y="${m.t}" width="${hitW}" height="${plotH}" data-tip="${esc(tipHtml)}" data-roll="${start + i}" style="cursor:pointer"/>`;
    });
    pts.forEach((r, i) => {
      svg += `<circle class="mark" cx="${x(i)}" cy="${y(r[1])}" r="4" fill="var(--chart-accent)" stroke="var(--surface)" stroke-width="2"/>`;
    });
    svg += `<text x="${m.l}" y="${H - 6}">#${fmt(start + 1)}</text><text x="${W - m.r}" y="${H - 6}" text-anchor="end">#${fmt(rolls.length)}</text>`;
    return svg + '</svg>';
  }

  function rarityDistHTML(st) {
    const shares = Object.fromEntries(TIERS_DESC.map(t => [t, st.tierCounts[t] / st.N]));
    const max = Math.max(...TIERS_DESC.map(t => Math.max(shares[t], window.TIER_ODDS[t])));
    return `<div class="dist">${TIERS_DESC.map(t => {
      const exp = window.TIER_ODDS[t];
      const tipHtml = `<b>${t.toUpperCase()}</b><br>${plural(st.tierCounts[t], 'roll')} · ${pctStr(shares[t])}<br>expected ${pctStr(exp)} (≈ ${(exp * st.N).toFixed(1)} rolls)`;
      return `
        <div class="dist-row" data-tip="${esc(tipHtml)}">
          <span>${tierPill(t)}</span>
          <div class="dist-track">
            <div class="dist-fill" style="width:${(shares[t] / max) * 100}%"></div>
            <span class="dist-exp" style="left:${(exp / max) * 100}%"></span>
          </div>
          <span class="dist-val">${fmt(st.tierCounts[t])} · ${pctStr(shares[t])} <small>/ ${pctStr(exp)}</small></span>
        </div>`;
    }).join('')}</div>`;
  }

  function recordsHTML(indices) {
    return `<div class="records">${indices.map((i, k) => {
      const r = Store.rolls[i];
      const a = analysis(r[0]);
      return `
        <div class="record" data-roll="${i}">
          <span class="rank">${k + 1}</span>
          <span class="num-card sm" data-tier="${a.tier}">${a.str}</span>
          <span class="grow">${a.groups.slice(0, 3).map(g => `${g.badge.emoji} ${esc(g.badge.label)}`).join(' · ')}</span>
          <span class="ep-pill">${compact(r[1])}</span>
        </div>`;
    }).join('')}</div>`;
  }

  const legendHTML = (seriesLabel) => `<div class="legend"><span><i style="background:var(--chart-accent)"></i>${seriesLabel}</span><span><i class="line"></i>Expected</span></div>`;
  const tile = (label, value, sub) => `<div class="tile"><div class="l">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`;

  function renderStats() {
    currentView = 'stats';
    const N = Store.rolls.length;
    if (!N) {
      app.innerHTML = `<div class="page"><h1 class="page-title">Stats</h1>${emptyStateHTML()}</div>`;
      return;
    }
    Collection.ensure();
    const st = computeStats();
    const bestI = st.top[0];
    const found = Collection.badges.size, totalBadges = Engine.badges.length;
    const expectedLuck = window.SCORE_STATS.meanPct;

    const digitShares = st.digitCounts.map(c => c / st.digitTotal);
    const digitSVG = barChartSVG({
      labels: digitShares.map((_, d) => String(d)),
      values: digitShares,
      expected: window.DIGIT_ODDS,
      tickFormat: v => (v * 100).toFixed(0) + '%',
      tips: digitShares.map((v, d) => `<b>Digit ${d}</b><br>${pctStr(v)} of your digits (${fmt(st.digitCounts[d])})<br>expected ${pctStr(window.DIGIT_ODDS[d])}`),
    });
    const bucketExp = st.buckets.map((_, k) => (N * (k === 9 ? 100001 : 100000)) / 1000001);
    const bucketSVG = barChartSVG({
      labels: st.buckets.map((_, k) => (k === 0 ? '0' : k + '00K')),
      values: st.buckets,
      expected: bucketExp,
      tickFormat: v => compact(v),
      tips: st.buckets.map((c, k) => `<b>${fmt(k * 100000)} – ${fmt(k === 9 ? 1000000 : (k + 1) * 100000 - 1)}</b><br>${plural(c, 'roll')} · expected ≈ ${bucketExp[k].toFixed(1)}`),
    });

    app.innerHTML = `
      <div class="page page-wide">
        <h1 class="page-title">Stats</h1>
        <div class="tiles">
          ${tile('Rolls', fmt(N), `${fmt(st.today)} today`)}
          ${tile('Lifetime EP', compact(st.lifetime), `${fmt(st.lifetime / N)} EP per roll`)}
          ${tile('Median roll', fmt(st.median) + ' EP', `typical: ${fmt(window.SCORE_STATS.median)} EP`)}
          ${tile('Luck', st.luck.toFixed(1), `avg percentile · expected ${expectedLuck.toFixed(1)}`)}
          ${tile('Best roll', `<span data-roll="${bestI}" style="cursor:pointer">${Store.rolls[bestI][0]}</span>`, `${fmt(Store.rolls[bestI][1])} EP`)}
          ${tile('Badges', `${found}/${totalBadges}`, `${((found / totalBadges) * 100).toFixed(0)}% of the collection`)}
        </div>

        <div class="panel">
          <div class="panel-head"><h3 class="panel-title">Rarity distribution</h3><span class="panel-note">your rolls vs. expected odds</span></div>
          ${rarityDistHTML(st)}
          ${legendHTML('Your rolls')}
        </div>

        <div class="panel">
          <div class="panel-head"><h3 class="panel-title">EP per roll</h3><span class="panel-note">last ${fmt(Math.min(N, 300))} rolls · log scale · click a point</span></div>
          <div class="chart-wrap">${epChartSVG()}</div>
        </div>

        <div class="grid-2 stats-sep">
          <div class="panel">
            <div class="panel-head"><h3 class="panel-title">Digit frequency</h3><span class="panel-note">share of all digits rolled</span></div>
            <div class="chart-wrap">${digitSVG}</div>
            ${legendHTML('Your digits')}
          </div>
          <div class="panel">
            <div class="panel-head"><h3 class="panel-title">Where numbers land</h3><span class="panel-note">rolls per 100,000 range</span></div>
            <div class="chart-wrap">${bucketSVG}</div>
            ${legendHTML('Your rolls')}
          </div>
        </div>

        <div class="grid-2 stats-sep">
          <div class="panel">
            <div class="panel-head"><h3 class="panel-title">Top 10 rolls</h3></div>
            ${recordsHTML(st.top)}
          </div>
          <div class="panel">
            <div class="panel-head"><h3 class="panel-title">Streaks & oddities</h3></div>
            <div class="kv"><span class="k">Rolls since last Rare or better</span><span class="v">${st.sinceRare}</span></div>
            <div class="kv"><span class="k">Rolls since last Epic or better</span><span class="v">${st.sinceEpic}</span></div>
            <div class="kv"><span class="k">Rolls since last Mythic</span><span class="v">${st.sinceMythic}</span></div>
            <div class="kv"><span class="k">Longest run without Rare+</span><span class="v">${fmt(st.longestDry)}</span></div>
            <div class="kv"><span class="k">Numbers rolled more than once</span><span class="v">${fmt(st.repeats)}</span></div>
            ${st.rarest ? `<div class="kv"><span class="k">Rarest badge found</span><span class="v" data-badge="${st.rarest}" style="cursor:pointer">${Engine.byId.get(st.rarest).emoji} ${oneIn(window.BADGE_ODDS[st.rarest])}</span></div>` : ''}
            <div class="kv"><span class="k">First roll</span><span class="v">${new Date(st.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
          </div>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- collection
  const collState = { filter: 'all', q: '' };

  function renderBadges() {
    currentView = 'badges';
    Collection.ensure();
    const found = Collection.badges.size, total = Engine.badges.length;
    app.innerHTML = `
      <div class="page page-wide">
        <h1 class="page-title">Badge collection</h1>
        <div class="panel-head"><span class="mono" style="font-weight:700">${found} / ${total} found</span><span class="panel-note">${((found / total) * 100).toFixed(1)}% complete</span></div>
        <div class="progress"><div style="width:${(found / total) * 100}%"></div></div>
        <div class="toolbar">
          <input class="input grow" id="c-q" type="search" placeholder="Search badges…" value="${esc(collState.q)}">
          <div class="seg" id="c-filter">${['all', 'found', 'missing'].map(f => `<button data-v="${f}" class="${collState.filter === f ? 'on' : ''}">${f}</button>`).join('')}</div>
        </div>
        <div id="c-body"></div>
      </div>`;
    $('#c-q').addEventListener('input', e => { collState.q = e.target.value; drawCollection(); });
    $('#c-filter').addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      collState.filter = btn.dataset.v;
      $('#c-filter').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
      drawCollection();
    });
    drawCollection();
  }

  function drawCollection() {
    const q = collState.q.trim().toLowerCase();
    const blocks = ['mythic', 'anomaly', 'epic', 'rare', 'uncommon', 'common'].map(tier => {
      const all = Engine.badges.filter(b => b.tier === tier);
      const foundInTier = all.filter(b => Collection.badges.has(b.id)).length;
      const list = all
        .filter(b => collState.filter === 'all' || (collState.filter === 'found') === Collection.badges.has(b.id))
        .filter(b => !q || b.label.toLowerCase().includes(q) || b.desc.toLowerCase().includes(q))
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
      if (!list.length) return '';
      return `
        <div class="tier-block">
          <h3>${tierPill(tier)} <span class="muted mono">${foundInTier}/${all.length}</span></h3>
          <div class="badge-grid">${list.map(collTileHTML).join('')}</div>
        </div>`;
    }).join('');
    $('#c-body').innerHTML = blocks || '<div class="empty">No badge matches.</div>';
  }

  function collTileHTML(b) {
    const e = Collection.badges.get(b.id);
    return `
      <button class="coll${e ? '' : ' missing'}"${e ? ` data-tier="${b.tier}"` : ''} data-badge="${b.id}">
        <span class="top"><span class="emoji">${b.emoji}</span><span class="name">${esc(b.label)}</span><span class="ep-pill">${compact(b.score)}</span></span>
        <span class="desc">${esc(b.desc)}</span>
        <span class="foot">${e
          ? `<span class="count">×${fmt(e.count)}</span><span>first: <span class="mono">${Store.rolls[e.first][0]}</span></span>`
          : `<span>${oneIn(window.BADGE_ODDS[b.id])}</span><span class="muted">not found</span>`}</span>
      </button>`;
  }

  // ---------------------------------------------------------------- leaderboard / à propos
  function renderLeaderboard() {
    currentView = 'leaderboard';
    const name = Store.player.name;
    app.innerHTML = `
      <div class="page">
        <h1 class="page-title">Leaderboard</h1>
        <div class="panel soon">
          <div class="big">🏆</div>
          <h2 class="section-title" style="margin-top:.4rem">Online leaderboard — coming soon</h2>
          <p class="muted" style="max-width:31rem;margin:.7rem auto 0;line-height:1.55">
            Rolls are unlimited here, so the board will rank your <b>best single roll</b> (today, this week, all-time).
            Ranking total EP would just reward whoever clicks the most.
          </p>
          <div class="result-actions"><button class="btn" id="lb-name">${name ? `Playing as ${esc(name)} · change` : 'Pick your player name'}</button></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3 class="panel-title">Your personal top 10</h3><span class="panel-note">this device</span></div>
          ${Store.rolls.length ? recordsHTML(topRollIndices(10)) : '<div class="empty" style="padding:1.5rem">No rolls yet.</div>'}
        </div>
      </div>`;
    $('#lb-name').addEventListener('click', openSettings);
  }

  function renderAbout() {
    currentView = 'about';
    const cardRows = [['trash', 'bottom 1%'], ['common', 'bottom 50%'], ['uncommon', 'top 50–25%'], ['rare', 'top 25–10%'], ['epic', 'top 10–5%'], ['anomaly', 'top 5–1%'], ['mythic', 'top 1%']];
    const badgeRows = [['common', 'more than 10% of rolls'], ['uncommon', '1–10% of rolls'], ['rare', '0.1–1% of rolls'], ['epic', '0.01–0.1% of rolls'], ['anomaly', '0.001–0.01% of rolls'], ['mythic', 'under 0.001% (1 in 100,000+)']];
    app.innerHTML = `
      <div class="page prose">
        <h1 class="page-title">What is RNG∞?</h1>
        <p>A random number game with no daily limit. Each roll draws a number from 0 to 1,000,000. The number is checked against ${Engine.badges.length} patterns — palindromes, primes, repeated digits, meme numbers, sequences and more — and every badge it earns is worth EP (entropy points).</p>
        <div class="steps">
          <div class="step"><span class="n">1</span><span><b>Roll</b> — hit Generate (or Space) as often as you like.</span></div>
          <div class="step"><span class="n">2</span><span><b>Discover</b> — see which badges your number earns.</span></div>
          <div class="step"><span class="n">3</span><span><b>Collect</b> — fill the ${Engine.badges.length}-badge collection.</span></div>
          <div class="step"><span class="n">4</span><span><b>Track</b> — every roll is kept in your history and stats.</span></div>
        </div>
        <h2 class="panel-title">Number rarity</h2>
        <p>Your roll's rarity compares its total EP with every possible roll.</p>
        <div class="rarity-table">${cardRows.map(([t, l]) => `${tierPill(t)}<span>${l}</span>`).join('')}</div>
        <h2 class="panel-title">Badge rarity & EP</h2>
        <p>A badge is worth <span class="mono">100 × 1,000,001 ÷ (numbers that earn it)</span> EP, so a badge earned by 1 number in 1,000 is worth about 100,000 EP. Related badges form a family (e.g. Pair → Two Pair → Three Pair); only the best badge of a family counts toward your total.</p>
        <div class="rarity-table">${badgeRows.map(([t, l]) => `${tierPill(t)}<span>${l}</span>`).join('')}</div>
        <h2 class="panel-title">Your data</h2>
        <p>History stays in this browser. Use the player menu to export it (JSON) or move it to another device.</p>
        <p class="muted">Inspired by the daily game rngdle.com — this version removes the daily limit and adds history and stats.</p>
        <p><a class="btn" href="#/">Go roll</a></p>
      </div>`;
  }

  // ---------------------------------------------------------------- navigation, thème, clavier
  const ROUTES = { '': renderHome, history: renderHistory, stats: renderStats, badges: renderBadges, leaderboard: renderLeaderboard, about: renderAbout };

  function route() {
    if (session && !session.finished) session.cancel();
    FX.clear();
    closeModal();
    tip.hidden = true;
    const key = location.hash.replace(/^#\/?/, '').split('?')[0];
    (ROUTES[key] || renderHome)();
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === key));
    window.scrollTo(0, 0);
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const pref = Store.settings.theme;
    document.documentElement.classList.toggle('dark', pref === 'dark' || (pref === 'system' && media.matches));
    document.querySelectorAll('[data-theme-pref]').forEach(b => {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(b.dataset.themePref === pref));
    });
  }
  media.addEventListener('change', applyTheme);
  document.querySelectorAll('[data-theme-pref]').forEach(b => b.addEventListener('click', () => {
    Store.setSetting('theme', b.dataset.themePref);
    applyTheme();
  }));

  function syncPlayer() { $('#player-name').textContent = Store.player.name || 'Player'; }
  Store.onChange(syncPlayer);
  $('#player-btn').addEventListener('click', openSettings);

  document.addEventListener('click', e => {
    const badge = e.target.closest('[data-badge]');
    if (badge) { e.preventDefault(); openBadgeModal(badge.dataset.badge); return; }
    const roll = e.target.closest('[data-roll]');
    if (roll) { e.preventDefault(); openRollModal(Number(roll.dataset.roll)); }
  });

  document.addEventListener('keydown', e => {
    const modalOpen = !!$('#modal-root').firstChild;
    if (e.key === 'Escape' && modalOpen) { closeModal(); return; }
    if (modalOpen || (currentView !== 'home' && currentView !== 'result')) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) startRoll();
    } else if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') {
      e.preventDefault();
      if (!e.repeat) startRoll();
    }
  });

  window.addEventListener('hashchange', route);
  applyTheme();
  syncPlayer();
  route();
})();
