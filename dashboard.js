/* =========================================================
   dashboard.js — Compras board (dashboard.html)
   =========================================================
   Concept unchanged: items are either "Novo Pedido" (pending)
   or "Comprado". This screen shows pending items grouped by
   AI category, with search, quick filters, obra filter, a
   compact summary, drag & drop, a card "⋮" menu (edit / move /
   copy / mark bought / delete), undo on "bought", skeletons
   and empty states.

   Data is loaded once into `state.items`; filtering and
   re-rendering happen in memory (no refetch) for speed.

   Helpers: UI.* (ui.js), getSupabase/requireAuth (auth.js),
   showToast/initNav/groupBy (app.js).
   ========================================================= */

const URGENCY_META = {
  Urgente: { cls: "urgente", label: "Urgente", rank: 0 },
  "Prazo Normal": { cls: "normal", label: "Prazo Normal", rank: 1 },
  Programado: { cls: "programado", label: "Programado", rank: 2 },
};
const OVERDUE_DAYS = 2;

const COLLAPSE_KEY = "collapsed-categories";

const state = {
  items: [], // pending items
  filter: "todos",
  obra: "",
  search: "",
  boughtTodayCount: 0,
  collapsed: loadCollapsed(), // Set<string> of collapsed category names
};

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (_) {
    return new Set();
  }
}
function saveCollapsed() {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...state.collapsed]));
  } catch (_) {
    /* non-critical */
  }
}

let boardEl, summaryEl;

/* ------------------------- Boot -------------------------- */

async function initDashboard() {
  boardEl = document.getElementById("board");
  if (!boardEl) return;

  const configured = window.ensureConfigBanner("config-banner");
  if (!configured) {
    renderState("config", boardEl);
    return;
  }

  const user = await window.requireAuth();
  if (!user) return;

  window.initNav && window.initNav();
  initTheme();
  initZoom(boardEl);
  summaryEl = document.getElementById("summary");

  wireToolbar();

  await loadBoard();
}

function wireToolbar() {
  const search = document.getElementById("search");
  if (search) {
    search.addEventListener("input", debounce(() => {
      state.search = search.value.trim().toLowerCase();
      render();
    }, 120));
  }

  const chips = document.getElementById("filter-chips");
  if (chips) {
    chips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      state.filter = btn.dataset.filter;
      chips.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("chip--active", c === btn)
      );
      render();
    });
  }

  const obraFilter = document.getElementById("obra-filter");
  if (obraFilter) {
    obraFilter.addEventListener("change", () => {
      state.obra = obraFilter.value;
      render();
    });
  }

  const refresh = document.getElementById("refresh-btn");
  if (refresh) refresh.addEventListener("click", () => loadBoard());
}

/* ---------------------- Data load ------------------------ */

async function loadBoard() {
  boardEl.innerHTML = window.UI.skeletonBoard(3, 3);

  try {
    const sb = window.getSupabase();

    const [pendingRes, boughtRes] = await Promise.all([
      sb
        .from(window.APP_CONFIG.TABLE)
        .select("*")
        .eq("status", "Novo Pedido")
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      sb
        .from(window.APP_CONFIG.TABLE)
        .select("id, purchased_at")
        .eq("status", "Comprado")
        .gte("purchased_at", startOfTodayISO()),
    ]);

    if (pendingRes.error) throw pendingRes.error;

    state.items = pendingRes.data || [];
    state.boughtTodayCount = boughtRes.error ? 0 : (boughtRes.data || []).length;

    populateObraFilter();
    render();
  } catch (err) {
    console.error(err);
    renderState("error", boardEl, err.message);
    window.showToast(err.message || "Erro ao carregar o painel.", "error");
  }
}

