# PostgreSQL Production Readiness Audit Report
## DialerJazz — Multi-Tenant AI Voice SaaS Platform

**Audit Date:** 2026-07-19  
**Auditor:** Senior PostgreSQL Database Architect & Principal Backend Engineer  
**Scope:** Complete PostgreSQL implementation audit (connection pool, queries, transactions, indexes, foreign keys, multi-tenant safety, performance, security, CSV import, call logs)

---

## Executive Summary

The PostgreSQL implementation uses a **dual-access pattern**:
1. **InsForge Gateway (PostgREST)** — for simple CRUD with RLS enforcement
2. **Direct PostgreSQL (`pg.Pool`)** — for complex JOINs, bulk operations, junction tables

**Overall Production Readiness Score: 5.5/10** — Significant critical issues require immediate attention before production deployment.

---

## 1. Database Layer Audit

### Connection Pool (`server/src/lib/db.ts`)

| Aspect | Current State | Production Ready? | Issues |
|--------|---------------|-------------------|--------|
| **Pool Configuration** | `max: 10`, `ssl: { rejectUnauthorized: false }` | ⚠️ Partial | No `idleTimeoutMillis`, `connectionTimeoutMillis`, `maxUses` |
| **Retry Handling** | None | ❌ No | No automatic retry on transient failures |
| **Error Handling** | Throws on missing env vars | ⚠️ Partial | No graceful degradation, no circuit breaker |
| **Transaction Support** | Not exposed | ❌ No | `getDbPool()` returns raw pool, no transaction helper |
| **Health Checks** | None | ❌ No | No `pool.on('error')` handler, no health endpoint |
| **Pool Monitoring** | None | ❌ No | No metrics for active/idle/waiting connections |

**Critical Issues:**
1. **No connection timeout** — Hung connections can exhaust pool
2. **No idle timeout** — Stale connections accumulate
3. **No retry logic** — Transient network blips cause 500s
4. **No transaction API** — Callers must manually `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`
5. **SSL `rejectUnauthorized: false`** — Accepts any cert (MITM risk in non-VPC environments)

### Direct PostgreSQL vs InsForge Gateway Usage

| Route File | Uses `getDbPool()` | Uses `req.db` (InsForge) | Notes |
|------------|-------------------|-------------------------|-------|
| `leads.ts` | 4 endpoints | 2 endpoints | Mixed pattern |
| `campaigns.ts` | 5 endpoints | 2 endpoints | Mixed pattern |
| `calls.ts` | 1 endpoint (POST /log) | 2 endpoints | Mixed pattern |
| `settings.ts` | 4 endpoints | 5 endpoints | Mixed pattern |
| `stats.ts` | 0 | 1 endpoint | InsForge only |

---

## 2. SQL Queries Audit

### Parameterized Queries — ✅ PASS
All queries use `$1, $2...` parameterization. **No string interpolation found.**

### SQL Injection Risk — ✅ PASS
No dynamic SQL construction with user input. All values parameterized.

### Query Analysis by `pg` driver.

### JOIN Usage — ⚠️ REVIEW NEEDED

| File | Query | Issue |
|------|-------|-------|
| `leads.ts:178-225` | `campaign_leads` JOIN `leads` | 34 columns selected — consider selecting only needed columns |
| `calls.ts:88-109` | `call_logs` with nested `leads` + `campaigns` | PostgREST embedded resources — efficient but fetches all columns |

### ORDER BY / LIMIT / OFFSET — ⚠️ PARTIAL

| Endpoint | Pagination | Issue |
|----------|------------|-------|
| `GET /leads` | `range(offset, offset+perPage-1)` | ✅ Keyset pagination would be better for deep pages |
| `GET /leads/campaign/:id` | `LIMIT $3 OFFSET $4` | ⚠️ OFFSET degrades with large offsets |
| `GET /calls` | `range()` | ✅ PostgREST handles efficiently |
| `GET /campaigns` | `range()` | ✅ PostgREST handles efficiently |

### N+1 Queries — ❌ FOUND

