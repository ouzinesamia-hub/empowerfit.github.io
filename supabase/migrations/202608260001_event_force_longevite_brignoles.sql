-- Associe le paiement Stripe à l'atelier Force & longévité de Brignoles.
insert into public.payment_offers
  (code, title, payment_link_url, entitlement_type, credit_scope, weekly_limit, credits_granted, validity_days, ends_in_june, active)
values
  (
    'event_force_longevite_brignoles_2026_09_13',
    'Atelier Force & longévité – Brignoles – 13 septembre 2026',
    'https://buy.stripe.com/00w00idhh1JU9nW4CP63K0g',
    'credits',
    'event:e8b4677b-0d39-47ae-9d85-334f74a93d84',
    null,
    1,
    null,
    false,
    true
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
  active = excluded.active,
  updated_at = now();
