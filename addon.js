const $ = id => document.getElementById(id);
const state = {
  queue: [], pdfJs: null, registry: null, selected: -1,
  printing: false, stop: false, previewVersion: 0, fonts: [], textSelectedId: null, activeImageId: "image", cropState: null,
  editor: { pointers: new Map(), mode: null, start: null, crop: null, sizeInfo: null, entry: null },
  viewZoom: 1
};
// Undo/redo tracks editable label data. Files/Blobs are kept by reference instead
// of being duplicated, so a large image is not copied on every touch operation.
const history={undo:[],redo:[],pending:null,hold:false,gesturing:false,restoring:false,limit:55,timer:null};
function snapshotClone(value){
 if(value===null || typeof value!=='object')return value;
 if(value instanceof Blob)return value;
 if(Array.isArray(value))return value.map(snapshotClone);
 const out={};
 for(const [key,val] of Object.entries(value)){
   if(['img','imgPromise','objectUrl'].includes(key))continue;
   if(typeof val==='function')continue;
   out[key]=snapshotClone(val);
 }
 return out;
}
function takeSnapshot(){return {queue:snapshotClone(state.queue),selected:state.selected,textSelectedId:state.textSelectedId,activeImageId:state.activeImageId};}
function snapshotFingerprint(snapshot){
 const replaceBlob=(k,v)=>v instanceof Blob?`<blob:${v.size}:${v.type}:${v.name||''}:${v.lastModified||''}>`:v;
 return JSON.stringify(snapshot.queue,replaceBlob);
}
function updateHistoryControls(){
 const undo=$('dd-undo'),redo=$('dd-redo'),status=$('dd-history-status');
 if(!undo||!redo||!status)return;
 undo.disabled=!history.undo.length||state.printing;redo.disabled=!history.redo.length||state.printing;
 status.textContent=`${history.undo.length} zurück · ${history.redo.length} wiederholen`;
}
function beginHistory(reason='Änderung'){
 if(history.restoring||state.printing||history.pending)return;
 const shot=takeSnapshot();history.pending={snapshot:shot,fingerprint:snapshotFingerprint(shot),reason};
}
function commitHistory(){
 if(history.restoring||history.hold||history.gesturing||!history.pending)return;
 const pending=history.pending;history.pending=null;
 if(snapshotFingerprint(takeSnapshot())===pending.fingerprint){updateHistoryControls();return;}
 history.undo.push(pending.snapshot);
 if(history.undo.length>history.limit)history.undo.shift();
 history.redo.length=0;
 updateHistoryControls();
}
function clearHistoryTimer(){if(history.timer){clearTimeout(history.timer);history.timer=null;}}
function scheduleHistoryCommit(delay=80){
 if(history.restoring||history.hold||history.gesturing)return;
 clearHistoryTimer();history.timer=setTimeout(()=>{history.timer=null;commitHistory();},delay);
}
function restoreHistory(shot){
 history.restoring=true;clearHistoryTimer();history.pending=null;
 for(const entry of state.queue)revokeEntry(entry);
 state.queue=snapshotClone(shot.queue);
 state.selected=Math.max(-1,Math.min(state.queue.length-1,shot.selected));
 state.textSelectedId=shot.textSelectedId;
 state.activeImageId=shot.activeImageId;
 state.editor.pointers.clear();state.editor.mode=null;state.editor.start=null;
 const entry=state.queue[state.selected];
 if(entry){
   if(!entry.texts?.some(t=>t.id===state.textSelectedId))state.textSelectedId=null;
   if(!imageForId(entry,state.activeImageId))state.activeImageId=allImages(entry)[0]?.id||'image';
 }else{state.textSelectedId=null;state.activeImageId='image';}
 state.previewVersion++;
 showQueue();renderTextControls();setImagePanel(activeImageLayer(entry));requestPreview();
 history.restoring=false;updateHistoryControls();
}
function undoEdit(){
 if(state.printing||state.cropState)return;
 history.hold=false;history.gesturing=false;clearHistoryTimer();commitHistory();
 if(!history.undo.length)return;
 const now=takeSnapshot(),previous=history.undo.pop();history.redo.push(now);restoreHistory(previous);
 message('Änderung rückgängig gemacht.');
}
function redoEdit(){
 if(state.printing||state.cropState)return;
 history.hold=false;history.gesturing=false;clearHistoryTimer();commitHistory();
 if(!history.redo.length)return;
 const now=takeSnapshot(),next=history.redo.pop();history.undo.push(now);restoreHistory(next);
 message('Änderung wiederhergestellt.');
}
$('dd-undo').addEventListener('click',undoEdit);
$('dd-redo').addEventListener('click',redoEdit);
document.addEventListener('keydown',e=>{
 if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
 if(e.target.closest('input,textarea,[contenteditable="true"]'))return;
 const key=e.key.toLowerCase();
 if(key==='z' && e.shiftKey){e.preventDefault();redoEdit();}
 else if(key==='z'){e.preventDefault();undoEdit();}
 else if(key==='y'){e.preventDefault();redoEdit();}
});
// Capture before the application's own listeners run. Changes caused by a native
// slider drag or typing are grouped, while a button click is one history step.
const historyRoot=$('dd-addon');
historyRoot.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button)return;
 if(['dd-undo','dd-redo','dd-print','dd-stop','dd-picker','dd-add-layer','dd-crop-image','dd-clear'].includes(button.id))return;
 beginHistory(button.title||button.textContent.trim()||'Bearbeiten');scheduleHistoryCommit(115);
},true);
historyRoot.addEventListener('focusin',e=>{
 if(!e.target.matches('input,textarea,select')||e.target.type==='file')return;
 beginHistory('Wert eingeben');
},true);
historyRoot.addEventListener('focusout',e=>{
 if(!e.target.matches('input,textarea,select')||e.target.type==='file')return;
 scheduleHistoryCommit(40);
},true);
historyRoot.addEventListener('input',e=>{
 if(!e.target.matches('input,textarea,select')||e.target.type==='file')return;
 beginHistory('Wert geändert');scheduleHistoryCommit(520);
},true);
historyRoot.addEventListener('change',e=>{
 if(!e.target.matches('input,textarea,select')||e.target.type==='file')return;
 beginHistory('Einstellung geändert');scheduleHistoryCommit(70);
},true);
historyRoot.addEventListener('pointerdown',e=>{
 if(e.target.matches('input[type="range"]')){beginHistory('Regler');history.gesturing=true;}
},true);
historyRoot.addEventListener('pointerup',e=>{
 if(history.gesturing&&e.target.matches('input[type="range"]')){
   history.gesturing=false;scheduleHistoryCommit(40);
 }
},true);
historyRoot.addEventListener('pointercancel',()=>{history.gesturing=false;scheduleHistoryCommit(40);},true);

const MAX_PAGES = 100;
const PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const FILE_LIMIT = 40 * 1024 * 1024;
const loaded = () => Boolean(window.Niimbot && $('model') && $('model').options.length && $('size') && $('size').options.length);
function bluetoothHint(){
  const hint=$('dd-blehint'); if(!hint)return;
  if(!window.isSecureContext){hint.hidden=false;hint.textContent='Die App muss über HTTPS oder localhost geöffnet werden. Bitte den GitHub-Pages-Link verwenden, nicht die lokale HTML-Datei.';return;}
  if(!navigator.bluetooth){hint.hidden=false;hint.textContent='Dieser Browser meldet keine Web-Bluetooth-Unterstützung. Auf iPhone/iPad die veröffentlichte HTTPS-Adresse in Bluefy öffnen. Safari und normales iPhone-Chrome eignen sich dafür nicht.';return;}
  hint.hidden=true;
}
const message = (text, isError = false) => {
  $('dd-state').textContent = text;
  $('dd-state').style.color = isError ? '#b42318' : '#244269';
  (isError ? console.error : console.log).call(console, '[dragdrop] '+text);
};
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function buttonState(){
  $('dd-print').disabled = !state.queue.length || state.printing || !loaded();
  $('dd-clear').disabled = state.printing || !state.queue.length;
  $('dd-files').disabled = state.printing;
  $('dd-stop').disabled = !state.printing;
}
async function upstreamRegistry(){
  if(state.registry)return state.registry;
  const url = new URL('../registry.json', document.baseURI);
  const res = await fetch(url.href);
  if(!res.ok)throw Error('Drucker-Liste nicht verfügbar (HTTP '+res.status+').');
  const reg = await res.json();
  if(!reg.models || !reg.sizes)throw Error('Drucker-Liste hat ein unerwartetes Format.');
  state.registry=reg; return reg;
}
function readSize(){
  if(!loaded())throw Error('Original-App nicht fertig geladen. Seite neu öffnen.');
  const modelKey=$('model').value; const sizeKey=$('size').value; const model=state.registry?.models[modelKey];
  let custom={};
  try{const m=JSON.parse(localStorage.getItem('niimbot-demo:custom-sizes')||'{}'); if(m && typeof m==='object' && !Array.isArray(m)) custom=m;}catch(e){}
  const size=state.registry?.sizes[sizeKey]||custom[sizeKey];
  if(!model||!size||size.w_px<1||size.h_px<1) throw Error('Bitte oben ein Druckermodell und ein gültiges Etikett auswählen.');
  if(size.dpi && model.dpi && size.dpi!==model.dpi) throw Error('Das gewählte Etikett ist nicht für dieses Druckermodell kalibriert.');
  return {model,size,sizeKey,modelKey,density:Number($('density').value)||model.density||3};
}
function loadScript(url){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.async=true;script.onload=resolve;script.onerror=()=>reject(Error('PDF-Bibliothek nicht geladen. Internetverbindung prüfen.'));document.head.appendChild(script);});}
async function pdfLib(){ if(state.pdfJs)return state.pdfJs; if(!window.pdfjsLib)await loadScript(PDF_URL); if(!window.pdfjsLib)throw Error('PDF.js ist nicht verfügbar.'); window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDF_WORKER; state.pdfJs=window.pdfjsLib; return state.pdfJs; }
function swap(i,j){ [state.queue[i],state.queue[j]]=[state.queue[j],state.queue[i]]; if(state.selected===i)state.selected=j; else if(state.selected===j)state.selected=i; showQueue(); }
function showQueue(){
  const root=$('dd-queue'); root.replaceChildren(); const total=state.queue.length; const copies=Math.max(1,Math.min(30,Number($('dd-copies').value)||1));
  $('dd-count').textContent=total+' Seite(n) · '+(total*copies)+' Etikett(en) inkl. Kopien';
  state.queue.forEach((entry,i)=>{
    const row=document.createElement('div'); row.className='dd-queueitem'; if(state.selected===i)row.style.borderColor='#155bb0';
    const im=document.createElement('div'); im.className='dd-thumb'; im.textContent=(entry.kind==='pdf'?'PDF':'IMG'); im.style.cssText+='display:grid;place-items:center;font-size:.65rem;font-weight:750;color:#64748b';
    const details=document.createElement('div');
    const title=document.createElement('div'); title.className='dd-title'; title.textContent=entry.name;
    const sub=document.createElement('div'); sub.className='dd-muted'; sub.textContent='Import: '+(entry.importDpi==='original'?'Original':entry.importDpi+' dpi');
    details.append(title,sub);
    const buttons=document.createElement('div'); buttons.className='dd-inline';
    const ops=[['Vorschau',()=>{state.selected=i;state.textSelectedId=null;state.activeImageId="image";showQueue();renderTextControls();setImagePanel(activeImageLayer(state.queue[i]));showPreview()},false],['↑',()=>swap(i,i-1),i===0],['↓',()=>swap(i,i+1),i===total-1],['×',()=>{revokeEntry(state.queue[i]);state.queue.splice(i,1);if(state.selected>=state.queue.length)state.selected=state.queue.length-1;state.textSelectedId=null;state.activeImageId="image";showQueue();renderTextControls();showPreview()},false]];
    for(const [label,action,disabled] of ops){const btn=document.createElement('button');btn.type='button';btn.textContent=label;btn.disabled=state.printing||disabled;btn.onclick=action;buttons.append(btn);}    
    row.append(im,details,buttons); root.append(row);
  }); buttonState();
}
function revokeEntry(entry){
 if(entry?.objectUrl){ URL.revokeObjectURL(entry.objectUrl); entry.objectUrl=''; }
 for(const img of entry?.images||[])revokeEntry(img);
}
function decodeBlob(blob){return new Promise((resolve,reject)=>{ const url=URL.createObjectURL(blob), img=new Image(); let settled=false; const done=(error)=>{ if(settled)return; settled=true; URL.revokeObjectURL(url); error?reject(error):resolve(img); }; img.onload=()=>done(); img.onerror=()=>done(Error('Bild konnte nicht dekodiert werden')); img.src=url; if(img.complete && img.naturalWidth)done(); });}
async function ensureImage(entry){
  if(entry.img?.naturalWidth)return entry.img;
  if(entry.imgPromise)return entry.imgPromise;
  entry.imgPromise=new Promise((resolve,reject)=>{
    if(!entry.objectUrl)entry.objectUrl=URL.createObjectURL(entry.blob);
    const img=new Image(); img.onload=()=>{entry.img=img; resolve(img)}; img.onerror=()=>reject(Error('Bildformat ist beschädigt oder nicht unterstützt')); img.src=entry.objectUrl;
  });
  return entry.imgPromise;
}
async function rasterizePdfPage(page, importMode){
  const dpi = importMode==='original' ? 144 : Number(importMode)||201;
  let scale = dpi/72; const base = page.getViewport({scale:1});
  const maxPixels = 8_000_000; if((base.width*scale)*(base.height*scale)>maxPixels) scale=Math.sqrt(maxPixels/(base.width*base.height));
  const viewport=page.getViewport({scale}); const canvas=document.createElement('canvas'); canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,background:'#ffffff'}).promise;
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PDF-Seite konnte nicht gerastert werden')),'image/png'));
  canvas.width=0; canvas.height=0; return blob;
}
function createImageLayer(blob,name,importMode){return {id:'img:'+Date.now().toString(36)+Math.random().toString(36).slice(2),kind:'image',blob,name,importDpi:importMode,locked:false,layouts:{},crop:{x:0,y:0,w:1,h:1,shape:'rect',preset:'free'}};}
async function addFiles(files,asLayersOverride=null){
 const input=Array.from(files||[]);if(!input.length)return;
 beginHistory('Dateien importieren');history.hold=true;state.importingFiles=true;
 let added=0;
 const importMode=$('dd-importdpi').value;
 const asLayers=asLayersOverride===null?$('dd-import-mode').value==='layers':Boolean(asLayersOverride);
 const autoCrop=$('dd-crop-onimport').checked;
 let target=state.queue[state.selected]||null;
 if(asLayers&&!target){history.hold=false;state.importingFiles=false;commitHistory();message('Bitte zunächst ein Etikett anlegen oder eine Datei normal importieren.',true);return;}
 for(const file of input){
  if(!asLayers&&state.queue.length>=MAX_PAGES){message('Maximal '+MAX_PAGES+' Etiketten pro Auftrag.',true);break;}
  if(file.size>FILE_LIMIT){message('Datei zu groß (max. 40 MB): '+file.name,true);continue;}
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  try{
   const addBlob=async(blob,name,kind)=>{
     let layer;
     if(asLayers){
       target.images||=[];layer=createImageLayer(blob,name,importMode);target.images.push(layer);
       layerOrder(target);state.activeImageId=layer.id;state.textSelectedId=null;
     }else{
       target={kind,blob,name,importDpi:importMode,layouts:{},texts:[],images:[],crop:{x:0,y:0,w:1,h:1,shape:'rect',preset:'free'}};
       state.queue.push(target);state.selected=state.queue.length-1;layer=target;
       state.activeImageId='image';state.textSelectedId=null;
     }
     added++;showQueue();renderTextControls();setImagePanel(layer);await showPreview();
     if(autoCrop)await openCropEditor(layer);
   };
   if(file.type==='application/pdf'||ext==='pdf'){
     message('PDF wird gelesen: '+file.name);
     const lib=await pdfLib(),doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
     const max=Math.min(doc.numPages,asLayers?MAX_PAGES:MAX_PAGES-state.queue.length);
     for(let page=1;page<=max;page++){
       const blob=await rasterizePdfPage(await doc.getPage(page),importMode);
       await addBlob(blob,file.name+' – Seite '+page,'pdf');
     }
   }else if(['png','jpg','jpeg'].includes(ext)||['image/png','image/jpeg'].includes(file.type)){
     await decodeBlob(file);await addBlob(file,file.name,'image');
   }else message('Dateityp nicht unterstützt: '+file.name,true);
  }catch(e){message('Datei konnte nicht verarbeitet werden: '+file.name+' – '+(e.message||e),true);}
 }
 if(added){showQueue();renderTextControls();setImagePanel(activeImageLayer(state.queue[state.selected]));requestPreview();message(added+' Bilddatei(en)/PDF-Seite(n) hinzugefügt. '+(asLayers?'Als frei verschiebbare Ebenen.':'Als eigene Etiketten.'));}
 history.hold=false;state.importingFiles=false;commitHistory();
}