function populateObraFilter() {
  const sel = document.getElementById("obra-filter");
  if (!sel) return;
  const obras = [
    ...new Set(state.items.map((i) => (i.obra || "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const current = state.obra;
  sel.innerHTML =
    '<option value="">Todas as obras</option>' +
    obras
      .map(
        (o) =>
          '<option value="' +
          window.UI.escapeHtml(o) +
          '"' +
          (o === current ? " selected" : "") +
          ">" +
          window.UI.escapeHtml(o) +
          "</option>"
      )
      .join("");
}

/* ----------------------- Filtering ----------------------- */

function visibleItems() {
  return state.items.filter((it) => {
    if (state.obra && (it.obra || "") !== state.obra) return false;

    if (state.filter === "prioridades" && !isOverdue(it)) return false;
    if (state.filter === "urgentes" && it.urgency !== "Urgente") return false;
    if (state.filter === "recentes" && window.UI.daysSince(it.created_at) > 1)
      return false;

    if (state.search) {
      const hay = [it.name, it.obra, it.category, it.observacao]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });
}

/* ------------------------ Render ------------------------- */

function render() {
  renderSummary();

  const items = visibleItems();
  boardEl.innerHTML = "";

  if (!state.items.length) {
    renderState("empty", boardEl);
    return;
  }
  if (!items.length) {
    renderState("no-results", boardEl);
    return;
  }

  const byCategory = window.groupBy(items, (i) => i.category || "Não identificado");
  const categories = Object.keys(byCategory).sort((a, b) =>
    categoryRank(byCategory[a], a) - categoryRank(byCategory[b], b) ||
    a.localeCompare(b, "pt-BR")
  );

  for (const category of categories) {
    const entries = bundleEntries(sortColumn(byCategory[category]));
    boardEl.appendChild(renderGroup(category, entries));
  }
}

/**
 * Collapse items that share a bundle_id into a single "bundle" entry.
 * Returns a list of entries where each entry is either:
 *   { bundle:false, item }                (a normal single item)
 *   { bundle:true, id, items:[...] }      (a card holding several items)
 * The original order is preserved by the position of the bundle's first item.
 */
function bundleEntries(items) {
  const entries = [];
  const bundleIndex = new Map(); // bundle_id -> entry
  for (const item of items) {
    const bid = item.bundle_id;
    if (bid) {
      let entry = bundleIndex.get(bid);
      if (!entry) {
        entry = { bundle: true, id: bid, items: [] };
        bundleIndex.set(bid, entry);
        entries.push(entry);
      }
      entry.items.push(item);
    } else {
      entries.push({ bundle: false, item });
    }
  }
  // Drop stale single-item bundles (e.g. after the other item was bought):
  // a bundle with one item behaves like a normal item.
  return entries.map((e) =>
    e.bundle && e.items.length === 1 ? { bundle: false, item: e.items[0] } : e
  );
}

/**
 * Rank for ordering category groups (item 17):
 * groups with urgent items first, then groups with overdue/priority items,
 * then the rest. "Não identificado" is pushed to the end so it reads as a
 * to-triage bucket, unless it has urgent items.
 */
function categoryRank(items, category) {
  const hasUrgent = items.some((i) => i.urgency === "Urgente");
  const hasPriority = items.some(isOverdue);
  if (hasUrgent) return 0;
  if (hasPriority) return 1;
  if (category === "Não identificado" || category === "Outros") return 4;
  return 2;
}

function renderSummary() {
  if (!summaryEl) return;
  const all = state.items;
  const total = all.length;
  const urgentes = all.filter((i) => i.urgency === "Urgente").length;
  const prioridades = all.filter(isOverdue).length;
  // Compact inline strip. Color only on the two status signals, and only
  // when they are non-zero.
  summaryEl.innerHTML =
    stat(total, "para comprar") +
    stat(prioridades, prioridades === 1 ? "prioridade" : "prioridades", "warn") +
    stat(urgentes, urgentes === 1 ? "urgente" : "urgentes", "danger") +
    stat(state.boughtTodayCount, "comprados hoje", "ok");
}

function stat(num, label, kind) {
  const zero = num === 0;
  return (
    '<span class="summary__stat' + (zero ? " is-zero" : "") + '">' +
    '<span class="summary__num' + (kind && !zero ? " summary__num--" + kind : "") + '">' +
    num +
    '</span><span class="summary__label">' +
    label +
    "</span></span>"
  );
}

/* ----------------------- Sorting ------------------------- */

function sortColumn(items) {
  const anyManual = items.some((i) => i.sort_order != null);
  if (anyManual) {
    return items.slice().sort((a, b) => {
      // Keep priority at the top even with manual order.
      const oa = isOverdue(a) ? 0 : 1;
      const ob = isOverdue(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const sa = a.sort_order == null ? Infinity : a.sort_order;
      const sb = b.sort_order == null ? Infinity : b.sort_order;
      return sa - sb;
    });
  }
  return items.slice().sort((a, b) => {
    const oa = isOverdue(a) ? 0 : 1;
    const ob = isOverdue(b) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const ua = URGENCY_META[a.urgency]?.rank ?? 9;
    const ub = URGENCY_META[b.urgency]?.rank ?? 9;
    if (ua !== ub) return ua - ub;
    return window.UI.daysSince(b.created_at) - window.UI.daysSince(a.created_at);
  });
}

function isOverdue(item) {
  return window.UI.daysSince(item.created_at) >= OVERDUE_DAYS;
}

/* --------------------- Group render ---------------------- */
/* A category is a vertical, collapsible section — not a column.
   The whole page scrolls; groups have no internal scroll. */

function renderGroup(category, entries) {
  const collapsed = state.collapsed.has(category);
  // Flatten to count items (bundles hold several).
  const allItems = entries.flatMap((e) => (e.bundle ? e.items : [e.item]));
  const itemCount = allItems.length;
  const overdueCount = allItems.filter(isOverdue).length;

  const group = document.createElement("section");
  group.className = "group" + (collapsed ? " group--collapsed" : "");
  group.dataset.category = category;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "group__header";
  header.setAttribute("aria-expanded", String(!collapsed));
  header.innerHTML =
    '<span class="group__chevron" aria-hidden="true">' +
    window.UI.glyph("chevron", 16) +
    "</span>" +
    '<span class="group__cat-icon">' +
    window.UI.categoryIcon(category, 18) +
    "</span>" +
    '<span class="group__title">' +
    window.UI.escapeHtml(category) +
    "</span>" +
    '<span class="group__count">' +
    itemCount +
    "</span>" +
    (overdueCount
      ? '<span class="group__alert" title="Itens em prioridade">' +
        window.UI.glyph("flag", 12) +
        " " +
        overdueCount +
        "</span>"
      : "");

  header.addEventListener("click", () => toggleGroup(category, group, header));

  const list = document.createElement("div");
  list.className = "group__list";
  list.dataset.category = category;
  entries.forEach((e) =>
    list.appendChild(e.bundle ? renderBundleCard(e) : renderCard(e.item))
  );
  wireDropZone(list);

  group.appendChild(header);
  group.appendChild(list);
  return group;
}

function toggleGroup(category, group, header) {
  const nowCollapsed = !group.classList.contains("group--collapsed");
  group.classList.toggle("group--collapsed", nowCollapsed);
  header.setAttribute("aria-expanded", String(!nowCollapsed));
  if (nowCollapsed) state.collapsed.add(category);
  else state.collapsed.delete(category);
  saveCollapsed();
}

/* ----------------------- Card render --------------------- */

function renderCard(item) {
  const meta = URGENCY_META[item.urgency] || { cls: "normal", label: item.urgency || "—" };
  const overdue = isOverdue(item);
  const days = window.UI.daysSince(item.created_at);

  const card = document.createElement("div");
  card.className = "item-card" + (overdue ? " item-card--overdue" : "");
  card.dataset.id = item.id;
  card.draggable = true;
  card.__item = item;

  const obraRow = item.obra
    ? '<div class="item-card__meta-row"><strong>Obra:</strong> ' +
      window.UI.escapeHtml(item.obra) +
      "</div>"
    : "";
  const obsRow = item.observacao
    ? '<div class="item-card__meta-row"><strong>Obs:</strong> ' +
      window.UI.escapeHtml(item.observacao) +
      "</div>"
    : "";

  // Keep the footer calm: urgency (tag) + time (pill). The automatic
  // time-based priority is already signalled by the left bar and by the
  // time pill turning red when overdue — no separate "Prioridade" badge.
  const badges = [
    '<span class="badge badge--time' +
      (overdue ? " is-overdue" : "") +
      '" title="' +
      window.UI.escapeHtml(
        window.UI.fullDate(item.created_at) +
          (overdue ? " · prioridade (há " + days + " dias)" : "")
      ) +
      '">' +
      (overdue ? window.UI.glyph("flag", 10) + " " : "") +
      window.UI.relativeDay(item.created_at) +
      "</span>",
  ];

  card.innerHTML =
    '<div class="item-card__top">' +
    "<div>" +
    '<h3 class="item-card__name">' + window.UI.escapeHtml(item.name) + "</h3>" +
    '<span class="item-card__qty">' + window.UI.escapeHtml(item.quantity || "A definir") + "</span>" +
    "</div>" +
    '<button class="item-card__kebab" type="button" aria-label="Opções" title="Opções">' + window.UI.glyph("kebab", 18) + "</button>" +
    "</div>" +
    '<div class="item-card__meta">' + obraRow + obsRow + "</div>" +
    '<div class="item-card__footer">' +
    '<span class="item-card__tags">' +
    '<span class="tag tag--' + meta.cls + '"><span class="segmented__dot segmented__dot--' + meta.cls + '"></span>' +
    window.UI.escapeHtml(meta.label) + "</span>" +
    badges.join("") +
    "</span>" +
    '<button class="done-btn" type="button">' + window.UI.glyph("check", 15) + " Comprado</button>" +
    "</div>";

  card.querySelector(".done-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    markAsDone(item, card);
  });
  card.querySelector(".item-card__kebab").addEventListener("click", (e) => {
    e.stopPropagation();
    openCardMenu(item, card, e.currentTarget);
  });

  wireDragSource(card);
  return card;
}

/* -------------------- Bundle card ------------------------ */
/* Several items joined into one card (via "Juntar com…"). The items
   stay as separate records (so Copiar lists all of them); they just
   render together and share one footer. */

function bundleUrgency(items) {
  // The bundle takes the most urgent of its items.
  return items.slice().sort(
    (a, b) => (URGENCY_META[a.urgency]?.rank ?? 9) - (URGENCY_META[b.urgency]?.rank ?? 9)
  )[0]?.urgency || "Prazo Normal";
}

function renderBundleCard(entry) {
  const items = entry.items;
  const overdue = items.some(isOverdue);
  const urg = bundleUrgency(items);
  const meta = URGENCY_META[urg] || { cls: "normal", label: urg };
  const oldest = items.reduce((a, b) =>
    window.UI.daysSince(a.created_at) >= window.UI.daysSince(b.created_at) ? a : b
  );
  const days = window.UI.daysSince(oldest.created_at);

  const card = document.createElement("div");
  card.className = "item-card item-card--bundle" + (overdue ? " item-card--overdue" : "");
  card.dataset.bundle = entry.id;
  card.__bundle = entry;

  // Shared obra, if all items share it.
  const obras = [...new Set(items.map((i) => (i.obra || "").trim()).filter(Boolean))];
  const obraRow = obras.length
    ? '<div class="item-card__meta-row"><strong>Obra:</strong> ' +
      window.UI.escapeHtml(obras.join(", ")) + "</div>"
    : "";

  const lines = items
    .map(
      (it) =>
        '<div class="bundle-line">' +
        '<span class="bundle-line__name">' + window.UI.escapeHtml(it.name) + "</span>" +
        '<span class="bundle-line__qty">' + window.UI.escapeHtml(it.quantity || "A definir") + "</span>" +
        "</div>"
    )
    .join("");

  const badges =
    '<span class="badge badge--time' + (overdue ? " is-overdue" : "") + '">' +
    (overdue ? window.UI.glyph("flag", 10) + " " : "") +
    window.UI.relativeDay(oldest.created_at) + "</span>";

  card.innerHTML =
    '<div class="item-card__top">' +
    '<div class="bundle__title"><span class="bundle__badge">' +
    window.UI.glyph("merge", 13) + " Agrupado</span>" +
    '<span class="bundle__count">' + items.length + " itens</span></div>" +
    '<button class="item-card__kebab" type="button" aria-label="Opções" title="Opções">' +
    window.UI.glyph("kebab", 18) + "</button>" +
    "</div>" +
    '<div class="bundle-lines">' + lines + "</div>" +
    '<div class="item-card__meta">' + obraRow + "</div>" +
    '<div class="item-card__footer">' +
    '<span class="item-card__tags">' +
    '<span class="tag tag--' + meta.cls + '"><span class="segmented__dot segmented__dot--' + meta.cls + '"></span>' +
    window.UI.escapeHtml(meta.label) + "</span>" + badges +
    "</span>" +
    '<button class="done-btn" type="button">' + window.UI.glyph("check", 15) + " Comprado</button>" +
    "</div>";

  card.querySelector(".done-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    markBundleDone(entry, card);
  });
  card.querySelector(".item-card__kebab").addEventListener("click", (e) => {
    e.stopPropagation();
    openBundleMenu(entry, card, e.currentTarget);
  });

  return card;
}

/* ----------------------- Card menu ----------------------- */

function openCardMenu(item, card, anchor) {
  closeAnyMenu();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.innerHTML =
    menuItem("edit", "Editar") +
    menuItem("move", "Mover para…") +
    menuItem("merge", "Juntar com…") +
    menuItem("copy", "Copiar") +
    '<div class="menu__sep"></div>' +
    '<div class="menu__label">Urgência</div>' +
    urgencyRow(item.urgency) +
    '<div class="menu__sep"></div>' +
    menuItem("done", "Marcar como comprado") +
    '<div class="menu__sep"></div>' +
    menuItem("delete", "Excluir", true);

  document.body.appendChild(menu);
  positionMenu(menu, anchor);

  const onDoc = (e) => {
    if (!menu.contains(e.target)) closeAnyMenu();
  };
  menu.__onDoc = onDoc;
  setTimeout(() => document.addEventListener("click", onDoc), 0);

  menu.addEventListener("click", (e) => {
    // Urgency chips inside the menu.
    const urg = e.target.closest(".menu-urg__opt");
    if (urg) {
      const value = urg.dataset.urg;
      closeAnyMenu();
      if (value !== item.urgency) changeUrgency(item, value);
      return;
    }

    const b = e.target.closest(".menu__item");
    if (!b) return;
    const action = b.dataset.action;
    if (action === "move") {
      openMoveSubmenu(item, b);
      return; // keep menu open; submenu replaces it
    }
    closeAnyMenu();
    if (action === "edit") openEditModal(item, card);
    else if (action === "merge") openMergeModal(item);
    else if (action === "copy") copyItem(item);
    else if (action === "done") markAsDone(item, card);
    else if (action === "delete") deleteItem(item, card);
  });
}

/* --------------------- Mover para… ----------------------- */

// Canonical categories offered in the submenu (plus any already in use).
const CANONICAL_CATEGORIES = [
  "Material Elétrico",
  "Material Hidráulico",
  "Material de Construção",
  "EPI",
  "Ferramentas",
  "Pintura",
  "Madeira",
  "Impermeabilização",
  "Não identificado",
];

function moveTargets(current) {
  const used = state.items.map((i) => i.category).filter(Boolean);
  const all = [...new Set([...CANONICAL_CATEGORIES, ...used])];
  return all.filter((c) => c !== current).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function openMoveSubmenu(item, anchorItem) {
  const targets = moveTargets(item.category);
  const menu = document.querySelector(".menu");
  if (!menu) return;
  menu.innerHTML =
    '<div class="menu__label">Mover para</div>' +
    targets
      .map(
        (c) =>
          '<button class="menu__item" data-cat="' +
          window.UI.escapeHtml(c) +
          '" type="button"><span class="menu__ico">' +
          window.UI.categoryIcon(c, 15) +
          "</span>" +
          window.UI.escapeHtml(c) +
          "</button>"
      )
      .join("");
  menu.addEventListener("click", (e) => {
    const b = e.target.closest(".menu__item[data-cat]");
    if (!b) return;
    closeAnyMenu();
    moveItemToCategory(item, b.dataset.cat);
  });
}

/** Optimistic category move + persist (item 8). */
async function moveItemToCategory(item, category) {
  if (!category || category === item.category) return;
  const previous = item.category;
  item.category = category; // optimistic
  render();
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({ category })
      .eq("id", item.id);
    if (error) throw error;
    window.showToast('Movido para "' + category + '".', "success");
  } catch (err) {
    console.error(err);
    item.category = previous; // rollback
    render();
    window.showToast("Não foi possível mover o item.", "error");
  }
}

/** Small 3-option urgency selector shown inside the card menu. */
function urgencyRow(current) {
  const opts = [
    { v: "Urgente", cls: "urgente", label: "Urgente" },
    { v: "Prazo Normal", cls: "normal", label: "Normal" },
    { v: "Programado", cls: "programado", label: "Program." },
  ];
  return (
    '<div class="menu-urg">' +
    opts
      .map(
        (o) =>
          '<button type="button" class="menu-urg__opt' +
          (o.v === current ? " is-active" : "") +
          '" data-urg="' +
          o.v +
          '" title="' +
          o.v +
          '"><span class="segmented__dot segmented__dot--' +
          o.cls +
          '"></span>' +
          o.label +
          "</button>"
      )
      .join("") +
    "</div>"
  );
}

/** Change an item's urgency and persist; re-render so sorting updates. */
async function changeUrgency(item, value) {
  const previous = item.urgency;
  item.urgency = value; // optimistic
  render();
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({ urgency: value })
      .eq("id", item.id);
    if (error) throw error;
    window.showToast("Prioridade alterada para " + value + ".", "success");
  } catch (err) {
    console.error(err);
    item.urgency = previous; // rollback
    render();
    window.showToast("Não foi possível alterar a prioridade.", "error");
  }
}

function menuItem(action, label, danger) {
  return (
    '<button class="menu__item' +
    (danger ? " menu__item--danger" : "") +
    '" data-action="' +
    action +
    '" type="button"><span class="menu__ico">' +
    menuIcon(action) +
    "</span>" +
    label +
    "</button>"
  );
}
function menuIcon(a) {
  const i = (p) =>
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + "</svg>";
  switch (a) {
    case "edit": return i('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
    case "move": return i('<path d="M5 12h14M13 6l6 6-6 6"/>');
    case "merge": return i('<path d="M7 3v4a4 4 0 0 0 4 4h2a4 4 0 0 1 4 4v4M17 3v4a4 4 0 0 1-4 4h-2a4 4 0 0 0-4 4v4"/>');
    case "copy": return i('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
    case "done": return i('<path d="M20 6 9 17l-5-5"/>');
    case "delete": return i('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>');
    default: return "";
  }
}
function positionMenu(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 220;
  let left = r.right - mw;
  let top = r.bottom + 6;
  if (left < 8) left = 8;
  if (top + menu.offsetHeight > window.innerHeight - 8) {
    top = r.top - menu.offsetHeight - 6;
  }
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}
function closeAnyMenu() {
  document.querySelectorAll(".menu").forEach((m) => {
    if (m.__onDoc) document.removeEventListener("click", m.__onDoc);
    m.remove();
  });
}

/* ----------------------- Edit modal ---------------------- */

function openEditModal(item, card) {
  const urg = ["Urgente", "Prazo Normal", "Programado"];
  const body =
    field("Material", 'name', item.name) +
    field("Quantidade", 'quantity', item.quantity) +
    field("Obra", 'obra', item.obra) +
    field("Categoria", 'category', item.category) +
    '<div class="field"><label class="field__label" for="m-urg">Urgência</label>' +
    '<select class="select" id="m-urg">' +
    urg.map((u) => '<option' + (u === item.urgency ? " selected" : "") + ">" + u + "</option>").join("") +
    "</select></div>" +
    '<div class="field"><label class="field__label" for="m-obs">Observação</label>' +
    '<textarea class="textarea" id="m-obs" style="min-height:80px">' +
    window.UI.escapeHtml(item.observacao || "") + "</textarea></div>";

  window.UI.modal({
    title: "Editar item",
    bodyHTML: body,
    confirmLabel: "Salvar alterações",
    onConfirm: async (root) => {
      const patch = {
        name: val(root, "m-name"),
        quantity: val(root, "m-quantity") || "A definir",
        obra: val(root, "m-obra"),
        category: val(root, "m-category") || "Outros",
        urgency: root.querySelector("#m-urg").value,
        observacao: root.querySelector("#m-obs").value.trim(),
      };
      if (!patch.name) {
        window.showToast("O nome do material é obrigatório.", "error");
        return false;
      }
      const sb = window.getSupabase();
      const { error } = await sb.from(window.APP_CONFIG.TABLE).update(patch).eq("id", item.id);
      if (error) throw error;
      Object.assign(item, patch);
      render();
      window.showToast("Item atualizado.", "success");
    },
  });

  function field(label, key, value) {
    return (
      '<div class="field"><label class="field__label" for="m-' + key + '">' + label + "</label>" +
      '<input class="input" id="m-' + key + '" value="' + window.UI.escapeHtml(value || "") + '" /></div>'
    );
  }
  function val(root, id) {
    return root.querySelector("#" + id).value.trim();
  }
}

/* ----------------------- Juntar com… --------------------- */
/* Joining keeps BOTH items; they just share a bundle_id and render in
   one card. Nothing is summed or deleted, so "Copiar" lists all of them. */

function openMergeModal(item) {
  // Candidates: other items/bundles, same category first.
  const others = state.items.filter((i) => i.id !== item.id);
  if (!others.length) {
    window.showToast("Não há outro item para juntar.", "error");
    return;
  }
  others.sort((a, b) => {
    const sa = a.category === item.category ? 0 : 1;
    const sb = b.category === item.category ? 0 : 1;
    return sa - sb || a.name.localeCompare(b.name, "pt-BR");
  });

  const options = others
    .map(
      (o) =>
        '<option value="' + o.id + '">' +
        window.UI.escapeHtml(o.name + " — " + (o.quantity || "A definir") +
          (o.category !== item.category ? "  ·  " + o.category : "")) +
        "</option>"
    )
    .join("");

  const body =
    '<p style="margin:0 0 14px;color:var(--text-2);font-size:14px">Agrupar <strong>' +
    window.UI.escapeHtml(item.name) +
    "</strong> com outro item no mesmo card. Os dois continuam separados — ao copiar, " +
    "aparecem juntos na mesma mensagem.</p>" +
    '<div class="field"><label class="field__label" for="mg-target">Juntar com</label>' +
    '<select class="select" id="mg-target">' + options + "</select></div>";

  window.UI.modal({
    title: "Juntar com…",
    bodyHTML: body,
    confirmLabel: "Juntar",
    onConfirm: async (root) => {
      const target = others.find((o) => o.id === root.querySelector("#mg-target").value);
      if (!target) return true;
      await joinItems(item, target);
    },
  });
}

/** Give both items (and any items already bundled with either) one bundle_id. */
async function joinItems(a, b) {
  // Reuse an existing bundle id if either side already belongs to one.
  const bundleId =
    a.bundle_id ||
    b.bundle_id ||
    (crypto.randomUUID ? crypto.randomUUID() : "bundle-" + Date.now());

  // Everything currently bundled with a or b joins too.
  const affected = state.items.filter(
    (i) =>
      i.id === a.id ||
      i.id === b.id ||
      (a.bundle_id && i.bundle_id === a.bundle_id) ||
      (b.bundle_id && i.bundle_id === b.bundle_id)
  );

  try {
    const sb = window.getSupabase();
    const ids = affected.map((i) => i.id);
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({ bundle_id: bundleId })
      .in("id", ids);
    if (error) throw error;
    affected.forEach((i) => (i.bundle_id = bundleId));
    render();
    window.showToast("Itens agrupados no mesmo card.", "success");
  } catch (err) {
    console.error(err);
    window.showToast("Não foi possível agrupar os itens.", "error");
    return false;
  }
}

/* -------------------- Bundle actions --------------------- */

function openBundleMenu(entry, card, anchor) {
  closeAnyMenu();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.innerHTML =
    menuItem("copy", "Copiar lista") +
    menuItem("ungroup", "Desagrupar") +
    '<div class="menu__sep"></div>' +
    menuItem("done", "Marcar como comprado");

  document.body.appendChild(menu);
  positionMenu(menu, anchor);
  const onDoc = (e) => { if (!menu.contains(e.target)) closeAnyMenu(); };
  menu.__onDoc = onDoc;
  setTimeout(() => document.addEventListener("click", onDoc), 0);

  menu.addEventListener("click", (e) => {
    const b = e.target.closest(".menu__item");
    if (!b) return;
    closeAnyMenu();
    if (b.dataset.action === "copy") copyBundle(entry);
    else if (b.dataset.action === "ungroup") ungroupBundle(entry);
    else if (b.dataset.action === "done") markBundleDone(entry, card);
  });
}

/** Copy all items of a bundle in one message. */
async function copyBundle(entry) {
  const lines = entry.items.map((it) => "• " + it.name + " — " + (it.quantity || "A definir"));
  const obras = [...new Set(entry.items.map((i) => (i.obra || "").trim()).filter(Boolean))];
  if (obras.length) lines.push((obras.length > 1 ? "Obras: " : "Obra: ") + obras.join(", "));
  try {
    await window.UI.copyToClipboard(lines.join("\n"));
    window.showToast("Itens copiados.", "success");
  } catch (_) {
    window.showToast("Não foi possível copiar.", "error");
  }
}

/** Remove the bundle link from all its items (they become separate cards). */
async function ungroupBundle(entry) {
  const ids = entry.items.map((i) => i.id);
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({ bundle_id: null })
      .in("id", ids);
    if (error) throw error;
    entry.items.forEach((i) => (i.bundle_id = null));
    render();
    window.showToast("Itens desagrupados.", "success");
  } catch (err) {
    console.error(err);
    window.showToast("Não foi possível desagrupar.", "error");
  }
}

/** Mark every item in a bundle as bought at once. */
async function markBundleDone(entry, card) {
  const btn = card && card.querySelector(".done-btn");
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner spinner--dark"></span>'; }
  const ids = entry.items.map((i) => i.id);
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({
        status: "Comprado",
        purchased_at: new Date().toISOString(),
        purchased_by: (await sb.auth.getUser()).data.user?.id ?? null,
      })
      .in("id", ids);
    if (error) throw error;
    const idset = new Set(ids);
    state.items = state.items.filter((i) => !idset.has(i.id));
    state.boughtTodayCount += ids.length;
    if (card) { card.classList.add("item-card--done"); setTimeout(() => card.classList.add("item-card--removing"), 120); }
    setTimeout(render, 340);
    window.showToast(ids.length + " itens marcados como comprados.", "success", {
      action: { label: "Desfazer", onClick: () => undoBundleDone(entry) },
    });
  } catch (err) {
    console.error(err);
    if (btn) { btn.disabled = false; btn.innerHTML = window.UI.glyph("check", 15) + " Comprado"; }
    window.showToast("Não foi possível concluir.", "error");
  }
}

async function undoBundleDone(entry) {
  const ids = entry.items.map((i) => i.id);
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({ status: "Novo Pedido", purchased_at: null, purchased_by: null })
      .in("id", ids);
    if (error) throw error;
    entry.items.forEach((i) => { if (!state.items.some((x) => x.id === i.id)) state.items.push(i); });
    state.boughtTodayCount = Math.max(0, state.boughtTodayCount - ids.length);
    render();
    window.showToast("Ação desfeita.", "");
  } catch (err) {
    console.error(err);
    window.showToast("Não foi possível desfazer.", "error");
  }
}

/* -------------------------- Copy ------------------------- */

async function copyItem(item) {
  const parts = ["• " + item.name + " — " + (item.quantity || "A definir")];
  if (item.obra) parts.push("Obra: " + item.obra);
  if (item.observacao) parts.push("Obs: " + item.observacao);
  if (isOverdue(item)) parts.push("(PRIORIDADE)");
  try {
    await window.UI.copyToClipboard(parts.join("\n"));
    window.showToast("Item copiado.", "success");
  } catch (_) {
    window.showToast("Não foi possível copiar.", "error");
  }
}

/* --------------------- Mark as bought -------------------- */

async function markAsDone(item, card) {
  const btn = card.querySelector(".done-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner spinner--dark"></span>';
  }
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({
        status: "Comprado",
        purchased_at: new Date().toISOString(),
        purchased_by: (await sb.auth.getUser()).data.user?.id ?? null,
      })
      .eq("id", item.id);
    if (error) throw error;

    // Remove from in-memory state, with a brief success flash then fade.
    state.items = state.items.filter((i) => i.id !== item.id);
    state.boughtTodayCount += 1;
    card.classList.add("item-card--done");
    setTimeout(() => card.classList.add("item-card--removing"), 120);
    setTimeout(render, 340);

    // Toast with Undo.
    window.showToast("Item marcado como comprado.", "success", {
      action: {
        label: "Desfazer",
        onClick: () => undoDone(item),
      },
    });
  } catch (err) {
    console.error(err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = window.UI.glyph("check", 15) + " Comprado";
    }
    window.showToast(err.message || "Não foi possível atualizar.", "error");
  }
}

async function undoDone(item) {
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.TABLE)
      .update({ status: "Novo Pedido", purchased_at: null, purchased_by: null })
      .eq("id", item.id);
    if (error) throw error;
    if (!state.items.some((i) => i.id === item.id)) state.items.push(item);
    state.boughtTodayCount = Math.max(0, state.boughtTodayCount - 1);
    populateObraFilter();
    render();
    window.showToast("Ação desfeita.", "");
  } catch (err) {
    console.error(err);
    window.showToast("Não foi possível desfazer.", "error");
  }
}

