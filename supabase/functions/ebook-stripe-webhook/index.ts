// Collection POWER: webhook dédié aux ebooks. Ne modifie PAS stripe-webhook des réservations.
// Déploiement et configuration Stripe à effectuer UNIQUEMENT après tests et validation fiscale.
// Déployer avec verify_jwt=false : l'authenticité est assurée par la signature Stripe ci-dessous.
import Stripe from 'npm:stripe@22.0.0'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
const webhookSecret = Deno.env.get('EBOOK_STRIPE_WEBHOOK_SECRET')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || secretKeys.default
const resendKey = Deno.env.get('EBOOK_RESEND_API_KEY')
const fromEmail = Deno.env.get('EBOOK_FROM_EMAIL')

const catalog = {
  yoga: { price: Deno.env.get('EBOOK_PRICE_YOGA'), amount: 1700, label: 'Power Yoga — Femme Forte', files: ['power-yoga-femme-forte.pdf'] },
  pilates: { price: Deno.env.get('EBOOK_PRICE_PILATES'), amount: 1700, label: 'Power Pilates — Femme Solide', files: ['power-pilates-femme-solide.pdf'] },
  fit: { price: Deno.env.get('EBOOK_PRICE_FIT'), amount: 1700, label: 'Power Fit — Femme Puissante', files: ['power-fit-femme-puissante.pdf'] },
  pack: { price: Deno.env.get('EBOOK_PRICE_PACK'), amount: 3900, label: 'Collection POWER — les trois ebooks', files: ['power-yoga-femme-forte.pdf', 'power-pilates-femme-solide.pdf', 'power-fit-femme-puissante.pdf'] },
} as const

const reply = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]!))

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply({ error: 'Méthode non autorisée' }, 405)
  if (!stripeKey || !webhookSecret || !supabaseUrl || !supabaseKey || !resendKey || !fromEmail ||
    Object.values(catalog).some(item => !item.price)) {
    console.error('Ebook webhook non configuré.')
    return reply({ error: 'Configuration manquante' }, 503)
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return reply({ error: 'Signature manquante' }, 400)

  const stripe = new Stripe(stripeKey)
  const rawBody = await request.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret,
      undefined, Stripe.createSubtleCryptoProvider())
  } catch {
    return reply({ error: 'Signature invalide' }, 400)
  }

  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
    return reply({ received: true, ignored: true })
  }
  const session = event.data.object as Stripe.Checkout.Session
  if (session.payment_status !== 'paid') return reply({ received: true, awaiting_payment: true })

  const db = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    // La page de retour n'accorde aucun accès : on vérifie Stripe directement.
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 })
    if (lineItems.data.length !== 1 || lineItems.data[0].quantity !== 1) {
      return reply({ error: 'Panier inattendu' }, 422)
    }
    const priceRef = lineItems.data[0].price
    const stripePriceId = typeof priceRef === 'string' ? priceRef : priceRef?.id
    const selected = Object.entries(catalog).find(([, entry]) => entry.price === stripePriceId)
    if (!selected) return reply({ received: true, ignored: 'Autre produit Stripe' })
    const [productCode, product] = selected

    const email = (session.customer_details?.email || session.customer_email || '').trim().toLowerCase()
    if (!email || session.currency !== 'eur' || session.amount_total !== product.amount) {
      return reply({ error: 'Montant, devise ou email inattendu' }, 422)
    }
    const paymentIntent = typeof session.payment_intent === 'string'
      ? session.payment_intent : session.payment_intent?.id ?? null
    const customerId = typeof session.customer === 'string'
      ? session.customer : session.customer?.id ?? null

    const { error: insertError } = await db.from('ebook_orders').upsert({
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntent,
      stripe_customer_id: customerId,
      customer_email: email,
      product_code: productCode,
      amount_total_cents: product.amount,
      currency: 'eur',
    }, { onConflict: 'stripe_checkout_session_id', ignoreDuplicates: true })
    if (insertError) throw insertError

    const { data: order, error: selectError } = await db.from('ebook_orders')
      .select('id,delivery_status').eq('stripe_checkout_session_id', session.id).single()
    if (selectError) throw selectError
    if (order.delivery_status === 'sent') return reply({ received: true, already_sent: true })
    if (order.delivery_status === 'sending') return reply({ received: true, processing: true })

    // Claim atomique : évite deux mails si Stripe renvoie deux fois le même événement.
    const { data: claimed, error: claimError } = await db.from('ebook_orders').update({
      delivery_status: 'sending', updated_at: new Date().toISOString()
    }).eq('id', order.id).in('delivery_status', ['pending', 'failed']).select('id').maybeSingle()
    if (claimError) throw claimError
    if (!claimed) return reply({ received: true, processing: true })

    const links: { label: string; url: string }[] = []
    for (const path of product.files) {
      const { data, error } = await db.storage.from('ebooks-empowerfit')
        .createSignedUrl(path, 7 * 24 * 3600)
      if (error || !data?.signedUrl) throw error || Error('Lien privé indisponible')
      links.push({ label: path.replaceAll('-', ' ').replace('.pdf', ''), url: data.signedUrl })
    }

    const items = links.map(link =>
      '<li style="margin-bottom:12px"><a href="' + escapeHtml(link.url) +
      '" style="color:#5F123F;font-weight:700">' + escapeHtml(link.label) + '</a></li>'
    ).join('')
    const html = '<div style="font-family:Arial,sans-serif;color:#190B14;line-height:1.7">' +
      '<h1 style="color:#5F123F">Votre collection EMPOWERFIT</h1>' +
      '<p>Merci pour votre achat de <strong>' + escapeHtml(product.label) + '</strong>.</p>' +
      '<p>Voici vos liens privés de téléchargement (valides 7 jours) :</p><ul>' +
      items + '</ul><p>Enregistrez les PDF sur votre appareil pour les conserver.</p>' +
      '<p>Élevez votre mindset | Musclez votre corps.</p></div>'

    // Idempotency-Key réduit les doubles e-mails si Stripe rejoue le webhook.
    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + resendKey, 'content-type': 'application/json',
        'Idempotency-Key': 'empowerfit-ebook-' + session.id },
      body: JSON.stringify({
        from: fromEmail, to: [email], subject: 'Vos ebooks EMPOWERFIT — téléchargement',
        html,
      }),
    })
    const receipt = await send.json().catch(() => ({}))
    if (!send.ok || !receipt.id) {
      throw Error('Envoi du courriel impossible (' + send.status + ')')
    }

    const { error: deliveredError } = await db.from('ebook_orders').update({
      delivery_status: 'sent',
      email_provider_id: receipt.id,
      delivered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_delivery_error: null,
    }).eq('id', order.id)
    if (deliveredError) throw deliveredError
    await db.from('ebook_webhook_events').upsert({
      event_id: event.id, event_type: event.type, stripe_checkout_session_id: session.id,
    }, { onConflict: 'event_id' })
    return reply({ received: true, delivered: true })
  } catch (error) {
    console.error('Échec livraison ebook:', error instanceof Error ? error.message : 'inconnu')
    // On conserve l'échec pour une nouvelle tentative ; pas de confirmation erronée.
    await db.from('ebook_orders').update({
      delivery_status: 'failed',
      last_delivery_error: error instanceof Error ? error.message.slice(0, 250) : 'Erreur inconnue',
      updated_at: new Date().toISOString(),
    }).eq('stripe_checkout_session_id', session.id).eq('delivery_status', 'sending')
    return reply({ error: 'Livraison à réessayer' }, 503)
  }
})
