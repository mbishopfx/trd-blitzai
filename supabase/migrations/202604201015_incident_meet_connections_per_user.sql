alter table if exists incident_meet_connections
  add column if not exists user_id uuid;

alter table if exists incident_meet_connections
  drop constraint if exists incident_meet_connections_organization_id_key;

create unique index if not exists idx_incident_meet_connections_org_user
  on incident_meet_connections (organization_id, user_id);