function normalizedCrop(layer){
 const c=layer?.crop||{};return {x:Math.max(0,Math.min(.999,Number(c.x)||0)),y:Math.max(0,Math.min(.999,Number(c.y)||0)),w:Math.max(.001,Math.min(1,Number(c.w)||1)),h:Math.max(.001,Math.min(1,Number(c.h)||1)),shape:c.shape==='circle'?'circle':'rect',preset:c.preset||'free'};
}
function refSize(entry,img,size){
 const c=normalizedCrop(entry),w=img.naturalWidth*c.w,h=img.naturalHeight*c.h;
 if(entry.importDpi==='300'||entry.importDpi==='201'){
  const dpi=Number(entry.importDpi);return {w:w*(size.dpi/dpi),h:h*(size.dpi/dpi)};
 }
 return {w,h};
}

function initLayout(entry,sizeInfo,img,mode){
  const ref=refSize(entry,img,sizeInfo.size); const fit=mode || $('dd-fit').value; let scale=(fit==='cover'?Math.max(sizeInfo.size.w_px/ref.w,sizeInfo.size.h_px/ref.h):Math.min(sizeInfo.size.w_px/ref.w,sizeInfo.size.h_px/ref.h));
  if(!isFinite(scale)||scale<=0)scale=1; entry.layouts ||= {}; entry.layouts[sizeInfo.sizeKey]={tx:0,ty:0,scale,baseScale:scale,rotation:0,refW:ref.w,refH:ref.h}; return entry.layouts[sizeInfo.sizeKey];
}
async function getLayout(entry,sizeInfo,modeIfInit){ const img=await ensureImage(entry); let layout=entry.layouts?.[sizeInfo.sizeKey]; const ref=refSize(entry,img,sizeInfo.size); if(!layout || Math.abs(layout.refW-ref.w)>.001 || Math.abs(layout.refH-ref.h)>.001) layout=initLayout(entry,sizeInfo,img,modeIfInit); return {img,layout}; }
// The image and text are rasterized by the SAME function for screen and printer.
function clampScale(v){ return Math.max(.015,Math.min(50,Number(v)||1)); }
function normalizeAngle(a){ return (((Number(a)||0)+180)%360+360)%360-180; }
function degrees(angle){ return (Number(angle)||0)*Math.PI/180; }
function updateEditorViewport(size){
 const canvas=$('dd-editor'),wrap=$('dd-editorwrap');if(!canvas||!wrap)return;
 const wrapW=Math.max(230,Math.round(wrap.clientWidth||canvas.clientWidth||320));
 const ratio=size?Math.max(.3,Math.min(2.9,size.h_px/size.w_px)):.75;
 const mobile=window.innerWidth<=520;
 const h=Math.max(mobile?330:405,Math.min(mobile?690:790,Math.round(wrapW*Math.max(.75,ratio)+115)));
 canvas.style.height=h+'px';
 // The slider is deliberately compact and does not stretch with the canvas.
}

function editorSize(){ const c=$('dd-editor'),dpr=Math.max(1,window.devicePixelRatio||1); const cssW=Math.max(260,Math.round(c.clientWidth||320)),cssH=Math.max(240,Math.round(c.clientHeight||320)); c.width=Math.round(cssW*dpr);c.height=Math.round(cssH*dpr);const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,cssW,cssH}; }
function cropForViewport(cssW,cssH,size,viewZoom=1){
 const pad=Math.max(24,Math.round(Math.min(cssW,cssH)*.09));
 const fit=Math.min((cssW-2*pad)/size.w_px,(cssH-2*pad)/size.h_px);
 const previewScale=fit*.91*Math.max(.2,Math.min(2.5,Number(viewZoom)||1));
 const w=size.w_px*previewScale,h=size.h_px*previewScale;
 return {x:(cssW-w)/2,y:(cssH-h)/2,w,h,scale:previewScale};
}

function rotatedPoint(cx,cy,dx,dy,deg){ const r=degrees(deg),co=Math.cos(r),si=Math.sin(r);return {x:cx+dx*co-dy*si,y:cy+dx*si+dy*co}; }
function imageRect(layout,sizeInfo,crop){ const {size}=sizeInfo;const scale=crop.scale;const cx=crop.x+crop.w/2+layout.tx*scale,cy=crop.y+crop.h/2+layout.ty*scale;const halfW=layout.refW*layout.scale*scale/2,halfH=layout.refH*layout.scale*scale/2;return {cx,cy,halfW,halfH,angle:layout.rotation||0,tl:rotatedPoint(cx,cy,-halfW,-halfH,layout.rotation),tr:rotatedPoint(cx,cy,halfW,-halfH,layout.rotation),br:rotatedPoint(cx,cy,halfW,halfH,layout.rotation),bl:rotatedPoint(cx,cy,-halfW,halfH,layout.rotation)}; }
function textScale(t){return Math.max(.05,Math.min(40,Number(t?.zoomScale)||1));}
function canvasFont(ctx,t){ let fontSize=Math.max(4,Math.min(600,Number(t.size)||30));const family=(t.font||'system:sans-serif').startsWith('system:')?(t.font||'system:sans-serif').slice(7):(state.fonts.find(f=>f.id===t.font)?.family||'sans-serif');const bold=t.bold?'bold ':'',italic=t.italic?'italic ':'';ctx.font=`${italic}${bold}${fontSize}px "${family.replace(/"/g,'')}\", sans-serif`; return fontSize; }
function glyphWidth(ctx,text,spacing){ const chars=Array.from(text); return ctx.measureText(text).width + Math.max(0,chars.length-1)*(Number(spacing)||0); }
function splitLines(ctx,text,maxWidth,letterSpacing){ const result=[];for(const original of String(text||' ').split(/\r?\n/)){
  const words=original.split(/(\s+)/).filter(s=>s.length>0);let line='';if(!words.length){result.push(' ');continue;}
  for(const word of words){const candidate=line+word;if(glyphWidth(ctx,candidate,letterSpacing)<=maxWidth){line=candidate;continue;}
    if(line.trim()){result.push(line.trimEnd());line='';}
    if(glyphWidth(ctx,word,letterSpacing)<=maxWidth){line=word.trimStart();continue;}
    for(const char of Array.from(word)){const candidate2=line+char;if(glyphWidth(ctx,candidate2,letterSpacing)>maxWidth&&line){result.push(line);line=char;}else line=candidate2;}
  } result.push(line||' ');
 }return result.slice(0,120);}
