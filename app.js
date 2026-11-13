import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const state = { form: 'cart', mode: 'whole', paused: false, reduced: reducedQuery.matches, hotspots: true, playing: false, progress: 1 };
$('#reduce-motion').checked = state.reduced;
const viewers = [];
const cache = new Map();
const textureLoader = new THREE.TextureLoader();
const wood = textureLoader.load('./assets/wood-color.jpg'); wood.colorSpace = THREE.SRGBColorSpace; wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
const roughness = textureLoader.load('./assets/wood-roughness.jpg'); roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
let manifest;
let toastTimer;
let main;
let switchToken = 0;
const clock = new THREE.Clock();
const smooth = (t) => t * t * (3 - 2 * t);
const waitFrame = () => new Promise(requestAnimationFrame);
const FORM = {
  cart: { label: '收纳推车', kicker: '01 / STORE', title: '把快乐，推着走。', copy: '小物有了自己的位置，家具也有了新的玩法。转动模型，看看推车的把手、护条与木轮。', action: '提起把手', note: '点击绿色连杆或上方按钮，观察把手沿连接轴转动。', direction: [-.25,.22,.27], hotspots: ['物件_274','物件_237','物件_281'] },
  learning: { label: '学习桌', kicker: '02 / LEARN', title: '想象，从这里开始。', copy: '木质阅读面与纯净黑板面相伴。两侧座椅保留原有装配，让阅读与创作都有自己的位置。', action: '查看木质阅读面', note: '转到另一侧，观察木质阅读面。黑板保持空白。', direction: [.30,.17,-.11], hotspots: ['物件_81','物件_432','物件_407'] },
  game: { label: '游戏桌', kicker: '03 / PLAY', title: '一起坐，一起发现。', copy: '一张桌面，两侧座椅。保留每一个孔位与榫接，换个角度，发现构件之间的联系。', action: '转到另一侧', note: '点击桌板、护条或座椅，查看各自的构件说明。', direction: [-.30,.18,.10], hotspots: ['物件_240','物件_374','物件_463'] },
  seesaw: { label: '双座跷跷板', kicker: '04 / TOGETHER', title: '你一边，我一边。', copy: '熟悉的弧形板，变成新的游戏方式。点击模型，轻轻摇一摇，再停下来观察原始连接。', action: '轻轻摇一摇', note: '整组模型小幅摇摆；连接关系与零件形状保持不变。', direction: [-.32,.17,.14], hotspots: ['物件_378','物件_246','物件_379'] },
  rocker: { label: '摇摇椅', kicker: '05 / ROCK', title: '换个姿态，轻轻摇摆。', copy: '弧形侧板、木质座面与连接横杆，组成模型文件里已有的摇摇椅形态。', action: '轻轻摇一摇', note: '点击弧形侧板或按钮开始摇摆；再次点击即可停止。', direction: [-.28,.18,.22], hotspots: ['物件_392','物件_390','物件_402'] },
  chair: { label: '椅子', kicker: '06 / SIT', title: '小小座位，大大想象。', copy: '原模型中的独立座椅。弧形靠板、米白软垫和木质框架，保留原有孔位与连接细节。', action: '转到另一侧', note: '点击构件查看说明；选择爆炸拆解，观察源文件中已有的椅子拆解布局。', direction: [-.25,.20,.28], hotspots: ['物件_256','物件_257','物件_261'] },
};

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 4000);
}
function errorIn(el, error, retry) {
  console.error(error);
  el.querySelector('.loading')?.classList.add('done');
  el.querySelector('.load-error')?.remove();
  const box = document.createElement('div'); box.className = 'load-error';
  const p = document.createElement('p'); p.textContent = '模型暂时未能打开。请确认使用本地 HTTP 服务或网站地址访问，并检查浏览器是否启用硬件加速。';
  const button = document.createElement('button'); button.textContent = '重新加载'; button.onclick = retry;
  box.append(p, button); el.append(box);
}
async function loadBundle(key, onProgress = () => {}) {
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const meta = manifest.models[key];
    const response = await fetch(`./${meta.file}`);
    if (!response.ok) throw new Error(`Model ${key}: HTTP ${response.status}`);
    let bytes;
    if (response.body?.getReader) {
      const reader = response.body.getReader(); const chunks = []; let received = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); received += value.length; onProgress(Math.min(.95, received / meta.bytes)); }
      bytes = new Uint8Array(received); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    } else bytes = new Uint8Array(await response.arrayBuffer());
    let buffer;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (!('DecompressionStream' in window)) throw new Error('This browser needs DecompressionStream gzip support');
      buffer = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    } else buffer = bytes.buffer;
    if (buffer.byteLength !== meta.uncompressed_bytes) throw new Error(`Model ${key}: incomplete surface data`);
    const parts = [];
    for (const part of meta.parts) {
      const geometry = new THREE.BufferGeometry();
      for (const [attribute, field, size] of [['position','positions',3],['normal','normals',3],['uv','uv',2]]) {
        geometry.setAttribute(attribute, new THREE.BufferAttribute(new Float32Array(buffer, part[field].offset, part[field].count), size));
      }
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer, part.indices.offset, part.indices.count), 1));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      parts.push({ geometry, data: part });
    }
    onProgress(1); return { parts, meta };
  })();
  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
