-- EMPOWERFIT - collecte du guide Force & Longévité
-- À appliquer au projet Supabase avant d’activer le formulaire public.

create extension if not exists pgcrypto;

create table if not exists public.lead_magnet_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  first_name text,
  source text not null default 'site',
  marketing_consent boolean not null default false,
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.lead_magnet_contacts enable row level security;
revoke all on public.lead_magnet_contacts from anon, authenticated;

create or replace function public.capture_lead_magnet(
  p_email text,
  p_first_name text default null,
  p_source text default 'site',
  p_marketing_consent boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  v_id uuid;
begin
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Adresse e-mail invalide.';
  end if;

  insert into public.lead_magnet_contacts(email, first_name, source, marketing_consent, consented_at, updated_at)
  values (
    v_email,
    nullif(trim(coalesce(p_first_name,'')),''),
    coalesce(nullif(trim(coalesce(p_source,'')),''),'site'),
    coalesce(p_marketing_consent,false),
    case when coalesce(p_marketing_consent,false) then now() else null end,
    now()
  )
  on conflict (email) do update set
    first_name = coalesce(excluded.first_name, public.lead_magnet_contacts.first_name),
    source = excluded.source,
    marketing_consent = public.lead_magnet_contacts.marketing_consent or excluded.marketing_consent,
    consented_at = case
      when public.lead_magnet_contacts.marketing_consent then public.lead_magnet_contacts.consented_at
      when excluded.marketing_consent then now()
      else public.lead_magnet_contacts.consented_at
    end,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.capture_lead_magnet(text,text,text,boolean) from public;
grant execute on function public.capture_lead_magnet(text,text,text,boolean) to anon, authenticated;
