# AUDIT_01_ARCHITECTURE.md

**DialerJazz — Production-Level Architecture Audit**
*Prepared for onboarding a new senior engineer. Inspection-only; no code was modified.*

---

## 1. Overall Architecture

DialerJazz is an **open-source power dialer** (a "Tinder-for-sales-calls" outbound CRM) built as a **monorepo with two deployable units**:

- **`client/`** — A Vite + React 19 single-page application (SPA). This is the entire user-facing product: lead browsing, campaign management, the gamified swipe-to-dial UI, call controls, and connector configuration.
- **`server/`** — A Node.js + Express + TypeScript REST API. It is a **thin BFF (Backend-for-Frontend)** that does *not* own a database engine. Instead it delegates all persistence and authentication to **InsForge**, a Backend-as-a-Service (BaaS) that exposes PostgreSQL over a PostgREST-compatible HTTP API via the `@insforge/sdk`.

The defining architectural decision: **there is no direct database driver in the app code.** Every route obtains a per-request, RLS-scoped InsForge client (`req.db.database.from('table')...`) and issues PostgREST queries. Auth, storage, and realtime are also provided by InsForge. This makes the server effectively a **policy/validation/orchestration layer** on top of a managed Postgres.

Telephony is **provider-agnostic** on the client: a unified `VoiceContext` delegates to either a **Telnyx WebRTC** client or a **Twilio Voice SDK** client. The server's only telephony responsibility is minting provider tokens (Telnyx SIP credentials / Twilio access tokens) and hosting Twilio's TwiML webhook.

```
┌──────────────┐      /api (CORS)      ┌──────────────────┐   PostgREST/HTTP   ┌─────────────────┐
│  client (SPA)│ ─────────────────────▶│  server (Express) │ ────────────────▶ │   InsForge      │
│  React + Vite│ ◀─────────────────────│  validation, auth │ ◀──────────────── │ (Postgres + Auth│
└──────┬───────┘      JSON             └──────────────────┘                   │  + Storage + RLS)│
       │                                                                       └─────────────────┘
       │ WebRTC (SIP / Twilio)                                                                 │
       └───────────────────────────────────────────────────────────────────────────────────────▶ Telnyx / Twilio cloud
```

---

## 2. Folder Structure

```
dialerjazz/
├── .env.example                 # Template env (InsForge + Vite + JWT)
├── package.json                 # Root: only `concurrently` devDep; scripts run both apps
├── Dockerfile                   # Multi-stage: builds client, runs server via tsx
├── README.md / CONTRIBUTING.md / SECURITY.md / AGENTS.md / insforge.md
├── client/                      # Frontend SPA
│   ├── index.html
│   ├── vite.config.ts           # Dev server on :5173, proxies /api → :3001
│   ├── package.json
│   └── src/
│       ├── main.tsx             # React root
│       ├── App.tsx              # Router + ProtectedLayout (mounts Telnyx/Twilio/Voice providers)
│       ├── lib/
│       │   ├── insforge.ts       # InsForge SDK client (VITE_ vars)
│       │   ├── api.ts            # Authenticated fetch wrapper (token cache + 401 refresh)
│       │   └── utils.ts
│       ├── contexts/
│       │   ├── AuthContext.tsx   # InsForge sign-in/sign-up/session
│       │   ├── TelnyxContext.tsx # Telnyx WebRTC device
│       │   ├── TwilioContext.tsx # Twilio Voice SDK device
│       │   └── VoiceContext.tsx  # Unified provider-agnostic voice abstraction
│       ├── hooks/               # useDevices, useLocalCalling, usePagination, useTelnyxCall
│       ├── components/          # UI: CallControls, Dialer cards, CampaignCard, etc. + ui/ (shadcn-style)
│       └── pages/               # Login, Dashboard, Leads, Campaigns, CampaignDialer, ManualDialer, CallLogs, Connectors, Settings
└── server/                      # Backend API
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts             # Express app bootstrap, middleware, route mounting, Socket.io
    │   ├── lib/insforge.ts       # Server-side InsForge client factory (lazy env read)
    │   ├── middleware/
    │   │   ├── auth.ts           # JWT decode + inject RLS-scoped InsForge client
    │   │   └── errorHandler.ts   # Centralized ApiError / ZodError handling
    │   └── routes/
    │       ├── leads.ts  campaigns.ts  calls.ts  stats.ts
    │       ├── settings.ts  twilio.ts  telnyx.ts
    │       └── __tests__/        # Vitest unit tests (mocked InsForge client)
    └── migrate_twilio.ts         # One-off SQL migration runner (uses InsForge SDK)
```