function materialFor(category) {
  const settings = {
    wood: { color: '#f3d2a3', map: wood, roughnessMap: roughness, roughness: .95 },
    wheel: { color: '#aa6d37', map: wood, roughnessMap: roughness, roughness: .9 },
    coral: { color: '#e76350', roughness: .64 },
    green: { color: '#729940', roughness: .64 },
    ivory: { color: '#eee8dc', roughness: .94 },
    chalk: { color: '#303330', roughness: .92 },
  };
  const material = new THREE.MeshStandardMaterial({ ...settings[category] || settings.wood, metalness: 0 });
  material.userData.originalColor = material.color.clone(); material.userData.baseOpacity = 1;
  return material;
}
function createModel(bundle) {
  const group = new THREE.Group(); const meshMap = new Map();
  for (const part of bundle.parts) {
    const mesh = new THREE.Mesh(part.geometry, materialFor(part.data.category));
    mesh.name = part.data.name; mesh.userData = { part: part.data };
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); meshMap.set(mesh.name, mesh);
  }
  group.userData.meshMap = meshMap; return group;
}
function setGroupOpacity(group, value) {
  group.traverse((object) => { if (!object.isMesh) return; const opacity = value * (object.userData.poseOpacity ?? 1); object.material.transparent = opacity < .999; object.material.opacity = opacity; object.material.depthWrite = opacity > .65; object.visible = opacity > .006; });
}
function disposeModel(group) {
  if (!group) return;
  group.traverse((object) => { if (object.isMesh) object.material.dispose(); });
}

