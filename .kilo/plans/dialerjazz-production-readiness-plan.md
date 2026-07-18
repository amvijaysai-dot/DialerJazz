# DialerJazz Production Readiness Plan

## Architecture Verification (Step 1)

**✅ VERIFIED:** The existing architecture is sound:
- VoiceContext provides unified delegation layer
- TelnyxContext and TwilioContext are properly isolated
- Campaigns have `provider` field with values: `telnyx`, `twilio`, `local`
- CampaignDialerPage auto-connects to campaign's provider (line 180)
- No hardcoded provider references found

**Provider abstraction is already implemented correctly at the client level.** Server routes are separate, which is acceptable.

---

## Step 2: Telephony Flow Audit

| Feature | Telnyx | Twilio | Status |
|---------|--------|--------|--------|
| Outbound calls | ✅ `client.newCall()` | ✅ `device.connect()` | Working |
| Hangup | ✅ `call.hangup()` | ✅ `call.disconnect()` | Working |
| Mute | ✅ `toggleAudioMute()` | ✅ `mute()` | Working |
| Hold | ✅ `call.hold()/unhold()` | ❌ Stub (console.warn) | **Incomplete** |
| Resume | ✅ Full flow | ❌ Stub | **Incomplete** |
| DTMF | ✅ `call.dtmf()` | ✅ `call.sendDigits()` | Working |
| Recording | ❌ Not enabled | ❌ Not enabled | **Missing** |
| Call state | ✅ `notification` events | ✅ Event listeners | Working |
| Reconnect | ❌ No auto-reconnect | ❌ No auto-reconnect | **Missing** |
| Cleanup | ✅ `useEffect` cleanup | ✅ `useEffect` cleanup | Working |
| Memory leaks | ✅ Timers cleared | ✅ Timers cleared | Working |
| Event listeners | ✅ All on client | ✅ All on call | Working |
| WebSocket cleanup | ✅ On disconnect | ✅ On device destroy | Working |

---

## Step 3-4: Provider Consistency Issues

### Critical Differences (Cannot be unified)
| Feature | Telnyx | Twilio | Notes |
|---------|--------|--------|-------|
| `holdAndAnswer` | ✅ Fully implemented | ❌ Stub | Twilio browser SDK limitation |
| `hangupAndResume` | ✅ Full support | ❌ Stub | Requires REST API/TwiML for Twilio |

### Missing Features (Both providers)
- **Call Recording**: Neither enables recording; no `recording_url` capture
- **Voicemail/Busy Detection**: No AMD implemented
- **Reconnect Logic**: No automatic reconnection on disconnect
- **Retry Logic**: No retry on failed token fetch or call failure

---

## Step 5: Campaign Provider Verification

**✅ VERIFIED:** No hardcoded provider references found.

All provider selection flows through:
1. `Campaign.provider` field (server)
2. `CampaignManagePage.provider` state
3. `CampaignDialerPage` auto-connects via `voice.connectProvider(campaign.provider)` (line 180)

Campaign statuses properly lock configuration after launch (status !== 'draft').

---

## Step 6: Connectors Page Audit

| Check | Status | Issue |
|-------|--------|-------|
| Credential validation | ✅ Live API verification | Timeout missing |
| Connection testing | ✅ Shows balance/numbers | No retry logic |
| Error messages | ✅ Toast notifications | Generic errors |
| Provider health | ✅ Shows balance | No real-time status |
| Secure storage | ❌ Secrets returned to client | `GET /settings` returns `telnyx_sip_password`, `twilio_auth_token`, etc. |

**CRITICAL SECURITY ISSUE:** Secrets stored and returned in plaintext.

---

## Step 7: Environment Variables

| Variable | Required | Status | Notes |
|----------|----------|--------|-------|
| `INSFORGE_URL` | ✅ Required | ✅ Used | InsForge API URL |
| `INSFORGE_ANON_KEY` | ✅ Required | ✅ Used | Client anon key |
| `INSFORGE_SERVICE_KEY` / `INSFORGE_API_KEY` | ✅ Required | ✅ Used | Server admin key |
| `VITE_API_URL` | ✅ Required | ✅ Used | Backend URL |
| `VITE_INSFORGE_BASE_URL` | ✅ Required | ✅ Used | InsForge URL (client) |
| `VITE_INSFORGE_ANON_KEY` | ✅ Required | ✅ Used | InsForge anon (client) |
| `JWT_SECRET` | ⚠️ Required (unused) | ⚠️ Loaded but never verified | JWT signature verification missing |
| `FRONTEND_URL` | ✅ Required | ✅ Used | CORS origin |
| `PORT` | ✅ Required | ✅ Used | Server port |
| `DB_*` vars | ❌ Optional | ⚠️ Used only for direct writes | InsForge preferred |
| `TWILIO_*` vars | ❌ Optional | ❌ Unused | Credentials stored per-user |

**Deprecated names in code:**
- `INSFORGE_BASE_URL` (used in client lib) vs `INSFORGE_URL` (standard)
- `INSFORGE_API_KEY` (checked in server lib) vs `INSFORGE_SERVICE_KEY` (documented)

---

## Step 8-9: Security Audit Summary

### Critical Security Issues (Must Fix Before Production)

