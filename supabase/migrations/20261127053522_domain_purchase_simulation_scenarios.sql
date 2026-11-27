begin;
alter table public.domain_purchases add column simulation_scenario text default 'success';
alter table public.domain_purchases add column terms_version text not null default '2026-11-27-v1';
alter table public.domain_purchases add constraint domain_purchase_simulation_mode check (
  (livemode and simulation_scenario is null) or
  (not livemode and simulation_scenario is not null and simulation_scenario in ('success','failure','uncertain'))
);
create function public.guard_domain_purchase_simulation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.simulation_scenario is distinct from old.simulation_scenario or new.terms_version is distinct from old.terms_version then
    raise exception 'Reviewed registration scenario cannot be changed' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger guard_domain_purchase_simulation before update on public.domain_purchases
for each row execute function public.guard_domain_purchase_simulation();
revoke all on function public.guard_domain_purchase_simulation() from public,anon,authenticated;
create unique index domain_purchase_one_in_flight on public.domain_purchases(hostname,livemode)
where status in ('checkout_pending','paid','registering','registration_pending','registration_unknown','registration_failed','refund_pending','refund_failed');
commit;