class Viewer {
  constructor(el, { hero = false, defaultForm = 'cart' } = {}) {
    this.el = el; this.hero = hero; this.form = defaultForm; this.mode = 'whole'; this.dirty = true; this.inView = true; this.hotspotNodes = []; this.current = null; this.rocking = false; this.rockTime = 0; this.handleValue = 0; this.handleTarget = 0; this.generation = 0;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#ffffff');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.el.append(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-2,2,2,-2,.01,100); this.camera.position.set(-4,3,4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.dampingFactor = .09; this.controls.enablePan = false; this.controls.minPolarAngle = .13; this.controls.maxPolarAngle = Math.PI / 2 - .025; this.controls.minZoom = .55; this.controls.maxZoom = 3.5;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9e917e, 2.1));
    const key = new THREE.DirectionalLight(0xfff8ed, 3.3); key.position.set(-3.5,6,4); key.castShadow = true; key.shadow.mapSize.set(1024,1024); key.shadow.camera.left = key.shadow.camera.bottom = -3; key.shadow.camera.right = key.shadow.camera.top = 3; key.shadow.camera.near = .1; key.shadow.camera.far = 15; key.shadow.bias = -.00015; key.shadow.normalBias = .003; key.shadow.radius = 5; this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(4,3,-3); this.scene.add(fill);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(40,40), new THREE.ShadowMaterial({ color: '#756858', opacity: .19 })); this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -.015; this.floor.receiveShadow = true; this.scene.add(this.floor);
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(el);
    new IntersectionObserver(([entry]) => { this.inView = entry.isIntersecting; if (this.inView) this.dirty = true; }, { rootMargin: '150px' }).observe(el);
    let down; let lastHover = 0;
    this.renderer.domElement.addEventListener('pointerdown', (event) => { down = [event.clientX,event.clientY]; this.el.focus({ preventScroll:true }); this.cameraTween = null; });
    this.renderer.domElement.addEventListener('pointerup', (event) => {
      if (!down || Math.hypot(event.clientX-down[0],event.clientY-down[1]) > 5) return;
      const hit = this.pick(event); if (hit) this.select(hit, true);
    });
    this.renderer.domElement.addEventListener('pointermove', (event) => {
      if (event.buttons || performance.now()-lastHover < 130 || this.cameraTween) return;
      lastHover = performance.now(); const hit = this.pick(event); this.highlight(hit); this.renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    });
    this.renderer.domElement.addEventListener('pointerleave', () => this.highlight(null));
    el.addEventListener('keydown', (event) => {
      if (event.target !== el) return;
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(event.key)) {
        event.preventDefault(); const offset = this.camera.position.clone().sub(this.controls.target); const spherical = new THREE.Spherical().setFromVector3(offset);
        if (event.key==='ArrowLeft') spherical.theta -= .12; if (event.key==='ArrowRight') spherical.theta += .12;
        if (event.key==='ArrowUp') spherical.phi = Math.max(.15,spherical.phi-.1); if (event.key==='ArrowDown') spherical.phi = Math.min(Math.PI/2-.04,spherical.phi+.1);
        if (event.key==='+') this.camera.zoom=Math.min(3.5,this.camera.zoom*1.1); if (event.key==='-') this.camera.zoom=Math.max(.55,this.camera.zoom/1.1);
        this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical)); this.camera.updateProjectionMatrix(); this.controls.update(); this.dirty = true;
        if (event.key==='Home') this.reset();
      }
    });
    this.resize(); viewers.push(this);
  }
  resize() {
    const { width,height } = this.el.getBoundingClientRect(); if (!width || !height) return;
    this.renderer.setSize(width,height,false); this.aspect=width/height; this.setFrustum(); this.dirty=true;
  }
  setFrustum() {
    const half = this.halfHeight || 1.5; const aspect=this.aspect||1;
    this.camera.top=half; this.camera.bottom=-half; this.camera.left=-half*aspect; this.camera.right=half*aspect; this.camera.updateProjectionMatrix();
  }
  loading(message) { const node=this.el.querySelector('.loading'); node?.classList.remove('done'); if (node?.lastElementChild) node.lastElementChild.textContent=message; }
  ready() { this.el.querySelector('.loading')?.classList.add('done'); this.el.querySelector('.load-error')?.remove(); this.dirty=true; }
  async show(key) {
    const token=++this.generation; this.loading(`正在打开${FORM[key]?.label || '模型'}…`);
    const bundle=await loadBundle(key, (p) => { if (token===this.generation) this.loading(`${FORM[key]?.label || '模型'} ${Math.round(p*100)}%`); });
    if (token!==this.generation) return;
    const group=createModel(bundle); await this.replace(group,key,'whole'); this.ready();
  }
  async replace(group,key,mode) {
    const old=this.current; this.clearHotspots(); this.clearSelection(); this.rocking=false; this.rockTime=0; this.handleValue=this.handleTarget=0; this.hinge=null;
    if (old) { this.scene.remove(old); disposeModel(old); }
    this.current=group; this.form=key; this.mode=mode; this.scene.add(group);
    if (key==='cart' && mode==='whole') {
      const pivot=new THREE.Group(); pivot.position.fromArray(manifest.cart_hinge.pivot); group.add(pivot);
      for (const name of manifest.cart_hinge.parts) { const mesh=group.userData.meshMap.get(name); if (mesh) { group.remove(mesh); mesh.position.copy(pivot.position).multiplyScalar(-1); pivot.add(mesh); } }
      this.hinge=pivot;
    }
    this.fit(group, key, mode);
    if (!state.reduced) { setGroupOpacity(group,0); this.appear=0; } else { setGroupOpacity(group,1); this.appear=1; }
    if (!this.hero) this.createHotspots(); this.dirty=true;
  }
  fit(group,key,mode) {
    group.updateMatrixWorld(true); const box=new THREE.Box3().setFromObject(group); const size=box.getSize(new THREE.Vector3()); this.box=box;
    const target=box.getCenter(new THREE.Vector3()); const radius=box.getBoundingSphere(new THREE.Sphere()).radius;
    this.halfHeight=radius*.88 / Math.min(1,this.aspect||1); this.setFrustum(); this.controls.target.copy(target);
    let direction=FORM[key]?.direction || [-.25,.22,.27]; if (mode==='flatpack') direction=[0,1,.0001];
    this.camera.position.copy(target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(Math.max(5,radius*6))); this.camera.zoom=1; this.camera.updateProjectionMatrix(); this.controls.update();
    this.defaultCamera=this.camera.position.clone(); this.defaultTarget=target.clone(); this.defaultZoom=1;
    this.homeHalfHeight=this.halfHeight; this.reverse=false; this.dirty=true;
  }
  reset() {
    if (!this.current || !this.defaultCamera) return;
    this.halfHeight=this.homeHalfHeight; this.setFrustum(); this.cameraTween={ from:this.camera.position.clone(),to:this.defaultCamera.clone(),targetFrom:this.controls.target.clone(),targetTo:this.defaultTarget.clone(),zoomFrom:this.camera.zoom,zoomTo:1,t:0 };
    this.reverse=false; this.dirty=true;
  }
  reverseView() {
    const offset=this.camera.position.clone().sub(this.controls.target); offset.applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI); this.cameraTween={from:this.camera.position.clone(),to:this.controls.target.clone().add(offset),targetFrom:this.controls.target.clone(),targetTo:this.controls.target.clone(),zoomFrom:this.camera.zoom,zoomTo:this.camera.zoom,t:0}; this.reverse=!this.reverse; this.dirty=true;
  }
  pick(event) {
    if (!this.current || !this.inView) return null;
    const r=this.renderer.domElement.getBoundingClientRect(); this.pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera); const objects=[]; this.current.traverse((o)=>{if(o.isMesh&&o.visible&&o.material.opacity>.2)objects.push(o);});
    return this.raycaster.intersectObjects(objects,false)[0]?.object || null;
  }
  highlight(mesh) {
    if (this.hovered===mesh) return;
    if (this.hovered && this.hovered!==this.selected) this.paint(this.hovered,false);
    this.hovered=mesh; if(mesh)this.paint(mesh,true); this.dirty=true;
  }
  paint(mesh,on) { if(!mesh?.material?.userData.originalColor)return; mesh.material.color.copy(mesh.material.userData.originalColor); mesh.material.emissive.set(on?'#ac5927':'#000000'); mesh.material.emissiveIntensity=on?.12:0; }
  select(mesh,triggerAction=false) {
    if(!mesh?.userData.part)return;
    if(this.selected)this.paint(this.selected,false); this.selected=mesh;this.paint(mesh,true);this.dirty=true;
    if(this.hero) {
      if(this.form==='cart' && manifest.cart_hinge.parts.includes(mesh.name))this.toggleHandle();
      else if(this.form==='seesaw')this.toggleRock();
      else toast(`${mesh.userData.part.label} · ${mesh.userData.part.material}`);
      return;
    }
    const part=mesh.userData.part; $('#part-detail').hidden=false;$('#part-name').textContent=part.label;$('#part-material').textContent=part.material;$('#part-description').textContent=part.description;
    if(triggerAction&&state.mode==='whole') {
      if(this.form==='cart'&&manifest.cart_hinge.parts.includes(mesh.name))this.toggleHandle();
      else if(['seesaw','rocker'].includes(this.form))this.toggleRock();
    }
  }
  clearSelection() { if(this.selected)this.paint(this.selected,false);if(this.hovered)this.paint(this.hovered,false);this.selected=this.hovered=null;if(!this.hero)$('#part-detail').hidden=true; }
  focusPart() {
    if(!this.selected)return;this.selected.updateWorldMatrix(true,false);const target=new THREE.Box3().setFromObject(this.selected).getCenter(new THREE.Vector3());const offset=this.camera.position.clone().sub(this.controls.target);
    this.cameraTween={from:this.camera.position.clone(),to:target.clone().add(offset),targetFrom:this.controls.target.clone(),targetTo:target,zoomFrom:this.camera.zoom,zoomTo:Math.min(2.1,this.camera.zoom*1.4),t:0};this.dirty=true;
  }
  toggleHandle() { if(!this.hinge)return;this.handleTarget=this.handleTarget>.5?0:1;if(state.reduced){this.handleValue=this.handleTarget;this.hinge.rotation.x=THREE.MathUtils.degToRad(-20)*this.handleValue;}this.dirty=true;if(!this.hero)$('#form-action>span').textContent=this.handleTarget?'放下把手':'提起把手'; }
  toggleRock() { if(state.reduced){toast('已启用减少动态效果；关闭后可体验轻轻摇摆。');return;}this.rocking=!this.rocking;if(!this.hero)$('#form-action>span').textContent=this.rocking?'停止摇摆':'轻轻摇一摇';this.dirty=true; }
  clearHotspots() { for(const h of this.hotspotNodes)h.el.remove();this.hotspotNodes=[]; }
  createHotspots() {
    this.clearHotspots(); if(this.hero||this.mode!=='whole')return;
    const host=this.el.querySelector('.hotspots');let i=0;
    for(const name of FORM[this.form]?.hotspots||[]) {
      let mesh=this.current.userData.meshMap.get(name);if(!mesh)mesh=[...this.current.userData.meshMap.values()].find(m=>m.userData.part.category==='wood');if(!mesh)continue;
      const button=document.createElement('button');button.className='hotspot';button.textContent=++i;button.dataset.label=mesh.userData.part.label;button.setAttribute('aria-label',`查看${mesh.userData.part.label}`);button.onclick=()=>this.select(mesh,true);host.append(button);this.hotspotNodes.push({el:button,mesh});
    }
  }
  positionHotspots() {
    const rect=this.el.getBoundingClientRect();
    for(const h of this.hotspotNodes){h.mesh.updateWorldMatrix(true,false);const p=h.mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(h.mesh.matrixWorld).project(this.camera);h.el.style.left=`${(p.x*.5+.5)*rect.width}px`;h.el.style.top=`${(-p.y*.5+.5)*rect.height}px`;h.el.hidden=!state.hotspots||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;}
  }
  update(dt) {
    if(!this.inView)return;
    this.controls.update();
    if(this.appear<1){this.appear=Math.min(1,this.appear+dt*3);setGroupOpacity(this.current,this.appear);this.dirty=true;}
    if(this.current&&!state.paused){
      if(this.hinge&&Math.abs(this.handleValue-this.handleTarget)>.0005){this.handleValue=THREE.MathUtils.damp(this.handleValue,this.handleTarget,6,dt);this.hinge.rotation.x=THREE.MathUtils.degToRad(-20)*this.handleValue;this.dirty=true;}
      if(['seesaw','rocker'].includes(this.form)&&this.mode==='whole'){
        this.rockTime+=dt;const desired=this.rocking&&!state.reduced?Math.sin(this.rockTime*2.1)*.055:0;this.current.rotation.x=THREE.MathUtils.damp(this.current.rotation.x,desired,9,dt);this.current.position.y=.4*(1-Math.cos(this.current.rotation.x));this.current.position.z=-.4*Math.sin(this.current.rotation.x);if(this.rocking||Math.abs(this.current.rotation.x)>.0001)this.dirty=true;
      }
      if(this.cameraTween){const a=this.cameraTween;a.t=Math.min(1,a.t+dt/(state.reduced?.001:.8));const p=smooth(a.t);this.camera.position.lerpVectors(a.from,a.to,p);this.controls.target.lerpVectors(a.targetFrom,a.targetTo,p);this.camera.zoom=THREE.MathUtils.lerp(a.zoomFrom,a.zoomTo,p);this.camera.updateProjectionMatrix();this.controls.update();this.dirty=true;if(a.t===1)this.cameraTween=null;}
    }
    if(this.dirty){this.positionHotspots();this.renderer.render(this.scene,this.camera);this.dirty=false;}
  }
}

