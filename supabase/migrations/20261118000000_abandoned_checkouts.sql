-- Abandoned checkout recovery (lib/abandoned.ts). When a Stripe Checkout session expires unpaid, the
-- webhook records when, Stripe's recovery link (valid 30 days), and the shopper's email only if they
-- ticked "keep me updated" (consent to promotional emails) on the Stripe checkout page.
begin;

alter table public.checkouts
  add column expired_at timestamptz,
  add column recovery_url text check (recovery_url is null or recovery_url ~ '^https://'),
  add column recovery_email text check (recovery_email is null or length(recovery_email) <= 254),
  add column recovered_at timestamptz;

create index checkouts_abandoned_idx on public.checkouts (store_id, expired_at desc) where expired_at is not null;

commit;
