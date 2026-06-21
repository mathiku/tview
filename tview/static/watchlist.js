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
    stocks.length === 1 ? "1 pinned" : `${stocks.length} pinned`;

  if (!stocks.length) {
    list.innerHTML = `<li class="empty">No pinned stocks yet — add a symbol above.</li>`;
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
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const res = await fetch(`/api/pinned/${encodeURIComponent(btn.dataset.symbol)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
        const payload = await res.json();
        renderList(payload.stocks);
        setStatus("Saved", "live");
      } catch (err) {
        console.error(err);
        setStatus("Error", "error");
        btn.disabled = false;
      }
    });
  });
}

async function loadPinned() {
  const res = await fetch("/api/pinned");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  renderList(payload.stocks);
  setStatus("Live", "live");
}

document.getElementById("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");

  const input = document.getElementById("symbol-input");
  const symbol = input.value.trim().toUpperCase();
  if (!symbol) return;

  const button = event.target.querySelector("button[type=submit]");
  button.disabled = true;

  try {
    const res = await fetch("/api/pinned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);

    input.value = "";
    renderList(payload.stocks);
    setStatus("Saved", "live");
  } catch (err) {
    showError(err.message);
    setStatus("Error", "error");
  } finally {
    button.disabled = false;
  }
});

loadPinned().catch((err) => {
  console.error(err);
  setStatus("Error", "error");
});