function updatePanel() {
  const form=FORM[state.form];const whole=state.mode==='whole';
  const explosion=manifest?.explosion_views?.[state.form];
  $$('.form-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.form===state.form)));
  $$('.mode-tabs button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode)));
  $('#decompose-controls').hidden=state.mode!=='exploded';
  $('#inspector-kicker').textContent=whole?form.kicker:state.mode==='exploded'?'EXPLORE / DISASSEMBLE':'EXPLORE / FLAT-PACK';
  $('#inspector-title').textContent=whole?form.title:state.mode==='exploded'?(explosion?`${form.label}，拆开看看。`:'整机结构，拆开看看。'):'一组构件，新的可能。';
  $('#inspector-description').textContent=whole?form.copy:state.mode==='exploded'?(explosion?.kind==='rigid_translation'?'拖动滑杆，让侧板、座面和连接销逐步分离。原始零件完整保留，每一件都可以点击观察。':'沿原模型中的拆解布局，认识板件和连接件。已确认对应的零件平滑移动，其余构件淡入淡出。'):'俯视原文件中的平铺排列。每个构件都保留自己的轮廓与细节，点击任意一件，看看它的材质。';
  $('#form-action>span').textContent=whole?form.action:state.mode==='exploded'?'开始拆解演示':'逐件看看';
  const note=explosion?.note || '展示原文件中的整机爆炸布局，包含桌板、框架与把手。未确认对应的构件仅淡入淡出。';
  $('#interaction-note').textContent=whole?form.note:state.mode==='exploded'?note:'使用原模型的现成排列，不改变零件数量和位置。';
  $('#explosion-source-note').textContent=note;
  $('#view-caption').textContent=whole?`${form.label} · 原始组合`:state.mode==='exploded'?(explosion?.label || '整机结构 · 原始爆炸布局'):'构件总览 · 原始平铺布局';
}
async function setForm(key,{scroll=false,mode=state.mode}={}) {
  if(!FORM[key])return;state.form=key;
  if(!scroll && mode!=='whole')return setMode(mode);
  state.mode='whole';state.playing=false;$('#play-explosion').textContent='▷ 播放拆解';updatePanel();const token=++switchToken;
  try{await main.show(key);if(token!==switchToken)return;}catch(error){errorIn(main.el,error,()=>setForm(key));}
  if(scroll)$('#forms').scrollIntoView({behavior:state.reduced?'instant':'smooth'});
}
async function setMode(mode) {
  if(mode==='whole')return setForm(state.form,{mode:'whole'});
  const token=++switchToken;state.mode=mode;state.playing=false;$('#play-explosion').textContent='▷ 播放拆解';updatePanel();main.loading('正在打开构件布局…');++main.generation;
  try{
    if(mode==='flatpack'){
      const bundle=await loadBundle('flatpack',p=>main.loading(`构件平铺 ${Math.round(p*100)}%`));if(token!==switchToken)return;await main.replace(createModel(bundle),'flatpack','flatpack');main.ready();
    }else{
      const config=manifest.explosion_views?.[state.form];
      if(config?.kind==='rigid_translation'){
        const bundle=await loadBundle(config.assembled,p=>main.loading(`${FORM[state.form].label}拆解 ${Math.round(p*100)}%`));if(token!==switchToken)return;
        const group=createModel(bundle);const translations=[];
        for(const [name,offset] of Object.entries(config.offsets)){
          const mesh=group.userData.meshMap.get(name);if(!mesh)throw new Error(`Missing original part: ${name}`);
          const end=new THREE.Vector3(...offset);mesh.position.copy(end);translations.push({mesh,end});
        }
        group.userData.explosion={kind:'rigid_translation',translations};state.progress=1;
        await main.replace(group,state.form,'exploded');applyExplosion(1);main.ready();return;
      }
      const assembledKey=config?.assembled || 'assembly';const explodedKey=config?.exploded || 'exploded';
      const [assembled,exploded]=await Promise.all([loadBundle(assembledKey,p=>main.loading(`正在打开组装结构 ${Math.round(p*100)}%`)),loadBundle(explodedKey)]);if(token!==switchToken)return;
      const root=new THREE.Group();const ag=createModel(assembled);const eg=createModel(exploded);root.add(ag,eg);root.userData.meshMap=new Map([...ag.userData.meshMap,...eg.userData.meshMap]);
      const mappings=(config?.mapping || manifest.explosion_mapping).map(m=>({...m,mesh:eg.userData.meshMap.get(m.exploded),position:new THREE.Vector3(...m.start_position),quaternion:new THREE.Quaternion(...m.start_quaternion)}));const matchedA=new Set(mappings.map(m=>m.assembled));const matchedB=new Set(mappings.map(m=>m.exploded));
      root.userData.explosion={ag,eg,mappings,matchedA,matchedB};state.progress=1;
      // Fit the actual exploded endpoint, rather than the union of both layouts.
      ag.visible=false;await main.replace(root,config?state.form:'exploded','exploded');ag.visible=true;applyExplosion(1);main.ready();
    }
  }catch(error){if(token===switchToken)errorIn(main.el,error,()=>setMode(mode));}
}
function applyExplosion(p) {
  const exp=main?.current?.userData.explosion;if(!exp)return;
  state.progress=THREE.MathUtils.clamp(p,0,1);const t=smooth(state.progress);
  if(exp.kind==='rigid_translation'){
    for(const {mesh,end} of exp.translations)mesh.position.copy(end).multiplyScalar(t);
    main.dirty=true;$('#explode-progress').value=Math.round(state.progress*100);$('#explode-output').textContent=`${Math.round(state.progress*100)}%`;return;
  }
  for(const m of exp.mappings){m.mesh.position.copy(m.position).multiplyScalar(1-t);m.mesh.quaternion.copy(m.quaternion).slerp(new THREE.Quaternion(),t);m.mesh.userData.poseOpacity=1;}
  exp.ag.traverse(o=>{if(o.isMesh)o.userData.poseOpacity=exp.matchedA.has(o.name)?0:1-t;});
  exp.eg.traverse(o=>{if(o.isMesh&&!exp.matchedB.has(o.name))o.userData.poseOpacity=t;});
  setGroupOpacity(main.current,main.appear ?? 1);main.dirty=true;$('#explode-progress').value=Math.round(state.progress*100);$('#explode-output').textContent=`${Math.round(state.progress*100)}%`;
}
function toggleExplosionPlay() {
  if(state.mode!=='exploded')return;
  if(state.reduced){applyExplosion(state.progress>.5?0:1);toast('减少动态效果已开启，直接切换到拆解端点。');return;}
  state.playing=!state.playing;if(state.playing&&state.progress>.99)applyExplosion(0);$('#play-explosion').textContent=state.playing?'Ⅱ 暂停拆解':'▷ 播放拆解';
}
function formAction() {
  if(state.mode==='exploded')return toggleExplosionPlay();
  if(state.mode==='flatpack'){
    const parts=[...main.current.userData.meshMap.values()];main.flatIndex=((main.flatIndex??-1)+1)%parts.length;main.select(parts[main.flatIndex]);return;
  }
  if(state.form==='cart')main.toggleHandle();
  else if(['seesaw','rocker'].includes(state.form))main.toggleRock();
  else {main.reverseView();if(state.form==='learning')$('#form-action>span').textContent=main.reverse?'返回黑板面':'查看木质阅读面';}
}

async function init() {
  const response=await fetch('./assets/models.json');if(!response.ok)throw new Error('模型清单未能读取');manifest=await response.json();
  const cartViewer=new Viewer($('#hero-cart'),{hero:true,defaultForm:'cart'});
  const seesawViewer=new Viewer($('#hero-seesaw'),{hero:true,defaultForm:'seesaw'});
  main=new Viewer($('#main-view'));
  $$('.form-tabs button').forEach(b=>b.onclick=()=>setForm(b.dataset.form));
  $$('.mode-tabs button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  $$('[data-open-form]').forEach(b=>b.onclick=()=>setForm(b.dataset.openForm,{scroll:true}));
  $$('[data-lab-form]').forEach(b=>b.onclick=async()=>{await setForm(b.dataset.labForm,{mode:'whole'});if(b.dataset.labMode!=='whole')await setMode(b.dataset.labMode);$('#forms').scrollIntoView({behavior:state.reduced?'instant':'smooth'});});
  $$('[data-reset]').forEach(b=>b.onclick=()=>viewers.find(v=>v.el.id===b.dataset.reset)?.reset());
  $('#reset-view').onclick=()=>main.reset();$('#form-action').onclick=formAction;
  $('#pause-all').onclick=()=>{state.paused=!state.paused;$('#pause-all').setAttribute('aria-pressed',String(state.paused));$('#pause-all>span:last-child').textContent=state.paused?'继续动画':'暂停动画';$('#pause-all>span:first-child').textContent=state.paused?'▷':'Ⅱ';};
  $('#show-hotspots').onchange=e=>{state.hotspots=e.target.checked;main.dirty=true;};
  $('#reduce-motion').onchange=e=>{state.reduced=e.target.checked;if(state.reduced){state.playing=false;viewers.forEach(v=>{v.rocking=false;v.dirty=true;});$('#play-explosion').textContent='▷ 播放拆解';}};
  $('#explode-progress').oninput=e=>{state.playing=false;$('#play-explosion').textContent='▷ 播放拆解';applyExplosion(Number(e.target.value)/100);};
  $('#play-explosion').onclick=toggleExplosionPlay;$('#restore-assembly').onclick=()=>{state.playing=false;$('#play-explosion').textContent='▷ 播放拆解';applyExplosion(0);};
  $('#focus-part').onclick=()=>main.focusPart();$('#close-part').onclick=()=>{main.clearSelection();main.dirty=true;};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)viewers.forEach(v=>v.dirty=true);});
  const params=new URLSearchParams(location.search);
  const initialForm=FORM[params.get('form')]?params.get('form'):'cart';
  const initialMode=['whole','exploded','flatpack'].includes(params.get('mode'))?params.get('mode'):'whole';
  state.form=initialForm;updatePanel();
  const tasks=[cartViewer.show('cart').catch(e=>errorIn(cartViewer.el,e,()=>location.reload())),seesawViewer.show('seesaw').catch(e=>errorIn(seesawViewer.el,e,()=>location.reload()))];
  await Promise.all([...tasks,initialMode==='whole'?setForm(initialForm,{mode:'whole'}):setMode(initialMode)]);
  window.replayReady=true;
  window.replayInspect=()=>({form:state.form,mode:state.mode,progress:state.progress,paused:state.paused,reduced:state.reduced,playing:state.playing,selected:main.selected?.name,viewers:viewers.map(v=>({id:v.el.id,form:v.form,meshes:v.current?.userData.meshMap?.size,handle:v.handleValue,rocking:v.rocking,camera:v.camera.position.toArray(),zoom:v.camera.zoom})),verifiedExplosionPairs:manifest.explosion_mapping.length});
}

function tick() {
  requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.05);
  if(document.hidden)return;
  if(main&&state.playing&&!state.paused&&!state.reduced&&state.mode==='exploded'){
    applyExplosion(state.progress+dt/4.5);if(state.progress>=1){state.playing=false;$('#play-explosion').textContent='▷ 播放拆解';}
  }
  for(const viewer of viewers)viewer.update(dt);
}
tick();
init().catch(error=>{$$('.model-view').forEach(el=>errorIn(el,error,()=>location.reload()));});
