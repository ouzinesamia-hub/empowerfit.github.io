-- Autorise les événements gratuits sans lien Stripe, tout en conservant Stripe
-- obligatoire pour chaque événement payant.
-- À exécuter après 202608260005_google_calendar.sql.

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
  if p_category = 'events' and p_price_cents > 0 and (
    v_link is null or v_link !~ '^https://buy[.]stripe[.]com/[A-Za-z0-9]+([?].*)?$'
  ) then
    raise exception 'Collez un lien Stripe valide commençant par https://buy.stripe.com/.';
  end if;

  if p_item_id is null then
    insert into public.bookable_items
      (category, location, title, starts_at, duration_minutes, capacity, price_cents, active, payment_link_url)
    values
      (p_category, p_location, trim(p_title), p_starts_at, p_duration_minutes, p_capacity,
       p_price_cents, p_active, case when p_category = 'events' and p_price_cents > 0 then v_link else null end)
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
        payment_link_url = case when p_category = 'events' and p_price_cents > 0 then v_link else null end
    where id = p_item_id
    returning id into v_item_id;

    if v_item_id is null then
      raise exception 'Créneau introuvable.';
    end if;
  end if;

  v_scope := 'event:' || v_item_id::text;

  if p_category = 'events' and p_price_cents > 0 then
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

  -- Un événement explicitement gratuit peut être réservé sans paiement ni crédit.
  if v_item.category = 'events' and v_item.price_cents = 0 then
    insert into public.bookings
      (item_id, first_name, last_name, email, phone, status, entitlement_id, credit_debited)
    values
      (p_item_id, trim(p_first_name), trim(p_last_name), v_email, trim(p_phone),
       'confirmed', null, 0)
    returning id into v_booking_id;

    return v_booking_id;
  end if;

  v_scope := case
    when v_item.category = 'cours' then 'course:' || coalesce(v_item.location, 'brignoles')
    when v_item.category = 'bilans' and v_item.title ~* 'visio' then 'bilan_visio'
    when v_item.category = 'bilans' then 'bilan_physique:' || coalesce(v_item.location, 'brignoles')
    else 'event:' || v_item.id::text
  end;

  if v_scope like 'course:%' then
    select * into v_entitlement
    from public.customer_entitlements
    where email = v_email
      and status = 'active'
      and entitlement_type = 'subscription'
      and credit_scope = v_scope
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
        and coalesce(i.location, 'brignoles') = coalesce(v_item.location, 'brignoles')
        and i.starts_at >= v_week_start
        and i.starts_at < v_week_start + interval '7 days';

      if v_used_this_week >= v_entitlement.weekly_limit then
        v_entitlement.id := null;
      end if;
    end if;
  end if;

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
    raise exception 'Aucun paiement ou crédit actif trouvé pour cette adresse e-mail et ce lieu.';
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
