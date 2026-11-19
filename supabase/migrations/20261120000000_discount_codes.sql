-- Discount codes (lib/discount-codes.ts): codes like TIKTOK10 that shoppers type at Stripe Checkout.
-- Stripe holds the coupon and promotion code and enforces them; this table remembers which Stripe
-- account each code lives in and lets paid orders be credited to the code they used.
begin;

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  -- What shoppers type: capitals, digits, hyphens. Unique per store regardless of case.
  code text not null check (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and length(code) between 3 and 24),
  percent_off integer check (percent_off is null or percent_off between 1 and 90),
  amount_off integer check (amount_off is null or amount_off > 0),
  currency text check (currency is null or currency in ('usd', 'gbp')),
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  expires_at timestamptz,
  active boolean not null default true,
  label text check (label is null or length(label) <= 80),
  stripe_coupon_id text not null,
  stripe_promotion_code_id text not null unique,
  -- The connected account the code was created in; null means the store's own Stripe account.
  stripe_account_id text,
  livemode boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((percent_off is null) <> (amount_off is null)),
  check (amount_off is null or currency is not null)
);
create unique index discount_codes_store_code on public.discount_codes (store_id, code);

-- What a paid order saved, and with which code (set by the Stripe webhook).
alter table public.orders add column discount_code text check (discount_code is null or length(discount_code) <= 24);
alter table public.orders add column discount_amount integer check (discount_amount is null or discount_amount >= 0);
create index orders_discount_code_idx on public.orders (store_id, discount_code) where discount_code is not null;

alter table public.discount_codes enable row level security;
revoke all on public.discount_codes from public, anon, authenticated;

commit;