/* -------------------------- Delete ----------------------- */

function deleteItem(item, card) {
  window.UI.modal({
    title: "Excluir item",
    bodyHTML:
      '<p style="margin:0;color:var(--text-2)">Remover <strong>' +
      window.UI.escapeHtml(item.name) +
      "</strong> da agenda? Esta ação não pode ser desfeita.</p>",
    confirmLabel: "Excluir",
    onConfirm: async () => {
      const sb = window.getSupabase();
      const { error } = await sb.from(window.APP_CONFIG.TABLE).delete().eq("id", item.id);
      if (error) throw error;
      state.items = state.items.filter((i) => i.id !== item.id);
      render();
      window.showToast("Item excluído.", "success");
    },
  });
}

/* --------------------- Drag & drop ----------------------- */

let draggedCard = null;
let joinHandled = false; // true when a drop lands on another card (join), so the
                         // list drop skips the normal reorder.

function wireDragSource(card) {
  card.addEventListener("dragstart", (e) => {
    draggedCard = card;
    joinHandled = false;
    card.classList.add("item-card--dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", card.dataset.id); } catch (_) {}
  });
  card.addEventListener("dragend", () => {
    card.classList.remove("item-card--dragging");
    document.querySelectorAll(".group__list--over").forEach((el) => el.classList.remove("group__list--over"));
    document.querySelectorAll(".item-card--join-target").forEach((el) => el.classList.remove("item-card--join-target"));
    draggedCard = null;
  });

  // Dropping a card ONTO another card offers to group them.
  card.addEventListener("dragover", (e) => {
    if (!draggedCard || draggedCard === card || !card.__item) return;
    // Only treat as a join when hovering near the card's center.
    const box = card.getBoundingClientRect();
    const nearCenter = Math.abs(e.clientY - (box.top + box.height / 2)) < box.height * 0.32;
    if (nearCenter) {
      e.preventDefault();
      e.stopPropagation();
      card.classList.add("item-card--join-target");
    } else {
      card.classList.remove("item-card--join-target");
    }
  });
  card.addEventListener("dragleave", () => {
    card.classList.remove("item-card--join-target");
  });
  card.addEventListener("drop", (e) => {
    if (!draggedCard || draggedCard === card || !card.__item) return;
    if (!card.classList.contains("item-card--join-target")) return;
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove("item-card--join-target");
    joinHandled = true;
    const source = draggedCard.__item;
    const target = card.__item;
    confirmJoin(source, target);
  });
}

