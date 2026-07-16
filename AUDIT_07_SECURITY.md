# AUDIT_07_SECURITY.md

**DialerJazz — Security Audit**
*Inspection-only. No source files were modified.*

Scope: Authentication, Authorization, JWT, Secrets, Environment variables, SQL Injection, XSS, CSRF, Rate limits, API abuse, Dependency vulnerabilities, Permissions.

> **Headline:** The security model is **delegated entirely to InsForge** (managed Postgres + Auth + RLS). The app layer adds almost no independent enforcement. Several critical gaps exist: JWTs are **decoded but never verified** (backend audit #2), **RLS is disabled on every table** (DB audit #1), provider **secrets are stored in plaintext and returned to the client** (backend #4, DB #5), webhooks are **unsigned** (backend #6/#7), and there is a **hardcoded fallback InsForge URL + anon key** in source (backend #1). Dependency scans show **15 vulns in server (1 critical, 4 high, 9 moderate, 1 low)** and **14 in client (5 high, 8 moderate, 1 low)**.

---

## Summary Table

| # | Severity | Area | Finding |
|---|----------|------|---------|
| 1 | **Critical** | JWT | `middleware/auth.ts` uses `jwt.decode` (no signature verification). Forged JWTs with a guessed `sub` are accepted. |
| 2 | **Critical** | Permissions / RLS | RLS disabled on all tables; zero policies (DB audit #1). Tenant isolation is app-only. |
| 3 | **Critical** | Secrets / Env | Hardcoded fallback InsForge URL + anon key committed in `lib/insforge.ts` (backend #1). |
| 4 | **High** | Secrets | `user_settings` stores Telnyx/Twilio secrets in plaintext; `GET /settings` returns them to the browser (backend #4, DB #5). |
| 5 | **High** | API abuse / Webhooks | `/api/twilio/voice` + `/webhook` and `/api/telnyx/webhook` are unauthenticated & unsigned → toll-fraud / spoofing (backend #6/#7). |
| 6 | **High** | Authorization | `GET /leads/campaign/:id` filters only the junction `user_id`; campaign ownership not enforced → cross-tenant read (backend #3). |
| 7 | **High** | Dependency vulns | Server: 15 vulns (1 critical, 4 high). Client: 14 vulns (5 high). Includes axios prototype-pollution, esbuild arbitrary file read (Windows dev), form-data CRLF, basic-ftp. |
| 8 | **Medium** | Rate limits | Global 100/min only; bulk/assign endpoints unbounded; `trust proxy` not set so `req.ip` is the proxy, weakening limits behind CDN. |
| 9 | **Medium** | API abuse | `express.json({limit:'50mb'})` + bulk import of 2000 leads → memory/DoS & write-amplification. |
| 10 | **Medium** | XSS | Token in `localStorage` (XSS-readable); testimonial `<img>` from randomuser.me; no CSP. Frontend audit #14/#15. |
| 11 | **Medium** | SQL Injection | Not via app code (PostgREST parameterized), BUT `migrate_twilio.ts` calls `rpc('raw_sql', {query})` — if that RPC were anon-exposed it's a full SQL-injection/RCE hole (currently absent, so low risk). |
| 12 | **Low** | CSRF | Cookie-based auth not used (Bearer JWT in header) → classic CSRF largely N/A; but `credentials:true` CORS + no origin strictness beyond a small allowlist is acceptable. No double-submit/CSRF token for state-changing fetches. |
| 13 | **Low** | Env vars | `.env.example` names (`INSFORGE_BASE_URL`/`INSFORGE_API_KEY`) don't match code (`INSFORGE_URL`/`INSFORGE_ANON_KEY`) → misconfig → hits hardcoded fallback (#3). |
| 14 | **Low** | Permissions | `user_id` columns lack FK to `auth.users`; `raw_sql` RPC referenced by migration would need service-role (DB #10). |
| 15 | **Low** | Auth | No MFA, no lockout/backoff on failed login (delegated to InsForge; `password_min_length=6` default is weak — seen in auth.config). |

---

## Detailed Findings

### 1. JWT not verified (Critical)
- **Area:** JWT / Authentication
- **File:** `server/src/middleware/auth.ts` (line 25)
- **Explanation:** `jwt.decode(token)` only base64-decodes the payload. There is **no `jwt.verify(token, JWT_SECRET)`**. The code comment claims InsForge PostgREST validates it on DB calls — true for DB access, but any logic that trusts `req.user` *before* a DB call, and the entire trust boundary, rests on an unverified claim. A forged JWT with `sub = <victim_uuid>` is accepted by the middleware; RLS then scopes queries to that victim. The real boundary is InsForge, but the server must not decode-and-trust.
- **Fix:** `jwt.verify(token, process.env.JWT_SECRET)` (InsForge signs with a known secret) or introspect via InsForge `/auth/v1/user`. Remove the dead `JWT_SECRET` env (it's loaded but unused).

### 2. RLS disabled everywhere (Critical)
- **Area:** Permissions / Authorization
- **File:** all `public` + `auth` tables (DB audit #1)
- **Explanation:** `relrowsecurity = false` and `pg_policies` is empty. Postgres enforces **no** tenant isolation. The only guard is the app's `.eq('user_id', req.user.id)` — and that `req.user` comes from an **unverified** JWT (#1). Any missed filter, new endpoint, or future direct DB access exposes all tenants.
- **Fix:** `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` + policies `USING (user_id = auth.uid())` (or the InsForge JWT claim). Make RLS the real boundary.

### 3. Hardcoded fallback credentials (Critical)
- **Area:** Secrets / Environment variables
- **File:** `server/src/lib/insforge.ts` (lines 9–10)
- **Explanation:** If `INSFORGE_URL`/`INSFORGE_ANON_KEY` are unset, the client falls back to a **hardcoded** `baseUrl` (`https://755d753k.ap-southeast.insforge.app`) and `anonKey` (`ik_af1473a111e5ba0499e448e9ca6ad0ab`) committed to the repo. A misconfigured deploy silently talks to a third party's InsForge project; the anon key is now public.
- **Fix:** Remove fallbacks; throw if env missing. Rotate the leaked anon key.

### 4. Plaintext provider secrets + client exposure (High)
- **Area:** Secrets
- **File:** `server/src/routes/settings.ts` (GET /), `public.user_settings` (DB #5)
- **Explanation:** `telnyx_sip_password`, `twilio_auth_token`, `twilio_api_secret`, `twilio_api_key` are stored as plain `text` and `GET /api/settings` returns them to the browser. Combined with #1/#2 and XSS (#10), this is a full telephony-credential compromise path.
- **Fix:** Encrypt at rest (pgcrypto) or vault; never return secret values to the client — return only `configured: boolean`.

### 5. Unsigned webhooks (High)
- **Area:** API abuse / Authorization
- **File:** `server/src/routes/twilio.ts`, `telnyx.ts`
- **Explanation:** `/api/twilio/voice` (returns TwiML that dials arbitrary numbers using the configured caller ID) and `/api/twilio/webhook` + `/api/telnyx/webhook` accept unauthenticated POSTs with no signature check. Anyone who learns the URL can forge TwiML (toll fraud) or status events.
- **Fix:** Validate `X-Twilio-Signature` (HMAC with `TWILIO_AUTH_TOKEN`) and Telnyx signature/public-IP allowlist; reject on mismatch.

### 6. Cross-tenant read on campaign leads (High)
- **Area:** Authorization
- **File:** `server/src/routes/leads.ts` (lines 154–182)
- **Explanation:** `GET /leads/campaign/:campaignId` filters `.eq('campaign_id', …).eq('user_id', req.user.id)` on the **junction** table but never verifies the **campaign** belongs to the caller. A user can enumerate any `campaignId` and, if any `campaign_leads` row matches, read that campaign's leads.
- **Fix:** First confirm `campaigns.id = :campaignId AND user_id = req.user.id`, then join.

### 7. Dependency vulnerabilities (High)
- **Area:** Dependency vulnerabilities
- **Explanation:** `npm audit` (run during this audit):
  - **Server (15):** 1 critical, 4 high, 9 moderate, 1 low. High/critical include **axios** (prototype-pollution read-side gadgets → credential injection/request hijacking; `no_proxy`/IPv4-mapped IPv6 SSRF bypasses — transitive via twilio/insforge), **esbuild** (arbitrary file read when dev server runs on Windows — relevant here), **form-data** (CRLF injection via unescaped multipart field names).
  - **Client (14):** 5 high, 8 moderate, 1 low. High includes **basic-ftp** (FTP command injection / DoS, transitive via puppeteer), **@babel/core** (arbitrary file read via sourceMappingURL), plus moderate js-yaml/brace-expansion/ip-address/postcss.
- **Fix:** Run `npm audit fix` in both apps (non-breaking patches). Upgrade `@insforge/sdk`→1.4.4 (also resolves the ESM workaround), `multer`→2.x, `express-rate-limit`→8.5.2. Schedule major bumps (express 5, zod 4, twilio 6, tailwind 4, typescript 7) with tests. Note: `esbuild`/`basic-ftp` are dev-only but still matter on a Windows dev box.

### 8. Rate limiting gaps (Medium)
- **Area:** Rate limits
- **File:** `server/src/index.ts` (lines 71–98)
- **Explanation:** Only a global 100/min/IP limiter (plus a `strictLimiter` intended for token routes). `POST /leads/bulk` and `/leads/assign` have no dedicated limit. `app.set('trust proxy', …)` is never set, so behind a CDN/reverse proxy `req.ip` is the proxy's IP, making the per-IP limit ineffective (one shared bucket).
- **Fix:** Add per-endpoint strict limits to bulk/assign; set `trust proxy` appropriately; consider per-user (not per-IP) limits using the verified user id.

### 9. Unbounded body / bulk import (Medium)
- **Area:** API abuse
- **File:** `server/src/index.ts` (line 49), `leads.ts` (bulk, max 2000)
- **Explanation:** `express.json({limit:'50mb'})` allows 50 MB bodies; `bulk` accepts 2000 leads → 3 sequential DB round-trips. A compromised token can do write-amplification against InsForge.
- **Fix:** Lower global limit to ~5 MB; apply a smaller limit to `/bulk`; stricter rate limit (#8).

### 10. XSS exposure (Medium)
- **Area:** XSS
- **File:** `client/src/contexts/AuthContext.tsx` (localStorage token), `LoginPage.tsx` (remote `<img>`), no CSP
- **Explanation:** Access token persisted in `localStorage` (readable by any XSS). Login page renders testimonial avatars from `randomuser.me` (third-party HTML/img). No Content-Security-Policy header is set by the server. React's default escaping mitigates reflected/stored XSS in rendered text, but any XSS → full token theft + (with #4) secret exposure.
- **Fix:** Use httpOnly cookie session (InsForge supports it) or in-memory token; add a strict CSP; sanitize/avoid remote HTML.

### 11. SQL injection surface (Medium, currently latent)
- **Area:** SQL Injection
- **File:** `server/migrate_twilio.ts` (line 36)
- **Explanation:** App code uses PostgREST with parameterized queries → **no SQL injection in the running app**. However, the migration script calls `client.db.rpc('raw_sql', { query: sql })` using the **anon key**. If InsForge ever exposed `raw_sql` to anon, that is a direct SQL-injection/RCE primitive. In the inspected instance `raw_sql` does **not** exist (good), so the live risk is low — but the pattern is dangerous and the script would fail/be-blocked.
- **Fix:** Never use a `raw_sql` RPC from anon; manage schema via InsForge console or a service-role migration tool. Remove the script or gate it behind service role.

### 12. CSRF (Low)
- **Area:** CSRF
- **Explanation:** Auth is Bearer-JWT-in-header (not cookies), so classic cookie CSRF does not apply. `cors({credentials:true})` is used with an allowlist that includes `localhost` origins and `FRONTEND_URL`. There is no CSRF token on state-changing fetches, but without cookie auth this is low risk. If cookie auth is adopted (#10), CSRF protection becomes mandatory.
- **Fix:** If switching to cookie auth, add SameSite=Lax/Strict + CSRF double-submit tokens. Keep the CORS allowlist tight (no `*` with credentials).

### 13. Env var name drift (Low)
- **Area:** Environment variables
- **File:** `.env.example` vs `lib/insforge.ts`
- **Explanation:** `.env.example` documents `INSFORGE_BASE_URL`/`INSFORGE_API_KEY`; code reads `INSFORGE_URL`/`INSFORGE_ANON_KEY`. A deployer following the example gets a broken server that silently uses the hardcoded fallback (#3).
- **Fix:** Align names across `.env.example`, README, and code; document required vars.

### 14. Missing FKs / service-role (Low)
- **Area:** Permissions
- **File:** `public.*` user_id columns (DB #10)
- **Explanation:** `user_id` columns have no FK to `auth.users` (orphan risk). The migration's `raw_sql` would require service-role; confirm InsForge permits FK to managed `auth.users`.
- **Fix:** Add FKs where permitted; use service role for migrations only.

### 15. Auth hardening (Low)
- **Area:** Authentication
- **File:** `auth.config` (inspected): `password_min_length=6`, no complexity requirements, `disable_signup=false`
- **Explanation:** InsForge default password policy is weak (6 chars, no complexity). No MFA, no account lockout/backoff on brute force. These are delegated to InsForge but worth tightening for a dialer handling PII + telephony credentials.
- **Fix:** Raise `password_min_length`, enable MFA if supported, consider rate-limiting/lockout on auth failures (InsForge-side or via the `/api/me` path).

---

## Authentication (summary)
- InsForge Auth (email/password, Google OAuth, OTP). Client `AuthContext` manages token; server `requireAuth` decodes (not verifies) JWT. **No server-side signature verification (#1).** Token in `localStorage` (#10). No MFA/lockout (#15).

## Authorization (summary)
- Entirely RLS-dependent, but **RLS is off (#2)**. App filters by `user_id` per query; one endpoint has a cross-tenant gap (#6). No roles/permissions beyond `user_id` tenancy. `is_project_admin` exists in `auth.users` but is never checked by app code.

## JWT (summary)
- Issued by InsForge; server **decodes only**. `JWT_SECRET` is in `.env` but unused for verification. This is the single most important fix (#1).

## Secrets (summary)
- Telnyx/Twilio secrets in plaintext (#4), returned to client (#4), plus a hardcoded InsForge anon key in source (#3). No secret manager, no encryption, no rotation.

## Environment variables (summary)
- Code reads `INSFORGE_URL`, `INSFORGE_ANON_KEY`, `JWT_SECRET`, `FRONTEND_URL`, `PORT`, `VITE_*`. Names drift from docs (#13). Hardcoded fallback (#3). `JWT_SECRET` loaded but unused (#1).

## SQL Injection (summary)
- Not present in running app (parameterized PostgREST). Latent only via the `raw_sql` migration pattern (#11), which is currently inert.

## XSS (summary)
- React escaping mitigates most; residual risk from `localStorage` token (#10), remote images, and no CSP. If an XSS lands, it yields the token + (via #4) all telephony secrets.

## CSRF (summary)
- Low risk today (Bearer header auth). Becomes relevant if cookie auth is adopted (#12).

## Rate limits (summary)
- Global 100/min + intended 10/min on token routes; bulk/assign unbounded; `trust proxy` unset (#8).

## API abuse (summary)
- Unsigned webhooks enable toll fraud (#5); 50 MB body + 2000-lead bulk enable DoS/write-amplification (#9); no per-user limits (#8).

## Dependency vulnerabilities (summary)
- **Server: 15 (1 critical, 4 high, 9 moderate, 1 low).** **Client: 14 (5 high, 8 moderate, 1 low).** Action: `npm audit fix` + targeted upgrades (#7).

## Permissions (summary)
- RLS off (#2); no FKs to auth.users (#14); `is_project_admin` unused; InsForge default password policy weak (#15).

---

## Top Priorities
1. **Verify JWT signatures** (#1) — or accept InsForge as the only boundary but then **enable RLS** (#2) so the DB enforces tenancy regardless of app bugs.
2. **Remove hardcoded fallback creds** (#3) and **rotate the leaked anon key**.
3. **Stop storing/returning secrets in plaintext** (#4); encrypt + never send to client.
4. **Sign webhooks** (#5) to stop toll fraud.
5. **Run `npm audit fix`** and upgrade the flagged packages (#7).
6. **Fix the cross-tenant read** (#6) and add per-user rate limits + lower body limit (#8/#9).

---

*End of AUDIT_07_SECURITY.md — inspection complete, no source files were modified.*