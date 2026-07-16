# AUDIT_03_FRONTEND.md

**DialerJazz — Frontend Architecture & Quality Audit**
*Inspection-only. No source files were modified.*

Scope: `client/src/**` — `main.tsx`, `App.tsx`, `lib/api.ts`, `contexts/*`, `hooks/*`, `components/*`, `pages/*`, `index.css`, `vite.config.ts`.

---

## Summary Table

| # | Area | Severity | File | Issue |
|---|------|----------|------|-------|
| 1 | State mgmt | High | `CampaignDialerPage.tsx` | Loads up to 500 leads into React state, no virtualization (memory/UX bottleneck) |
| 2 | API layer | High | `lib/api.ts` | `apiFetch` returns `{ data: null }` on non-401 errors without throwing → undefined-access crashes |
| 3 | Error handling | High | `lib/api.ts` | 401 refresh path can loop / mask real auth failure; no global error boundary |
| 4 | Accessibility | High | `CallControls.tsx`, `DialerModeSelect.tsx` | Icon-only buttons (Hang Up, DTMF) have no `aria-label`; divs used as clickable controls |
| 5 | Forms | Medium | `LoginPage.tsx` | No client-side validation (email format, password length); relies on toasts only |
| 6 | Forms | Medium | `ConnectorsPage.tsx` | Secrets (Twilio/Telnyx) entered in plain inputs; no reveal/confirm; sent to backend that stores them |
| 7 | Loading states | Medium | `LeadsPage.tsx`, `CampaignsPage.tsx` | `isLoading` shows spinner but no empty/error state differentiation; no optimistic UI |
| 8 | Performance | Medium | `index.css` | Google Fonts `@import` blocks render; no `font-display` swap preconnect |
| 9 | Performance | Medium | `CampaignDialerPage.tsx` | `console.log` in render path (`handleDisposition`); framer-motion on every card |
| 10 | Responsive | Medium | `LoginPage.tsx` | `w-[100dvw]` + `h-[100dvh]` can cause horizontal scroll / overflow on mobile |
| 11 | Dark mode | Medium | `index.css` / `ThemeProvider` | `defaultTheme="system"` but no `suppressHydrationWarning`; flash of wrong theme possible |
| 12 | Routing | Low | `App.tsx` | `/` redirects to `/login` even when authenticated (minor UX); no lazy loading of routes |
| 13 | Components | Low | `CallControls.tsx` | `dialerMode` prop typed `'power' | 'click'` only — mismatches server enum (preview/predictive) |
| 14 | State mgmt | Low | `AuthContext.tsx` | Token stored in `localStorage` (XSS-readable); no refresh-rotation logic |
| 15 | Accessibility | Low | `LoginPage.tsx` | Testimonial `<img>` fine, but form lacks `<label>` association (uses placeholder only) |
| 16 | API layer | Low | `lib/api.ts` | `Campaign` interface omits `leads_called` mismatch; `listByCampaign` returns non-paginated shape |
| 17 | Performance | Low | `LeadsPage.tsx` | `getTagColor` recomputes hash each render; minor |
| 18 | Error handling | Low | `pages/*` | Errors caught per-page with `toast.error(error.message)` — message may be undefined |

---

## Detailed Findings

### 1. Campaign leads loaded entirely into client state
- **Area:** State management / Performance
- **Severity:** High
- **File:** `client/src/pages/CampaignDialerPage.tsx` (lines 84–92)
- **Explanation:** `loadData` calls `leadsApi.listByCampaign(campaignId, { limit: 500 })` and stores all leads in `useState`. For large campaigns this is a large in-memory array rendered as swipeable cards with Framer Motion physics. No windowing/virtualization. Memory and jank scale with lead count; 500 is a hard cap but still heavy.
- **Recommended fix:** Paginate/virtualize the lead list (e.g. `@tanstack/react-virtual`), or load leads lazily as the agent swipes. Keep only the current ±2 cards mounted.

