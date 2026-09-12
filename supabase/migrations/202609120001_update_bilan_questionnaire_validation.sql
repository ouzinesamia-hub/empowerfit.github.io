-- Ajustements du questionnaire bilan visio : Q15 multi-sélection et détail Q20.

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
    'q1','q2','q3','q4','q5',
    'q6','q7','q8','q9','q10',
    'q11','q12','q13','q14','q15',
    'q16','q17','q18','q19','q20',
    'q22','q23','q24','q25'
  ];
  v_reasons text[] := array[]::text[];
  v_q15_choices jsonb := coalesce(p_answers->'q15'->'choices', '[]'::jsonb);
  v_q17 text := coalesce(p_answers->>'q17', '');
  v_q18 text := coalesce(p_answers->>'q18', '');
  v_q20 text := coalesce(p_answers->>'q20', '');
  v_q20_detail text := coalesce(p_answers->>'q20_detail', '');
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
    if not (p_answers ? v_key)
       or p_answers->v_key in ('null'::jsonb, '""'::jsonb) then
      raise exception 'Le questionnaire est incomplet.';
    end if;
  end loop;

  if jsonb_typeof(v_q15_choices) is distinct from 'array'
     or jsonb_array_length(v_q15_choices) = 0 then
    raise exception 'La question 15 doit comporter au moins une réponse.';
  end if;

  if ((v_q15_choices ? 'Grossesse') or (v_q15_choices ? 'Post-partum'))
     and (not (p_answers ? 'q21') or v_q21 = '') then
    raise exception 'La précision grossesse ou post-partum est requise.';
  end if;

  if v_q20 = 'Oui' and btrim(v_q20_detail) = '' then
    raise exception 'La description du traitement est requise.';
  end if;

  select b.id
  into v_booking_id
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
    select 1
    from public.bilan_questionnaire_responses
    where booking_id = v_booking_id
  ) then
    raise exception 'Ce questionnaire a déjà été transmis.';
  end if;

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
    booking_id,
    answers,
    consent_accuracy,
    consent_use,
    consent_scope,
    marketing_opt_in,
    requires_human_review,
    review_reasons
  ) values (
    v_booking_id,
    p_answers,
    true,
    true,
    true,
    coalesce(p_marketing_opt_in, false),
    cardinality(v_reasons) > 0,
    to_jsonb(v_reasons)
  );
end;
$$;
