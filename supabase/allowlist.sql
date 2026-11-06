-- ライブ記録: only invited e-mail addresses can create an account.
-- Run once in Supabase: SQL Editor -> New query -> paste all -> Run.
-- After that, "Allow new users to sign up" can stay switched on.
--
-- To invite someone, add their address to public.signup_allowlist
-- (Table Editor -> signup_allowlist -> Insert row), or run:
--   insert into public.signup_allowlist (email, note) values ('friend@example.com', '友達の名前');
-- Accounts that already exist are not affected.

create table if not exists public.signup_allowlist (
  email    text        primary key,
  note     text,
  added_at timestamptz not null default now()
);

-- Edited in the dashboard only: the app's keys can neither read nor change it.
alter table public.signup_allowlist enable row level security;
revoke all on public.signup_allowlist from anon, authenticated;

-- Refuses a new account whose address isn't on the list. The app shows
-- "招待されていないメールアドレスです" for the error this causes.
create or replace function public.check_signup_allowlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.signup_allowlist where lower(email) = lower(new.email)) then
    raise exception 'This e-mail address is not invited';
  end if;
  return new;
end $$;

revoke execute on function public.check_signup_allowlist() from public, anon, authenticated;

drop trigger if exists check_signup_allowlist on auth.users;
create trigger check_signup_allowlist before insert on auth.users
  for each row execute function public.check_signup_allowlist();