function imageIds(entry){return (entry.images||[]).map(im=>im.id);}
function allImages(entry){return (entry.kind==='blank'?[]:[{id:'image',layer:entry}]).concat((entry.images||[]).map(layer=>({id:layer.id,layer})));}
function imageForId(entry,id){if(!entry||!id)return null;if(id==='image')return entry.kind==='blank'?null:entry;return (entry.images||[]).find(im=>im.id===id)||null;}
function activeImageLayer(entry){
 if(!entry)return null;
 const image=imageForId(entry,state.activeImageId);
 return image||allImages(entry)[0]?.layer||null;
}
function setActiveImage(entry,id){
 if(layerLocked(entry,id))return;
 state.textSelectedId=null;
 state.activeImageId=imageForId(entry,id)?id:(allImages(entry)[0]?.id||'image');
 renderTextControls();setImagePanel(activeImageLayer(entry));requestPreview();
}
function getLayerObject(entry,id){
 if(!entry)return null;
 return imageForId(entry,id)||(entry.texts||[]).find(t=>t.id===id)||null;
}
function layerLocked(entry,id){return !!getLayerObject(entry,id)?.locked;}
function selectedLocked(){const entry=state.queue[state.selected];return !!entry && layerLocked(entry,state.textSelectedId||state.activeImageId);}
function unlockRequired(){if(selectedLocked()){message('Diese Ebene ist gesperrt. Bitte zuerst über das Schloss in der Ebenenliste entsperren.',true);return false;}return true;}
function toggleLayerLock(id){
 const entry=state.queue[state.selected],layer=getLayerObject(entry,id);if(!layer||state.printing)return;
 layer.locked=!layer.locked;
 if(layer.locked){
  if(state.textSelectedId===id)state.textSelectedId=null;
  if(state.activeImageId===id)state.activeImageId=allImages(entry).find(x=>!x.layer.locked)?.id||id;
  state.editor.mode=null;state.editor.start=null;state.editor.pointers.clear();
 }
 renderTextControls();setImagePanel(activeImageLayer(entry));requestPreview();
 message(layer.locked?'Ebene gesperrt – bleibt sichtbar und wird gedruckt.':'Ebene entsperrt – wieder bearbeitbar.');
}
function layerOrder(entry){
 const all=(entry.kind==='blank'?[]:['image']).concat(imageIds(entry),(entry.texts||[]).map(t=>t.id));
 entry.layers ||= [...all];
 entry.layers=entry.layers.filter(id=>all.includes(id));
 for(const id of all)if(!entry.layers.includes(id))entry.layers.push(id);
 return entry.layers;
}
function selectLayer(id){
 const entry=state.queue[state.selected];if(!entry||layerLocked(entry,id))return;
 if(id==='image'||id.startsWith('img:'))setActiveImage(entry,id);
 else{state.textSelectedId=id;renderTextControls();requestPreview();}
}
function moveLayer(id,position){
 const entry=state.queue[state.selected];if(!entry||layerLocked(entry,id))return;const order=layerOrder(entry),i=order.indexOf(id);if(i<0)return;
 order.splice(i,1);const target=position==='front'?order.length:position==='back'?0:Math.max(0,Math.min(order.length,i+position));order.splice(target,0,id);renderTextControls();requestPreview();
}
function removeImageLayer(id){
 const entry=state.queue[state.selected];if(!entry||state.printing||layerLocked(entry,id))return;
 if(id==='image'){
   revokeEntry(entry);entry.kind='blank';entry.img=null;entry.imgPromise=null;entry.layouts={};
 }else{const idx=(entry.images||[]).findIndex(im=>im.id===id);if(idx<0)return;revokeEntry(entry.images[idx]);entry.images.splice(idx,1);}
 entry.layers=(entry.layers||[]).filter(x=>x!==id);
 if(state.activeImageId===id)state.activeImageId=allImages(entry).at(-1)?.id||'image';
 renderTextControls();setImagePanel(activeImageLayer(entry));requestPreview();
}
function renderLayerControls(){
 const entry=state.queue[state.selected],root=$('dd-layers');if(!root)return;root.replaceChildren();if(!entry)return;
 const order=layerOrder(entry);
 [...order].reverse().forEach(id=>{
  const text=(entry.texts||[]).find(t=>t.id===id),im=imageForId(entry,id),row=document.createElement('div');row.className='dd-layer';
  row.dataset.selected=String((!state.textSelectedId&&state.activeImageId===id)||(state.textSelectedId===id));
  const title=document.createElement('label');title.textContent=im?'🖼️ '+(id==='image'?entry.name:im.name||'Bild'):('🔤 '+(text?.text||'Textfeld').replace(/\s+/g,' ').slice(0,30));
  const sel=document.createElement('button');sel.type='button';sel.textContent='Wählen';sel.disabled=layerLocked(entry,id);sel.onclick=()=>selectLayer(id);
  const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='Eine Ebene nach vorne';up.disabled=order.at(-1)===id||layerLocked(entry,id);up.onclick=()=>moveLayer(id,1);
  const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='Eine Ebene nach hinten';down.disabled=order[0]===id||layerLocked(entry,id);down.onclick=()=>moveLayer(id,-1);
  const locked=layerLocked(entry,id);row.dataset.locked=String(locked);
  const lock=document.createElement('button');lock.type='button';lock.className='dd-lock-toggle';lock.dataset.layerId=id;
  lock.textContent=locked?'🔒':'🔓';lock.title=locked?'Ebene entsperren':'Ebene gegen Änderungen sperren';
  lock.setAttribute('aria-label',lock.title);lock.setAttribute('aria-pressed',String(locked));
  lock.onclick=()=>toggleLayerLock(id);
  row.append(title,lock,sel,up,down);
  if(im){const crop=document.createElement('button');crop.type='button';crop.textContent='✂';crop.title='Diese Bilddatei zuschneiden';crop.disabled=locked;crop.onclick=()=>{setActiveImage(entry,id);openCropEditor(im);};row.append(crop);
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Bildebene entfernen';remove.disabled=locked;remove.onclick=()=>removeImageLayer(id);row.append(remove);}
  root.append(row);
 });
 const active=activeImageLayer(entry);if($('dd-active-image'))$('dd-active-image').textContent=state.textSelectedId?'Aktiv: Textfeld':active?'Aktives Bild: '+(active.name||entry.name)+' · Bild- und Beschnittwerte gelten nur für diese Ebene':'Kein Bild ausgewählt';
 if($('dd-crop-image'))$('dd-crop-image').disabled=!active||state.printing||!!active.locked;
}

function splitLinesByMode(ctx,text,maxWidth,spacing,mode){
 if(mode==='off')return String(text||' ').split(/\r?\n/).slice(0,120);
 if(mode==='char'){
   const lines=[];for(const original of String(text||' ').split(/\r?\n/)){
     let line='';for(const ch of Array.from(original)){if(line&&glyphWidth(ctx,line+ch,spacing)>maxWidth){lines.push(line);line='';}line+=ch;}lines.push(line||' ');
   }return lines.slice(0,120);
 }
 return splitLines(ctx,text,maxWidth,spacing);
}
function textFlow(t){ return t?.flow||'horizontal'; }
function curveTextContent(t){ return String(t?.text||' ').replace(/\s*\r?\n\s*/g,' ').trim() || ' '; }
function verticalLines(t){ const chars=Array.from(String(t?.text||' ').replace(/\r/g,'')); const out=[]; for(const ch of chars){ if(ch==='\n') continue; out.push(ch===' ' ? ' ' : ch); } return out.length ? out.slice(0,220) : [' ']; }
function normalizeCurveDeg(v){ const n=Number(v); return Number.isFinite(n)?Math.max(-360,Math.min(360,n)):180; }
function curveRadiusForBox(width,height,fs){ return Math.max(fs*1.05, Math.min(width,height)*0.5 - fs*0.95 - 6); }
function curvePlacement(t){ return ['top','bottom','circle'].includes(t?.curvePlacement)?t.curvePlacement:'top'; }
function curveFacing(t){ return t?.curveFacing==='inside'?'inside':'outside'; }
function effectiveCurveRadius(t,g){ const manual=Number(t?.curveRadius)||0; return manual>0 ? Math.max(g.fs*0.9,manual) : curveRadiusForBox(g.boxWidth,g.boxHeight,g.fs); }
function textGeometry(ctx,t,labelW){
 ctx.save();let fs=canvasFont(ctx,t),spacing=Number(t.letterSpace)||0;
 const desiredW=Number(t.boxW)||Math.max(30,labelW*Math.max(.1,Math.min(2,(Number(t.widthPct)||85)/100)));
 const boxWidth=Math.min(4000,Math.max(20,desiredW));
 const flow=textFlow(t), available=Math.max(4,boxWidth-10);
 let lines;
 if(flow==='curve') lines=[curveTextContent(t)];
 else if(flow==='vertical') lines=verticalLines(t);
 else lines=splitLinesByMode(ctx,t.text,available,spacing,t.wrap||'word');
 if(t.autoFit){
   const wantedMaxHeight=Math.max(20,Number(t.boxH)||1e6);
   for(let j=0;j<45;j++){
     let width,height;
     if(flow==='curve'){
       width=Math.min(boxWidth-10, Math.max(...lines.map(s=>glyphWidth(ctx,s,spacing))));
       height=Math.max(fs*2.8, Math.min(boxWidth, boxWidth*.95));
     }else{
       width=Math.max(...lines.map(s=>glyphWidth(ctx,s,spacing)));
       height=lines.length*fs*Math.max(.7,Math.min(3,(Number(t.lineHeight)||120)/100));
     }
     if(width<=available && height<=wantedMaxHeight-8)break;
     fs=Math.max(4,fs*.95);canvasFont(ctx,{...t,size:fs});
     if(flow==='curve') lines=[curveTextContent(t)];
     else if(flow==='vertical') lines=verticalLines(t);
     else lines=splitLinesByMode(ctx,t.text,available,spacing,t.wrap||'word');
   }
 }
 const lineHeight=fs*Math.max(.7,Math.min(3,(Number(t.lineHeight)||120)/100));
 let naturalH=lines.length*lineHeight+10;
 if(flow==='curve') naturalH=Math.max(fs*2.8, Math.min(boxWidth, Math.max(Number(t.curveRadius)||0,boxWidth*.92)));
 const boxHeight=Math.min(4000,Math.max(20,Number(t.boxH)||naturalH));
 ctx.restore();return {lines,fs,lineHeight,boxWidth,boxHeight,spacing,flow,curveDeg:Math.abs(normalizeCurveDeg(t.curveDeg))};
}
function drawSpacedText(ctx,str,x,y,spacing){ if(!spacing){ctx.fillText(str,x,y);return;} for(const ch of Array.from(str)){ctx.fillText(ch,x,y);x+=ctx.measureText(ch).width+spacing;} }
function drawCurvedTextItem(ctx,t,g){
 const text=g.lines[0]||' ';
 const chars=Array.from(text);
 const theta=degrees(Math.abs(g.curveDeg||180));
 if(theta<0.001 || chars.length===0){ drawSpacedText(ctx,text,-glyphWidth(ctx,text,g.spacing)/2,0,g.spacing); return; }
 const placement=curvePlacement(t), facing=curveFacing(t), radius=effectiveCurveRadius(t,g);
 const weights=chars.map(ch=>Math.max(0.0001, ctx.measureText(ch).width + (g.spacing||0)));
 const total=weights.reduce((a,b)=>a+b,0) || 1;
 let startAngle, direction, rotationOffset;
 if(placement==='bottom'){
   startAngle=Math.PI + theta/2;
   direction=-1;
   rotationOffset=(facing==='outside') ? Math.PI : 0;
 }else if(placement==='circle'){
   startAngle=-theta/2;
   direction=1;
   rotationOffset=(facing==='outside') ? 0 : Math.PI;
 }else{
   startAngle=-theta/2;
   direction=1;
   rotationOffset=(facing==='outside') ? 0 : Math.PI;
 }
 let cursor=startAngle;
 ctx.textAlign='center'; ctx.textBaseline='middle';
 chars.forEach((ch,idx)=>{
   const span=theta*(weights[idx]/total), mid=cursor + direction*span/2;
   const x=Math.sin(mid)*radius, y=-Math.cos(mid)*radius;
   const rot=mid + rotationOffset;
   ctx.save();
   ctx.translate(x,y);
   ctx.rotate(rot);
   ctx.fillText(ch,0,0);
   if(t.underline){ const w=Math.max(1,ctx.measureText(ch).width); ctx.fillRect(-w/2,g.fs*.43,w,Math.max(1,g.fs*.055)); }
   if(t.strike){ const w=Math.max(1,ctx.measureText(ch).width); ctx.fillRect(-w/2,g.fs*.03,w,Math.max(1,g.fs*.055)); }
   ctx.restore();
   cursor += direction*span;
 });
}
function drawTextItem(ctx,t,labelW,{guides=false}={}){
 ctx.save();ctx.translate(t.x,t.y);ctx.rotate(degrees(t.rotation));ctx.scale(textScale(t),textScale(t));
 const g=textGeometry(ctx,t,labelW);canvasFont(ctx,{...t,size:g.fs});ctx.textBaseline='middle';
 const width=g.boxWidth,height=g.boxHeight;
 if(t.inverse){ctx.fillStyle='#000';ctx.fillRect(-width/2,-height/2,width,height);ctx.fillStyle='#fff';}
 else ctx.fillStyle='#000';
 ctx.save();ctx.beginPath();ctx.rect(-width/2,-height/2,width,height);ctx.clip();
 if(g.flow==='curve'){
   drawCurvedTextItem(ctx,t,g);
 }else{
   const totalH=g.lines.length*g.lineHeight,top=(t.vertical==='top'?-height/2+5:t.vertical==='bottom'?height/2-totalH-5:-totalH/2);
   g.lines.forEach((line,index)=>{
     const lineW=glyphWidth(ctx,line,g.spacing),left=t.align==='left'||t.align==='justify'?-width/2+5:t.align==='right'?width/2-5-lineW:-lineW/2,y=top+(index+.5)*g.lineHeight;
     if(t.align==='justify' && index<g.lines.length-1 && line.trim().includes(' ')){
        const parts=line.trim().split(/(\s+)/);let x=left;const extra=Math.max(0,(width-10-lineW)/(parts.filter(v=>/^\s+$/.test(v)).length||1));
        for(const part of parts){drawSpacedText(ctx,part,x,y,g.spacing);x+=glyphWidth(ctx,part,g.spacing)+(/^\s+$/.test(part)?extra:0);}
     }else drawSpacedText(ctx,line,left,y,g.spacing);
     if(t.underline)ctx.fillRect(left,y+g.fs*.43,Math.max(1,lineW),Math.max(1,g.fs*.055));
     if(t.strike)ctx.fillRect(left,y+g.fs*.03,Math.max(1,lineW),Math.max(1,g.fs*.055));
   });
 }
 ctx.restore();
 if(guides){ctx.strokeStyle='#0ea5e9';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.strokeRect(-width/2,-height/2,width,height);}
 ctx.restore();return g;
}
const ADJUST_DEFAULTS={exposure:0,contrast:0,blacks:0,whites:0,brightness:0,saturation:0,gamma:1,threshold:160,mode:'default'};
const ADJUST_KEYS=['exposure','contrast','blacks','whites','brightness','saturation','gamma','threshold'];
function imageAdjustments(entry){return entry.adjustments ||= {...ADJUST_DEFAULTS};}
function adjustFormat(key,value){return key==='gamma'?Number(value).toFixed(2):String(Math.round(Number(value)));}
function adjustNormalize(key,value){
 const slider=$('dd-'+key), min=Number(slider.min),max=Number(slider.max),step=Number(slider.step)||1;
 const finite=Number(value);if(!Number.isFinite(finite))return null;
 // Integer step indexing avoids accumulating 0.05 floating-point errors for gamma.
 const clamped=Math.max(min,Math.min(max,finite));
 return Number((min+Math.round((clamped-min)/step)*step).toFixed(key==='gamma'?2:0));
}
function syncAdjustControl(key,value,{preserveNumberFocus=false}={}){
 const slider=$('dd-'+key),number=$('dd-'+key+'-number'),display=$('dd-'+key+'-value');
 const normalized=adjustNormalize(key,value);if(normalized===null)return;
 slider.value=String(normalized);
 if(!preserveNumberFocus || document.activeElement!==number)number.value=String(normalized);
 display.textContent=adjustFormat(key,normalized);
 $('dd-'+key+'-minus').disabled=normalized<=Number(slider.min);
 $('dd-'+key+'-plus').disabled=normalized>=Number(slider.max);
}
function setImageAdjustValue(key,value,{preserveNumberFocus=false}={}){
 const normalized=adjustNormalize(key,value);
 if(normalized===null)return false;
 const entry=activeImageLayer(state.queue[state.selected]);
 if(!entry||entry.locked)return false;
 imageAdjustments(entry)[key]=normalized;
 syncAdjustControl(key,normalized,{preserveNumberFocus});
 requestPreview();
 return true;
}
function setImagePanel(entry){
 const values=entry?imageAdjustments(entry):ADJUST_DEFAULTS;
 for(const key of ADJUST_KEYS){
   syncAdjustControl(key, values[key] ?? ADJUST_DEFAULTS[key]);
   // No-op editing on an empty queue is confusing, so deactivate inputs until a label exists.
   for(const el of [$('dd-'+key),$('dd-'+key+'-number'),$('dd-'+key+'-minus'),$('dd-'+key+'-plus')])el.disabled=!entry;
   if(entry)syncAdjustControl(key, values[key] ?? ADJUST_DEFAULTS[key]);
 }
 $('dd-bw').value=values.mode||'default';
 const disabled=!entry||!!entry.locked;
 $('dd-bw').disabled=disabled;$('dd-adjust-reset').disabled=disabled;
 for(const key of ADJUST_KEYS){for(const suffix of ['', '-number','-minus','-plus'])$('dd-'+key+suffix).disabled=disabled;}

}
function clamp01(v){return Math.max(0,Math.min(1,v));}
function applyAdjustments(ctx,w,h,a){
 const img=ctx.getImageData(0,0,w,h),px=img.data;
 const brightness=(Number(a.brightness)||0)/100, exposure=Math.pow(2,(Number(a.exposure)||0)/45),contrast=(Number(a.contrast)||0)/100;
 const black=(Number(a.blacks)||0)/100,white=(Number(a.whites)||0)/100,sat=1+(Number(a.saturation)||0)/100,gamma=Number(a.gamma)||1;
 const gray=a.mode==='gray',hard=a.mode==='bw',threshold=Number(a.threshold??160);
 for(let i=0;i<px.length;i+=4){if(!px[i+3])continue;
   let r=px[i]/255,g=px[i+1]/255,b=px[i+2]/255;
   const l=.2126*r+.7152*g+.0722*b;
   r=clamp01(l+(r-l)*sat);g=clamp01(l+(g-l)*sat);b=clamp01(l+(b-l)*sat);
   if(gray||hard){const v=.2126*r+.7152*g+.0722*b;r=g=b=v;}
   const adj=v=>{v=clamp01(v*exposure+brightness);
     v=clamp01(.5+(v-.5)*(contrast>=0?1+contrast*2:1/(1-contrast*2)));
     v=clamp01(v-black*Math.pow(1-v,2)*.75+white*Math.pow(v,2)*.75);
     return clamp01(Math.pow(v,1/gamma));};
   r=adj(r);g=adj(g);b=adj(b);
   if(hard){r=g=b=(.2126*r+.7152*g+.0722*b)*255<threshold?0:1;}
   px[i]=Math.round(r*255);px[i+1]=Math.round(g*255);px[i+2]=Math.round(b*255);
 }
 ctx.putImageData(img,0,0);
}
function drawImageAtLayout(ctx,img,layout,pxPerLabel=1,view=null,layer=null){
 const cx=view?view.x+view.w/2+layout.tx*pxPerLabel:ctx.canvas.width/2+layout.tx;
 const cy=view?view.y+view.h/2+layout.ty*pxPerLabel:ctx.canvas.height/2+layout.ty;
 const w=layout.refW*layout.scale*pxPerLabel,h=layout.refH*layout.scale*pxPerLabel;
 const c=normalizedCrop(layer),sx=img.naturalWidth*c.x,sy=img.naturalHeight*c.y,sw=img.naturalWidth*Math.min(c.w,1-c.x),sh=img.naturalHeight*Math.min(c.h,1-c.y);
 ctx.save();ctx.translate(cx,cy);ctx.rotate(degrees(layout.rotation));ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 if(c.shape==='circle'){ctx.beginPath();ctx.ellipse(0,0,w/2,h/2,0,0,Math.PI*2);ctx.clip();}
 ctx.drawImage(img,sx,sy,sw,sh,-w/2,-h/2,w,h);ctx.restore();
}
function rasterizeImageLayer(layer,sizeInfo,img,layout){
 const c=document.createElement('canvas');c.width=Math.round(sizeInfo.size.w_px);c.height=Math.round(sizeInfo.size.h_px);
 const ctx=c.getContext('2d',{willReadFrequently:true});ctx.clearRect(0,0,c.width,c.height);
 drawImageAtLayout(ctx,img,layout,1,null,layer);
 applyAdjustments(ctx,c.width,c.height,imageAdjustments(layer));
 return c;
}

async function renderLabelCanvas(entry,sizeInfo){
 const {size}=sizeInfo,canvas=document.createElement('canvas');canvas.width=Math.round(size.w_px);canvas.height=Math.round(size.h_px);
 if(canvas.width*canvas.height>12_000_000)throw Error('Etikett ist zu groß (max. 12 Millionen Pixel)');
 const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 for(const id of layerOrder(entry)){
   const layer=imageForId(entry,id);
   if(layer){const {img,layout}=await getLayout(layer,sizeInfo);const raster=rasterizeImageLayer(layer,sizeInfo,img,layout);ctx.drawImage(raster,0,0);raster.width=raster.height=0;}
   else{const t=(entry.texts||[]).find(t=>t.id===id);if(t)drawTextItem(ctx,t,canvas.width);}
 }
 return canvas;
}

let previewFrame=0;
function requestPreview(){if(previewFrame)return;previewFrame=requestAnimationFrame(()=>{previewFrame=0;showPreview();});}
function setRotationField(layout){
 const t=selectedText(),a=Math.round(t ? (t.rotation||0) : (layout.rotation||0));
 for(const id of ['dd-rotation','dd-rotation-num'])if(document.activeElement!==$(id))$(id).value=String(a);
 if(t && document.activeElement!==$('dd-textrotation'))$('dd-textrotation').value=String(a);
}
function setZoomField(layout){
 const t=selectedText(),zoom=t ? textScale(t)*100 : layout.scale/(layout.baseScale||1)*100;
 const value=String(Math.max(5,Math.round(zoom)));
 if(document.activeElement!==$('dd-zoom'))$('dd-zoom').value=value;
 if(t && $('dd-textzoom') && document.activeElement!==$('dd-textzoom'))$('dd-textzoom').value=value;
 $('dd-transform-target').textContent=t?'Aktiv: Textfeld – Zoom und Rotation wirken auf den Text samt Rahmen':'Aktiv: Bild – Zoom und Rotation wirken auf die importierte Datei';
}
function setPreviewZoomUi(){ const el=$('dd-viewzoom'),out=$('dd-viewzoom-value'); if(!el||!out)return; const value=Math.round((Number(state.viewZoom)||1)*100); if(document.activeElement!==el)el.value=String(value); out.textContent=value+'%'; }
async function showPreview(){
 const version=++state.previewVersion;
 const entry=state.queue[state.selected];
 if(!entry){updateEditorViewport(null);const {ctx,cssW,cssH}=editorSize();ctx.fillStyle='#e9eef5';ctx.fillRect(0,0,cssW,cssH);ctx.fillStyle='#64748b';ctx.font='15px sans-serif';ctx.textAlign='center';ctx.fillText('Datei oder leeres Etikett hinzufügen',cssW/2,cssH/2);$('dd-preview-title').textContent='Ausschnitt & Druckvorschau';state.editor.crop=null;return;}
 $('dd-preview-title').textContent='Ausschnitt & Druckvorschau: '+entry.name;
 try{
  if(!state.registry)await upstreamRegistry();const sizeInfo=readSize();updateEditorViewport(sizeInfo.size);
  const {ctx,cssW,cssH}=editorSize();
  const active=activeImageLayer(entry),activeResult=active?await getLayout(active,sizeInfo):null;
  if(version!==state.previewVersion)return;
  const crop=cropForViewport(cssW,cssH,sizeInfo.size,state.viewZoom);
  state.editor.crop=crop;state.editor.sizeInfo=sizeInfo;state.editor.entry=entry;
  ctx.fillStyle='#d9dee7';ctx.fillRect(0,0,cssW,cssH);
  // One composite render is used for both label preview and printing.
  const label=await renderLabelCanvas(entry,sizeInfo);
  if(version!==state.previewVersion){label.width=label.height=0;return;}
  ctx.drawImage(label,crop.x,crop.y,crop.w,crop.h);label.width=label.height=0;
  ctx.save();ctx.strokeStyle='#f43f5e';ctx.lineWidth=2.5;ctx.setLineDash([6,5]);ctx.strokeRect(crop.x,crop.y,crop.w,crop.h);ctx.restore();
  const selected=selectedText();state.editor.imageHandle=null;state.editor.textHandles=null;
  if(active&&activeResult&&!selected&&!active.locked){
   const layout=activeResult.layout,r=imageRect(layout,sizeInfo,crop);state.editor.imageHandle={...r,id:state.activeImageId};
   ctx.save();ctx.strokeStyle='#155eef';ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(r.tl.x,r.tl.y);ctx.lineTo(r.tr.x,r.tr.y);ctx.lineTo(r.br.x,r.br.y);ctx.lineTo(r.bl.x,r.bl.y);ctx.closePath();ctx.stroke();
   for(const [pos,symbol] of [[r.tl,'↻'],[r.br,'↘']]){
    ctx.beginPath();ctx.arc(pos.x,pos.y,12,0,Math.PI*2);ctx.fillStyle='#098bd3';ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 15px sans-serif';ctx.fillStyle='white';ctx.fillText(symbol,pos.x,pos.y+.5);
   }ctx.restore();
  }
  if(selected&&!selected.locked){
   const g=textGeometry(ctx,selected,sizeInfo.size.w_px),cx=crop.x+selected.x*crop.scale,cy=crop.y+selected.y*crop.scale;
   const rad=selected.rotation||0,ts=textScale(selected),corners=[[-g.boxWidth/2,-g.boxHeight/2],[g.boxWidth/2,-g.boxHeight/2],[g.boxWidth/2,g.boxHeight/2],[-g.boxWidth/2,g.boxHeight/2]].map(([x,y])=>rotatedPoint(cx,cy,x*crop.scale*ts,y*crop.scale*ts,rad));
   ctx.save();ctx.strokeStyle='#0887de';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);for(let n=1;n<4;n++)ctx.lineTo(corners[n].x,corners[n].y);ctx.closePath();ctx.stroke();
   const w=rotatedPoint(cx,cy,g.boxWidth/2*crop.scale*ts,0,rad),h=rotatedPoint(cx,cy,0,g.boxHeight/2*crop.scale*ts,rad),wh=corners[2],rotate=corners[0];
   for(const [kind,pt,symbol] of [['rotate',rotate,'↻'],['width',w,'↔'],['height',h,'↕'],['both',wh,'⤡']]){
    ctx.beginPath();ctx.arc(pt.x,pt.y,11,0,Math.PI*2);ctx.fillStyle='#0a8ad9';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(symbol,pt.x,pt.y+.5);
   }
   state.editor.textHandles={rotate,width:w,height:h,both:wh,cx,cy,rotation:rad};ctx.restore();
  }
  setRotationField(activeResult?.layout||{scale:1,baseScale:1,rotation:0});setZoomField(activeResult?.layout||{scale:1,baseScale:1,rotation:0});setPreviewZoomUi();
 }catch(e){if(version!==state.previewVersion)return;message('Vorschau nicht verfügbar: '+(e.message||e),true);}
}

