-- HELIOS platform core — apply in Supabase SQL editor when ready.
-- Nest also mirrors this schema in a local JSON store for demos without service role.

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id text primary key,
  display_name text not null,
  title text not null,
  demo_role text not null check (demo_role in ('chief','crew','medic','psychologist','ops')),
  avatar_key text,
  created_at timestamptz not null default now()
);

create table if not exists demo_sessions (
  token text primary key,
  profile_id text not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists missions (
  id text primary key,
  code text not null unique,
  name text not null,
  destination text not null default '',
  stage text not null check (stage in ('draft','preflight','aboard','postmission','archived','cancelled')),
  planned_start date,
  duration_days int not null default 30,
  planned_crew_count int not null default 4,
  timezone text not null default 'UTC',
  activities jsonb not null default '[]',
  comms_notes text not null default '',
  storage_notes text not null default '',
  prep_percent numeric not null default 0,
  created_by text not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mission_memberships (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  role text not null check (role in ('chief','crew','medic','psychologist','ops')),
  status text not null check (status in ('active','pending','left')) default 'active',
  created_at timestamptz not null default now(),
  unique (mission_id, profile_id)
);

create table if not exists invitations (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  code text not null,
  invited_role text not null check (invited_role in ('crew','medic','psychologist','ops')),
  requested_by text references profiles(id),
  status text not null check (status in ('open','pending','accepted','rejected','revoked')) default 'open',
  created_at timestamptz not null default now()
);

create table if not exists prep_items (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  category text not null,
  title text not null,
  description text not null default '',
  source text not null default '',
  owner_profile_id text references profiles(id),
  qty_required numeric,
  qty_available numeric,
  critical boolean not null default false,
  status text not null,
  evidence text not null default '',
  verified_by text references profiles(id),
  verified_at timestamptz,
  applies boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists prep_snapshots (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  percent numeric not null,
  payload jsonb not null,
  confirmed_by text not null references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists health_grants (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  subject_profile_id text not null references profiles(id),
  grantee_profile_id text not null references profiles(id),
  categories jsonb not null default '[]',
  scope_note text not null default '',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists access_audit (
  id text primary key,
  mission_id text,
  actor_profile_id text,
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists wake_checks (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  profile_id text not null references profiles(id),
  period_key text not null,
  status text not null check (status in ('pending','completed','skipped')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (mission_id, profile_id, period_key)
);

create table if not exists sleep_episodes (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  profile_id text not null references profiles(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  quality int,
  kind text not null default 'night',
  created_at timestamptz not null default now()
);

create table if not exists symptom_reports (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  profile_id text not null references profiles(id),
  description text not null,
  started_at timestamptz,
  intensity int,
  context text not null default '',
  source text not null default 'self_report',
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  profile_id text not null references profiles(id),
  mode text not null check (mode in ('physical','emotional')),
  private boolean not null default true,
  messages jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversation_summaries (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  body text not null,
  approved boolean not null default false,
  share_with text,
  created_at timestamptz not null default now()
);

create table if not exists appointments (
  id text primary key,
  mission_id text not null references missions(id) on delete cascade,
  requester_id text not null references profiles(id),
  professional_id text references profiles(id),
  specialty text not null,
  modality text not null default 'aboard',
  reason text not null default '',
  summary text not null default '',
  status text not null,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists evidence_sources (
  id text primary key,
  title text not null,
  institution text not null,
  url text not null,
  kind text not null,
  notes text not null default ''
);

create table if not exists protocols (
  id text primary key,
  mission_id text,
  title text not null,
  version text not null,
  body text not null,
  audience text not null default 'crew',
  created_at timestamptz not null default now()
);