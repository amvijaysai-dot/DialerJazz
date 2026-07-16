# AUDIT_04_DATABASE.md

**DialerJazz — PostgreSQL Database Audit**
*Inspection-only. No schema was modified. Findings derived from live inspection of the InsForge-managed Postgres instance (`public` + `auth` schemas) via a direct `postgres` connection.*

---

## Summary Table

| # | Severity | Area | Finding |
|---|----------|------|---------|
| 1 | **Critical** | RLS / Security | Row-Level Security is **DISABLED on every table** (public + auth); **zero policies** exist. Tenant isolation relies 100% on app code. |
| 2 | **Critical** | Missing object | `call_logs` table **does not exist** → `POST /api/calls/log`, `GET /api/calls`, `GET /api/calls/stats`, `GET /api/stats/dashboard` all 500. |
| 3 | **High** | Missing object | `increment_campaign_calls(uuid)` RPC **does not exist** → campaign progress counter never updates. |
| 4 | **High** | Schema/App mismatch | `campaigns.leads_called` column **does not exist**, but the frontend `Campaign` type and dashboard expect it. |
| 5 | **High** | Security | `user_settings` stores provider **secrets in plaintext** (telnyx_sip_password, twilio_auth_token, twilio_api_secret…) with no encryption. |
| 6 | **Medium** | Constraints | `leads.phone` has no format/CHECK constraint; `status`/`dialer_mode`/`provider` are free-text `text` with no `CHECK` enum constraint (typos silently accepted). |
| 7 | **Medium** | Indexes | No index on `leads(status)`, `leads(created_at)` (used for ordering), `campaign_leads(user_id)`, or `call_logs(user_id, created_at)` (when added). |
| 8 | **Medium** | Normalization | `leads` mixes CRM fields + call disposition (`status`) + free `custom_fields` jsonb; `campaigns.total_leads` is a derived count stored redundantly (drift risk). |
| 9 | **Low** | Duplicate tables | No duplicate tables found; only 4 app tables exist (`leads`, `campaigns`, `campaign_leads`, `user_settings`). |
| 10 | **Low** | FK coverage | `user_settings.user_id` has **no FK** to `auth.users`; `leads`/`campaigns` `user_id` also have no FK to `auth.users`. |
| 11 | **Low** | Query perf | `leads` list search uses `or(...ilike.*%term%*)` over 5 text columns with no trigram/GIN index → sequential scan on large datasets. |
| 12 | **Low** | Data integrity | `campaigns.dialer_mode` default `'preview'` but UI advertises power/progressive; no DB enforcement of valid modes. |

---

## Detailed Findings