### 2. `apiFetch` swallows non-401 errors
- **Area:** API layer
- **Severity:** High
- **File:** `client/src/lib/api.ts` (lines 91–107)
- **Explanation:** On `!response.ok` (and not 401), it throws `Error(message)` — good. But the 204 branch returns `{}` and the "enforce {data} contract" branch returns `{ data: json }` even when the backend returned an error-shaped object. More critically, several callers (e.g. `settingsApi.getTelnyxBalance`) treat a returned `{ data: null, error: 'not_configured' }` as success and then access `data.balance`, causing `Cannot read properties of null`. The API layer does not distinguish "HTTP ok but business error" from "success."
- **Recommended fix:** Standardize: throw on any non-2xx, and have callers check a typed `error` field. Never return `null` data for endpoints callers assume non-null. Add a result type `{ ok, data, error }`.

### 3. 401 refresh can mask auth failure / loop
- **Area:** Error handling / API layer
- **Severity:** High
- **File:** `client/src/lib/api.ts` (lines 72–89)
- **Explanation:** On 401 it calls `refreshSession()` and retries once. If refresh succeeds but the retry also 401s (or refresh returns a token that's still rejected), the code falls through to `throw new Error('Session expired...')` — acceptable — but if `refreshSession` itself throws, the catch sets `cachedToken=null` and throws "Session expired" even for transient network errors, logging the user out incorrectly. There's no circuit breaker.
- **Recommended fix:** Distinguish network errors from auth errors; only clear the session on a genuine auth failure. Avoid blanket sign-out on transient fetch errors.

### 4. Missing ARIA labels on icon buttons / non-button controls
- **Area:** Accessibility
- **Severity:** High
- **File:** `client/src/components/CallControls.tsx` (lines 40–51), `client/src/components/ui/dialer-mode-select.tsx` (lines 106–120)
- **Explanation:** The Hang Up and DTMF buttons are icon-only with no `aria-label`. Screen-reader users get no label. The dialer-mode options are `<div onClick=...>` with no `role="button"`, no `tabIndex`, no keyboard handler — they are inaccessible via keyboard and to assistive tech.
- **Recommended fix:** Add `aria-label` to all icon buttons. Convert the mode-option `<div>`s to `<button>` elements (or add `role="button"`, `tabIndex={0}`, `onKeyDown`). Ensure focus styles are visible.

### 5. No client-side form validation
- **Area:** Forms
- **Severity:** Medium
- **File:** `client/src/pages/LoginPage.tsx` (lines 86–157)
- **Explanation:** `handleSubmit` only checks non-empty strings (`if (!email) return toast.error(...)`). No email-format regex, no password minimum length, no inline field errors. Validation is delegated entirely to the backend/InsForge, so users get late, generic failures.
- **Recommended fix:** Add Zod/react-hook-form validation with inline field errors and `aria-invalid`/`aria-describedby`. Disable submit while invalid.

### 6. Secrets handled in plain form inputs
- **Area:** Forms / Security UX
- **Severity:** Medium
- **File:** `client/src/pages/ConnectorsPage.tsx`
- **Explanation:** Twilio/Telnyx secrets are typed into `<input>` fields (some `type="text"` not `password`), sent to `settingsApi.verifyTwilio`, and stored server-side. There is no confirm-field, no reveal toggle consistency, and (per backend audit) the values are returned by `GET /settings`. Even though this is by design, the UI should at least mask secrets and never echo them back.
- **Recommended fix:** Use `type="password"` for all secret fields, add a reveal toggle, and rely on `configured: boolean` from the backend rather than echoing secrets.

### 7. Loading/empty/error states not differentiated
- **Area:** Loading states
- **Severity:** Medium
- **File:** `client/src/pages/LeadsPage.tsx` (lines 51–66), `client/src/pages/CampaignsPage.tsx`
- **Explanation:** Pages set `isLoading` and show a spinner, but on error they only `toast.error` and leave the previous/empty data on screen. There is no dedicated error UI and no "no results" empty state beyond whatever the list renders. Users can't tell "loading" from "empty" from "failed."
- **Recommended fix:** Track `status: 'idle'|'loading'|'success'|'error'` and render distinct empty/error/loading views. Provide a retry button on error.

### 8. Render-blocking Google Fonts `@import`
- **Area:** Performance
- **Severity:** Medium
- **File:** `client/src/index.css` (line 1)
- **Explanation:** `@import url('https://fonts.googleapis.com/...')` is render-blocking and sits at the top of the CSS bundle. It delays first paint. No `<link rel="preconnect">` / `font-display: swap` is set in HTML.
- **Recommended fix:** Move font loading to `<link rel="preconnect">` + `<link rel="stylesheet">` in `index.html` with `display=swap`, or self-host the font. Remove the CSS `@import`.

### 9. `console.log` in render path + heavy animation
- **Area:** Performance
- **Severity:** Medium
- **File:** `client/src/pages/CampaignDialerPage.tsx` (line 186)
- **Explanation:** `handleDisposition` calls `console.log('[CampaignDialer] Saving call...')` on every disposition — dev noise that ships to prod. Framer Motion drag physics are applied to every card; with 500 cards this is costly.
- **Recommended fix:** Remove `console.log` from production paths (or gate behind `import.meta.env.DEV`). Reduce animation scope / use CSS transforms only when needed.

### 10. Fixed viewport width can cause mobile overflow
- **Area:** Responsive design
- **Severity:** Medium
- **File:** `client/src/pages/LoginPage.tsx` (line 196)
- **Explanation:** `w-[100dvw]` combined with `p-8` padding and flex layout can produce horizontal scrollbars on small screens (100dvw + padding overflows). `h-[100dvh]` is fine but the width is risky.
- **Recommended fix:** Use `min-h-[100dvh] w-full` / `max-w-screen` and let padding live inside a constrained container; avoid `100dvw`.

### 11. Theme flash / hydration
- **Area:** Dark mode
- **Severity:** Medium
- **File:** `client/src/main.tsx` (line 13), `client/src/index.css`
- **Explanation:** `ThemeProvider` uses `defaultTheme="system"` + `enableSystem` but the `<html>` element has no `suppressHydrationWarning` and there's no blocking theme script, so on first paint the system theme may flash before `next-themes` applies the class. The CSS defines `.dark` correctly, so functionality works, but the flash is a UX regression.
- **Recommended fix:** Add `suppressHydrationWarning` to `<html>` in `index.html` and/or inject a small inline script in `<head>` that sets the theme class before paint (next-themes supports this pattern).

### 12. Routing: redirect + no code splitting
- **Area:** Routing
- **Severity:** Low
- **File:** `client/src/App.tsx` (lines 78, 81–91)
- **Explanation:** `/` always redirects to `/login` even if the user is already authenticated (minor extra navigation). All pages are statically imported (no `React.lazy`), so the initial bundle includes the dialer, campaigns, etc. — larger first-load JS than necessary.
- **Recommended fix:** Redirect `/` to the appropriate destination based on auth; wrap heavy routes in `React.lazy` + `Suspense`.

### 13. `dialerMode` prop type too narrow
- **Area:** Components / Types
- **Severity:** Low
- **File:** `client/src/components/CallControls.tsx` (line 6)
- **Explanation:** `dialerMode: 'power' | 'click'` ignores `preview`/`predictive` that the server schema allows. If a campaign is `preview`, the button label falls back to "Click to Call" incorrectly.
- **Recommended fix:** Type as the full union and handle all modes, or derive the label from a shared constant.

### 14. Token in localStorage (XSS-readable)
- **Area:** State management / Security
- **Severity:** Low
- **File:** `client/src/contexts/AuthContext.tsx` (lines 44–46, 101)
- **Explanation:** The access token is persisted in `localStorage` (`jazz_access_token`), making it readable by any XSS. Given the app renders third-party testimonial images and will handle call UI, XSS exposure is non-trivial.
- **Recommended fix:** Prefer an httpOnly cookie for the session (InsForge supports cookie auth), or at minimum keep the token in memory and only persist a refresh token.

### 15. Form labels missing
- **Area:** Accessibility
- **Severity:** Low
- **File:** `client/src/pages/LoginPage.tsx` (lines 25–38 of sign-in component)
- **Explanation:** Inputs use `placeholder` but no associated `<label>`/`htmlFor`, so screen readers announce only the placeholder (which disappears on focus). Same pattern repeats across pages.
- **Recommended fix:** Add `<label htmlFor>` for every input, or `aria-label`.

### 16. API response-shape assumptions
- **Area:** API layer
- **Severity:** Low
- **File:** `client/src/lib/api.ts` (lines 216–222, 305–318)
- **Explanation:** `listByCampaign` returns a non-paginated `{ data, meta }` but is typed loosely; `UserSettings` interface includes secret fields that the backend should not return (see backend audit #4) — the client is prepared to receive secrets it shouldn't.
- **Recommended fix:** Align client types with a safe backend contract (no secrets in `UserSettings`); type `listByCampaign` explicitly.

### 17. Per-render hash in tag color
- **Area:** Performance
- **Severity:** Low
- **File:** `client/src/pages/LeadsPage.tsx` (lines 29–32)
- **Explanation:** `getTagColor` recomputes a char-code hash on every render for every tag. Trivial individually, but across a 25-row list re-rendering it's needless work.
- **Recommended fix:** Memoize the color mapping (e.g. `useMemo` keyed by tag, or precompute a `Map`).

### 18. Error messages may be undefined
- **Area:** Error handling
- **Severity:** Low
- **File:** `client/src/pages/*` (e.g. `LeadsPage.tsx` line 63)
- **Explanation:** `toast.error(error.message || 'Failed to fetch...')` — if `error` is a non-Error or `message` is empty, the fallback works, but several catch blocks do `toast.error(err?.message || '...')` where `err` could be a string or object, producing "[object Object]" toasts.
- **Recommended fix:** Normalize errors to a string via a `getErrorMessage(e)` helper used everywhere.

---

## React Architecture (summary)
- Standard Vite + React 19 SPA. Composition is reasonable: pages → components → contexts. `VoiceContext` cleanly abstracts Telnyx/Twilio. `AuthContext` wraps InsForge auth. No Redux/Zustand — state is React Context + `useState`/`useReducer` per page. This is fine for the app's scale but means **no global cache** (every page refetches; no React Query), and provider state (voice) is re-created on each mount unless persisted by layout (it is, via `ProtectedLayout`).
- **No React error boundary** anywhere — an uncaught render error white-screens the app.

## Routing (summary)
- React Router 7 with a `ProtectedLayout` (auth gate + providers + `DashboardLayout`) wrapping all authed routes. Clean. Gaps: no lazy loading (#12), `/` always → `/login` (#12), no error boundary.

## Components (summary)
- Mostly presentational + a few smart pages. `CallControls`, `DialerModeSelect`, `DispositionOverlay`, `CreateCampaignModal` are the complex ones. Reusable `ui/` primitives (shadcn-style) exist. Issues: inaccessible controls (#4), narrow prop types (#13).

## State Management (summary)
- Context for auth/voice; local `useState` for page data. No server-state library → duplicate fetches, no cache invalidation, manual loading/error booleans per page (#7). Token in localStorage (#14).

## API Layer (summary)
- `lib/api.ts` is a single `apiFetch` wrapper + per-domain namespaces. Centralized and readable, but the error/contract handling is fragile (#2, #3, #16). VITE_ base URL from env.

## Error Handling (summary)
- Per-page `try/catch` + `sonner` toasts. No global error boundary, no standardized error normalization (#18). Backend errors surface as toast text only.

## Forms (summary)
- Login/Connectors/CreateCampaign use controlled inputs + manual validation. Login lacks format checks (#5); Connectors handles secrets poorly (#6). No shared form library.

## Loading States (summary)
- Boolean `isLoading` spinners; no skeleton, no empty/error distinction (#7). Debounced search in LeadsPage is a good pattern.

## Accessibility (summary)
- Weakest area: icon buttons without labels (#4), div-as-button mode selector (#4), missing form labels (#15), no focus management on route change, no skip link. Color contrast in dark theme is generally OK.

## Performance (summary)
- No code splitting (#12), 500-lead client load (#1), render-blocking font (#8), `console.log` in hot path (#9), per-render hashing (#17). Framer Motion is used tastefully but on large lists (#1).

## Responsive Design (summary)
- Generally mobile-friendly (Tailwind responsive classes, `dvh` units), but `w-[100dvw]` overflow risk (#10) and some fixed-width cards (`w-60` testimonials) could overflow on very small screens.

## Dark Mode (summary)
- Properly implemented via CSS variables + `next-themes` `class` strategy; `.dark` block is complete and coherent. Only issue is first-paint flash (#11). Light/dark both look intentional.

---

*End of AUDIT_03_FRONTEND.md — inspection complete, no source files were modified.*