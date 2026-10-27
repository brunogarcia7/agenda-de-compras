/* =========================================================
   history.js — Purchased-items history (history.html)
   =========================================================
   Lists items with status "Comprado", grouped by purchase day,
   with instant search, period filters (Hoje/7/30/Todos) and a
   "Reabrir" action that returns an item to the board.

   Helpers: UI.* (ui.js), getSupabase/requireAuth (auth.js),
   showToast/initNav/groupBy (app.js).
   ========================================================= */

const URG_CLS = { Urgente: "urgente", "Prazo Normal": "normal", Programado: "programado" };

const hstate = {
  items: [],
  period: "30", // 'hoje' | '7' | '30' | 'todos'
  search: "",
};

let hList, hStatus;

async function initHistory() {
  hList = document.getElementById("history-list");
  if (!hList) return;

  const configured = window.ensureConfigBanner("config-banner");
  if (!configured) {
    emptyState("config", "Configuração pendente", "Edite config.js.");
    return;
  }
  const user = await window.requireAuth();
  if (!user) return;

  window.initNav && window.initNav();
  applySavedTheme();

  hStatus = document.getElementById("history-status");
  const search = document.getElementById("history-search");
  const chips = document.getElementById("period-chips");
  const refresh = document.getElementById("refresh-btn");

  if (search)
    search.addEventListener("input", debounce(() => {
      hstate.search = search.value.trim().toLowerCase();
      render();
    }, 120));

  if (chips)
    chips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      hstate.period = btn.dataset.period;
      chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("chip--active", c === btn));
      render();
    });

  if (refresh) refresh.addEventListener("click", load);

  await load();

  async function load() {
    hList.innerHTML = window.UI.skeletonBoard(1, 4).replace(/column/g, "history-sk");
    setStatus("Carregando…", true);
    try {
      const sb = window.getSupabase();
      const { data, error } = await sb
        .from(window.APP_CONFIG.TABLE)
        .select("*")
        .eq("status", "Comprado")
        .order("purchased_at", { ascending: false });
      if (error) throw error;
      hstate.items = data || [];
      render();
    } catch (err) {
      console.error(err);
      setStatus("", false);
      emptyState("error", "Erro ao carregar", err.message || "Tente novamente.");
      window.showToast(err.message || "Erro ao carregar o histórico.", "error");
    }
  }
}

function withinPeriod(iso) {
  if (hstate.period === "todos") return true;
  const days = window.UI.daysSince(iso);
  if (hstate.period === "hoje") return days <= 0;
  if (hstate.period === "7") return days <= 7;
  if (hstate.period === "30") return days <= 30;
  return true;
}

function render() {
  const term = hstate.search;
  const filtered = hstate.items.filter((it) => {
    if (!withinPeriod(it.purchased_at)) return false;
    if (!term) return true;
    const hay = [it.name, it.obra, it.category, it.observacao].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(term);
  });

  setStatus(filtered.length + " item(ns)", false);

  if (!hstate.items.length) {
    emptyState("empty", "Nada comprado ainda", "Itens marcados como comprados aparecerão aqui.");
    return;
  }
  if (!filtered.length) {
    emptyState("no-results", "Nada encontrado", "Ajuste a busca ou o período.");
    return;
  }

  const byDay = window.groupBy(filtered, (it) => dayKey(it.purchased_at));
  hList.innerHTML = "";
  for (const [day, list] of Object.entries(byDay)) {
    const section = document.createElement("div");
    section.className = "history__group";
    const head = document.createElement("div");
    head.className = "history__group-head";
    head.innerHTML = "<span>" + window.UI.escapeHtml(day) + '</span><span class="column__count">' + list.length + "</span>";
    section.appendChild(head);
    list.forEach((it) => section.appendChild(renderRow(it)));
    hList.appendChild(section);
  }
}

function renderRow(item) {
  const row = document.createElement("div");
  row.className = "history__row";
  const urgCls = URG_CLS[item.urgency] || "normal";

  row.innerHTML =
    '<span class="history__ico">' + window.UI.categoryIcon(item.category, 20) + "</span>" +
    '<div class="history__main">' +
    '<span class="history__name">' + window.UI.escapeHtml(item.name) + "</span>" +
    '<span class="history__sub">' +
    window.UI.escapeHtml(item.category || "—") + " · " + window.UI.escapeHtml(item.obra || "—") +
    "</span></div>" +
    '<span class="item-card__qty">' + window.UI.escapeHtml(item.quantity || "A definir") + "</span>" +
    '<span class="tag tag--' + urgCls + '"><span class="segmented__dot segmented__dot--' + urgCls + '"></span>' +
    window.UI.escapeHtml(item.urgency || "—") + "</span>" +
    '<button class="btn btn--ghost btn--sm history__reopen" type="button">Reabrir</button>';

  row.querySelector(".history__reopen").addEventListener("click", (e) => {
    reopen(item, row, e.currentTarget);
  });
  return row;
}

async function reopen(item, row, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({ status: "Novo Pedido", purchased_at: null, purchased_by: null })
      .eq("id", item.id);
    if (error) throw error;
    hstate.items = hstate.items.filter((i) => i.id !== item.id);
    render();
    window.showToast("Item reaberto nas compras.", "success");
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = "Reabrir";
    window.showToast(err.message || "Não foi possível reabrir.", "error");
  }
}

/* ------------------------ Helpers ------------------------ */

function dayKey(iso) {
  if (!iso) return "Sem data";
  const rel = window.UI.relativeDay(iso);
  // For today/yesterday keep the friendly label; otherwise full date.
  if (rel === "Hoje" || rel === "Ontem") return rel;
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  } catch (_) {
    return "Sem data";
  }
}

function setStatus(text, loading) {
  if (!hStatus) return;
  hStatus.innerHTML = loading
    ? '<span class="spinner spinner--dark"></span> ' + window.UI.escapeHtml(text)
    : window.UI.escapeHtml(text);
}

function emptyState(kind, title, text) {
  const icon =
    kind === "empty"
      ? '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  hList.innerHTML =
    '<div class="state"><div class="state__icon">' + icon + "</div>" +
    '<p class="state__title">' + window.UI.escapeHtml(title) + "</p>" +
    '<p class="state__text">' + window.UI.escapeHtml(text) + "</p></div>";
}

function applySavedTheme() {
  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

document.addEventListener("DOMContentLoaded", initHistory);
