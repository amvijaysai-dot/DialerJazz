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

/**
 * Creates and configures the PostgreSQL connection pool with production-ready settings.
 */
function createPool(): pg.Pool {
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

  const newPool = new pg.Pool({
    host,
    port,
    user,
    password,
    database,
    // SSL: require valid certificate in production; allow self-signed in dev
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: true }
      : { rejectUnauthorized: false },
    // Pool sizing
    max: Number(process.env.DB_POOL_MAX) || 20,
    min: Number(process.env.DB_POOL_MIN) || 2,
    // Timeouts (ms)
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS) || 5000,
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30000,
    // Prevent connection leaks
    maxUses: Number(process.env.DB_MAX_USES) || 7500,
    // Allow exiting if pool is only thing keeping process alive
    allowExitOnIdle: true,
  });

  // Global error handler for idle clients
  newPool.on('error', (err) => {
    console.error('[pg.Pool] Unexpected error on idle client:', err.message);
    // Don't crash the process; let individual queries handle their own errors
  });

  return newPool;
}

export const getDbPool = (): pg.Pool => {
  if (pool) return pool;
  pool = createPool();
  return pool;
};

/**
 * Execute a callback within a database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK.
 * 
 * @param callback - Function receiving the pg.PoolClient, should return a Promise
 * @returns Promise resolving to the callback's return value
 */
export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check for the connection pool.
 * Returns true if pool is healthy and can execute a simple query.
 */
export async function checkPoolHealth(): Promise<boolean> {
  try {
    const pool = getDbPool();
    const result = await pool.query('SELECT 1');
    return result.rowCount === 1;
  } catch {
    return false;
  }
}

/**
 * Gracefully close all connections in the pool.
 * Call on application shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Get pool statistics for monitoring.
 */
export function getPoolStats(): {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
} | null {
  if (!pool) return null;
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}
