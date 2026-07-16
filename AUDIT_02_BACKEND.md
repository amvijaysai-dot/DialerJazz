# AUDIT_02_BACKEND.md

**DialerJazz — Backend Security & Quality Audit**
*Inspection-only. No source files were modified.*

Scope: `server/src/**` (routes, middleware, lib), `server/src/index.ts`, `server/migrate_twilio.ts`, `.env.example`, and the running `.env` configuration.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | Critical | `lib/insforge.ts` | Hardcoded fallback InsForge URL + anon key in source |
| 2 | Critical | `middleware/auth.ts` | JWT signature is never verified server-side |
| 3 | High | `routes/leads.ts` | `GET /campaign/:id` missing `requireAuth` + no `user_id` filter on campaign lookup |
| 4 | High | `routes/settings.ts` | Secrets (Telnyx/Twilio) returned to client in `GET /` |
| 5 | High | `routes/settings.ts` | `verify-telnyx`/`verify-twilio` SSRF-style outbound fetch with user-supplied key, no timeout |
| 6 | High | `routes/twilio.ts` | `/voice` & `/webhook` unauthenticated, no Twilio signature validation |
| 7 | High | `routes/telnyx.ts` | `/webhook` unauthenticated, no source validation |
| 8 | Medium | `index.ts` | `app.get('*')` SPA catch-all can shadow API routes; no `trust proxy` |
| 9 | Medium | `routes/leads.ts` | `bulk`/`assign` recount uses read-then-write (race) for `total_leads` |
| 10 | Medium | `routes/calls.ts` | `call_logs` table + `increment_campaign_calls` RPC not provisioned → 500 at runtime |
| 11 | Medium | `routes/calls.ts` | Lead-update & RPC errors swallowed (silent counter drift) |
| 12 | Medium | `middleware/errorHandler.ts` | Leaks stack/error detail in 500; no request id; no structured logging |
| 13 | Medium | `index.ts` | `express.json({limit:'50mb'})` — unbounded body, no file-type limits |
| 14 | Medium | `routes/leads.ts` | `bulk` accepts up to 2000 leads, no rate-limit beyond global 100/min |
| 15 | Low | `routes/leads.ts` | `google_rating`/`review_count` typed as `number()` but DB columns are `numeric`/`integer` — precision loss / NaN risk |
| 16 | Low | `.env.example` | Env var names (`INSFORGE_BASE_URL`/`INSFORGE_API_KEY`) don't match code (`INSFORGE_URL`/`INSFORGE_ANON_KEY`) |
| 17 | Low | `migrate_twilio.ts` | Uses `raw_sql` RPC with anon key; not part of any migration framework |
| 18 | Low | `routes/settings.ts` | `GET /telnyx/balance` etc. throw generic Error → 500 with raw message |
| 19 | Low | `index.ts` | `strictLimiter` mounted on `/api/telnyx/token` and `/api/twilio/token` but those routers are mounted *after*, so limiter is dead code for token routes |
| 20 | Low | `routes/leads.ts` | `search` uses `or(...ilike.*%term%*)` — wildcard injection / no escaping of `%`/`_` |

---

## Detailed Findings

### 1. Hardcoded fallback InsForge credentials
- **Severity:** Critical
- **File:** `server/src/lib/insforge.ts` (lines 9–10)
- **Explanation:** `getInsforgeClient()` falls back to a hardcoded `baseUrl` (`https://755d753k.ap-southeast.insforge.app`) and `anonKey` (`ik_af1473a111e5ba0499e448e9ca6ad0ab`) if env vars are missing. If the server is ever deployed without `INSFORGE_URL`/`INSFORGE_ANON_KEY`, it silently talks to a *different* InsForge project owned by a third party, and the anon key is committed to the repo. This is a data-exfiltration / misconfiguration landmine.
- **Recommended fix:** Remove the fallback values entirely; throw if `INSFORGE_URL`/`INSFORGE_ANON_KEY` are unset. Keep secrets only in env. Rotate the leaked anon key.

### 2. JWT signature not verified
- **Severity:** Critical
- **File:** `server/src/middleware/auth.ts` (line 25)
- **Explanation:** `jwt.decode(token)` only base64-decodes the payload; it does **not** call `jwt.verify(token, secret)`. The code comment claims InsForge PostgREST validates it, which is true for DB calls, but any logic that trusts `req.user` *before* a DB call (e.g. building responses, branching) operates on unverified claims. A forged JWT with a guessed `sub` would be accepted by the middleware; RLS would then scope queries to that `sub`. The real boundary is InsForge, but the server should not decode-and-trust.
- **Recommended fix:** Use `jwt.verify(token, process.env.JWT_SECRET)` (InsForge signs with a known secret) or, at minimum, validate the token via InsForge's `/auth/v1/user` introspection endpoint in `requireAuth`. Never rely solely on downstream RLS for the auth boundary.