| Location | Pattern | Impact |
|----------|---------|--------|
| `leads.ts:114-129` | Loop with individual `INSERT` per lead | **N+1 on bulk insert** — 2000 leads = 2000 round-trips |
| `leads.ts:136-143` | Loop with individual `INSERT` to junction table | **N+1 on campaign_leads** |
| `leads.ts:262-268` | Loop with individual `INSERT` for assign | **N+1 on assign** |
| `calls.ts:52-71` | Sequential queries per call log | 3 queries per call log entry |

---

## 3. Transactions Audit

### Operations Requiring Transactions

| Operation | Current State | Required? | Risk |
|-----------|---------------|-----------|------|
| **CSV Import** (`setup-db.ts` / `import-leads.js`) | ❌ No transaction | **YES** | Partial import on failure |
| **Lead Bulk Insert** (`leads.ts:96-161`) | ❌ No transaction | **YES** | Orphaned leads / junction rows |
| **Lead Assign** (`leads.ts:253-287`) | ❌ No transaction | **YES** | Inconsistent campaign_leads + count |
| **Campaign Create** (`campaigns.ts:68-94`) | ❌ No transaction | **YES** | Single INSERT — low risk but should wrap |
| **Call Log + Lead Update + Campaign Counter** (`calls.ts:21-78`) | ❌ No transaction | **YES** | Inconsistent state if any step fails |
| **Settings Upsert** (`settings.ts:43-104`) | ❌ No transaction | **YES** | Single upsert — low risk |

### Transaction Implementation Gap
- **No transaction helper** in `db.ts`
- **No `BEGIN`/`COMMIT`/`ROLLBACK`** anywhere in route handlers
- **`import-leads.js`** does chunked inserts but **no transaction per chunk**

---

## 4. Index Analysis

### Current Indexes (from `setup-db.ts`)

| Table | Indexes | Missing Critical Indexes |
|-------|---------|-------------------------|
| `leads` | `user_id` | `(user_id, status)`, `(user_id, created_at DESC)`, `(user_id, phone)` — **already unique** |
| `campaigns` | `user_id` | `(user_id, status)`, `(user_id, created_at DESC)` |
| `campaign_leads` | `campaign_id`, `lead_id` | **Missing:** `(campaign_id, user_id)` for `DELETE`/`COUNT` queries |
| `call_logs` | `user_id`, `(user_id, created_at DESC)`, `campaign_id` | **Missing:** `(user_id, lead_id)`, `(lead_id, created_at DESC)` |
| `user_settings` | PK on `user_id` | ✅ Complete |

### Recommended Indexes with Justification

```sql
-- leads: Filter by user + status (common in dashboard, dialer)
CREATE INDEX leads_user_status_idx ON public.leads (user_id, status);

-- leads: Pagination by created_at (dashboard, lists)
CREATE INDEX leads_user_created_idx ON public.leads (user_id, created_at DESC);

-- campaign_leads: Count by campaign + user (used in leads.ts:171, campaigns.ts:146)
CREATE INDEX campaign_leads_campaign_user_idx ON public.campaign_leads (campaign_id, user_id);

-- call_logs: Lead call history (dialer, lead detail)
CREATE INDEX call_logs_lead_created_idx ON public.call_logs (lead_id, created_at DESC);

-- call_logs: User + lead lookup (stats, filtering)
CREATE INDEX call_logs_user_lead_idx ON public.call_logs (user_id, lead_id);

-- campaigns: Status filtering (dashboard, lists)
CREATE INDEX campaigns_user_status_idx ON public.campaigns (user_id, status);
```

### Index Impact Estimate
| Index | Query Improved | Est. Speedup |
|-------|----------------|--------------|
| `leads_user_status_idx` | `GET /leads?status=...`, dialer next-lead | 10-100x |
| `leads_user_created_idx` | `GET /leads` pagination, dashboard | 5-50x |
| `campaign_leads_campaign_user_idx` | `GET /leads/campaign/:id`, campaign stats | 10-100x |
| `call_logs_lead_created_idx` | Lead call history, dialer context | 10-50x |

