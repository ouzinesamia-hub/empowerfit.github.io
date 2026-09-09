-- Regroupe le bilan préalable et le programme FITÉRUS Impulsion en un paiement unique de 127 €.
-- Le droit bilan_visio confirme automatiquement le créneau choisi après le paiement.

insert into public.payment_offers
  (
    code,
    title,
    payment_link_url,
    entitlement_type,
    credit_scope,
    weekly_limit,
    credits_granted,
    validity_days,
    ends_in_june,
    billing_cycles
  )
values
  (
    'fiterus_impulsion_bilan',
    'FITÉRUS Impulsion — Bilan préalable + programme 8 semaines',
    'https://buy.stripe.com/fZu7sK6STcoy43Cc5h63K0o',
    'credits',
    'bilan_visio',
    null,
    1,
    null,
    false,
    null
  )
on conflict (code) do update set
  title = excluded.title,
  payment_link_url = excluded.payment_link_url,
  entitlement_type = excluded.entitlement_type,
  credit_scope = excluded.credit_scope,
  weekly_limit = excluded.weekly_limit,
  credits_granted = excluded.credits_granted,
  validity_days = excluded.validity_days,
  ends_in_june = excluded.ends_in_june,
  billing_cycles = excluded.billing_cycles,
  active = true,
  updated_at = now();

update public.payment_offers
set active = false,
    updated_at = now()
where code = 'fiterus_impulsion';