### 3. Campaign-leads endpoint missing auth + ownership filter
- **Severity:** High
- **File:** `server/src/routes/leads.ts` (lines 154–182)
- **Explanation:** `router.get('/campaign/:campaignId')` is defined **after** `router.use(requireAuth)` so auth is present, but the query filters only `.eq('campaign_id', ...).eq('user_id', req.user.id)` on the **junction** table. If a `campaign_leads` row exists for that campaign but belongs to *another* user, the join still returns that campaign's leads because the `user_id` filter is on `campaign_leads`, not enforced on the nested `leads`. More importantly, the `campaigns` table itself is never checked for ownership, so a user can enumerate any campaign id and read its leads if any junction row matches. Cross-tenant read risk.
- **Recommended fix:** Verify the campaign belongs to `req.user.id` first (`campaigns` table), and ensure the nested `leads` are also scoped. Prefer a single RLS-protected query or an explicit ownership check before returning data.

### 4. Secrets returned to client
- **Severity:** High
- **File:** `server/src/routes/settings.ts` (lines 26–40)
- **Explanation:** `GET /api/settings` selects and returns `telnyx_api_key`, `telnyx_sip_password`, `twilio_auth_token`, `twilio_api_secret`, etc. These are sensitive credentials. Returning them to the browser means they are stored in client memory/localStorage-adjacent state and exposed to any XSS. The UI only needs to know *whether* a provider is configured, not the secret values.
- **Recommended fix:** Return only non-secret fields (e.g. `telnyx_configured: boolean`, `twilio_configured: boolean`, `default_provider`, `caller_numbers`). Never serialize `auth_token`/`api_secret`/`sip_password` to the client.

### 5. Outbound fetch with user-supplied credentials, no timeout
- **Severity:** High
- **File:** `server/src/routes/settings.ts` (lines 77–146, 149–282)
- **Explanation:** `verify-telnyx`/`verify-twilio` and the `*/balance`/`*/phone-numbers` endpoints make server-side `fetch()` calls to external APIs using keys the user supplies. There is no `AbortController`/timeout, so a slow/hanging upstream (or a user pointing at a malicious host if the host were ever configurable) can exhaust the Node request pool. Additionally, the verification endpoints *save* the key before confirming it's the user's — minor, but the key is persisted on first contact.
- **Recommended fix:** Add `AbortSignal.timeout(5000)` to all outbound fetches. Validate the returned account actually belongs to the authenticated user where possible. Consider not persisting until verified.

