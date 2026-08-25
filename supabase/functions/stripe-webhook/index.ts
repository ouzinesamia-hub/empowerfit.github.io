import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const legacyServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
const supabaseSecret = legacyServiceKey || secretKeys.default

if (!stripeSecret || !webhookSecret || !supabaseUrl || !supabaseSecret) {
  throw new Error('Configuration serveur incomplète.')
}

const stripe = new Stripe(stripeSecret)
const cryptoProvider = Stripe.createSubtleCryptoProvider()
const db = createClient(supabaseUrl, supabaseSecret, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

const normalizeUrl = (value: string) => value.split('?')[0].replace(/\/$/, '')

function nextJulyFirst(): Date {
  const now = new Date()
  const year = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
  return new Date(Date.UTC(year, 6, 1, 0, 0, 0))
}

async function offerForSession(session: Stripe.Checkout.Session) {
  const paymentLinkId = typeof session.payment_link === 'string'
    ? session.payment_link
    : session.payment_link?.id

  if (!paymentLinkId) return null
  const paymentLink = await stripe.paymentLinks.retrieve(paymentLinkId)
  const { data, error } = await db
    .from('payment_offers')
    .select('*')
    .eq('payment_link_url', normalizeUrl(paymentLink.url))
    .eq('active', true)
    .maybeSingle()

  if (error) throw error
  return data
}

async function grantCheckout(session: Stripe.Checkout.Session) {
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) return

  const offer = await offerForSession(session)
  if (!offer) {
    console.log(`Lien Stripe non associé à une offre: ${session.payment_link}`)
    return
  }

  const email = (session.customer_details?.email || session.customer_email || '').trim().toLowerCase()
  if (!email) throw new Error(`E-mail absent de la session ${session.id}`)

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id || null
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id || null
  const validUntil = offer.validity_days
    ? new Date(Date.now() + offer.validity_days * 86400000).toISOString()
    : offer.ends_in_june
    ? nextJulyFirst().toISOString()
    : null

  if (offer.ends_in_june && subscriptionId) {
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at: Math.floor(new Date(validUntil).getTime() / 1000),
    })
  }

  const { error } = await db.from('customer_entitlements').insert({
    email,
    offer_code: offer.code,
    entitlement_type: offer.entitlement_type,
    credit_scope: offer.credit_scope,
    weekly_limit: offer.weekly_limit,
    credits_remaining: offer.entitlement_type === 'credits' ? offer.credits_granted : null,
    status: 'active',
    valid_from: new Date().toISOString(),
    valid_until: validUntil,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    stripe_checkout_session_id: session.id,
  })

  if (error && error.code !== '23505') throw error
}

async function updateSubscription(subscription: Stripe.Subscription, deleted = false) {
  const active = !deleted && ['active', 'trialing'].includes(subscription.status)
  const { error } = await db
    .from('customer_entitlements')
    .update({
      status: active ? 'active' : subscription.status === 'past_due' ? 'past_due' : 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id)

  if (error) throw error
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Méthode refusée.' }, 405)

  const signature = request.headers.get('stripe-signature')
  if (!signature) return json({ error: 'Signature Stripe absente.' }, 400)

  const payload = await request.text()
  let event: Stripe.Event

  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    )
  } catch (error) {
    console.error(error)
    return json({ error: 'Signature Stripe invalide.' }, 400)
  }

  const { data: previous } = await db
    .from('stripe_webhook_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle()
  if (previous) return json({ received: true, duplicate: true })

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await grantCheckout(event.data.object as Stripe.Checkout.Session)
        break
      case 'customer.subscription.updated':
        await updateSubscription(event.data.object as Stripe.Subscription)
        break
      case 'customer.subscription.deleted':
        await updateSubscription(event.data.object as Stripe.Subscription, true)
        break
      default:
        console.log(`Événement ignoré: ${event.type}`)
    }

    const { error } = await db.from('stripe_webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
    })
    if (error && error.code !== '23505') throw error
    return json({ received: true })
  } catch (error) {
    console.error(error)
    return json({ error: 'Traitement impossible.' }, 500)
  }
})

