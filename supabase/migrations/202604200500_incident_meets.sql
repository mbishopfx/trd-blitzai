create table if not exists incident_meet_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations(id) on delete cascade,
  sender_email text not null,
  encrypted_token_payload jsonb not null default '{}'::jsonb,
  scopes text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists incident_meet_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  connection_id uuid references incident_meet_connections(id) on delete set null,
  severity text not null check (severity in ('code_red', 'code_yellow', 'code_green')),
  summary text not null,
  description text not null,
  meet_url text,
  calendar_event_id text,
  calendar_html_link text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  attendees text[] not null default '{}'::text[],
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_incident_meet_events_org_starts_at
  on incident_meet_events (organization_id, starts_at desc);

alter table incident_meet_connections enable row level security;
alter table incident_meet_events enable row level security;

drop policy if exists incident_meet_connections_org_select on incident_meet_connections;
create policy incident_meet_connections_org_select on incident_meet_connections
for select
using (app.is_service_role() or organization_id = app.current_org_id());

drop policy if exists incident_meet_connections_org_write on incident_meet_connections;
create policy incident_meet_connections_org_write on incident_meet_connections
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

drop policy if exists incident_meet_events_org_select on incident_meet_events;
create policy incident_meet_events_org_select on incident_meet_events
for select
using (app.is_service_role() or organization_id = app.current_org_id());

drop policy if exists incident_meet_events_org_write on incident_meet_events;
create policy incident_meet_events_org_write on incident_meet_events
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

drop trigger if exists trg_incident_meet_connections_updated_at on incident_meet_connections;
create trigger trg_incident_meet_connections_updated_at
before update on incident_meet_connections
for each row execute function app.set_updated_at();