async function learnRollAfterPrint(size,sizeKey){ if(!window.labelMemory||!window.Niimbot?.printer)return; try{ const result=await Niimbot.getStatus(); const rfid=result?.decoded?.rfid; if(!rfid?.tagPresent||!rfid.barCode)return; const prev=window.labelMemory.recall(rfid.barCode)||{}; const mm=Number(size.w_mm)>0&&Number(size.h_mm)>0; const rec={...prev,...(mm?{w_mm:size.w_mm,h_mm:size.h_mm}:{size:sizeKey})}; if(mm)delete rec.size; else{delete rec.w_mm;delete rec.h_mm;} window.labelMemory.remember(rfid.barCode,rec); }catch(e){ console.log('[dragdrop] RFID nach Druck nicht abrufbar:',e.message||e);} }
async function printAll(){
  if(state.printing||!state.queue.length)return; state.printing=true; state.stop=false; showQueue(); const originalIds=['print','printreal','print3copies','print3','print5','print3dense','print5dense','identify','disconnect','readstatus','rollread','rollsave']; const originals=originalIds.map(id=>$(id)).filter(Boolean).map(node=>[node,node.disabled]); originals.forEach(([node])=>node.disabled=true);
  try{
    await upstreamRegistry(); const sizeInfo=readSize(); const {model,size,density,sizeKey}=sizeInfo;
    if(!Niimbot.isSupported())throw Error('Dieser Browser stellt kein Web Bluetooth bereit. Bitte die HTTPS-Adresse in Bluefy öffnen.');
    const printer=Niimbot.printer; if(!printer)throw Error('Bitte zuerst mit „Connect & identify printer“ oben verbinden und Drucker auswählen.'); if(Number(printer.modelId)!==Number(model.id))throw Error('Verbundenes Modell passt nicht zur Auswahl. Bitte Modell oben prüfen.');
    const copies=Math.max(1,Math.min(30,Number($('dd-copies').value)||1)); const total=state.queue.length*copies; let completed=0;
    for(let i=0;i<state.queue.length;i++){
      if(state.stop)break; const entry=state.queue[i]; message('Bereite vor: '+(i+1)+'/'+state.queue.length+' – '+entry.name); const canvas=await renderLabelCanvas(entry,sizeInfo); const url=canvas.toDataURL('image/png'); canvas.width=0; canvas.height=0;
      if(copies===1){ message('Drucke '+(completed+1)+' von '+total+' …'); await Niimbot.printImage(url,{model,size,density,onProgress:s=>{if(s!=='ok')$('dd-state').textContent='Druckstatus: '+String(s);}}); completed+=1; }
      else{ const chunk=Array.from({length:copies},()=>url); message('Drucke '+(completed+1)+'–'+(completed+copies)+' von '+total+' …'); await Niimbot.printBatch(chunk,{model,size,density,onProgress:s=>{if(s!=='ok')$('dd-state').textContent='Druckstatus: '+String(s);}}); completed+=copies; }
      $('dd-progress').value=100*completed/total; message('Bestätigt: '+completed+' von '+total+' Etiketten');
    }
    if(state.stop)message('Druck angehalten. '+completed+' von '+total+' Etiketten vom Drucker bestätigt.'); else { await learnRollAfterPrint(size,sizeKey); message('Fertig: '+completed+' Etiketten bestätigt. Rolle ggf. gespeichert.'); }
  }catch(e){ message('Druckfehler: '+(e.message||e)+'\nPrüfe das Papier; ein Teil kann bereits ausgegeben worden sein.',true); }
  finally{ state.printing=false; originals.forEach(([node,disabled])=>node.disabled=disabled); showQueue(); }
}
function currentEntryAndLayout(){if(state.selected<0||state.selected>=state.queue.length)return null;try{const sizeInfo=readSize();return {entry:state.queue[state.selected],sizeInfo};}catch{return null;}}
async function modifyLayout(fn){
 const cur=currentEntryAndLayout();if(!cur)return;
 const layer=activeImageLayer(cur.entry);if(!layer||layer.locked)return;
 const {layout}=await getLayout(layer,cur.sizeInfo);fn(layout,cur.sizeInfo,cur.entry);requestPreview();
}

