// Collection POWER — paiement Stripe Checkout.
// Fonction volontairement FERMÉE par défaut : EBOOK_SALES_OPEN doit valoir "true"
// et la page de vente/livraison doit être publiée et testée avant activation.
import Stripe from 'npm:stripe@22.0.0'

const allowedOrigins = new Set([
  'https://www.empowerfit-studio.fr',
  'https://empowerfit-studio.fr',
  'https://ouzinesamia-hub.github.io',
])
const prices: Record<string,string|undefined> = {
  yoga: Deno.env.get('EBOOK_PRICE_YOGA'),
  pilates: Deno.env.get('EBOOK_PRICE_PILATES'),
  fit: Deno.env.get('EBOOK_PRICE_FIT'),
  pack: Deno.env.get('EBOOK_PRICE_PACK'),
}
const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
const open = Deno.env.get('EBOOK_SALES_OPEN') === 'true'
const baseUrl = 'https://www.empowerfit-studio.fr'

function response(obj: Record<string,unknown>, code: number, origin: string) {
  const headers:Record<string,string> = {'content-type':'application/json','cache-control':'no-store','vary':'Origin'}
  if (allowedOrigins.has(origin)) headers['access-control-allow-origin']=origin
  return new Response(JSON.stringify(obj),{status:code,headers})
}
Deno.serve(async req => {
  const origin=req.headers.get('origin')||''
  if (req.method==='OPTIONS') {
    return new Response(null,{status:allowedOrigins.has(origin)?204:403,headers:allowedOrigins.has(origin)?{
      'access-control-allow-origin':origin,'access-control-allow-methods':'POST,OPTIONS',
      'access-control-allow-headers':'content-type','vary':'Origin'
    }:undefined})
  }
  if (!allowedOrigins.has(origin)) return response({error:'Origine non autorisée'},403,origin)
  if (req.method!=='POST') return response({error:'Méthode non autorisée'},405,origin)
  if (!open) return response({error:'Les ventes ne sont pas encore ouvertes.'},503,origin)
  if (!stripeKey || Object.values(prices).some(value=>!value)) {
    return response({error:'Paiement indisponible'},503,origin)
  }
  try {
    const body=await req.json()
    const code=typeof body?.product==='string'?body.product:''
    if (!Object.hasOwn(prices,code)) return response({error:'Produit inconnu'},400,origin)
    const price=prices[code]!
    const stripe=new Stripe(stripeKey)
    const session=await stripe.checkout.sessions.create({
      mode:'payment',
      line_items:[{price,quantity:1}],
      payment_method_types:['card'],
      customer_creation:'always',
      locale:'fr',
      success_url:baseUrl+'/ebook-merci.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:baseUrl+'/collection-power.html',
      metadata:{origin:'empowerfit_collection_power',ebook_code:code},
    })
    if (!session.url) throw Error('Stripe Checkout sans URL')
    return response({url:session.url},200,origin)
  } catch(e) {
    console.error('ebook-checkout', e instanceof Error?e.name:'error')
    return response({error:'Paiement momentanément indisponible'},503,origin)
  }
})
