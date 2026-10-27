/* =========================================================
   auth.js — Supabase email/password authentication
   =========================================================
   - getSupabase(): single shared Supabase client.
   - requireAuth(): redirects to login.html if not signed in;
     otherwise renders the signed-in user's email + a logout
     button into the topbar. Returns the session user.
   - initLoginForm(): wires the login.html form.

   Loaded on every page (before app.js / dashboard.js).
   ========================================================= */

/** Lazily create and cache a single Supabase client. */
function getSupabase() {
  if (window.__supabase) return window.__supabase;
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
  window.__supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
  return window.__supabase;
}
window.getSupabase = getSupabase;

/**
 * Guard a protected page. Redirects to login.html when there is
 * no active session. Returns the authenticated user (or null if
 * it redirected / config is missing).
 */
async function requireAuth() {
  if (!window.isConfigured()) {
    // Config missing — let the page show its own banner, don't redirect.
    return null;
  }
  const sb = getSupabase();
  const {
    data: { session },
  } = await sb.auth.getSession();

  if (!session) {
    const back = encodeURIComponent(
      location.pathname.split("/").pop() || "index.html"
    );
    location.replace("login.html?next=" + back);
    return null;
  }

  renderUserMenu(session.user);

  // If the user signs out in another tab, bounce to login.
  sb.auth.onAuthStateChange((_event, s) => {
    if (!s) location.replace("login.html");
  });

  return session.user;
}
window.requireAuth = requireAuth;

/** Render the signed-in email + logout button into #user-menu. */
function renderUserMenu(user) {
  const host = document.getElementById("user-menu");
  if (!host) return;
  host.innerHTML = "";

  const email = document.createElement("span");
  email.className = "topbar__user";
  email.textContent = user.email || "Conectado";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--ghost btn--sm";
  btn.textContent = "Sair";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    await getSupabase().auth.signOut();
    location.replace("login.html");
  });

  host.appendChild(email);
  host.appendChild(btn);
}

/** Wire the login form on login.html. */
function initLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;

  const configured = window.isConfigured();
  if (!configured) {
    const host = document.getElementById("config-banner");
    if (host) {
      const b = document.createElement("div");
      b.className = "banner";
      b.innerHTML =
        "⚙️ Configuração pendente. Edite <code>config.js</code> com " +
        "<code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code>.";
      host.appendChild(b);
    }
  }

  // Already signed in? Skip the form.
  if (configured) {
    getSupabase()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (session) location.replace(nextTarget());
      });
  }

  const btn = document.getElementById("login-btn");
  const errEl = document.getElementById("login-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!configured) return;

    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) {
      showError("Informe e-mail e senha.");
      return;
    }

    setLoading(true);
    hideError();
    try {
      const { error } = await getSupabase().auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      location.replace(nextTarget());
    } catch (err) {
      showError(translateAuthError(err));
      setLoading(false);
    }
  });

  function setLoading(on) {
    btn.disabled = on;
    btn.innerHTML = on
      ? '<span class="spinner"></span><span>Entrando…</span>'
      : "Entrar";
  }
  function showError(msg) {
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.style.display = "block";
  }
  function hideError() {
    if (errEl) errEl.style.display = "none";
  }
}
window.initLoginForm = initLoginForm;

/** Where to go after a successful login (?next=...). */
function nextTarget() {
  const params = new URLSearchParams(location.search);
  const next = params.get("next");
  // Only allow same-folder targets to avoid open-redirects.
  if (next && /^[a-zA-Z0-9._-]+\.html$/.test(next)) return next;
  return "index.html";
}

/** Friendlier messages for common Supabase auth errors. */
function translateAuthError(err) {
  const msg = (err && err.message) || "";
  if (/invalid login credentials/i.test(msg)) {
    return "E-mail ou senha incorretos.";
  }
  if (/email not confirmed/i.test(msg)) {
    return "E-mail ainda não confirmado.";
  }
  return msg || "Não foi possível entrar.";
}

document.addEventListener("DOMContentLoaded", initLoginForm);
