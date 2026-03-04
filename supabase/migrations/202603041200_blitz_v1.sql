-- Blitz AI Agent v1 foundational schema
-- Multi-tenant enterprise model with org-scoped RLS and worker service-role controls

create extension if not exists pgcrypto;
create schema if not exists app;

create or replace function app.current_org_id()
returns uuid
language sql
stable
as $$
  with claims as (
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb as data
  )
  select nullif(claims.data ->> 'organization_id', '')::uuid
  from claims;
$$;

create or replace function app.is_service_role()
returns boolean
language sql
stable
as $$
  with claims as (
    select nullif(current_setting('request.jwt.claims', true), '')::jsonb as data
  )
  select coalesce(claims.data ->> 'role' = 'service_role', false)
  from claims;
$$;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  billing_email text,
  brand_settings jsonb not null default '{}'::jsonb,
  custom_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'admin', 'operator', 'analyst', 'client_viewer')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  timezone text not null default 'America/Chicago',
  website_url text,
  primary_location_label text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  provider text not null check (provider in ('gbp', 'ga4', 'google_ads', 'ghl')),
  provider_account_id text not null,
  encrypted_token_payload jsonb not null,
  scopes text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_refresh_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider, provider_account_id)
);

create table if not exists gbp_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  integration_connection_id uuid references integration_connections(id) on delete set null,
  account_name text,
  account_id text,
  location_name text not null,
  location_id text,
  title text,
  storefront_address jsonb,
  primary_phone text,
  website_uri text,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, location_name)
);

create table if not exists blitz_playbooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  is_default boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists blitz_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  playbook_id uuid references blitz_playbooks(id) on delete set null,
  status text not null check (status in ('created', 'running', 'completed', 'failed', 'partially_completed', 'rolled_back')),
  triggered_by text not null,
  policy_snapshot jsonb not null default '{}'::jsonb,
  baseline_snapshot jsonb,
  final_snapshot jsonb,
  summary jsonb,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists blitz_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid not null references blitz_runs(id) on delete cascade,
  phase text not null check (phase in ('preflight', 'completeness', 'media', 'content', 'reviews', 'interaction', 'postcheck')),
  action_type text not null check (action_type in ('profile_patch', 'media_upload', 'post_publish', 'review_reply', 'hours_update', 'attribute_update')),
  risk_tier text not null check (risk_tier in ('low', 'medium', 'high', 'critical')),
  policy_decision text not null check (policy_decision in ('allow', 'deny', 'allow_with_limit', 'allow_with_escalation')),
  status text not null check (status in ('pending', 'executed', 'failed', 'rolled_back', 'skipped')),
  actor text not null check (actor in ('system', 'user', 'operator')),
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  policy_snapshot jsonb not null,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  executed_at timestamptz,
  rolled_back_at timestamptz,
  unique (run_id, idempotency_key)
);

create table if not exists blitz_action_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid not null references blitz_runs(id) on delete cascade,
  action_id uuid references blitz_actions(id) on delete set null,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists blitz_rollbacks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid not null references blitz_runs(id) on delete cascade,
  action_id uuid not null references blitz_actions(id) on delete cascade,
  initiated_by text not null default 'system',
  reason text not null,
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references blitz_runs(id) on delete set null,
  source text not null,
  storage_path text not null,
  mime_type text,
  bytes bigint,
  width integer,
  height integer,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  approval_status text not null default 'approved' check (approval_status in ('approved', 'pending', 'rejected')),
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists content_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references blitz_runs(id) on delete set null,
  phase text not null check (phase in ('preflight', 'completeness', 'media', 'content', 'reviews', 'interaction', 'postcheck')),
  channel text not null default 'gbp',
  title text,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'failed')),
  scheduled_for timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists review_reply_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references blitz_runs(id) on delete set null,
  location_id text,
  review_id text not null,
  review_rating integer check (review_rating between 1 and 5),
  review_text text,
  reply_text text not null,
  reply_status text not null check (reply_status in ('pending', 'posted', 'failed', 'escalated')),
  replied_at timestamptz,
  error text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (client_id, review_id)
);

create table if not exists attribution_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  location_id text,
  date date not null,
  channel text not null check (channel in ('gbp', 'ga4', 'google_ads')),
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  calls bigint not null default 0,
  directions bigint not null default 0,
  conversions numeric(14, 4) not null default 0,
  spend numeric(14, 4) not null default 0,
  conversion_value numeric(14, 4) not null default 0,
  currency text not null default 'USD',
  source_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (client_id, location_id, date, channel)
);

create table if not exists usage_meter_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  event_type text not null,
  quantity numeric(14, 4) not null,
  unit text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  provider text not null default 'stripe',
  external_subscription_id text unique,
  plan_code text not null,
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metering_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  actor_id text not null,
  actor_type text not null check (actor_type in ('user', 'system', 'api_key')),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  ip_address inet,
  user_agent text,
  policy_snapshot jsonb,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  url text not null,
  event_type text not null,
  payload jsonb not null,
  response_status integer,
  response_body text,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  last_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_org_users_org_user on organization_users (organization_id, user_id);
