-- Client Actions Needed queue for high-risk worker recommendations that require operator approval.

create table if not exists client_actions_needed (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references blitz_runs(id) on delete set null,
  source_action_id uuid references blitz_actions(id) on delete set null,
  provider text not null check (provider in ('gbp', 'ga4', 'google_ads', 'ghl')),
  location_name text,
  location_id text,
  action_type text not null check (action_type in ('profile_patch', 'media_upload', 'post_publish', 'review_reply', 'hours_update', 'attribute_update')),
  risk_tier text not null check (risk_tier in ('low', 'medium', 'high', 'critical')),
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'executed', 'failed', 'dismissed', 'manual_completed')),
  fingerprint text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_actions_needed_org_client_status
on client_actions_needed (organization_id, client_id, status, created_at desc);

create index if not exists idx_client_actions_needed_run_action
on client_actions_needed (run_id, source_action_id);

create index if not exists idx_client_actions_needed_fingerprint
on client_actions_needed (client_id, fingerprint)
where status = 'pending' and fingerprint is not null;

drop trigger if exists trg_client_actions_needed_updated_at on client_actions_needed;
create trigger trg_client_actions_needed_updated_at
before update on client_actions_needed
for each row execute function app.set_updated_at();

alter table client_actions_needed enable row level security;

drop policy if exists client_actions_needed_org_select on client_actions_needed;
create policy client_actions_needed_org_select on client_actions_needed
for select
using (app.has_org_access(organization_id));

drop policy if exists client_actions_needed_org_write on client_actions_needed;
create policy client_actions_needed_org_write on client_actions_needed
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));
