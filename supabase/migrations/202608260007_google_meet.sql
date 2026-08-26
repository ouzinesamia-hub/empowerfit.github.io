-- Mémorise le lien Google Meet unique généré pour un créneau visio réservé.
-- À exécuter après 202608260006_free_events.sql.

alter table public.bookable_items
  add column if not exists google_meet_url text;

comment on column public.bookable_items.google_meet_url is
  'Lien Google Meet unique du créneau visio, généré par la synchronisation Google Agenda.';
