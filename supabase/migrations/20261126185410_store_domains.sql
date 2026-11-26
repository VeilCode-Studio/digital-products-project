begin;

-- A physical storefront is a product, not a separate stores row. One primary hostname per product.
create table public.store_domains (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  product_id text not null,
  hostname text not null unique check (hostname = lower(hostname) and length(hostname) <= 253 and hostname ~ '^[a-z0-9][a-z0-9.-]+[a-z]$'),
  status text not null default 'pending' check (status in ('pending', 'active')),
  verification jsonb not null default '[]'::jsonb check (jsonb_typeof(verification) = 'array'),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (store_id, product_id) references public.products(store_id, id),
  unique (store_id, product_id)
);
alter table public.store_domains enable row level security;
revoke all on public.store_domains from public, anon, authenticated;
grant select, insert, update, delete on public.store_domains to service_role;

comment on table public.store_domains is 'Server-managed storefront hostnames. Activation requires ownership, DNS and certificate verification.';
commit;
