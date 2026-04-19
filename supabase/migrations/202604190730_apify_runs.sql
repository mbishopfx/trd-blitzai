-- Persist Apify SEO run history for client workspaces.

create table if not exists apify_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  action_key text not null check (action_key in ('brand_rankings', 'answer_engine_seo', 'site_crawl', 'local_listings')),
  label text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  source_type text not null check (source_type in ('actor', 'task')),
  source_id text not null,
  apify_run_id text,
  dataset_id text,
  input_summary jsonb not null default '[]'::jsonb,
  summary_lines jsonb not null default '[]'::jsonb,
  preview_items jsonb not null default '[]'::jsonb,
  error text,
  created_by text not null default 'system',
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_apify_runs_org_client_created_at
on apify_runs (organization_id, client_id, created_at desc);

create index if not exists idx_apify_runs_client_action_created_at
on apify_runs (client_id, action_key, created_at desc);

create unique index if not exists idx_apify_runs_apify_run_id
on apify_runs (apify_run_id)
where apify_run_id is not null;

drop trigger if exists trg_apify_runs_updated_at on apify_runs;
create trigger trg_apify_runs_updated_at
before update on apify_runs
for each row execute function app.set_updated_at();

alter table apify_runs enable row level security;

drop policy if exists apify_runs_org_select on apify_runs;
create policy apify_runs_org_select on apify_runs
for select
using (app.has_org_access(organization_id));

drop policy if exists apify_runs_org_write on apify_runs;
create policy apify_runs_org_write on apify_runs
for all
using (app.has_org_access(organization_id))
with check (app.has_org_access(organization_id));
