import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { ApiError } from '../middleware/errorHandler.js';
import { getDbPool } from '../lib/db.js';

const router = Router();
router.use(requireAuth);

const updateSettingsSchema = z.object({
  // Telnyx
  telnyx_api_key: z.string().optional(),
  telnyx_sip_login: z.string().optional(),
  telnyx_sip_password: z.string().optional(),
  telnyx_caller_number: z.string().optional(),
  // Twilio
  twilio_account_sid: z.string().optional(),
  twilio_auth_token: z.string().optional(),
  twilio_api_key: z.string().optional(),
  twilio_api_secret: z.string().optional(),
  twilio_twiml_app_sid: z.string().optional(),
  twilio_caller_number: z.string().optional(),
  // General
  default_provider: z.enum(['telnyx', 'twilio']).optional(),
});

router.get('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await req.db!
      .database.from('user_settings')
      .select('telnyx_api_key, telnyx_sip_login, telnyx_sip_password, telnyx_caller_number, twilio_account_sid, twilio_auth_token, twilio_api_key, twilio_api_secret, twilio_twiml_app_sid, twilio_caller_number, default_provider, created_at, updated_at')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) throw new ApiError(500, error.message, 'db_error');

    res.json({ data: data || {} });
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    console.log("=== DEBUG: PUT /settings ===");
    console.log("1. req.body:", JSON.stringify(req.body, null, 2));
    
    const body = updateSettingsSchema.parse(req.body);
    console.log("2. Zod parsed body:", JSON.stringify(body, null, 2));
    console.log("   body.twilio_caller_number:", body.twilio_caller_number);
    console.log("   body.twilio_caller_number !== undefined:", body.twilio_caller_number !== undefined);
    
    const pool = getDbPool();

    const updatePayload: Record<string, unknown> = {
      user_id: req.user.id,
      updated_at: new Date().toISOString(),
    };
    if (body.telnyx_api_key !== undefined) updatePayload.telnyx_api_key = body.telnyx_api_key;
    if (body.telnyx_sip_login !== undefined) updatePayload.telnyx_sip_login = body.telnyx_sip_login;
    if (body.telnyx_sip_password !== undefined) updatePayload.telnyx_sip_password = body.telnyx_sip_password;
    if (body.telnyx_caller_number !== undefined) updatePayload.telnyx_caller_number = body.telnyx_caller_number;
    // Twilio
    if (body.twilio_account_sid !== undefined) updatePayload.twilio_account_sid = body.twilio_account_sid;
    if (body.twilio_auth_token !== undefined) updatePayload.twilio_auth_token = body.twilio_auth_token;
    if (body.twilio_api_key !== undefined) updatePayload.twilio_api_key = body.twilio_api_key;
    if (body.twilio_api_secret !== undefined) updatePayload.twilio_api_secret = body.twilio_api_secret;
    if (body.twilio_twiml_app_sid !== undefined) updatePayload.twilio_twiml_app_sid = body.twilio_twiml_app_sid;
    if (body.twilio_caller_number !== undefined) updatePayload.twilio_caller_number = body.twilio_caller_number;
    // General
    if (body.default_provider !== undefined) updatePayload.default_provider = body.default_provider;

    console.log("3. updatePayload:", JSON.stringify(updatePayload, null, 2));
    console.log("   updatePayload.twilio_caller_number:", updatePayload.twilio_caller_number);
    console.log("   'twilio_caller_number' in updatePayload:", 'twilio_caller_number' in updatePayload);

    const columns = Object.keys(updatePayload);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    const values = columns.map((c) => updatePayload[c]);
    const updateCols = columns.filter((c) => c !== 'user_id');
    const updateClause = updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');

    console.log("4. SQL columns:", columns);
    console.log("   SQL values:", values);
    console.log("   updateClause:", updateClause);
    console.log("   twilio_caller_number in columns:", columns.includes('twilio_caller_number'));

    const { rows } = await pool.query(
      `INSERT INTO public.user_settings (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${updateClause}
       RETURNING telnyx_api_key, telnyx_sip_login, telnyx_sip_password, telnyx_caller_number, twilio_account_sid, twilio_auth_token, twilio_api_key, twilio_api_secret, twilio_twiml_app_sid, twilio_caller_number, default_provider, updated_at`,
      values
    );

    console.log("5. RETURNING row:", JSON.stringify(rows[0], null, 2));
    console.log("   DB twilio_caller_number:", rows[0]?.twilio_caller_number);
    console.log("============================");

    res.json({ data: rows[0] });
  } catch (error) {
    next(error);
  }
});
router.post('/verify-telnyx', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = z.object({ apiKey: z.string().min(10) }).parse(req.body);

    // Verify key against Telnyx real endpoint
    const telnyxRes = await fetch('https://api.telnyx.com/v2/balance', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    if (!telnyxRes.ok) {
      return res.status(400).json({ error: { code: 'invalid_key', message: 'Invalid Telnyx API Key' } });
    }

    // Save to user_settings if valid
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO public.user_settings (user_id, telnyx_api_key, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET telnyx_api_key = EXCLUDED.telnyx_api_key, updated_at = now()`,
      [req.user.id, apiKey]
    );

    res.json({ data: { success: true, message: 'Telnyx Key Validated and Saved' } });
  } catch (error) {
    next(error);
  }
});

// POST /settings/verify-twilio — Validate Twilio credentials
router.post('/verify-twilio', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { accountSid, authToken } = z.object({
      accountSid: z.string().min(10),
      authToken: z.string().min(10),
    }).parse(req.body);

    // Verify against Twilio API
    const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
    });

    if (!twilioRes.ok) {
      return res.status(400).json({ error: { code: 'invalid_key', message: 'Invalid Twilio credentials' } });
    }

    // Save to user_settings
    const pool = getDbPool();
    await pool.query(
      `INSERT INTO public.user_settings (user_id, twilio_account_sid, twilio_auth_token, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET twilio_account_sid = EXCLUDED.twilio_account_sid, twilio_auth_token = EXCLUDED.twilio_auth_token, updated_at = now()`,
      [req.user.id, accountSid, authToken]
    );

    res.json({ data: { success: true, message: 'Twilio Credentials Validated and Saved' } });
  } catch (error) {
    next(error);
  }
});

// GET /settings/telnyx/balance
router.get('/telnyx/balance', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: settings } = await req.db!
      .database.from('user_settings')
      .select('telnyx_api_key')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!settings?.telnyx_api_key) {
      return res.json({ data: null, error: 'not_configured' });
    }

    const response = await fetch('https://api.telnyx.com/v2/balance', {
      headers: {
        'Authorization': `Bearer ${settings.telnyx_api_key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch Telnyx balance');
    const data = await response.json();
    res.json({ data: data.data });
  } catch (error) {
    next(error);
  }
});

// GET /settings/telnyx/phone-numbers
router.get('/telnyx/phone-numbers', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: settings } = await req.db!
      .database.from('user_settings')
      .select('telnyx_api_key')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!settings?.telnyx_api_key) {
      return res.json({ data: null, error: 'not_configured' });
    }

    const response = await fetch('https://api.telnyx.com/v2/phone_numbers', {
      headers: {
        'Authorization': `Bearer ${settings.telnyx_api_key}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Telnyx API error:', response.statusText);
      return res.json({ data: [], error: 'invalid_credentials' });
    }
    
    const telnyxData = await response.json();
    
    // Normalize response
    const numbers = (telnyxData.data || []).map((num: any) => ({
      phone_number: num.phone_number,
      friendly_name: num.connection_name || num.phone_number,
      status: num.status
    }));

    res.json({ data: numbers });
  } catch (error) {
    console.error('Telnyx phone fetch error:', error);
    res.json({ data: [], error: 'fetch_failed' });
  }
});

// GET /settings/twilio/balance
router.get('/twilio/balance', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: settings } = await req.db!
      .database.from('user_settings')
      .select('twilio_account_sid, twilio_auth_token')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!settings?.twilio_account_sid || !settings?.twilio_auth_token) {
      return res.json({ data: null, error: 'not_configured' });
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${settings.twilio_account_sid}/Balance.json`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${settings.twilio_account_sid}:${settings.twilio_auth_token}`).toString('base64'),
      }
    });

    if (!response.ok) throw new Error('Failed to fetch Twilio balance');
    const data = await response.json();
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

// GET /settings/twilio/phone-numbers
router.get('/twilio/phone-numbers', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: settings } = await req.db!
      .database.from('user_settings')
      .select('twilio_account_sid, twilio_auth_token')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!settings?.twilio_account_sid || !settings?.twilio_auth_token) {
      return res.json({ data: null, error: 'not_configured' });
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${settings.twilio_account_sid}/IncomingPhoneNumbers.json`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${settings.twilio_account_sid}:${settings.twilio_auth_token}`).toString('base64'),
      }
    });

    if (!response.ok) {
      console.error('Twilio API error:', response.statusText);
      return res.json({ data: [], error: 'invalid_credentials' });
    }
    
    const twilioData = await response.json();
    
    // Normalize response
    const numbers = (twilioData.incoming_phone_numbers || []).map((num: any) => ({
      phone_number: num.phone_number,
      friendly_name: num.friendly_name,
      status: 'active'
    }));

    res.json({ data: numbers });
  } catch (error) {
    console.error('Twilio phone fetch error:', error);
    res.json({ data: [], error: 'fetch_failed' });
  }
});

// GET /settings/connectors/telnyx — Get sanitized Telnyx connector status (no secrets exposed)
router.get('/connectors/telnyx', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: settings } = await req.db!
      .database.from('user_settings')
      .select('telnyx_api_key, telnyx_caller_number, updated_at')
      .eq('user_id', req.user.id)
      .maybeSingle();

    const isConfigured = !!settings?.telnyx_api_key;
    
    if (!isConfigured) {
      return res.json({ 
        data: { 
          connected: false, 
          accountName: '', 
          phoneNumbers: [],
          lastTested: null
        } 
      });
    }

    // Fetch numbers and balance to get account info
    const [numbersRes, balanceRes] = await Promise.allSettled([
      fetch('https://api.telnyx.com/v2/phone_numbers', {
        headers: {
          'Authorization': `Bearer ${settings.telnyx_api_key}`,
          'Accept': 'application/json'
        }
      }),
      fetch('https://api.telnyx.com/v2/balance', {
        headers: {
          'Authorization': `Bearer ${settings.telnyx_api_key}`,
          'Accept': 'application/json'
        }
      })
    ]);

    const phoneNumbers: { phone_number: string; friendly_name: string }[] = [];
    if (numbersRes.status === 'fulfilled' && numbersRes.value.ok) {
      const telnyxData = await numbersRes.value.json();
      (telnyxData.data || []).forEach((num: any) => {
        phoneNumbers.push({
          phone_number: num.phone_number,
          friendly_name: num.connection_name || num.phone_number,
        });
      });
    }

    const accountName = settings.telnyx_caller_number || 'Telnyx Account';

    res.json({ 
      data: { 
        connected: true, 
        accountName,
        phoneNumbers,
        lastTested: settings.updated_at || null
      } 
    });
  } catch (error) {
    console.error('Telnyx connector status error:', error);
    res.json({ 
      data: { 
        connected: false, 
        accountName: '', 
        phoneNumbers: [],
        lastTested: null
      } 
    });
  }
});

// GET /settings/connectors/twilio — Get sanitized Twilio connector status (no secrets exposed)
router.get('/connectors/twilio', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { data: settings } = await req.db!
      .database.from('user_settings')
      .select('twilio_account_sid, twilio_auth_token, twilio_caller_number, updated_at')
      .eq('user_id', req.user.id)
      .maybeSingle();

    const isConfigured = !!settings?.twilio_account_sid;
    
    if (!isConfigured) {
      return res.json({ 
        data: { 
          connected: false, 
          accountName: '', 
          phoneNumbers: [],
          lastTested: null
        } 
      });
    }

    // Fetch numbers to get account info
    const numbersRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${settings.twilio_account_sid}/IncomingPhoneNumbers.json`, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${settings.twilio_account_sid}:${settings.twilio_auth_token}`).toString('base64'),
      }
    });

    const phoneNumbers: { phone_number: string; friendly_name: string }[] = [];
    if (numbersRes.ok) {
      const twilioData = await numbersRes.json();
      (twilioData.incoming_phone_numbers || []).forEach((num: any) => {
        phoneNumbers.push({
          phone_number: num.phone_number,
          friendly_name: num.friendly_name,
        });
      });
    }

    // Extract account name from SID (format: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)
    const accountName = settings.twilio_account_sid 
      ? `Twilio Account ${settings.twilio_account_sid.substring(0, 4)}...${settings.twilio_account_sid.substring(settings.twilio_account_sid.length - 4)}`
      : 'Twilio Account';

    res.json({ 
      data: { 
        connected: true, 
        accountName,
        phoneNumbers,
        lastTested: settings.updated_at || null
      } 
    });
  } catch (error) {
    console.error('Twilio connector status error:', error);
    res.json({ 
      data: { 
        connected: false, 
        accountName: '', 
        phoneNumbers: [],
        lastTested: null
      } 
    });
  }
});

export default router;