---

## 5. Foreign Keys Audit

### Current FKs (from `setup-db.ts`)

| Table | FK | On Delete | On Update |
|-------|----|-----------|-----------|
| `campaign_leads.campaign_id` → `campaigns.id` | ✅ | `CASCADE` | (default) |
| `campaign_leads.lead_id` → `leads.id` | ✅ | `CASCADE` | (default) |
| `call_logs.lead_id` → `leads.id` | ✅ | `SET NULL` | (default) |
| `call_logs.campaign_id` → `campaigns.id` | ✅ | `SET NULL` | (default) |

### Issues

| Issue | Severity | Details |
|-------|----------|---------|
| **No FK on `leads.user_id`** | 🔴 Critical | References `auth.users` but no FK — orphan risk if user deleted |
| **No FK on `campaigns.user_id`** | 🔴 Critical | Same — orphan campaigns |
| **No FK on `call_logs.user_id`** | 🔴 Critical | Orphan call logs |
| **No FK on `user_settings.user_id`** | 🔴 Critical | Orphan settings |
| **`campaign_leads.user_id` redundant** | 🟡 Medium | Denormalized — not enforced, can drift from `campaigns.user_id` |

### Orphan Record Risk
**HIGH** — If a user is deleted from `auth.users` (via InsForge dashboard or API), all their `leads`, `campaigns`, `call_logs`, `user_settings` become orphans with no cascade cleanup.

---

## 6. Multi-Tenant Safety Audit

### Current Isolation Mechanism
- **InsForge Gateway (RLS):** Enforced by PostgREST policies (not visible in code)
- **Direct PostgreSQL:** Manual `WHERE user_id = $1` in every query

### Query-by-Query Tenant Isolation Check

| File | Endpoint | Isolation Method | Safe? |
|------|----------|------------------|-------|
| `leads.ts:49-52` | `GET /leads` | `req.db.from('leads').eq('user_id', req.user.id)` | ✅ |
| `leads.ts:121-127` | `POST /leads/bulk` | `user_id: req.user.id` in INSERT | ✅ |
| `leads.ts:171-174` | `GET /leads/campaign/:id` | `WHERE cl.campaign_id=$1 AND cl.user_id=$2` | ✅ |
| `leads.ts:263-268` | `POST /leads/assign` | `user_id: req.user.id` in INSERT | ✅ |
| `leads.ts:319-347` | `PATCH /leads/:id/disposition` | `WHERE id=$10 AND user_id=$11` | ✅ |
| `campaigns.ts:73-84` | `POST /campaigns` | `user_id: req.user.id` | ✅ |
| `campaigns.ts:102-108` | `PATCH /campaigns/:id/status` | `WHERE id=$2 AND user_id=$3` | ✅ |
| `calls.ts:31-46` | `POST /calls/log` | `userId` in INSERT + subsequent queries | ✅ |
| `settings.ts:88-94` | `PUT /settings` | `user_id: req.user.id` in upsert | ✅ |

### Critical Gap: **No RLS on Direct PostgreSQL**
The `pg.Pool` connects as **`postgres` superuser** (bypasses RLS entirely). **All tenant isolation depends on application code correctly adding `user_id` filters.**

**Risk:** Single missing `AND user_id = $X` = **full tenant data leak**.

### Recommendation
1. **Enable RLS on all tables** even for direct connections
2. **Use `SET LOCAL ROLE`** or `SET app.current_user_id` with RLS policies
3. **Add automated test** verifying cross-tenant query returns zero rows

---

## 7. Performance Audit

### N+1 Query Problems (Critical)

| Location | Operation | Current | Optimized |
|----------|-----------|---------|-----------|
| `leads.ts:114-129` | Bulk lead upsert | 1 query/lead | **Single `INSERT ... VALUES (...), (...)`** |
| `leads.ts:136-143` | Junction table insert | 1 query/lead | **Single multi-row INSERT** |
| `leads.ts:262-268` | Assign existing leads | 1 query/lead | **Single multi-row INSERT** |
| `calls.ts:52-71` | Call log + lead update + campaign counter | 3 sequential | **Single transaction, consider CTE** |