/** Ask before grouping two materials (drag one card onto another). */
function confirmJoin(source, target) {
  if (!source || !target || source.id === target.id) return;
  window.UI.modal({
    title: "Agrupar materiais",
    bodyHTML:
      '<p style="margin:0;color:var(--text-2);font-size:14px">Deseja agrupar ' +
      "<strong>" + window.UI.escapeHtml(source.name) + "</strong> e <strong>" +
      window.UI.escapeHtml(target.name) + "</strong> no mesmo card?<br><br>" +
      "Os dois continuam separados — ao copiar, aparecem juntos na mesma mensagem.</p>",
    confirmLabel: "Agrupar",
    onConfirm: async () => {
      await joinItems(source, target);
    },
  });
}

function wireDropZone(list) {
  list.addEventListener("dragover", (e) => {
    if (!draggedCard) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    list.classList.add("group__list--over");
    const after = getCardAfterPoint(list, e.clientY);
    if (after == null) list.appendChild(draggedCard);
    else list.insertBefore(draggedCard, after);
  });
  list.addEventListener("dragleave", (e) => {
    if (!list.contains(e.relatedTarget)) list.classList.remove("group__list--over");
  });
  list.addEventListener("drop", async (e) => {
    if (!draggedCard) return;
    list.classList.remove("group__list--over");
    // If the drop landed on a card (join), skip the reorder entirely.
    if (joinHandled) { joinHandled = false; return; }
    e.preventDefault();
    await persistAfterCardDrop(draggedCard, list);
  });
}

