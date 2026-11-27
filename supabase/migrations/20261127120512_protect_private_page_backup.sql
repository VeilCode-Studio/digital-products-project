begin;
-- Internal page backups must never be readable through browser Data API roles.
-- Some environments do not have this maintenance table; leave them unchanged.
do $$
begin
  if to_regclass('public._page_backup') is not null then
    alter table public._page_backup enable row level security;
    revoke all on public._page_backup from public, anon, authenticated;
  end if;
end;
$$;
commit;
