/**
 * DialerJazz — Lead CSV Importer (direct Postgres)
 * ---------------------------------------------------------------------------
 * Parses a CSV of lead data and inserts/upserts rows into the `leads` table
 * of your InsForge-backed Postgres database. Connects directly to Postgres
 * (bypassing InsForge auth/RLS) using the DB_* vars in server/.env, so no
 * InsForge login is required.
 *
 * HOW LEADS ARE STORED (see server/src/routes/leads.ts):
 *   - Table:        public.leads
 *   - Owner column: user_id  (set from DB_USER_ID, or the first auth.users id)
 *   - Unique key:   (user_id, phone)  -> upsert on conflict
 *   - Required col: phone
 *   - Defaults:     status = 'new', priority = 0
 *
 * USAGE:
 *   cd server
 *   npx tsx import-leads.js                 # uses LEADS_CSV_PATH from .env
 *   npx tsx import-leads.js path/to.csv     # override the CSV path
 *
 * EXPECTED CSV COLUMNS (case-insensitive; common aliases supported):
 *   first_name, last_name, company, phone (required), email, website,
 *   linkedin_url, google_maps_url, address, city, state, zip,
 *   google_rating (number), review_count (number), business_category,
 *   notes, tags (comma/semicolon-separated -> array), status, priority (number)
 * Any unrecognised column is folded into `custom_fields` (jsonb).
 * ---------------------------------------------------------------------------
 */

import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '.env') });

const { Pool } = pg;

// ─── Config ────────────────────────────────────────────────────────────────
const DB_HOST = process.env.DB_HOST;
const DB_PORT = Number(process.env.DB_PORT) || 5432;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME;
const DB_USER_ID = process.env.DB_USER_ID || '';
const CSV_PATH = process.argv[2] || process.env.LEADS_CSV_PATH || 'leads.csv';

const CHUNK_SIZE = 500;

// Canonical lead columns (must match the leads table). Anything else -> custom_fields.
const LEAD_COLUMNS = new Set([
  'first_name', 'last_name', 'company', 'phone', 'email', 'website',
  'linkedin_url', 'google_maps_url', 'address', 'city', 'state', 'zip',
  'google_rating', 'review_count', 'business_category', 'notes', 'tags',
  'status', 'priority',
]);

const FIELD_ALIASES = {
  first_name: ['first_name', 'firstname', 'fname', 'given_name', 'first'],
  last_name: ['last_name', 'lastname', 'lname', 'surname', 'family_name', 'last'],
  company: ['company', 'company_name', 'organization', 'org', 'business', 'business_name'],
  phone: ['phone', 'phone_number', 'phonenumber', 'telephone', 'mobile', 'cell', 'number'],
  email: ['email', 'email_address', 'e-mail'],
  website: ['website', 'web', 'url', 'site'],
  linkedin_url: ['linkedin_url', 'linkedin', 'linkedinurl'],
  google_maps_url: ['google_maps_url', 'googlemaps', 'maps_url', 'gmaps'],
  address: ['address', 'street', 'street_address'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region'],
  zip: ['zip', 'zip_code', 'zipcode', 'postal_code', 'postal', 'postcode'],
  google_rating: ['google_rating', 'rating', 'googlereviewrating'],
  review_count: ['review_count', 'reviews', 'num_reviews', 'reviewcount'],
  business_category: ['business_category', 'category', 'industry', 'type'],
  notes: ['notes', 'note', 'comments', 'comment'],
  tags: ['tags', 'tag', 'labels', 'label'],
  status: ['status', 'lead_status'],
  priority: ['priority', 'prio', 'rank'],
};

function buildHeaderMap(headers) {
  const map = {};
  const used = new Set();
  for (const raw of headers) {
    const norm = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
    let matched = false;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(norm) && !used.has(field)) {
        map[raw] = field;
        used.add(field);
        matched = true;
        break;
      }
    }
    if (!matched) map[raw] = { custom: norm };
  }
  return map;
}

