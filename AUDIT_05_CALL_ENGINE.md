# AUDIT_05_CALL_ENGINE.md

**DialerJazz — Calling Engine Audit**
*Inspection-only. No source files were modified.*

Scope: the complete calling path — `client/src/contexts/TelnyxContext.tsx`, `TwilioContext.tsx`, `VoiceContext.tsx`, `hooks/useTelnyxCall.ts`, `hooks/useLocalCalling.ts`, `pages/CampaignDialerPage.tsx`, `components/CallControls.tsx`, `DispositionOverlay.tsx`, `IncomingCallOverlay.tsx`, and the server webhook routes `server/src/routes/telnyx.ts` + `twilio.ts`.

> **Headline:** There is **no server-side campaign scheduler, no queue, and no workers.** "Power dialing" is a *client-side auto-swipe* after disposition; there is **no auto-dial**, no outbound queue, no concurrency control, no retry logic, no voicemail/busy detection, and **no call recording**. The engine is a single-active-call WebRTC client per provider with manual progression. Every "edge case" below is therefore either unimplemented or handled only client-side with known races.

---

## Summary Table

| # | Severity | Area | Finding |
|---|----------|------|---------|
| 1 | **Critical** | Architecture | No server-side scheduler/queue/workers. No auto-dial; "power" = auto-swipe only. Cannot scale beyond one agent's browser. |
| 2 | **Critical** | Concurrency / Race | `CampaignDialerPage` auto-advance (power) + manual swipe can double-advance or skip leads; `currentIndex` mutated in multiple async paths. |
| 3 | **High** | Call lifecycle | Disposition is saved on `primaryCallState === 'done'` for ANY call attempt (even 1-ring no-answer), marking leads "answered" incorrectly. |
| 4 | **High** | Telnyx | `hungUpCallIdsRef` zombie-guard exists but is **never read** — zombie `done` notifications still reset state. |
| 5 | **High** | Twilio | `holdAndAnswer` / `toggleHold` / `hangupAndResume` are **stubs** (no-op/console.warn). Hold/resume impossible on Twilio. |
| 6 | **High** | Webhooks | `/api/twilio/voice` & `/webhook` and `/api/telnyx/webhook` are **unauthenticated + unsigned** (backend audit #6/#7). Toll-fraud / spoofing vector. |
| 7 | **Medium** | Retries | No retry on call failure, token fetch failure, or SIP reconnect. Single attempt only. |
| 8 | **Medium** | Failure handling | `sipError` is set on call end but the dialer page only toasts `sipError` on change; a failed call still shows disposition overlay (see #3). |
| 9 | **Medium** | Voicemail/Busy detection | **Not implemented.** No AMD (Answering Machine Detection), no busy-tone parsing. `sipReason`/`cause` only shown as text. |
| 10 | **Medium** | Call recording | **Not implemented.** No `record` on Twilio VoiceGrant, no Telnyx record param, no `recording_url` ever written (DB column exists but unused). |
| 11 | **Medium** | Memory leaks | `useTelnyxCall` is a **dead/duplicate** Telnyx client (TelnyxContext is the real one) — if ever mounted, two WebSocket clients leak. Timers cleared on unmount (good) but `console.log` spam in prod. |
| 12 | **Low** | Twilio | `device.connect()` promise resolves with a `Call`, but `attachCallListeners` is only attached in `.then`; a fast disconnect before resolve can leave a listener-less call. |
| 13 | **Low** | Telnyx | `toE164` assumes US `+1`; non-US numbers without `+` get a wrong `+1` prefix → misdialed international calls. |
| 14 | **Low** | Local calling | `useLocalCalling` opens `tel:` and waits for `visibilitychange`; if the user doesn't return to the tab, the disposition callback never fires and the lead stays "new". |
| 15 | **Low** | Race | `prevCallState` ref in CampaignDialerPage updated inside the effect after comparison; rapid state flips can miss the transition. |
| 16 | **Low** | Twilio token | `identity: user_${userId}` is stable; multiple tabs/devices share one Twilio identity → only one registers (Twilio rejects duplicate identity). |

---

## Detailed Findings

### 1. No scheduler / queue / workers (architecture)
- **Severity:** Critical
- **Area:** Campaign scheduler, Queue, Workers
- **Explanation:** The server has **no dialing engine**. `server/src` contains only REST + token-minting + TwiML. There is no cron, no queue (BullMQ/Redis), no worker process, no outbound dialer loop. "Power dialer" is implemented entirely in `CampaignDialerPage.handleDisposition` (lines 205–210): after saving a disposition it calls `setTimeout(triggerSwipeLeft, 1500)` — i.e. it advances the *card*, it does **not** place the next call. The agent must still tap "Dial" for every lead. There is no server-driven sequential dialing, no pacing, no abandoned-call rules (TCPA), no concurrency limit.
- **Recommended fix:** If true power/progressive dialing is required, build a server-side dialer: a queue of `(campaign_id, lead_id)` rows, a worker that places calls via Twilio/Telnyx REST APIs (not browser WebRTC), respects a concurrency cap and compliance windows, and writes outcomes via the existing `calls/log` path. The browser then becomes a supervisor/monitor, not the dialer.

### 2. Double-advance / index race in dialer
- **Severity:** Critical
- **Area:** Concurrency / Race conditions
- **Explanation:** `currentIndex` is mutated by (a) `navigateNext`/`navigatePrev` (swipe), (b) `handleDisposition` → `triggerSwipeLeft` (power auto-advance), and (c) `markMeetingBooked`. In power mode, after disposition the 1.5s timer fires `triggerSwipeLeft` → `navigateNext`. If the user also swipes during those 1.5s (drag is disabled only while `isInCall`/`showDisposition`/`isDetailsExpanded` — but `showDisposition` is true during that window, so drag is disabled… however the DTMF/notes interactions and rapid taps can still race). More importantly, `navigateNext` reads `currentIndex` from closure; two near-simultaneous calls (e.g. swipe + auto-advance) can both compute `currentIndex+1` and skip a lead or re-show one. There is no monotonic "consumed lead" guard.
- **Recommended fix:** Use a single `advanceToNextUncalled()` that atomically marks the current lead consumed (optimistic `status` update) and moves to the next `status === 'new'` lead, guarded by a `isAdvancing` ref. Never advance based on raw `currentIndex` arithmetic from multiple sources.

### 3. Disposition saved for any call attempt
- **Severity:** High
- **Area:** Call lifecycle / Failure handling
- **Explanation:** `CampaignDialerPage` (lines 137–146) shows the disposition overlay whenever `prevCallState` was `trying/ringing/active` and the new state is `done`. This fires even if the call rang once and the prospect didn't answer (no-answer), or busy, or failed. The agent then picks a disposition; `callsApi.log` stores `disposition` and `leadsApi.updateDisposition` sets `lead.status = disposition`. If the agent taps "Interested" on a no-answer, the lead is wrongly marked `answered`. There is no linkage between the actual call outcome (busy/voicemail/no-answer) and the default disposition.
- **Recommended fix:** Pre-select the disposition based on the call's `sipReason`/`cause`/`CallStatus` (no_answer → "No Answer", busy → "Wrong Number", failed → leave unmarked). Default the overlay to the detected outcome, let the agent override.

### 4. Zombie-call guard never read (Telnyx)
- **Severity:** High
- **Area:** Call lifecycle / Race
- **Explanation:** `TelnyxContext.hangup()` adds the call id to `hungUpCallIdsRef` (lines 483–485) "so we ignore any zombie notifications," but **nothing ever reads `hungUpCallIdsRef`** in `handleNotification`. A post-hangup `done`/`destroy` notification from the SDK will still run the primary-call teardown branch (lines 288–304), re-setting `primaryCallState='done'` and `setActiveCallRoute(null)`. Usually harmless, but if a *new* call was already placed and shares timing, the stale notification can tear down the wrong call. The guard is dead code.
- **Recommended fix:** In `handleNotification`, early-return if `hungUpCallIdsRef.current.has(callId)` (and delete it after a short TTL). Or remove the ref entirely.

### 5. Twilio hold is a stub
- **Severity:** High
- **Area:** Twilio / Call lifecycle
- **Explanation:** `TwilioContext.holdAndAnswer`, `hangupAndResume`, and `toggleHold` are no-ops that `console.warn` (lines 387–407). So on Twilio, the "answer incoming while holding" flow (which Telnyx supports via `holdAndAnswer`) silently does nothing. `VoiceContext.holdAndAnswer` delegates to it, so the unified interface lies about capability.
- **Recommended fix:** Implement hold via Twilio's REST API (park/queue/conference) or document Twilio as not supporting hold and disable the UI control when `activeProvider === 'twilio'`.

### 6. Unsigned webhooks
- **Severity:** High
- **Area:** Webhooks / Security
- **Explanation:** `twilio.ts` `/voice` and `/webhook`, and `telnyx.ts` `/webhook`, have no auth and no signature validation (see backend audit #6/#7). Anyone can POST a forged TwiML request to `/api/twilio/voice` and cause Twilio-originated calls to arbitrary numbers using the configured caller ID (toll fraud), or forge status events.
- **Recommended fix:** Validate `X-Twilio-Signature` (HMAC over URL+params with `TWILIO_AUTH_TOKEN`) and Telnyx signature/public-IP allowlist. Reject on mismatch.

### 7. No retries
- **Severity:** Medium
- **Area:** Retries
- **Explanation:** No retry anywhere in the call path. If `telnyxApi.getToken()` fails, `initConnection` falls back to SIP creds once, then gives up. If the SIP socket drops mid-call, there's no auto-reconnect that re-establishes the call. If `callsApi.log` fails (e.g. network blip), the disposition is lost (the lead status was already updated separately, so state is inconsistent).
- **Recommended fix:** Add bounded retry with backoff for token fetch and for `callsApi.log` (idempotent on `lead_id+campaign_id+call attempt`). For in-call drops, surface a clear "call dropped" state rather than silent `done`.

### 8. Failure surfaced but flow continues
- **Severity:** Medium
- **Area:** Failure handling
- **Explanation:** On call failure, `TelnyxContext` sets `sipError` (e.g. "Call Failed: …"). `CampaignDialerPage` toasts `sipError` on change (line 149) but still shows the disposition overlay (because `primaryCallState` became `done`). So a failed call still prompts the agent to disposition it, and the lead gets marked — see #3.
- **Recommended fix:** When `sipError` is set on a `done` transition, skip the disposition overlay (or pre-fill "No Answer"/"Failed") and don't let the agent mark it "Interested".

### 9. No voicemail / busy detection
- **Severity:** Medium
- **Area:** Voicemail detection / Busy detection
- **Explanation:** There is **no AMD** and no busy-tone parsing. `sipReason`/`cause` strings are only displayed as error text. The app cannot distinguish "human answered" vs "voicemail" vs "busy" vs "no-answer" programmatically, so it cannot auto-disposition or branch logic (e.g. drop a pre-recorded VM).
- **Recommended fix:** Enable provider AMD (Telnyx `answering_machine_detection`, Twilio `MachineDetection`) and map the result into the call outcome + disposition default. Parse `sipReason`/`cause` into a typed outcome enum.

### 10. No call recording
- **Severity:** Medium
- **Area:** Call recording
- **Explanation:** `call_logs.recording_url` column exists (DB audit #2) but **nothing ever sets it**. Twilio `VoiceGrant` has no `recording` enabled; Telnyx `newCall` passes no `record` param. Compliance/QA recording is absent.
- **Recommended fix:** If recording is desired, enable it at the provider (Twilio `recordingEnabled: true` on the grant / `<Record>` in TwiML; Telnyx `record: true`), capture the URL from the webhook, and store it in `call_logs.recording_url` (requires the `call_logs` table to exist first — DB audit #2).

### 11. Dead duplicate Telnyx client (memory leak risk)
- **Severity:** Medium
- **Area:** Memory leaks / Architecture
- **Explanation:** `hooks/useTelnyxCall.ts` is a **full second Telnyx WebRTC client implementation** that is **not used by the app** (TelnyxContext is the real provider mounted in `ProtectedLayout`). If it were ever mounted, it would open a second WebSocket SIP connection and a second set of `setInterval` timers. As-is it's dead code that confuses maintainers and risks a leak if imported.
- **Recommended fix:** Delete `useTelnyxCall.ts` (and `useTelnyxCall` references) — TelnyxContext is the single source of truth.

### 12. Twilio listener attached post-resolve
- **Severity:** Low
- **Area:** Call lifecycle / Race
- **Explanation:** `device.connect({...}).then(call => attachCallListeners(call))` — listeners are attached only after the promise resolves. A very fast `disconnect`/`cancel` before resolution leaves a call with no listeners and a dangling `primaryCallRef`. Low likelihood but possible on flaky networks.
- **Recommended fix:** Attach listeners inside the `.then` (already done) but also guard `hangup()` against a not-yet-resolved call by tracking the pending promise.

### 13. `toE164` assumes US
- **Severity:** Low
- **Area:** Telnyx / International
- **Explanation:** `toE164` (TelnyxContext lines 27–34) prepends `+1` for 10-digit and `+` for 11-digit-starting-with-1. A UK number `2079460000` (10 digits) becomes `+12079460000` (wrong). Non-US campaigns will misdial.
- **Recommended fix:** Require E.164 input (validate `^\+[1-9]\d{7,14}$`) and refuse to dial otherwise, or make the country code configurable per campaign/user.

### 14. Local-call disposition may never fire
- **Severity:** Low
- **Area:** Local calling / Lifecycle
- **Explanation:** `useLocalCalling` opens `tel:` and waits for `visibilitychange` to `visible` to fire `onReturn` (disposition). If the user closes the tab, switches and never returns, or the OS doesn't background the tab, the callback never runs and the lead stays `new` (never dispositioned).
- **Recommended fix:** Also trigger on `focus`/`pageshow`, add a timeout fallback that prompts disposition, and persist "pending local call" state.

### 15. `prevCallState` ref timing
- **Severity:** Low
- **Area:** Race conditions
- **Explanation:** `CampaignDialerPage` (lines 138–146) compares `prevCallState.current` then sets it at the end of the effect. If two `primaryCallState` updates arrive in the same tick (React batches), the comparison uses a stale `prev`. Rapid connect→disconnect→connect could miss a transition.
- **Recommended fix:** Use a reducer or compare against the previous rendered value via `usePrevious` with proper ordering; or drive disposition off explicit SDK events, not derived state diffs.

### 16. Twilio shared identity across tabs
- **Severity:** Low
- **Area:** Twilio / Concurrency
- **Explanation:** `identity: user_${userId}` is constant. Twilio allows only one Device registered per identity at a time; opening two browser tabs (or two agents on the same account) causes the second to fail registration or kick the first.
- **Recommended fix:** Append a per-session/per-device UUID to the identity, or scope tokens per device.

---

## Component-by-Component Notes

**TelnyxContext** (the real Telnyx client): well-structured multi-call model (primary/incoming/held) with `holdAndAnswer`/`hangupAndResume` actually implemented. Issues: dead `hungUpCallIdsRef` (#4), US-only `toE164` (#13), `console.log` in prod, no AMD/recording (#9/#10).

**TwilioContext**: single-call model; hold is stubbed (#5); listener attached post-resolve (#12); shared identity (#16). Otherwise mirrors Telnyx.

**VoiceContext**: clean delegation; exposes `holdAndAnswer`/`hangupAndResume` that silently no-op on Twilio — the UI can't tell capability differs.

**useTelnyxCall**: dead duplicate client (#11). Should be deleted.

**useLocalCalling**: `tel:` bridge; callback fragility (#14).

**CampaignDialerPage**: the "scheduler." Auto-swipe only (#1); index races (#2); disposition-on-any-attempt (#3); `prevCallState` timing (#15).

**Server routes (telnyx.ts / twilio.ts)**: token minting + TwiML only. Webhooks unsigned (#6). No recording/AMD wiring (#9/#10). `telnyx.ts` webhook logs hangup but does nothing (the "Future: update call_logs" comment confirms call events are not persisted — consistent with `call_logs` not existing, DB audit #2).

---

## What the engine CAN and CANNOT do

**Can:** Place/receive a single WebRTC call per provider in the browser; mute/hold (Telnyx)/DTMF; manually progress through leads (swipe or tap); save disposition + call log (once `call_logs` exists); local `tel:` dialing.

**Cannot:** Auto-dial a list (no server dialer); run multiple concurrent outbound calls; retry failed calls; detect voicemail/busy; record calls; persist call events via webhooks; enforce compliance pacing; scale beyond one browser tab.

---

*End of AUDIT_05_CALL_ENGINE.md — inspection complete, no source files were modified.*