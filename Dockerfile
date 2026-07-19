# ─── Stage 1: Build ───────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Accept VITE_ env vars at build time (baked into client bundle)
# These MUST be passed during Docker build for InsForge auth to work
ARG VITE_API_URL=/api
ARG VITE_INSFORGE_BASE_URL
ARG VITE_INSFORGE_ANON_KEY
ARG VITE_FRONTEND_URL

# 1. Install root deps (concurrently)
COPY package.json package-lock.json ./
RUN npm ci

# 2. Install + build CLIENT
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci --legacy-peer-deps

COPY client/ ./client/

# ─── Build-time validation: Fail fast if required VITE_* vars are missing ───
# These MUST be passed as --build-arg during Docker build
RUN set -eu; \
    missing=""; \
    [ -z "${VITE_INSFORGE_BASE_URL}" ] && missing="${missing} VITE_INSFORGE_BASE_URL"; \
    [ -z "${VITE_INSFORGE_ANON_KEY}" ] && missing="${missing} VITE_INSFORGE_ANON_KEY"; \
    [ -z "${VITE_API_URL}" ] && missing="${missing} VITE_API_URL"; \
    [ -z "${VITE_FRONTEND_URL}" ] && missing="${missing} VITE_FRONTEND_URL"; \
    if [ -n "${missing}" ]; then \
      echo "❌ FATAL: Missing required build-time environment variables:${missing}"; \
      echo "   Pass them via --build-arg when building the Docker image."; \
      echo "   Example: docker build --build-arg VITE_INSFORGE_BASE_URL=... --build-arg VITE_INSFORGE_ANON_KEY=... --build-arg VITE_API_URL=/api --build-arg VITE_FRONTEND_URL=https://your-app.up.railway.app ."; \
      exit 1; \
    fi; \
    echo "✅ All required VITE_* build-time variables are set"

# Set environment variables for Vite build
# Vite reads VITE_* env vars at build time and bakes them into the client bundle
ENV VITE_API_URL="${VITE_API_URL}" \
    VITE_INSFORGE_BASE_URL="${VITE_INSFORGE_BASE_URL}" \
    VITE_INSFORGE_ANON_KEY="${VITE_INSFORGE_ANON_KEY}" \
    VITE_FRONTEND_URL="${VITE_FRONTEND_URL}"
RUN cd client && npm run build

# 3. Server dependencies are installed in stage 2, no build needed for server when using tsx

# ─── Stage 2: Production ──────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Copy server package and install production deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Install tsx globally to handle ESM resolution for dependencies
RUN npm install -g tsx

# Copy server source code (we run src directly with tsx)
COPY server/src ./server/src

# Copy built client (served as static files by Express)
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["tsx", "server/src/index.ts"]
