// =========================================================
// Supabase Edge Function: analyze-materials
// ---------------------------------------------------------
// Keeps the Google Gemini API key on the server. The browser
// never sees it — it only calls this function (with the user's
// Supabase auth token). The function:
//   1. Verifies the caller is an authenticated Supabase user.
//   2. Calls Gemini with the free-text material list.
//   3. Returns structured, categorized items as JSON.
//
// Deploy:
//   supabase functions deploy analyze-materials
// Set the secret (NOT exposed to the browser):
//   supabase secrets set GEMINI_API_KEY=xxxxx
//   supabase secrets set GEMINI_MODEL=gemini-flash-latest  (optional)
// =========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const SYSTEM_INSTRUCTION = [
  "Você é um comprador de obras experiente. Leia a lista de materiais em",
  "texto livre e devolva cada material de forma estruturada.",
  "",
  "CLASSIFICAÇÃO DA CATEGORIA (muito importante):",
  "Identifique a FAMÍLIA do material e use SEMPRE uma destas categorias",
  "padronizadas, escritas exatamente assim:",
  "- Material Elétrico (cabo, fio, disjuntor, tomada, eletroduto, interruptor, luminária)",
  "- Material Hidráulico (tubo, cano, joelho, conexão, registro, torneira, esgoto, PVC)",
  "- Material de Construção (cimento, areia, brita, argamassa, tijolo, bloco, cal, concreto)",
  "- EPI (luva, capacete, óculos de proteção, bota, cinto, protetor)",
  "- Ferramentas (broca, disco, furadeira, parafuso, prego, chave, martelo)",
  "- Pintura (tinta, verniz, rolo, pincel, solvente, massa corrida)",
  "- Madeira (tábua, compensado, MDF, caibro, ripa, sarrafo)",
  "- Impermeabilização (manta, silicone, selante, aditivo impermeável)",
  "Se o material se encaixar em uma dessas famílias, use a categoria exata.",
  "NUNCA crie variações do mesmo nome (ex.: 'Elétrica', 'Materiais Elétricos',",
  "'Elétricos' são todos 'Material Elétrico'). Prefira sempre o nome padronizado.",
  "Você pode usar outra categoria APENAS se nenhuma acima servir e ela for",
  "claramente uma família distinta.",
  "Se NÃO tiver segurança sobre a categoria, use exatamente \"Não identificado\".",
  "Nunca invente uma categoria só para não deixar em branco.",
  "",
  "QUANTIDADE:",
  "Extraia a quantidade com a unidade quando houver (ex.: \"100 m\", \"6 un\",",
  "\"20 sacos\", \"5 pares\"). Se não houver quantidade, use \"A definir\".",
  "",
  "ITENS EQUIVALENTES (seja CONSERVADOR):",
  "Dentro desta mesma solicitação, se dois trechos descreverem EXATAMENTE o",
  "mesmo material (mesmas especificações; apenas grafia/espaços diferentes),",
  "uníficque em um único item e some as quantidades SOMENTE quando a unidade",
  "for a mesma (ex.: 50 m + 30 m = 80 m). Exemplo: \"50m cabo PP 3x2,5\" e",
  "\"30 metros cabo PP 3 x 2,5mm\" => um item \"Cabo PP 3x2,5 mm\", 80 m.",
  "NÃO una materiais diferentes só por serem da mesma categoria: \"Cabo 2,5mm\"",
  "e \"Cabo 4mm\" são itens DIFERENTES. Se as unidades forem incompatíveis",
  "(ex.: unidades vs caixas) NÃO some; mantenha itens separados.",
  "Na dúvida, mantenha separado — o usuário pode juntar manualmente depois.",
  "",
  "OBSERVAÇÃO (separe do material):",
  "O texto pode conter instruções que NÃO são materiais — por exemplo:",
  "\"entregar conforme liberação da obra\", \"retirar pela manhã\", \"falar com",
  "o João\", \"urgente para segunda\", \"nota em nome da empresa X\". Essas frases",
  "NÃO devem virar itens. Coloque-as no campo \"observation\".",
  "- Se a observação se aplica ao pedido todo, repita o mesmo texto no campo",
  "  \"observation\" de todos os itens.",
  "- Se a observação se refere claramente a um item específico, coloque apenas",
  "  no \"observation\" daquele item.",
  "- Se não houver observação, use string vazia \"\".",
  "Nunca invente observações; extraia apenas o que estiver no texto.",
  "",
  "Normalize nomes para português claro e conciso.",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          category: { type: "STRING" },
          name: { type: "STRING" },
          quantity: { type: "STRING" },
          observation: { type: "STRING" },
        },
        required: ["category", "name", "quantity"],
      },
    },
  },
  required: ["items"],
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Método não permitido." }, 405);
  }

  // --- 1) Authenticate the caller ---
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Não autenticado." }, 401);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return json({ error: "Sessão inválida." }, 401);
    }

    // --- 2) Read input ---
    const { materials } = await req.json().catch(() => ({ materials: "" }));
    const raw = String(materials ?? "").trim();
    if (!raw) {
      return json({ error: "Lista de materiais vazia." }, 400);
    }

    // --- 3) Call Gemini (key stays server-side) ---
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return json({ error: "GEMINI_API_KEY não configurada no servidor." }, 500);
    }
    // Try a list of models in order. GEMINI_MODEL (if set) goes first,
    // then stable fallbacks that this project's key is known to support.
    // This protects against a single model being overloaded (503) or
    // unavailable (404) for this API key.
    // Prefer the lighter/faster "flash-lite" models first for this simple
    // extraction task; fall back to the fuller flash models if needed.
    const configured = Deno.env.get("GEMINI_MODEL");
    const candidates = [
      configured,
      "gemini-flash-lite-latest",
      "gemini-3.5-flash-lite",
      "gemini-flash-latest",
      "gemini-3.5-flash",
    ].filter((m, i, arr): m is string => !!m && arr.indexOf(m) === i);

    const requestBody = JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Lista de materiais (texto livre):\n\n" +
                raw +
                "\n\nRetorne a lista estruturada.",
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let lastStatus = 0;
    let lastDetail = "";
    let geminiRes: Response | null = null;

    outer: for (const m of candidates) {
      const endpoint =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(m) +
        ":generateContent";

      // Up to 2 attempts per model, with backoff on transient errors.
      for (let attempt = 0; attempt < 2; attempt++) {
        // New-format keys (prefix "AQ.") must be sent in the
        // x-goog-api-key header, not as a ?key= query param.
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: requestBody,
        });

        if (res.ok) {
          geminiRes = res;
          break outer;
        }

        lastStatus = res.status;
        lastDetail = await res.text();

        // 503 (overloaded) / 429 (rate limit) => wait and retry same model.
        if (res.status === 503 || res.status === 429) {
          await sleep(700 * (attempt + 1));
          continue;
        }
        // 404 (model not found/unavailable) => try the next model.
        if (res.status === 404) break;
        // Other errors => stop.
        break outer;
      }
    }

    if (!geminiRes) {
      return json(
        {
          error: "Falha na API Gemini (" + lastStatus + ")",
          detail: lastDetail,
          triedModels: candidates,
        },
        502
      );
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return json({ error: "A IA não retornou conteúdo analisável." }, 502);
    }

    let parsed: { items?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = JSON.parse(String(text).replace(/```json|```/g, "").trim());
    }

    const items = (Array.isArray(parsed?.items) ? parsed.items : [])
      .filter((it: any) => it && String(it.name ?? "").trim())
      .map((it: any) => ({
        category: String(it.category ?? "Outros").trim(),
        name: String(it.name ?? "").trim(),
        quantity: String(it.quantity ?? "A definir").trim(),
        observation: String(it.observation ?? "").trim(),
      }));

    return json({ items });
  } catch (err) {
    return json({ error: (err as Error).message ?? "Erro interno." }, 500);
  }
});
