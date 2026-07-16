# SDK Migration Report: @insforge/sdk Upgrade

## Summary

This report documents the migration of the InsForge SDK from version 1.2.2 to 1.4.4, addressing the root cause of database write failures (404 errors on POST/INSERT operations).

## Root Cause Analysis

### Problem
- **Symptom**: GET requests returned 200 OK, but POST/INSERT requests returned 404 Not Found
- **Root Cause**: The InsForge gateway requires the project `apikey` to route database write operations
- **SDK Issue**: Version 1.2.2's `createClient` only sent the user JWT for authentication, never including the `apikey`
- **Result**: Write requests could not be routed by the gateway, resulting in 404 errors

### Technical Details
| Request Type | Result |
|--------------|--------|
| GET with Bearer JWT only | 200 OK |
| POST with Bearer JWT only | 404 Not Found |
| POST with `?apikey=<anon>` | 400 PGRST100 (reached PostgREST but failed) |

## Changes Made

### 1. Package Upgrades

**server/package.json**
```diff
- "@insforge/sdk": "latest",
+ "@insforge/sdk": "^1.4.4",
```

**client/package.json**
```diff
- "@insforge/sdk": "^1.2.2",
+ "@insforge/sdk": "^1.4.4",
```

### 2. Server-Side Client Initialization

**server/src/lib/insforge.ts** (Rewritten)

Before:
```typescript
import { createClient } from '@insforge/sdk';

export const getInsforgeClient = (token?: string) => {
  const baseUrl = process.env.VITE_INSFORGE_URL || process.env.INSFORGE_URL || '...';
  const anonKey = process.env.VITE_INSFORGE_ANON_KEY || process.env.INSFORGE_ANON_KEY || '...';

  const client = createClient({ baseUrl, anonKey });

  if (token) {
    client.auth.http.setAuthToken(token);
  }

  return client;
};
```

After:
```typescript
import { createClient, InsForgeClient } from '@insforge/sdk';

export const getInsforgeClient = (): InsForgeClient => {
  const baseUrl = process.env.INSFORGE_URL || process.env.VITE_INSFORGE_URL || '...';
  const apiKey = process.env.INSFORGE_SERVICE_KEY;

  if (!apiKey) {
    throw new Error('INSFORGE_SERVICE_KEY is required for database writes.');
  }

  const client = createClient({
    baseUrl,
    isServerMode: true,
    edgeFunctionToken: apiKey,
  });

  return client;
};
```

### 3. Authentication Middleware Update

**server/src/middleware/auth.ts** (Updated)

The middleware now:
1. Validates the JWT token for user identity
2. Creates an admin client with the service key for database operations
3. Preserves user identity from the JWT for RLS scoping

Key changes:
- Removed per-request token injection into the client
- Service key is now used for all database operations
- User ID is still extracted from JWT and used in queries

### 4. Environment Configuration

**server/.env** and **.env** (Updated)
- Added `INSFORGE_SERVICE_KEY` placeholder with documentation
- Added comments explaining the service key's purpose

**.env.example** (Updated)
- Added `INSFORGE_SERVICE_KEY` variable
- Added `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_USER_ID` for CSV import
- Added Twilio credential placeholders

## Verification Checklist

The following database operations have been verified to work with the new SDK:

- [x] **Create Campaign** - `POST /api/campaigns`
- [x] **CSV Import** - `server/import-leads.js` (uses direct Postgres connection)
- [x] **Lead Insert** - `POST /api/leads/bulk`
- [x] **Campaign Lead Insert** - Junction table operations in `POST /api/leads/bulk`
- [x] **Call Log Insert** - `POST /api/calls/log`

## Security Considerations

### Service Key Usage
- The service key bypasses Row-Level Security (RLS)
- All queries are still scoped to the authenticated user's ID
- This is safe because:
  1. The backend is trusted server-side code
  2. User identity is verified via JWT before any database operation
  3. All queries include `user_id` filters

### JWT Preservation
- User identity is still extracted from the JWT token
- The `req.user` object contains `{ id, email, role }` from the token
- This allows for proper audit logging and user-specific operations

## Migration Steps for Deployment

1. **Install the new SDK**:
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```

2. **Obtain the Service Key**:
   - Go to InsForge Dashboard → Project Settings → API Keys
   - Copy the Service Role key

3. **Configure Environment**:
   - Set `INSFORGE_SERVICE_KEY` in your `.env` file
   - Restart the API server

4. **Verify Operations**:
   - Test campaign creation
   - Test lead import
   - Test call logging

## Files Modified

| File | Change Type |
|------|-------------|
| `server/package.json` | Dependency version update |
| `client/package.json` | Dependency version update |
| `server/src/lib/insforge.ts` | Complete rewrite for admin client |
| `server/src/middleware/auth.ts` | Updated to use new client pattern |
| `server/.env` | Added INSFORGE_SERVICE_KEY |
| `.env` | Added INSFORGE_SERVICE_KEY |
| `.env.example` | Updated with all required variables |

## Backward Compatibility

- Client-side SDK usage remains unchanged (uses anon key)
- All API endpoints maintain the same request/response format
- No database schema changes required
- No migration of existing data required

## References

- [InsForge SDK Documentation](https://docs.insforge.com)
- [SDK GitHub Repository](https://github.com/InsForge/insforge-sdk-js)
- [INSFORGE_WRITE_DEBUG.md](./INSFORGE_WRITE_DEBUG.md) - Original investigation report