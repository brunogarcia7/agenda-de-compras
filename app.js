/* =========================================================
   app.js — Shared helpers + Requisition form (index.html)
   =========================================================
   - analyzeMaterials(): calls the "analyze-materials" Supabase
     Edge Function, which runs Gemini server-side (the Gemini
     key never reaches the browser).
   - Requisition form submit on index.html:
       * structure the free text via the Edge Function,
       * save each item to Supabase with status "Novo Pedido".

   Auth + getSupabase() live in auth.js (loaded first).
   ========================================================= */

/* --------------- AI (via Edge Function) ------------------ */

/**
 * Structure a free-text material list by calling the Supabase
 * Edge Function (which invokes Gemini securely).
 *
 * @param {string} rawMaterials
 * @returns {Promise<Array<{category:string,name:string,quantity:string}>>}
 */
async function analyzeMaterials(rawMaterials) {
  const sb = window.getSupabase();
  const { data, error } = await sb.functions.invoke(
    window.APP_CONFIG.GEMINI_FUNCTION,
    { body: { materials: rawMaterials } }
  );

  if (error) {
    // Try to surface the function's JSON error body if present.
    let detail = error.message || "Falha ao chamar a IA.";
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === "function") {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
        // Surface the Gemini detail for easier diagnosis.
        if (body?.detail) {
          console.error("Gemini detail:", body.detail, body.triedModels);
        }
      }
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail);
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  return items
    .filter((it) => it && String(it.name || "").trim())
    .map((it) => ({
      category: String(it.category || "Outros").trim(),
      name: String(it.name || "").trim(),
      quantity: String(it.quantity || "A definir").trim(),
      observation: String(it.observation || "").trim(),
    }));
}
window.analyzeMaterials = analyzeMaterials;

/* ----------------------- UI helpers ---------------------- */

/** Backward-compatible toast that delegates to the shared UI.toast. */
function showToast(message, kind = "", opts = {}) {
  if (window.UI && window.UI.toast) {
    return window.UI.toast(message, { kind, ...opts });
  }
  // Fallback (should not happen once ui.js is loaded).
  console[kind === "error" ? "error" : "log"](message);
}
window.showToast = showToast;

/** Mount the mobile nav burger toggle (shared across pages). */
function initNav() {
  const burger = document.getElementById("nav-burger");
  const links = document.getElementById("nav-links");
  if (burger && links) {
    burger.addEventListener("click", () =>
      links.classList.toggle("topbar__nav--open")
    );
  }
}
window.initNav = initNav;

/** Render the config banner if keys are missing. Returns configured state. */
function ensureConfigBanner(containerId) {
  if (window.isConfigured()) return true;
  const host = document.getElementById(containerId);
  if (host) {
    const b = document.createElement("div");
    b.className = "banner";
    b.innerHTML =
      "⚙️ Configuração pendente. Edite <code>config.js</code> e informe " +
      "<code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code>.";
    host.prepend(b);
  }
  return false;
}
window.ensureConfigBanner = ensureConfigBanner;

/* ------------------- Requisition form -------------------- */

