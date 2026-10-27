# Sistema de Solicitação e Gestão de Compras de Materiais de Obra

Aplicação **frontend-only** (HTML + CSS + JavaScript vanilla) para solicitar materiais
de obra em texto livre, estruturá-los com a **API do Google Gemini** e gerenciá-los em um
**painel Kanban** estilo Trello. Os dados ficam no **Supabase**, com **login (e-mail + senha)**
e a chave do Gemini protegida em uma **Edge Function**. Pronto para **GitHub Pages**.

## Arquivos

| Arquivo | Função |
| --- | --- |
| `login.html` | Tela de login (e-mail + senha). |
| `index.html` | Tela de solicitação (formulário). |
| `dashboard.html` | Painel Kanban de compras. |
| `history.html` | Histórico de itens comprados. |
| `style.css` | Design system neutro, estilo Apple. |
| `config.js` | `SUPABASE_URL` + anon key (públicas, protegidas por RLS). |
| `auth.js` | Login, guarda de sessão e logout. |
| `ui.js` | Helpers compartilhados: ícones de categoria (SVG), tempo amigável, toasts, modal, skeletons, tema. |
| `app.js` | Helpers + nova solicitação + chamada à Edge Function. |
| `dashboard.js` | Painel: busca, filtros, resumo, drag & drop, menu do card, edição, desfazer. |
| `history.js` | Histórico com busca e filtros de período. |
| `supabase-schema.sql` | Tabela + RLS (somente autenticados). |
| `supabase/functions/analyze-materials/index.ts` | Edge Function que chama o Gemini no servidor. |

## Como as chaves ficam protegidas

- **`SUPABASE_URL` + anon key** ficam no `config.js` (visíveis no navegador). Isso é seguro:
  o acesso é bloqueado por **RLS** e por **login**. Sem conta, ninguém lê ou grava nada.
- **Chave do Gemini** NÃO fica no frontend. Ela é um **secret** dentro da Edge Function
  `analyze-materials`. O navegador só chama sua própria função (autenticado), e a função
  chama o Gemini. A chave nunca chega ao browser.

## Configuração

### 1. Supabase — banco e RLS

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **SQL Editor**, execute `supabase-schema.sql`.
3. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.

### 2. Usuários (login)

1. **Authentication → Providers → Email**: mantenha habilitado.
   (Opcional: desative "Confirm email" para criar contas sem precisar confirmar e-mail.)
2. **Authentication → Users → Add user**: crie cada usuário com e-mail e senha.
   É assim que você controla quem entra — não há cadastro aberto no app.

### 3. Edge Function (esconde a chave do Gemini)

Instale o Supabase CLI (precisa uma vez):

```powershell
# via npm
npm install -g supabase
# ou via winget
winget install Supabase.CLI
```

Depois, na pasta do projeto:

```powershell
supabase login
supabase link --project-ref SEU_PROJECT_REF   # o ref está na URL do projeto

# Guarde a chave do Gemini como secret (NÃO vai pro navegador):
supabase secrets set GEMINI_API_KEY=suachavegemini
supabase secrets set GEMINI_MODEL=gemini-2.0-flash   # opcional

# Publique a função:
supabase functions deploy analyze-materials
```

Gere a chave do Gemini em [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

### 4. Preencher `config.js`

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "sua-anon-key",
  GEMINI_FUNCTION: "analyze-materials",
  TABLE: "purchase_items",
};
```

## Rodar localmente

O app faz `fetch`, então sirva por HTTP (não abra via `file://`):

```powershell
python -m http.server 5500
# ou: npx serve .
```

Acesse `http://localhost:5500/login.html`.

## Publicar no GitHub Pages

1. Faça push dos arquivos (o site estático). A Edge Function já está hospedada no Supabase.
2. **Settings → Pages → Source: Deploy from a branch** → branch `main`, pasta `/root`.
3. (Recomendado) Em **Supabase → Authentication → URL Configuration**, adicione o domínio
   do GitHub Pages em **Site URL / Redirect URLs**.

## Fluxo de uso

1. **Login** (`login.html`): entre com e-mail e senha criados no painel do Supabase.
2. **Solicitar** (`index.html`): obra, observação, lista livre de materiais e urgência.
   A Edge Function estrutura via IA e cada item é salvo com status **"Novo Pedido"**.
3. **Painel** (`dashboard.html`): colunas por categoria; cards com material, quantidade,
   obra, observação e tag de urgência. **"Pedido Feito"** → status **"Comprado"** e some do painel.
4. **Histórico** (`history.html`): itens comprados, agrupados por data, com busca e
   opção de **Reabrir** (volta pro painel).

## Observações de segurança

- RLS já restringe tudo a usuários autenticados. Visitantes anônimos não acessam nada.
- Todos os usuários logados compartilham o mesmo painel (ferramenta de equipe). Para
  isolar por usuário, troque as policies para comparar `created_by = auth.uid()`.
- A Edge Function só responde a chamadas com token de usuário válido do Supabase.
