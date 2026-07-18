import { createClient } from '@insforge/sdk';

// Vite bakes VITE_* env vars into the client bundle at build time.
// These MUST be provided during Docker build (see Dockerfile ARG/ENV).
// No fallback - fail fast if misconfigured.
const baseUrl = import.meta.env.VITE_INSFORGE_BASE_URL;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY;

if (!baseUrl) {
  throw new Error(
    'VITE_INSFORGE_BASE_URL is not defined. ' +
    'This environment variable must be set during the Docker build. ' +
    'See Dockerfile for required build args.'
  );
}

if (!anonKey) {
  throw new Error(
    'VITE_INSFORGE_ANON_KEY is not defined. ' +
    'This environment variable must be set during the Docker build. ' +
    'See Dockerfile for required build args.'
  );
}

export const insforge = createClient({
  baseUrl,
  anonKey,
});
