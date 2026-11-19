-- The discount code shown on thank-you pages as a reason to come back (lib/thank-you-offers.ts).
begin;
alter table public.stores add column thank_you_code_id uuid references public.discount_codes(id) on delete set null;
commit;
