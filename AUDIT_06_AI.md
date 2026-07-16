# AUDIT_06_AI.md

**DialerJazz — AI Voice Agent Readiness Audit**
*Inspection-only. No source files were modified.*

Scope requested: call routing, webhooks, media streaming, realtime audio, prompt-injection points, conversation lifecycle, transcript storage, recording storage, provider abstraction, and compatibility with Retell / Vapi / ElevenLabs.

> **Verdict: NOT READY.** There is **zero AI voice-agent infrastructure** in this project. A repo-wide search for `retell|vapi|elevenlabs|openai|realtime|websocket|media|stream|transcript|conversation|agent|llm|gpt|speech` across `client/src` and `server/src` returns **exactly one hit** — the word "realtime" inside `insforge.md`, where it refers to InsForge's database pub/sub, not AI. No AI provider keys exist in any `.env*`. The Twilio `/voice` webhook emits a bare `<Dial>` with no `<Stream>`, `<Gather>`, `<Say>`, or `<Record>`. The `@insforge/sdk` *does* expose an `insforge.ai` namespace (chat/completions/vision/embeddings, OpenAI-compatible), but **no application code calls it**.

---

## Summary Table — What's Missing

| # | Area | Status | Missing / Required for AI voice agents |
|---|------|--------|----------------------------------------|
| 1 | Call routing to an agent | ❌ Absent | No logic to fork/bridge a live call to Retell/Vapi/ElevenLabs; outbound calls go straight `<Dial>` to the human. |
| 2 | Webhooks (AI events) | ❌ Absent | No endpoints for agent `call_ended`, `transcript`, `tool_call`, `function-call`, `hangup`, `speech_updated`. |
| 3 | Media streaming | ❌ Absent | No Twilio `<Stream>` / Telnyx media WebSocket; no audio tap into any STT/LLM/TTS pipeline. |
| 4 | Realtime audio | ❌ Absent | No bidirectional audio path to an LLM (OpenAI Realtime, ElevenLabs, etc.); browser WebRTC is human-only. |
| 5 | Prompt injection points | ⚠️ Latent | Lead/company/notes fields are free text rendered into future prompts → injection risk once an agent is wired. |
| 6 | Conversation lifecycle | ❌ Absent | No session create/end, turn-taking, interruption handling, or agent state machine. |
| 7 | Transcript storage | ❌ Absent | No `transcripts` table; `call_logs` (which doesn't even exist, DB audit #2) has no transcript column. |
| 8 | Recording storage | ❌ Absent | No recording capture at all (call-engine audit #10); no bucket/URL persistence. |
| 9 | Provider abstraction (AI) | ❌ Absent | `VoiceContext` abstracts *human* calling only (Telnyx/Twilio/local); no AI-agent provider interface. |
| 10 | Retell compatibility | ❌ Absent | No Retell SDK, webhook handling, or `<Stream>`/SIP trunking integration. |
| 11 | Vapi compatibility | ❌ Absent | No Vapi SDK, assistant wiring, or SIP/WebRTC bridge. |
| 12 | ElevenLabs compatibility | ❌ Absent | No ElevenLabs Conversational AI client, agent ID config, or WS connection. |
| 13 | Config / secrets | ❌ Absent | No `RETELL_API_KEY`, `VAPI_API_KEY`, `ELEVENLABS_API_KEY`, or agent IDs in `.env*`. |
| 14 | Tool / function calling | ❌ Absent | No tool registry to let an agent read/write leads, log dispositions, or query CRM. |
| 15 | Compliance / PII for AI | ❌ Absent | No consent capture, no PII redaction for prompts, no retention policy for transcripts/recordings. |

---

## Detailed Findings

### 1. Call routing — no agent fork
- **Severity:** Blocker
- **Explanation:** `server/src/routes/twilio.ts` `/voice` returns `<Dial callerId=from><Number>to</Number></Dial>`. The call connects human→human. There is no branch to route the call through an AI agent (e.g. Twilio `<Dial>` to a Retell/Vapi SIP trunk, or `<Stream>` to a media server, or `<Connect>` to an AI assistant). Telnyx has no `call control` webhook that forks to an agent either.
- **Required:** A routing decision layer (based on campaign config) that, for AI campaigns, bridges the call to the chosen provider via SIP trunk / `<Stream>` / `<Connect>`, and a Telnyx Call Control app that does the same.

### 2. Webhooks — no AI event ingestion
- **Severity:** Blocker
- **Explanation:** The only webhooks are `/api/twilio/voice` (TwiML), `/api/twilio/webhook` (logs `CallStatus` only), and `/api/telnyx/webhook` (logs `call.hangup` only). None handle agent-platform events: `transcript`, `tool_call`/`function_call`, `agent_end`, `speech_updated`, `hangup`, `call_analyzed`.
- **Required:** Per-provider webhook routes that verify signatures and persist events; a unified internal "agent event" model.

### 3. Media streaming — no audio tap
- **Severity:** Blocker
- **Explanation:** No `<Stream url=.../>` in TwiML, no Telnyx media WebSocket subscription. Audio never leaves the carrier→browser path, so no STT/LLM/TTS can process it.
- **Required:** Twilio `<Stream>` to a media server (or directly to the provider's WS); Telnyx `call:media` events over WS; a media bridge if using browser-based agents.

### 4. Realtime audio — no LLM audio path
- **Severity:** Blocker
- **Explanation:** The only realtime audio is the human WebRTC session in `TelnyxContext`/`TwilioContext`. There is no connection to OpenAI Realtime, ElevenLabs Conversational AI, or any provider's audio WS. The `insforge.ai` namespace is text/chat only (no audio).
- **Required:** Provider-specific realtime client (WS) or provider-hosted audio (SIP/`<Connect>`), plus interruption handling.

### 5. Prompt injection points — latent risk
- **Severity:** High (becomes Critical once AI is added)
- **Explanation:** Lead fields `first_name`, `last_name`, `company`, `notes`, `custom_fields` (and campaign `name`) are free-text, user/import-supplied, and would naturally be injected into an agent system prompt ("Here is the lead: {notes}"). Without sanitization, a lead's `notes` could contain "ignore previous instructions and …" — a classic prompt-injection vector that, combined with tool-calling (#14), could exfiltrate data or trigger unwanted CRM writes.
- **Required:** Treat all CRM text as untrusted; strip/escape/segment it from system instructions; never let lead text influence tool authorization; add injection detection.

### 6. Conversation lifecycle — absent
- **Severity:** Blocker
- **Explanation:** No concept of an "agent session," turns, barge-in/interrupt, or end-of-call summary. The current lifecycle is connect→active→done (call-engine audit #3).
- **Required:** A conversation/session state machine per call, tied to the lead/campaign, with start/end, turn events, and a post-call summary step.

### 7. Transcript storage — absent
- **Severity:** Blocker
- **Explanation:** No `transcripts` table. `call_logs` (which doesn't exist, DB audit #2) has no transcript column. Even if a provider returned a transcript, nothing would store it.
- **Required:** Create `call_transcripts` (id, call_log_id, role ['user'|'agent'], content, ts, provider) + add `transcript`/`summary` columns to `call_logs`; RLS-scoped (DB audit #1).

### 8. Recording storage — absent
- **Severity:** Blocker
- **Explanation:** No recording is captured anywhere (call-engine audit #10). `recording_url` column exists in the (missing) `call_logs` but is never written. No object storage (S3/GCS) integration.
- **Required:** Enable provider recording, capture the URL from webhooks, store in `call_logs.recording_url` (or an object store), with retention/PII controls.

### 9. Provider abstraction (AI) — absent
- **Severity:** Blocker
- **Explanation:** `VoiceContext` abstracts *human* telephony (Telnyx/Twilio/local) only. There is no `AgentProvider` interface (e.g. `createSession`, `sendToolResult`, `endSession`) that Retell/Vapi/ElevenLabs could implement. The architecture would need a second abstraction layer for AI agents, separate from the voice-call abstraction.
- **Required:** Define an `AIAgentProvider` interface and per-provider adapters; a campaign flag selecting `human` vs `agent:<provider>`.

### 10–12. Retell / Vapi / ElevenLabs compatibility — absent
- **Severity:** Blocker
- **Explanation:** No SDK imports, no assistant/agent ID config, no SIP trunk or WS bridge, no webhook verification for any of the three. The project is provider-agnostic for *human* calling but has **no** integration with any AI-voice platform.
- **Required (per provider):**
  - **Retell:** Retell Node SDK, `call.create` (SIP/Web), `webhook` handler for `call_ended`/`transcript`/`tool_call`; verify `x-retell-signature`.
  - **Vapi:** Vapi SDK, assistant creation, `call` trigger, webhook for `status-update`/`transcript`/`tool-calls`; verify `x-vapi-signature`.
  - **ElevenLabs:** Conversational AI client/agent ID, WS or SIP, webhook for `conversation_ended`/`transcript`; verify signature.

### 13. Config / secrets — absent
- **Severity:** Blocker
- **Explanation:** `.env.example` and running `.env` contain only InsForge + (optionally) Twilio/Telnyx human-calling keys. No AI provider keys or agent IDs.
- **Required:** `RETELL_API_KEY`, `VAPI_API_KEY`, `ELEVENLABS_API_KEY`, plus per-campaign `agent_id`/`assistant_id` storage (in `campaigns`, encrypted like other secrets — DB audit #5).

### 14. Tool / function calling — absent
- **Severity:** High
- **Explanation:** An AI agent is only useful if it can act (look up lead, log disposition, book meeting). There is no tool registry, no authenticated server-side functions the agent can call, and no scoping of what an agent may do.
- **Required:** A tool/function registry backed by existing APIs (leads/calls), each requiring the agent to present a valid session token; authorization checks so the agent can only touch its own campaign's leads.

### 15. Compliance / PII — absent
- **Severity:** High
- **Explanation:** AI voice agents typically require call recording + transcript, which triggers wiretap/GDPR/CCPA consent and PII-handling obligations. The app has no consent capture, no PII redaction before sending lead data to a third-party LLM, and no retention policy.
- **Required:** Consent announcement + flag, PII redaction in prompts, retention TTLs, and a DPA with the AI provider.

---

## What exists today that could be reused
- **`calls/log` + `leads/updateDisposition`** endpoints are a natural home for agent outcomes (disposition, notes, duration) — once `call_logs` exists (DB audit #2).
- **`VoiceContext` provider pattern** is a good template for a future `AIAgentProvider` abstraction.
- **InsForge `insforge.ai`** offers OpenAI-compatible chat completions — usable for a *text* agent or for summarization, but **not** for realtime voice (no audio streaming). It could power post-call summarization or a text-based copilot, but not a conversational voice agent.
- **Campaign config** (`provider`, `dialer_mode`, `caller_number`) is the right place to add an `agent_provider` + `agent_id` without restructuring.

---

## Readiness Checklist (all currently ❌)
- [ ] ❌ AI call routing / bridging
- [ ] ❌ AI webhook ingestion (signed)
- [ ] ❌ Media streaming (`<Stream>` / Telnyx WS)
- [ ] ❌ Realtime audio to LLM
- [ ] ❌ Conversation lifecycle / session state
- [ ] ❌ Transcript storage schema
- [ ] ❌ Recording storage
- [ ] ❌ AI provider abstraction
- [ ] ❌ Retell integration
- [ ] ❌ Vapi integration
- [ ] ❌ ElevenLabs integration
- [ ] ❌ AI secrets/config
- [ ] ❌ Tool/function calling registry
- [ ] ❌ Prompt-injection hardening
- [ ] ❌ Compliance/PII controls

**Conclusion:** DialerJazz is a human-operated click/power dialer. It is **not** AI-voice-agent ready. Adopting Retell/Vapi/ElevenLabs would require building an entirely new subsystem: AI routing in the TwiML/Call-Control webhooks, media streaming, signed AI webhooks, a conversation-lifecycle + session store, transcript/recording persistence (including the missing `call_logs` table), an `AIAgentProvider` abstraction, tool-calling with authorization, and compliance/PII controls. The only reusable pieces are the existing disposition/log endpoints, the provider-abstraction pattern, and (for text only) `insforge.ai`.

---

*End of AUDIT_06_AI.md — inspection complete, no source files were modified.*