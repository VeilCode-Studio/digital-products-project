begin;

-- Server-only purchase journal. Card data is never stored here. Contacts are removed on completion/refund/expiry.
create table public.domain_purchases (
  id uuid primary key,
  store_id uuid not null references public.stores(id),
  owner_user_id uuid not null references auth.users(id),
  product_id text not null,
  hostname text not null check (hostname = lower(hostname) and hostname ~ '^[a-z0-9][a-z0-9.-]+[a-z]$' and length(hostname) <= 253),
  origin text not null check (origin ~ '^https?://[^/]+$'),
  livemode boolean not null,
  amount integer not null check (amount between 50 and 10000000),
  renewal_amount integer not null check (renewal_amount > 0),
  currency text not null default 'usd' check (currency = 'usd'),
  years integer not null check (years between 1 and 10),
  auto_renew boolean not null default false,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  contact jsonb check (contact is null or jsonb_typeof(contact) = 'object'),
  status text not null default 'checkout_pending' check (status in (
    'checkout_pending','paid','registering','registration_pending','registered',
    'registration_failed','registration_unknown','refund_pending','refunded','refund_failed','expired'
  )),
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  registrar_order_id text unique,
  stripe_refund_id text unique,
  failure_code text,
  registered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (store_id, product_id) references public.products(store_id, id),
  constraint domain_purchase_payment_record check (
    status in ('checkout_pending','expired') or (stripe_session_id is not null and stripe_payment_intent_id is not null)
  ),
  constraint domain_purchase_order_record check (
    status not in ('registration_pending','registered') or registrar_order_id is not null
  ),
  constraint domain_purchase_refund_record check (status <> 'refunded' or stripe_refund_id is not null)
);
create index domain_purchases_store_created on public.domain_purchases(store_id, created_at desc);
create index domain_purchases_work on public.domain_purchases(status, updated_at);

create function public.guard_domain_purchase() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'checkout_pending' or new.contact is null or new.stripe_session_id is not null
      or new.stripe_payment_intent_id is not null or new.registrar_order_id is not null or new.stripe_refund_id is not null then
      raise exception 'Domain purchase must start with a reviewed unpaid request' using errcode = '23514';
    end if;
    if not exists (select 1 from public.stores s where s.id = new.store_id and s.owner_user_id = new.owner_user_id) then
      raise exception 'Domain purchase owner does not own the store' using errcode = '42501';
    end if;
  else
    if (new.id, new.store_id, new.owner_user_id, new.product_id, new.hostname, new.origin, new.livemode,
        new.amount, new.renewal_amount, new.currency, new.years, new.auto_renew, new.request_hash, new.created_at)
      is distinct from
       (old.id, old.store_id, old.owner_user_id, old.product_id, old.hostname, old.origin, old.livemode,
        old.amount, old.renewal_amount, old.currency, old.years, old.auto_renew, old.request_hash, old.created_at) then
      raise exception 'Reviewed domain purchase cannot be changed' using errcode = '23514';
    end if;
    if old.stripe_session_id is not null and new.stripe_session_id is distinct from old.stripe_session_id
      or old.stripe_payment_intent_id is not null and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
      or old.registrar_order_id is not null and new.registrar_order_id is distinct from old.registrar_order_id
      or old.stripe_refund_id is not null and new.stripe_refund_id is distinct from old.stripe_refund_id then
      raise exception 'Domain purchase provider references cannot be changed' using errcode = '23514';
    end if;
    if old.status <> new.status and not (
      old.status = 'checkout_pending' and new.status in ('paid','expired') or
      old.status = 'paid' and new.status = 'registering' or
      old.status = 'registering' and new.status in ('registration_pending','registered','registration_failed','registration_unknown') or
      old.status = 'registration_pending' and new.status in ('registered','registration_failed','registration_unknown') or
      old.status = 'registration_unknown' and new.status in ('registration_pending','registered','registration_failed') or
      old.status = 'registration_failed' and new.status = 'refund_pending' or
      old.status = 'refund_pending' and new.status in ('refunded','refund_failed') or
      old.status = 'refund_failed' and new.status = 'refund_pending'
    ) then
      raise exception 'Invalid domain purchase transition' using errcode = '23514';
    end if;
    if new.contact is distinct from old.contact and new.contact is not null then
      raise exception 'Registrant details cannot be replaced after purchase review' using errcode = '23514';
    end if;
  end if;
  if new.status in ('registered','refunded','expired') then new.contact := null; end if;
  if new.status = 'registered' and new.registered_at is null then new.registered_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger guard_domain_purchase before insert or update on public.domain_purchases
for each row execute function public.guard_domain_purchase();

-- The atomic transition is the one-shot registration claim. A crash/timeout never authorizes a second purchase.
create function public.claim_domain_registration(p_id uuid) returns setof public.domain_purchases
language sql security invoker set search_path = '' as $$
  update public.domain_purchases set status = 'registering'
  where id = p_id and status = 'paid'
  returning *;
$$;

alter table public.domain_purchases enable row level security;
revoke all on public.domain_purchases from public, anon, authenticated;
grant select, insert, update on public.domain_purchases to service_role;
revoke all on function public.guard_domain_purchase() from public, anon, authenticated;
revoke all on function public.claim_domain_registration(uuid) from public, anon, authenticated;
grant execute on function public.claim_domain_registration(uuid) to service_role;
commit;
