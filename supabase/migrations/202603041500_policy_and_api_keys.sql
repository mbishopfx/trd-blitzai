-- Autopilot policy persistence + API key controls + org membership RLS hardening

create or replace function app.has_org_access(target_org_id uuid)
returns boolean
language sql
stable
as $$
  select app.is_service_role()
    or exists (
      select 1
      from organization_users ou
      where ou.organization_id = target_org_id
        and ou.user_id = auth.uid()
    );
$$;

create table if not exists autopilot_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null unique references clients(id) on delete cascade,
  max_daily_actions_per_location integer not null default 150 check (max_daily_actions_per_location > 0),
  max_actions_per_phase integer not null default 40 check (max_actions_per_phase > 0),
  min_cooldown_minutes integer not null default 10 check (min_cooldown_minutes >= 0),
  deny_critical_without_escalation boolean not null default true,
  enabled_action_types text[] not null default '{profile_patch,media_upload,post_publish,review_reply,hours_update,attribute_update}'::text[],
  review_reply_all_ratings_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_autopilot_policies_org_client on autopilot_policies (organization_id, client_id);

create trigger trg_autopilot_policies_updated_at
before update on autopilot_policies
for each row execute function app.set_updated_at();

alter table autopilot_policies enable row level security;

drop policy if exists autopilot_policies_org_select on autopilot_policies;
create policy autopilot_policies_org_select on autopilot_policies
for select
using (app.has_org_access(organization_id));

drop policy if exists autopilot_policies_org_write on autopilot_policies;
create policy autopilot_policies_org_write on autopilot_policies
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  scopes text[] not null default '{}'::text[],
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (organization_id, name)
);

create index if not exists idx_api_keys_org_status on api_keys (organization_id, status, created_at desc);

alter table api_keys enable row level security;

drop policy if exists api_keys_org_select on api_keys;
create policy api_keys_org_select on api_keys
for select
using (app.has_org_access(organization_id));

drop policy if exists api_keys_org_write on api_keys;
create policy api_keys_org_write on api_keys
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

create or replace function app.hash_api_key(raw_key text)
returns text
language sql
immutable
as $$
  select encode(digest(raw_key, 'sha256'), 'hex');
$$;

create or replace function app.create_api_key(
  p_organization_id uuid,
  p_name text,
  p_scopes text[] default '{}'::text[],
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  key_id uuid,
  key_secret text,
  key_prefix text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_secret text;
  generated_prefix text;
begin
  if not app.has_org_access(p_organization_id) then
    raise exception 'Not authorized for organization %', p_organization_id;
  end if;

  generated_secret := 'blitz_' || encode(gen_random_bytes(24), 'hex');
  generated_prefix := left(generated_secret, 12);

  insert into api_keys (
    organization_id,
    name,
    key_hash,
    key_prefix,
    scopes,
    expires_at,
    metadata,
    created_by
  )
  values (
    p_organization_id,
    p_name,
    app.hash_api_key(generated_secret),
    generated_prefix,
    coalesce(p_scopes, '{}'::text[]),
    p_expires_at,
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid()
  )
  returning id into key_id;

  key_secret := generated_secret;
  key_prefix := generated_prefix;
  return next;
end;
$$;

grant execute on function app.create_api_key(uuid, text, text[], timestamptz, jsonb) to authenticated, service_role;

create or replace function app.resolve_api_key(raw_key text)
returns table (
  key_id uuid,
  organization_id uuid,
  scopes text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id,
    api_keys.organization_id,
    api_keys.scopes
  from api_keys
  where key_hash = app.hash_api_key(raw_key)
    and status = 'active'
    and (expires_at is null or expires_at > now());
$$;

grant execute on function app.resolve_api_key(text) to authenticated, service_role;

drop policy if exists organization_users_member_select on organization_users;
create policy organization_users_member_select on organization_users
for select
using (
  app.is_service_role()
  or app.has_org_access(organization_id)
);

drop policy if exists clients_org_select on clients;
create policy clients_org_select on clients
for select
using (app.has_org_access(organization_id));

drop policy if exists clients_org_write on clients;
create policy clients_org_write on clients
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

drop policy if exists integration_connections_org_select on integration_connections;
create policy integration_connections_org_select on integration_connections
for select
using (app.has_org_access(organization_id));

drop policy if exists integration_connections_org_write on integration_connections;
create policy integration_connections_org_write on integration_connections
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

drop policy if exists gbp_locations_org_select on gbp_locations;
create policy gbp_locations_org_select on gbp_locations
for select
using (app.has_org_access(organization_id));

drop policy if exists gbp_locations_org_write on gbp_locations;
create policy gbp_locations_org_write on gbp_locations
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

drop policy if exists blitz_playbooks_org_select on blitz_playbooks;
create policy blitz_playbooks_org_select on blitz_playbooks
for select
using (app.has_org_access(organization_id));

drop policy if exists blitz_playbooks_org_write on blitz_playbooks;
create policy blitz_playbooks_org_write on blitz_playbooks
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

drop policy if exists blitz_runs_org_select on blitz_runs;
create policy blitz_runs_org_select on blitz_runs
for select
using (app.has_org_access(organization_id));

drop policy if exists blitz_runs_org_insert on blitz_runs;
create policy blitz_runs_org_insert on blitz_runs
for insert
with check (app.has_org_access(organization_id));

drop policy if exists blitz_actions_org_select on blitz_actions;
create policy blitz_actions_org_select on blitz_actions
for select
using (app.has_org_access(organization_id));

drop policy if exists blitz_action_logs_org_select on blitz_action_logs;
create policy blitz_action_logs_org_select on blitz_action_logs
for select
using (app.has_org_access(organization_id));

drop policy if exists blitz_rollbacks_org_select on blitz_rollbacks;
create policy blitz_rollbacks_org_select on blitz_rollbacks
for select
using (app.has_org_access(organization_id));

drop policy if exists media_assets_org_select on media_assets;
create policy media_assets_org_select on media_assets
for select
using (app.has_org_access(organization_id));

drop policy if exists media_assets_org_write on media_assets;
create policy media_assets_org_write on media_assets
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

drop policy if exists content_artifacts_org_select on content_artifacts;
create policy content_artifacts_org_select on content_artifacts
for select
using (app.has_org_access(organization_id));

drop policy if exists content_artifacts_org_write on content_artifacts;
create policy content_artifacts_org_write on content_artifacts
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

drop policy if exists review_reply_history_org_select on review_reply_history;
create policy review_reply_history_org_select on review_reply_history
for select
using (app.has_org_access(organization_id));

drop policy if exists attribution_daily_org_select on attribution_daily;
create policy attribution_daily_org_select on attribution_daily
for select
using (app.has_org_access(organization_id));

drop policy if exists usage_meter_events_org_select on usage_meter_events;
create policy usage_meter_events_org_select on usage_meter_events
for select
using (app.has_org_access(organization_id));

drop policy if exists billing_subscriptions_org_select on billing_subscriptions;
create policy billing_subscriptions_org_select on billing_subscriptions
for select
using (app.has_org_access(organization_id));

drop policy if exists billing_subscriptions_org_write on billing_subscriptions;
create policy billing_subscriptions_org_write on billing_subscriptions
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));

drop policy if exists audit_events_org_select on audit_events;
create policy audit_events_org_select on audit_events
for select
using (organization_id is null or app.has_org_access(organization_id));

drop policy if exists webhook_deliveries_org_select on webhook_deliveries;
create policy webhook_deliveries_org_select on webhook_deliveries
for select
using (app.has_org_access(organization_id));
