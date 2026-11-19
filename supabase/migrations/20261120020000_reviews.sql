-- Customer reviews (lib/reviews.ts). A few days after an order arrives, the buyer gets one email asking
-- for a rating. Each review is tied to a real paid order (so it is a verified purchase), waits for the
-- owner's approval, and only then shows on the product page.
begin;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid not null unique references public.orders(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  title text check (title is null or length(title) <= 80),
  body text check (body is null or length(body) <= 2000),
  display_name text not null check (length(display_name) between 1 and 40),
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);
create index reviews_product_idx on public.reviews (store_id, product_id, status, created_at desc);

-- The one review request per order, and its link (hash only).
alter table public.orders add column review_requested_at timestamptz;
alter table public.orders add column review_token_hash text unique;

alter table public.reviews enable row level security;
revoke all on public.reviews from public, anon, authenticated;

commit;
