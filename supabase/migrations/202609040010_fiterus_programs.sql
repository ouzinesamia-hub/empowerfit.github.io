-- Offres digitales FITÉRUS et limitation automatique des paiements échelonnés.
-- À exécuter après 202608290009_bilan_questionnaire.sql.

alter table public.payment_offers
  add column if not exists billing_cycles smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_offers_billing_cycles_check'
      and conrelid = 'public.payment_offers'::regclass
  ) then
    alter table public.payment_offers
      add constraint payment_offers_billing_cycles_check
      check (billing_cycles is null or billing_cycles between 1 and 24);
  end if;
end
$$;

insert into public.payment_offers
  (code, title, payment_link_url, entitlement_type, credit_scope,
   weekly_limit, credits_granted, validity_days, ends_in_june, billing_cycles)
values
  (
    'fiterus_impulsion',
    'FITÉRUS Impulsion — Programme 8 semaines',
    'https://buy.stripe.com/aFa4gydhh88ias0c5h63K0m',
    'credits',
    'program:fiterus_impulsion',
    null,
    1,
    56,
    false,
    null
  ),
  (
    'fiterus_revolution_full',
    'FITÉRUS Révolution — Paiement comptant',
    'https://buy.stripe.com/14A7sK0uvagq8jSglx63K0k',
    'credits',
    'program:fiterus_revolution',
    null,
    1,
    93,
    false,
    null
  ),
  (
    'fiterus_revolution_3x',
    'FITÉRUS Révolution — 3 mensualités',
    'https://buy.stripe.com/3cI00ib9988idEc9X963K0l',
    'subscription',
    'program:fiterus_revolution',
    null,
    null,
    null,
    false,
    3
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
  active = true;

