(function(){
'use strict';

/* Forge Layer Engine
   This runtime owns the visible editor. The older composer remains loaded for backwards
   compatibility, but this layer system is intentionally independent: every image has its
   own transform + effect stack and nothing is inherited by newly added assets. */

const $=id=>document.getElementById(id), el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const canvas=$('outputCanvas'), viewport=$('viewport'), inspector=$('inspector'), list=$('mediaList'), input=$('mediaInput'), drop=$('mediaDrop');
const play=$('playBtn'), exportBtn=$('exportBtn'), timeEl=$('loopTime'), countEl=$('mediaCount');
if(!canvas||!viewport||!inspector)return;

window.FORGE_MODE='layer-editor';

const style=document.createElement('style');
style.textContent=`
:root{--forge-bg:#090909;--forge-panel:#111;--forge-card:#171717;--forge-border:#292929;--forge-text:#f2f2f2;--forge-muted:#858585;--forge-accent:#ff5a1f}
html,body{background:var(--forge-bg)!important;color:var(--forge-text)!important}body{overflow:hidden!important}
#shell{height:100vh!important;background:var(--forge-bg)}.shell-bar{height:46px!important;padding:0 18px!important;background:#090909!important;border-bottom:1px solid var(--forge-border)!important}.editor-context{font:600 10px JetBrains Mono,monospace;letter-spacing:.14em;color:#777}.shell-hint{font:10px JetBrains Mono,monospace;color:#555}
.mode-container,.mode-inner{min-height:0!important}.topbar{height:48px!important;padding:0 16px!important;background:#0c0c0c!important;border-bottom:1px solid var(--forge-border)!important}.transport{margin-left:auto!important;gap:8px!important}.workspace{grid-template-columns:240px minmax(0,1fr) 300px!important;min-height:0!important}.sidebar{padding:12px!important;background:#101010!important}.sidebar-left{border-right:1px solid var(--forge-border)!important}.sidebar-right{border-left:1px solid var(--forge-border)!important}.viewport{padding:24px!important;background:#080808!important}.panel-title{margin:2px 0 10px!important;color:#666!important}.media-drop{padding:11px!important;margin-bottom:8px!important}.layer-hint{font:10px/1.45 JetBrains Mono,monospace;color:#555;padding:4px 2px 10px}.media-item{padding:7px!important;border:1px solid #262626!important;background:#151515!important;border-radius:6px!important;cursor:pointer}.media-item.selected{border-color:var(--forge-accent)!important;background:#1a1411!important}.media-item-top{cursor:pointer!important}.layer-type{font:8px JetBrains Mono,monospace;color:#666;text-transform:uppercase}.layer-name{font-size:11px!important;color:#ddd!important}.layer-controls{display:flex;gap:4px;margin-top:6px}.layer-controls button{font:9px JetBrains Mono,monospace;background:#202020;color:#777;border:1px solid #303030;border-radius:3px;padding:3px 5px;cursor:pointer}.layer-controls button:hover{color:#fff;border-color:#555}.dropzone{inset:24px!important;border-color:#292929!important}.dropzone p{font:13px Inter,sans-serif;color:#888}.dropzone span{font:9px JetBrains Mono,monospace;color:#555}.inspector-shell{height:100%;overflow:auto;padding:12px}.inspector-section{border:1px solid #292929;background:#121212;border-radius:7px;padding:11px;margin-bottom:8px}.inspector-title{font:600 10px JetBrains Mono,monospace;letter-spacing:.1em;color:#777;margin-bottom:10px;display:flex;justify-content:space-between}.inspector-title strong{color:#ddd;letter-spacing:0}.control{margin:9px 0}.control label{display:flex;justify-content:space-between;font:10px JetBrains Mono,monospace;color:#aaa;margin-bottom:4px}.control label span{color:var(--forge-accent)}input[type=range]{width:100%}.seg{display:flex;gap:4px;flex-wrap:wrap}.seg button,.addfx{font:9px JetBrains Mono,monospace;color:#aaa;background:#1c1c1c;border:1px solid #303030;border-radius:4px;padding:6px 8px;cursor:pointer}.seg button.active,.seg button:hover,.addfx:hover{color:var(--forge-accent);border-color:var(--forge-accent)}.fx{border:1px solid #2a2a2a;background:#181818;border-radius:5px;margin:6px 0;padding:8px}.fx-head{display:flex;align-items:center;gap:7px}.fx-head b{font:600 10px Inter,sans-serif;flex:1}.fx-head button{font:10px JetBrains Mono,monospace;background:none;border:0;color:#666;cursor:pointer}.fx-head button:hover{color:#fff}.fx-body{margin-top:7px}.mini{margin:7px 0}.mini label{font:9px JetBrains Mono,monospace;color:#777;display:flex;justify-content:space-between}.mini label span{color:var(--forge-accent)}.timeline{position:absolute;left:0;right:0;bottom:0;height:58px;background:rgba(10,10,10,.94);border-top:1px solid #292929;display:flex;align-items:center;padding:8px 14px;gap:10px;z-index:4}.timeline .play{width:32px;height:32px}.timeline-track{position:relative;height:26px;flex:1;background:#141414;border:1px solid #252525;border-radius:4px}.timeline-progress{position:absolute;top:0;bottom:0;width:1px;background:var(--forge-accent);left:0}.timeline-label{font:9px JetBrains Mono,monospace;color:#666;min-width:55px}.badge{font:9px JetBrains Mono,monospace;color:#666;border:1px solid #292929;border-radius:3px;padding:3px 5px}
`;
document.head.appendChild(style);

const FRAME={w:760,h:760};
const state={frame:{...FRAME},layout:'wall',duration:12,playing:false,selected:null,bg:'#050505',layers:[]};
let scene,renderer,camera,group,clockStart=0,paused=0;
const meshes=new Map();

const FX={
 grain:{label:'Grain',params:{amount:[0,.35,.01,.06],scale:[1,30,1,5]}},
 bloom:{label:'Bloom',params:{threshold:[0,1,.01,.55],intensity:[0,2,.01,.65]}},
 halftone:{label:'Halftone',params:{size:[3,35,1,10],contrast:[.5,3,.05,1.2]}},
 dither:{label:'Dither',params:{levels:[2,12,1,4],scale:[1,8,1,2]}},
 pixelate:{label:'Pixelate',params:{size:[1,50,1,8]}},
 grayscale:{label:'Grayscale',params:{amount:[0,1,.01,1]}},
 chromatic:{label:'Chromatic',params:{amount:[0,8,.1,1.2]}},
 vignette:{label:'Vignette',params:{amount:[0,1,.01,.45]}},
 displacement:{label:'Displacement',params:{amount:[0,30,1,4],frequency:[1,30,1,10]}},
 tracking:{label:'Tracking',params:{strength:[0,1,.01,.5],smoothing:[0,1,.01,.8]}}
};
function fx(id){const f=FX[id];return {id,enabled:true,params:Object.fromEntries(Object.entries(f.params).map(([k,v])=>[k,v[3]]))};}
function selected(){return state.layers.find(x=>x.id===state.selected)||null;}
function makeLayer(img,name){return{id:crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random()),name,img,aspect:img.naturalWidth/img.naturalHeight,visible:true,locked:false,opacity:1,blend:'normal',x:0,y:0,z:0,scale:1,rotation:0,focus:{x:.5,y:.5},fx:[],canvas:null,ctx:null,texture:null};}

function init(){
 renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(FRAME.w,FRAME.h,false);renderer.setClearColor(state.bg,1);
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(48,1,.1,100);camera.position.z=7;group=new THREE.Group();scene.add(group);resize();
 bind();renderUI();requestAnimationFrame(loop);
}
function resize(){canvas.width=state.frame.w;canvas.height=state.frame.h;renderer.setSize(state.frame.w,state.frame.h,false);camera.aspect=state.frame.w/state.frame.h;camera.updateProjectionMatrix();}
function bind(){
 drop.addEventListener('click',()=>input.click());input.addEventListener('change',e=>addFiles(e.target.files));
 viewport.addEventListener('dragover',e=>{e.preventDefault()});viewport.addEventListener('drop',e=>{e.preventDefault();addFiles(e.dataTransfer.files)});
 $('shuffleBtn').addEventListener('click',()=>{state.layers.sort(()=>Math.random()-.5);renderUI();rebuild();});
 play.addEventListener('click',toggle);exportBtn.addEventListener('click',exportVideo);
}
function addFiles(files){[...files].filter(f=>f.type.startsWith('image/')).forEach(file=>{const u=URL.createObjectURL(file),im=new Image();im.onload=()=>{const l=makeLayer(im,file.name);state.layers.push(l);if(!state.selected)state.selected=l.id;state.selected=l.id;renderUI();rebuild();syncCanvas();};im.src=u});}
function layerCanvas(l){if(!l.canvas){l.canvas=document.createElement('canvas');l.ctx=l.canvas.getContext('2d');}const w=512,h=Math.max(128,Math.round(w/l.aspect));l.canvas.width=w;l.canvas.height=h;return l.canvas;}
function coverDraw(l,c){const x=l.ctx,w=c.width,h=c.height,ia=l.aspect,ca=w/h;let dw,dh,dx,dy;if(ia>ca){dh=h;dw=h*ia;dx=(w-dw)*l.focus.x;dy=0}else{dw=w;dh=w/ia;dx=0;dy=(h-dh)*(1-l.focus.y)}x.clearRect(0,0,w,h);x.drawImage(l.img,dx,dy,dw,dh);}
function applyFx(l,t){const c=layerCanvas(l),ctx=l.ctx;if(!l.fx.length)return c;let src=c;for(const f of l.fx){if(!f.enabled)continue;const tmp=document.createElement('canvas');tmp.width=c.width;tmp.height=c.height;const q=tmp.getContext('2d');const p=f.params;
 if(f.id==='grayscale'){q.filter=`grayscale(${p.amount*100}%)`;q.drawImage(src,0,0);}
 else if(f.id==='blur'){q.filter=`blur(${p.amount}px)`;q.drawImage(src,0,0);}
 else if(f.id==='brightness'){q.filter=`brightness(${p.amount})`;q.drawImage(src,0,0);}
 else if(f.id==='pixelate'){const s=Math.max(1,p.size);q.imageSmoothingEnabled=false;q.drawImage(src,0,0,Math.ceil(c.width/s),Math.ceil(c.height/s));q.drawImage(tmp,0,0,Math.ceil(c.width/s),Math.ceil(c.height/s),0,0,c.width,c.height);}
 else if(f.id==='halftone'){q.fillStyle='#000';q.fillRect(0,0,c.width,c.height);const s=p.size;for(let y=0;y<c.height;y+=s)for(let x=0;x<c.width;x+=s){const d=ctx.getImageData(Math.min(x,c.width-1),Math.min(y,c.height-1),1,1).data,lm=(.299*d[0]+.587*d[1]+.114*d[2])/255,r=(1-lm)*s*.65;q.fillStyle=`rgb(${d[0]},${d[1]},${d[2]})`;q.beginPath();q.arc(x+s/2,y+s/2,r,0,Math.PI*2);q.fill()}}
 else if(f.id==='dither'){q.drawImage(src,0,0);const im=q.getImageData(0,0,c.width,c.height),lev=p.levels,sc=p.scale;for(let y=0;y<c.height;y+=sc)for(let x=0;x<c.width;x+=sc){const i=(y*c.width+x)*4,lm=(.299*im.data[i]+.587*im.data[i+1]+.114*im.data[i+2])/255,v=Math.round(lm*(lev-1))/(lev-1);for(let k=0;k<3;k++)im.data[i+k]=v*255}q.putImageData(im,0,0)}
 else if(f.id==='grain'){q.drawImage(src,0,0);const im=q.getImageData(0,0,c.width,c.height);for(let i=0;i<im.data.length;i+=4){const n=(Math.random()-.5)*p.amount*255;im.data[i]=Math.max(0,Math.min(255,im.data[i]+n));im.data[i+1]=Math.max(0,Math.min(255,im.data[i+1]+n));im.data[i+2]=Math.max(0,Math.min(255,im.data[i+2]+n))}q.putImageData(im,0,0)}
 else if(f.id==='chromatic'){q.drawImage(src,0,0);const off=p.amount; q.globalCompositeOperation='screen';q.globalAlpha=.35;q.drawImage(src,off,0);q.drawImage(src,-off,0);q.globalAlpha=1;q.globalCompositeOperation='source-over'}
 else if(f.id==='vignette'){q.drawImage(src,0,0);const g=q.createRadialGradient(c.width/2,c.height/2,c.height*.15,c.width/2,c.height*.72,c.height*.75);g.addColorStop(0,'transparent');g.addColorStop(1,`rgba(0,0,0,${p.amount})`);q.fillStyle=g;q.fillRect(0,0,c.width,c.height)}
 else if(f.id==='displacement'){q.drawImage(src,0,0);const im=q.getImageData(0,0,c.width,c.height),out=q.createImageData(c.width,c.height),amp=p.amount,freq=p.frequency;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const xx=Math.max(0,Math.min(c.width-1,Math.round(x+Math.sin(y/freq)*amp))),i=(y*c.width+x)*4,j=(y*c.width+xx)*4;out.data[i]=im.data[j];out.data[i+1]=im.data[j+1];out.data[i+2]=im.data[j+2];out.data[i+3]=im.data[j+3]}q.putImageData(out,0,0)}
 else if(f.id==='tracking'){q.drawImage(src,0,0);const s=p.strength*(.5+.5*Math.sin(t*2*Math.PI)),dx=(s-.5)*24,dy=(.5-s)*12;q.globalAlpha=.22;q.drawImage(src,dx,dy);q.globalAlpha=1}
 else q.drawImage(src,0,0);
 src=tmp;
}
// copy final processed result back to the persistent layer canvas
if(src!==c){ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(src,0,0)}return c;}
function texFor(l,t){const c=applyFx(l,t);if(!l.texture){l.texture=new THREE.CanvasTexture(c);l.texture.minFilter=THREE.LinearFilter;l.texture.magFilter=THREE.LinearFilter}else l.texture.needsUpdate=true;return l.texture;}
function material(l,t){return new THREE.MeshBasicMaterial({map:texFor(l,t),transparent:true,opacity:l.opacity,side:THREE.DoubleSide,depthWrite:false,blending:l.blend==='screen'?THREE.AdditiveBlending:THREE.NormalBlending});}
function rebuild(){for(const m of meshes.values()){group.remove(m);m.material.dispose()}meshes.clear();const n=state.layers.length;if(!n)return;const cols=Math.max(1,Math.ceil(Math.sqrt(n))),rows=Math.max(1,Math.ceil(n/cols));state.layers.forEach((l,i)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1),material(l,0));m.userData.layer=l.id;group.add(m);meshes.set(l.id,m);place(m,l,i,cols,rows);});}
function place(m,l,i,cols,rows){const p={gap:1.12,scale:1};if(state.layout==='wall'){m.position.set((i%cols-(cols-1)/2)*p.gap,((rows-1)/2-Math.floor(i/cols))*p.gap,0)}else if(state.layout==='globe'){const y=nrm(i,state.layers.length),r=Math.sqrt(Math.max(0,1-y*y)),a=i*Math.PI*(3-Math.sqrt(5));m.position.set(Math.cos(a)*r*2.1,y*2.1,Math.sin(a)*r*2.1);m.lookAt(m.position.clone().multiplyScalar(2))}else{const a=i*.55,m.position.set(Math.cos(a)*1.45,Math.sin(a)*1.45,(i-(state.layers.length-1)/2)*.55);m.lookAt(new THREE.Vector3(0,0,m.position.z));return}m.scale.set(.95,l.aspect<1?.95/l.aspect:.95*l.aspect,1);m.rotation.z=THREE.MathUtils.degToRad(l.rotation);m.scale.multiplyScalar(l.scale);}
function nrm(i,n){return n<2?0:1-(i/(n-1))*2}
function rebuildSelection(){const l=selected();if(!l)return;const m=meshes.get(l.id);if(m)m.material.opacity=l.opacity;}
function renderUI(){countEl.textContent='· '+state.layers.length;list.innerHTML='';state.layers.forEach((l,i)=>{const row=el('div','media-item'+(l.id===state.selected?' selected':''));row.innerHTML=`<div class="media-item-top"><span style="font:10px JetBrains Mono;color:#555;width:18px">${i+1}</span><span class="layer-name">${escapeHtml(l.name)}</span></div><div class="layer-type">IMAGE LAYER · ${l.fx.length} EFFECT${l.fx.length===1?'':'S'}</div><div class="layer-controls"><button data-a="up">↑</button><button data-a="down">↓</button><button data-a="dup">⧉</button><button data-a="del">×</button></div>`;row.onclick=e=>{if(e.target.tagName==='BUTTON')return;state.selected=l.id;renderUI();buildInspector()};row.querySelectorAll('button').forEach(b=>b.onclick=e=>layerAction(l,b.dataset.a));list.appendChild(row)});drop.style.display=state.layers.length?'none':'flex';canvas.classList.toggle('hidden',!state.layers.length);exportBtn.disabled=!state.layers.length;}
function escapeHtml(s){return String(s).replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function layerAction(l,a){const i=state.layers.indexOf(l);if(a==='up'&&i>0)[state.layers[i-1],state.layers[i]]=[state.layers[i],state.layers[i-1]];if(a==='down'&&i<state.layers.length-1)[state.layers[i+1],state.layers[i]]=[state.layers[i],state.layers[i+1]];if(a==='dup'){const n=makeLayer(l.img,l.name+' copy');Object.assign(n,{opacity:l.opacity,scale:l.scale,rotation:l.rotation,focus:{...l.focus},fx:JSON.parse(JSON.stringify(l.fx))});state.layers.splice(i+1,0,n);state.selected=n.id}if(a==='del'){state.layers.splice(i,1);state.selected=state.layers[Math.max(0,i-1)]?.id||null}renderUI();rebuild();buildInspector();}
function slider(sec,key,label,min,max,step,value,on){const r=el('div','control'),lab=el('label');lab.innerHTML=`<b>${label}</b><span>${value}</span>`;const inp=document.createElement('input');inp.type='range';inp.min=min;inp.max=max;inp.step=step;inp.value=value;inp.oninput=()=>{const v=parseFloat(inp.value);lab.lastElementChild.textContent=v;on(v)};r.append(lab,inp);sec.append(r)}
function buildInspector(){inspector.innerHTML='';const wrap=el('div','inspector-shell');inspector.append(wrap);const l=selected();
if(!l){const s=el('div','inspector-section');s.innerHTML='<div class="inspector-title">COMPOSITION</div><div style="font:10px JetBrains Mono;color:#666">Select a layer to edit it. Effects never apply to unselected layers.</div>';wrap.append(s);return}
let s=el('div','inspector-section');s.innerHTML=`<div class="inspector-title"><strong>${escapeHtml(l.name)}</strong><span>SELECTED LAYER</span></div>`;slider(s,'x','x',-3,3,.01,l.x,v=>{l.x=v;updateLayer(l)});slider(s,'y','y',-3,3,.01,l.y,v=>{l.y=v;updateLayer(l)});slider(s,'scale','scale',.2,2,.01,l.scale,v=>{l.scale=v;updateLayer(l)});slider(s,'rotation','rotation',-180,180,1,l.rotation,v=>{l.rotation=v;updateLayer(l)});slider(s,'opacity','opacity',0,1,.01,l.opacity,v=>{l.opacity=v;rebuildSelection()});wrap.append(s);
const layout=el('div','inspector-section');layout.innerHTML='<div class="inspector-title">COMPOSITION</div>';const seg=el('div','seg');['wall','globe','tunnel'].forEach(x=>{const b=el('button',x===state.layout?'active':'',x[0].toUpperCase()+x.slice(1));b.onclick=()=>{state.layout=x;rebuild();};seg.append(b)});layout.append(seg);slider(layout,'duration','loop',5,30,.5,state.duration,v=>state.duration=v);wrap.append(layout);
const fxsec=el('div','inspector-section');fxsec.innerHTML='<div class="inspector-title"><strong>EFFECT STACK</strong><span>PER LAYER</span></div>';l.fx.forEach((f,i)=>{const fsec=el('div','fx');const head=el('div','fx-head');const b=el('b',null,FX[f.id].label);const tog=el('button',null,f.enabled?'●':'○');tog.onclick=()=>{f.enabled=!f.enabled;buildInspector();};const up=el('button',null,'↑');up.onclick=()=>{if(i>0)[l.fx[i-1],l.fx[i]]=[l.fx[i],l.fx[i-1]];buildInspector()};const dn=el('button',null,'↓');dn.onclick=()=>{if(i<l.fx.length-1)[l.fx[i+1],l.fx[i]]=[l.fx[i],l.fx[i+1]];buildInspector()};const del=el('button',null,'×');del.onclick=()=>{l.fx.splice(i,1);buildInspector()};head.append(b,tog,up,dn,del);fsec.append(head);const body=el('div','fx-body');Object.entries(FX[f.id].params).forEach(([k,v])=>slider(body,k,k,v[0],v[1],v[2],f.params[k],x=>{f.params[k]=x;invalidate(l)}));fsec.append(body);fxsec.append(fsec)});const add=document.createElement('select');add.className='addfx';add.innerHTML='<option value="">+ Add effect to selected layer</option>'+Object.entries(FX).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');add.onchange=()=>{if(add.value){l.fx.push(fx(add.value));add.value='';buildInspector();invalidate(l)}};fxsec.append(add);wrap.append(fxsec);
const bg=el('div','inspector-section');bg.innerHTML='<div class="inspector-title">BACKGROUND</div>';const color=document.createElement('input');color.type='color';color.value=state.bg;color.oninput=()=>{state.bg=color.value;renderer.setClearColor(state.bg,1)};bg.append(color);wrap.append(bg);
}
function invalidate(l){l.texture&& (l.texture.needsUpdate=true);rebuild();}
function updateLayer(l){const m=meshes.get(l.id);if(!m)return;m.position.x=l.x;m.position.y=l.y;m.rotation.z=THREE.MathUtils.degToRad(l.rotation);m.scale.set(l.scale,l.scale,1);}
function toggle(){state.playing=!state.playing;if(state.playing){clockStart=performance.now()-paused*1000;play.textContent='❚❚'}else{paused=(performance.now()-clockStart)/1000;play.textContent='▶'}}
function loop(now){requestAnimationFrame(loop);const t=state.playing?((now-clockStart)/1000)%state.duration:paused;timeEl.textContent=t.toFixed(1)+'s / '+state.duration.toFixed(1)+'s';state.layers.forEach(l=>{if(l.fx.some(f=>f.enabled&&f.id==='tracking')){const m=meshes.get(l.id);if(m){m.position.x=l.x+Math.sin(t*2*Math.PI/state.duration)*.12;m.position.y=l.y+Math.cos(t*2*Math.PI/state.duration)*.06}}});renderer.render(scene,camera);}
function exportVideo(){if(!canvas.captureStream){alert('Video export is not supported in this browser.');return}const was=state.playing;if(!was)toggle();const stream=canvas.captureStream(30);const rec=new MediaRecorder(stream,{mimeType:'video/webm'}),chunks=[];rec.ondataavailable=e=>e.data.size&&chunks.push(e.data);rec.onstop=()=>{const a=document.createElement('a'),u=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));a.href=u;a.download='forge-composition.webm';a.click();URL.revokeObjectURL(u);if(!was)toggle()};rec.start();setTimeout(()=>rec.stop(),state.duration*1000+150)}

init();buildInspector();
})();
