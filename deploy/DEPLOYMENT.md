# Deployment Targets

## Vercel (apps/web)

- Root directory: repository root.
- Framework: Next.js.
- Build command: `npm run build --workspace @trd-aiblitz/web`.
- Runtime envs required:
  - `NEXT_PUBLIC_SITE_URL`
  - `APP_ENCRYPTION_KEY`
  - `SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (optional alternative to anon key)
  - `CLIENT_MEDIA_MAX_BYTES` (optional, defaults to 52428800 / 50MB)
  - `GOOGLE_OAUTH_CLIENT_ID`
  - `GOOGLE_OAUTH_CLIENT_SECRET`
  - `GOOGLE_OAUTH_REDIRECT_URI` (optional GBP callback override)
  - `GBP_GOOGLE_OAUTH_REDIRECT_URI` (optional GBP callback override)
  - `GOOGLE_INTEGRATION_OAUTH_REDIRECT_URI` (optional `/api/v1/google/oauth/callback` override)
  - `INCIDENT_MEET_GOOGLE_OAUTH_REDIRECT_URI` (optional `/api/v1/incident-meets/google/callback` override)
  - `REDIS_URL`

## Railway (apps/worker-ts)

- Service root: repository root (or use monorepo settings).
- Start command: `npm run start --workspace @trd-aiblitz/worker-ts`.
- Required envs:
  - `REDIS_URL`
  - `BLITZ_WORKER_CONCURRENCY`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`

## Railway (services/worker-py)

- Service root: `services/worker-py`.
- Start command: `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}`.
- Required envs: Google Ads/GA4 credentials per request payloads and `GOOGLE_OAUTH_CLIENT_SECRETS_FILE` if file-based auth is used.

## Supabase

- Apply migrations before first production run:
  - `supabase db push`
- Required migration files:
  - `supabase/migrations/202603041200_blitz_v1.sql`
  - `supabase/migrations/202603041500_policy_and_api_keys.sql`
