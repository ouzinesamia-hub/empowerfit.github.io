-- Garantit la présence de la colonne Google Meet et recharge le schéma PostgREST.
-- Cette opération est idempotente et ne supprime aucune donnée.

alter table public.bookable_items
  add column if not exists google_meet_url text;

notify pgrst, 'reload schema';
