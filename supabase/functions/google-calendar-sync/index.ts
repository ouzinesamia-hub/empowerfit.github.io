import { withSupabase } from 'jsr:@supabase/server@^1'

const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID')
const serviceAccountEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')
const privateKeyPem = (Deno.env.get('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n')
const meetWebAppUrl = Deno.env.get('GOOGLE_MEET_WEBAPP_URL')
const meetWebhookSecret = Deno.env.get('GOOGLE_MEET_WEBHOOK_SECRET')

if (!calendarId || !serviceAccountEmail || !privateKeyPem) {
  throw new Error('Configuration Google Agenda incomplète.')
}

const encoder = new TextEncoder()
let cachedToken: { value: string; expiresAt: number } | null = null

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function googleAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const pem = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const raw = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    raw,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(JSON.stringify({
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now - 30,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claims}`
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(unsigned),
  ))

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) {
    console.error(data)
    throw new Error('Authentification Google Agenda impossible.')
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  }
  return cachedToken.value
}

async function googleRequest(path: string, init: RequestInit = {}) {
  const token = await googleAccessToken()
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId!)}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

const placeLabel = (value: string | null) =>
  value === 'aix' ? 'Aix-en-Provence' : value === 'visio' ? 'En visio' : 'Brignoles'

async function patchEvent(
  eventId: string,
  body: Record<string, unknown>,
  conferenceDataVersion = false,
) {
  const suffix = conferenceDataVersion ? '?conferenceDataVersion=1' : ''
  const response = await googleRequest(`events/${encodeURIComponent(eventId)}${suffix}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    console.error(await response.text())
    throw new Error(`Mise à jour Google Agenda impossible (${response.status}).`)
  }
  return response
}

async function deleteEvent(eventId: string) {
  const response = await googleRequest(`events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    console.error(await response.text())
    throw new Error(`Suppression Google Agenda impossible (${response.status}).`)
  }
}

async function callGoogleBridge(payload: Record<string, unknown>) {
  if (!meetWebAppUrl || !meetWebhookSecret) {
    throw new Error('Configuration du pont Google Meet incomplète.')
  }

  const response = await fetch(meetWebAppUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      secret: meetWebhookSecret,
      ...payload,
    }),
  })
  const raw = await response.text()
  let data: {
    ok?: boolean
    meetUrl?: string | null
    emailSent?: boolean
    error?: string
  } = {}
  try {
    data = JSON.parse(raw)
  } catch {
    console.error(raw)
    throw new Error('Réponse illisible du pont Google Meet.')
  }

  if (!response.ok || !data.ok) {
    console.error(data)
    throw new Error(data.error || 'Appel du pont Google impossible.')
  }
  return data
}

async function createMeetForEvent(eventId: string) {
  const data = await callGoogleBridge({ action: 'create_meet', eventId })
  if (!data.meetUrl) throw new Error('Création Google Meet impossible.')
  return data.meetUrl
}

async function sendBookingEmail(
  db: any,
  booking: Record<string, any>,
  action: 'send_confirmation' | 'send_cancellation',
) {
  if (!booking?.item_id || !booking?.email) return false

  const { data: item, error } = await db
    .from('bookable_items')
    .select('title,starts_at,duration_minutes,location,google_meet_url')
    .eq('id', booking.item_id)
    .maybeSingle()
  if (error) throw error
  if (!item) return false

  const result = await callGoogleBridge({
    action,
    to: String(booking.email).trim().toLowerCase(),
    firstName: booking.first_name || '',
    title: item.title,
    startsAt: item.starts_at,
    durationMinutes: item.duration_minutes,
    locationLabel: placeLabel(item.location),
    meetUrl: action === 'send_confirmation' ? item.google_meet_url : null,
  })
  if (result.emailSent !== true) {
    throw new Error('Google a répondu sans confirmer l’envoi de l’e-mail.')
  }
  return true
}

async function syncItem(db: any, itemId: string) {
  const { data: item, error: itemError } = await db
    .from('bookable_items')
    .select('id,title,starts_at,duration_minutes,capacity,location,active,google_event_id,google_meet_url')
    .eq('id', itemId)
    .maybeSingle()
  if (itemError) throw itemError
  if (!item) return { itemId, action: 'absent' }

  const { count, error: countError } = await db
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', itemId)
    .eq('status', 'confirmed')
  if (countError) throw countError

  const booked = count || 0
  if (!item.active) {
    if (item.google_event_id) {
      await deleteEvent(item.google_event_id)
      const { error } = await db
        .from('bookable_items')
        .update({ google_event_id: null, google_meet_url: null })
        .eq('id', itemId)
      if (error) throw error
    }
    return { itemId, action: 'masqué' }
  }
  if (!item.starts_at) return { itemId, action: 'sans date' }

  const start = new Date(item.starts_at)
  const end = new Date(start.getTime() + Number(item.duration_minutes) * 60_000)
  const showAvailability = item.location === 'visio'
  const needsMeet = item.location === 'visio' && booked > 0
  const event: Record<string, unknown> = {
    summary: showAvailability
      ? booked
        ? `Réservé · ${item.title}`
        : `Disponible · ${item.title}`
      : booked
      ? `${item.title} · ${booked}/${item.capacity}`
      : `Sans inscription · ${item.title}`,
    description: booked
      ? `${booked} réservation${booked > 1 ? 's' : ''} confirmée${booked > 1 ? 's' : ''}. Les coordonnées restent uniquement dans l’administration EMPOWERFIT.`
      : 'Aucune réservation confirmée.',
    location: placeLabel(item.location),
    start: { dateTime: start.toISOString(), timeZone: 'Europe/Paris' },
    end: { dateTime: end.toISOString(), timeZone: 'Europe/Paris' },
    transparency: booked ? 'opaque' : 'transparent',
    extendedProperties: { private: { empowerfit_item_id: item.id } },
  }

  if (item.google_event_id) {
    const response = await patchEvent(item.google_event_id, event)

    if (response.ok) {
      let meetUrl = item.google_meet_url || null
      if (needsMeet && !meetUrl) meetUrl = await createMeetForEvent(item.google_event_id)
      if (meetUrl !== (item.google_meet_url || null)) {
        const { error } = await db
          .from('bookable_items')
          .update({ google_meet_url: meetUrl })
          .eq('id', itemId)
        if (error) throw error
      }
      return {
        itemId,
        action: needsMeet && meetUrl ? 'mis à jour avec Google Meet' : 'mis à jour',
        googleMeet: Boolean(meetUrl),
      }
    }
  }

  if (!booked && !showAvailability) return { itemId, action: 'aucune réservation' }

  const response = await googleRequest('events', {
    method: 'POST',
    body: JSON.stringify(event),
  })
  const created = await response.json()

  if (!response.ok || !created.id) {
    console.error(created)
    throw new Error(`Création Google Agenda impossible (${response.status}).`)
  }

  const meetUrl = needsMeet ? await createMeetForEvent(created.id) : null
  const { error } = await db
    .from('bookable_items')
    .update({ google_event_id: created.id, google_meet_url: meetUrl })
    .eq('id', itemId)
  if (error) throw error
  return {
    itemId,
    action: needsMeet && meetUrl ? 'créé avec Google Meet' : 'créé',
    googleMeet: Boolean(meetUrl),
  }
}

async function syncAvailableVisio(db: any) {
  const { data, error } = await db
    .from('bookable_items')
    .select('id')
    .eq('location', 'visio')
    .eq('active', true)
    .gt('starts_at', new Date().toISOString())
    .order('starts_at')
  if (error) throw error

  const results = []
  for (const item of data || []) results.push(await syncItem(db, item.id))
  return { received: true, synchronized: results.length, results }
}

async function processWebhook(db: any, payload: Record<string, any>) {
  if (payload.action === 'sync_available_visio') return syncAvailableVisio(db)

  const table = payload.table
  const type = String(payload.type || '').toUpperCase()
  const record = payload.record || null
  const oldRecord = payload.old_record || null

  if (!['bookings', 'bookable_items'].includes(table)) {
    throw new Error('Table non prise en charge.')
  }

  if (table === 'bookable_items' && type === 'UPDATE') {
    const relevant = ['title', 'starts_at', 'duration_minutes', 'capacity', 'location', 'active']
    const changed = relevant.some((key) => record?.[key] !== oldRecord?.[key])
    if (!changed) return { received: true, ignored: true }
  }

  if (table === 'bookable_items' && type === 'DELETE') {
    if (oldRecord?.google_event_id) await deleteEvent(oldRecord.google_event_id)
    return { received: true, action: 'supprimé de Google Agenda' }
  }

  const ids = new Set<string>()
  if (table === 'bookings') {
    if (record?.item_id) ids.add(record.item_id)
    if (oldRecord?.item_id) ids.add(oldRecord.item_id)
  } else if (record?.id) {
    ids.add(record.id)
  }

  const results = []
  for (const id of ids) results.push(await syncItem(db, id))

  if (
    table === 'bookable_items' && type === 'UPDATE' &&
    (record?.location === 'visio' || oldRecord?.location === 'visio')
  ) {
    const availabilitySync = await syncAvailableVisio(db)
    return { received: true, results, availabilitySync }
  }

  let email: 'confirmation envoyée' | 'annulation envoyée' | 'non envoyé' | null = null
  if (table === 'bookings' && type !== 'DELETE' && record) {
    const statusChanged = type === 'INSERT' || !oldRecord ||
      record.status !== oldRecord.status
    const emailAction = record.status === 'confirmed'
      ? 'send_confirmation'
      : record.status === 'cancelled'
      ? 'send_cancellation'
      : null

    if (statusChanged && emailAction) {
      try {
        const sent = await sendBookingEmail(db, record, emailAction)
        email = sent
          ? emailAction === 'send_confirmation' ? 'confirmation envoyée' : 'annulation envoyée'
          : 'non envoyé'
        console.log('E-mail EMPOWERFIT', {
          bookingId: record.id || null,
          action: emailAction,
          result: email,
        })
      } catch (error) {
        console.error('E-mail EMPOWERFIT non envoyé', error)
        email = 'non envoyé'
      }
    }
  }

  return { received: true, results, email }
}

export default {
  fetch: withSupabase({ auth: ['secret'] }, async (request, ctx) => {
    if (request.method !== 'POST') return json({ error: 'Méthode refusée.' }, 405)

    try {
      const payload = await request.json()
      console.log('Traitement EMPOWERFIT démarré', {
        table: payload?.table || null,
        type: payload?.type || null,
      })
      const result = await processWebhook(ctx.supabaseAdmin, payload)
      console.log('Traitement EMPOWERFIT terminé', result)
      return json(result)
    } catch (error) {
      console.error('Traitement EMPOWERFIT impossible', error)
      return json({ error: error instanceof Error ? error.message : 'Requête invalide.' }, 500)
    }
  }),
}
