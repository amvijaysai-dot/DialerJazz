# MASTER_AUDIT_REPORT.md

**DialerJazz — Consolidated Audit Report**
*Synthesis of AUDIT_01 through AUDIT_10. Inspection-only; no source files were modified. All findings deduplicated and prioritized.*

---

## Executive Summary

DialerJazz is a **functional single-agent click/power dialer** with a clean React + Express + InsForge (managed Postgres/Auth) architecture. The UX shell (campaign wizard with fuzzy CSV mapping, swipe dialer) is genuinely good. However, the project is **not production-ready and not secure as deployed**. The security and production-posture gaps are systemic, not cosmetic:

- **Tenant isolation rests entirely on app code** — RLS is disabled on every table and the JWT is decoded but never verified, so a forged token is accepted.
- **Secrets are handled unsafely** — provider credentials are stored in plaintext and returned to the browser, and a hardcoded InsForge anon key is committed in source.
- **The "calling engine" is a thin WebRTC client** — there is no server-side scheduler, queue, or workers; "Power" dialing is auto-swipe only; no voicemail/busy detection, no recording, no retries.
- **There is no deployment/ops foundation** — no Docker, no CI/CD, no crash recovery, no structured logging, no monitoring, no backup/DR plan, and a floating `"latest"` dependency.
- **The database is missing core objects** — `call_logs` doesn't exist, so the entire call-logging/stats path 500s.

Across 10 audits, **~62 distinct issues** were identified (after deduplication). **7 are Critical, ~14 High, ~22 Medium, ~19 Low.** Estimated effort to reach a safe production deploy: **~6–8 weeks for a solo engineer** (or ~3–4 weeks for a small team), dominated by security hardening, the missing `call_logs` subsystem, and the production/ops foundation.

---

## Scores

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| **Production Readiness** | **25/100** | No Docker, CI/CD, crash recovery, monitoring, or backup/DR; superficial health check; floating dependency. Runs locally, not deployable safely. |
| **Code Quality** | **55/100** | Clean module boundaries and provider abstraction, but dead code (`useTelnyxCall`, Socket.io), `console.log` in prod, swallowed errors, no tests, unverified JWT. |
| **Scalability** | **30/100** | Single instance, no workers/queue, no Redis, in-memory rate limiter, missing indexes, 500 leads in memory, no caching. Fine for 1 agent; breaks at scale. |
| **Security** | **30/100** | RLS off, JWT unverified, hardcoded creds, plaintext secrets returned to client, unsigned webhooks, cross-tenant read, 29 total dependency CVEs, XSS surface. |
| **Maintainability** | **60/100** | Clear separation of concerns and InsForge offloads DB/Auth, but no tests/CI, magic env fallback, duplicated client, no deploy docs. |

**Overall weighted readiness: ~40/100 — NOT production-ready.**

---

## Critical Issues (must fix before any production deploy)

| ID | Issue | Source audits | Fix effort |
|----|-------|---------------|-----------|
| C1 | **RLS disabled on every table; zero policies.** Tenant isolation is app-only and rests on an unverified JWT. | DB#1, SEC#2 | 2–3 d |
| C2 | **JWT decoded but never verified** (`jwt.decode` in `auth.ts`). Forged tokens with a guessed `sub` are accepted. | BE#1, SEC#1 | 0.5 d |
| C3 | **Hardcoded fallback InsForge URL + anon key committed in `lib/insforge.ts`.** Misconfig silently routes to a third party; key is public. | BE#2, SEC#3, FE | 0.5 d |
| C4 | **`call_logs` table does not exist** → `POST /api/calls/log`, call stats, dashboard all 500. | DB#2 | 1–2 d |
| C5 | **No Docker / containerization** (no Dockerfile, compose, or k8s). No reproducible artifact. | PROD#1 | 2–3 d |
| C6 | **No CI/CD pipeline** — no lint/typecheck/test/build gate before deploy. | PROD#2 | 1–2 d |
| C7 | **No crash recovery** — no `uncaughtException`/`unhandledRejection` handlers, no PM2/systemd/k8s. One unhandled error kills all agents. | PROD#3 | 1 d |

