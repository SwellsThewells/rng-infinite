/* RNG∞ — persistance locale (localStorage).
 * Un tirage est stocké en tableau compact [nombre, EP, timestamp] ; les badges se recalculent à la demande.
 * Le champ player.id sert d'identifiant stable pour le futur leaderboard en ligne.
 */
(function (root) {
  'use strict';

  const KEY = 'rnginf.v1';
  const MAX_ROLL = 1000000;

  function uid() {
    const bytes = new Uint8Array(8);
    try { crypto.getRandomValues(bytes); } catch (e) { for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256); }
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  function defaults() {
    return {
      version: 1,
      player: { id: uid(), name: '' },
      settings: { speed: 'normal', theme: 'system', sound: false },
      rolls: [],
    };
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const data = JSON.parse(raw);
      const base = defaults();
      return {
        version: 1,
        player: Object.assign(base.player, data.player),
        settings: Object.assign(base.settings, data.settings),
        rolls: Array.isArray(data.rolls) ? data.rolls.filter(isValidRoll) : [],
      };
    } catch (e) {
      return defaults();
    }
  }

  function isValidRoll(r) {
    return Array.isArray(r) && Number.isInteger(r[0]) && r[0] >= 0 && r[0] <= MAX_ROLL &&
      Number.isFinite(r[1]) && Number.isFinite(r[2]);
  }

  const listeners = new Set();

  const Store = {
    state: read(),

    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
        return true;
      } catch (e) {
        return false;
      }
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { listeners.forEach(fn => fn(this.state)); },

    get rolls() { return this.state.rolls; },
    get player() { return this.state.player; },
    get settings() { return this.state.settings; },

    addRoll(n, ep) {
      const roll = [n, ep, Date.now()];
      this.state.rolls.push(roll);
      const ok = this.save();
      this.emit();
      return { roll, saved: ok };
    },

    setPlayerName(name) {
      this.state.player.name = String(name || '').trim().slice(0, 20);
      this.save();
      this.emit();
    },

    setSetting(key, value) {
      this.state.settings[key] = value;
      this.save();
      this.emit();
    },

    clearRolls() {
      this.state.rolls = [];
      this.save();
      this.emit();
    },

    exportJSON() {
      return JSON.stringify({
        app: 'rng-infinite',
        exportedAt: new Date().toISOString(),
        player: this.state.player,
        rolls: this.state.rolls,
      });
    },

    // Fusionne un export : les EP sont recalculés par l'appelant (rescore) pour ne jamais faire confiance au fichier.
    importJSON(text, rescore) {
      const data = JSON.parse(text);
      const incoming = Array.isArray(data.rolls) ? data.rolls : [];
      const seen = new Set(this.state.rolls.map(r => r[2] + ':' + r[0]));
      let added = 0;
      for (const r of incoming) {
        if (!Array.isArray(r) || !Number.isInteger(r[0]) || r[0] < 0 || r[0] > MAX_ROLL || !Number.isFinite(r[2])) continue;
        const key = r[2] + ':' + r[0];
        if (seen.has(key)) continue;
        seen.add(key);
        this.state.rolls.push([r[0], rescore(r[0]), r[2]]);
        added++;
      }
      this.state.rolls.sort((a, b) => a[2] - b[2]);
      this.save();
      this.emit();
      return added;
    },
  };

  root.Store = Store;
})(window);
