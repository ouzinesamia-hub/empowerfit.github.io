-- Gestion autonome et sécurisée des événements payants depuis l'administration.
-- À exécuter après 202608260002_aix_offers.sql.

alter table public.bookable_items
  add column if not exists payment_link_url text;

update public.bookable_items i
set payment_link_url = o.payment_link_url
from public.payment_offers o
where i.category = 'events'
  and o.credit_scope = 'event:' || i.id::text
  and i.payment_link_url is distinct from o.payment_link_url;

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
  payment_link_url text,
  booked bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    i.id, i.category, i.title, i.starts_at, i.duration_minutes,
    i.capacity, i.price_cents, i.location, i.payment_link_url,
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

create or replace function public.admin_upsert_bookable_item(
  p_item_id uuid,
  p_category text,
  p_location text,
  p_title text,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_capacity integer,
  p_price_cents integer,
  p_active boolean,
  p_payment_link_url text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_id uuid;
  v_scope text;
  v_offer_code text;
  v_link text := nullif(trim(coalesce(p_payment_link_url, '')), '');
begin
  if not coalesce(public.is_empowerfit_admin(), false) then
    raise exception 'Accès administratrice requis.';
  end if;

  if p_category not in ('cours', 'bilans', 'events') then
    raise exception 'Type de créneau invalide.';
  end if;
  if p_location not in ('aix', 'brignoles', 'visio') then
    raise exception 'Lieu invalide.';
  end if;
  if trim(coalesce(p_title, '')) = '' then
    raise exception 'Le nom est obligatoire.';
  end if;
  if p_duration_minutes < 10 or p_capacity < 1 or p_price_cents < 0 then
    raise exception 'Durée, capacité ou tarif invalide.';
  end if;
  if p_category = 'events' and p_starts_at is null then
    raise exception 'La date et l’heure sont obligatoires pour un événement.';
  end if;
  if p_category = 'events' and (
    v_link is null or v_link !~ '^https://buy[.]stripe[.]com/[A-Za-z0-9]+([?].*)?$'
  ) then
    raise exception 'Collez un lien Stripe valide commençant par https://buy.stripe.com/.';
  end if;

  if p_item_id is null then
    insert into public.bookable_items
      (category, location, title, starts_at, duration_minutes, capacity, price_cents, active, payment_link_url)
    values
      (p_category, p_location, trim(p_title), p_starts_at, p_duration_minutes, p_capacity,
       p_price_cents, p_active, case when p_category = 'events' then v_link else null end)
    returning id into v_item_id;
  else
    update public.bookable_items
    set category = p_category,
        location = p_location,
        title = trim(p_title),
        starts_at = p_starts_at,
        duration_minutes = p_duration_minutes,
        capacity = p_capacity,
        price_cents = p_price_cents,
        active = p_active,
        payment_link_url = case when p_category = 'events' then v_link else null end
    where id = p_item_id
    returning id into v_item_id;

    if v_item_id is null then
      raise exception 'Créneau introuvable.';
    end if;
  end if;

  v_scope := 'event:' || v_item_id::text;

  if p_category = 'events' then
    select code into v_offer_code
    from public.payment_offers
    where credit_scope = v_scope
    limit 1;

    v_offer_code := coalesce(v_offer_code, 'event_' || replace(v_item_id::text, '-', ''));

    insert into public.payment_offers
      (code, title, payment_link_url, entitlement_type, credit_scope,
       weekly_limit, credits_granted, validity_days, ends_in_june, active, updated_at)
    values
      (v_offer_code, 'Événement – ' || trim(p_title), v_link, 'credits', v_scope,
       null, 1, null, false, p_active, now())
    on conflict (code) do update set
      title = excluded.title,
      payment_link_url = excluded.payment_link_url,
      entitlement_type = 'credits',
      credit_scope = excluded.credit_scope,
      weekly_limit = null,
      credits_granted = 1,
      validity_days = null,
      ends_in_june = false,
      active = excluded.active,
      updated_at = now();
  else
    update public.payment_offers
    set active = false, updated_at = now()
    where credit_scope = v_scope;
  end if;

  return v_item_id;
exception
  when unique_violation then
    raise exception 'Ce lien Stripe est déjà associé à une autre offre ou un autre événement.';
end;
$$;

revoke all on function public.admin_upsert_bookable_item(
  uuid, text, text, text, timestamptz, integer, integer, integer, boolean, text
) from public;
grant execute on function public.admin_upsert_bookable_item(
  uuid, text, text, text, timestamptz, integer, integer, integer, boolean, text
) to authenticated;

create or replace function public.admin_set_bookable_item_active(
  p_item_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_empowerfit_admin(), false) then
    raise exception 'Accès administratrice requis.';
  end if;

  update public.bookable_items
  set active = p_active
  where id = p_item_id;

  if not found then
    raise exception 'Créneau introuvable.';
  end if;

  update public.payment_offers
  set active = p_active, updated_at = now()
  where credit_scope = 'event:' || p_item_id::text;
end;
$$;

revoke all on function public.admin_set_bookable_item_active(uuid, boolean) from public;
grant execute on function public.admin_set_bookable_item_active(uuid, boolean) to authenticated;