---

## 3. Technologies Used

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, TypeScript 5.9, React Router 7, Tailwind CSS 3.4, Framer Motion, Radix UI primitives, lucide-react, sonner (toasts), papaparse (CSV) |
| Voice (client) | `@telnyx/webrtc`, `@twilio/voice-sdk` |
| Backend | Node 22, Express 4, TypeScript 5.9, `tsx` (ESM dev runner), Zod (validation), jsonwebtoken, dotenv, multer, papaparse, socket.io, cors, express-rate-limit |
| BaaS / Data | **InsForge** (`@insforge/sdk`) — PostgreSQL + PostgREST, Auth, Storage, Realtime |
| Telephony (cloud) | Telnyx (WebRTC/SIP), Twilio (Voice SDK + TwiML) |
| Testing | Vitest, supertest |
| Build/Deploy | Docker (multi-stage), npm `concurrently` for local dev |

> Note: The installed `@insforge/sdk@1.2.2` uses extensionless relative imports that Node's native ESM loader rejects; the project runs it via `tsx`, which resolves them. (Latest SDK is 1.4.4.)

---

## 4. Entry Points

**Client:** `client/src/main.tsx` mounts `<App/>` from `client/src/App.tsx`. `App.tsx` defines the router and a `ProtectedLayout` that wraps all authenticated routes and mounts `TelnyxProvider` + `TwilioProvider` + `VoiceContextProvider` so the WebRTC socket survives navigation. Dev server entry is `npm run dev` (root) → `concurrently` runs `dev:client` (Vite :5173) and `dev:server` (tsx :3001).

**Server:** `server/src/index.ts` is the entry. It:
1. Loads `.env` from the **repo root** (`../.env`) in non-production (so the API server reads the root `.env`, not `server/.env`).
2. Builds the Express app, mounts CORS, JSON body parsing (50mb limit), rate limiting, and the `/api/*` routers.
3. Creates a Socket.io server (currently used only for connection logging; no business logic wired to it).
4. Listens on `PORT` (default 3001). In production it also serves `client/dist` as static files with an SPA catch-all.

---

## 5. Request Flow

1. Browser calls `VITE_API_URL` (default `/api`). In dev, Vite proxies `/api` → `http://localhost:3001`.
2. `index.ts` applies a global `apiLimiter` (100 req/min/IP) and mounts routers under `/api`.
3. Authenticated routers call `requireAuth` (middleware/auth.ts):
   - Reads `Authorization: Bearer <jwt>`.
   - Decodes the JWT (`sub` = user id, `email`, `role`) — **signature is NOT verified server-side**; cryptographic validation is delegated to InsForge when the DB client makes a request.
   - Creates an InsForge client seeded with the user's token and attaches it as `req.db` (enables Row-Level Security scoping).
4. The handler issues PostgREST queries via `req.db.database.from(...)`.
5. Errors are centralized in `errorHandler.ts`: `ApiError` → status+code JSON; `ZodError` → 400 with field details; anything else → 500.
6. Client `api.ts` wraps `fetch`, caches the access token, and on 401 attempts one `refreshSession()` before retrying.

---

## 6. Database Flow

