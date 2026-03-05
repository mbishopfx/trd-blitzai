-- Expand orchestration settings and add per-client media asset inventory/bucket mapping

alter table if exists client_orchestration_settings
  add column if not exists photo_asset_ids uuid[] not null default '{}'::uuid[],
  add column if not exists post_frequency_per_week integer not null default 3,
  add column if not exists post_word_count_min integer not null default 500,
  add column if not exists post_word_count_max integer not null default 800,
  add column if not exists eeat_structured_snippet_enabled boolean not null default true;

alter table if exists client_orchestration_settings
  drop constraint if exists client_orchestration_settings_post_frequency_check;
alter table if exists client_orchestration_settings
  add constraint client_orchestration_settings_post_frequency_check
  check (post_frequency_per_week >= 0 and post_frequency_per_week <= 21);

alter table if exists client_orchestration_settings
  drop constraint if exists client_orchestration_settings_post_word_range_check;
alter table if exists client_orchestration_settings
  add constraint client_orchestration_settings_post_word_range_check
  check (post_word_count_min >= 120 and post_word_count_max >= post_word_count_min and post_word_count_max <= 2000);

create table if not exists client_media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  bytes bigint,
  is_allowed_for_posts boolean not null default true,
  tags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, storage_bucket, storage_path)
);

create index if not exists idx_client_media_assets_org_client
on client_media_assets (organization_id, client_id, created_at desc);

create index if not exists idx_client_media_assets_allowed
on client_media_assets (client_id, is_allowed_for_posts, created_at desc);

drop trigger if exists trg_client_media_assets_updated_at on client_media_assets;
create trigger trg_client_media_assets_updated_at
before update on client_media_assets
for each row execute function app.set_updated_at();

alter table client_media_assets enable row level security;

drop policy if exists client_media_assets_org_select on client_media_assets;
create policy client_media_assets_org_select on client_media_assets
for select
using (app.has_org_access(organization_id));

drop policy if exists client_media_assets_org_write on client_media_assets;
create policy client_media_assets_org_write on client_media_assets
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));
