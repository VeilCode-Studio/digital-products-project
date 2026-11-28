begin;
set local role service_role;
do $$
declare original public.stores; again uuid; product text := gen_random_uuid()::text; grant_row record; remaining integer;
begin
  select * into original from public.stores where owner_user_id is not null limit 1;
  if original.id is null then raise exception 'Owned fixture store required'; end if;
  again := public.provision_workspace(original.owner_user_id,'Must not replace an existing store','test@example.com');
  if again <> original.id or (select name from public.stores where id=again) <> original.name then raise exception 'Provisioning changed existing ownership'; end if;
  if has_function_privilege('anon','public.provision_workspace(uuid,text,text)','execute') or has_function_privilege('authenticated','public.provision_workspace(uuid,text,text)','execute') then raise exception 'Browser provisioning grant'; end if;
  insert into public.products(id,store_id,name,slug) values(product,original.id,'Isolated download test','test-'||product);
  insert into public.orders(stripe_session_id,store_id,product_id,email,download_token_hash,token_expires_at,max_downloads,product_snapshot)
  values('cs_test_isolation_'||product,original.id,product,'test@example.com',product,now()+interval '1 hour',1,jsonb_build_object('storagePath',original.id||'/'||product||'/downloads/test.pdf'));
  select * into grant_row from public.consume_workspace_download(product);
  if grant_row.store_id <> original.id or grant_row.product_id <> product then raise exception 'Download lost its workspace'; end if;
  select count(*) into remaining from public.consume_workspace_download(product);
  if remaining <> 0 then raise exception 'Download limit not enforced'; end if;
  insert into public.subscribers(store_id,email,gift_product_id,download_token_hash,token_expires_at,unsubscribe_token)
  values(original.id,product||'@example.com',product,product,now()+interval '1 hour',replace(product,'-',''));
  select * into grant_row from public.consume_workspace_gift_download(product,1);
  if grant_row.store_id <> original.id or grant_row.gift_product_id <> product then raise exception 'Gift lost its workspace'; end if;
  select count(*) into remaining from public.consume_workspace_gift_download(product,1);
  if remaining <> 0 then raise exception 'Gift limit not enforced'; end if;
end $$;
rollback;
