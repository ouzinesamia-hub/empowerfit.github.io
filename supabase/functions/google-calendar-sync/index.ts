import { withSupabase } from 'jsr:@supabase/server@^1'

const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID')
const serviceAccountEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')
const privateKeyPem = (Deno.env.get('GOOGLE_PRIVATE_KEY') || '').replace(/\\n/g, '\n')

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

async function patchEvent(eventId: string, body: Record<string, unknown>) {
  const response = await googleRequest(`events/${encodeURIComponent(eventId)}`, {
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

async function syncItem(db: any, itemId: string) {
  const { data: item, error: itemError } = await db
    .from('bookable_items')
    .select('id,title,starts_at,duration_minutes,capacity,location,google_event_id')
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
  if (!item.starts_at) return { itemId, action: 'sans date' }

  const start = new Date(item.starts_at)
  const end = new Date(start.getTime() + Number(item.duration_minutes) * 60_000)
  const event = {
    summary: booked
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
    if (response.ok) return { itemId, action: 'mis à jour' }
  }

  if (!booked) return { itemId, action: 'aucune réservation' }

  const response = await googleRequest('events', {
    method: 'POST',
    body: JSON.stringify(event),
  })
  const created = await response.json()
  if (!response.ok || !created.id) {
    console.error(created)
    throw new Error(`Création Google Agenda impossible (${response.status}).`)
  }

  const { error } = await db
    .from('bookable_items')
    .update({ google_event_id: created.id })
    .eq('id', itemId)
  if (error) throw error
  return { itemId, action: 'créé' }
}

export default {
  fetch: withSupabase({ auth: ['secret'] }, async (request, ctx) => {
    if (request.method !== 'POST') return json({ error: 'Méthode refusée.' }, 405)

    try {
      const payload = await request.json()
      const table = payload.table
      const type = payload.type
      const record = payload.record || null
      const oldRecord = payload.old_record || null

      if (!['bookings', 'bookable_items'].includes(table)) {
        return json({ error: 'Table non prise en charge.' }, 400)
      }

      if (table === 'bookable_items' && type === 'UPDATE') {
        const relevant = ['title', 'starts_at', 'duration_minutes', 'capacity', 'location']
        const changed = relevant.some((key) => record?.[key] !== oldRecord?.[key])
        if (!changed) return json({ received: true, ignored: true })
      }

      if (table === 'bookable_items' && type === 'DELETE') {
        if (oldRecord?.google_event_id) {
          await deleteEvent(oldRecord.google_event_id)
        }
        return json({ received: true, action: 'supprimé de Google Agenda' })
      }

      const ids = new Set<string>()
      if (table === 'bookings') {
        if (record?.item_id) ids.add(record.item_id)
        if (oldRecord?.item_id) ids.add(oldRecord.item_id)
      } else if (record?.id) {
        ids.add(record.id)
      }

      const results = []
      for (const id of ids) results.push(await syncItem(ctx.supabaseAdmin, id))
      return json({ received: true, results })
    } catch (error) {
      console.error(error)
      return json({ error: error instanceof Error ? error.message : 'Synchronisation impossible.' }, 500)
    }
  }),
}
