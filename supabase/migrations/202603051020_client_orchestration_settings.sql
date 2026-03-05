-- Per-client orchestration controls for Blitz content/review behavior

create table if not exists client_orchestration_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null unique references clients(id) on delete cascade,
  tone text not null default 'professional-local-expert',
  objectives text[] not null default '{Increase local visibility,Improve review response velocity,Publish location-aware GBP content consistently}'::text[],
  photo_asset_urls text[] not null default '{}'::text[],
  sitemap_url text,
  default_post_url text,
  review_reply_style text not null default 'balanced',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_client_orchestration_settings_org_client
on client_orchestration_settings (organization_id, client_id);

drop trigger if exists trg_client_orchestration_settings_updated_at on client_orchestration_settings;
create trigger trg_client_orchestration_settings_updated_at
before update on client_orchestration_settings
for each row execute function app.set_updated_at();

alter table client_orchestration_settings enable row level security;

drop policy if exists client_orchestration_settings_org_select on client_orchestration_settings;
create policy client_orchestration_settings_org_select on client_orchestration_settings
for select
using (app.has_org_access(organization_id));

drop policy if exists client_orchestration_settings_org_write on client_orchestration_settings;
create policy client_orchestration_settings_org_write on client_orchestration_settings
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));
