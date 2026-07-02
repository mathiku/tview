function setStatus(text, kind = "live") {
  const badge = document.getElementById("refresh-status");
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function showError(message) {
  const el = document.getElementById("form-error");
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function renderList(stocks) {
  const list = document.getElementById("pinned-list");
  document.getElementById("watchlist-count").textContent =
    stocks.length === 1 ? "1 saved" : `${stocks.length} saved`;

  if (!stocks.length) {
    list.innerHTML = `<li class="empty">Your watchlist is empty — add a symbol above.</li>`;
    return;
  }

  list.innerHTML = stocks
    .map(
      (stock) => `
        <li class="pinned-item">
          <div class="pinned-info">
            <span class="sym">${stock.symbol}</span>
            <span class="name">${stock.name}</span>
          </div>
          <div class="pinned-actions">
            <a class="btn-link" href="/stock?symbol=${encodeURIComponent(stock.symbol)}">Charts</a>
            <button type="button" class="btn-remove" data-symbol="${stock.symbol}">Remove</button>
          </div>
        </li>
      `
    )
    .join("");

  list.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      renderList(Store.remove(btn.dataset.symbol));
      setStatus("Saved", "live");
    });
  });
}

/** Seed the browser watchlist from the server default the first time only. */
async function seedIfNeeded() {
  if (Store.getWatchlist() != null) return Store.getWatchlist();
  try {
    const res = await fetch("/api/pinned");
    const payload = await res.json();
    return Store.setWatchlist(payload.stocks ?? []);
  } catch {
    return Store.setWatchlist([]);
  }
}

document.getElementById("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");

  const input = document.getElementById("symbol-input");
  const symbol = input.value.trim().toUpperCase();
  if (!symbol) return;
  if (Store.has(symbol)) {
    showError(`${symbol} is already on your watchlist.`);
    return;
  }

  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;
  setStatus("Checking…");

  try {
    // Validate against Yahoo (and grab the name) before saving.
    const res = await fetch(`/api/analyze?symbols=${encodeURIComponent(symbol)}`);
    const payload = await res.json();
    const match = payload.stocks?.[0];
    if (!match) throw new Error(`Couldn't find data for ${symbol}.`);

    input.value = "";
    renderList(Store.add(match.symbol, match.name));
    setStatus("Saved", "live");
  } catch (err) {
    showError(err.message);
    setStatus("Error", "error");
  } finally {
    button.disabled = false;
  }
});

seedIfNeeded()
  .then((list) => {
    renderList(list);
    setStatus("Live", "live");
  })
  .catch((err) => {
    console.error(err);
    setStatus("Error", "error");
  });