| # | Issue | Files | Fix |
|---|-------|-------|-----|
| C1 | **JWT decoded but not verified** | `middleware/auth.ts:21` | Add `jwt.verify(token, JWT_SECRET)` or rely on InsForge introspection |
| C2 | **RLS disabled on all tables** | Database | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` |
| C3 | **Hardcoded fallback credentials** | `lib/insforge.ts:3` | Remove fallbacks, throw if missing |
| C4 | **Secrets returned to frontend** | `routes/settings.ts:31` | Never return `sip_password`, `auth_token`, `api_secret` |
| C5 | **Unsigned webhooks** | `routes/twilio.ts`, `routes/telnyx.ts` | Add signature validation |
| C6 | **Cross-tenant read on campaign leads** | `routes/leads.ts:164-227` | Verify campaign ownership before returning leads |

### High Priority Security

| # | Issue | Fix |
|---|-------|-----|
| H1 | Plaintext secret storage in DB | Encrypt or vault secrets |
| H2 | No CSP headers | Add Content-Security-Policy |
| H3 | Token in localStorage | Consider httpOnly cookies |
| H4 | Dependency vulnerabilities | `npm audit fix` + upgrade versions |

---

## Step 10: Code Quality Issues

### Dead Code to Remove
- `hooks/useTelnyxCall.ts` — Duplicate Telnyx client (never used)
- `Socket.io` — Initialized but unused for business logic (server/index.ts)

### Code Issues to Fix
- `CampaignDialerPage.tsx:186` — `console.log` in production path
- `index.css` — Render-blocking Google Fonts @import
- Missing memoization in `CampaignDialerPage` for progress calculations
- No code splitting for routes

---

## Step 11: Performance Issues

| Issue | Impact | Fix |
|-------|--------|-----|
| 500 leads in memory | High memory/CPU | Virtualize deck or use keyset pagination |
| Missing DB indexes | High latency | Add indexes on `created_at`, `status`, `user_id` |
| No code splitting | Large bundle | React.lazy for heavy routes |
| Sequential DB round-trips in calls/log | Latency | Collapse into single transaction |
| No caching | Repeated queries | Add in-memory cache for settings |

---

## Step 12: Production Readiness

### Blocker Issues (Critical - Must Fix)

| # | Issue | Effort |
|---|-------|--------|
| B1 | **No Docker/CI/CD** | 2-3 days |
| B2 | **No crash recovery** | 1 day |
| B3 | **Superficial health check** | 0.5 day |
| B4 | **Floating @insforge/sdk dependency** | 0.5 day |
| B5 | **No structured logging** | 1-2 days |

### Production Readiness Score

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Production Readiness | **25/100** | No Docker, CI/CD, crash recovery, structured logging |
| Security | **30/100** | RLS off, JWT unverified, secrets exposed, unsigned webhooks |
| Code Quality | **55/100** | Dead code, no tests, good structure |
| Scalability | **30/100** | Single instance, no workers, memory issues |

---

## PRIORITIZED IMPLEMENTATION PLAN

### Phase 0: Security Hardening (Week 1)
1. **C1** Add JWT signature verification (or accept InsForge as boundary)
2. **C3** Remove hardcoded fallback credentials
3. **C4** Stop returning secrets to frontend (return `configured: boolean` only)
4. **C5** Sign webhooks (Twilio signature validation, Telnyx IP allowlist)
5. **C6** Fix cross-tenant read on campaign leads endpoint
6. **L13** Remove unused Socket.io or add auth

### Phase 1: Production Foundation (Week 2)
7. Add `Dockerfile` with multi-stage build
8. Add GitHub Actions CI/CD pipeline
9. Add crash recovery handlers (`uncaughtException`, `unhandledRejection`)
10. Implement real health check with DB/InsForge probe
11. Add structured logging (pino/winston)
12. Pin `@insforge/sdk` to exact version

### Phase 2: Functionality & UX (Week 3)
13. Create missing `call_logs` table (via setup-db.ts if not exists)
14. Add missing `leads_called` column to campaigns
15. Add DB indexes for performance
16. Fix disposition logic (only save for actual call outcomes)
17. Add keyboard shortcuts to dialer
18. Add empty states to Leads/CallLogs pages
19. Add CSV template download to import flow

### Phase 3: Polish & Scale (Week 4+)
20. Virtualize dialer deck (mount current ±2 cards only)
21. Add code splitting for routes
22. Add call recording capability
23. Add retry logic for token fetch/reconnect
24. Add accessibility (aria-labels, focus traps)
25. Add analytics charts (Recharts)

---

## FILES REQUIRING MODIFICATION

### Security Fixes
- `server/src/middleware/auth.ts` — JWT verification
- `server/src/lib/insforge.ts` — Remove fallbacks
- `server/src/routes/settings.ts` — Don't return secrets
- `server/src/routes/leads.ts` — Verify campaign ownership
- `server/src/routes/twilio.ts` — Signature validation
- `server/src/routes/telnyx.ts` — Signature/IP validation

### Production Foundation
- `Dockerfile` — New file
- `.github/workflows/` — New directory
- `server/src/index.ts` — Health check, proxy trust

### Code Quality
- `client/src/hooks/useTelnyxCall.ts` — Delete (dead code)

### Performance
- `server/setup-db.ts` — Add indexes if missing
- `client/src/pages/CampaignDialerPage.tsx` — Optimize renders

---

## RISK ASSESSMENT

**Critical Risks if Deployed Unmodified:**
1. **Toll Fraud** — Unsigned Twilio webhook allows anyone to dial arbitrary numbers
2. **Credential Theft** — Secrets returned to browser + XSS = full compromise
3. **Data Exposure** — RLS off + unverified JWT = cross-tenant data access
4. **Silent Outages** — No monitoring/logging = undetected failures

**Recommended Action:** Do not deploy to production until Phase 0 is complete.