create index if not exists idx_clients_org on clients (organization_id, status);
create index if not exists idx_integrations_org_client on integration_connections (organization_id, client_id, provider);
create index if not exists idx_gbp_locations_client on gbp_locations (client_id, location_name);
create index if not exists idx_blitz_runs_org_client on blitz_runs (organization_id, client_id, status, created_at desc);
create index if not exists idx_blitz_actions_run_phase on blitz_actions (run_id, phase, status);
create index if not exists idx_blitz_action_logs_run on blitz_action_logs (run_id, created_at desc);
create index if not exists idx_blitz_rollbacks_run on blitz_rollbacks (run_id, created_at desc);
create index if not exists idx_media_assets_client on media_assets (client_id, created_at desc);
create index if not exists idx_content_artifacts_client on content_artifacts (client_id, phase, status, created_at desc);
create index if not exists idx_review_reply_history_client on review_reply_history (client_id, reply_status, created_at desc);
create index if not exists idx_attribution_daily_client_date on attribution_daily (client_id, date desc, channel);
create index if not exists idx_usage_meter_events_org on usage_meter_events (organization_id, occurred_at desc);
create index if not exists idx_billing_subscriptions_org on billing_subscriptions (organization_id, status);
create index if not exists idx_audit_events_org_client on audit_events (organization_id, client_id, created_at desc);
create index if not exists idx_webhook_deliveries_org on webhook_deliveries (organization_id, event_type, created_at desc);

create trigger trg_organizations_updated_at
before update on organizations
for each row execute function app.set_updated_at();

create trigger trg_clients_updated_at
before update on clients
for each row execute function app.set_updated_at();

create trigger trg_integration_connections_updated_at
before update on integration_connections
for each row execute function app.set_updated_at();

create trigger trg_gbp_locations_updated_at
before update on gbp_locations
for each row execute function app.set_updated_at();

create trigger trg_blitz_playbooks_updated_at
before update on blitz_playbooks
for each row execute function app.set_updated_at();

create trigger trg_billing_subscriptions_updated_at
before update on billing_subscriptions
for each row execute function app.set_updated_at();

create or replace function app.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is immutable';
end;
$$;

create trigger trg_audit_events_no_update
before update on audit_events
for each row execute function app.prevent_audit_mutation();

create trigger trg_audit_events_no_delete
before delete on audit_events
for each row execute function app.prevent_audit_mutation();

alter table organizations enable row level security;
alter table organization_users enable row level security;
alter table clients enable row level security;
alter table integration_connections enable row level security;
alter table gbp_locations enable row level security;
alter table blitz_playbooks enable row level security;
alter table blitz_runs enable row level security;
alter table blitz_actions enable row level security;
alter table blitz_action_logs enable row level security;
alter table blitz_rollbacks enable row level security;
alter table media_assets enable row level security;
alter table content_artifacts enable row level security;
alter table review_reply_history enable row level security;
alter table attribution_daily enable row level security;
alter table usage_meter_events enable row level security;
alter table billing_subscriptions enable row level security;
alter table audit_events enable row level security;
alter table webhook_deliveries enable row level security;

create policy organizations_service_all on organizations
for all
using (app.is_service_role())
with check (app.is_service_role());

create policy organizations_member_select on organizations
for select
using (
  exists (
    select 1
    from organization_users ou
    where ou.organization_id = organizations.id
      and ou.user_id = auth.uid()
  )
);

create policy organization_users_service_all on organization_users
for all
using (app.is_service_role())
with check (app.is_service_role());

create policy organization_users_member_select on organization_users
for select
using (
  app.is_service_role()
  or organization_id = app.current_org_id()
);

create policy clients_org_select on clients
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy clients_org_write on clients
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

create policy integration_connections_org_select on integration_connections
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy integration_connections_org_write on integration_connections
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

create policy gbp_locations_org_select on gbp_locations
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy gbp_locations_org_write on gbp_locations
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

create policy blitz_playbooks_org_select on blitz_playbooks
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy blitz_playbooks_org_write on blitz_playbooks
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

create policy blitz_runs_org_select on blitz_runs
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy blitz_runs_org_insert on blitz_runs
for insert
with check (app.is_service_role() or organization_id = app.current_org_id());

create policy blitz_runs_service_update on blitz_runs
for update
using (app.is_service_role())
with check (app.is_service_role());

create policy blitz_actions_org_select on blitz_actions
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy blitz_actions_service_write on blitz_actions
for all
using (app.is_service_role())
with check (app.is_service_role());

create policy blitz_action_logs_org_select on blitz_action_logs
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy blitz_action_logs_service_write on blitz_action_logs
for all
using (app.is_service_role())
with check (app.is_service_role());

create policy blitz_rollbacks_org_select on blitz_rollbacks
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy blitz_rollbacks_service_write on blitz_rollbacks
for all
using (app.is_service_role())
with check (app.is_service_role());

create policy media_assets_org_select on media_assets
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy media_assets_org_write on media_assets
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

create policy content_artifacts_org_select on content_artifacts
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy content_artifacts_org_write on content_artifacts
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

create policy review_reply_history_org_select on review_reply_history
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy review_reply_history_service_write on review_reply_history
for all
using (app.is_service_role())
with check (app.is_service_role());

create policy attribution_daily_org_select on attribution_daily
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy attribution_daily_service_write on attribution_daily
for all
using (app.is_service_role())
with check (app.is_service_role());

create policy usage_meter_events_org_select on usage_meter_events
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy usage_meter_events_service_write on usage_meter_events
for all
using (app.is_service_role())
with check (app.is_service_role());

create policy billing_subscriptions_org_select on billing_subscriptions
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy billing_subscriptions_org_write on billing_subscriptions
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

create policy audit_events_org_select on audit_events
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy audit_events_service_insert on audit_events
for insert
with check (app.is_service_role());

create policy webhook_deliveries_org_select on webhook_deliveries
for select
using (app.is_service_role() or organization_id = app.current_org_id());

create policy webhook_deliveries_service_write on webhook_deliveries
for all
using (app.is_service_role())
with check (app.is_service_role());