function alignHorizontal(mode){const selected=selectedText();if(selected){if(selected.locked)return;const cur=currentEntryAndLayout();if(!cur)return;const ctx=$('dd-editor').getContext('2d'),g=textGeometry(ctx,selected,cur.sizeInfo.size.w_px);const a=degrees(selected.rotation),ts=textScale(selected),bw=ts*(Math.abs(g.boxWidth*Math.cos(a))+Math.abs(g.boxHeight*Math.sin(a)));selected.x=mode==='left'?bw/2:mode==='right'?cur.sizeInfo.size.w_px-bw/2:cur.sizeInfo.size.w_px/2;renderTextControls();requestPreview();return;}modifyLayout((l,s)=>{const a=degrees(l.rotation),w=l.refW*l.scale,h=l.refH*l.scale,bw=Math.abs(w*Math.cos(a))+Math.abs(h*Math.sin(a));l.tx=mode==='left'?(bw-s.size.w_px)/2:mode==='right'?(s.size.w_px-bw)/2:0;});}
function alignVertical(mode){const selected=selectedText();if(selected){if(selected.locked)return;const cur=currentEntryAndLayout();if(!cur)return;const ctx=$('dd-editor').getContext('2d'),g=textGeometry(ctx,selected,cur.sizeInfo.size.w_px);const a=degrees(selected.rotation),ts=textScale(selected),bh=ts*(Math.abs(g.boxHeight*Math.cos(a))+Math.abs(g.boxWidth*Math.sin(a)));selected.y=mode==='top'?bh/2:mode==='bottom'?cur.sizeInfo.size.h_px-bh/2:cur.sizeInfo.size.h_px/2;renderTextControls();requestPreview();return;}modifyLayout((l,s)=>{const a=degrees(l.rotation),w=l.refW*l.scale,h=l.refH*l.scale,bh=Math.abs(h*Math.cos(a))+Math.abs(w*Math.sin(a));l.ty=mode==='top'?(bh-s.size.h_px)/2:mode==='bottom'?(s.size.h_px-bh)/2:0;});}
function nudge(dx,dy){const selected=selectedText();if(selected){if(selected.locked)return;const cur=currentEntryAndLayout();if(!cur)return;const step=Math.max(1,Math.round(cur.sizeInfo.size.dpi/25.4));selected.x+=dx*step;selected.y+=dy*step;renderTextControls();requestPreview();return;}modifyLayout((l,s)=>{const step=Math.max(1,Math.round(s.size.dpi/25.4));l.tx+=dx*step;l.ty+=dy*step;});}
async function doReset(mode){
 const current=currentEntryAndLayout();if(!current)return;
 const selected=selectedText();
 if(selected){if(selected.locked)return;
   const {sizeInfo}=current,g=textGeometry($('dd-editor').getContext('2d'),selected,sizeInfo.size.w_px);
   const factor=mode==='cover'?Math.max(sizeInfo.size.w_px/g.boxWidth,sizeInfo.size.h_px/g.boxHeight):Math.min(sizeInfo.size.w_px*.9/g.boxWidth,sizeInfo.size.h_px*.9/g.boxHeight);
   selected.zoomScale=clampTextScale(factor);selected.x=sizeInfo.size.w_px/2;selected.y=sizeInfo.size.h_px/2;
   selected.rotation=0;renderTextControls();requestPreview();return;
 }
 const {entry,sizeInfo}=current,layer=activeImageLayer(entry);if(!layer||layer.locked)return;const img=await ensureImage(layer);initLayout(layer,sizeInfo,img,mode);requestPreview();
}
function pointCanvas(e){const rect=$('dd-editor').getBoundingClientRect();return {x:e.clientX-rect.left,y:e.clientY-rect.top};}
function hitHandle(point,handle,radius=24){return handle&&Math.hypot(point.x-handle.x,point.y-handle.y)<=radius;}
function touchDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function touchCenter(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
function textAtPoint(point){const crop=state.editor.crop,current=currentEntryAndLayout();if(!crop||!current)return null;const {entry,sizeInfo}=current;
 const lx=(point.x-crop.x)/crop.scale,ly=(point.y-crop.y)/crop.scale;
 const texts=(layerOrder(entry).filter(id=>!imageForId(entry,id)).reverse()).map(id=>entry.texts?.find(t=>t.id===id)).filter(Boolean);
 const m=$('dd-editor').getContext('2d');
 for(let i=0;i<texts.length;i++){const t=texts[i],angle=-degrees(t.rotation),co=Math.cos(angle),si=Math.sin(angle),dx=lx-t.x,dy=ly-t.y;
  const rx=dx*co-dy*si,ry=dx*si+dy*co,g=textGeometry(m,t,sizeInfo.size.w_px);
  if(Math.abs(rx)<=Math.max(18,g.boxWidth*textScale(t)/2)&&Math.abs(ry)<=Math.max(18,g.boxHeight*textScale(t)/2))return t;
 }return null;
}
function clampTextScale(s){return Math.max(.05,Math.min(40,Number(s)||1));}
function syncTextTransformFields(t){
 if(!t)return;const angle=Math.round(normalizeAngle(t.rotation)),zoom=Math.round(100*textScale(t));
 for(const id of ['dd-rotation','dd-rotation-num','dd-textrotation']){const el=$(id);if(el&&document.activeElement!==el)el.value=String(angle);}
 for(const id of ['dd-zoom','dd-textzoom']){const el=$(id);if(el&&document.activeElement!==el)el.value=String(zoom);}
 renderTextSizeOnly(t);
}
function pointerAngle(a,b){return Math.atan2(b.y-a.y,b.x-a.x);}
function textLocalVector(dx,dy,angle){const r=degrees(-angle);return {x:dx*Math.cos(r)-dy*Math.sin(r),y:dx*Math.sin(r)+dy*Math.cos(r)};}
function rotateDiffDegrees(next,start){let diff=(next-start)*180/Math.PI;return ((diff+180)%360+360)%360-180;}
function objectAtPoint(pt,entry,sizeInfo,crop){
 const lx=(pt.x-crop.x)/crop.scale,ly=(pt.y-crop.y)/crop.scale;
 const ctx=$('dd-editor').getContext('2d');
 for(const id of [...layerOrder(entry)].reverse()){
  const text=(entry.texts||[]).find(t=>t.id===id);
  if(text){
   if(text.locked)continue;
   const a=degrees(-text.rotation),co=Math.cos(a),si=Math.sin(a),dx=lx-text.x,dy=ly-text.y;
   const rx=dx*co-dy*si,ry=dx*si+dy*co,g=textGeometry(ctx,text,sizeInfo.size.w_px);
   if(Math.abs(rx)<=Math.max(12,g.boxWidth*textScale(text)/2)&&Math.abs(ry)<=Math.max(12,g.boxHeight*textScale(text)/2))return {type:'text',id,text};
  }else{
   const layer=imageForId(entry,id),layout=layer?.layouts?.[sizeInfo.sizeKey];if(!layout||layer.locked)continue;
   const a=degrees(-layout.rotation),co=Math.cos(a),si=Math.sin(a),dx=lx-(sizeInfo.size.w_px/2+layout.tx),dy=ly-(sizeInfo.size.h_px/2+layout.ty);
   const rx=dx*co-dy*si,ry=dx*si+dy*co;
   if(Math.abs(rx)<=layout.refW*layout.scale/2 && Math.abs(ry)<=layout.refH*layout.scale/2)return {type:'image',id,layer,layout};
  }
 }
 return null;
}
function startGesture(e){
 const cur=currentEntryAndLayout(),crop=state.editor.crop;if(!cur||!crop)return;
 const ed=state.editor,pt=pointCanvas(e),entry=cur.entry;
 if(ed.pointers.size===0){beginHistory('Element mit Touch bearbeiten');history.gesturing=true;}
 $('dd-editor').setPointerCapture(e.pointerId);ed.pointers.set(e.pointerId,pt);
 if(ed.pointers.size===2){
  const [a,b]=[...ed.pointers.values()].slice(0,2),center=touchCenter(a,b),dist=Math.max(2,touchDistance(a,b)),angle=pointerAngle(a,b);
  const text=ed.start?.textId?entry.texts?.find(t=>t.id===ed.start.textId):selectedText();
  if(text&&!text.locked){ed.mode='textPinch';ed.start={textId:text.id,dist,center,angle,scale:textScale(text),rotation:text.rotation||0,x:text.x,y:text.y};}
  else{const imageId=ed.start?.imageId||state.activeImageId,layer=imageForId(entry,imageId),layout=layer?.layouts?.[cur.sizeInfo.sizeKey];
   if(layout&&!layer.locked){ed.mode='imagePinch';ed.start={imageId,dist,center,angle,scale:layout.scale,tx:layout.tx,ty:layout.ty,rotation:layout.rotation||0};}}
  return;
 }
 const selected=selectedText(),handles=ed.textHandles;
 if(selected&&!selected.locked&&handles){
  for(const kind of ['rotate','both','width','height']){
   if(!hitHandle(pt,handles[kind],24))continue;
   const g=textGeometry($('dd-editor').getContext('2d'),selected,cur.sizeInfo.size.w_px);
   if(kind==='rotate'){ed.mode='textRotate';ed.start={textId:selected.id,center:{x:handles.cx,y:handles.cy},angle:Math.atan2(pt.y-handles.cy,pt.x-handles.cx),rotation:selected.rotation||0};}
   else{ed.mode=kind==='both'?'textScale':'textResize';ed.start={textId:selected.id,kind,px:pt.x,py:pt.y,w:g.boxWidth,h:g.boxHeight,rotation:selected.rotation||0,scale:textScale(selected),center:{x:handles.cx,y:handles.cy},dist:Math.max(1,touchDistance(pt,{x:handles.cx,y:handles.cy}))};}
   return;
  }
 }
 const image=ed.imageHandle;
 if(!selected&&image&&!imageForId(entry,image.id)?.locked&&hitHandle(pt,image.tl)){
   const l=imageForId(entry,image.id)?.layouts?.[cur.sizeInfo.sizeKey];if(l){ed.mode='imageRotate';ed.start={imageId:image.id,center:{x:image.cx,y:image.cy},angle:Math.atan2(pt.y-image.cy,pt.x-image.cx),rotation:l.rotation||0};return;}
 }
 if(!selected&&image&&!imageForId(entry,image.id)?.locked&&hitHandle(pt,image.br)){
   const l=imageForId(entry,image.id)?.layouts?.[cur.sizeInfo.sizeKey];if(l){ed.mode='imageScale';ed.start={imageId:image.id,scale:l.scale,center:{x:image.cx,y:image.cy},dist:Math.max(1,touchDistance(pt,{x:image.cx,y:image.cy}))};return;}
 }
 const hit=objectAtPoint(pt,entry,cur.sizeInfo,crop);
 if(!hit){ed.mode=null;ed.start=null;return;}
 if(hit.type==='text'){
   state.textSelectedId=hit.id;ed.mode='textDrag';ed.start={textId:hit.id,px:pt.x,py:pt.y,x:hit.text.x,y:hit.text.y};renderTextControls();requestPreview();
 }else{
   state.textSelectedId=null;state.activeImageId=hit.id;ed.mode='imageDrag';ed.start={imageId:hit.id,px:pt.x,py:pt.y,x:hit.layout.tx,y:hit.layout.ty};
   renderTextControls();setImagePanel(hit.layer);requestPreview();
 }
}
function moveGesture(e){
 const ed=state.editor;if(!ed.pointers.has(e.pointerId)||!ed.mode||!ed.start)return;
 const pt=pointCanvas(e);ed.pointers.set(e.pointerId,pt);
 const cur=currentEntryAndLayout(),crop=ed.crop;if(!cur||!crop)return;
 const entry=cur.entry,start=ed.start,mode=ed.mode;
 const text=start.textId?entry.texts?.find(t=>t.id===start.textId):null;
 const layer=start.imageId?imageForId(entry,start.imageId):null,layout=layer?.layouts?.[cur.sizeInfo.sizeKey];
 if(mode==='textPinch'&&text&&!text.locked&&ed.pointers.size>=2){
  const [a,b]=[...ed.pointers.values()].slice(0,2),center=touchCenter(a,b);
  text.zoomScale=clampTextScale(start.scale*touchDistance(a,b)/start.dist);
  text.rotation=normalizeAngle(start.rotation+rotateDiffDegrees(pointerAngle(a,b),start.angle));
  text.x=start.x+(center.x-start.center.x)/crop.scale;text.y=start.y+(center.y-start.center.y)/crop.scale;syncTextTransformFields(text);
 }else if(mode==='imagePinch'&&layout&&!layer.locked&&ed.pointers.size>=2){
  const [a,b]=[...ed.pointers.values()].slice(0,2),center=touchCenter(a,b);
  layout.scale=clampScale(start.scale*touchDistance(a,b)/start.dist);layout.rotation=normalizeAngle(start.rotation+rotateDiffDegrees(pointerAngle(a,b),start.angle));
  layout.tx=start.tx+(center.x-start.center.x)/crop.scale;layout.ty=start.ty+(center.y-start.center.y)/crop.scale;
 }else if(mode==='textRotate'&&text&&!text.locked){const angle=Math.atan2(pt.y-start.center.y,pt.x-start.center.x);text.rotation=normalizeAngle(start.rotation+rotateDiffDegrees(angle,start.angle));syncTextTransformFields(text);
 }else if(mode==='textScale'&&text&&!text.locked){text.zoomScale=clampTextScale(start.scale*touchDistance(pt,start.center)/start.dist);syncTextTransformFields(text);
 }else if(mode==='textResize'&&text&&!text.locked){const local=textLocalVector((pt.x-start.px)/crop.scale,(pt.y-start.py)/crop.scale,start.rotation);
  if(start.kind!=='height')text.boxW=Math.min(4000,Math.max(20,start.w+2*local.x/start.scale));
  if(start.kind!=='width')text.boxH=Math.min(4000,Math.max(20,start.h+2*local.y/start.scale));renderTextSizeOnly(text);
 }else if(mode==='textDrag'&&text&&!text.locked){text.x=start.x+(pt.x-start.px)/crop.scale;text.y=start.y+(pt.y-start.py)/crop.scale;
 }else if(mode==='imageRotate'&&layout&&!layer.locked){const angle=Math.atan2(pt.y-start.center.y,pt.x-start.center.x);layout.rotation=normalizeAngle(start.rotation+rotateDiffDegrees(angle,start.angle));
 }else if(mode==='imageScale'&&layout&&!layer.locked){layout.scale=clampScale(start.scale*touchDistance(pt,start.center)/start.dist);
 }else if(mode==='imageDrag'&&layout&&!layer.locked){layout.tx=start.x+(pt.x-start.px)/crop.scale;layout.ty=start.y+(pt.y-start.py)/crop.scale;}
 requestPreview();
}
function endGesture(e){
 const ed=state.editor;ed.pointers.delete(e.pointerId);
 if(ed.pointers.size===1&&(ed.mode==='textPinch'||ed.mode==='imagePinch')){
  const pt=[...ed.pointers.values()][0],cur=currentEntryAndLayout(),entry=cur?.entry;
  if(ed.mode==='textPinch'){
   const t=entry?.texts?.find(t=>t.id===ed.start?.textId);
   if(t){ed.mode='textDrag';ed.start={textId:t.id,px:pt.x,py:pt.y,x:t.x,y:t.y};return;}
  }else{const l=imageForId(entry,ed.start?.imageId)?.layouts?.[cur.sizeInfo.sizeKey];
   if(l){ed.mode='imageDrag';ed.start={imageId:ed.start.imageId,px:pt.x,py:pt.y,x:l.tx,y:l.ty};return;}}
 }
 if(ed.pointers.size<2){ed.mode=null;ed.start=null;}
 if(ed.pointers.size===0){history.gesturing=false;scheduleHistoryCommit(20);}
}

// Source-image crop editor: normalized bounds; presets are physical aspect ratios.
const CROPS={'1:1':1,'4:6':4/6,'3:5':3/5,'5:8':5/8,'2:3':2/3,'4:7':4/7,'5:7':5/7,'circle':1};
function validNormalizedCrop(c){
 const x=clamp01(Number(c.x)||0),y=clamp01(Number(c.y)||0);
 return {x,y,w:Math.min(1-x,Math.max(.015,Number(c.w)||1)),h:Math.min(1-y,Math.max(.015,Number(c.h)||1)),shape:c.shape==='circle'?'circle':'rect',preset:c.preset||'free'};
}
let cropPointer=null;
function cropCanvasCoords(event){const r=$('dd-crop-canvas').getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};}
function cropViewport(){
 const c=$('dd-crop-canvas'),width=Math.max(200,c.clientWidth||320),height=Math.max(220,c.clientHeight||300),padding=15;
 const img=state.cropState?.img,scale=Math.min((width-2*padding)/(img?.naturalWidth||300),(height-2*padding)/(img?.naturalHeight||300));
 const w=(img?.naturalWidth||300)*scale,h=(img?.naturalHeight||300)*scale;
 return {width,height,scale,x:(width-w)/2,y:(height-h)/2,w,h};
}
function cropRectPixels(){
 const c=state.cropState?.crop,v=cropViewport();
 return c?{x:v.x+c.x*v.w,y:v.y+c.y*v.h,w:c.w*v.w,h:c.h*v.h}:null;
}
function drawCropCanvas(){
 const item=state.cropState;if(!item)return;
 const canvas=$('dd-crop-canvas'),dpr=Math.max(1,window.devicePixelRatio||1),v=cropViewport();
 canvas.width=Math.round(v.width*dpr);canvas.height=Math.round(v.height*dpr);
 const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.fillStyle='#d3dbe6';ctx.fillRect(0,0,v.width,v.height);ctx.drawImage(item.img,v.x,v.y,v.w,v.h);
 const r=cropRectPixels(),circle=item.crop.shape==='circle';
 ctx.save();ctx.beginPath();ctx.rect(v.x,v.y,v.w,v.h);
 if(circle){ctx.ellipse(r.x+r.w/2,r.y+r.h/2,r.w/2,r.h/2,0,0,Math.PI*2,true);}else{ctx.rect(r.x,r.y,r.w,r.h);}
 ctx.fillStyle='rgba(26,40,62,.48)';ctx.fill('evenodd');ctx.restore();
 ctx.strokeStyle='#fb444b';ctx.lineWidth=2;ctx.setLineDash([5,4]);
 if(circle){ctx.beginPath();ctx.ellipse(r.x+r.w/2,r.y+r.h/2,r.w/2,r.h/2,0,0,Math.PI*2);ctx.stroke();}else ctx.strokeRect(r.x,r.y,r.w,r.h);
 ctx.setLineDash([]);ctx.beginPath();ctx.arc(r.x+r.w,r.y+r.h,11,0,Math.PI*2);ctx.fillStyle='#119be1';ctx.fill();ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();
 $('dd-crop-presets').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.cropPreset===item.crop.preset)));
}
function applyCropPreset(preset){
 const item=state.cropState;if(!item)return;
 const ratio=CROPS[preset],img=item.img;
 if(!ratio){item.crop={...item.crop,preset:'free',shape:'rect'};drawCropCanvas();return;}
 // Ratios apply to actual pixel width/height, not the normalized viewport.
 const targetW=Math.min(img.naturalWidth,img.naturalHeight*ratio),targetH=targetW/ratio;
 const fx=targetW/img.naturalWidth,fy=targetH/img.naturalHeight;
 item.crop={x:(1-fx)/2,y:(1-fy)/2,w:fx,h:fy,shape:preset==='circle'?'circle':'rect',preset};
 drawCropCanvas();
}
function cropPointerDown(e){
 const item=state.cropState;if(!item)return;e.preventDefault();
 const p=cropCanvasCoords(e),r=cropRectPixels(),v=cropViewport();
 const near=Math.hypot(p.x-r.x-r.w,p.y-r.y-r.h)<34;
 const inside=p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h;
 cropPointer={id:e.pointerId,kind:near?'resize':inside?'move':'move',start:p,crop:{...item.crop},v};
 $('dd-crop-canvas').setPointerCapture(e.pointerId);
}
function cropPointerMove(e){
 const item=state.cropState,gesture=cropPointer;if(!item||!gesture||gesture.id!==e.pointerId)return;
 const p=cropCanvasCoords(e),dx=(p.x-gesture.start.x)/gesture.v.w,dy=(p.y-gesture.start.y)/gesture.v.h;
 const c=gesture.crop,ratio=CROPS[c.preset];let next;
 if(gesture.kind==='move')next={...c,x:Math.max(0,Math.min(1-c.w,c.x+dx)),y:Math.max(0,Math.min(1-c.h,c.y+dy))};
 else{
  let w=Math.max(.02,Math.min(1-c.x,c.w+dx)),h=Math.max(.02,Math.min(1-c.y,c.h+dy));
  if(ratio){const nh=w*item.img.naturalWidth/(item.img.naturalHeight*ratio);if(nh<=1-c.y)h=nh;else{h=1-c.y;w=h*item.img.naturalHeight*ratio/item.img.naturalWidth;}}
  next={...c,w,h};
 }
 item.crop=validNormalizedCrop(next);drawCropCanvas();
}
function cropPointerUp(e){if(cropPointer?.id===e.pointerId)cropPointer=null;}
async function openCropEditor(layer){
 if(!layer||layer.locked){message('Gesperrte Bilder zum Zuschneiden erst entsperren.',true);return false;}
 if(state.cropState)return false;
 const img=await ensureImage(layer),dialog=$('dd-crop-dialog');
 beginHistory('Bild zuschneiden');history.hold=true;
 return new Promise(resolve=>{
  state.cropState={layer,img,crop:validNormalizedCrop(normalizedCrop(layer)),resolve};
  $('dd-crop-title').textContent=layer.name||'Bildausschnitt';
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  requestAnimationFrame(drawCropCanvas);
 });
}
function closeCropEditor(save){
 const item=state.cropState;if(!item)return;
 if(save&&!item.layer.locked){
  item.layer.crop=validNormalizedCrop(item.crop);
  // Old rendering dimensions get refreshed on next paint, preserving print DPI and selection.
 }
 state.cropState=null;cropPointer=null;
 const dialog=$('dd-crop-dialog');if(dialog.open)dialog.close();else dialog.removeAttribute('open');
 if(save){renderTextControls();requestPreview();}
 // During import, the outer file-import transaction stays open until all pages complete.
 if(!state.importingFiles){history.hold=false;commitHistory();}
 item.resolve(Boolean(save));
}
$('dd-crop-canvas').addEventListener('pointerdown',cropPointerDown);
$('dd-crop-canvas').addEventListener('pointermove',cropPointerMove);
$('dd-crop-canvas').addEventListener('pointerup',cropPointerUp);
$('dd-crop-canvas').addEventListener('pointercancel',cropPointerUp);
$('dd-crop-presets').querySelectorAll('button').forEach(b=>b.onclick=()=>applyCropPreset(b.dataset.cropPreset));
$('dd-crop-save').onclick=()=>closeCropEditor(true);
$('dd-crop-cancel').onclick=()=>closeCropEditor(false);
$('dd-crop-reset').onclick=()=>{if(state.cropState){state.cropState.crop={x:0,y:0,w:1,h:1,shape:'rect',preset:'free'};drawCropCanvas();}};
$('dd-crop-dialog').addEventListener('cancel',e=>{e.preventDefault();closeCropEditor(false)});
window.addEventListener('resize',()=>{if(state.cropState)drawCropCanvas();});

