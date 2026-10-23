-- À exécuter une seule fois dans Supabase : SQL Editor → New query → coller → Run.
create table if not exists public.ainai_store (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Sécurité : aucun accès public. Seule la clé secrète (côté serveur AINAI) peut lire/écrire.
alter table public.ainai_store enable row level security;
revoke all on table public.ainai_store from anon, authenticated;
grant select, insert, update on table public.ainai_store to service_role;
