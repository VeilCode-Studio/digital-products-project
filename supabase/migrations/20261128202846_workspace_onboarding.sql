begin;
create unique index if not exists stores_one_per_owner on public.stores(owner_user_id) where owner_user_id is not null;

-- Only the server can call this, after Auth.getUser verifies identity and email confirmation.
-- Keep SECURITY INVOKER: no new access to Supabase's managed auth schema is granted.
create function public.provision_workspace(p_user_id uuid, p_name text, p_email text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then raise exception 'Verified email required' using errcode='22023'; end if;
  if length(trim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]' then raise exception 'Invalid store name' using errcode='22023'; end if;
  insert into public.stores(id,owner_user_id,name,support_email,tagline,bio,website_url)
    values(gen_random_uuid(),p_user_id,trim(p_name),p_email,'','',null)
    on conflict(owner_user_id) where owner_user_id is not null do nothing;
  select id into result from public.stores where owner_user_id=p_user_id;
  return result;
end $$;
revoke all on function public.provision_workspace(uuid,text,text) from public,anon,authenticated;
grant execute on function public.provision_workspace(uuid,text,text) to service_role;

create function public.consume_workspace_download(p_token_hash text)
returns table (product_id text, product_snapshot jsonb, store_id uuid)
language sql security invoker set search_path='' as $$
  update public.orders set download_count=download_count+1
  where download_token_hash=p_token_hash and download_count<max_downloads and token_expires_at>now()
  returning orders.product_id,orders.product_snapshot,orders.store_id;
$$;
create function public.consume_workspace_gift_download(p_token_hash text,p_max integer)
returns table(gift_product_id text,store_id uuid)
language sql security invoker set search_path='' as $$
  update public.subscribers set download_count=download_count+1,updated_at=now()
  where download_token_hash=p_token_hash and download_count<p_max and token_expires_at>now()
  returning subscribers.gift_product_id,subscribers.store_id;
$$;
revoke all on function public.consume_workspace_download(text) from public,anon,authenticated;
revoke all on function public.consume_workspace_gift_download(text,integer) from public,anon,authenticated;
grant execute on function public.consume_workspace_download(text) to service_role;
grant execute on function public.consume_workspace_gift_download(text,integer) to service_role;
commit;
