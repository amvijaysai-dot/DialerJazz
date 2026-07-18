# DialerJazz V2 - Phase 1: Multi-Provider Telephony Architecture

## Objective
Complete the multi-provider telephony architecture so DialerJazz fully supports both Twilio and Telnyx without changing existing campaign functionality.

---

## Architecture Verification

### VoiceContext is the Single Abstraction Layer ✅ VERIFIED
- `VoiceContext.tsx` delegates to `TelnyxContext` or `TwilioContext` based on `activeProvider`
- `useVoice()` hook is the single interface all components use
- Provider selection happens via `connectProvider(provider)` in VoiceContext

### Current Provider Capabilities Matrix

| Feature | Telnyx (TelnyxRTC) | Twilio (Voice SDK) | VoiceContext Delegation |
|---------|-------------------|-------------------|----------------------|
| connect | ✅ `initConnection()` | ✅ `initConnection()` | ✅ |
| disconnect | ✅ `disconnect()` | ✅ `disconnect()` | ✅ |
| makeCall | ✅ `dial(dest, callerNum)` | ✅ `dial(dest, callerNum)` | ✅ |
| hangup | ✅ `hangup()` | ✅ `hangup()` | ✅ |
| mute | ✅ `toggleMute()` | ✅ `toggleMute()` | ✅ |
| unmute | ✅ `toggleMute()` | ✅ `mute(false)` | ✅ |
| sendDTMF | ✅ `sendDTMF(digit)` | ✅ `sendDigits(digit)` | ✅ |
| hold | ✅ `toggleHold()` / `hold()` | ❌ Stub (console.warn) | ⚠️ Asymmetric |
| resume | ✅ `hangupAndResume()` | ❌ Stub | ⚠️ Asymmetric |
| activeCall | ✅ `primaryCall` state | ✅ `primaryCall` state | ✅ |
| callState | ✅ `primaryCallState` | ✅ `primaryCallState` | ✅ |
| duration | ✅ `primaryCallDuration` | ✅ `primaryCallDuration` | ✅ |
| reconnect status | ❌ No reconnect logic | ❌ No reconnect logic | ❌ Missing (both) |

---

## Campaign Provider Flow ✅ VERIFIED

The flow is already correct:
1. Create Campaign → Choose Provider → Save
2. `campaign.provider` stored in database (`telnyx`, `twilio`, `local`)
3. When CampaignDialerPage loads, it auto-connects to the campaign's provider:
   ```tsx
   // CampaignDialerPage.tsx line 179-183
   if (campaign?.provider && campaign.provider !== 'local' && voice.activeProvider !== campaign.provider) {
     voice.connectProvider(campaign.provider);
   }
   ```

---

## Files Requiring Modification

### Security Critical
- `server/src/routes/settings.ts` — Lines 27-41, 31, 76
  - **Problem**: `GET /settings` returns all secrets to frontend
  - **Fix**: Return only `connected`, `accountName`, `phoneNumbers`

### Provider Abstraction Improvements
- `server/src/routes/twilio.ts` — Lines 387-407
  - **Problem**: `holdAndAnswer`, `hangupAndResume`, `toggleHold` are stubs
  - **Fix**: Keep stubs but document capability difference; UI will disable hold controls for Twilio
- `client/src/contexts/VoiceContext.tsx` — Add capability flags
- `client/src/pages/CampaignDialerPage.tsx` — Disable hold controls when `activeProvider === 'twilio'`

### Dead Code to Remove
- `client/src/hooks/useTelnyxCall.ts` — DELETE (duplicate Telnyx client, never used)

---

## Connectors Page Security Fix Required

### Current Behavior (INSECURE)
```ts
// ConnectorsPage.tsx lines 50-58
if (data?.telnyx_sip_login) setSipLogin(data.telnyx_sip_login);
if (data?.telnyx_sip_password) setSipPassword(data.telnyx_sip_password);
```

### Required Behavior (SECURE)
Backend `GET /settings` returns:
```json
{
  "data": {
    "connected": true,
    "accountName": "Founder's Account",
    "phoneNumbers": ["+1234567890", "+10987654321"]
  }
}
```

Frontend never receives or stores secrets.

---

## Provider Interface Standardization

Both contexts expose identical interface. Asymmetric features:
- `holdAndAnswer`/`hangupAndResume`/`toggleHold` work on Telnyx only
- VoiceContext delegates correctly; UI should check `activeProvider` before enabling hold controls

---

## Validation Steps

1. Verify `VoiceContext.connectProvider()` correctly instantiates correct provider
2. Verify credentials never leave server except to provider APIs
3. Verify `CampaignDialerPage` auto-connects on campaign load
4. Test Twilio: dial, hangup, mute, DTMF work; hold controls disabled
5. Test Telnyx: dial, hangup, mute, DTMF, hold, resume all work
6. Verify no provider-specific logic in CampaignDialerPage beyond provider selection

---

## Open Questions

1. **Hold capability detection**: Should UI visually indicate hold is unavailable for Twilio, or hide hold controls?
   - **Recommended**: Visually indicate unavailable (keeps interface parity), disable `holdAndAnswer` for Twilio.