---

## High Priority

| ID | Issue | Source audits | Fix effort |
|----|-------|---------------|-----------|
| H1 | **Provider secrets stored in plaintext and returned to the client** (`GET /settings`). Credential-compromise path. | BE#4, DB#5, SEC#4 | 2–3 d |
| H2 | **Webhooks unsigned** (`/api/twilio/voice`, `/webhook`, `/api/telnyx/webhook`) → toll fraud / status spoofing. | BE#5, SEC#5, CE#6 | 1–2 d |
| H3 | **Cross-tenant read** on `GET /leads/campaign/:id` (campaign ownership not enforced). | BE#3, SEC#6 | 0.5 d |
| H4 | **Dependency vulnerabilities**: server **15** (1 critical, 4 high), client **14** (5 high) — axios proto-pollution, esbuild file-read, form-data CRLF, basic-ftp. | SEC#7 | 3–5 d |
| H5 | **`campaigns.leads_called` column + `increment_campaign_calls` RPC missing** → call progress never updates. | DB#3,#4 | 1 d |
| H6 | **Disposition saved for any call attempt** (even 1-ring no-answer) → leads wrongly marked "answered". | CE#3 | 1–2 d |
| H7 | **No structured logging** (only `console.log`/emoji; no levels, correlation IDs, redaction). | PROD#6 | 1–2 d |
| H8 | **No monitoring/alerting** (no Sentry, metrics, uptime checks). Outages undetected. | PROD#7 | 2–3 d |
| H9 | **No backup / DR plan** (relies solely on InsForge managed Postgres; unknown RPO/RTO). | PROD#8 | 1–2 d |
| H10 | **Floating `@insforge/sdk: "latest"`** → non-reproducible builds. | PROD#4 | 0.5 d |
| H11 | **Health check is superficial** (static `ok`, no DB/InsForge probe) → false-healthy. | PROD#5 | 0.5 d |
| H12 | **Power/Progressive dialer modes unimplemented** ("power" = auto-swipe only; "progressive" is a stub) → wrong user expectation. | ARCH#1, UX#7 | 1–2 w* |
| H13 | **No AI voice-agent infrastructure** (all 15 inspected areas absent) — if AI is a product claim, it is not real. | AI#all | n/a* |

\* H12/H13 are feature-scope decisions, not bugs; estimate depends on whether they are in scope for v1.

## Medium Priority

