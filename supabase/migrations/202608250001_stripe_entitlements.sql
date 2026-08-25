-- EMPOWERFIT: droits d'accès, crédits et réservation protégée par paiement.
-- À exécuter après la migration initiale qui crée bookable_items et bookings.

create extension if not exists pgcrypto;

alter table public.bookable_items
  add column if not exists location text not null default 'brignoles';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bookable_items_location_check'
      and conrelid = 'public.bookable_items'::regclass
  ) then
    alter table public.bookable_items
      add constraint bookable_items_location_check
      check (location in ('aix', 'brignoles', 'visio'));
  end if;
end $$;

update public.bookable_items
set location = 'visio'
where category = 'bilans' and title ~* 'visio';

create or replace function public.list_available_items_v2()
returns table (
  id uuid,
  category text,
  title text,
  starts_at timestamptz,
  duration_minutes integer,
  capacity integer,
  price_cents integer,
  location text,
  booked bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    i.id, i.category, i.title, i.starts_at, i.duration_minutes,
    i.capacity, i.price_cents, i.location,
    count(b.id) filter (where b.status = 'confirmed') as booked
  from public.bookable_items i
  left join public.bookings b on b.item_id = i.id
  where i.active = true
    and (i.starts_at is null or i.starts_at >= now())
  group by i.id
  order by i.starts_at nulls last, i.created_at;
$$;

revoke all on function public.list_available_items_v2() from public;
grant execute on function public.list_available_items_v2() to anon, authenticated;

create table if not exists public.payment_offers (
  code text primary key,
  title text not null,
  payment_link_url text not null unique,
  entitlement_type text not null check (entitlement_type in ('subscription', 'credits')),
  credit_scope text not null,
  weekly_limit integer check (weekly_limit is null or weekly_limit > 0),
  credits_granted integer check (credits_granted is null or credits_granted > 0),
  validity_days integer check (validity_days is null or validity_days > 0),
  ends_in_june boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.payment_offers
  (code, title, payment_link_url, entitlement_type, credit_scope, weekly_limit, credits_granted, validity_days, ends_in_june)
values
  ('start_ten', 'START TEN – Brignoles', 'https://buy.stripe.com/7sY3cu6ST4W68jS9X963K0d', 'subscription', 'course', 2, null, null, true),
  ('serenity', 'SERENITY – Brignoles', 'https://buy.stripe.com/cNi8wO2CD2NYfMk5GT63K0a', 'subscription', 'course', 1, null, null, false),
  ('balance', 'BALANCE – Brignoles', 'https://buy.stripe.com/bJebJ0dhh4W61Vu6KX63K0b', 'subscription', 'course', 2, null, null, false),
  ('infinity', 'INFINITY – Brignoles', 'https://buy.stripe.com/dRm4gy7WX1JUgQo8T563K0f', 'subscription', 'course', null, null, null, false),
  ('trial', 'Séance d’essai – Brignoles', 'https://buy.stripe.com/14A8wO3GH2NY57G8T563K09', 'credits', 'course', null, 1, null, false),
  ('card_10', 'Carte 10 cours – Brignoles', 'https://buy.stripe.com/6oU9ASb990FQbw44CP63K08', 'credits', 'course', null, 10, 90, false),
  ('bilan_visio', 'Bilan visio 45 min', 'https://buy.stripe.com/cNicN4911agq57G2uH63K07', 'credits', 'bilan_visio', null, 1, null, false),
  ('bilan_physique', 'Bilan physique 60 min – Brignoles', 'https://buy.stripe.com/cNi5kC6STdsC9nW7P163K0e', 'credits', 'bilan_physique', null, 1, null, false)
on conflict (code) do update set
  title = excluded.title,
  payment_link_url = excluded.payment_link_url,
  entitlement_type = excluded.entitlement_type,
  credit_scope = excluded.credit_scope,
  weekly_limit = excluded.weekly_limit,
  credits_granted = excluded.credits_granted,
  validity_days = excluded.validity_days,
  ends_in_june = excluded.ends_in_june,
  active = true,
  updated_at = now();

create table if not exists public.customer_entitlements (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(trim(email))),
  offer_code text not null references public.payment_offers(code),
  entitlement_type text not null check (entitlement_type in ('subscription', 'credits')),
  credit_scope text not null,
  weekly_limit integer check (weekly_limit is null or weekly_limit > 0),
  credits_remaining integer check (credits_remaining is null or credits_remaining >= 0),
  status text not null default 'active' check (status in ('active', 'inactive', 'past_due', 'cancelled')),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_entitlements_email_idx
  on public.customer_entitlements (email, status, credit_scope);
create unique index if not exists customer_entitlements_subscription_idx
  on public.customer_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.bookings
  add column if not exists entitlement_id uuid references public.customer_entitlements(id),
  add column if not exists credit_debited integer not null default 0;

alter table public.payment_offers enable row level security;
alter table public.customer_entitlements enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on public.payment_offers from anon, authenticated;
revoke all on public.customer_entitlements from anon, authenticated;
revoke all on public.stripe_webhook_events from anon, authenticated;

-- Empêche l'ancienne fonction publique de confirmer une réservation sans paiement.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reserve_item'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.signature);
  end loop;
end $$;

create or replace function public.reserve_paid_item(
  p_item_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.bookable_items%rowtype;
  v_email text := lower(trim(p_email));
  v_scope text;
  v_entitlement public.customer_entitlements%rowtype;
  v_booking_id uuid;
  v_booked integer;
  v_used_this_week integer;
  v_week_start timestamptz;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Adresse e-mail invalide.';
  end if;

  select * into v_item
  from public.bookable_items
  where id = p_item_id and active = true
  for update;

  if not found then
    raise exception 'Ce créneau n’est plus disponible.';
  end if;

  if exists (
    select 1 from public.bookings
    where item_id = p_item_id and lower(email) = v_email and status = 'confirmed'
  ) then
    raise exception 'Vous avez déjà réservé ce créneau.';
  end if;

  if v_item.starts_at is not null then
    select count(*) into v_booked
    from public.bookings
    where item_id = p_item_id and status = 'confirmed';
    if v_booked >= v_item.capacity then
      raise exception 'Ce créneau est complet.';
    end if;
  end if;

  v_scope := case
    when v_item.category = 'cours' then 'course'
    when v_item.category = 'bilans' and v_item.title ~* 'visio' then 'bilan_visio'
    when v_item.category = 'bilans' then 'bilan_physique'
    else 'event:' || v_item.id::text
  end;

  -- Un abonnement actif est prioritaire pour les cours.
  if v_scope = 'course' then
    select * into v_entitlement
    from public.customer_entitlements
    where email = v_email
      and status = 'active'
      and entitlement_type = 'subscription'
      and credit_scope = 'course'
      and valid_from <= now()
      and (valid_until is null or valid_until > now())
    order by created_at desc
    limit 1
    for update;

    if found and v_entitlement.weekly_limit is not null then
      v_week_start := date_trunc(
        'week', timezone('Europe/Paris', coalesce(v_item.starts_at, now()))
      ) at time zone 'Europe/Paris';

      select count(*) into v_used_this_week
      from public.bookings b
      join public.bookable_items i on i.id = b.item_id
      where lower(b.email) = v_email
        and b.status = 'confirmed'
        and i.category = 'cours'
        and i.starts_at >= v_week_start
        and i.starts_at < v_week_start + interval '7 days';

      if v_used_this_week >= v_entitlement.weekly_limit then
        v_entitlement.id := null;
      end if;
    end if;
  end if;

  -- À défaut d'abonnement disponible, cherche un crédit compatible.
  if v_entitlement.id is null then
    select * into v_entitlement
    from public.customer_entitlements
    where email = v_email
      and status = 'active'
      and entitlement_type = 'credits'
      and credit_scope = v_scope
      and credits_remaining > 0
      and valid_from <= now()
      and (valid_until is null or valid_until > now())
    order by coalesce(valid_until, 'infinity'::timestamptz), created_at
    limit 1
    for update;
  end if;

  if v_entitlement.id is null then
    if v_scope like 'event:%' then
      raise exception 'Le paiement de cet événement n’est pas encore configuré.';
    end if;
    raise exception 'Aucun paiement ou crédit actif trouvé pour cette adresse e-mail.';
  end if;

  insert into public.bookings
    (item_id, first_name, last_name, email, phone, status, entitlement_id, credit_debited)
  values
    (p_item_id, trim(p_first_name), trim(p_last_name), v_email, trim(p_phone), 'confirmed',
     v_entitlement.id, case when v_entitlement.entitlement_type = 'credits' then 1 else 0 end)
  returning id into v_booking_id;

  if v_entitlement.entitlement_type = 'credits' then
    update public.customer_entitlements
    set credits_remaining = credits_remaining - 1,
        status = case when credits_remaining - 1 = 0 then 'inactive' else status end,
        updated_at = now()
    where id = v_entitlement.id;
  end if;

  return v_booking_id;
end;
$$;

revoke all on function public.reserve_paid_item(uuid, text, text, text, text) from public;
grant execute on function public.reserve_paid_item(uuid, text, text, text, text) to anon, authenticated;

create or replace function public.restore_booking_credit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'confirmed' and new.status = 'cancelled'
     and old.credit_debited = 1 and old.entitlement_id is not null then
    update public.customer_entitlements
    set credits_remaining = credits_remaining + 1,
        status = 'active',
        updated_at = now()
    where id = old.entitlement_id;
  end if;
  return new;
end;
$$;

drop trigger if exists restore_credit_after_booking_cancellation on public.bookings;
create trigger restore_credit_after_booking_cancellation
after update of status on public.bookings
for each row execute function public.restore_booking_credit();
