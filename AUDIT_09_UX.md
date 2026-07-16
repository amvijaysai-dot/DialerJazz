# AUDIT_09_UX.md

**DialerJazz — User Experience Audit**
*Inspection-only. No source files were modified.*

Scope: Campaign creation, Import contacts, CSV upload, Dashboard, Analytics, Filters, Searching, Navigation, Mobile responsiveness, Accessibility, Loading indicators, Empty states.

> **Headline:** The UX is polished for a single-agent click-dialer — the campaign wizard (6-step, fuzzy CSV mapping) and the swipe dialer are genuinely good. Gaps are: **Analytics is minimal** (3 stat cards, no charts/funnel, and call analytics can't render because `call_logs` is missing — DB audit #2); **accessibility is partial** (labels on forms are good, but icon-only buttons lack `aria-label`, no focus trap in the modal, no `aria-live` for async status); **no empty states** on Leads/Call-Logs/CRM; **silent error swallowing** in dashboard stats; and **no "download CSV template" CTA** in the upload flow.

## Summary Table

| # | Severity | Area | Finding |
|---|----------|------|---------|
| 1 | **High** | Analytics | No charts/funnel/time-series. Dashboard = 3 stat cards + campaigns table. Call analytics can't render (no `call_logs`, DB #2). |
| 2 | **High** | Accessibility | Icon-only buttons (close, back, dial, hangup, mute, hold) have no `aria-label`; modal has no focus trap; no `aria-live` for loading/error/toast. |
| 3 | **Medium** | Empty states | No empty states for Leads, Call Logs, CRM, Campaigns (only dialer has "All leads dialed!"). Blank tables on first use. |
| 4 | **Medium** | Loading indicators | Dashboard stats cards have no per-card loading skeleton; `fetchStats`/`fetchSettings` errors are silently swallowed. |
| 5 | **Medium** | CSV upload | No "download template" CTA; no row-level validation preview (bad phone/email highlighted); no sample-data preview before import. |
| 6 | **Medium** | Navigation | Sidebar is fixed (no collapse on desktop); no breadcrumbs; dialer is full-screen with no persistent nav (must finish/exit to navigate). |
| 7 | **Low** | Campaign creation | 6-step wizard is good but "Power"/"Progressive" modes are selectable yet unimplemented (AUDIT_01) — sets wrong expectation. |
| 8 | **Low** | Filters | Leads filters are status-only (no tag/city/company); filter UI hidden behind a toggle; no saved/views. |
| 9 | **Low** | Searching | Search works (debounced) but client-side refilter on Call Logs/Campaigns duplicates server search and only covers loaded page (AUDIT_08 #11). |
| 10 | **Low** | Mobile responsiveness | Mostly responsive (`sm:`/`md:` used, dialer is `100vh`); but modal `max-w-5xl` map step can be cramped; no bottom-nav for thumb-reachable dial controls. |
| 11 | **Low** | Import contacts | CRM import is solid (multi-select + search) but no progress/confirmation count shown during selection; "Import from CRM" vs CSV branching is clear. |

## Detailed Findings

### 1. Analytics is minimal (High)
- **File:** `client/src/pages/Dashboard.tsx`, `statsApi.getDashboard()`
- **Explanation:** The dashboard shows 3 stat cards (totalCampaigns, totalLeads, totalCallsMade) + a campaigns table. There are **no charts, no conversion funnel, no time-series, no call-outcome breakdown**. Worse, call analytics depend on `call_logs`, which **does not exist** (DB audit #2), so any call-metrics view would 500. Users expecting "analytics" get a near-empty overview.
- **Improvement:** Add a lightweight chart lib (Recharts) for calls-over-time and disposition breakdown; gate call charts behind `call_logs` existing; show a "connect a provider + make calls" hint when empty.

### 2. Accessibility is partial (High)
- **File:** `CreateCampaignModal`, `CallControls`, `top-nav`, `sidebar`
- **Explanation:** Forms correctly use `<label htmlFor>` + `id` (good). But **icon-only buttons** — modal close (X), back (ArrowLeft), dial/hangup/mute/hold in `CallControls`, sidebar sign-out — have **no `aria-label`**, so screen readers announce nothing. The campaign modal has **no focus trap** (Tab escapes to background). Async status (uploading, saving, errors) is shown via `sonner` toasts with **no `aria-live`** region. Pagination correctly uses `aria-label`/`aria-current` (good counterexample).
- **Improvement:** Add `aria-label` to every icon button; implement a focus trap + `Esc`-to-close in the modal; wrap toasts/status in `role="status" aria-live="polite"`. Add visible focus rings (some buttons rely only on hover).

### 3. No empty states (Medium)
- **File:** `LeadsPage`, `CallLogsPage`, `CampaignsPage`, CRM import
- **Explanation:** Only the dialer has an empty state ("All leads dialed!"). Leads, Call Logs, and CRM show **blank tables** on first use with no guidance ("Import your first leads", "No calls yet — start a campaign"). This hurts onboarding.
- **Improvement:** Add illustrated empty states with a primary CTA (e.g. Leads → "Import CSV" / "Add manually"; Call Logs → "Make your first call").

### 4. Loading indicators / silent errors (Medium)
- **File:** `Dashboard.tsx` (lines 39–46)
- **Explanation:** `fetchStats` and `fetchSettings` `catch` and **swallow errors** (`// ignore`). The 3 stat cards therefore show `0` with no indication they failed. There is a single `isLoading` for campaigns but **no per-card skeleton** for stats. If InsForge is slow, the cards flash `0`.
- **Improvement:** Show skeleton placeholders for stat cards while loading; surface a non-blocking error if stats fail; distinguish "0" from "failed to load".

### 5. CSV upload gaps (Medium)
- **File:** `CreateCampaignModal.tsx` (upload_csv / map_csv steps)
- **Explanation:** PapaParse + fuzzy column mapping is strong. But: (a) no **"Download template"** CTA (only a separate `leads.csv.example` exists, not surfaced in-UI); (b) no **row-level validation preview** — invalid phones/emails aren't flagged before import; (c) no **sample-data preview** (first 5 parsed rows) to confirm mapping.
- **Improvement:** Add a "Download sample CSV" button; after parse, show a validation summary (N valid / M invalid) with invalid rows highlighted; preview 3–5 mapped rows.

### 6. Navigation (Medium)
- **File:** `sidebar.tsx`, `CampaignDialerPage`
- **Explanation:** The sidebar is fixed and doesn't collapse on desktop (narrows content but no hide). No breadcrumbs. The dialer is a **full-screen route with no persistent nav** — to switch campaigns the agent must exit. No keyboard shortcuts for dial/hangup/mute (a power dialer staple).
- **Improvement:** Add collapsible sidebar; breadcrumbs on inner pages; a minimal "exit dialer" affordance; keyboard shortcuts (Space=dial, Esc=hangup, M=mute) with a visible legend.

### 7. Campaign creation expectation gap (Low)
- **File:** `CreateCampaignModal` (DialerModeSelect)
- **Explanation:** The wizard lets users pick "Power" / "Progressive", but those modes are **unimplemented** (AUDIT_01/#2) — "Power" is auto-swipe only, "Progressive" is a stub. Selecting them sets a wrong mental model.
- **Improvement:** Disable/label unimplemented modes ("Coming soon") or implement them; don't offer modes that do nothing.

### 8. Filters are shallow (Low)
- **File:** `LeadsPage.tsx`
- **Explanation:** Status filter only; no tag/city/company/priority filters; the filter UI is hidden behind a toggle. No saved views or "my lists".
- **Improvement:** Add tag + company + priority filters; make the filter bar always visible on desktop; allow saving a filtered view as a static list.

### 9. Searching duplication (Low)
- **File:** `CallLogsPage`, `CampaignsPage`
- **Explanation:** These pages do a **client-side `useMemo` refilter** of the current server page, duplicating server-side search and only covering loaded rows. Inconsistent with LeadsPage (which searches server-side).
- **Improvement:** Standardize on server-side search (debounced) across all list pages; drop the redundant client refilter.

### 10. Mobile responsiveness (Low)
- **File:** global (`sm:`/`md:` classes), `CreateCampaignModal`
- **Explanation:** Layouts use responsive classes and the dialer is `h-[calc(100vh-80px)]` (good on mobile). But the CSV map step (`max-w-5xl`) can feel cramped on small phones, and dial controls aren't thumb-reachable at the bottom (they're mid-screen in the card).
- **Improvement:** Make the map step scrollable/stacked on mobile; anchor primary call controls to a bottom bar on small screens.

### 11. CRM import is solid (Low / positive)
- **File:** `CreateCampaignModal` (import_crm step)
- **Explanation:** Multi-select with select-all, search, and a clear "Import from CRM" vs "Upload CSV" branch. Minor: no running count of selected leads shown during selection, and no confirmation summary before final import.
- **Improvement:** Show "N selected" live; show a final confirmation ("Import 42 leads into 'Q4 Outreach'?").

## Suggested Improvements (prioritized)

1. **Analytics:** add charts (Recharts) + disposition breakdown; gate on `call_logs`; empty-state hint. (High)
2. **Accessibility:** `aria-label` on all icon buttons; modal focus trap + `Esc`; `aria-live` status region; visible focus rings. (High)
3. **Empty states** for Leads / Call Logs / CRM with primary CTAs. (Medium)
4. **Loading:** per-card skeletons; stop swallowing stats/settings errors. (Medium)
5. **CSV upload:** "Download template" CTA; row validation preview; sample-data preview. (Medium)
6. **Navigation:** collapsible sidebar; breadcrumbs; dialer keyboard shortcuts. (Medium)
7. **Filters:** add tag/company/priority; standardize server-side search. (Low)
8. **Campaign modes:** disable unimplemented dialer modes or implement them. (Low)
9. **Mobile:** bottom-anchored call controls; stacked map step. (Low)

## What's already good
- 6-step campaign wizard with **fuzzy CSV column mapping** + confidence indicators.
- Swipeable dialer deck with smooth Framer Motion transitions.
- Debounced search on Leads; responsive `sm:`/`md:` layouts; `aria-label`/`aria-current` on pagination.
- `sonner` toasts for async feedback; `autoFocus` on the campaign-name input.

---

*End of AUDIT_09_UX.md — inspection complete, no source files were modified.*
