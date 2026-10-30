let PREFERENCES = {favorite:'',home:'now',density:'detailed',theme:'system',accent:'gold',colors:{},photos:{}};
let PENDING_PHOTO = undefined;
const ACCENTS = {gold:{dark:'#e3b23c',light:'#92610b'},blue:{dark:'#7db8ff',light:'#1757a8'},green:{dark:'#73d6a2',light:'#16633d'},red:{dark:'#ff9a89',light:'#a33120'},purple:{dark:'#c6a1ff',light:'#6e32a5'}};
function safePhoto(value) {return typeof value==='string' && ( /^https:\/\//i.test(value) || /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) && value.length<500000 ) ? value : '';}
function safeColor(value) {return /^#[0-9a-f]{6}$/i.test(value||'') ? value : '#e3b23c';}
function favoriteOwnerId() {return PREFERENCES.favorite;}
function isFavorite(id) {return !!id && id===PREFERENCES.favorite;}
function savedHomeSection() {return ['now','alltime','owners'].includes(PREFERENCES.home)?PREFERENCES.home:'now';}
function ownerAvatar(o,large=false) {
  const photo=safePhoto(PREFERENCES.photos[o.sleeperUserId] || o.photo || '');
  const color=safeColor(PREFERENCES.colors[o.sleeperUserId] || o.color);
  const initials=o.name.split(' ').map(s=>s[0]).slice(0,2).join('');
  return `<span class="owner-avatar ${large?'large':''}" style="--team-color:${color}">${photo?`<img src="${esc(photo)}" alt="${esc(o.name)}" loading="lazy" referrerpolicy="no-referrer">`:`<span aria-hidden="true">${esc(initials)}</span>`}</span>`;
}
function applyAppearance() {
  document.documentElement.dataset.density=PREFERENCES.density;
  if(PREFERENCES.theme==='system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme=PREFERENCES.theme;
  const light=PREFERENCES.theme==='light'||(PREFERENCES.theme==='system'&&matchMedia('(prefers-color-scheme: light)').matches);
  const accent=ACCENTS[PREFERENCES.accent]||ACCENTS.gold;
  document.documentElement.style.setProperty('--gold',light?accent.light:accent.dark);
  document.documentElement.style.setProperty('--gold-dim',light?accent.light:accent.dark);
}
function syncThemePreference(theme) {PREFERENCES.theme=theme;try{localStorage.setItem('tl-view',JSON.stringify(PREFERENCES));}catch(e){}if($('#preferredTheme'))$('#preferredTheme').value=theme;applyAppearance();}
function initCustomization() {
  try{
    const saved=JSON.parse(localStorage.getItem('tl-view'));
    if(saved && typeof saved==='object') {
      if(DATA.owners.some(o=>o.sleeperUserId===saved.favorite))PREFERENCES.favorite=saved.favorite;
      if(['now','alltime','owners'].includes(saved.home))PREFERENCES.home=saved.home;
      if(['detailed','compact'].includes(saved.density))PREFERENCES.density=saved.density;
      if(['system','dark','light'].includes(saved.theme))PREFERENCES.theme=saved.theme;
      if(ACCENTS[saved.accent])PREFERENCES.accent=saved.accent;
      DATA.owners.forEach(o=>{if(saved.colors?.[o.sleeperUserId])PREFERENCES.colors[o.sleeperUserId]=safeColor(saved.colors[o.sleeperUserId]);const photo=safePhoto(saved.photos?.[o.sleeperUserId]);if(photo)PREFERENCES.photos[o.sleeperUserId]=photo;});
    }else{const theme=localStorage.getItem('tl-theme');if(['dark','light'].includes(theme))PREFERENCES.theme=theme;}
  }catch(e){}
  applyAppearance();
  if (!location.hash && window.switchLeagueTab) window.switchLeagueTab(savedHomeSection());
  const options=DATA.owners.map(o=>`<option value="${o.sleeperUserId}">${esc(o.name)} · ${esc(o.displayTeam||o.team)}</option>`).join('');
  $('#favoriteOwner').innerHTML='<option value="">Choose your team</option>'+options;
  syncPreferenceFields();
  $('#preferencesForm').onsubmit=e=>{
    e.preventDefault();const favorite=$('#favoriteOwner').value;
    const next={...PREFERENCES,favorite,home:$('#homeSection').value,density:$('#tableDensity').value,theme:$('#preferredTheme').value,accent:$('#accentChoice').value,colors:{...PREFERENCES.colors},photos:{...PREFERENCES.photos}};
    if(favorite){next.colors[favorite]=safeColor($('#personalTeamColor').value);if(PENDING_PHOTO!==undefined){if(PENDING_PHOTO)next.photos[favorite]=PENDING_PHOTO;else delete next.photos[favorite];}}
    else if(PENDING_PHOTO){$('#preferencesStatus').textContent='Choose your team before adding a photo.';return;}
    try{localStorage.setItem('tl-view',JSON.stringify(next));localStorage.setItem('tl-theme',next.theme==='system'?'':next.theme);}catch(e){$('#preferencesStatus').textContent='This browser could not save your view. Try a smaller photo or allow site storage.';return;}
    PREFERENCES=next;PENDING_PHOTO=undefined;applyAppearance();renderOwnersShell();renderOwnerRecords();renderLive();refreshExplorer();renderPersonalHome();
    if(favorite){$('#compareA').value=favorite;$('#compareB').value=DATA.owners.find(o=>o.sleeperUserId!==favorite).sleeperUserId;$('#h2hOwner').value=favorite;renderHeadToHeadDetail();renderComparison();}
    $('#preferencesStatus').textContent='Your view is saved on this device.';
  };
  $('#favoriteOwner').onchange=()=>{PENDING_PHOTO=undefined;$('#personalPhoto').value='';$('#personalTeamColor').value=safeColor(PREFERENCES.colors[$('#favoriteOwner').value]);};
  $('#personalPhoto').onchange=async()=>{const file=$('#personalPhoto').files[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024){$('#preferencesStatus').textContent='Choose a PNG, JPEG, or WebP image smaller than 10 MB.';$('#personalPhoto').value='';return;}
    try{PENDING_PHOTO=await resizeProfilePhoto(file);$('#preferencesStatus').textContent='Photo ready. Save your view to keep it.';}catch(e){$('#preferencesStatus').textContent='That photo could not be read. Try another image.';}
  };
  $('#clearPersonalPhoto').onclick=()=>{PENDING_PHOTO='';$('#personalPhoto').value='';$('#preferencesStatus').textContent='Photo removal is ready. Save your view to keep it.';};
  $('#resetPreferences').onclick=()=>{try{localStorage.removeItem('tl-view');localStorage.removeItem('tl-theme');}catch(e){}PREFERENCES={favorite:'',home:'now',density:'detailed',theme:'system',accent:'gold',colors:{},photos:{}};PENDING_PHOTO=undefined;syncPreferenceFields();applyAppearance();renderOwnersShell();renderOwnerRecords();renderLive();refreshExplorer();renderPersonalHome();$('#preferencesStatus').textContent='Your personal view has been reset.';};
  const media=matchMedia('(prefers-color-scheme: light)');media.addEventListener?.('change',()=>{if(PREFERENCES.theme==='system')applyAppearance();});
  document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement && e.target.closest('.owner-avatar')){e.target.replaceWith(document.createTextNode('🏈'));}},true);
  initEditor();
}
function syncPreferenceFields(){for(const [id,key] of [['favoriteOwner','favorite'],['homeSection','home'],['tableDensity','density'],['preferredTheme','theme'],['accentChoice','accent']])$('#'+id).value=PREFERENCES[key];$('#personalTeamColor').value=safeColor(PREFERENCES.colors[PREFERENCES.favorite]);$('#personalPhoto').value='';}
function resizeProfilePhoto(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=240;const ctx=canvas.getContext('2d');const side=Math.min(img.naturalWidth,img.naturalHeight);ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,240,240);resolve(canvas.toDataURL('image/jpeg',.85));}catch(e){reject(e);}finally{URL.revokeObjectURL(url);}};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Invalid photo'));};img.src=url;});}
function renderPersonalHome(){const o=OWNER_BY_SLEEPER[PREFERENCES.favorite];if(!o){$('#personalHome').innerHTML='';return;}const career=allTimeTotals().find(r=>r.team===o.team);const current=CURRENT&&SEASONS[+CURRENT.season]?.standings.find(r=>r.sleeperUserId===o.sleeperUserId);$('#personalHome').innerHTML=`<aside class="personal-spotlight">${ownerAvatar(o,true)}<div><span class="tiny">Your team</span><h3>${esc(o.displayTeam||o.team)}</h3><p>${current?`${CURRENT.season}: ${current.w}–${current.l}${current.t?'–'+current.t:''} · `:''}Career: ${career?recordLabel(career):'No games yet'}</p></div><button type="button" id="myRivalries" class="quiet-btn">My rivalries</button></aside>`;$('#myRivalries').onclick=()=>{window.switchLeagueTab('alltime');$('#compareA').value=o.sleeperUserId;if($('#compareB').value===o.sleeperUserId)$('#compareB').value=DATA.owners.find(x=>x!==o).sleeperUserId;$('#h2hOwner').value=o.sleeperUserId;renderComparison();renderHeadToHeadDetail();};}
