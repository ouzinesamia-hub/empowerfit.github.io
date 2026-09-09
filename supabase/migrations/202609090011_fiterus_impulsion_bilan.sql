-- Bilan préalable obligatoire à tarif préférentiel pour FITÉRUS Impulsion.
-- À exécuter après 202609040010_fiterus_programs.sql.

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
    'Bilan préalable FITÉRUS Impulsion',
    'https://buy.stripe.com/5kQ9AS3GHgEO2Zy1qD63K0n',
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
