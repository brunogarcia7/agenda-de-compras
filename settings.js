/* =========================================================
   settings.js — Configurações (config.html)
   =========================================================
   First section: Obras (construction sites). Create, list,
   toggle active, and delete. The "Nova solicitação" screen
   offers only the active obras.

   Helpers: UI.* (ui.js), getSupabase/requireAuth (auth.js),
   showToast/initNav (app.js).
   ========================================================= */

let obrasListEl;
let obrasState = [];

async function initSettings() {
  obrasListEl = document.getElementById("obras-list");
  if (!obrasListEl) return;

  const configured = window.ensureConfigBanner("config-banner");
  if (!configured) return;

  const user = await window.requireAuth();
  if (!user) return;

  window.initNav && window.initNav();

  const form = document.getElementById("obra-form");
  if (form) form.addEventListener("submit", onAddObra);

  await loadObras();
}

async function loadObras() {
  obrasListEl.innerHTML = skeletonRows(3);
  try {
    const sb = window.getSupabase();
    const { data, error } = await sb
      .from(window.APP_CONFIG.OBRAS_TABLE)
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    obrasState = data || [];
    renderObras();
  } catch (err) {
    console.error(err);
    obrasListEl.innerHTML =
      '<p class="settings-empty">Não foi possível carregar as obras. ' +
      window.UI.escapeHtml(err.message || "") + "</p>";
    window.showToast(err.message || "Erro ao carregar obras.", "error");
  }
}

function renderObras() {
  if (!obrasState.length) {
    obrasListEl.innerHTML =
      '<p class="settings-empty">Nenhuma obra cadastrada ainda. ' +
      "Adicione a primeira acima.</p>";
    return;
  }
  obrasListEl.innerHTML = "";
  obrasState.forEach((obra) => obrasListEl.appendChild(renderObraRow(obra)));
}

function renderObraRow(obra) {
  const row = document.createElement("div");
  row.className = "obra-row" + (obra.active ? "" : " obra-row--inactive");
  row.dataset.id = obra.id;

  row.innerHTML =
    '<span class="obra-row__icon">' +
    window.UI.glyph("flag", 16) +
    "</span>" +
    '<span class="obra-row__name">' + window.UI.escapeHtml(obra.name) + "</span>" +
    (obra.active
      ? ""
      : '<span class="obra-row__tag">Inativa</span>') +
    '<div class="obra-row__actions">' +
    '<button class="btn btn--ghost btn--sm obra-row__toggle" type="button">' +
    (obra.active ? "Desativar" : "Ativar") +
    "</button>" +
    '<button class="icon-btn obra-row__del" type="button" aria-label="Excluir obra" title="Excluir">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>' +
    "</button>" +
    "</div>";

  row.querySelector(".obra-row__toggle").addEventListener("click", () =>
    toggleObra(obra)
  );
  row.querySelector(".obra-row__del").addEventListener("click", () =>
    deleteObra(obra)
  );
  return row;
}

async function onAddObra(e) {
  e.preventDefault();
  const input = document.getElementById("obra-name");
  const btn = document.getElementById("obra-add");
  const name = input.value.trim();
  if (!name) {
    window.showToast("Informe o nome da obra.", "error");
    return;
  }
  // Prevent obvious duplicates (case-insensitive).
  if (obrasState.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
    window.showToast("Essa obra já está cadastrada.", "error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const sb = window.getSupabase();
    const { data, error } = await sb
      .from(window.APP_CONFIG.OBRAS_TABLE)
      .insert({ name, active: true })
      .select()
      .single();
    if (error) throw error;
    obrasState.push(data);
    obrasState.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    renderObras();
    input.value = "";
    input.focus();
    window.showToast("Obra cadastrada.", "success");
  } catch (err) {
    console.error(err);
    const dup = /duplicate|unique/i.test(err.message || "");
    window.showToast(
      dup ? "Essa obra já está cadastrada." : err.message || "Não foi possível salvar.",
      "error"
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Adicionar";
  }
}

async function toggleObra(obra) {
  const next = !obra.active;
  obra.active = next; // optimistic
  renderObras();
  try {
    const sb = window.getSupabase();
    const { error } = await sb
      .from(window.APP_CONFIG.OBRAS_TABLE)
      .update({ active: next })
      .eq("id", obra.id);
    if (error) throw error;
    window.showToast(next ? "Obra ativada." : "Obra desativada.", "success");
  } catch (err) {
    console.error(err);
    obra.active = !next; // rollback
    renderObras();
    window.showToast("Não foi possível atualizar.", "error");
  }
}

function deleteObra(obra) {
  window.UI.modal({
    title: "Excluir obra",
    bodyHTML:
      '<p style="margin:0;color:var(--text-2)">Excluir <strong>' +
      window.UI.escapeHtml(obra.name) +
      "</strong>? Os pedidos já lançados para essa obra não são afetados; " +
      "ela apenas deixa de aparecer na nova solicitação.</p>",
    confirmLabel: "Excluir",
    onConfirm: async () => {
      const sb = window.getSupabase();
      const { error } = await sb
        .from(window.APP_CONFIG.OBRAS_TABLE)
        .delete()
        .eq("id", obra.id);
      if (error) throw error;
      obrasState = obrasState.filter((o) => o.id !== obra.id);
      renderObras();
      window.showToast("Obra excluída.", "success");
    },
  });
}

function skeletonRows(n) {
  let html = "";
  for (let i = 0; i < n; i++) {
    html += '<div class="obra-row"><div class="sk-line" style="width:40%"></div></div>';
  }
  return html;
}

document.addEventListener("DOMContentLoaded", initSettings);
