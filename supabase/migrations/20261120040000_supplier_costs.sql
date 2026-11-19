-- Supplier costs and margin watch (lib/margins.ts). Each variant can record what one unit costs from the
-- supplier and what the supplier charges to ship it; paid orders can record what the owner actually paid.
-- A daily check compares CJ products with CJ's current price; other suppliers get a "check due" reminder.
begin;

alter table public.product_variants
  add column unit_cost integer check (unit_cost is null or unit_cost >= 0),
  add column supplier_shipping integer check (supplier_shipping is null or supplier_shipping >= 0),
  add column cost_source text check (cost_source is null or cost_source in ('manual', 'order', 'cj')),
  add column cost_updated_at timestamptz,
  add column supplier_checked_at timestamptz,
  add column supplier_price_seen integer check (supplier_price_seen is null or supplier_price_seen >= 0),
  add column supplier_alert text check (supplier_alert is null or length(supplier_alert) <= 200);

-- What the owner paid the supplier for this order, in the order's currency (entered when marking it ordered).
alter table public.orders add column supplier_cost integer check (supplier_cost is null or supplier_cost >= 0);

commit;