function getCardAfterPoint(list, y) {
  const cards = [...list.querySelectorAll(".item-card:not(.item-card--dragging)")];
  let closest = null;
  let closestOffset = Number.NEGATIVE_INFINITY;
  for (const c of cards) {
    const box = c.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) {
      closestOffset = offset;
      closest = c;
    }
  }
  return closest;
}

async function persistAfterCardDrop(card, list) {
  const item = card.__item;
  const newCategory = list.dataset.category;
  const categoryChanged = newCategory !== item.category;

  // Only single-item cards carry __item; bundle cards aren't reordered here.
  const cards = [...list.querySelectorAll(".item-card")].filter((c) => c.__item);
  const rows = cards.map((c, idx) => {
    c.__item.sort_order = idx + 1;
    return { id: c.dataset.id, sort_order: idx + 1 };
  });
  if (categoryChanged) item.category = newCategory;

  // Refresh counts/alerts on every group, then drop any that emptied.
  boardEl.querySelectorAll(".group").forEach(refreshGroupMeta);
  if (categoryChanged) cleanupEmptyGroups();

  try {
    const sb = window.getSupabase();
    const updates = rows.map((r) => {
      const patch = { sort_order: r.sort_order };
      if (categoryChanged && r.id === item.id) patch.category = newCategory;
      return sb.from(window.APP_CONFIG.TABLE).update(patch).eq("id", r.id);
    });
    const results = await Promise.all(updates);
    const failed = results.find((res) => res.error);
    if (failed) throw failed.error;
    if (categoryChanged) {
      window.showToast('"' + item.name + '" movido para ' + newCategory + ".", "success");
    }
  } catch (err) {
    console.error(err);
    window.showToast("Não foi possível salvar a ordem. Recarregue.", "error");
  }
}

