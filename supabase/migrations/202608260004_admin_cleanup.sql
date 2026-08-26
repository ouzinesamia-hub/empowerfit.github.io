-- Suppression sécurisée des créneaux et nettoyage des réservations annulées.
-- À exécuter après 202608260003_admin_event_payments.sql.

create or replace function public.admin_delete_bookable_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text := 'event:' || p_item_id::text;
begin
  if not coalesce(public.is_empowerfit_admin(), false) then
    raise exception 'Accès administratrice requis.';
  end if;

  if not exists (select 1 from public.bookable_items where id = p_item_id) then
    raise exception 'Créneau introuvable.';
  end if;

  if exists (
    select 1 from public.bookings
    where item_id = p_item_id and status = 'confirmed'
  ) then
    raise exception 'Impossible de supprimer ce créneau : il possède encore une réservation confirmée. Annulez-la d’abord.';
  end if;

  if exists (
    select 1 from public.customer_entitlements
    where credit_scope = v_scope
      and status in ('active', 'past_due')
      and (valid_until is null or valid_until > now())
  ) then
    raise exception 'Impossible de supprimer cet événement : un paiement actif lui est associé. Masquez-le plutôt.';
  end if;

  delete from public.bookings
  where item_id = p_item_id and status = 'cancelled';

  update public.payment_offers
  set active = false, updated_at = now()
  where credit_scope = v_scope;

  delete from public.bookable_items
  where id = p_item_id;
end;
$$;

revoke all on function public.admin_delete_bookable_item(uuid) from public;
grant execute on function public.admin_delete_bookable_item(uuid) to authenticated;

create or replace function public.admin_delete_cancelled_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_empowerfit_admin(), false) then
    raise exception 'Accès administratrice requis.';
  end if;

  delete from public.bookings
  where id = p_booking_id and status = 'cancelled';

  if not found then
    raise exception 'Réservation annulée introuvable.';
  end if;
end;
$$;

revoke all on function public.admin_delete_cancelled_booking(uuid) from public;
grant execute on function public.admin_delete_cancelled_booking(uuid) to authenticated;

create or replace function public.admin_purge_cancelled_bookings()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not coalesce(public.is_empowerfit_admin(), false) then
    raise exception 'Accès administratrice requis.';
  end if;

  delete from public.bookings
  where status = 'cancelled';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_purge_cancelled_bookings() from public;
grant execute on function public.admin_purge_cancelled_bookings() to authenticated;