### 1. Row-Level Security disabled everywhere, no policies
- **Severity:** Critical
- **Area:** RLS / Security
- **Explanation:** `relrowsecurity = false` for **all** tables in `public` and `auth`, and `pg_policies` returns **(NONE)**. This means Postgres performs **no tenant isolation at the database layer**. The only thing preventing user A from reading user B's leads is the application's `.eq('user_id', req.user.id)` clause — and that clause is only as trustworthy as the (unverified, per backend audit #2) JWT `sub`. If any route forgets the filter, or if a future direct PostgREST/anon access is enabled, **all tenant data is exposed**. InsForge normally enforces RLS, but in this project RLS is off and the app talks via an RLS-scoped client that, with RLS disabled, scopes to nothing.
- **Recommended fix:** Enable RLS on every app table (`ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;`) and create policies keyed on `user_id = auth.uid()` (or the InsForge JWT claim). This makes isolation defense-in-depth rather than app-only. Treat RLS as the real auth boundary, not the middleware.

### 2. `call_logs` table missing
- **Severity:** Critical
- **Area:** Missing object
- **Explanation:** `calls.ts` inserts into `call_logs`; `stats.ts` and `calls.ts` count it. The table does not exist (`ERROR relation "public.call_logs" does not exist`). Every call-log/disposition-save and the dashboard stats endpoint will 500. This is a hard runtime break on a fresh project.
- **Recommended fix:** Create `call_logs` (id uuid pk, user_id uuid NOT NULL, lead_id uuid nullable, campaign_id uuid nullable, provider text, direction text, from_number, to_number, status text, disposition text, disposition_sub text, duration_seconds int, recording_url text, notes text, started_at timestamptz, ended_at timestamptz, created_at timestamptz) with FK to leads/campaigns and an index on (user_id, created_at). Add to a migration + `setup-db.ts`.

### 3. `increment_campaign_calls` RPC missing
- **Severity:** High
- **Area:** Missing object
- **Explanation:** `calls.ts` calls `rpc('increment_campaign_calls', { p_campaign_id })` to atomically bump campaign progress. The function does not exist → that step errors (currently swallowed, see backend audit #11), so `campaigns.total_leads`/`leads_called` never reflect activity.
- **Recommended fix:** Create the function:
  ```sql
  CREATE OR REPLACE FUNCTION increment_campaign_calls(p_campaign_id uuid)
  RETURNS void LANGUAGE sql AS $$
    UPDATE campaigns SET leads_called = COALESCE(leads_called,0) + 1
    WHERE id = p_campaign_id;
  $$;
  ```
  (Requires the `leads_called` column from #4.)

### 4. `campaigns.leads_called` column missing
- **Severity:** High
- **Area:** Schema / App mismatch
- **Explanation:** The frontend `Campaign` interface declares `leads_called: number` and the dashboard/route logic references campaign call progress, but the `campaigns` table has only `total_leads` (no `leads_called`). The column is absent, so any code reading it gets `undefined`, and the RPC in #3 would fail to compile/run.
- **Recommended fix:** Add `leads_called integer NOT NULL DEFAULT 0` to `campaigns` and reconcile the frontend/backend contract.

### 5. Provider secrets stored in plaintext
- **Severity:** High
- **Area:** Security
- **Explanation:** `user_settings` stores `telnyx_sip_password`, `twilio_auth_token`, `twilio_api_secret`, `twilio_api_key` as plain `text` with no encryption/column-level protection. Combined with backend audit #4 (these are returned to the client) and #1 (no RLS), a single DB read or misconfigured client exposes all users' telephony credentials.
- **Recommended fix:** At minimum enable RLS (#1) and stop returning secrets to the client (#4 backend). Ideally encrypt secret columns (pgcrypto) or store only references to a secrets manager. Never return `auth_token`/`api_secret`/`sip_password` over the API.

### 6. Weak column constraints
- **Severity:** Medium
- **Area:** Constraints
- **Explanation:** `leads.phone` is `text NOT NULL` with no format CHECK — garbage/non-E.164 values are accepted (the Twilio webhook does validate caller ID, but lead phone is never validated). `leads.status`, `campaigns.dialer_mode`, `campaigns.provider`, `campaigns.status` are free `text` with no `CHECK` constraint, so typos (`"activ"`) are stored and silently break filtering/UI logic.
- **Recommended fix:** Add `CHECK (status IN ('new','calling','answered','no_answer','voicemail','busy','failed','dnc'))` to `leads`; similar enums for `campaigns` mode/provider/status; add a `CHECK (phone ~ '^\+?[0-9\s\-()]{7,20}$')` or normalize to E.164 on write.

### 7. Missing indexes
- **Severity:** Medium
- **Area:** Indexes / Query performance
- **Explanation:** Present indexes: PKs, `leads(user_id)`, `leads(user_id,phone)` unique, `campaigns(user_id)`, `campaign_leads(campaign_id)`, `campaign_leads(lead_id)`. **Missing:** `leads(status)` (filtered list queries), `leads(created_at)` (the `order by created_at` in every list), `campaign_leads(user_id)` (the junction is filtered by user_id), and once `call_logs` exists, `call_logs(user_id, created_at)`.
- **Recommended fix:** Add `CREATE INDEX ON leads(status);`, `CREATE INDEX ON leads(created_at DESC);`, `CREATE INDEX ON campaign_leads(user_id);`, and after creating `call_logs`, `CREATE INDEX ON call_logs(user_id, created_at DESC);`.

### 8. Normalization / derived data
- **Severity:** Medium
- **Area:** Normalization
- **Explanation:** `leads` conflates CRM attributes with call-disposition state (`status` doubles as both "lead stage" and "last call outcome"). `campaigns.total_leads` is a redundant aggregate maintained by app code (race-prone, backend audit #9). `custom_fields` jsonb is a reasonable escape hatch but unvalidated.
- **Recommended fix:** Consider separating `lead_stage` from `last_disposition`. Replace `campaigns.total_leads` with a view/trigger-computed count, or keep it but maintain it via a single atomic statement (backend audit #9).

### 9. No duplicate tables
- **Severity:** Low
- **Area:** Duplicate tables
- **Explanation:** Only 4 app tables exist (`leads`, `campaigns`, `campaign_leads`, `user_settings`); no duplicates or shadow copies. (Note: `call_logs` is *expected* but absent — see #2.)
- **Recommended fix:** None for duplicates. Create the missing `call_logs`.

### 10. Missing foreign keys to `auth.users`
- **Severity:** Low
- **Area:** Foreign keys
- **Explanation:** `leads.user_id`, `campaigns.user_id`, `campaign_leads.user_id`, and `user_settings.user_id` are `uuid NOT NULL` but have **no FK** to `auth.users`. Orphaned rows are possible if a user is deleted without cascading. `campaign_leads` correctly FKs to `campaigns`/`leads` (with `ON DELETE CASCADE`), which is good.
- **Recommended fix:** Add `REFERENCES auth.users(id) ON DELETE CASCADE` to the four `user_id` columns (requires `auth.users` to be referenceable; InsForge manages it, so confirm InsForge permits FK to it — if not, enforce via app/trigger).

### 11. Search query performance
- **Severity:** Low
- **Area:** Query performance
- **Explanation:** `leads` list search builds `or(first_name.ilike.%term%*, …)` across 5 columns. Without a trigram (`pg_trgm`) or GIN index this is a sequential scan; on large lead tables it will be slow. Pagination caps at 100 rows so it's bounded, but latency grows with table size.
- **Recommended fix:** Add a `pg_trgm` GIN index (`CREATE INDEX … USING gin (first_name gin_trgm_ops, …)`) or a single `tsvector` search column for leads, and escape `%`/`_` wildcards (backend audit #20).

### 12. Dialer-mode semantics
- **Severity:** Low
- **Area:** Data integrity
- **Explanation:** `campaigns.dialer_mode` defaults to `'preview'` and the UI offers power/progressive (disabled stubs). No DB constraint prevents invalid modes, and the default doesn't match the product's "power dialer" positioning.
- **Recommended fix:** Add a `CHECK` constraint enumerating valid modes and align the default with intended behavior once power/progressive are implemented.

---

## Schema Overview (as inspected)

**public.leads** — id (pk), user_id, first_name, last_name, company, phone (NOT NULL), email, website, linkedin_url, google_maps_url, address, city, state, zip, google_rating (numeric), review_count (int), business_category, notes, tags (text[]), status (NOT NULL default 'new'), priority (int default 0), custom_fields (jsonb), created_at, updated_at. PK + UNIQUE(user_id, phone) + idx(user_id).

**public.campaigns** — id (pk), user_id, name (NOT NULL), dialer_mode (NOT NULL default 'preview'), provider (NOT NULL default 'telnyx'), caller_number, status (NOT NULL default 'draft'), total_leads (int default 0), created_at, updated_at. PK + idx(user_id). **No `leads_called`.**

**public.campaign_leads** — id (pk), campaign_id (FK→campaigns ON DELETE CASCADE), lead_id (FK→leads ON DELETE CASCADE), user_id, created_at. UNIQUE(campaign_id, lead_id) + idx(campaign_id) + idx(lead_id). **No idx(user_id).**

**public.user_settings** — user_id (pk), telnyx_api_key, telnyx_sip_login, telnyx_sip_password, telnyx_caller_number, twilio_account_sid, twilio_auth_token, twilio_api_key, twilio_api_secret, twilio_twiml_app_sid, twilio_caller_number, default_provider (default 'telnyx'), created_at, updated_at. PK only. **No FK to auth.users; secrets in plaintext.**

**auth.users** (InsForge-managed) — id (pk), email (unique), password, email_verified, created_at, updated_at, profile (jsonb), metadata (jsonb), is_project_admin, is_anonymous. RLS **off**.

**Missing:** `public.call_logs` (referenced by calls/stats routes), `increment_campaign_calls` RPC.

**Current data:** leads=2 (our import), campaigns=0, campaign_leads=0, user_settings=0, call_logs=error.

---

## Security Assessment (summary)
- **RLS off + no policies (#1)** is the dominant risk: the database trusts the application entirely. Any app bug, forgotten `user_id` filter, or future direct DB access exposes cross-tenant data.
- **Plaintext secrets (#5)** in `user_settings` compound the exposure.
- The `raw_sql` RPC referenced by `migrate_twilio.ts` is **not** present in this instance (good — no anon SQL-exec hole), but the migration script would simply fail.
- InsForge's own `auth.*` tables also have RLS off, which is expected for managed auth internals but means the `postgres` role (used by our import script) has full read access — acceptable for admin tooling, dangerous if that role's credentials leak.

## Recommendations (priority order)
1. **Enable RLS + create policies** on all `public` tables (#1) — the single highest-impact fix.
2. **Create `call_logs` + `increment_campaign_calls` + `campaigns.leads_called`** (#2, #3, #4) so the app's core call-logging path works.
3. **Stop returning/storing secrets in plaintext**; encrypt or vault (#5, backend #4).
4. Add **CHECK constraints** for enums/phone and **missing indexes** (#6, #7).
5. Add **FKs to auth.users** and a **trigram search index** (#10, #11).

---

*End of AUDIT_04_DATABASE.md — inspection complete, no schema was modified.*