| ID | Issue | Source audits | Fix effort |
|----|-------|---------------|-----------|
| M1 | **Missing DB indexes** on `leads(created_at)`, `leads(status)`, `campaign_leads(user_id)`; no trigram index for 5-col `ilike` search → seq scan at scale. | DB#7, PERF#2 | 0.5 d |
| M2 | **No caching layer** (no Redis, no HTTP `Cache-Control`/ETag, no in-memory cache). | PERF#4,#5, PROD#9 | 2–3 d |
| M3 | **No workers / queue** — bulk import (2000 leads) + call-log writes inline/synchronous. | PERF#8,#9, PROD#10 | 3–5 d |
| M4 | **No Redis** — in-memory rate limiter breaks across instances; `trust proxy` unset. | PROD#9,#12, SEC#8 | 1 d |
| M5 | **Dialer loads 500 leads into memory, no virtualization.** | PERF#1, UX#10 | 2–3 d |
| M6 | **No code splitting / lazy loading** — all routes + Telnyx/Twilio SDKs in one bundle. | PERF#3, FE#12 | 1–2 d |
| M7 | **Analytics minimal** — 3 stat cards, no charts/funnel; call analytics can't render (no `call_logs`). | UX#1 | 2–3 d |
| M8 | **No empty states** on Leads / Call Logs / CRM. | UX#3 | 1 d |
| M9 | **Silent error swallowing** in dashboard stats/settings; no per-card loading skeleton. | UX#4 | 0.5 d |
| M10 | **CSV upload gaps** — no "download template" CTA, no row validation preview, no sample preview. | UX#5 | 1–2 d |
| M11 | **Accessibility partial** — icon buttons lack `aria-label`, no modal focus trap, no `aria-live`. | UX#2, SEC#10 | 2–3 d |
| M12 | **Dead duplicate Telnyx client** (`useTelnyxCall.ts`) — leak risk if mounted. | CE#11, PERF#6 | 0.5 d |
| M13 | **Telnyx `hungUpCallIdsRef` zombie-guard never read** — dead code. | CE#4 | 0.5 d |
| M14 | **Twilio hold is a stub** (`holdAndAnswer`/`toggleHold`/`hangupAndResume` no-op). | CE#5 | 1–2 d |
| M15 | **No retries** on call failure / token fetch / SIP reconnect. | CE#7 | 1–2 d |
| M16 | **No voicemail/busy (AMD) detection.** | CE#9 | 3–5 d* |
| M17 | **No call recording.** | CE#10, DB#2 | 2–3 d* |
| M18 | **Weak column constraints** — no CHECK on enums/phone; typos silently accepted. | DB#6 | 0.5 d |
| M19 | **`leads` mixes CRM + disposition state; `campaigns.total_leads` redundant count.** | DB#8 | 1 d |
| M20 | **No FK to `auth.users`** on `user_id` columns (orphan risk). | DB#10, SEC#14 | 1 d |
| M21 | **Navigation** — fixed non-collapsible sidebar, no breadcrumbs, no dialer keyboard shortcuts. | UX#6 | 1–2 d |
| M22 | **`calls/log` = 3 sequential round-trips** — collapse into one RPC (removes 2 RTTs + counter race). | PERF#4, BE#9 | 1 d |

\* M16/M17 are feature work, not bugs.

## Low Priority

| ID | Issue | Source audits | Fix effort |
|----|-------|---------------|-----------|
| L1 | **XSS surface** — token in `localStorage`, no CSP, remote images. | SEC#10, FE#14 | 1 d |
| L2 | **Render-blocking Google Fonts `@import`**; prod `console.log`. | PERF#7, FE#8 | 0.5 d |
| L3 | **Env-var name drift** (`.env.example` vs code) → hits hardcoded fallback. | SEC#13 | 0.5 d |
| L4 | **`toE164` assumes US `+1`** — misdials international. | CE#13 | 0.5 d |
| L5 | **Local-call disposition may never fire** (visibilitychange dependency). | CE#14 | 0.5 d |
| L6 | **`prevCallState` ref timing** race in dialer. | CE#15 | 0.5 d |
| L7 | **Twilio shared `identity`** breaks multi-tab. | CE#16 | 0.5 d |
| L8 | **Twilio listener attached post-resolve** — orphan call risk. | CE#12 | 0.5 d |
| L9 | **Filters shallow** (status-only; hidden behind toggle). | UX#8 | 1 d |
| L10 | **Search duplication** — client refilter duplicates server search. | UX#9, PERF#11 | 0.5 d |
| L11 | **Mobile** — cramped CSV map step; dial controls not thumb-anchored. | UX#10 | 1 d |
| L12 | **CRM import** — no live selected-count / confirmation summary. | UX#11 | 0.5 d |
| L13 | **Socket.io unused** — dead weight + unauthenticated namespace. | PROD#13 | 0.5 d |
| L14 | **No `engines` field / large 50mb body limit / no graceful shutdown.** | PROD#12 | 0.5 d |
| L15 | **Auth hardening** — weak InsForge password policy, no MFA/lockout. | SEC#15 | 0.5 d |
| L16 | **`raw_sql` migration pattern** — dangerous if anon-exposed (currently inert). | SEC#11 | 0.5 d |
| L17 | **`getTagColor` per-render hash; per-render recompute.** | PERF#11, FE#17 | 0.5 d |
| L18 | **Unbounded `limit` on campaign-leads endpoint.** | PERF#12, SEC#12 | 0.5 d |
| L19 | **No tests / no coverage** across backend + frontend. | BE, FE | 3–5 d |

