import { createAdminClient, InsForgeClient } from '@insforge/sdk';

/**
 * Creates an InsForge client for server-side operations.
 * Uses the service/admin key to bypass RLS and perform database writes.
 * 
 * IMPORTANT: This client is intended for trusted server-side code only.
 * It bypasses Row-Level Security, so all operations are scoped to the
 * authenticated user's ID which is set in each query.
 * 
 * The service key is used as the bearer token for all requests, which
 * allows the gateway to route write operations correctly.
 */
export const getInsforgeClient = (): InsForgeClient => {
  const baseUrl = process.env.INSFORGE_URL;
  
  // Support both INSFORGE_API_KEY and INSFORGE_SERVICE_KEY for backwards compatibility
  const apiKey = process.env.INSFORGE_API_KEY || process.env.INSFORGE_SERVICE_KEY;

  if (!baseUrl) {
    throw new Error(
      'INSFORGE_URL is required. ' +
      'Please set it in your environment configuration.'
    );
  }

  if (!apiKey) {
    throw new Error(
      'INSFORGE_API_KEY or INSFORGE_SERVICE_KEY is required for database writes. ' +
      'Please set it in your environment configuration.'
    );
  }

  // Use createAdminClient for server-side operations
  // This sends the API key as the bearer token for all requests
  const client = createAdminClient({
    baseUrl,
    apiKey,
  });

  return client;
};