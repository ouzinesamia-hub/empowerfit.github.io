(function(){
  const STORAGE_SEEN='empowerfit_guide_popup_seen';
  const STORAGE_RECEIVED='empowerfit_guide_received';
  const DAY=24*60*60*1000;
  const seen=Number(localStorage.getItem(STORAGE_SEEN)||0);
  const received=Number(localStorage.getItem(STORAGE_RECEIVED)||0);
  if(received && Date.now()-received < 180*DAY) return;
  if(seen && Date.now()-seen < 7*DAY) return;

  const SUPABASE_URL='https://fkyieurufkxdvzovcqzj.supabase.co';
  const SUPABASE_KEY='sb_publishable_E_9CcWp8K5VJHxe2rGjJew_p9pmd-u9';
  const ACCESS_URL='acces-guide-force-longevite.html';
  const LOGO='logo-inverse-empowerfit.svg';

  const style=document.createElement('style');
  style.textContent=`
  .ef-lead-overlay{position:fixed;inset:0;background:rgba(25,11,20,.72);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:18px;z-index:2147483000}
  .ef-lead-overlay.ef-open{display:flex}
  .ef-lead-modal{position:relative;width:min(720px,100%);max-height:92vh;overflow:auto;background:#F7F1E5;border-radius:26px;box-shadow:0 28px 90px rgba(25,11,20,.35);display:grid;grid-template-columns:.9fr 1.1fr}
  .ef-lead-brand{background:#5F123F;color:#F7F1E5;padding:34px;border-radius:26px 0 0 26px;display:flex;flex-direction:column;justify-content:space-between;min-height:500px}
  .ef-lead-brand img{width:145px;max-width:70%;height:auto}
  .ef-lead-brand h2{font-family:Georgia,serif;font-size:2.25rem;line-height:1.02;margin:26px 0 15px;color:#F7F1E5}
  .ef-lead-brand p{line-height:1.55;margin:0;color:#eadbe2}
  .ef-lead-mini{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:#C7A667;font-weight:800}
  .ef-lead-content{padding:36px 34px 32px}
  .ef-lead-content h3{font-family:Georgia,serif;color:#5F123F;font-size:1.65rem;margin:0 0 10px}
  .ef-lead-list{margin:18px 0 24px;padding:0;list-style:none;display:grid;gap:10px}
  .ef-lead-list li{display:grid;grid-template-columns:20px 1fr;gap:9px;line-height:1.4;color:#3b2932}
  .ef-lead-list li:before{content:'✓';font-weight:900;color:#5F123F}
  .ef-lead-field{display:grid;gap:6px;margin:12px 0}
  .ef-lead-field label{font-weight:800;font-size:.82rem;color:#1D1017}
  .ef-lead-field input{width:100%;border:1px solid #d9cbd2;border-radius:12px;padding:13px 14px;font:inherit;background:white}
  .ef-lead-consent{display:flex;align-items:flex-start;gap:9px;font-size:.76rem;line-height:1.35;color:#62555b;margin:12px 0}
  .ef-lead-consent input{margin-top:2px}
  .ef-lead-submit{width:100%;border:0;border-radius:999px;background:#5F123F;color:#F7F1E5;padding:14px 18px;font-weight:850;cursor:pointer;font-size:.96rem}
  .ef-lead-submit:disabled{opacity:.55;cursor:wait}
  .ef-lead-note{font-size:.7rem;line-height:1.4;color:#756B70;margin:10px 0 0;text-align:center}
  .ef-lead-status{display:none;margin-top:10px;padding:10px 12px;border-radius:10px;font-size:.8rem;background:#f9e9eb;color:#922}
  .ef-lead-close{position:absolute;right:14px;top:12px;border:0;background:#fff;color:#5F123F;width:36px;height:36px;border-radius:50%;font-size:21px;cursor:pointer;box-shadow:0 5px 18px rgba(0,0,0,.08);z-index:2}
  .ef-lead-skip{display:block;border:0;background:transparent;color:#756B70;text-decoration:underline;margin:11px auto 0;cursor:pointer;font-size:.75rem}
  @media(max-width:700px){.ef-lead-modal{grid-template-columns:1fr;max-height:94vh}.ef-lead-brand{min-height:0;border-radius:26px 26px 0 0;padding:25px 26px}.ef-lead-brand h2{font-size:1.75rem;margin:18px 0 10px}.ef-lead-brand p{font-size:.9rem}.ef-lead-content{padding:26px}.ef-lead-brand img{width:115px}}
  `;
  document.head.appendChild(style);

  const overlay=document.createElement('div');
  overlay.className='ef-lead-overlay';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-label','Guide gratuit EMPOWERFIT');
  overlay.innerHTML=`<div class="ef-lead-modal">
    <button class="ef-lead-close" aria-label="Fermer">×</button>
    <div class="ef-lead-brand"><div><img src="${LOGO}" alt="Logo EMPOWERFIT"><div class="ef-lead-mini" style="margin-top:28px">GUIDE OFFERT · 8 PAGES</div><h2>La force comme capital santé.</h2><p>Un guide concret pour comprendre ce que la force peut changer aujourd’hui - et ce qu’elle peut préserver demain.</p></div><p class="ef-lead-mini">ICI, ON AIME PRENDRE DE LA PLACE.</p></div>
    <div class="ef-lead-content"><h3>Recevez le guide gratuitement.</h3><p style="margin:0;color:#62555b;line-height:1.5">Vous y trouverez une méthode claire, un auto-bilan en 8 questions et une semaine Fondation directement applicable.</p>
      <ul class="ef-lead-list"><li>Comprendre la logique Force & Longévité</li><li>Identifier votre prochaine priorité grâce aux 8 questions</li><li>Tester une semaine simple de force, contrôle et mobilité</li></ul>
      <form class="ef-lead-form">
        <div class="ef-lead-field"><label>Prénom</label><input name="first_name" autocomplete="given-name" required></div>
        <div class="ef-lead-field"><label>E-mail</label><input name="email" type="email" autocomplete="email" required></div>
        <label class="ef-lead-consent"><input name="marketing" type="checkbox"> <span>Je souhaite aussi recevoir les conseils et offres EMPOWERFIT par e-mail. Désinscription possible à tout moment.</span></label>
        <button class="ef-lead-submit" type="submit">Recevoir mon guide</button>
        <div class="ef-lead-status"></div>
        <p class="ef-lead-note">Votre e-mail est utilisé pour vous donner accès au guide. Les e-mails marketing ne sont envoyés que si vous cochez la case ci-dessus.</p>
        <button class="ef-lead-skip" type="button">Pas maintenant</button>
      </form>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const form=overlay.querySelector('.ef-lead-form');
  const status=overlay.querySelector('.ef-lead-status');
  function close(){localStorage.setItem(STORAGE_SEEN,String(Date.now()));overlay.classList.remove('ef-open');}
  overlay.querySelector('.ef-lead-close').onclick=close;
  overlay.querySelector('.ef-lead-skip').onclick=close;
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});

  async function capture(payload){
    const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/capture_lead_magnet',{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY},body:JSON.stringify(payload)});
    if(!r.ok) throw new Error('capture_failed');
  }

  form.addEventListener('submit',async e=>{
    e.preventDefault();status.style.display='none';
    const btn=form.querySelector('.ef-lead-submit');btn.disabled=true;btn.textContent='Préparation du guide…';
    const fd=new FormData(form);const email=String(fd.get('email')||'').trim().toLowerCase();const first=String(fd.get('first_name')||'').trim();
    if(!/^\S+@\S+\.\S+$/.test(email)){status.textContent='Saisissez une adresse e-mail valide.';status.style.display='block';btn.disabled=false;btn.textContent='Recevoir mon guide';return;}
    try{
      await capture({p_email:email,p_first_name:first,p_source:location.pathname||'site',p_marketing_consent:fd.get('marketing')==='on'});
      localStorage.setItem(STORAGE_RECEIVED,String(Date.now()));localStorage.setItem('empowerfit_guide_email',email);location.href=ACCESS_URL;
    }catch(err){status.textContent='Le guide est presque prêt, mais l’enregistrement de votre e-mail n’a pas abouti. Réessayez dans un instant.';status.style.display='block';btn.disabled=false;btn.textContent='Recevoir mon guide';}
  });

  let opened=false;const open=()=>{if(opened)return;opened=true;overlay.classList.add('ef-open');};
  setTimeout(open,7000);
  window.addEventListener('scroll',()=>{if(opened)return;const h=document.documentElement.scrollHeight-innerHeight;if(h>0 && scrollY/h>.42)open();},{passive:true});
})();