- **No ORM, no raw SQL driver in app code.** All access is through `@insforge/sdk`'s PostgREST client (`req.db.database`).
- Tables referenced by the code: `leads`, `campaigns`, `campaign_leads` (junction), `user_settings`, `call_logs`, `auth.users` (managed by InsForge).
- **Row-Level Security (RLS):** every query filters by `user_id = req.user.id`. The InsForge client carries the user JWT, so the PostgREST layer enforces tenancy server-side.
- **Upserts:** leads use `upsert(rows, { onConflict: 'user_id,phone' })` to dedupe globally per user.
- **Aggregates:** `stats.ts` and `calls.ts` run parallel `count: 'exact', head: true` queries because PostgREST doesn't easily do multi-table aggregates in one call.
- **Campaign progress counter:** `calls.ts` calls an RPC `increment_campaign_calls(p_campaign_id)` to avoid read-modify-write races when marking a lead called. (This function and the `call_logs` table must exist in the InsForge project — they are not created by the app's own migrations; see risks.)
- **Schema management:** there is **no migration framework in the repo**. `server/migrate_twilio.ts` is a one-off script. In practice the schema is expected to be created via InsForge's own tooling/console. (For local setup we created tables directly via a `setup-db.ts` script and a direct Postgres connection.)

---

## 7. Authentication Flow

- **Provider:** InsForge Auth (email/password, Google OAuth, OTP email verification, password reset). The app does **not** implement its own user store.
- **Client (`AuthContext`):** on mount, reads `jazz_access_token` from `localStorage`, then calls `insforge.auth.getCurrentUser()` which refreshes the session if needed. The resolved token is pushed into `api.ts` via `setApiToken`. Sign-in/up/verify/reset all delegate to `insforge.auth.*`.
- **Server (`middleware/auth.ts`):** extracts the Bearer JWT, decodes it (no local signature check), and injects an InsForge client bound to that token. `req.user = { id: sub, email, role }`. Real authorization is enforced by InsForge RLS on every DB call.
- **Implication:** the server trusts the InsForge-issued JWT's claims; the actual cryptographic trust boundary is the InsForge PostgREST layer. If InsForge's JWT secret were ever shared/weak, the server's `decode` would accept forged claims.

---

## 8. Telephony Flow

**Client-side calling (WebRTC):**
- `VoiceContext` is the single interface UI uses. It delegates to `TelnyxContext` or `TwilioContext` based on `activeProvider`.
- **Telnyx:** `TelnyxContext` obtains a SIP token from `POST /api/telnyx/token` (server fetches the user's Telnyx API key + SIP login from `user_settings`, looks up the Telnyx telephony credential, and returns connection credentials). The browser then registers a SIP WebSocket and places/receives WebRTC calls directly with Telnyx.
- **Twilio:** `TwilioContext` calls `POST /api/twilio/token` (server builds a Twilio `AccessToken` with a `VoiceGrant` using the user's stored Twilio API key/secret/TwiML SID from `user_settings`). The browser uses `@twilio/voice-sdk` `Device` to call. Outbound calls hit Twilio's `/api/twilio/voice` TwiML webhook, which dials `From`/`To` and validates the caller ID format.
- **Local SIM mode:** `useLocalCalling` opens a `tel:` URI (native dialer) and triggers disposition on return — no WebRTC.
- **Provider config UI:** `ConnectorsPage` lets the user save Telnyx/Twilio credentials into `user_settings` (verified live against the provider APIs in `settings.ts`).

**Server-side telephony responsibilities:**
- Mint tokens (Telnyx SIP / Twilio JWT).
- Host the Twilio TwiML `/voice` and `/webhook` endpoints.
- Telnyx webhook (`telnyx.ts`) currently logs hang-up events; a comment notes future `call_logs` update is not yet implemented.

**Known gap:** `TwilioContext.holdAndAnswer` is a documented stub ("limited in Twilio Browser SDK — stub for interface parity"); hold/resume is not truly implemented for Twilio.

---

## 9. Campaign Flow

1. **Create:** `POST /api/campaigns` (validated by `createCampaignSchema`: name, `dialer_mode` ∈ {preview, power, predictive, click}, `provider` ∈ {telnyx, twilio, local}, `caller_number`). Inserts with `status: 'draft'`.
2. **Assign leads:** `POST /api/leads/bulk` (upsert leads + junction rows into `campaign_leads`, then recount `campaigns.total_leads`) or `POST /api/leads/assign` (assign existing CRM leads). Both update `campaigns.total_leads`.
3. **Dial:** `CampaignDialerPage` loads leads via `leadsApi.listByCampaign` (limit 500) and presents a swipeable card. On call end → disposition overlay → `callsApi.log` + `leadsApi.updateDisposition`. If `dialer_mode === 'power'`, it auto-advances to the next card after 1.5s.
4. **Modes:**
   - **Preview** = manual review before dial.
   - **Power** = auto-advance card after disposition (UI select shows it as "Coming Soon"/disabled; only the auto-swipe behavior is coded).
   - **Progressive** = disabled stub in the UI (no implementation).
   - **Click** = manual swipe, no auto-advance.
5. **Progress:** `calls.ts` increments `campaigns` call count via the `increment_campaign_calls` RPC when a previously-uncalled lead is dispositioned.

---

## 10. AI Integration Flow

- **There is no AI integration implemented in the application code.** The `@insforge/sdk` *supports* an `insforge.ai` namespace (chat completions, vision, embeddings — OpenAI-compatible), and `insforge.md` documents it, but no `client/src` or `server/src` file calls `insforge.ai`, `/ai`, or any completion endpoint.
- The only AI-adjacent surface is the SDK capability, which is currently unused. Any "AI features" would be a net-new build, not a wiring of existing code.

---

## 11. Build Process

**Client:** `cd client && npm run build` → `tsc -b && vite build`, producing `client/dist` (static assets; `VITE_*` vars are baked in at build time, so they must be supplied as build args/env, not at runtime).

**Server:** `cd server && npm run build` → `tsc` (emits `dist/`). In production the Docker image runs `tsx server/src/index.ts` directly (ESM) rather than the compiled output, and serves `client/dist` as static files.

**Local:** root `npm run dev` uses `concurrently` to run both. The server reads env from the **repo root `.env`**; the client reads `VITE_*` from root or `client/.env`.

**Type safety:** strict-ish TypeScript on both sides; Zod schemas at every API boundary on the server; React Router for client routing.

---

## 12. Deployment Process

- **Docker (primary path):** `Dockerfile` is multi-stage:
  1. *Builder*: `npm ci` at root, `npm ci --legacy-peer-deps` in client, `npm run build` the client (baking `VITE_INSFORGE_BASE_URL` / `VITE_INSFORGE_ANON_KEY` from `--build-arg`).
  2. *Production*: installs server deps, installs `tsx` globally, copies `server/src` and `client/dist`, runs `tsx server/src/index.ts` on `PORT` (default 3001). Express serves the SPA and proxies `/api/*` to itself.
- **Env injection:** at runtime the container needs `INSFORGE_API_KEY`, `INSFORGE_BASE_URL`, `INSFORGE_ANON_KEY`, `JWT_SECRET` (per README). Note the README references `INSFORGE_API_KEY`/`INSFORGE_BASE_URL` while the code reads `INSFORGE_URL`/`INSFORGE_ANON_KEY` — a naming mismatch to be aware of when deploying.
- **InsForge dependency:** the app cannot run without a provisioned InsForge project (Postgres + Auth). There is no bundled database; the Docker image connects to a remote InsForge.
- **No CI/CD config** is present in the repo (no GitHub Actions workflows beyond what may be inferred). Deployment is manual `docker build`/`docker run`.

---

## 13. High-Level Risks

1. **No schema/migration ownership in-repo.** Tables (`call_logs`) and the `increment_campaign_calls` RPC referenced by `calls.ts`/`stats.ts` are not created by any app migration. A fresh InsForge project will 500 on call logging and disposition saving until these are provisioned. This is the single most likely runtime breakage for a new deployment.
2. **Server does not verify JWT signatures.** `middleware/auth.ts` only *decodes* the token; trust rests entirely on InsForge's PostgREST RLS. Acceptable by design, but means InsForge's key management is the critical security boundary — compromise there is full compromise.
3. **Dependency vulnerabilities.** `npm audit` reports HIGH-severity issues in both apps: `axios` (prototype-pollution/auth-bypass gadgets, transitive via twilio/insforge), `esbuild` (arbitrary file read on Windows dev server — relevant to this Windows environment), `form-data` (CRLF injection), and `basic-ftp` (FTP command injection, via puppeteer in client). Most are patchable via `npm audit fix`.
4. **Outdated core libraries.** `@insforge/sdk` 1.2.2 (extensionless-import ESM bug), `multer` 1.x (explicitly flagged vulnerable, 2.x available), `express` 4 (5 available, major), `zod` 3 (4 available, major), `twilio` 5 (6 available), `tailwindcss` 3 (4 available, major). Major bumps need test coverage.
5. **Incomplete dialer features.** Power dialer is auto-swipe only (no true auto-dial); Progressive dialer is a disabled stub; Twilio hold is a stub. The UI advertises capabilities the code doesn't fully deliver.
6. **Client data handling.** `CampaignDialerPage` loads up to 500 leads into React state with no virtualization; large campaigns are a memory/UX bottleneck. `api.ts` returns `{ data: null }` on non-401 errors without throwing, which can mask failures and cause undefined-access crashes in callers.
7. **Env var naming drift.** README/`.env.example` use `INSFORGE_BASE_URL`/`INSFORGE_API_KEY`; code reads `INSFORGE_URL`/`INSFORGE_ANON_KEY`. Misconfiguration is easy during deployment.
8. **Silent failure in call logging.** `calls.ts` swallows lead-update and RPC errors (console.error only), so a failed campaign-counter sync goes unnoticed and stats drift from reality.
9. **No production process manager / healthcheck beyond `/api/health`.** Socket.io is initialized but unused for business logic; rate limiting is basic.

---

*End of AUDIT_01_ARCHITECTURE.md — inspection complete, no source files were modified.*