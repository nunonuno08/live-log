-- ライブ記録: cloud sync schema.
-- Run once in Supabase: SQL Editor -> New query -> paste all -> Run.
--
-- Every artist / live / song / venue is one row. The app keeps working offline on the
-- phone and exchanges changed rows when online; the newer change wins.

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  kind       text        not null check (kind in ('artists', 'lives', 'songs', 'venues')),
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at bigint      not null,               -- when the change was made on the phone (ms)
  server_at  timestamptz not null default now(), -- when the server received it (for "what's new")
  primary key (user_id, kind, id)
);

create index if not exists records_changes on public.records (user_id, server_at);

-- Keep the newer change: an update carrying an older timestamp is ignored.
create or replace function public.records_keep_newest() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_at := now();
  return new;
end $$;

drop trigger if exists records_keep_newest on public.records;
create trigger records_keep_newest before insert or update on public.records
  for each row execute function public.records_keep_newest();

-- Each person can only see and change their own rows.
alter table public.records enable row level security;
drop policy if exists "own records" on public.records;
create policy "own records" on public.records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Photos: private bucket, one folder per person ("<user id>/<photo id>.jpg").
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "own photos select" on storage.objects;
drop policy if exists "own photos insert" on storage.objects;
drop policy if exists "own photos update" on storage.objects;
drop policy if exists "own photos delete" on storage.objects;
create policy "own photos select" on storage.objects for select
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos insert" on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos update" on storage.objects for update
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own photos delete" on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