### Unnecessary Joins / Over-fetching

| Location | Issue |
|----------|-------|
| `leads.ts:178-218` | Selects 34 columns — dialer likely needs only 10-15 |
| `calls.ts:88-109` | PostgREST embedded resources fetch all columns of `leads` + `campaigns` |

### Pagination Strategy

| Endpoint | Method | Scalability |
|----------|--------|-------------|
| `GET /leads` | PostgREST `range()` | ✅ Good (keyset via cursor would be better) |
| `GET /leads/campaign/:id` | `LIMIT/OFFSET` | ❌ Degrades >10k rows |
| `GET /calls` | PostgREST `range()` | ✅ Good |
| `GET /campaigns` | PostgREST `range()` | ✅ Good |

### Memory Usage
- `leads.ts:114-129` builds entire `leadsToUpsert` array in memory (max 2000) — acceptable
- `import-leads.js` processes in chunks of 500 — good

---

## 8. Repository Structure Audit

### Current Structure
```
server/
├── src/
│   ├── lib/
│   │   ├── db.ts           # Direct pg.Pool (singleton)
│   │   └── insforge.ts     # InsForge admin client
│   ├── routes/
│   │   ├── leads.ts        # Mixed: InsForge + direct PG
│   │   ├── campaigns.ts    # Mixed: InsForge + direct PG
│   │   ├── calls.ts        # Mixed: InsForge + direct PG
│   │   ├── settings.ts     # Mixed: InsForge + direct PG
│   │   └── stats.ts        # InsForge only
│   └── middleware/
│       └── auth.ts         # Attaches req.db (InsForge)
├── setup-db.ts             # Direct PG DDL
└── import-leads.js         # Direct PG bulk import
```

### Issues
1. **No Data Access Layer** — SQL scattered across route handlers
2. **No Query Builder/Repository** — Raw SQL strings, no type safety
3. **Dual Client Confusion** — `req.db` (InsForge) vs `getDbPool()` (direct PG)
4. **No Migration System** — `setup-db.ts` is one-time, no versioning
5. **No Transaction Abstraction** — Manual `pool.connect()` required

### Recommended Structure
```
server/src/
├── db/
│   ├── pool.ts           # pg.Pool with config, health, metrics
│   ├── transaction.ts    # withTransaction(callback) helper
│   └── repositories/
│       ├── leads.repo.ts
│       ├── campaigns.repo.ts
│       ├── calls.repo.ts
│       └── settings.repo.ts
├── routes/               # Thin handlers calling repositories
└── migrations/           # Versioned SQL migrations
```

---

## 9. CSV Import Audit (`server/import-leads.js` + `setup-db.ts`)

### Current Implementation Issues

| Aspect | Current | Production Requirement | Gap |
|--------|---------|------------------------|-----|
| **Batching** | 500 rows/chunk | ✅ Good | — |
| **Transactions** | ❌ None per chunk | **Required** | Partial import on failure |
| **Duplicate Detection** | `ON CONFLICT (user_id, phone)` | ✅ Good | — |
| **Validation** | Zod schema in routes only | **Required in import** | Invalid CSV rows crash import |
| **Rollback** | ❌ None | **Required** | No cleanup on failure |
| **Memory** | Loads entire CSV | ⚠️ Large files OOM | Stream processing |
| **Progress/Resume** | ❌ None | Nice-to-have | No resume capability |
| **Error Reporting** | Console only | **Required** | No per-row error log |

### `setup-db.ts` Issues
- **No migrations** — `CREATE TABLE IF NOT EXISTS` only
- **No rollback** — Failed partial setup leaves DB in unknown state
- **Runs as `postgres` superuser** — Security risk

---

## 10. Call Logs Audit (`server/src/routes/calls.ts`)

