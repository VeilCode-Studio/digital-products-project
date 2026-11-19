-- Short links (lib/short-links.ts): readable links like /lamp for videos and captions, where links
-- can't be clicked and viewers type them. Each link points at one product (or the home page), counts
-- its clicks, and tags the checkouts it leads to so sales can be credited to it.
begin;

create table public.short_links (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  -- Lowercase letters and digits, single hyphens between them. Unique across the whole domain.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 32),
  -- Null means the store's home page.
  product_id text references public.products(id) on delete set null,
  source text not null default 'tiktok' check (source in ('tiktok', 'instagram', 'youtube', 'facebook', 'other')),
  label text check (label is null or length(label) <= 80),
  active boolean not null default true,
  clicks integer not null default 0 check (clicks >= 0),
  last_clicked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index short_links_store_idx on public.short_links (store_id, created_at desc);

create table public.short_link_clicks (
  id bigint generated always as identity primary key,
  link_id uuid not null references public.short_links(id) on delete cascade,
  created_at timestamptz not null default now(),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  device text check (device is null or device in ('mobile', 'tablet', 'desktop')),
  in_app text check (in_app is null or in_app in ('tiktok', 'instagram', 'facebook'))
);
create index short_link_clicks_link_idx on public.short_link_clicks (link_id, created_at desc);

-- The checkout a click led to; set from the visitor's link cookie when they start checkout.
alter table public.checkouts add column link_slug text check (link_slug is null or link_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
create index checkouts_link_idx on public.checkouts (store_id, link_slug, created_at desc) where link_slug is not null;

-- One round trip per click: log it and bump the counter together.
create function public.record_short_link_click(p_link_id uuid, p_country text, p_device text, p_in_app text)
returns void language sql set search_path = '' as $$
  insert into public.short_link_clicks (link_id, country, device, in_app) values (p_link_id, p_country, p_device, p_in_app);
  update public.short_links set clicks = clicks + 1, last_clicked_at = now() where id = p_link_id;
$$;

alter table public.short_links enable row level security;
alter table public.short_link_clicks enable row level security;
revoke all on public.short_links, public.short_link_clicks from public, anon, authenticated;
revoke all on function public.record_short_link_click(uuid, text, text, text) from public, anon, authenticated;

commit;
