-- Questionnaire préalable sécurisé du bilan visio EMPOWERFIT.
-- À exécuter après 202608270008_google_meet_schema_refresh.sql.

create extension if not exists pgcrypto;

alter table public.bookings
  add column if not exists questionnaire_access_token uuid not null default gen_random_uuid();

create unique index if not exists bookings_questionnaire_access_token_key
  on public.bookings (questionnaire_access_token);

create table if not exists public.bilan_questionnaire_responses (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  consent_accuracy boolean not null,
  consent_use boolean not null,
  consent_scope boolean not null,
  marketing_opt_in boolean not null default false,
  requires_human_review boolean not null default false,
  review_reasons jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now()
);

comment on table public.bilan_questionnaire_responses is
  'Réponses sensibles au questionnaire préalable du bilan visio. Lecture réservée à l’administratrice.';

alter table public.bilan_questionnaire_responses enable row level security;
revoke all on public.bilan_questionnaire_responses from public, anon, authenticated;
grant select on public.bilan_questionnaire_responses to authenticated;

drop policy if exists "Administratrice : lire les questionnaires" on public.bilan_questionnaire_responses;
create policy "Administratrice : lire les questionnaires"
  on public.bilan_questionnaire_responses
  for select
  to authenticated
  using (coalesce(public.is_empowerfit_admin(), false));

-- Après une réservation réussie, le navigateur échange l'identifiant de réservation
-- contre le lien personnel. L'e-mail est vérifié une seconde fois.
create or replace function public.get_bilan_questionnaire_token(
  p_booking_id uuid,
  p_email text
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select b.questionnaire_access_token
  from public.bookings b
  join public.bookable_items i on i.id = b.item_id
  where b.id = p_booking_id
    and b.status = 'confirmed'
    and lower(b.email) = lower(trim(p_email))
    and i.category = 'bilans'
    and i.location = 'visio'
  limit 1;
$$;

revoke all on function public.get_bilan_questionnaire_token(uuid, text) from public;
grant execute on function public.get_bilan_questionnaire_token(uuid, text) to anon, authenticated;

-- Le lien personnel n'expose que le strict nécessaire : prénom, rendez-vous et état d'envoi.
create or replace function public.get_bilan_questionnaire_context(
  p_access_token uuid
)
returns table (
  first_name text,
  title text,
  starts_at timestamptz,
  already_submitted boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    b.first_name,
    i.title,
    i.starts_at,
    exists (
      select 1 from public.bilan_questionnaire_responses r
      where r.booking_id = b.id
    )
  from public.bookings b
  join public.bookable_items i on i.id = b.item_id
  where b.questionnaire_access_token = p_access_token
    and b.status = 'confirmed'
    and i.category = 'bilans'
    and i.location = 'visio'
  limit 1;
$$;

revoke all on function public.get_bilan_questionnaire_context(uuid) from public;
grant execute on function public.get_bilan_questionnaire_context(uuid) to anon, authenticated;

create or replace function public.submit_bilan_questionnaire(
  p_access_token uuid,
  p_answers jsonb,
  p_consent_accuracy boolean,
  p_consent_use boolean,
  p_consent_scope boolean,
  p_marketing_opt_in boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking_id uuid;
  v_key text;
  v_required_keys text[] := array[
    'q1','q2','q3','q4','q5','q6','q7','q8','q9','q10',
    'q11','q12','q13','q14','q15','q16','q17','q18','q19','q20',
    'q22','q23','q24','q25'
  ];
  v_reasons text[] := array[]::text[];
  v_q15 text := coalesce(p_answers->>'q15', '');
  v_q17 text := coalesce(p_answers->>'q17', '');
  v_q18 text := coalesce(p_answers->>'q18', '');
  v_q20 text := coalesce(p_answers->>'q20', '');
  v_q21 text := coalesce(p_answers->>'q21', '');
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'Réponses invalides.';
  end if;

  if not coalesce(p_consent_accuracy, false)
     or not coalesce(p_consent_use, false)
     or not coalesce(p_consent_scope, false) then
    raise exception 'Les trois confirmations obligatoires doivent être acceptées.';
  end if;

  foreach v_key in array v_required_keys loop
    if not (p_answers ? v_key) or p_answers->v_key in ('null'::jsonb, '""'::jsonb) then
      raise exception 'Le questionnaire est incomplet.';
    end if;
  end loop;

  if (v_q15 in ('Grossesse', 'Post-partum'))
     and (not (p_answers ? 'q21') or v_q21 = '') then
    raise exception 'La précision grossesse ou post-partum est requise.';
  end if;

  select b.id into v_booking_id
  from public.bookings b
  join public.bookable_items i on i.id = b.item_id
  where b.questionnaire_access_token = p_access_token
    and b.status = 'confirmed'
    and i.category = 'bilans'
    and i.location = 'visio'
  for update of b;

  if v_booking_id is null then
    raise exception 'Ce lien personnel est invalide ou n’est plus actif.';
  end if;

  if exists (
    select 1 from public.bilan_questionnaire_responses
    where booking_id = v_booking_id
  ) then
    raise exception 'Ce questionnaire a déjà été transmis.';
  end if;

  -- Ces indicateurs imposent seulement une lecture humaine avant le rendez-vous.
  -- Ils ne constituent jamais un avis médical ni une décision automatique d'aptitude.
  if p_answers->'q16'->>'pain' = 'Oui' then
    v_reasons := array_append(v_reasons, 'Douleur ou gêne actuelle');
  end if;
  if v_q17 like 'Oui%' then
    v_reasons := array_append(v_reasons, 'Blessure, opération ou hospitalisation récente');
  end if;
  if v_q18 like 'Oui%' or v_q18 = 'Je ne sais pas' then
    v_reasons := array_append(v_reasons, 'Consigne médicale à vérifier');
  end if;
  if jsonb_typeof(p_answers->'q19'->'choices') = 'array'
     and not ((p_answers->'q19'->'choices') ? 'Aucun de ces symptômes') then
    v_reasons := array_append(v_reasons, 'Symptôme récent à vérifier');
  end if;
  if v_q20 <> 'Non' then
    v_reasons := array_append(v_reasons, 'Traitement ou effet à vérifier');
  end if;
  if v_q21 in ('Je suis enceinte', 'J’ai accouché il y a moins de 3 mois') then
    v_reasons := array_append(v_reasons, 'Grossesse ou post-partum récent');
  end if;

  insert into public.bilan_questionnaire_responses (
    booking_id, answers, consent_accuracy, consent_use, consent_scope,
    marketing_opt_in, requires_human_review, review_reasons
  ) values (
    v_booking_id, p_answers, true, true, true,
    coalesce(p_marketing_opt_in, false),
    cardinality(v_reasons) > 0,
    to_jsonb(v_reasons)
  );
end;
$$;

revoke all on function public.submit_bilan_questionnaire(
  uuid, jsonb, boolean, boolean, boolean, boolean
) from public;
grant execute on function public.submit_bilan_questionnaire(
  uuid, jsonb, boolean, boolean, boolean, boolean
) to anon, authenticated;

notify pgrst, 'reload schema';
