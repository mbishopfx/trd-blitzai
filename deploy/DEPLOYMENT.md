# Deployment Targets

## Vercel (apps/web)

- Root directory: repository root.
- Framework: Next.js.
- Build command: `npm run build --workspace @trd-aiblitz/web`.
- Runtime envs required: `NEXT_PUBLIC_SITE_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `APP_ENCRYPTION_KEY`.

## Railway (apps/worker-ts)

- Service root: repository root (or use monorepo settings).
- Start command: `npm run start --workspace @trd-aiblitz/worker-ts`.
- Required envs: `REDIS_URL`, `BLITZ_WORKER_CONCURRENCY`, `OPENAI_API_KEY`.

## Railway (services/worker-py)

- Service root: `services/worker-py`.
- Start command: `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}`.
- Required envs: Google Ads/GA4 credentials per request payloads and `GOOGLE_OAUTH_CLIENT_SECRETS_FILE` if file-based auth is used.
