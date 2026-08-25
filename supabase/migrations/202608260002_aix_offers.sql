-- Ajoute les offres Aix et sépare les droits de réservation par ville.
-- À exécuter dans le SQL Editor Supabase après 202608250001_stripe_entitlements.sql.

update public.payment_offers
set credit_scope = case code
  when 'start_ten' then 'course:brignoles'
  when 'serenity' then 'course:brignoles'
  when 'balance' then 'course:brignoles'
  when 'infinity' then 'course:brignoles'
  when 'trial' then 'course:brignoles'
  when 'card_10' then 'course:brignoles'
  when 'bilan_physique' then 'bilan_physique:brignoles'
  else credit_scope
end
where code in ('start_ten','serenity','balance','infinity','trial','card_10','bilan_physique');

update public.customer_entitlements
set credit_scope = case offer_code
  when 'start_ten' then 'course:brignoles'
  when 'serenity' then 'course:brignoles'
  when 'balance' then 'course:brignoles'
  when 'infinity' then 'course:brignoles'
  when 'trial' then 'course:brignoles'
  when 'card_10' then 'course:brignoles'
  when 'bilan_physique' then 'bilan_physique:brignoles'
  else credit_scope
end
where offer_code in ('start_ten','serenity','balance','infinity','trial','card_10','bilan_physique');

insert into public.payment_offers
  (code, title, payment_link_url, entitlement_type, credit_scope, weekly_limit, credits_granted, validity_days, ends_in_june)
values
  ('aix_bilan_physique', 'Bilan physique 90 min – Aix', 'https://buy.stripe.com/14A7sKdhhcoy1Vu5GT63K02', 'credits', 'bilan_physique:aix', null, 1, null, false),
  ('aix_trial', 'Séance d’essai – Aix', 'https://buy.stripe.com/6oUdR8fppcoy8jS2uH63K03', 'credits', 'course:aix', null, 1, null, false),
  ('aix_card_10', 'Carte 10 cours – Aix', 'https://buy.stripe.com/28E4gydhhbkudEc4CP63K04', 'credits', 'course:aix', null, 10, 90, false),
  ('aix_serenity', 'SERENITY – Aix', 'https://buy.stripe.com/14A9AS0uv9cmeIg7P163K0h', 'subscription', 'course:aix', 2, null, null, false),
  ('aix_balance', 'BALANCE – Aix', 'https://buy.stripe.com/5kQ9AScdd1JUfMkc5h63K0i', 'subscription', 'course:aix', 3, null, null, false),
  ('aix_infinity', 'INFINITY – Aix', 'https://buy.stripe.com/28E7sK7WXcoyas0c5h63K0j', 'subscription', 'course:aix', null, null, null, false)
on conflict (code) do update set
  title = excluded.title,
  payment_link_url = excluded.payment_link_url,
  entitlement_type = excluded.entitlement_type,
  credit_scope = excluded.credit_scope,
  weekly_limit = excluded.weekly_limit,
  credits_granted = excluded.credits_granted,
  validity_days = excluded.validity_days,
  ends_in_june = excluded.ends_in_june,
  active = true;

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