// Font persistence – tied to this HTTPS origin and browser profile.
const FONT_DB='niimbot-druckstudio-fonts-v1';
function openFontDb(){return new Promise((resolve,reject)=>{if(!window.indexedDB){reject(Error('IndexedDB wird von diesem Browser nicht unterstützt'));return;}const r=indexedDB.open(FONT_DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('fonts',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Fontdatenbank konnte nicht geöffnet werden'));});}
async function fontStore(op,arg){const db=await openFontDb();return new Promise((resolve,reject)=>{const tx=db.transaction('fonts',op==='list'?'readonly':'readwrite'),store=tx.objectStore('fonts');let request;
 if(op==='list')request=store.getAll();if(op==='put')request=store.put(arg);if(op==='delete')request=store.delete(arg);
 request.onerror=()=>reject(request.error);tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 }).finally(()=>db.close());}
function fontStatus(text,isError=false){$('dd-fontstatus').textContent=text;$('dd-fontstatus').style.color=isError?'#b42318':'#475569';}
async function installFontRecord(record){const family='NiimbotUploaded_'+record.id.replace(/[^A-Za-z0-9]/g,'');const face=new FontFace(family,record.bytes);await face.load();document.fonts.add(face);return {id:record.id,name:record.name,family,face};}
async function loadSavedFonts(){try{const records=await fontStore('list');for(const r of records){try{state.fonts.push(await installFontRecord(r));}catch(e){console.warn('Font nicht ladbar',r.name,e)}}renderFonts();fontStatus(`${state.fonts.length} eigene Schriftart(en) dauerhaft gespeichert.`);}catch(e){fontStatus('Schriftspeicherung nicht verfügbar: '+(e.message||e),true);renderFonts();}}
function renderFonts(){const sel=$('dd-font'),current=sel.value;sel.replaceChildren();for(const [value,label] of [['system:sans-serif','Arial / Sans Serif'],['system:serif','Serif'],['system:monospace','Monospace'],['system:cursive','Handschrift / Cursive']]){const opt=document.createElement('option');opt.value=value;opt.textContent=label;sel.append(opt);}for(const f of state.fonts){const opt=document.createElement('option');opt.value=f.id;opt.textContent='Eigene: '+f.name;sel.append(opt);}if([...sel.options].some(o=>o.value===current))sel.value=current;
 const root=$('dd-fontlist');root.replaceChildren();for(const f of state.fonts){const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:10px;border-top:1px solid #e5e7eb;padding:6px 0';const label=document.createElement('span');label.style.flex='1';label.textContent=f.name;const del=document.createElement('button');del.textContent='Font löschen';del.type='button';del.onclick=async()=>{if(!confirm(`Schriftart „${f.name}“ aus diesem Browser löschen?`))return;try{await fontStore('delete',f.id);document.fonts.delete(f.face);state.fonts=state.fonts.filter(x=>x.id!==f.id);renderFonts();fontStatus('Font gelöscht. Textfelder verwenden anschließend eine Ersatzschrift.');requestPreview();}catch(e){fontStatus('Löschen fehlgeschlagen: '+e.message,true);}};row.append(label,del);root.append(row);}}
async function uploadFonts(files){const list=Array.from(files||[]);for(const file of list){try{
 if(!/\.(ttf|otf|woff2?)$/i.test(file.name))throw Error('Nur .ttf, .otf, .woff und .woff2');
 if(file.size>8_000_000)throw Error('Font größer als 8 MB');
 const id=(crypto.randomUUID?.()||String(Date.now())+'_'+Math.random().toString(36).slice(2)).replace(/-/g,'');const record={id,name:file.name,bytes:await file.arrayBuffer(),added:Date.now()};
 const installed=await installFontRecord(record);state.fonts.push(installed);
 try{await fontStore('put',record);fontStatus(`Gespeichert: ${file.name}. Die Schrift bleibt beim nächsten Besuch verfügbar.`);}catch(e){fontStatus(`Font nur vorübergehend geladen: ${e.message}. Browser-Speicher prüfen.`,true);}
 renderFonts(); $('dd-font').value=id;if(selectedText()){selectedText().font=id;renderTextControls();}requestPreview();
 }catch(e){fontStatus(`Font ${file.name} konnte nicht geladen werden: ${e.message}`,true)}}}
function selectedText(){const item=state.queue[state.selected];return item?.texts?.find(t=>t.id===state.textSelectedId)||null;}
function renderTextSizeOnly(t){
 const bw=$('dd-boxwidth'),bh=$('dd-boxheight'),ts=textScale(t);
 if(bw&&document.activeElement!==bw)bw.value=String(Math.round((t.boxW||0)*ts));
 if(bh&&document.activeElement!==bh)bh.value=String(Math.round((t.boxH||0)*ts));
 if($('dd-textzoom')&&document.activeElement!==$('dd-textzoom'))$('dd-textzoom').value=String(Math.round(ts*100));
}
function newText(){return {id:Math.random().toString(36).slice(2)+Date.now().toString(36),text:'Dein Text',x:0,y:0,font:'system:sans-serif',size:32,bold:false,italic:false,underline:false,strike:false,inverse:false,align:'center',vertical:'middle',wrap:'word',widthPct:85,boxW:0,boxH:0,letterSpace:0,lineHeight:120,rotation:0,zoomScale:1,autoFit:false,flow:'horizontal',curveDeg:180,curvePlacement:'top',curveFacing:'outside',curveRadius:0,locked:false};}
function renderTextControls(){const entry=state.queue[state.selected],texts=entry?.texts||[];const list=$('dd-textlist');list.replaceChildren();texts.forEach((t,i)=>{const btn=document.createElement('button');btn.textContent=(i+1)+': '+(t.text||'Leer').replace(/\s+/g,' ').slice(0,22);btn.type='button';btn.setAttribute('aria-pressed',t.id===state.textSelectedId?'true':'false');btn.disabled=!!t.locked;btn.onclick=()=>{if(t.locked)return;state.textSelectedId=t.id;renderTextControls();requestPreview();};list.append(btn);});
 const t=selectedText();$('dd-text-controls').querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=!t||!!t.locked);
 for(const id of ['dd-duplicate-text','dd-remove-text'])$(id).disabled=!t||!!t.locked;
 $('dd-select-image').disabled=!entry||!allImages(entry).length;$('dd-text-tofront').disabled=!t||!!t.locked;$('dd-text-toback').disabled=!t||!!t.locked;
 renderLayerControls();
 if(!t){$('dd-textcontent').value='';$('dd-curve-controls').hidden=true;return;}
 const fields={'dd-textcontent':'text','dd-font':'font','dd-fontsize':'size','dd-textalign':'align','dd-textwidth':'widthPct','dd-boxwidth':'boxW','dd-boxheight':'boxH','dd-textvertical':'vertical','dd-textwrap':'wrap','dd-textx':'x','dd-texty':'y','dd-letterspace':'letterSpace','dd-lineheight':'lineHeight','dd-textrotation':'rotation','dd-textscaling':'autoFit'};
 const flowControls=['dd-flow-horizontal','dd-flow-vertical','dd-flow-curve'];
 const curvePlacementButtons=['dd-curve-place-top','dd-curve-place-bottom','dd-curve-place-circle'];
 const curveFacingButtons=['dd-curve-facing-outside','dd-curve-facing-inside'];
 flowControls.forEach(id=>{$(id).disabled=!t;$(id).classList.remove('dd-activated');$(id).setAttribute('aria-pressed','false');});
 curvePlacementButtons.forEach(id=>{$(id).disabled=!t;$(id).classList.remove('dd-activated');$(id).setAttribute('aria-pressed','false');});
 curveFacingButtons.forEach(id=>{$(id).disabled=!t;$(id).classList.remove('dd-activated');$(id).setAttribute('aria-pressed','false');});
 $('dd-curve-duplicate-opposite').disabled=!t;
 $('dd-curve-controls').hidden=!t||textFlow(t)!=='curve';
 for(const [id,k] of Object.entries(fields)) {const el=$(id);if(id==='dd-textscaling')el.value=t.autoFit?'fit':'none';else if(id==='dd-font' && ![...el.options].some(o=>o.value===t.font))el.value='system:sans-serif';else el.value=t[k];}
 const activeFlow='dd-flow-'+(textFlow(t)==='curve'?'curve':textFlow(t)==='vertical'?'vertical':'horizontal');
 $(activeFlow).classList.add('dd-activated'); $(activeFlow).setAttribute('aria-pressed','true');
 $('dd-curvedeg').value=String(Math.abs(normalizeCurveDeg(t.curveDeg))); $('dd-curvedeg-num').value=String(Math.abs(normalizeCurveDeg(t.curveDeg)));
 $('dd-curveradius').value=String(Math.max(0,Number(t.curveRadius)||0)); $('dd-curveradius-num').value=String(Math.max(0,Number(t.curveRadius)||0));
 const placementBtn='dd-curve-place-'+curvePlacement(t); $(placementBtn).classList.add('dd-activated'); $(placementBtn).setAttribute('aria-pressed','true');
 const facingBtn='dd-curve-facing-'+curveFacing(t); $(facingBtn).classList.add('dd-activated'); $(facingBtn).setAttribute('aria-pressed','true');
 $('dd-textwrap').disabled=textFlow(t)!=='horizontal'; $('dd-textvertical').disabled=textFlow(t)==='curve';
 for(const [id,k] of [['dd-textbold','bold'],['dd-textitalic','italic'],['dd-textunderline','underline'],['dd-textstrike','strike']]){$(id).setAttribute('aria-pressed',t[k]?'true':'false');$(id).classList.toggle('dd-activated',!!t[k]);}
 $('dd-textinverse').checked=!!t.inverse;renderTextSizeOnly(t);const cur=currentEntryAndLayout();if(cur){const layout=cur.entry.layouts?.[cur.sizeInfo.sizeKey];if(layout){setRotationField(layout);setZoomField(layout);}}
}
function addText(){const cur=currentEntryAndLayout();if(!cur){message('Bitte zuerst ein Bild oder ein leeres Etikett auswählen.',true);return;}
 const {entry,sizeInfo}=cur;entry.texts ||= [];const t=newText();t.x=sizeInfo.size.w_px/2;t.y=sizeInfo.size.h_px/2;t.size=Math.max(12,Math.round(sizeInfo.size.h_px/8));t.boxW=Math.round(sizeInfo.size.w_px*.85);t.boxH=Math.round(sizeInfo.size.h_px*.32);entry.texts.push(t);layerOrder(entry);state.textSelectedId=t.id;renderTextControls();requestPreview();}
function blankLabel(){beginHistory('Leeres Etikett');history.hold=true;const c=document.createElement('canvas');c.width=2;c.height=2;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,2,2);c.toBlob(b=>{state.queue.push({kind:'blank',blob:b,name:'Leeres Etikett '+(state.queue.length+1),importDpi:'original',layouts:{},texts:[]});state.selected=state.queue.length-1;state.textSelectedId=null;state.activeImageId="image";showQueue();setImagePanel(activeImageLayer(state.queue[state.selected]));requestPreview();renderTextControls();history.hold=false;commitHistory();},'image/png');}
function duplicateText(){const t=selectedText(),entry=state.queue[state.selected];if(!t||t.locked)return;const copy={...t,id:newText().id,x:t.x+10,y:t.y+10};entry.texts.push(copy);layerOrder(entry);state.textSelectedId=copy.id;renderTextControls();requestPreview();}
function removeText(){const entry=state.queue[state.selected],id=state.textSelectedId;if(!entry||layerLocked(entry,id))return;entry.texts=entry.texts.filter(t=>t.id!==id);layerOrder(entry);state.textSelectedId=entry.texts.at(-1)?.id||null;renderTextControls();requestPreview();}
function wireTextEditor(){const textfields={'dd-textcontent':'text','dd-font':'font','dd-fontsize':'size','dd-textalign':'align','dd-textwidth':'widthPct','dd-boxwidth':'boxW','dd-boxheight':'boxH','dd-textvertical':'vertical','dd-textwrap':'wrap','dd-textx':'x','dd-texty':'y','dd-letterspace':'letterSpace','dd-lineheight':'lineHeight','dd-textrotation':'rotation','dd-textscaling':'autoFit'};
 for(const [id,key] of Object.entries(textfields))$(id).addEventListener(id==='dd-font'||id==='dd-textscaling'||id==='dd-textalign'?'change':'input',e=>{const t=selectedText();if(!t||t.locked)return;let val=e.target.value;if(key==='autoFit')val=val==='fit';else if(['size','widthPct','boxW','boxH','x','y','letterSpace','lineHeight','rotation'].includes(key))val=Number(val)||0;t[key]=val;if(key==='boxW'){t.boxW=Math.max(20,val/textScale(t));const cur=currentEntryAndLayout();if(cur)t.widthPct=Math.round(val*100/cur.sizeInfo.size.w_px);}
  if(key==='boxH')t.boxH=Math.max(20,val/textScale(t));
  if(key==='rotation'){t.rotation=normalizeAngle(val);syncTextTransformFields(t);}
  if(key==='widthPct'){const cur=currentEntryAndLayout();if(cur)t.boxW=Math.round(cur.sizeInfo.size.w_px*val/(100*textScale(t)));}requestPreview();if(key==='text')renderTextListOnly();});
 for(const [id,key] of [['dd-textbold','bold'],['dd-textitalic','italic'],['dd-textunderline','underline'],['dd-textstrike','strike']])$(id).onclick=()=>{const t=selectedText();if(!t||t.locked)return;t[key]=!t[key];renderTextControls();requestPreview();};
 $('dd-textinverse').onchange=e=>{const t=selectedText();if(t&&!t.locked){t.inverse=e.target.checked;requestPreview();}};
 function setTextFlow(flow){const t=selectedText();if(!t)return;t.flow=flow;if(flow==='curve'){t.curveDeg=Math.abs(normalizeCurveDeg(t.curveDeg))||180;t.curvePlacement=curvePlacement(t);t.curveFacing=curveFacing(t);t.curveRadius=Math.max(0,Number(t.curveRadius)||0);if(!t.boxW)t.boxW=220;if(!t.boxH||t.boxH<t.boxW*.7)t.boxH=Math.max(Math.min(4000,t.boxW),t.boxH||0);}renderTextControls();requestPreview();}
 function setCurvePlacement(place){const t=selectedText();if(!t)return;t.curvePlacement=place;renderTextControls();requestPreview();}
 function setCurveFacing(facing){const t=selectedText();if(!t)return;t.curveFacing=facing;renderTextControls();requestPreview();}
 function duplicateCurveOpposite(){const t=selectedText(),entry=state.queue[state.selected];if(!t||textFlow(t)!=='curve'||!entry)return;const copy={...t,id:newText().id,x:t.x,y:t.y,curvePlacement:curvePlacement(t)==='top'?'bottom':curvePlacement(t)==='bottom'?'top':'circle'};entry.texts.push(copy);layerOrder(entry);state.textSelectedId=copy.id;renderTextControls();requestPreview();}
 $('dd-flow-horizontal').onclick=()=>setTextFlow('horizontal'); $('dd-flow-vertical').onclick=()=>setTextFlow('vertical'); $('dd-flow-curve').onclick=()=>setTextFlow('curve');
 $('dd-curve-place-top').onclick=()=>setCurvePlacement('top'); $('dd-curve-place-bottom').onclick=()=>setCurvePlacement('bottom'); $('dd-curve-place-circle').onclick=()=>setCurvePlacement('circle');
 $('dd-curve-facing-outside').onclick=()=>setCurveFacing('outside'); $('dd-curve-facing-inside').onclick=()=>setCurveFacing('inside'); $('dd-curve-duplicate-opposite').onclick=duplicateCurveOpposite;
 $('dd-curvedeg').addEventListener('input',e=>{const t=selectedText();if(!t)return;t.curveDeg=Math.max(0,Math.min(360,Number(e.target.value)||0));$('dd-curvedeg-num').value=String(t.curveDeg);requestPreview();});
 $('dd-curvedeg-num').addEventListener('change',e=>{const t=selectedText();if(!t)return;t.curveDeg=Math.max(0,Math.min(360,Number(e.target.value)||0));$('dd-curvedeg').value=String(t.curveDeg);requestPreview();});
 $('dd-curveradius').addEventListener('input',e=>{const t=selectedText();if(!t)return;t.curveRadius=Math.max(0,Math.min(1200,Number(e.target.value)||0));$('dd-curveradius-num').value=String(t.curveRadius);requestPreview();});
 $('dd-curveradius-num').addEventListener('change',e=>{const t=selectedText();if(!t)return;t.curveRadius=Math.max(0,Math.min(1200,Number(e.target.value)||0));$('dd-curveradius').value=String(t.curveRadius);requestPreview();});
 $('dd-curveradius-auto').onclick=()=>{const t=selectedText();if(!t)return;t.curveRadius=0;$('dd-curveradius').value='0';$('dd-curveradius-num').value='0';requestPreview();};
 $('dd-add-text').onclick=addText;$('dd-add-blank').onclick=blankLabel;$('dd-duplicate-text').onclick=duplicateText;$('dd-remove-text').onclick=removeText;
 $('dd-fontfile').onchange=e=>{uploadFonts(e.target.files);e.target.value='';};
 $('dd-fontpersistent').onclick=async()=>{if(!navigator.storage?.persist){fontStatus('Dauerhafte Speicherung wird von diesem Browser nicht angeboten.',true);return;}try{const yes=await navigator.storage.persist();fontStatus(yes?'Permanenter Browserspeicher wurde genehmigt.':'Browser hat dauerhafte Speicherung nicht bestätigt. Fonts bleiben bis zum Löschen der Browserdaten gespeichert.',!yes);}catch(e){fontStatus('Speicher-Anfrage nicht möglich: '+e.message,true);}};
}
function wireAdditionalControls(){
 $('dd-select-image').onclick=()=>{const entry=state.queue[state.selected];if(entry)setActiveImage(entry,allImages(entry)[0]?.id||'image');};
 $('dd-text-tofront').onclick=()=>{const t=selectedText();if(t)moveLayer(t.id,'front');};
 $('dd-text-toback').onclick=()=>{const t=selectedText();if(t)moveLayer(t.id,'back');};
 for(const [id,fn] of [
 ['dd-txt-align-left',()=>alignHorizontal('left')],['dd-txt-align-hcenter',()=>alignHorizontal('center')],['dd-txt-align-right',()=>alignHorizontal('right')],
 ['dd-txt-align-top',()=>alignVertical('top')],['dd-txt-align-vcenter',()=>alignVertical('middle')],['dd-txt-align-bottom',()=>alignVertical('bottom')]
 ])$(id).onclick=fn;
 for(const key of ADJUST_KEYS){
  const slider=$('dd-'+key),number=$('dd-'+key+'-number');
  slider.addEventListener('input',e=>setImageAdjustValue(key,e.target.value));
  number.addEventListener('input',e=>{
    // Allow temporary empty/incomplete values while typing; commit valid values live.
    if(e.target.value==='' || e.target.value==='-' || e.target.value==='.')return;
    setImageAdjustValue(key,e.target.value,{preserveNumberFocus:true});
  });
  number.addEventListener('change',e=>{
    if(!setImageAdjustValue(key,e.target.value)){
      const entry=state.queue[state.selected];
      syncAdjustControl(key,activeImageLayer(entry)?imageAdjustments(activeImageLayer(entry))[key]:ADJUST_DEFAULTS[key]);
    }else{
      syncAdjustControl(key,imageAdjustments(activeImageLayer(state.queue[state.selected]))[key]);
    }
  });
  for(const [suffix,direction] of [['minus',-1],['plus',1]]){
    $('dd-'+key+'-'+suffix).addEventListener('click',()=>{
      const entry=activeImageLayer(state.queue[state.selected]);if(!entry||entry.locked)return;
      const current=Number(imageAdjustments(entry)[key] ?? ADJUST_DEFAULTS[key]);
      const step=Number(slider.step)||1;
      setImageAdjustValue(key,current+direction*step);
    });
  }
 }
 $('dd-bw').addEventListener('change',e=>{const layer=activeImageLayer(state.queue[state.selected]);if(layer&&!layer.locked)imageAdjustments(layer).mode=e.target.value;requestPreview();});
 $('dd-adjust-reset').onclick=()=>{const layer=activeImageLayer(state.queue[state.selected]);if(!layer||layer.locked)return;layer.adjustments={...ADJUST_DEFAULTS};setImagePanel(layer);requestPreview();};
}
function renderTextListOnly(){const sel=state.textSelectedId;const entries=state.queue[state.selected]?.texts||[];const root=$('dd-textlist');root.replaceChildren();entries.forEach((t,i)=>{const b=document.createElement('button');b.type='button';b.textContent=`${i+1}: `+t.text.replace(/\s+/g,' ').slice(0,22);b.setAttribute('aria-pressed',t.id===sel?'true':'false');b.disabled=!!t.locked;b.onclick=()=>{if(t.locked)return;state.textSelectedId=t.id;renderTextControls();requestPreview();};root.append(b);});}
// Compact viewport zoom scales ONLY the canvas presentation, never the printed label.
for(const [id,direction] of [['dd-viewzoom-plus',1],['dd-viewzoom-minus',-1]]){
 $(id).addEventListener('click',()=>{state.viewZoom=Math.max(.2,Math.min(2.5,state.viewZoom+direction*.1));$('dd-viewzoom').value=String(Math.round(state.viewZoom*100));setPreviewZoomUi();requestPreview();});
}
$('dd-add-layer').addEventListener('click',()=>{if(state.queue[state.selected])$('dd-layer-files').click();else message('Zuerst ein Etikett erstellen oder eine Datei normal importieren.',true);});
$('dd-layer-files').addEventListener('change',e=>{const f=[...e.target.files];e.target.value='';addFiles(f,true);});
$('dd-crop-image').addEventListener('click',()=>{const layer=activeImageLayer(state.queue[state.selected]);if(layer)openCropEditor(layer);});

$('dd-picker').addEventListener('click',e=>{e.stopPropagation();$('dd-files').click()});
$('dd-drop').addEventListener('click',e=>{if(e.target.id!=='dd-picker')$('dd-files').click()});
$('dd-drop').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('dd-files').click()}});
$('dd-drop').addEventListener('dragover',e=>{e.preventDefault();$('dd-drop').classList.add('drag')});
$('dd-drop').addEventListener('dragleave',()=>{$('dd-drop').classList.remove('drag')});
$('dd-drop').addEventListener('drop',e=>{e.preventDefault();$('dd-drop').classList.remove('drag');addFiles(e.dataTransfer.files)});
$('dd-files').addEventListener('change',e=>{const files=Array.from(e.target.files);e.target.value='';addFiles(files)});
$('dd-clear').addEventListener('click',()=>{if(state.printing)return;beginHistory('Warteschlange leeren'); state.queue.forEach(revokeEntry); state.queue.length=0; state.selected=-1; state.textSelectedId=null;state.activeImageId="image"; showQueue(); renderTextControls(); showPreview(); $('dd-progress').value=0; commitHistory();message('Warteschlange geleert.')});
$('dd-print').addEventListener('click',printAll); $('dd-stop').addEventListener('click',()=>{state.stop=true; message('Stopp angefordert. Laufender Druckstapel wird gegebenenfalls noch beendet.')});
$('dd-fit').addEventListener('change',()=>doReset($('dd-fit').value));

$('dd-copies').addEventListener('change',showQueue);
$('dd-viewzoom').addEventListener('input',e=>{state.viewZoom=Math.max(.2,Math.min(2.5,Number(e.target.value||100)/100));setPreviewZoomUi();requestPreview();});
for(const id of ['model','size'])$(id).addEventListener('change',()=>{state.textSelectedId=null;renderTextControls();requestPreview();});
function applyActiveZoom(percent){
 const t=selectedText();if(t){if(t.locked)return;t.zoomScale=clampTextScale(Number(percent)/100);syncTextTransformFields(t);requestPreview();}
 else modifyLayout(l=>{l.scale=clampScale((l.baseScale||1)*(Number(percent)||100)/100);});
}
$('dd-zoom-apply').onclick=()=>applyActiveZoom($('dd-zoom').value);
$('dd-textzoom').addEventListener('input',e=>applyActiveZoom(e.target.value));
$('dd-zoom').addEventListener('change',()=>$('dd-zoom-apply').click());
$('dd-fit-reset').onclick=()=>doReset('contain');$('dd-cover-reset').onclick=()=>doReset('cover');
function applyActiveRotation(value){
 const t=selectedText();if(t){if(t.locked)return;t.rotation=normalizeAngle(value);syncTextTransformFields(t);requestPreview();}
 else modifyLayout(l=>{l.rotation=normalizeAngle(value);});
}
$('dd-rotation').addEventListener('input',e=>{ $('dd-rotation-num').value=e.target.value;applyActiveRotation(e.target.value); });
$('dd-rotation-num').addEventListener('change',e=>{ $('dd-rotation').value=normalizeAngle(e.target.value); applyActiveRotation(e.target.value); });
$('dd-rotate90').onclick=()=>{
 const t=selectedText();if(t){if(t.locked)return;t.rotation=normalizeAngle((t.rotation||0)+90);syncTextTransformFields(t);requestPreview();}
 else modifyLayout(l=>{l.rotation=normalizeAngle((l.rotation||0)+90);});
};
for(const [id,func] of [['dd-align-left',()=>alignHorizontal('left')],['dd-align-center-x',()=>alignHorizontal('center')],['dd-align-right',()=>alignHorizontal('right')],['dd-align-top',()=>alignVertical('top')],['dd-align-center-y',()=>alignVertical('middle')],['dd-align-bottom',()=>alignVertical('bottom')],['dd-nudge-up',()=>nudge(0,-1)],['dd-nudge-down',()=>nudge(0,1)],['dd-nudge-left',()=>nudge(-1,0)],['dd-nudge-right',()=>nudge(1,0)]])$(id).onclick=func;
const editorCanvas=$('dd-editor');editorCanvas.addEventListener('pointerdown',startGesture);editorCanvas.addEventListener('pointermove',moveGesture);editorCanvas.addEventListener('pointerup',endGesture);editorCanvas.addEventListener('pointercancel',endGesture);editorCanvas.addEventListener('lostpointercapture',endGesture);
window.addEventListener('resize',requestPreview);
let upstreamSelection='';setInterval(()=>{if(!loaded())return;const now=$('model').value+'|'+$('size').value;if(now!==upstreamSelection){upstreamSelection=now;if(state.queue.length)requestPreview();}},1100);
wireTextEditor();wireAdditionalControls();renderFonts();renderTextControls();setImagePanel(null);setPreviewZoomUi();updateEditorViewport(null);updateHistoryControls();
(async()=>{
  await loadSavedFonts();
  try{ bluetoothHint(); for(let t=0;t<150 && !loaded();t++)await sleep(100); if(!loaded())throw Error('Originaldemo hat die Druckermodelle nicht geladen. Verbindung oder CDN prüfen.'); await upstreamRegistry(); showQueue(); await showPreview(); message('Bereit. Drucker oben verbinden, Rolle wählen und PDF/Bild hinzufügen. Text und Rotation sind in der Vorschau bearbeitbar.'); }
  catch(e){ message('Initialisierung: '+(e.message||e)+'\nDrucker-/Rollen-Auswahl fehlt? Webseite neu laden und Internetverbindung prüfen.',true); }
})();
