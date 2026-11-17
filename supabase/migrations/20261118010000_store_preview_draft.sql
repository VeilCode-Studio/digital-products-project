-- Live preview of unsaved store edits (lib/manage-stores.ts saveStorePreview). The editor sends its
-- validated draft here as the owner types; /s/<slug>?preview=1&draft=1 renders it for the signed-in
-- owner only. It never affects the saved store, checkout, or what visitors see.
begin;

alter table public.products
  add column preview_draft jsonb check (preview_draft is null or jsonb_typeof(preview_draft) = 'object'),
  add column preview_updated_at timestamptz;

commit;