### Storage Strategy
- **Table:** `call_logs` (1 row per call)
- **Indexes:** `user_id`, `(user_id, created_at DESC)`, `campaign_id`
- **Retention:** None defined

### Projected Scale
| Metric | Estimate |
|--------|----------|
| Users | 1,000 |
| Calls/user/day | 100 |
| Daily inserts | 100,000 |
| Monthly rows | 3,000,000 |
| Yearly rows | 36,000,000 |

### Issues at Scale
1. **No partitioning** — 36M rows in single table = slow queries, vacuum issues
2. **No archival** — Hot/cold separation needed
3. **Missing indexes** for lead-centric queries (see Index Analysis)
4. **No compression** — `notes` (5000 chars) + `recording_url` bloat table

### Recommended Strategy
```sql
-- Partition by month
CREATE TABLE call_logs (
  ...
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE call_logs_2026_01 PARTITION OF call_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Archive policy: detach partitions > 12 months
-- Compress old partitions (pg_compress, timescaledb, or columnar)
```

---

## 11. Security Audit

### SQL Injection — ✅ PASS
All queries use parameterized `$1, $2...` — no string interpolation.

### Secrets Handling — ⚠️ PARTIAL

| Secret | Location | Risk |
|--------|----------|------|
| `DB_PASSWORD` | `server/.env`, Railway vars | ✅ Standard |
| `INSFORGE_SERVICE_KEY` | `server/.env`, Railway vars | ✅ Standard |
| `JWT_SECRET` | `.env`, Railway vars | ✅ Standard |
| **SSL `rejectUnauthorized: false`** | `db.ts:50` | 🔴 **MITM risk** |

### Error Leakage — ⚠️ PARTIAL
- `ApiError` exposes `error.message` from PG — may leak schema details
- `settings.ts` has extensive `console.log` with **full SQL + values** — **secrets in logs!**

### Authorization — ✅ PASS
- All routes use `requireAuth` middleware
- User ID extracted from JWT, used in all queries

### Input Validation — ✅ PASS
- Zod schemas on all write endpoints
- UUID validation on ID params

### Sensitive Logging — 🔴 CRITICAL
```typescript
// settings.ts:45-98 — LOGS FULL SQL WITH VALUES INCLUDING SECRETS
console.log("3. updatePayload:", JSON.stringify(updatePayload, null, 2));
// Contains: telnyx_sip_password, twilio_auth_token, twilio_api_secret
```

---

## 12. Production Readiness Scores

| Category | Score (1-10) | Rationale |
|----------|--------------|-----------|
| **Database Layer** | 4 | No pool tuning, no retry, no transactions, no health checks |
| **Connection Pool** | 3 | Default config, no timeouts, no monitoring |
| **SQL Queries** | 7 | Parameterized, but N+1s, over-fetching, OFFSET pagination |
| **Indexes** | 4 | Missing critical composite indexes for query patterns |
| **Transactions** | 2 | **Zero transactions** on multi-step operations |
| **Foreign Keys** | 3 | Missing FKs on all `user_id` columns, orphan risk |
| **Multi-Tenant Safety** | 5 | App-level only, no RLS on direct PG, single bug = data leak |
| **Performance** | 4 | N+1 queries, no partitioning, no keyset pagination |
| **Architecture** | 4 | No DAL, dual client confusion, no migrations |
| **Maintainability** | 4 | SQL in routes, no type safety, no repository pattern |
| **Scalability** | 3 | No partitioning, no read replicas, connection pool limits |
| **Security** | 5 | SQL injection OK, but secrets in logs, SSL misconfig |
| **CSV Import** | 3 | No transactions, no validation, no streaming |
| **Call Logs** | 3 | No partitioning, no retention, missing indexes |

**Overall: 4.1/10** — **Not production-ready**

---

## Prioritized Recommendations

### 🔴 CRITICAL (Do Before Launch)

