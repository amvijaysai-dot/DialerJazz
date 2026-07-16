# AUDIT_08_PERFORMANCE.md

**DialerJazz — Performance Audit**
*Inspection-only. No source files were modified.*

Scope: React rendering, Database queries, API latency, Memory usage, Worker performance, Queue performance, Caching, Bundle size, Lazy loading, Code splitting.

> **Headline:** Performance is acceptable at small scale but has clear scaling ceilings. The dialer loads **up to 500 leads into client memory** with no virtualization (frontend audit #1); the server has **no caching, no workers, no queue** (it's a thin PostgREST proxy); DB queries are **unindexed for the common search/order/filter paths** (DB audit #7); and the client does **no code splitting / lazy loading** (frontend audit #12) with a **render-blocking Google Fonts `@import`** (frontend audit #8). None of these are bugs today, but each becomes a bottleneck as data/usage grows.

## Summary Table

| # | Severity | Area | Finding |
|---|----------|------|---------|
| 1 | **High** | React rendering | `CampaignDialerPage` loads up to 500 leads into state; swipe deck renders Framer Motion cards with no virtualization. Jank/memory at scale. |
| 2 | **High** | Database queries | No index on `leads(status)`, `leads(created_at)` (used for `order by`), `campaign_leads(user_id)`; `call_logs` (when added) needs `(user_id, created_at)`. Search uses 5-col `ilike` with no trigram index → seq scan. |
| 3 | **High** | Bundle size / Code splitting | No `React.lazy`/`Suspense`; all pages in one initial bundle. No manual chunking in `vite.config.ts`. |
| 4 | **Medium** | API latency | No client cache (no React Query/SWR). `calls/log` does 3 sequential DB round-trips. |
| 5 | **Medium** | Caching | **No caching anywhere** — no Redis, no in-memory cache, no HTTP `Cache-Control`/`ETag`. |
| 6 | **Medium** | Memory usage | `useTelnyxCall` is a dead duplicate Telnyx client (leak risk if mounted). 500-lead array + 5-col `ilike` on large tables. |
| 7 | **Medium** | React rendering | Render-blocking Google Fonts `@import` in `index.css`. `console.log` in hot path. |
| 8 | **Low** | Worker performance | N/A — no workers exist (call-engine audit #1). |
| 9 | **Low** | Queue performance | N/A — no queue exists. Bulk import inline (3 sequential round-trips) with non-atomic recount. |
| 10 | **Low** | Lazy loading | No route-level lazy loading; no image lazy-loading on avatars. |
| 11 | **Low** | React rendering | `getTagColor` recomputes hash every render; client-side refilter duplicates server search. |
| 12 | **Low** | API latency | `listByCampaign` accepts unbounded `limit` from client. |

## Detailed Findings

### 1. Dialer loads 500 leads into memory, no virtualization (High)
- **File:** `client/src/pages/CampaignDialerPage.tsx` (lines 84–92)
- **Explanation:** `loadData` calls `leadsApi.listByCampaign(campaignId, { limit: 500 })` and stores all leads in `useState`. The full 500-element array lives in memory and is re-filtered each render for progress counts. Fine at 500; at 5k–50k it janks and bloats memory on WebRTC devices.
- **Optimization:** Virtualize the deck (mount only current ±2 cards) or switch to keyset pagination (fetch next N as the agent swipes). Track dialed-count via a `Set<id>`, not array `.filter`.

### 2. Missing indexes on hot query paths (High)
- **File:** `public.leads`, `public.campaign_leads` (DB audit #7)
- **Explanation:** Every list query does `order by created_at desc` (no index → sort on read), filters by `status` (no index), and search does `or(first_name.ilike.%t%*, …)` across 5 text columns (no trigram/GIN → sequential scan). `campaign_leads` filtered by `user_id` with no index. Latency grows O(n) at 100k+ rows.
- **Optimization:** `CREATE INDEX ON leads(created_at DESC);`, `CREATE INDEX ON leads(status);`, `CREATE INDEX ON campaign_leads(user_id);`, plus a `pg_trgm` GIN index over the 5 search columns. After adding `call_logs`, index `(user_id, created_at DESC)`.

### 3. No code splitting / lazy loading (High)
- **File:** `client/src/App.tsx`, `client/vite.config.ts`
- **Explanation:** All routes statically imported into one bundle; `vite.config.ts` has no `manualChunks`/`chunkSizeWarningLimit`. Initial load pulls dialer (Framer Motion), campaigns, call-logs, connectors, and full Telnyx+Twilio SDKs even for the dashboard.
- **Optimization:** Wrap heavy routes in `React.lazy` + `<Suspense>`; add `manualChunks` for `react`, `framer-motion`, `@telnyx/webrtc`, `@twilio/voice-sdk`, `@insforge/sdk`.

### 4. No client cache; sequential call-log writes (Medium)
- **File:** `client/src/lib/api.ts`, `server/src/routes/calls.ts`
- **Explanation:** No React Query/SWR — navigating between pages refetches everything. `calls/log` does 3 **sequential** round-trips (insert log → update lead → RPC counter), multiplying latency on the disposition hot path.
- **Optimization:** Add React Query (stale-while-revalidate) + invalidate-on-mutate. Collapse `calls/log` into one server-side RPC (insert + lead update + counter in a transaction) — removes 2 RTTs and the counter race (backend #9/#11).

### 5. No caching layer (Medium)
- **File:** server (absent)
- **Explanation:** No Redis, no in-memory cache, no HTTP `Cache-Control`/`ETag`. Every GET re-queries InsForge; dashboard stats recomputed per request.
- **Optimization:** Add `Cache-Control: private, max-age=5` (or ETag) on list/dashboard GETs; short-TTL in-memory cache for `user_settings`/token lookups. At higher scale, Redis + materialized `total_leads`/`leads_called` (DB audit #8).

### 6. Memory: dead duplicate client + large arrays (Medium)
- **File:** `client/src/hooks/useTelnyxCall.ts` (dead), `CampaignDialerPage`
- **Explanation:** `useTelnyxCall` is a full second Telnyx WebRTC client (TelnyxContext is the real one). If ever mounted it opens a second WebSocket + timers (leak). The 500-lead array + per-render `.filter` adds avoidable allocations.
- **Optimization:** Delete `useTelnyxCall.ts`. Use a `Set<id>` for dialed-count.

### 7. Render-blocking font + prod console.log (Medium)
- **File:** `client/src/index.css` (line 1), `CampaignDialerPage.tsx` (line 186)
- **Explanation:** `@import url('https://fonts.googleapis.com/...')` at top of CSS blocks first paint; no `font-display: swap`/preconnect. `handleDisposition` logs on every disposition.
- **Optimization:** Move font to `<link rel="preconnect">` + `<link rel="stylesheet" display=swap>` in `index.html` (or self-host). Gate `console.log` behind `import.meta.env.DEV`.

### 8–9. Workers / Queue (Low — N/A)
- **Explanation:** No workers and no queue (call-engine audit #1). Single-process Express; bulk import inline (3 sequential round-trips) with non-atomic recount. Fine at low throughput; won't scale to many concurrent agents/large imports.
- **Optimization (if scaling):** Move bulk import + call-log/recording writes to a background worker (BullMQ/Redis).

### 10. No lazy loading of routes/images (Low)
- **Explanation:** No `React.lazy` (see #3). Testimonial/lead avatars not `loading="lazy"`.
- **Optimization:** Add `loading="lazy"` to remote `<img>`; code-split routes (#3).

### 11. Per-render hashing / client refilter (Low)
- **File:** `client/src/pages/LeadsPage.tsx` (29–32), `CallLogsPage.tsx`, `CampaignsPage.tsx`
- **Explanation:** `getTagColor` recomputes a char-code hash every render. `filteredLogs`/`filteredCampaigns` re-filter the current server page on each keystroke — search covers only the loaded page, duplicating server search.
- **Optimization:** Memoize tag colors in a `Map`; rely on server-side search/filter as source of truth.

### 12. Unbounded `limit` on campaign leads (Low)
- **File:** `server/src/routes/leads.ts` (154–167)
- **Explanation:** `GET /leads/campaign/:id` accepts `limit`/`offset` from client with no upper bound; dialer sets 500, but a buggy/malicious client could pull the whole campaign (compounds #1).
- **Optimization:** Clamp `limit` server-side, e.g. `Math.min(Number(limit) || 50, 200)`.

## Optimization Roadmap (by impact)

**Quick wins:** (1) Add missing DB indexes (#2). (2) Code-split routes + vendor chunks (#3) + lazy images (#10). (3) Move font out of CSS `@import` (#7). (4) Clamp `limit` (#12) + delete dead `useTelnyxCall` (#6). (5) Gate `console.log` behind `import.meta.env.DEV` (#7).

**Medium effort:** (6) Virtualize/paginate dialer deck (#1). (7) Add React Query (#4/#5). (8) Collapse `calls/log` into one RPC (#4). (9) Add HTTP `Cache-Control`/ETag + in-memory cache (#5).

**Larger effort (only if scaling):** (10) Background worker + queue (#8/#9). (11) Redis stats + materialized counts (#5).

## Current State vs. Scale

| Scale | Verdict |
|-------|---------|
| 1 agent, <1k leads, low volume | ✅ Fine as-is (indexes + font tweak recommended). |
| Several agents, 10k–100k leads | ⚠️ Needs indexes (#2), dialer virtualization (#1), code-splitting (#3), caching (#5). |
| Many agents / high throughput, large imports | ❌ Needs workers/queue (#8/#9), Redis, single-transaction call-log RPC, materialized counts. |

---

*End of AUDIT_08_PERFORMANCE.md — inspection complete, no source files were modified.*
