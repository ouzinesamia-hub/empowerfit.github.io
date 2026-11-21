-- Collection POWER: structure autonome, sans altérer abonnements/réservations.
-- Brouillon à relire et tester avant toute application en production.
create table if not exists public.ebook_orders (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  customer_email text not null,
  product_code text not null check (product_code in ('yoga','pilates','fit','pack')),
  amount_total_cents integer not null check (amount_total_cents >= 0),
  currency text not null check (currency = 'eur'),
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending','sending','sent','failed')),
  email_provider_id text,
  delivered_at timestamptz,
  delivery_attempts integer not null default 0,
  last_delivery_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ebook_orders_created_idx on public.ebook_orders(created_at desc);
create index if not exists ebook_orders_customer_idx on public.ebook_orders(customer_email);
alter table public.ebook_orders enable row level security;
-- Aucun accès public aux acheteuses; seul le serveur avec sa clé secrète y accède.
revoke all on public.ebook_orders from anon, authenticated;

create table if not exists public.ebook_webhook_events (
  event_id text primary key,
  event_type text not null,
  stripe_checkout_session_id text,
  processed_at timestamptz not null default now()
);
alter table public.ebook_webhook_events enable row level security;
revoke all on public.ebook_webhook_events from anon, authenticated;

-- Stockage privé de trois PDF ; ne rend jamais un ebook accessible via une URL publique.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('ebooks-empowerfit','ebooks-empowerfit',false,25000000,array['application/pdf'])
on conflict (id) do nothing;
