/* =========================================================
   ui.js — Shared UI helpers (icons, time, toast, modal, skeleton)
   =========================================================
   Loaded on every authenticated page before the page script.
   Keeps dashboard.js / history.js lean and avoids duplication.
   Everything is attached to window.UI.
   ========================================================= */

(function () {
  "use strict";

  /* ------------- Apply saved theme immediately ----------- */
  try {
    const saved = localStorage.getItem("theme");
    if (saved) document.documentElement.setAttribute("data-theme", saved);
  } catch (_) {
    /* localStorage may be unavailable */
  }

  /* --------------------- Category icons ------------------ */
  // Small inline SVGs (no external dependency). Chosen by keyword
  // match against the AI-assigned category name.

  const ICONS = {
    eletrica:
      '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    hidraulica:
      '<path d="M12 2s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11Z"/>',
    construcao:
      '<path d="M3 10h18M3 10 7 4h10l4 6M3 10v10h18V10M9 20v-6h6v6"/>',
    ferramentas:
      '<path d="M14.7 6.3a4 4 0 0 1-5.2 5.2L4 17v3h3l5.5-5.5a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.1-.5-.5-2.1 2.7-2.5Z"/>',
    epi:
      '<path d="M5 10a7 7 0 0 1 14 0v3H5v-3ZM3 13h18v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2Z"/>',
    pintura:
      '<path d="M4 4h14v5H4V4Zm14 2h2v5h-7v3m0 0h2v7h-4v-7h2Z"/>',
    madeira:
      '<path d="M3 7h18M3 12h18M3 17h18M6 7v10M18 7v10"/>',
    vedacao:
      '<path d="M4 7h16v10H4V7Zm0 3h16M4 14h16"/>',
    quimico:
      '<path d="M9 2h6M10 2v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V2"/>',
    jardim:
      '<path d="M12 22V12M12 12C9 12 5 10 5 5c5 0 7 4 7 7Zm0 0c3 0 7-2 7-7-5 0-7 4-7 7Z"/>',
    generico:
      '<path d="M4 7l8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10"/>',
  };

  // Keyword → icon key. First match wins.
  const ICON_RULES = [
    [/el[ée]tric|el[eé]tr|cabo|fio|energia|il(u|ú)mina/i, "eletrica"],
    [/hidr[aá]ulic|[aá]gua|tubo|cano|conex|torneira|esgoto|pvc/i, "hidraulica"],
    [/constru|alvenaria|cimento|areia|brita|concreto|tijolo|bloco|argamassa/i, "construcao"],
    [/ferrament|broca|disco|furad|parafus|prego|chave\b/i, "ferramentas"],
    [/epi|prote|luva|capacete|[oó]culos|bota|cinto|seguran/i, "epi"],
    [/pintur|tinta|verniz|rolo|pincel|solvente/i, "pintura"],
    [/madeir|t[aá]bua|compensad|mdf|caibro|ripa/i, "madeira"],
    [/veda|impermeab|manta|silicone|selante/i, "vedacao"],
    [/qu[ií]mic|aditivo|cola|resina/i, "quimico"],
    [/jardim|paisag|grama|planta|terra\b/i, "jardim"],
  ];

  function categoryIconKey(category) {
    const c = String(category || "");
    for (const [re, key] of ICON_RULES) if (re.test(c)) return key;
    return "generico";
  }

  function categoryIcon(category, size) {
    const key = categoryIconKey(category);
    const s = size || 18;
    return (
      '<svg class="cat-icon" width="' +
      s +
      '" height="' +
      s +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' +
      ICONS[key] +
      "</svg>"
    );
  }

  /* ----------------- UI glyphs (stroked SVG) ------------- */
  // One visual language with the category icons: 1.8 stroke, round caps.
  const GLYPHS = {
    grip: '<path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/>',
    kebab: '<path d="M12 5h.01M12 12h.01M12 19h.01"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><path d="M4 22V4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  };

  function glyph(name, size, strokeWidth) {
    const s = size || 16;
    const sw = strokeWidth || 1.8;
    return (
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="' + sw + '" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (GLYPHS[name] || "") +
      "</svg>"
    );
  }

  /* --------------------- Time helpers -------------------- */

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function daysSince(iso) {
    if (!iso) return 0;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return 0;
    // Compare calendar days, not raw 24h windows.
    const a = startOfDay(new Date());
    const b = startOfDay(new Date(then));
    return Math.round((a - b) / MS_PER_DAY);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** "Hoje" | "Ontem" | "Há N dias". */
  function relativeDay(iso) {
    const d = daysSince(iso);
    if (d <= 0) return "Hoje";
    if (d === 1) return "Ontem";
    return "Há " + d + " dias";
  }

  /** Full date for tooltips: 22/10/2026 14:30. */
  function fullDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "";
    }
  }

  /* ----------------------- Escape ------------------------ */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ---------------------- Clipboard ---------------------- */

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  /* ------------------------ Toasts ----------------------- */
  // A stacked toast system with optional "Desfazer" action.

  function toastHost() {
    let host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      host.className = "toast-host";
      host.setAttribute("aria-live", "polite");
      document.body.appendChild(host);
    }
    return host;
  }

  /**
   * Show a toast.
   * @param {string} message
   * @param {object} [opts] { kind: ''|'success'|'error', duration, action: {label, onClick} }
   */
  function toast(message, opts = {}) {
    const host = toastHost();
    const el = document.createElement("div");
    el.className = "toast2" + (opts.kind ? " toast2--" + opts.kind : "");

    const icon =
      opts.kind === "success"
        ? glyph("check", 16, 2.2)
        : opts.kind === "error"
        ? glyph("alert", 16, 2)
        : "";
    el.innerHTML =
      (icon ? '<span class="toast2__icon">' + icon + "</span>" : "") +
      '<span class="toast2__msg">' +
      escapeHtml(message) +
      "</span>";

    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      el.classList.remove("toast2--show");
      el.addEventListener("transitionend", () => el.remove(), { once: true });
      // Fallback removal.
      setTimeout(() => el.remove(), 400);
    };

    if (opts.action && opts.action.label) {
      const btn = document.createElement("button");
      btn.className = "toast2__action";
      btn.textContent = opts.action.label;
      btn.addEventListener("click", () => {
        try {
          opts.action.onClick && opts.action.onClick();
        } finally {
          dismiss();
        }
      });
      el.appendChild(btn);
    }

    host.appendChild(el);
    void el.offsetWidth;
    el.classList.add("toast2--show");

    const duration = opts.duration || (opts.action ? 6000 : 3200);
    timer = setTimeout(dismiss, duration);

    return { dismiss };
  }

  /* ------------------------ Modal ------------------------ */

  /**
   * Open a modal.
   * @param {object} cfg { title, bodyHTML, confirmLabel, cancelLabel, onConfirm(form), onOpen(root) }
   * onConfirm receives the modal root element and may return false to keep it open,
   * or a Promise. Returning true/undefined closes it.
   */
  function modal(cfg) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' +
      escapeHtml(cfg.title || "Editar") +
      '">' +
      '<div class="modal__header">' +
      '<h2 class="modal__title">' +
      escapeHtml(cfg.title || "") +
      "</h2>" +
      '<button class="modal__close" type="button" aria-label="Fechar">✕</button>' +
      "</div>" +
      '<div class="modal__body">' +
      (cfg.bodyHTML || "") +
      "</div>" +
      '<div class="modal__footer">' +
      '<button class="btn btn--secondary modal__cancel" type="button">' +
      escapeHtml(cfg.cancelLabel || "Cancelar") +
      "</button>" +
      '<button class="btn btn--primary modal__confirm" type="button">' +
      escapeHtml(cfg.confirmLabel || "Salvar") +
      "</button>" +
      "</div>" +
      "</div>";

    const close = () => {
      overlay.classList.remove("modal-overlay--show");
      setTimeout(() => overlay.remove(), 220);
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };

    overlay.querySelector(".modal__close").addEventListener("click", close);
    overlay.querySelector(".modal__cancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);

    const confirmBtn = overlay.querySelector(".modal__confirm");
    confirmBtn.addEventListener("click", async () => {
      if (!cfg.onConfirm) return close();
      confirmBtn.disabled = true;
      const original = confirmBtn.innerHTML;
      confirmBtn.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await cfg.onConfirm(overlay);
        if (res === false) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = original;
          return;
        }
        close();
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = original;
        toast((err && err.message) || "Não foi possível salvar.", {
          kind: "error",
        });
      }
    });

    document.body.appendChild(overlay);
    void overlay.offsetWidth;
    overlay.classList.add("modal-overlay--show");

    // Focus first field.
    const first = overlay.querySelector("input, textarea, select, button");
    if (first) first.focus();
    if (cfg.onOpen) cfg.onOpen(overlay);

    return { close, root: overlay };
  }

  /* ---------------------- Skeletons ---------------------- */

  function skeletonBoard(nCols = 3, nCards = 3) {
    let html = "";
    for (let c = 0; c < nCols; c++) {
      let cards = "";
      for (let i = 0; i < nCards; i++) {
        cards +=
          '<div class="sk-card">' +
          '<div class="sk-line sk-line--title"></div>' +
          '<div class="sk-line sk-line--sm"></div>' +
          '<div class="sk-line sk-line--xs"></div>' +
          "</div>";
      }
      html +=
        '<div class="column sk-col">' +
        '<div class="column__header"><div class="sk-line sk-line--head"></div></div>' +
        '<div class="column__body">' +
        cards +
        "</div></div>";
    }
    return html;
  }

  /* ------------------------ Export ----------------------- */

  window.UI = {
    categoryIcon,
    categoryIconKey,
    glyph,
    daysSince,
    relativeDay,
    fullDate,
    escapeHtml,
    copyToClipboard,
    toast,
    modal,
    skeletonBoard,
  };
})();
