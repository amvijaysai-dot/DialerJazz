# IMPLEMENTATION_PLAN_V1.md

**Goal:** By end of today, DialerJazz must be a working **single-user, manual outbound cold-calling sales dialer**.

**Explicitly OUT of scope (per your constraints — deferred, see MASTER_AUDIT_REPORT.md):**
Docker, Kubernetes, CI/CD, monitoring/alerting, Redis, multi-agent scalability, enterprise logging, AI voice agents, multi-tenant SaaS hardening (JWT verification, RLS policies, secret encryption, webhook signing, cross-tenant read fix). Dependency CVEs are addressed only by a quick `npm audit fix` where it helps local dev (e.g. the Windows esbuild file-read issue).

**What "done" looks like:** One user logs in → connects Telnyx or Twilio → imports a CSV of leads into a campaign → opens the dialer → clicks (or hits Space) to call each lead → talks → hangs up → picks a disposition (pre-filled from the real call outcome) → sees the lead marked and progress increment → views the day's stats on the dashboard. **No 500s in the core loop.**

---

## Task 1 — Create the `call_logs` subsystem  ⭐ HIGHEST VALUE
**Why first:** The entire call-logging + disposition + stats path currently 500s because `call_logs` does not exist (DB#2, MASTER C4). Without it the core loop *call → log outcome → track progress* is broken. This is the single biggest blocker to a usable dialer.

**Do:**
1. Create `public.call_logs`:
   - `id uuid pk default gen_random_uuid()`
   - `user_id uuid NOT NULL`
   - `lead_id uuid` (FK → leads.id ON DELETE SET NULL)
   - `campaign_id uuid` (FK → campaigns.id ON DELETE SET NULL)
   - `provider text`, `direction text`, `from_number text`, `to_number text`
   - `status text`, `disposition text`, `disposition_sub text`
   - `duration_seconds int`, `recording_url text`, `notes text`
   - `started_at timestamptz`, `ended_at timestamptz`, `created_at timestamptz default now()`
   - index `ON call_logs(user_id, created_at DESC)`
2. Add `leads_called integer NOT NULL DEFAULT 0` to `public.campaigns` (DB#4 / MASTER H5).
3. Create RPC `increment_campaign_calls(p_campaign_id uuid)` that does `UPDATE campaigns SET leads_called = COALESCE(leads_called,0)+1 WHERE id = p_campaign_id;`.
4. Add these to `server/setup-db.ts` (idempotent `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION`) and run it. (We have DB access from the earlier inspection.)

**Files:** `server/setup-db.ts` (or a new `server/migrations/001_call_logs.sql`), DB.
**Effort:** 2–3 h.
**Verify:** `POST /api/calls/log` returns 200; `GET /api/stats/dashboard` returns real numbers; dialer disposition saves without 500.

---

## Task 2 — Verify & fix click-to-call connection  ⭐ HIGH VALUE
**Why:** If a call can't be placed/connected, nothing else matters. The WebRTC clients exist; this task confirms the full path works for a real manual call.

**Do:**
1. Confirm `TelnyxContext.initConnection()` fetches settings → gets token → SIP registers (`connectionStatus === 'registered'`). Same for `TwilioContext` (token + `device.register()`).
2. Confirm `dial()` places the call and `primaryCallState` goes `trying → ringing → active`; `hangup()` ends it.
3. Test with a known good number. Fix any blocker: caller-ID validation, token endpoint error, missing `callerNumber`.
4. Confirm the **local (`tel:`)** path also works for mobile use.

**Files:** `client/src/contexts/TelnyxContext.tsx`, `TwilioContext.tsx`, `server/src/routes/telnyx.ts`, `twilio.ts`, `settings.ts`.
**Effort:** 2–3 h.
**Verify:** Place a call from the dialer; audio connects both ways; hangup returns to idle.

---

## Task 3 — Accurate dispositions from real call outcome  ⭐ HIGH VALUE
**Why:** Cold-calling data is only useful if dispositions are correct. Today *any* ended call shows the disposition overlay and an agent can mislabel a no-answer as "answered" (CE#3 / MASTER H6).

**Do:**
- In `CampaignDialerPage`, derive the **default** disposition from the call outcome before opening `DispositionOverlay`:
  - `sipReason`/`cause`/`CallStatus` ∈ {no_answer, missed} → default **"No Answer"**
  - ∈ {busy} → **"Busy"**
  - ∈ {failed, canceled} → leave **unmarked** (don't pre-select a positive outcome)
  - answered → default to first positive option but let agent override
- Ensure a failed call does **not** force a positive disposition.

**Files:** `client/src/pages/CampaignDialerPage.tsx`, `DispositionOverlay.tsx`.
**Effort:** 1–2 h.
**Verify:** Simulate a no-answer → overlay pre-selects "No Answer"; agent can still override.

---

## Task 4 — Fast, reliable lead import into a campaign  ⭐ MEDIUM-HIGH
**Why:** A cold-caller must get their list in fast. The UI CSV wizard (fuzzy mapping) already works; confirm it end-to-end and optionally let the bulk script link to a campaign.

**Do:**
1. Test the UI flow: **Create Campaign → Upload CSV → map columns → import** and confirm leads are linked to the campaign (`campaign_leads` rows exist) and appear in the dialer deck.
2. (Optional efficiency win) Extend `server/import-leads.js` with `--campaign-id` so it inserts leads **and** links them to `campaign_leads` in one step (skips the "Import from CRM" UI step).

**Files:** `client/src/components/CreateCampaignModal.tsx`, `server/import-leads.js`.
**Effort:** 1–2 h.
**Verify:** Import ~50 leads → open campaign dialer → all 50 show in the deck.

---

## Task 5 — Dialer keyboard shortcuts  ⭐ MEDIUM (efficiency)
**Why:** A rep placing 100+ calls/day gains large throughput from the keyboard instead of mouse clicks.

**Do:** In `CampaignDialerPage`, add global key handlers (ignored while typing in an input/textarea):
- `Space` → dial current lead
- `Esc` → hangup
- `M` → mute/unmute
- `Enter` / `→` → advance to next lead after disposition
- Show a tiny legend in the dialer.

**Files:** `client/src/pages/CampaignDialerPage.tsx`.
**Effort:** 1 h.
**Verify:** Keyboard places/hangs up/mutes; no conflict with text inputs.

---

## Task 6 — Working dashboard / daily stats  ⭐ MEDIUM
**Why:** Visibility into calls-made and connect rate keeps a cold-caller motivated and tracks the day.

**Do:** After Task 1, confirm `GET /api/stats/dashboard` returns real numbers and the Dashboard renders them. Stop silently swallowing stats/settings errors (UX#4 / MASTER M9) so a failure is visible, not a false `0`.

**Files:** `client/src/pages/Dashboard.tsx`, `server/src/routes/stats.ts`.
**Effort:** 0.5 h.
**Verify:** Dashboard shows today's call count + connect total.

---

## Task 7 — Cleanup + local-dev hygiene  ⭐ LOW
**Why:** Removes a dangerous duplicate client and cuts local CVE noise (the esbuild Windows file-read issue is directly relevant to this Windows dev box).

**Do:**
- Delete `client/src/hooks/useTelnyxCall.ts` (dead duplicate Telnyx client — CE#11 / MASTER M12).
- Run `npm audit fix` in `server/` and `client/` (MASTER H4); non-breaking only.
- (Optional, 10 min) Remove the hardcoded InsForge fallback in `lib/insforge.ts` so a missing env fails loud instead of silently routing to a third party (MASTER C3).

**Files:** `useTelnyxCall.ts`, both `package.json`, `lib/insforge.ts` (optional).
**Effort:** 0.5 h.
**Verify:** App builds; audit count drops; no second SIP socket.

---

## Task 8 — Calling-session UX polish  ⭐ LOW (if time remains)
**Why:** Smoother first-run experience.

**Do:** Add a "Download sample CSV" CTA in the upload step (UX#5); per-card loading skeleton on the Dashboard (UX#4); ensure the dialer shows a clear empty state when a campaign has 0 leads.

**Files:** `CreateCampaignModal.tsx`, `Dashboard.tsx`, `CampaignDialerPage.tsx`.
**Effort:** 1–2 h.

---

## Order (highest → lowest business value)
1. **Task 1** — `call_logs` subsystem (unblocks everything)
2. **Task 2** — verify click-to-call connects
3. **Task 3** — accurate dispositions
4. **Task 4** — fast lead import into campaign
5. **Task 5** — keyboard shortcuts
6. **Task 6** — dashboard stats
7. **Task 7** — cleanup + `npm audit fix`
8. **Task 8** — UX polish (optional)

## End-of-day Definition of Done
Single user can: log in → connect Telnyx/Twilio → import a CSV into a campaign → open the dialer → call each lead (click or Space) → talk → hang up → pick a disposition pre-filled from the outcome → see the lead marked + progress increment → view daily stats. **No 500s in the core loop.**

## Notes / non-blockers intentionally skipped
- **Twilio hold is a stub** (CE#5) — hold is a nice-to-have, not required for manual cold calling; Telnyx hold works.
- **No voicemail/busy detection, no recording** (CE#9/#10) — manual agent judges these; not required for V1.
- **500-lead in-memory deck, no code-splitting** (PERF#1/#3) — fine for a single user's list today.
- **`toE164` US-only** (CE#13) — verify your leads are E.164/US; international lists need a later fix.
- All multi-tenant / production items from MASTER_AUDIT_REPORT.md are deferred.

---

*Generated from MASTER_AUDIT_REPORT.md, scoped to a single-user manual cold-calling dialer. No source files were modified.*