/* =========================================================
   Configuration
   ---------------------------------------------------------
   This is a frontend-only app, so anything here is visible in
   the browser. That's fine for these two values:

   - SUPABASE_URL and the PUBLIC "anon" key are designed to be
     exposed. Access is protected by Row Level Security (RLS)
     and by login (email + password) — see supabase-schema.sql.

   The Google Gemini key is NOT here: it lives as a server-side
   secret inside the "analyze-materials" Supabase Edge Function,
   so it never reaches the browser.
   ========================================================= */

window.APP_CONFIG = {
  // --- Supabase ---
  // Project URL, e.g. https://xxxxxxxx.supabase.co
  SUPABASE_URL: "https://xcisqoviyjtvfpkbwoec.supabase.co",
  // Public "publishable" key (safe to expose when RLS + auth are enabled)
  SUPABASE_ANON_KEY: "sb_publishable_F363i1W9fNu48zA60lKs1g_zL_7mQL_",

  // Edge Function that proxies Gemini (keeps the API key secret)
  GEMINI_FUNCTION: "analyze-materials",

  // Table name in Supabase
  TABLE: "purchase_items",
  // Table that stores the manual order of the category columns
  CATEGORY_ORDER_TABLE: "category_order",
  // Table of registered obras (construction sites)
  OBRAS_TABLE: "obras",
};

/** Returns true when the required Supabase keys look configured. */
window.isConfigured = function isConfigured() {
  const c = window.APP_CONFIG || {};
  return (
    c.SUPABASE_URL &&
    !c.SUPABASE_URL.startsWith("YOUR_") &&
    c.SUPABASE_ANON_KEY &&
    !c.SUPABASE_ANON_KEY.startsWith("YOUR_")
  );
};
