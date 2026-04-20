create table if not exists incident_meet_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  selected_user_emails text[] not null default '{}'::text[],
  external_emails text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table incident_meet_settings enable row level security;

drop policy if exists incident_meet_settings_org_select on incident_meet_settings;
create policy incident_meet_settings_org_select on incident_meet_settings
for select
using (app.is_service_role() or organization_id = app.current_org_id());

drop policy if exists incident_meet_settings_org_write on incident_meet_settings;
create policy incident_meet_settings_org_write on incident_meet_settings
for all
using (app.is_service_role() or organization_id = app.current_org_id())
with check (app.is_service_role() or organization_id = app.current_org_id());

drop trigger if exists trg_incident_meet_settings_updated_at on incident_meet_settings;
create trigger trg_incident_meet_settings_updated_at
before update on incident_meet_settings
for each row execute function app.set_updated_at();
