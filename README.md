# Blitz AI Agent v1

Enterprise autonomous GBP optimization platform with policy-gated execution, attribution blending, and org-scoped controls.

## Monorepo Layout

- `apps/web`: Next.js App Router control plane + v1 REST endpoints.
- `apps/worker-ts`: BullMQ orchestrator for full Blitz Protocol phase execution.
- `services/worker-py`: FastAPI adapters for Google Ads/GA4 attribution ingestion.
- `packages/domain`: shared domain types, event contracts, schemas, policy, state-machine.
- `packages/integrations-gbp`: OAuth, token lifecycle, API client, snapshot/comparator/analyzer/reporting.
- `packages/integrations-attribution`: contracts, normalization, adapter mappers, impact panel helpers.
- `supabase/migrations`: Postgres schema + RLS + audit immutability.

## Implemented v1 Surfaces

### Control Plane APIs (`apps/web`)

- `POST /api/v1/orgs`
- `GET /api/v1/orgs`
- `POST /api/v1/orgs/{orgId}/clients`
- `GET /api/v1/orgs/{orgId}/clients`
- `GET /api/v1/orgs/{orgId}/api-keys`
- `POST /api/v1/orgs/{orgId}/api-keys`
- `GET /api/v1/gbp/oauth/start`
- `GET /api/v1/gbp/oauth/callback`
- `POST /api/v1/clients/{clientId}/blitz-runs`
- `GET /api/v1/blitz-runs/{runId}`
- `GET /api/v1/blitz-runs/{runId}/actions`
- `POST /api/v1/blitz-actions/{actionId}/rollback`
- `POST /api/v1/clients/{clientId}/autopilot/policies`
- `GET /api/v1/clients/{clientId}/attribution`
- `POST /api/v1/clients/{clientId}/integrations/ga4/connect`
- `POST /api/v1/clients/{clientId}/integrations/google-ads/connect`

### Worker Event Contracts (`packages/domain`)

- `blitz.run.requested`
- `blitz.phase.started`
- `blitz.action.executed`
- `blitz.action.failed`
- `blitz.run.completed`
- `attribution.sync.requested`

### TypeScript Orchestrator (`apps/worker-ts`)

- Full phase order execution: preflight -> completeness -> media -> content -> reviews -> interaction -> postcheck.
- Policy engine gates every action.
- Deterministic idempotency keys.
- Retry/backoff for action execution.
- Critical-failure rollback coordinator for reversible actions.
- BullMQ queue mode (Redis) and in-process fallback mode.
- Supabase-backed worker repository for persistent run/action state in production.

### Python Attribution Service (`services/worker-py`)

- `POST /v1/google-ads/query`
- `POST /v1/attribution/sync`
- Transplanted Google Ads token + backoff logic from `trd-googleads`.
- GA4 Data API sync adapter.
- GBP native row normalization input support.

### Supabase/Postgres (`supabase/migrations/202603041200_blitz_v1.sql`)

- 18 core tables from the locked plan.
- Org-bound tenant model + RLS.
- Service-role-only write boundaries for worker-sensitive tables.
- Required action fields (`run_id`, `actor`, `policy_snapshot`) enforced non-null.
- Immutable `audit_events` via mutation-blocking trigger.

### Supabase Hardening (`supabase/migrations/202603041500_policy_and_api_keys.sql`)

- Adds persisted `autopilot_policies`.
- Adds `api_keys` table plus `app.create_api_key` and `app.resolve_api_key`.
- Hardens org-scoped RLS using `app.has_org_access(organization_id)` membership checks.

## Local Development

1. Install Node workspaces:

```bash
npm install
```

2. Run Next.js control plane:

```bash
npm run dev:web
```

3. Run TypeScript worker:

```bash
npm run dev:worker
```

4. Run Python worker:

```bash
cd services/worker-py
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

5. Configure env vars from `.env.example`.

## Supabase Setup

1. Link your Supabase project and run migrations:

```bash
supabase db push
```

2. Confirm tables exist:
   - `autopilot_policies`
   - `api_keys`
   - all Blitz v1 tables from `202603041200_blitz_v1.sql`

## Production Env Checklist

### Vercel (`apps/web`)

- `NEXT_PUBLIC_SITE_URL`
- `APP_ENCRYPTION_KEY`
- `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (optional override; defaults to `${NEXT_PUBLIC_SITE_URL}/api/v1/gbp/oauth/callback`)
- `REDIS_URL` (required to enqueue run jobs)

### Railway (`apps/worker-ts`)

- `REDIS_URL`
- `BLITZ_WORKER_CONCURRENCY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI` (optional override; fallback works without `NEXT_PUBLIC_SITE_URL`)

### Railway (`services/worker-py`)

- `WORKER_PY_HOST`
- `WORKER_PY_PORT`
- `REQUEST_TIMEOUT_SECONDS`
- `GOOGLE_ADS_API_VERSION`
- Google Ads + GA4 credentials per sync request payload (or mounted secrets file).

## Testing

- Node workspaces:

```bash
npm run typecheck
npm run test
```

- Python service:

```bash
cd services/worker-py
source .venv/bin/activate
pytest -q
```

## Deployment Targets

- `apps/web` -> Vercel.
- `apps/worker-ts` -> Railway (Redis required).
- `services/worker-py` -> Railway.
# trd-blitzai
