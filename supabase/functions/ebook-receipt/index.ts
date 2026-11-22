// Page de récupération temporaire, sans dépendance au site o2switch.
// À utiliser comme after_completion.redirect.url Stripe lorsque tests validés.
// Elle ne contient aucun PDF : seul ebook-access accorde les liens après vérification Stripe.
const html = String.raw`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Vos ebooks EMPOWERFIT</title>
<style>
:root{--p:#5F123F;--b:#F5F0DA;--text:#190B14;--r:#FF4F79}*{box-sizing:border-box}
body{margin:0;background:var(--b);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--text);min-height:100vh;padding:22px;display:grid;place-items:center}
main{width:min(650px,100%);background:#fff;border:1px solid #5f123f16;border-radius:24px;box-shadow:0 15px 45px #190b1412;padding:clamp(24px,5vw,43px)}
.eyebrow{font-weight:800;color:var(--p);letter-spacing:.12em;text-transform:uppercase;font-size:.75rem}
h1{font-family:Georgia,serif;font-weight:600;color:var(--p);font-size:clamp(2rem,6vw,3rem);line-height:1.14}
p{color:#534551}.link{display:block;text-align:center;background:var(--p);color:#fff;padding:13px 16px;margin-top:12px;text-decoration:none;border-radius:100px;font-weight:700}
.note{background:#f7e8ee;border-left:4px solid var(--r);padding:13px 16px;border-radius:8px}
ul{list-style:none;padding:0}small{color:#79616a}
</style></head>
<body><main><div class="eyebrow">EMPOWERFIT · COLLECTION POWER</div>
<h1 id="title">Vérification de votre paiement…</h1>
<p id="status" role="status" aria-live="polite">Nous préparons vos fichiers PDF.</p>
<div id="ready" hidden><p>Merci pour votre achat ! Voici vos ebooks :</p><ul id="links"></ul>
<p class="note">Téléchargez et conservez ces PDF sur votre appareil. Les liens privés expirent au bout de 7 jours.</p></div>
<p><small>Si vous avez payé et ne voyez pas vos ebooks, ne payez pas une seconde fois. Contactez EMPOWERFIT sur Instagram pour récupérer votre commande.</small></p>
<p><a href="https://ig.me/m/fiterus.revolution" rel="noopener noreferrer">Contacter EMPOWERFIT</a></p></main>
<script>
(async function(){
 const search=new URLSearchParams(location.search);
 const sid=search.get('session_id');
 if(sid) history.replaceState(null,'',location.pathname);
 const title=document.getElementById('title');
 const status=document.getElementById('status');
 if(!sid){title.textContent='Référence de paiement manquante';status.textContent='Revenez depuis votre confirmation Stripe.';return;}
 try{
  const result=await fetch('/functions/v1/ebook-access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session_id:sid})});
  const json=await result.json();
  if(!result.ok||!Array.isArray(json.downloads)||!json.downloads.length)throw Error('Pas de téléchargement');
  for(const [idx,item] of json.downloads.entries()){
   const li=document.createElement('li'),a=document.createElement('a');
   a.href=item.url;a.className='link';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';
   a.textContent=json.downloads.length===1?'Télécharger mon ebook':'Télécharger mon ebook '+(idx+1);
   a.setAttribute('aria-label','Télécharger '+item.label);li.append(a);document.getElementById('links').append(li);
  }
  title.textContent='Vos ebooks sont prêts';status.textContent='Paiement confirmé.';
  document.getElementById('ready').hidden=false;
 }catch(e){title.textContent='Votre accès nécessite une vérification';status.textContent='Nous ne pouvons pas encore afficher les fichiers. Si vous avez été prélevée, contactez EMPOWERFIT.';}
})();
</script></body></html>`;
Deno.serve((req) => {
 if(req.method!=='GET') return new Response('Méthode non autorisée',{status:405})
 return new Response(html,{status:200,headers:{
  'content-type':'text/html; charset=utf-8',
  'cache-control':'no-store, private',
  'referrer-policy':'no-referrer',
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'content-security-policy':"default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
 }})
})
