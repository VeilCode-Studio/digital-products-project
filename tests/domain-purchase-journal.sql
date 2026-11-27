-- Run against staging with a privileged migration connection. Everything is rolled back.
begin;
set local role service_role;
do $$
declare
  v_store uuid; v_owner uuid; v_product text; v_id uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_count integer; v_contact jsonb;
begin
  select s.id, s.owner_user_id, p.id into strict v_store, v_owner, v_product
  from public.stores s join public.products p on p.store_id=s.id
  where s.owner_user_id is not null limit 1;

  insert into public.domain_purchases(id,store_id,owner_user_id,product_id,hostname,origin,livemode,amount,renewal_amount,years,request_hash,contact)
  values(v_id,v_store,v_owner,v_product,'journal-check.example.com','https://staging.example.com',false,699,1203,1,repeat('a',64),'{"email":"test@example.com"}');
  begin
    insert into public.domain_purchases(id,store_id,owner_user_id,product_id,hostname,origin,livemode,amount,renewal_amount,years,request_hash,contact)
    values(gen_random_uuid(),v_store,v_owner,v_product,'journal-check.example.com','https://staging.example.com',false,699,1203,1,repeat('a',64),'{}');
    raise exception 'Duplicate in-flight domain purchase accepted';
  exception when unique_violation then null; end;
  begin
    update public.domain_purchases set simulation_scenario='uncertain' where id=v_id;
    raise exception 'Simulation scenario changed after review';
  exception when check_violation then null; end;
  begin
    update public.domain_purchases set terms_version='other' where id=v_id;
    raise exception 'Terms version changed after review';
  exception when check_violation then null; end;
  begin
    insert into public.domain_purchases(id,store_id,owner_user_id,product_id,hostname,origin,livemode,amount,renewal_amount,years,request_hash,contact,simulation_scenario)
    values(gen_random_uuid(),v_store,v_owner,v_product,'mode-check.example.com','https://staging.example.com',true,699,1203,1,repeat('a',64),'{}','success');
    raise exception 'A live purchase accepted a simulated outcome';
  exception when check_violation then null; end;
  begin
    update public.domain_purchases set status='registered',registrar_order_id='journal-order' where id=v_id;
    raise exception 'An unpaid purchase became registered';
  exception when check_violation then null; end;
  begin
    update public.domain_purchases set amount=1 where id=v_id;
    raise exception 'Reviewed price changed';
  exception when check_violation then null; end;

  update public.domain_purchases set stripe_session_id='cs_test_journal',stripe_payment_intent_id='pi_journal',status='paid' where id=v_id;
  select count(*) into v_count from public.claim_domain_registration(v_id);
  if v_count <> 1 then raise exception 'First registration claim failed'; end if;
  select count(*) into v_count from public.claim_domain_registration(v_id);
  if v_count <> 0 then raise exception 'Duplicate registration claim succeeded'; end if;
  update public.domain_purchases set status='registration_unknown' where id=v_id;
  begin
    update public.domain_purchases set status='registering' where id=v_id;
    raise exception 'Uncertain registration was retried';
  exception when check_violation then null; end;
  update public.domain_purchases set status='registration_pending',registrar_order_id='journal-order' where id=v_id;
  update public.domain_purchases set status='registered' where id=v_id;
  select contact into v_contact from public.domain_purchases where id=v_id;
  if v_contact is not null then raise exception 'Registrant contact retained after completion'; end if;
  begin
    update public.domain_purchases set status='paid' where id=v_id;
    raise exception 'Completed registration moved backwards';
  exception when check_violation then null; end;

  -- A known failed registration must retain a tracked refund result; it cannot be marked refunded without Stripe's ID.
  v_id := gen_random_uuid();
  insert into public.domain_purchases(id,store_id,owner_user_id,product_id,hostname,origin,livemode,amount,renewal_amount,years,request_hash,contact)
  values(v_id,v_store,v_owner,v_product,'refund-check.example.com','https://staging.example.com',false,699,1203,1,repeat('c',64),'{"email":"test@example.com"}');
  update public.domain_purchases set status='paid',stripe_session_id='cs_test_journal_refund',stripe_payment_intent_id='pi_journal_refund' where id=v_id;
  perform public.claim_domain_registration(v_id);
  update public.domain_purchases set status='registration_failed' where id=v_id;
  update public.domain_purchases set status='refund_pending' where id=v_id;
  begin
    update public.domain_purchases set status='refunded' where id=v_id;
    raise exception 'Refund was completed without a provider reference';
  exception when check_violation then null; end;
  update public.domain_purchases set status='refunded',stripe_refund_id='re_journal' where id=v_id;
  select contact into v_contact from public.domain_purchases where id=v_id;
  if v_contact is not null then raise exception 'Registrant contact retained after refund'; end if;

  insert into public.stores(id,owner_user_id) values(v_other,null);
  begin
    insert into public.domain_purchases(id,store_id,owner_user_id,product_id,hostname,origin,livemode,amount,renewal_amount,years,request_hash,contact)
    values(gen_random_uuid(),v_other,v_owner,v_product,'foreign.example.com','https://staging.example.com',false,699,1203,1,repeat('b',64),'{}');
    raise exception 'A user purchased for a store they do not own';
  exception when insufficient_privilege then null; end;
  update public.stores set owner_user_id=v_owner where id=v_other;
  begin
    insert into public.domain_purchases(id,store_id,owner_user_id,product_id,hostname,origin,livemode,amount,renewal_amount,years,request_hash,contact)
    values(gen_random_uuid(),v_other,v_owner,v_product,'foreign.example.com','https://staging.example.com',false,699,1203,1,repeat('b',64),'{}');
    raise exception 'A product from another store was accepted';
  exception when foreign_key_violation then null; end;

  if has_table_privilege('anon','public.domain_purchases','select')
    or has_table_privilege('authenticated','public.domain_purchases','select')
    or has_function_privilege('authenticated','public.claim_domain_registration(uuid)','execute') then
    raise exception 'Browser roles can access private purchases';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.domain_purchases'::regclass) then
    raise exception 'RLS is disabled';
  end if;
end;
$$;
rollback;
