alter table integration_connections
  drop constraint if exists integration_connections_provider_check;

alter table integration_connections
  add constraint integration_connections_provider_check
  check (provider in ('gbp', 'ga4', 'google_ads', 'search_console', 'ghl'));

alter table client_actions_needed
  drop constraint if exists client_actions_needed_provider_check;

alter table client_actions_needed
  add constraint client_actions_needed_provider_check
  check (provider in ('gbp', 'ga4', 'google_ads', 'search_console', 'ghl'));

alter table attribution_daily
  drop constraint if exists attribution_daily_channel_check;

alter table attribution_daily
  add constraint attribution_daily_channel_check
  check (channel in ('gbp', 'ga4', 'google_ads', 'search_console'));
