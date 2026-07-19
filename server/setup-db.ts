/**
 * DialerJazz — Local DB bootstrap (one-time setup)
 * ---------------------------------------------------------------------------
 * This fresh InsForge project has NO application tables yet (only InsForge's
 * internal auth.users, which is empty). This script creates the tables the
 * DialerJazz API expects, and creates a user to own imported leads.
 *
 * It connects directly to Postgres (bypassing InsForge auth/RLS) using the
 * DB_* vars in server/.env. Run once with:  npx tsx setup-db.ts
 *
 * Tables created (schemas derived from server/src/routes/*.ts):
 *   - leads            (owner: user_id; unique on user_id+phone)
 *   - campaigns        (owner: user_id)
 *   - campaign_leads   (junction: campaign_id + lead_id)
 *   - user_settings    (per-user Twilio/Telnyx config)
 * ---------------------------------------------------------------------------
 */
import 'dotenv/config';
import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  // ── 1. Create application tables ────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      first_name text,
      last_name text,
      company text,
      phone text NOT NULL,
      email text,
      website text,
      linkedin_url text,
      google_maps_url text,
      address text,
      city text,
      state text,
      zip text,
      google_rating numeric,
      review_count integer,
      business_category text,
      notes text,
      tags text[],
      status text NOT NULL DEFAULT 'new',
      priority integer NOT NULL DEFAULT 0,
      custom_fields jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, phone)
    );
    CREATE INDEX IF NOT EXISTS leads_user_id_idx ON public.leads (user_id);
    -- Composite indexes for common query patterns
    CREATE INDEX IF NOT EXISTS leads_user_status_idx ON public.leads (user_id, status);
    CREATE INDEX IF NOT EXISTS leads_user_created_idx ON public.leads (user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.campaigns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      name text NOT NULL,
      dialer_mode text NOT NULL DEFAULT 'preview',
      provider text NOT NULL DEFAULT 'telnyx',
      caller_number text,
      status text NOT NULL DEFAULT 'draft',
      total_leads integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS campaigns_user_id_idx ON public.campaigns (user_id);
    -- Composite indexes for common query patterns
    CREATE INDEX IF NOT EXISTS campaigns_user_status_idx ON public.campaigns (user_id, status);
    CREATE INDEX IF NOT EXISTS campaigns_user_created_idx ON public.campaigns (user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.campaign_leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id uuid NOT NULL REFERENCES public.campaigns (id) ON DELETE CASCADE,
      lead_id uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
      user_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, lead_id)
    );
    CREATE INDEX IF NOT EXISTS campaign_leads_campaign_id_idx ON public.campaign_leads (campaign_id);
    CREATE INDEX IF NOT EXISTS campaign_leads_lead_id_idx ON public.campaign_leads (lead_id);
    -- Composite index for campaign + user queries (used in leads.ts and campaigns.ts)
    CREATE INDEX IF NOT EXISTS campaign_leads_campaign_user_idx ON public.campaign_leads (campaign_id, user_id);
  `);

  // Add foreign keys from user_id columns to auth.users for referential integrity
  // These ensure orphaned records are cleaned up if a user is deleted
  await pool.query(`
    ALTER TABLE public.leads
      ADD CONSTRAINT IF NOT EXISTS leads_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  `);

  await pool.query(`
    ALTER TABLE public.campaigns
      ADD CONSTRAINT IF NOT EXISTS campaigns_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  `);

  await pool.query(`
    ALTER TABLE public.call_logs
      ADD CONSTRAINT IF NOT EXISTS call_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  `);

  await pool.query(`
    ALTER TABLE public.user_settings
      ADD CONSTRAINT IF NOT EXISTS user_settings_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.user_settings (
      user_id uuid PRIMARY KEY,
      telnyx_api_key text,
      telnyx_sip_login text,
      telnyx_sip_password text,
      telnyx_caller_number text,
      twilio_account_sid text,
      twilio_auth_token text,
      twilio_api_key text,
      twilio_api_secret text,
      twilio_twiml_app_sid text,
      twilio_caller_number text,
      default_provider text DEFAULT 'telnyx',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Follow-up / disposition enrichment columns on leads (no IST - timezone is source of truth)
  const leadFollowUpColumns = [
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_date date`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS follow_up_time time`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS callback_date date`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS callback_time time`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS appointment_date date`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS appointment_time time`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium'`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS meeting_type text`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS meeting_link text`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS timezone text`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS reminder_enabled boolean DEFAULT true`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS completed boolean DEFAULT false`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS completed_at timestamptz`,
    // Demo scheduling columns (no IST - timezone is source of truth)
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS demo_date date`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS demo_time time`,
    `ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS meeting_platform text`,
  ];

  const addedColumns: string[] = [];
  for (const col of leadFollowUpColumns) {
    try {
      const result = await pool.query(col);
      if (result.rowCount !== null) {
        const match = col.match(/ADD COLUMN IF NOT EXISTS (\w+)/);
        if (match) addedColumns.push(match[1]);
      }
    } catch {
      // Column may already exist or have permission issues - ignore
    }
  }
  console.log(`📦 Lead follow-up columns: ${addedColumns.length > 0 ? addedColumns.join(', ') : 'already present'}`);

  // ── call_logs (required by POST /api/calls/log, GET /api/calls, stats) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.call_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
      campaign_id uuid REFERENCES public.campaigns (id) ON DELETE SET NULL,
      provider text,
      direction text,
      from_number text,
      to_number text,
      status text,
      disposition text,
      disposition_sub text,
      duration_seconds integer,
      recording_url text,
      notes text,
      started_at timestamptz,
      ended_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS call_logs_user_id_idx ON public.call_logs (user_id);
    CREATE INDEX IF NOT EXISTS call_logs_user_created_idx ON public.call_logs (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS call_logs_campaign_id_idx ON public.call_logs (campaign_id);
    -- Composite indexes for lead-centric queries (dialer, lead detail, stats)
    CREATE INDEX IF NOT EXISTS call_logs_lead_created_idx ON public.call_logs (lead_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS call_logs_user_lead_idx ON public.call_logs (user_id, lead_id);
  `);

  // ── campaigns.leads_called (progress counter incremented per fresh call) ──
  await pool.query(`
    ALTER TABLE public.campaigns
      ADD COLUMN IF NOT EXISTS leads_called integer NOT NULL DEFAULT 0;
  `);

  // ── increment_campaign_calls RPC (atomic progress increment) ──
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.increment_campaign_calls(p_campaign_id uuid)
    RETURNS integer
    LANGUAGE plpgsql
    AS $$
    DECLARE
      new_count integer;
    BEGIN
      UPDATE public.campaigns
        SET leads_called = COALESCE(leads_called, 0) + 1
        WHERE id = p_campaign_id
        RETURNING leads_called INTO new_count;
      RETURN new_count;
    END;
    $$;
  `);

  console.log('✅ Application tables created (leads, campaigns, campaign_leads, user_settings, call_logs).');

  // ── 2. Ensure a user exists to own the leads ────────────────────────────
  const email = process.env.INSFORGE_USER_EMAIL || 'admin@local.dev';
  const existing = await pool.query(`SELECT id, email FROM auth.users WHERE email = $1`, [email]);

  let userId: string;
  if (existing.rows.length) {
    userId = existing.rows[0].id;
    console.log(`👤 Using existing user ${email} (${userId})`);
  } else {
    userId = crypto.randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO auth.users (id, email, password, email_verified, created_at, updated_at, is_project_admin, is_anonymous)
       VALUES ($1, $2, '', true, $3, $3, true, false)`,
      [userId, email, now]
    );
    console.log(`👤 Created user ${email} (${userId})`);
  }

  // Persist the resolved owner id so import-leads.js picks it up automatically.
  await pool.end();

  // Write DB_USER_ID into .env so import-leads.js uses it without manual edits.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dotenvPath = path.join(process.cwd(), '.env');
  let envText = fs.readFileSync(dotenvPath, 'utf8');
  if (/^DB_USER_ID=.*$/m.test(envText)) {
    envText = envText.replace(/^DB_USER_ID=.*$/m, `DB_USER_ID=${userId}`);
  } else {
    envText += `\nDB_USER_ID=${userId}\n`;
  }
  fs.writeFileSync(dotenvPath, envText);
  console.log(`📝 Set DB_USER_ID=${userId} in server/.env`);
  console.log('\nNext: place your leads in server/leads.csv and run:  npx tsx import-leads.js');
}

main().catch((e) => {
  console.error('💥 Setup failed:', e.message);
  process.exit(1);
});