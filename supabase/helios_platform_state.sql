-- Registro principal de la plataforma HELIOS.
-- Aplicar en el SQL editor de Supabase. RLS queda activo y sin políticas:
-- la publishable key no lee ni escribe; solo la service role del backend.

create table if not exists public.helios_platform_state (
  id text primary key,
  revision integer not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.helios_platform_state enable row level security;