### 6. Unauthenticated Twilio webhooks, no signature validation
- **Severity:** High
- **File:** `server/src/routes/twilio.ts` (lines 60–111)
- **Explanation:** `/api/twilio/voice` and `/api/twilio/webhook` have **no `requireAuth`** and **no Twilio request signature validation** (`twilio.validateRequest` / `validateRequestWithBody`). Anyone who knows the URL can POST a forged TwiML request or status callback. The `/voice` handler will then dial arbitrary numbers using the configured caller ID (toll-fraud / abuse vector).
- **Recommended fix:** Validate the `X-Twilio-Signature` header against `process.env.TWILIO_AUTH_TOKEN` and the full URL+params using `twilio.validateRequest`. Reject on mismatch. Keep these routes unauthenticated (Twilio can't send a Bearer token) but signature-protected.

### 7. Unauthenticated Telnyx webhook, no source validation
- **Severity:** High
- **File:** `server/src/routes/telnyx.ts` (lines 100–118)
- **Explanation:** `/api/telnyx/webhook` accepts unauthenticated POSTs from "Telnyx servers." There is no validation that the request actually originated from Telnyx (no signature/public-IP allowlist). Currently it only logs, so impact is low *today*, but it's a standing injection point for log forgery / future logic if the `Future: update call_logs` code is added.
- **Recommended fix:** Validate Telnyx's `Telnyx-Signature` / public CIDR, or at minimum document the expected source. Don't act on unverified payloads.

### 8. SPA catch-all + proxy trust
- **Severity:** Medium
- **File:** `server/src/index.ts` (lines 102–111)
- **Explanation:** `app.get('*', ...)` is registered *after* the `/api` routers, so API routes are safe, but the wildcard also catches anything not matched — fine for SPA, but if a future `/api/...` route is added after this block it would be shadowed. Also `app.set('trust proxy', …)` is never set, so `req.ip` (used by rate limiter) reflects the immediate proxy, weakening rate limiting behind a CDN/reverse proxy.
- **Recommended fix:** Mount the SPA catch-all *only* for non-`/api` paths (e.g. `app.get(/^(?!\/api).*/)`), and set `app.set('trust proxy', 1)` (or appropriate count) when behind a proxy.

### 9. Race condition in `total_leads` recount
- **Severity:** Medium
- **File:** `server/src/routes/leads.ts` (lines 132–145, 206–213)
- **Explanation:** After upserting `campaign_leads`, the code does a `count` then an `update` of `campaigns.total_leads`. This read-modify-write is not atomic; concurrent bulk imports / assigns can overwrite each other's counts, leaving `total_leads` stale.
- **Recommended fix:** Use a single `UPDATE ... SET total_leads = (SELECT count(*) FROM campaign_leads WHERE campaign_id = $1)` statement, or a DB trigger / RPC, so the count is computed atomically.

### 10. Missing `call_logs` table + `increment_campaign_calls` RPC
- **Severity:** Medium
- **File:** `server/src/routes/calls.ts` (lines 33–49, 84), `server/src/routes/stats.ts` (line 17)
- **Explanation:** `calls.ts` inserts into `call_logs` and calls `rpc('increment_campaign_calls', …)`; `stats.ts` counts `call_logs`. Neither the table nor the RPC is created by any in-repo migration (only `leads/campaigns/campaign_leads/user_settings` exist via the local `setup-db.ts`). On a fresh InsForge project these calls 500, breaking call logging, disposition saving, and the dashboard stats.
- **Recommended fix:** Add `call_logs` DDL + the `increment_campaign_calls(uuid)` SQL function to a real migration (and to `setup-db.ts`). Add an integration test that exercises `POST /api/calls/log`.

### 11. Silent failure in call logging
- **Severity:** Medium
- **File:** `server/src/routes/calls.ts` (lines 70–95)
- **Explanation:** If the lead `update` or the `increment_campaign_calls` RPC fails, the error is only `console.error`'d; the request still returns 200. Campaign progress can silently drift from reality with no signal to the user or operator.
- **Recommended fix:** Surface these as warnings in structured logs *and* consider returning a partial-success status, or make the counter update best-effort with a reconciling background job. At minimum, log with context (campaign id, lead id).

### 12. Error handler leaks detail, no structure
- **Severity:** Medium
- **File:** `server/src/middleware/errorHandler.ts` (lines 11–36)
- **Explanation:** The 500 branch returns a generic message (good), but `console.error('[Unhandled Server Error]', error)` prints the full error object (potentially with stack + sensitive data) to stdout with no request id, no level, no JSON structure. There is no correlation id to tie a log line to a request, making production debugging hard.
- **Recommended fix:** Use a structured logger (pino/winston) with levels, a per-request `requestId`, and redaction. Avoid logging full `error` objects with secrets.

### 13. Unbounded JSON body size
- **Severity:** Medium
- **File:** `server/src/index.ts` (line 49)
- **Explanation:** `express.json({ limit: '50mb' })` allows 50 MB JSON bodies. Combined with `POST /api/leads/bulk` (up to 2000 leads), this is a memory/DoS vector on a small server. 50 MB is far larger than any legitimate request here.
- **Recommended fix:** Lower the global limit (e.g. 1–5 MB) and apply a smaller, explicit limit only to the bulk-import route. Add `multer` limits for any file upload.

### 14. Bulk import not rate-limited beyond global
- **Severity:** Medium
- **File:** `server/src/routes/leads.ts` (lines 95–151)
- **Explanation:** `POST /api/leads/bulk` accepts 2000 leads per call and runs 3 sequential DB round-trips. Only the global 100 req/min limiter applies. A malicious/compromised token can hammer this endpoint to do write-amplification against InsForge.
- **Recommended fix:** Apply a stricter per-user/per-endpoint limiter (e.g. 5/min) to `/bulk` and `/assign`, and cap payload size at the body-parser level.

### 15. Numeric type mismatch
- **Severity:** Low
- **File:** `server/src/routes/leads.ts` (lines 22–23)
- **Explanation:** `google_rating: z.number().optional()` and `review_count: z.number().optional()` accept any float, but the DB columns are `numeric`/`integer`. `NaN`/`Infinity` won't pass Zod but large floats could lose precision; `review_count` as a float is semantically wrong.
- **Recommended fix:** Use `z.number().int()` for `review_count` and bound `google_rating` (e.g. `min(0).max(5)`). Coerce/validate before insert.

### 16. Env var name drift
- **Severity:** Low
- **File:** `.env.example` (lines 2–4) vs `lib/insforge.ts` (lines 9–10)
- **Explanation:** `.env.example` documents `INSFORGE_BASE_URL` and `INSFORGE_API_KEY`, but the code reads `INSFORGE_URL` and `INSFORGE_ANON_KEY`. A deployer following the example will have a non-functional server (and hit the hardcoded fallback from #1).
- **Recommended fix:** Align names across `.env.example`, README, and code. Pick one convention and document it.

### 17. Migration script uses anon key + raw_sql RPC
- **Severity:** Low
- **File:** `server/migrate_twilio.ts` (lines 11–14, 36)
- **Explanation:** The one-off migration calls `client.db.rpc('raw_sql', { query })` using the **anon key**. If InsForge's `raw_sql` RPC is restricted to service role (as it should be), this script fails; if it's open to anon, that's a separate critical hole. Either way, schema changes shouldn't run via an ad-hoc anon-key script.
- **Recommended fix:** Use the service-role key for migrations, or manage schema through InsForge's console / a proper migration tool. Remove `raw_sql` exposure from anon.

### 18. Generic throws become 500 with raw message
- **Severity:** Low
- **File:** `server/src/routes/settings.ts` (lines 168, 236)
- **Explanation:** `throw new Error('Failed to fetch Telnyx balance')` is caught by the global handler and returns a 500 with no code; the raw upstream message may leak. Inconsistent with the `ApiError` pattern used elsewhere.
- **Recommended fix:** Throw `ApiError(502, 'provider_unavailable', 'provider_error')` so responses are consistent and safe.

### 19. Dead rate limiter on token routes
- **Severity:** Low
- **File:** `server/src/index.ts` (lines 96, 98)
- **Explanation:** `app.use('/api/telnyx/token', strictLimiter)` and `app.use('/api/twilio/token', strictLimiter)` are registered *before* `app.use('/api/telnyx', telnyxRouter)` / `app.use('/api/twilio', twilioRouter)`. Because the specific `/token` sub-router is mounted later, the limiter matches the path but the actual handler is on the router mounted after — Express still applies the limiter to the path, so it *does* work, but it's fragile/confusing. (Verified: path-based `app.use` applies regardless of mount order for the same path prefix.) Lower severity, but worth consolidating: mount `strictLimiter` *inside* the routers on the `/token` route directly.
- **Recommended fix:** Apply `strictLimiter` directly on the `POST /token` route definitions for clarity and guaranteed scoping.

### 20. Search wildcard injection
- **Severity:** Low
- **File:** `server/src/routes/leads.ts` (line 56)
- **Explanation:** `searchTerm = %${search.trim()}%` is interpolated into an `or(...ilike.*%term%*)` filter. PostgREST `ilike` treats `%` and `_` as wildcards; a user searching for `_` or `%` gets unexpected matches, and a very long/complex term can be a minor ReDoS/perf issue.
- **Recommended fix:** Escape `%`/`_` in user input before building the pattern (replace with `\%`/`\_` and use the `escape` option), and cap search length.

---

## Authentication (summary)
- `requireAuth` decodes (not verifies) the JWT and injects an RLS-scoped InsForge client. Works, but the signature-verification gap (#2) means the server trusts claims it shouldn't. InsForge RLS is the real enforcement layer.
- `req.user` is typed `any` — no compile-time safety on user shape.

## Rate Limiting (summary)
- Global `apiLimiter` (100/min/IP) + `strictLimiter` (10/min) intended for token routes. Global limiter is reasonable; bulk/assign endpoints need their own stricter limit (#14). `trust proxy` not set (#8) weakens IP-based limiting behind a proxy.

## Environment Variables (summary)
- Code reads `INSFORGE_URL`, `INSFORGE_ANON_KEY`, `JWT_SECRET`, `FRONTEND_URL`, `PORT`, `VITE_*` (for client build). `.env.example` uses different names (#16). Hardcoded fallback in `lib/insforge.ts` (#1) is the most dangerous. `JWT_SECRET` is loaded but **never used** for verification (#2) — dead config that gives a false sense of security.

## Logging (summary)
- Ad-hoc `console.log`/`console.error` throughout (`[calls/log]`, `[telnyx/token]`, etc.). No levels, no request correlation, no redaction. Adequate for dev, insufficient for production observability (#12).

## Validation (summary)
- Zod is used consistently at every route boundary (good). Gaps: numeric typing (#15), search escaping (#20), and the `campaign/:id` ownership check (#3).

## Database Queries (summary)
- All via InsForge PostgREST client; RLS by `user_id`. Issues: missing `call_logs`/RPC (#10), non-atomic recount (#9), potential cross-tenant read on campaign leads (#3), and no pagination cap enforcement beyond `min(100)` on leads list (acceptable).

---

*End of AUDIT_02_BACKEND.md — inspection complete, no source files were modified.*