/* ------------------- Group meta refresh ------------------ */

function refreshGroupMeta(group) {
  if (!group) return;
  const cards = [...group.querySelectorAll(".item-card")];
  const counter = group.querySelector(".group__count");
  if (counter) counter.textContent = cards.length;

  const overdue = cards.filter((c) => isOverdue(c.__item)).length;
  const header = group.querySelector(".group__header");
  if (!header) return;
  let alert = header.querySelector(".group__alert");
  if (overdue) {
    if (!alert) {
      alert = document.createElement("span");
      alert.className = "group__alert";
      alert.title = "Itens em prioridade";
      header.appendChild(alert);
    }
    alert.innerHTML = window.UI.glyph("flag", 12) + " " + overdue;
  } else if (alert) {
    alert.remove();
  }
}

function cleanupEmptyGroups() {
  boardEl.querySelectorAll(".group").forEach((group) => {
    const list = group.querySelector(".group__list");
    if (list && list.querySelectorAll(".item-card").length === 0) group.remove();
  });
}

/* ------------------------- Zoom -------------------------- */

const ZOOM_KEY = "board-zoom";
function initZoom(board) {
  const out = document.getElementById("zoom-out");
  const inc = document.getElementById("zoom-in");
  const reset = document.getElementById("zoom-reset");
  if (!board || !out || !inc || !reset) return;
  let zoom = clamp(parseInt(localStorage.getItem(ZOOM_KEY), 10) || 100, 70, 160);
  const apply = () => {
    board.style.setProperty("--board-scale", (zoom / 100).toString());
    reset.textContent = zoom + "%";
    out.disabled = zoom <= 70;
    inc.disabled = zoom >= 160;
    localStorage.setItem(ZOOM_KEY, String(zoom));
  };
  out.addEventListener("click", () => { zoom = clamp(zoom - 10, 70, 160); apply(); });
  inc.addEventListener("click", () => { zoom = clamp(zoom + 10, 70, 160); apply(); });
  reset.addEventListener("click", () => { zoom = 100; apply(); });
  board.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoom = clamp(zoom + (e.deltaY < 0 ? 10 : -10), 70, 160);
    apply();
  }, { passive: false });
  apply();
}

