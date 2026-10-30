/* GitHub enforces shared write access. Tokens are never persisted or placed in URLs. */
let PUBLISHED_DATA = null, EDITOR_DRAFT = null, EDITOR_OWNER = '', EDITOR_YEAR = '', PREVIEWED_DRAFT = '';
const CONTENT_ENDPOINT = 'https://api.github.com/repos/brian732/theleague-history/contents/data/league.json';
function emptyDraft(){return {owners:{},seasons:{}};}
function cloneContent(value){return JSON.parse(JSON.stringify(value));}
function validateDraft(draft,base,allowIncomplete=false){
  if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('Invalid draft.');
  const out=emptyDraft();
  for(const [id,fields] of Object.entries(draft.owners||{})){
    if(!base.owners.some(o=>o.sleeperUserId===id))throw new Error('An owner in this draft is no longer in the league.');
    const row={};
    for(const [key,max] of [['bio',6000],['displayTeam',100],['photo',2000],['color',7]])if(Object.hasOwn(fields,key)){
      if(typeof fields[key]!=='string'||fields[key].length>max)throw new Error('An owner field is too long or invalid.');row[key]=fields[key];
    }
    if(row.photo&&!/^https:\/\/[^\s]+$/i.test(row.photo))throw new Error('Shared profile photos must use a public HTTPS URL.');
    if(row.color&&!/^#[0-9a-f]{6}$/i.test(row.color))throw new Error('Choose a valid team color.');
    out.owners[id]=row;
  }
  for(const [year,fields] of Object.entries(draft.seasons||{})){
    if(!base.seasons.some(s=>String(s.year)===year))throw new Error('Unknown season in draft.');
    if(typeof fields.recap!=='string'||fields.recap.length>16000||!Array.isArray(fields.awards)||fields.awards.length>100)throw new Error('Invalid season draft.');
    out.seasons[year]={recap:fields.recap,awards:fields.awards.map(a=>{const row={};for(const key of ['award','winner','detail']){const value=a[key]??'';if(typeof value!=='string'||value.length>1000)throw new Error('An award field is too long.');row[key]=value;}if(!allowIncomplete&&(!row.award.trim()||!row.winner.trim()))throw new Error('Each award needs a name and winner, or remove the empty award.');return row;})};
  }
  return out;
}
function applyDraft(base,draft){const next=cloneContent(base);next.owners.forEach(o=>{if(draft.owners[o.sleeperUserId])Object.assign(o,draft.owners[o.sleeperUserId]);});next.seasons.forEach(s=>{if(draft.seasons[s.year])Object.assign(s,draft.seasons[s.year]);});return next;}
function editorOwnerData(){const base=PUBLISHED_DATA.owners.find(o=>o.sleeperUserId===EDITOR_OWNER);return {...base,...EDITOR_DRAFT.owners[EDITOR_OWNER]};}
function editorSeasonData(){const base=PUBLISHED_DATA.seasons.find(s=>String(s.year)===EDITOR_YEAR);return {...base,...EDITOR_DRAFT.seasons[EDITOR_YEAR]};}
function captureEditorFields(){
  if(!EDITOR_OWNER||!EDITOR_YEAR)return;
  const base=PUBLISHED_DATA.owners.find(o=>o.sleeperUserId===EDITOR_OWNER),row={bio:$('#editBio').value,displayTeam:$('#editTeamName').value.trim(),photo:$('#editPhoto').value.trim(),color:$('#editTeamColor').value};
  const diff={};for(const key of Object.keys(row)){const original=key==='displayTeam'?(base.displayTeam||base.team):key==='color'?(base.color||'#e3b23c'):(base[key]||'');if(row[key]!==original)diff[key]=row[key];}
  if(Object.keys(diff).length)EDITOR_DRAFT.owners[EDITOR_OWNER]=diff;else delete EDITOR_DRAFT.owners[EDITOR_OWNER];
  const awards=$$('#editAwards .award-editor').map(el=>({award:el.querySelector('[data-award="award"]').value,winner:el.querySelector('[data-award="winner"]').value,detail:el.querySelector('[data-award="detail"]').value}));
  const fields={recap:$('#editRecap').value,awards},season=PUBLISHED_DATA.seasons.find(s=>String(s.year)===EDITOR_YEAR);
  const comparable={recap:season.recap||'',awards:(season.awards||[]).map(a=>({award:a.award||'',winner:a.winner||'',detail:a.detail||''}))};
  if(JSON.stringify(fields)!==JSON.stringify(comparable))EDITOR_DRAFT.seasons[EDITOR_YEAR]=fields;else delete EDITOR_DRAFT.seasons[EDITOR_YEAR];
}
function fillEditorFields(){const o=editorOwnerData(),s=editorSeasonData();$('#editTeamName').value=o.displayTeam||o.team;$('#editBio').value=o.bio||'';$('#editPhoto').value=o.photo||'';$('#editTeamColor').value=safeColor(o.color);$('#editRecap').value=s.recap||'';renderAwardEditors(s.awards||[]);}
function renderAwardEditors(awards){$('#editAwards').innerHTML=awards.map((a,i)=>`<div class="award-editor"><label>Award ${i+1}<input data-award="award" maxlength="1000" value="${esc(a.award)}"></label><label>Winner<input data-award="winner" maxlength="1000" value="${esc(a.winner)}"></label><label>Detail<input data-award="detail" maxlength="1000" value="${esc(a.detail||'')}"></label><button type="button" class="quiet-btn remove-award" aria-label="Remove award ${i+1}">Remove</button></div>`).join('');}
function saveEditorDraft(){captureEditorFields();try{localStorage.setItem('tl-content-draft',JSON.stringify(EDITOR_DRAFT));$('#editorStatus').textContent='Draft saved on this device. Preview it before publishing.';}catch(e){$('#editorStatus').textContent='Draft could not be saved on this device. You can still preview and download it.';}$('#publishDraft').disabled=JSON.stringify(EDITOR_DRAFT)!==PREVIEWED_DRAFT;}
function initEditor(){
  PUBLISHED_DATA=cloneContent(DATA);EDITOR_DRAFT=emptyDraft();
  try{const saved=JSON.parse(localStorage.getItem('tl-content-draft'));if(saved){EDITOR_DRAFT=saved;$('#editorStatus').textContent='A saved draft is loaded. Review and preview it before publishing.';}}catch(e){}
  // Treat browser-stored drafts as untrusted content and discard malformed shapes.
  try{const loose=cloneContent(EDITOR_DRAFT);if(!loose.owners||!loose.seasons)throw new Error('Invalid');for(const id of Object.keys(loose.owners))if(!DATA.owners.some(o=>o.sleeperUserId===id))delete loose.owners[id];for(const year of Object.keys(loose.seasons))if(!DATA.seasons.some(s=>String(s.year)===year))delete loose.seasons[year];EDITOR_DRAFT=validateDraft(loose,PUBLISHED_DATA,true);}catch(e){EDITOR_DRAFT=emptyDraft();$('#editorStatus').textContent='The saved draft could not be read. Start a new draft below.';}
  $('#editOwner').innerHTML=DATA.owners.map(o=>`<option value="${o.sleeperUserId}">${esc(o.name)}</option>`).join('');
  $('#editYear').innerHTML=[...DATA.seasons].sort((a,b)=>b.year-a.year).map(s=>`<option value="${s.year}">${s.year}</option>`).join('');
  EDITOR_OWNER=$('#editOwner').value;EDITOR_YEAR=$('#editYear').value;fillEditorFields();$('#publishDraft').disabled=true;
  for(const id of ['editOwner','editYear'])$('#'+id).onchange=()=>{captureEditorFields();EDITOR_OWNER=$('#editOwner').value;EDITOR_YEAR=$('#editYear').value;fillEditorFields();saveEditorDraft();};
  $('#editorForm').oninput=saveEditorDraft;
  $('#editorForm').onclick=e=>{const award=e.target.closest('.remove-award');if(award){award.closest('.award-editor').remove();saveEditorDraft();}};
  $('#addAward').onclick=()=>{captureEditorFields();const s=editorSeasonData();renderAwardEditors([...(s.awards||[]),{award:'',winner:'',detail:''}]);saveEditorDraft();};
  $('#saveDraft').onclick=saveEditorDraft;
  $('#editorForm').onsubmit=e=>{e.preventDefault();try{captureEditorFields();EDITOR_DRAFT=validateDraft(EDITOR_DRAFT,PUBLISHED_DATA);DATA=applyDraft(PUBLISHED_DATA,EDITOR_DRAFT);PREVIEWED_DRAFT=JSON.stringify(EDITOR_DRAFT);repaintEditableContent();$('#publishDraft').disabled=false;$('#editorStatus').textContent='Draft preview is active on this device. Nothing has been published.';let banner=$('#draftPreviewBanner');if(!banner){banner=document.createElement('p');banner.id='draftPreviewBanner';banner.className='draft-banner';$('#main').prepend(banner);}banner.textContent='Draft preview · visible only on this device. Publish at the Commissioner’s desk to share it.';}catch(err){$('#editorStatus').textContent=err.message;}};
  $('#downloadDraft').onclick=()=>{try{captureEditorFields();const updated=applyDraft(PUBLISHED_DATA,validateDraft(EDITOR_DRAFT,PUBLISHED_DATA));const url=URL.createObjectURL(new Blob([JSON.stringify(updated,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='league.json';a.click();URL.revokeObjectURL(url);$('#editorStatus').textContent='Downloaded league.json. Replace the repository’s content file to share these edits.';}catch(err){$('#editorStatus').textContent=err.message;}};
  $('#discardDraft').onclick=()=>{EDITOR_DRAFT=emptyDraft();PREVIEWED_DRAFT='';DATA=cloneContent(PUBLISHED_DATA);try{localStorage.removeItem('tl-content-draft');}catch(e){}$('#draftPreviewBanner')?.remove();fillEditorFields();repaintEditableContent();$('#publishDraft').disabled=true;$('#editorStatus').textContent='Draft discarded. Showing published content.';};
  $('#publishForm').onsubmit=publishEditorDraft;
}
function repaintEditableContent(){OWNER_BY_SLEEPER=Object.fromEntries(DATA.owners.map(o=>[o.sleeperUserId,o]));renderOwnersShell();renderOwnerRecords();renderTrophies();renderPersonalHome();renderInfo();renderFooter();renderCommissionerHistory();renderSeason(+$('#yearNav button.active')?.dataset.year||currentSeasonYear());refreshExplorer();}
function contentField(base,draft,group,id,key){return group==='owners'?base.owners.find(o=>o.sleeperUserId===id)?.[key]:base.seasons.find(s=>String(s.year)===id)?.[key];}
function mergePublishedDraft(latest,baseline,draft){
  // Changes in scoring data or unrelated content are preserved; touched-field edits conflict.
  for(const group of ['owners','seasons'])for(const [id,fields]of Object.entries(draft[group]))for(const key of Object.keys(fields))if(JSON.stringify(contentField(latest,draft,group,id,key))!==JSON.stringify(contentField(baseline,draft,group,id,key)))throw new Error('This content changed on GitHub after you opened the editor. Download your draft, reload the site, and review the latest version before publishing.');
  return applyDraft(latest,validateDraft(draft,latest));
}
function encodeGitHubContent(value){const bytes=new TextEncoder().encode(JSON.stringify(value,null,2)+'\n');let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);}
function decodeGitHubContent(value){return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g,'')),c=>c.charCodeAt(0))));}
async function publishEditorDraft(event){
  event.preventDefault();const input=$('#publishToken'),token=input.value.trim();input.value='';let publishing=false;
  try{captureEditorFields();const draft=validateDraft(EDITOR_DRAFT,PUBLISHED_DATA);if(!PREVIEWED_DRAFT||JSON.stringify(draft)!==PREVIEWED_DRAFT)throw new Error('Preview your latest draft before publishing.');if(!token)throw new Error('Enter a GitHub access token with write access to this repository.');
    publishing=true;$('#publishDraft').disabled=true;$('#publishStatus').textContent='Checking the current shared content…';
    const headers={Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10'};
    const response=await fetch(CONTENT_ENDPOINT+'?ref=main',{headers,cache:'no-store'});
    if(!response.ok)throw new Error('GitHub could not read the repository. Check the token and repository access.');
    const file=await response.json(),latest=decodeGitHubContent(file.content),updated=mergePublishedDraft(latest,PUBLISHED_DATA,draft);
    $('#publishStatus').textContent='Publishing the previewed draft…';
    const result=await fetch(CONTENT_ENDPOINT,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:'Update league stories and profiles from commissioner editor',branch:'main',sha:file.sha,content:encodeGitHubContent(updated)})});
    if(!result.ok)throw new Error(result.status===409?'The shared file changed during publishing. Reload and review the latest content.':'GitHub could not publish. The token needs Contents: Read and write for this repository.');
    const saved=await result.json();PUBLISHED_DATA=cloneContent(updated);DATA=cloneContent(updated);EDITOR_DRAFT=emptyDraft();PREVIEWED_DRAFT='';try{localStorage.removeItem('tl-content-draft');sessionStorage.removeItem('v2:'+CONFIG_URL);}catch(e){}$('#draftPreviewBanner')?.remove();fillEditorFields();repaintEditableContent();$('#editorStatus').textContent='Your changes are committed to the shared repository.';$('#publishStatus').innerHTML=`Published to GitHub. GitHub Pages will make it live after deployment. <a href="https://github.com/brian732/theleague-history/actions" target="_blank" rel="noopener">Check deployment</a>.`;
  }catch(err){$('#publishStatus').textContent=err.message;if(publishing)$('#publishDraft').disabled=false;}
}
