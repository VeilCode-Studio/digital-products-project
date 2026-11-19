-- Email list (lib/subscribers.ts): visitors leave their email for a free download the owner picks.
-- Marketing consent is a separate, unticked choice, recorded with the exact wording and time, so the
-- list only ever emails people who asked. Every subscriber can unsubscribe with their own token.
begin;

-- The digital product given away for an email address (null: no free download offered).
alter table public.stores add column gift_product_id text references public.products(id) on delete set null;

create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 3 and 254 and position('@' in email) > 1),
  marketing_consent boolean not null default false,
  consent_text text check (consent_text is null or length(consent_text) <= 500),
  consented_at timestamptz,
  source text not null default 'free-download' check (source in ('free-download', 'manual')),
  gift_product_id text references public.products(id) on delete set null,
  -- The free download link (hash only), like order downloads: limited uses, expires.
  download_token_hash text unique,
  download_count integer not null default 0 check (download_count >= 0),
  token_expires_at timestamptz,
  -- Kept as-is (not hashed) so every email can carry the same working unsubscribe link; it can only unsubscribe.
  unsubscribe_token text not null unique check (unsubscribe_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  unsubscribed_at timestamptz,
  -- When the download email was last sent; resends wait, so the form can't be used to flood an inbox.
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, email)
);
create index subscribers_store_idx on public.subscribers (store_id, created_at desc);

-- One download: count it only while the link is valid and has uses left.
create function public.consume_gift_download(p_token_hash text, p_max integer)
returns table (gift_product_id text) language sql set search_path = '' as $$
  update public.subscribers set download_count = download_count + 1, updated_at = now()
  where download_token_hash = p_token_hash and download_count < p_max and token_expires_at > now()
  returning subscribers.gift_product_id;
$$;

alter table public.subscribers enable row level security;
revoke all on public.subscribers from public, anon, authenticated;
revoke all on function public.consume_gift_download(text, integer) from public, anon, authenticated;

commit;