function toNumberOrUndefined(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function toTags(v) {
  if (v === undefined || v === null) return undefined;
  const arr = String(v).split(/[;|]/).map((t) => t.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

function rowToLead(row, headerMap) {
  const lead = {};
  const custom = {};
  for (const [rawHeader, target] of Object.entries(headerMap)) {
    const value = row[rawHeader];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    if (typeof target === 'object' && target.custom) {
      custom[target.custom] = value;
      continue;
    }
    switch (target) {
      case 'google_rating':
      case 'review_count':
      case 'priority':
        lead[target] = toNumberOrUndefined(value);
        break;
      case 'tags':
        lead.tags = toTags(value);
        break;
      default:
        lead[target] = String(value).trim();
    }
  }
  if (Object.keys(custom).length) lead.custom_fields = custom;
  return lead;
}

async function resolveUserId(pool) {
  if (DB_USER_ID) return DB_USER_ID;
  const { rows } = await pool.query(`SELECT id FROM auth.users ORDER BY created_at LIMIT 1`);
  if (!rows.length) {
    throw new Error('No user found in auth.users. Run `npx tsx setup-db.ts` first to create one.');
  }
  return rows[0].id;
}

async function main() {
  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
    throw new Error('DB_HOST, DB_USER, DB_PASSWORD, DB_NAME must be set in server/.env');
  }

  const resolvedCsv = path.isAbsolute(CSV_PATH) ? CSV_PATH : path.join(__dirname, CSV_PATH);
  if (!fs.existsSync(resolvedCsv)) {
    throw new Error(`CSV file not found: ${resolvedCsv}`);
  }

  const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  const userId = await resolveUserId(pool);
  console.log(`👤 Importing leads for user_id: ${userId}`);

  const csvText = fs.readFileSync(resolvedCsv, 'utf8');
  const { data: rows, errors } = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  if (errors.length) console.warn(`⚠️  CSV parse warnings: ${errors.length}`);
  if (!rows.length) throw new Error('CSV contains no data rows.');

  const headerMap = buildHeaderMap(Object.keys(rows[0]));
  console.log(`📄 Parsed ${rows.length} row(s) from ${path.basename(resolvedCsv)}`);

  const leads = [];
  const skipped = [];
  for (let i = 0; i < rows.length; i++) {
    const lead = rowToLead(rows[i], headerMap);
    if (!lead.phone || String(lead.phone).trim() === '') {
      skipped.push(i + 2);
      continue;
    }
    lead.user_id = userId;
    if (lead.status === undefined) lead.status = 'new';
    if (lead.priority === undefined) lead.priority = 0;
    leads.push(lead);
  }
  if (!leads.length) throw new Error('No valid leads (all rows missing a phone number).');
  console.log(`✅ ${leads.length} valid lead(s); ${skipped.length} skipped (missing phone).`);

  // Build parameterized upsert. Columns are the union of all lead keys present.
  const columns = ['user_id', ...Array.from(new Set(leads.flatMap((l) => Object.keys(l).filter((k) => k !== 'user_id'))))];
  const insertCols = columns.filter((c) => c === 'user_id' || LEAD_COLUMNS.has(c) || c === 'custom_fields');
  const updateCols = insertCols.filter((c) => c !== 'user_id' && c !== 'phone');

  let inserted = 0;
  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE);
    const values = [];
    const params = [];
    let p = 1;
    for (const lead of chunk) {
      const rowVals = insertCols.map((col) => {
        const v = lead[col];
        if (col === 'tags' && Array.isArray(v)) {
          params.push(v);
          return `$${p++}::text[]`;
        }
        if (col === 'custom_fields' && v && typeof v === 'object') {
          params.push(JSON.stringify(v));
          return `$${p++}::jsonb`;
        }
        params.push(v === undefined ? null : v);
        return `$${p++}`;
      });
      values.push(`(${rowVals.join(', ')})`);
    }
    const conflictCols = insertCols.includes('phone') ? 'user_id, phone' : 'user_id';
    const updateClause = updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
    const sql = `
      INSERT INTO public.leads (${insertCols.join(', ')})
      VALUES ${values.join(', ')}
      ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateClause}, updated_at = now()
    `;
    const { rowCount } = await pool.query(sql, params);
    inserted += rowCount || 0;
    console.log(`⬆️  Imported ${inserted}/${leads.length}...`);
  }

  await pool.end();
  console.log(`\n🎉 Done. Imported ${inserted} lead(s) for user ${userId}.`);
  if (skipped.length) console.log(`   Skipped rows (missing phone): ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}`);
}

main().catch((err) => {
  console.error('\n💥 Import failed:', err.message || err);
  process.exit(1);
});