---

## Estimated Fix Time

| Bucket | Items | Solo estimate |
|--------|-------|---------------|
| Critical (C1–C7) | 7 | ~10–14 d |
| High (H1–H11) | 11 | ~18–26 d |
| Medium (M1–M22) | 22 | ~25–35 d |
| Low (L1–L19) | 19 | ~12–16 d |
| **Subtotal (bugs)** | | **~65–91 d (~3–4.5 mo)** |
| Feature scope (H12/H13, M16/M17) | 4 | +4–8 w if in scope |
| **Total to safe production** | | **~6–8 weeks solo / ~3–4 weeks team** (parallelizable) |

*Assumes the missing `call_logs` subsystem, security hardening, and ops foundation are the critical path. Feature work (AI agent, true power dialing, recording) is additional and optional for v1.*

---

## Recommended Fix Order

**Phase 0 — Stop the bleeding (security, ~1 week):**
1. C2 verify JWT signatures (or enable RLS C1 so DB enforces tenancy regardless).
2. C3 remove hardcoded fallback creds + rotate leaked anon key.
3. H1 encrypt secrets + stop returning them to client.
4. H2 sign webhooks (Twilio `X-Twilio-Signature`, Telnyx allowlist).
5. H3 fix cross-tenant read on campaign leads.
6. H10 pin `@insforge/sdk`; H4 run `npm audit fix` + upgrades.

**Phase 1 — Make it run safely (data + ops, ~2 weeks):**
7. C4 create `call_logs` + H5 `leads_called`/`increment_campaign_calls` (unblocks stats/dashboard).
8. C5 Dockerfile + compose; C6 CI (lint/typecheck/test/build); C7 PM2/systemd + crash handlers + graceful shutdown.
9. H7 structured logging; H8 Sentry + uptime; H9 backup/DR plan; H11 real health probe.
10. M4 set `trust proxy` + Redis rate-limit store when scaling.

**Phase 2 — Make it correct & scalable (~2–3 weeks):**
11. H6 disposition-on-outcome (use `sipReason`/`CallStatus`); M22 collapse `calls/log` RPC; M14/M15 Twilio hold + retries.
12. M1 add DB indexes; M2 caching; M3 workers for bulk import; M5 dialer virtualization; M6 code splitting.
13. M11 accessibility; M7/M8/M9/M10 UX (analytics, empty states, CSV template, loading).
14. L19 add a test suite (at least auth + leads + calls happy paths).

**Phase 3 — Polish (ongoing):**
15. Remaining Low items (L1–L18), feature scope (H12/H13, M16/M17) as decided.

---

## Overall Recommendation

**Do not deploy to production in its current state.** The application is a solid foundation and a pleasant single-agent tool, but its security model is delegating everything to InsForge while simultaneously disabling RLS, not verifying tokens, leaking secrets, and exposing unsigned webhooks. Combined with the absence of any deployment/ops foundation (no Docker, CI, crash recovery, logging, monitoring, or backup), a production launch would be both **unsafe (data exposure / toll fraud)** and **fragile (silent, unmonitored outages)**.

**Recommended path:** Execute Phase 0 + Phase 1 first (≈3 weeks). This closes every Critical and the highest-impact High issues, makes the call-logging path functional, and gives the app a real deploy + observability story. Then proceed through Phase 2 for correctness/scalability and Phase 3 for polish. Treat the AI voice-agent capability (AUDIT_06) and true server-driven power dialing (AUDIT_05) as **separate product initiatives**, not launch blockers, unless they are explicit v1 requirements.

**If only one thing is fixed:** enable RLS + verify JWT signatures (C1 + C2) — this single change converts tenant isolation from "app-code hope" to "database-enforced," eliminating the most dangerous class of vulnerability.

---

*End of MASTER_AUDIT_REPORT.md — synthesized from AUDIT_01…AUDIT_10. No source files were modified.*