/* ------------------------ Theme -------------------------- */

const THEME_KEY = "theme";
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
  });
}

/* ------------------------ States ------------------------- */

function renderState(kind, host, detail) {
  const box = (icon, title, text, actionHtml) =>
    '<div class="state"><div class="state__icon">' + icon + "</div>" +
    '<p class="state__title">' + title + "</p>" +
    '<p class="state__text">' + text + "</p>" +
    (actionHtml || "") + "</div>";

  const cart =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M2 3h3l2.4 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L23 7H6"/></svg>';
  const search =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const warn =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';

  if (kind === "empty") {
    host.innerHTML = box(cart, "Tudo comprado por aqui.",
      "Quando você adicionar novos materiais, eles aparecerão nesta tela.",
      '<a class="btn btn--primary" href="index.html" style="margin-top:8px">Adicionar materiais</a>');
  } else if (kind === "no-results") {
    host.innerHTML = box(search, "Nada encontrado", "Ajuste a busca ou os filtros.");
  } else if (kind === "config") {
    host.innerHTML = box(warn, "Configuração pendente", "Edite config.js com as chaves do Supabase.");
  } else {
    host.innerHTML = box(warn, "Erro ao carregar", window.UI.escapeHtml(detail || "Tente novamente."));
  }
}

/* ----------------------- Utilities ----------------------- */

function clamp(v, min, max) {
  if (Number.isNaN(v)) return min;
  return Math.min(max, Math.max(min, v));
}
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
function startOfTodayISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

document.addEventListener("DOMContentLoaded", initDashboard);