async function initRequisitionForm() {
  const form = document.getElementById("requisition-form");
  if (!form) return; // Not on index.html

  const configured = ensureConfigBanner("config-banner");
  if (!configured) return;

  // Guard: must be logged in. Redirects to login if not.
  const user = await window.requireAuth();
  if (!user) return;

  initNav();

  const submitBtn = document.getElementById("submit-btn");
  const reviewHost = document.getElementById("review");

  // Populate the obra select with the registered (active) obras.
  loadObraOptions();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const obra = form.obra.value.trim();
    const materiais = form.materiais.value.trim();
    const urgenciaInput = form.querySelector('input[name="urgencia"]:checked');
    const urgencia = urgenciaInput ? urgenciaInput.value : "";

    if (!obra) return showToast("Selecione a obra.", "error");
    if (!materiais) return showToast("Descreva os materiais.", "error");
    if (!urgencia) return showToast("Selecione a urgência.", "error");

    setLoading(true, "Organizando materiais…");

    try {
      // 1) Structure with the Edge Function (Gemini server-side).
      const items = await analyzeMaterials(materiais);

      if (!items.length) {
        setLoading(false);
        return showToast(
          "A IA não identificou materiais. Revise o texto.",
          "error"
        );
      }

      // 2) Persist to Supabase with status "Novo Pedido".
      setLoading(true, "Salvando na agenda…");

      const batchId =
        (crypto.randomUUID && crypto.randomUUID()) ||
        "req-" + Date.now() + "-" + Math.random().toString(16).slice(2);

      const rows = items.map((it) => ({
        batch_id: batchId,
        obra,
        // The IA separates observations from materials and returns one per item.
        observacao: it.observation || "",
        category: it.category,
        name: it.name,
        quantity: it.quantity,
        urgency: urgencia,
        status: "Novo Pedido",
      }));

      const sb = window.getSupabase();
      const { error } = await sb.from(window.APP_CONFIG.TABLE).insert(rows);
      if (error) throw error;

      renderReview(items);
      form.reset();
      showToast("Materiais adicionados à sua agenda de compras.", "success", {
        action: {
          label: "Ver compras",
          onClick: () => (location.href = "dashboard.html"),
        },
      });
    } catch (err) {
      console.error(err);
      showToast(err.message || "Erro ao interpretar os materiais.", "error");
    } finally {
      setLoading(false);
    }
  });

  function setLoading(isLoading, label) {
    submitBtn.disabled = isLoading;
    if (isLoading) {
      submitBtn.innerHTML =
        '<span class="ai-loading"><span class="ai-loading__dots">' +
        "<span></span><span></span><span></span></span>" +
        "<span>" +
        (label || "Organizando materiais…") +
        "</span></span>";
    } else {
      submitBtn.innerHTML =
        '<span class="btn__ai" aria-hidden="true">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg>' +
        "</span><span>Organizar pedido</span>";
    }
  }

  async function loadObraOptions() {
    const sel = document.getElementById("obra");
    if (!sel) return;
    try {
      const sb = window.getSupabase();
      const { data, error } = await sb
        .from(window.APP_CONFIG.OBRAS_TABLE)
        .select("name, active")
        .eq("active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      const obras = (data || []).map((o) => (o.name || "").trim()).filter(Boolean);

      if (!obras.length) {
        sel.innerHTML = '<option value="">Nenhuma obra cadastrada</option>';
        // Point the user to Settings to register obras.
        showToast(
          "Cadastre uma obra em Configurações para começar.",
          "",
          { action: { label: "Abrir", onClick: () => (location.href = "config.html") } }
        );
        return;
      }

      sel.innerHTML =
        '<option value="">Selecione a obra…</option>' +
        obras
          .map((o) => '<option value="' + escapeHtml(o) + '">' + escapeHtml(o) + "</option>")
          .join("");
    } catch (err) {
      console.error(err);
      sel.innerHTML = '<option value="">Erro ao carregar obras</option>';
    }
  }

  function renderReview(items) {
    if (!reviewHost) return;
    const byCat = groupBy(items, (i) => i.category);
    const icon = (c) => (window.UI ? window.UI.categoryIcon(c, 16) : "");
    let html = '<h2 class="field__label" style="margin-top:8px">Organizado pela IA</h2>';
    for (const [cat, list] of Object.entries(byCat)) {
      html +=
        '<div class="review__group"><div class="review__group-head">' +
        icon(cat) +
        "<span>" +
        escapeHtml(cat) +
        "</span></div>";
      for (const it of list) {
        html +=
          '<div class="review__item"><span>' +
          escapeHtml(it.name) +
          '</span><span class="review__item-qty">' +
          escapeHtml(it.quantity) +
          "</span></div>";
      }
      html += "</div>";
    }
    reviewHost.innerHTML = html;
  }
}

/* ----------------------- Utilities ----------------------- */

function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item);
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}
window.groupBy = groupBy;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
window.escapeHtml = escapeHtml;

/* ------------------------- Boot -------------------------- */

document.addEventListener("DOMContentLoaded", initRequisitionForm);
