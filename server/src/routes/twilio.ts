import express, { Router, Request, Response } from 'express';
import twilio from 'twilio';
import jwt from 'jsonwebtoken';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';

const router = Router();
const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

// ── POST /api/twilio/token ─────────────────────────────────────────
// Authenticated. Generates a short-lived Twilio Access Token with VoiceGrant.
router.post('/token', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized', 'auth_required');

    // Fetch Twilio credentials from user_settings
    const { data: settings, error } = await req.db!.database
      .from('user_settings')
      .select('twilio_account_sid, twilio_api_key, twilio_api_secret, twilio_twiml_app_sid')
      .eq('user_id', userId)
      .single();

    if (error || !settings?.twilio_account_sid) {
      throw new ApiError(400, 'Twilio Account SID not configured. Go to Connectors page.', 'config_missing');
    }
    if (!settings?.twilio_api_key || !settings?.twilio_api_secret) {
      throw new ApiError(400, 'Twilio API Key/Secret not configured. Go to Connectors page.', 'config_missing');
    }
    if (!settings?.twilio_twiml_app_sid) {
      throw new ApiError(400, 'TwiML App SID not configured. Go to Connectors page.', 'config_missing');
    }

    console.log('=== TWILIO TOKEN DEBUG ===');
    console.log('1. User ID:', userId);
    console.log('2. Stored Account SID:', settings.twilio_account_sid);
    console.log('3. Stored API Key SID:', settings.twilio_api_key);
    console.log('4. Stored TwiML App SID:', settings.twilio_twiml_app_sid);
    console.log('5. Identity being set:', `user_${userId}`);

    const token = new AccessToken(
      settings.twilio_account_sid,
      settings.twilio_api_key,
      settings.twilio_api_secret,
      { identity: `user_${userId}` }
    );

    const grant = new VoiceGrant({
      outgoingApplicationSid: settings.twilio_twiml_app_sid,
      incomingAllow: true,
    });
    token.addGrant(grant);

const jwtString = token.toJwt();
    
    // Decode the JWT to verify payload
    const decoded = jwt.decode(jwtString, { complete: true });
    const header = decoded && typeof decoded === 'object' ? decoded.header : null;
    const rawPayload = decoded && typeof decoded === 'object' ? decoded.payload : null;
    const payload = rawPayload as Record<string, unknown> | null;
    const grants = (payload?.grants as Record<string, unknown> | undefined);
    const voiceGrant = grants?.voice as Record<string, unknown> | undefined;
    
    console.log('6. JWT Header:', JSON.stringify(header, null, 2));
    console.log('7. JWT Payload:', JSON.stringify(payload, null, 2));
    console.log('8. VoiceGrant in payload:', JSON.stringify(voiceGrant, null, 2));
    console.log('   - outgoingApplicationSid:', voiceGrant?.outgoing_application_sid);
    console.log('   - incomingAllow:', voiceGrant?.incoming);
    console.log('   - identity:', payload?.sub);
    console.log('   - iss (Account SID):', payload?.iss);
    console.log('   - exp (expiry):', payload?.exp, '(', payload?.exp ? new Date((payload.exp as number) * 1000).toISOString() : 'N/A', ')');
    console.log('   - nbf (not before):', payload?.nbf);
    console.log('   - iat (issued at):', payload?.iat);
    console.log('9. TwiML App SID match:', voiceGrant?.outgoing_application_sid === settings.twilio_twiml_app_sid ? '✅ MATCH' : '❌ MISMATCH');
    
    console.log('[twilio/token] Token generated successfully');
    console.log('=== END TWILIO TOKEN DEBUG ===');
    
    res.json({ data: { token: jwtString } });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/twilio/voice ─────────────────────────────────────────
// Unauthenticated TwiML webhook. Twilio calls this when a browser
// client initiates an outbound call via device.connect().
// Returns TwiML XML instructing Twilio how to route the call.
router.post('/voice', express.urlencoded({ extended: false }), (req: Request, res: Response) => {
  try {
    console.log('=== TWILIO VOICE WEBHOOK DEBUG ===');
    console.log('1. HTTP Method:', req.method);
    console.log('2. URL:', req.url);
    console.log('3. Headers:', JSON.stringify(req.headers, null, 2));
    console.log('4. req.body (raw):', JSON.stringify(req.body, null, 2));
    console.log('5. req.body.To:', req.body.To);
    console.log('6. req.body.From:', req.body.From);
    console.log('7. req.body.Caller:', req.body.Caller);
    console.log('8. req.body.CallSid:', req.body.CallSid);
    console.log('9. req.body.Direction:', req.body.Direction);
    console.log('10. req.body.ApiVersion:', req.body.ApiVersion);

    const twiml = new twilio.twiml.VoiceResponse();
    const to = req.body.To;
    const from = req.body.From || req.body.Caller;

    console.log(`[Twilio Voice Webhook] Parsed: To=${to}, From=${from}`);

    // Validate callerId - Twilio requires a verified phone number for outbound calls
    // The client already validates this before calling device.connect() (TwilioContext line 313)
    if (!from || !/^\+?\d{10,15}$/.test(from.replace(/[\s\-()]/g, ''))) {
      console.error('[Twilio Voice Webhook] Missing or invalid callerId (From):', from);
      twiml.say('Caller ID not configured. Please set a verified phone number in your connector settings.');
      const errorTwiML = twiml.toString();
      console.log('11. ERROR TwiML generated:', errorTwiML);
      res.type('text/xml').send(errorTwiML);
      return;
    }

    if (to) {
      // If "To" looks like a phone number, dial it
      if (/^[\d+\-() ]+$/.test(to)) {
        console.log('[Twilio Voice Webhook] Dialing number:', to, 'with callerId:', from);
        const dial = twiml.dial({ callerId: from });
        dial.number(to);
      } else {
        // Could be a client identity — dial as client
        console.log('[Twilio Voice Webhook] Dialing client:', to, 'with callerId:', from);
        const dial = twiml.dial({ callerId: from });
        dial.client(to);
      }
    } else {
      console.error('[Twilio Voice Webhook] No destination number provided');
      twiml.say('No destination number was provided.');
    }

    const generatedTwiML = twiml.toString();
    console.log('11. SUCCESS TwiML generated:', generatedTwiML);
    console.log('=== END TWILIO VOICE WEBHOOK DEBUG ===');
    res.type('text/xml').send(generatedTwiML);
  } catch (err) {
    console.error('[Twilio Voice Webhook] Error:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('An application error occurred.');
    const errorTwiML = twiml.toString();
    console.log('11. EXCEPTION TwiML:', errorTwiML);
    res.type('text/xml').status(500).send(errorTwiML);
  }
});

// ── POST /api/twilio/webhook ───────────────────────────────────────
// Status callback webhook for call events (optional, for future use)
router.post('/webhook', express.json(), async (req: Request, res: Response) => {
  try {
    const eventType = req.body?.CallStatus;
    console.log(`[Twilio Webhook] Status: ${eventType}`);
    res.status(200).send('OK');
  } catch (err) {
    console.error('[Twilio Webhook] Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
