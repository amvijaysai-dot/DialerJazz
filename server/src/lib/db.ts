import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure the server-local .env (which holds the DB_* service credentials) is
// loaded. The API server loads the repo-root .env, but the DB_* vars live in
// server/.env (the same file import-leads.js reads).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * Direct PostgreSQL client.
 *
 * The InsForge gateway only exposes GET on `/api/database/records/:table`
 * (POST/PUT/PATCH/DELETE return 404), so server-side writes must bypass the
 * gateway and talk to Postgres directly using the DB_* service credentials.
 * This is the same connection `import-leads.js` uses successfully.
 *
 * The service role (postgres) bypasses Row-Level Security, so every query is
 * explicitly scoped to the authenticated user's ID — matching the previous
 * InsForge-backed behaviour.
 */

let pool: pg.Pool | null = null;

export const getDbPool = (): pg.Pool => {
  if (pool) return pool;

  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;
  const port = Number(process.env.DB_PORT) || 5432;

  if (!host || !user || !password || !database) {
    throw new Error(
      'DB_HOST, DB_USER, DB_PASSWORD and DB_NAME are required for direct database writes. ' +
      'Please set them in your environment configuration.'
    );
  }

  pool = new pg.Pool({
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });

  return pool;
};