-- Synchronisation des créneaux réservés avec Google Agenda.
-- À exécuter après 202608260004_admin_cleanup.sql.

alter table public.bookable_items
  add column if not exists google_event_id text;

create unique index if not exists bookable_items_google_event_id_key
  on public.bookable_items (google_event_id)
  where google_event_id is not null;