| # | Issue | Effort | Risk if Unfixed |
|---|-------|--------|-----------------|
| 1 | **Add transactions** to all multi-step operations (bulk insert, assign, call log) | 2-3 days | Data corruption, inconsistent state |
| 2 | **Enable RLS on all tables** + use `SET LOCAL app.current_user_id` for direct PG | 2-3 days | **Full tenant data leak** from single bug |
| 3 | **Add FKs on all `user_id` columns** with `ON DELETE CASCADE` | 1 day | Orphan data, referential integrity |
| 4 | **Remove secret logging** in `settings.ts` | 30 min | Credentials in logs |
| 5 | **Fix SSL config** — use `rejectUnauthorized: true` with CA cert | 1 hour | MITM on DB connection |
| 6 | **Add critical composite indexes** (6 indexes) | 1 hour | Query timeouts at scale |

### 🟠 HIGH PRIORITY (Week 1-2)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 7 | **Fix N+1 queries** — batch inserts in `leads.ts`, `calls.ts` | 2 days | 10-100x throughput |
| 8 | **Add connection pool tuning** (timeouts, maxUses, health checks) | 4 hours | Stability under load |
| 9 | **Implement transaction helper** in `db.ts` | 4 hours | Enables #1 |
| 10 | **Keyset pagination** for `GET /leads/campaign/:id` | 1 day | Deep page performance |
| 11 | **Call logs partitioning** (monthly) | 2 days | Scalability to millions |
| 12 | **CSV import transactions + validation + streaming** | 2 days | Reliable bulk ops |

### 🟡 MEDIUM PRIORITY (Month 1)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 13 | **Repository layer** — extract SQL from routes | 1 week | Maintainability, testability |
| 14 | **Migration system** (golang-migrate, node-pg-migrate) | 2 days | Schema versioning |
| 15 | **Read replica support** in pool config | 1 day | Read scaling |
| 16 | **Query metrics / slow query logging** | 1 day | Observability |
| 17 | **Automated tenant isolation tests** | 2 days | Regression prevention |

### 🟢 NICE TO HAVE (Quarter 1)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 18 | **Columnar storage** for call_logs (TimescaleDB, pg_analytics) | 1 week | Analytics performance |
| 19 | **Prepared statement caching** | 2 days | CPU reduction |
| 20 | **Connection pool metrics endpoint** | 4 hours | Operations visibility |
| 21 | **Automated index advisor** (pg_stat_statements + hypopg) | 1 week | Continuous optimization |

---

## Time & Risk Estimates

| Phase | Duration | Risk Level | Expected Gain |
|-------|----------|------------|---------------|
| **Critical Fixes** | 1-2 weeks | Low (additive) | **Production deployable** |
| **High Priority** | 2-3 weeks | Medium (refactor) | **10-100x query perf, stability** |
| **Medium Priority** | 4-6 weeks | Medium (architectural) | **Maintainability, observability** |
| **Nice to Have** | 8-12 weeks | Low | **Long-term scalability** |

---

## Appendix: Files Requiring Changes

### Critical (Must Fix)
1. `server/src/lib/db.ts` — Pool config, transaction helper, health checks
2. `server/src/routes/leads.ts` — Transactions, batch inserts, indexes
3. `server/src/routes/campaigns.ts` — Transactions
4. `server/src/routes/calls.ts` — Transactions, batch lead update
5. `server/src/routes/settings.ts` — **Remove secret logging**, transactions
6. `server/setup-db.ts` — Add FKs, RLS policies, indexes, partitioning
7. `server/import-leads.js` — Transactions, validation, streaming

### High Priority
8. `server/src/middleware/auth.ts` — Add `SET LOCAL app.current_user_id` for RLS
9. `server/src/routes/stats.ts` — Add missing indexes for performance

---

## Conclusion

The current implementation **works for development** but has **critical gaps** for production:
- **No transactions** = data corruption risk
- **No RLS on direct PG** = tenant isolation bypassable
- **No FKs** = orphan data
- **N+1 queries** = won't scale
- **Secrets in logs** = compliance violation

**Recommendation:** Address all 🔴 CRITICAL items before any production traffic. The fixes are well-understood, low-risk, and high-impact.