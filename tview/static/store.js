/**
 * Per-browser state (watchlist + saved column filters) in localStorage.
 * Loaded before each page's script; exposed as window.Store.
 */
(function () {
  const WATCHLIST_KEY = "tview:watchlist";
  const FILTERS_KEY = "tview:filters";
  const DIRECTION_KEY = "tview:direction";
  const SIMPLE_KEY = "tview:simple";
  const HIDDEN_SIGNALS_KEY = "tview:hiddenSignals";
  const HIDDEN_COLUMNS_KEY = "tview:hiddenColumns";

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

    getDirection() {
      return readJSON(DIRECTION_KEY, "long") === "short" ? "short" : "long";
    },
    setDirection(direction) {
      writeJSON(DIRECTION_KEY, direction === "short" ? "short" : "long");
      return direction;
    },

    getSimple() {
      return !!readJSON(SIMPLE_KEY, false);
    },
    setSimple(on) {
      writeJSON(SIMPLE_KEY, !!on);
      return !!on;
    },

    // Hidden signals — array of signal class strings (e.g. "pullback", "near-100").
    getHiddenSignals() {
      return readJSON(HIDDEN_SIGNALS_KEY, []);
    },
    setHiddenSignals(list) {
      writeJSON(HIDDEN_SIGNALS_KEY, list);
      return list;
    },
    isSignalHidden(signalClass) {
      const hidden = this.getHiddenSignals();
      return hidden.includes(signalClass);
    },
    hideSignal(signalClass) {
      const hidden = this.getHiddenSignals();
      if (!hidden.includes(signalClass)) {
        hidden.push(signalClass);
        this.setHiddenSignals(hidden);
      }
      return hidden;
    },
    unhideSignal(signalClass) {
      const hidden = this.getHiddenSignals();
      const filtered = hidden.filter((s) => s !== signalClass);
      this.setHiddenSignals(filtered);
      return filtered;
    },
    clearHiddenSignals() {
      this.setHiddenSignals([]);
    },

    // Hidden columns — array of column identifiers.
    getHiddenColumns() {
      return readJSON(HIDDEN_COLUMNS_KEY, []);
    },
    setHiddenColumns(list) {
      writeJSON(HIDDEN_COLUMNS_KEY, list);
      return list;
    },
    isColumnHidden(columnId) {
      const hidden = this.getHiddenColumns();
      return hidden.includes(columnId);
    },
    toggleColumn(columnId) {
      const hidden = this.getHiddenColumns();
      if (hidden.includes(columnId)) {
        this.setHiddenColumns(hidden.filter((c) => c !== columnId));
      } else {
        hidden.push(columnId);
        this.setHiddenColumns(hidden);
      }
      return hidden;
    },
  };

  window.Store = Store;
})();
