/**
 * Per-browser state (watchlist + saved column filters) in localStorage.
 * Loaded before each page's script; exposed as window.Store.
 */
(function () {
  const WATCHLIST_KEY = "tview:watchlist";
  const FILTERS_KEY = "tview:filters";

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const val = JSON.parse(raw);
      return val ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* storage full / disabled — ignore */
    }
  }

  const Store = {
    // Watchlist — array of { symbol, name }. null means "never seeded yet".
    getWatchlist() {
      return readJSON(WATCHLIST_KEY, null);
    },
    setWatchlist(list) {
      writeJSON(WATCHLIST_KEY, list);
      return list;
    },
    symbols() {
      return (readJSON(WATCHLIST_KEY, []) || []).map((s) => s.symbol);
    },
    has(symbol) {
      const s = String(symbol).toUpperCase();
      return (readJSON(WATCHLIST_KEY, []) || []).some((x) => x.symbol === s);
    },
    add(symbol, name) {
      const s = String(symbol).toUpperCase();
      const list = readJSON(WATCHLIST_KEY, []) || [];
      if (!list.some((x) => x.symbol === s)) list.push({ symbol: s, name: name || s });
      return this.setWatchlist(list);
    },
    remove(symbol) {
      const s = String(symbol).toUpperCase();
      const list = (readJSON(WATCHLIST_KEY, []) || []).filter((x) => x.symbol !== s);
      return this.setWatchlist(list);
    },
    toggle(symbol, name) {
      return this.has(symbol) ? this.remove(symbol) : this.add(symbol, name);
    },

    // Column filters — { [key]: minNumber } plus booleans watchOnly / doubleBottomOnly.
    getFilters() {
      return readJSON(FILTERS_KEY, {});
    },
    setFilters(filters) {
      writeJSON(FILTERS_KEY, filters);
      return filters;
    },
  };

  window.Store = Store;
})();
