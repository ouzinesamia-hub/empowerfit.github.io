// EMPOWERFIT Collection POWER — accès immédiat après paiement Stripe.
// À déployer avec verify_jwt = false : le jeton de capacité est l'identifiant
// non devinable de la Checkout Session, validé directement auprès de Stripe.
// Ne pas publier la page de vente avant d'avoir créé les 4 prix Stripe et testé le flux.
import Stripe from 'npm:stripe@22.0.0'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || secretKeys.default
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const allowedOrigins = [
  'https://www.empowerfit-studio.fr',
  'https://empowerfit-studio.fr',
  'https://ouzinesamia-hub.github.io',
]

const catalog = {
  yoga: { priceId: Deno.env.get('EBOOK_PRICE_YOGA'), amount: 1700, files: ['power-yoga-femme-forte.pdf'] },
  pilates: { priceId: Deno.env.get('EBOOK_PRICE_PILATES'), amount: 1700, files: ['power-pilates-femme-solide.pdf'] },
  fit: { priceId: Deno.env.get('EBOOK_PRICE_FIT'), amount: 1700, files: ['power-fit-femme-puissante.pdf'] },
  pack: { priceId: Deno.env.get('EBOOK_PRICE_PACK'), amount: 3900, files: [
    'power-yoga-femme-forte.pdf',
    'power-pilates-femme-solide.pdf',
    'power-fit-femme-puissante.pdf',
  ] },
} as const

function json(data: Record<string, unknown>, status = 200, origin = '') {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'vary': 'Origin',
  }
  if (allowedOrigins.includes(origin)) headers['access-control-allow-origin'] = origin
  return new Response(JSON.stringify(data), { status, headers })
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || ''
  if (request.method === 'OPTIONS') {
    if (!allowedOrigins.includes(origin)) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '3600',
      'vary': 'Origin',
    } })
  }
  if (!allowedOrigins.includes(origin)) return json({ error: 'Origine non autorisée.' }, 403, origin)
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405, origin)
  if (!stripeKey || !supabaseKey || !supabaseUrl ||
    Object.values(catalog).some(x => !x.priceId)) {
    return json({ error: 'Boutique en préparation.' }, 503, origin)
  }

  let sessionId: string
  try {
    const input = await request.json()
    sessionId = typeof input?.session_id === 'string' ? input.session_id : ''
  } catch {
    return json({ error: 'Demande invalide.' }, 400, origin)
  }
  if (!/^cs_(test_)?[a-zA-Z0-9]{20,200}$/.test(sessionId)) {
    return json({ error: 'Référence de paiement invalide.' }, 400, origin)
  }
  try {
    const stripe = new Stripe(stripeKey)
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.payment_status !== 'paid' || session.status !== 'complete' ||
      session.mode !== 'payment' || session.currency !== 'eur') {
      return json({ error: 'Paiement non confirmé.' }, 403, origin)
    }

    const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 10 })
    if (items.data.length !== 1 || items.data[0].quantity !== 1) {
      return json({ error: 'Panier non reconnu.' }, 400, origin)
    }
    const priceObject = items.data[0].price
    const priceId = typeof priceObject === 'string' ? priceObject : priceObject?.id
    const match = Object.entries(catalog).find(([, config]) => config.priceId === priceId)
    if (!match) return json({ error: 'Produit non reconnu.' }, 400, origin)
    const [productCode, product] = match
    if (session.amount_total !== product.amount) {
      return json({ error: 'Montant inattendu.' }, 400, origin)
    }
    const email = (session.customer_details?.email || session.customer_email || '').trim().toLowerCase()
    if (!email) return json({ error: 'E-mail manquant : contactez EMPOWERFIT.' }, 400, origin)
    const paymentIntent = typeof session.payment_intent === 'string'
      ? session.payment_intent : session.payment_intent?.id || null
    const customer = typeof session.customer === 'string'
      ? session.customer : session.customer?.id || null

    const db = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: orderError } = await db.from('ebook_orders').upsert({
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntent,
      stripe_customer_id: customer,
      customer_email: email,
      product_code: productCode,
      amount_total_cents: product.amount,
      currency: 'eur',
    }, { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true })
    if (orderError) throw orderError

    const downloads = []
    for (const file of product.files) {
      const { data, error } = await db.storage.from('ebooks-empowerfit')
        .createSignedUrl(file, 7 * 24 * 3600)
      if (error || !data?.signedUrl) throw error || Error('Téléchargement temporairement indisponible')
      downloads.push({ label: file.replace('.pdf','').replaceAll('-', ' '), url: data.signedUrl })
    }
    return json({ product: productCode, downloads, expires_in_hours: 168 }, 200, origin)
  } catch (e) {
    console.error('ebook-access', e instanceof Error ? e.name : 'error')
    return json({ error: 'Accès temporairement indisponible : contactez EMPOWERFIT.' }, 503, origin)
  }
})
