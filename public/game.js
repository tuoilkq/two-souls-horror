import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const socket = io();
const $ = id => document.getElementById(id);
let scene, camera, renderer, clock, player, partner, monster, flashlight;
let myId=null, roomCode=null, isHost=false, gameLive=false, cameraMode="third", flashlightOn=true;
let yaw=0, pitch=0, keys={}, move={x:0,z:0}, fuseMeshes=[], collected=new Set(), playerName="Player";
let monsterSpeed=1.6, lastMove=0, mouseLocked=false, joystickActive=false, joystickOrigin={x:0,y:0};
let sprinting=false, touchLookId=null, touchLookLast={x:0,y:0}, exploredObjects=new Set(), myState={hp:100,stamina:100,battery:100,downed:false};
let partnerState=null, puzzleState={progress:0,solved:false};
let lastMonsterWarning=0;
const world={x:0,z:0};
const mats={};
const colliders=[];
const socketReady=()=>socket.connected;

function toast(t){$("errorToast").textContent=t;$("errorToast").style.display="block";setTimeout(()=>$("errorToast").style.display="none",3000)}
function showMessage(t){$("message").textContent=t;$("message").classList.add("show");setTimeout(()=>$("message").classList.remove("show"),2600)}
function connectRoom(result){
  if(!result?.ok){toast(result?.error||"เชื่อมต่อห้องไม่สำเร็จ");return}
  myId=result.id;roomCode=result.code;isHost=Boolean(result.isHost)||isHost;
  $("hud").classList.remove("hidden");
  $("connection").textContent="● ONLINE · "+roomCode;
  $("lobby").classList.remove("hidden");$("codeDisplay").textContent=roomCode;
  $("playersText").textContent="รอผู้เล่นอีกคนเข้าร่วมห้อง…";
  $("startBtn").disabled=true;
  initGame();
  if(Array.isArray(result.players)) result.players.forEach(p=>{if(p.id!==myId)makePartner(p)});
}
$("createBtn").onclick=()=>{playerName=$("playerName").value.trim()||"Player";isHost=true;socket.emit("createRoom",playerName,connectRoom)};
$("joinBtn").onclick=()=>{playerName=$("playerName").value.trim()||"Player";socket.emit("joinRoom",{code:$("roomCode").value,name:playerName},connectRoom)};
$("copyBtn").onclick=()=>navigator.clipboard?.writeText(roomCode).then(()=>showMessage("คัดลอกรหัสห้องแล้ว"));
$("startBtn").onclick=()=>{if(isHost)socket.emit("gameStarted")};
$("cameraBtn").onclick=()=>{cameraMode=cameraMode==="third"?"first":"third";showMessage(cameraMode==="first"?"มุมมองบุคคลที่หนึ่ง":"มุมมองบุคคลที่สาม");sendMove()};
$("flashBtn").onclick=toggleFlashlight;

socket.on("roomState",state=>{
  $("playersText").textContent=state.count===2?"ผู้เล่นครบแล้ว! พร้อมเริ่มเกม":"กำลังรอผู้เล่นอีกคน…";
  $("startBtn").disabled=state.count!==2||!isHost;
  $("startBtn").textContent=state.count===2?"เริ่มเกม":"รอผู้เล่น 2 คน";
  state.players.forEach(p=>{if(p.id!==myId)makePartner(p)});
  if(state.fuses)updateFuses(state.fuses);
  if(!state.started)gameLive=false;
});
socket.on("playerMoved",p=>{makePartner(p);if(partner){partner.position.set(p.x,0,p.z);partner.rotation.y=p.rot}});
socket.on("partnerLeft",()=>{showMessage("ผู้เล่นอีกคนออกจากห้องแล้ว");$("partnerStatus").textContent="♥ เพื่อนร่วมทีม: หลุดการเชื่อมต่อ"});
socket.on("gameStarted",()=>{
  gameLive=true;myState={hp:100,stamina:100,battery:100,downed:false};
  flashlightOn=true;if(flashlight)flashlight.visible=true;
  $("menu").classList.add("hidden");$("lobby").classList.add("hidden");
  $("hud").classList.remove("hidden");showMessage("ภารกิจเริ่มแล้ว… อย่าทิ้งคู่หูไว้ข้างหลัง");
});
socket.on("fusesUpdated",updateFuses);
socket.on("v2State",applyV2State);
socket.on("puzzleState",s=>{puzzleState=s;updatePuzzleUI()});
socket.on("puzzleSolved",()=>{puzzleState.solved=true;closePuzzle();showMessage("ปลดล็อกรหัสสำเร็จ! ไปที่ประตูทางออก")});
socket.on("puzzleWrong",()=>showMessage("รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง"));
socket.on("fuseCollected",d=>{if(d.by!==myId)showMessage("เพื่อนร่วมทีมเก็บฟิวส์ได้แล้ว")});
socket.on("playerDowned",d=>showMessage(d.id===myId?"คุณล้มลง! รอให้เพื่อนมาช่วย":"เพื่อนร่วมทีมล้มลง รีบไปช่วย!"));
socket.on("playerRevived",d=>showMessage(d.id===myId?"คุณได้รับการช่วยเหลือแล้ว":"ช่วยเพื่อนสำเร็จ"));
socket.on("gameWon",()=>{gameLive=false;$("hud").classList.add("hidden");$("ending").classList.remove("hidden");showMessage("คุณทั้งสองหนีรอดแล้ว!")});
socket.on("gameOver",()=>{gameLive=false;showMessage("ทั้งสองคนหมดแรงแล้ว ภารกิจล้มเหลว")});
socket.on("connect",()=>{$("connection").textContent="● ONLINE"});
socket.on("disconnect",()=>{$("connection").textContent="● DISCONNECTED";toast("การเชื่อมต่อขาดหาย")});

function addV2Interface(){
  if($("v2Hud"))return;
  const style=document.createElement("style");
  style.textContent=`
  #v2Hud{position:fixed;left:14px;top:14px;z-index:20;width:210px;padding:11px;color:#f5f5ed;background:#07100ddd;border:1px solid #81968a88;border-radius:12px;font:600 12px system-ui;backdrop-filter:blur(8px)}
  .v2row{margin:7px 0}.v2row label{display:flex;justify-content:space-between;margin-bottom:3px}.v2track{height:8px;background:#29332e;border-radius:8px;overflow:hidden}.v2fill{height:100%;width:100%}
  #v2Actions{position:fixed;right:14px;bottom:18px;z-index:25;display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;max-width:220px}
  .v2btn{padding:10px 12px;border-radius:10px;border:1px solid #91a69a;background:#15221dee;color:white;font-weight:700}
  #v2Puzzle{position:fixed;z-index:40;left:50%;top:50%;transform:translate(-50%,-50%);width:min(310px,90vw);padding:18px;text-align:center;background:#09120ff5;color:white;border:1px solid #82958a;border-radius:14px}
  #v2Puzzle button{margin:5px;padding:11px 16px;border-radius:8px;background:#26382e;color:white;border:1px solid #87998e;font-size:17px}
  @media(max-width:700px){#v2Hud{left:7px;top:7px;width:165px;padding:8px;font-size:11px}#v2Actions{right:7px;bottom:10px;max-width:185px}.v2btn{padding:9px;font-size:12px}}
  @media(hover:hover){#v2LookHint{display:none}}
  `;document.head.appendChild(style);
  const hud=document.createElement("div");hud.id="v2Hud";hud.innerHTML=`<b>TWO SOULS · SURVIVAL</b>
  <div class="v2row"><label>HP <span id="v2HpText">100%</span></label><div class="v2track"><div id="v2Hp" class="v2fill" style="background:#d65b55"></div></div></div>
  <div class="v2row"><label>STAMINA <span id="v2StText">100%</span></label><div class="v2track"><div id="v2St" class="v2fill" style="background:#e2c36c"></div></div></div>
  <div class="v2row"><label>BATTERY <span id="v2BatText">100%</span></label><div class="v2track"><div id="v2Bat" class="v2fill" style="background:#80c9cf"></div></div></div>
  <div id="v2Status">เก็บ Fuse 3 ชิ้น และแก้รหัส</div>`;document.body.appendChild(hud);
  const lookHint=document.createElement("div");lookHint.id="v2LookHint";lookHint.textContent="ลากนิ้วบนพื้นที่ด้านขวาเพื่อหมุนกล้อง · ซ้ายใช้เดิน";lookHint.style.cssText="position:fixed;right:12px;bottom:92px;z-index:18;color:#fff9;background:#07100d88;padding:7px 10px;border-radius:9px;font:600 11px system-ui;pointer-events:none";document.body.appendChild(lookHint);
  const actions=document.createElement("div");actions.id="v2Actions";actions.innerHTML=`<button class="v2btn" id="v2Sprint">วิ่ง</button><button class="v2btn" id="v2Use">สำรวจ / ใช้</button><button class="v2btn" id="v2Lamp">ไฟฉาย</button><button class="v2btn" id="v2Revive" style="display:none">ช่วยเพื่อน</button>`;document.body.appendChild(actions);
  const puzzle=document.createElement("div");puzzle.id="v2Puzzle";puzzle.style.display="none";puzzle.innerHTML=`<b style="font-size:18px">CABIN KEYPAD</b><p>ใส่รหัส 3 ตัวเพื่อปลดล็อกประตู</p><div id="v2PuzzleProgress">ความคืบหน้า 0 / 3</div><div>${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-code="${n}">${n}</button>`).join("")}</div><button id="v2PuzzleClose">ปิด</button>`;document.body.appendChild(puzzle);
}
function applyV2State(state){
  if(!state)return;
  const mine=state.players?.find(p=>p.id===myId),other=state.players?.find(p=>p.id!==myId);
  if(mine){myState=mine;flashlightOn=Boolean(mine.flashlight);if(flashlight)flashlight.visible=flashlightOn;updateBars(mine)}
  if(other){partnerState=other;makePartner(other);if(partner)partner.position.set(other.x,0,other.z)}
  if(state.monster&&monster){monster.userData.targetPosition.set(state.monster.x,0,state.monster.z);monster.userData.targetRotation=state.monster.rot||0}
  if(state.fuses)updateFuses(state.fuses);
  if(state.puzzle){puzzleState=state.puzzle;updatePuzzleUI()}
  const canRevive=partnerState?.downed&&!myState.downed&&partner&&player&&player.position.distanceTo(partner.position)<=3.5;
  $("v2Revive").style.display=canRevive?"block":"none";
  $("v2Status").textContent=`FUSES ${state.fuses?.length||0}/3 · CODE ${state.puzzle?.solved?"SOLVED":"LOCKED"}`;
}
function updateBars(p){for(const [id,key] of [["Hp","hp"],["St","stamina"],["Bat","battery"]]){const n=Math.max(0,Math.min(100,Math.round(p[key]??100)));$("v2"+id).style.width=n+"%";$("v2"+id+"Text").textContent=n+"%"}}
function toggleFlashlight(){flashlightOn=!flashlightOn;if(flashlight)flashlight.visible=flashlightOn;$("flashBtn").textContent="ไฟฉาย: "+(flashlightOn?"เปิด":"ปิด");$("v2Lamp").textContent=flashlightOn?"ปิดไฟฉาย":"เปิดไฟฉาย";socket.emit("flashlightState",flashlightOn)}
function setSprint(on){const next=Boolean(on)&&gameLive&&!myState.downed&&(myState.stamina??100)>5;if(next===sprinting)return;sprinting=next;socket.emit("sprint",sprinting)}
function openPuzzle(){ $("v2Puzzle").style.display="block";updatePuzzleUI() }
function closePuzzle(){if($("v2Puzzle"))$("v2Puzzle").style.display="none"}
function updatePuzzleUI(){if($("v2PuzzleProgress"))$("v2PuzzleProgress").textContent=puzzleState.solved?"ปลดล็อกแล้ว!":`ความคืบหน้า ${puzzleState.progress||0} / 3`}
function revivePartner(){if(partnerState?.id)socket.emit("revivePartner",partnerState.id)}

function initGame(){
  if(renderer)return;
  addV2Interface();
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x18251f);
  scene.fog=new THREE.FogExp2(0x18251f,.014);
  camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.1,180);
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.domElement.style.touchAction="none";
  document.documentElement.style.touchAction="none";
  document.body.style.touchAction="none";
  document.body.style.overscrollBehavior="none";
  renderer.domElement.style.position="fixed";
  renderer.domElement.style.inset="0";
  renderer.domElement.style.zIndex="0";
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.25;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.style.touchAction="none";
  document.body.appendChild(renderer.domElement);
  clock=new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0xb9d0d0,0x344033,1.8));
  scene.add(new THREE.AmbientLight(0x8b9a83,.55));
  const moon=new THREE.DirectionalLight(0xc4d8df,1.25);
  moon.position.set(-20,35,10);
  moon.castShadow=true;
  scene.add(moon);
  makeWorld();makePlayer();makeMonster();setupControls();window.addEventListener("resize",onResize);animate();
}
function mat(color,roughness=1){return new THREE.MeshStandardMaterial({color,roughness})}
function makeWorld(){
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),mat(0x344638));
  ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const trunk=mat(0x493a2d),leaves=mat(0x263d30),rockMat=mat(0x566057);
  const moss=mat(0x3c563b),darkWood=mat(0x392b20),warmWood=mat(0x725238),metal=mat(0x59635d);
  const addBox=(x,y,z,w,h,d,m,rot=0)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.rotation.y=rot;o.castShadow=true;o.receiveShadow=true;scene.add(o);return o};
  const addRock=(x,z,scale=1)=>{const r=new THREE.Mesh(new THREE.DodecahedronGeometry(1,0),rockMat);r.position.set(x,.35*scale,z);r.scale.set(scale*1.2,scale*.65,scale);r.rotation.set(Math.random(),Math.random()*3,Math.random());r.castShadow=true;r.receiveShadow=true;scene.add(r)};

  // Winding dirt trail from the starting clearing to the cabin and exit.
  const trailMat=mat(0x746044),trailEdge=mat(0x4e4836);
  const trail=[[-3,8],[-2,2],[-5,-5],[-2,-12],[3,-18],[1,-25],[0,-34],[0,-43],[0,-49]];
  for(let i=0;i<trail.length-1;i++){
    const [x1,z1]=trail[i],[x2,z2]=trail[i+1],dx=x2-x1,dz=z2-z1;
    const length=Math.hypot(dx,dz),angle=Math.atan2(dx,dz);
    const seg=new THREE.Mesh(new THREE.PlaneGeometry(3.4,length+1),trailMat);
    seg.rotation.x=-Math.PI/2;seg.rotation.z=-angle;seg.position.set((x1+x2)/2,.018,(z1+z2)/2);scene.add(seg);
    for(let side of [-1,1]){
      for(let t=.18;t<.9;t+=.28){const x=x1+dx*t+Math.cos(angle)*side*2.0,z=z1+dz*t-Math.sin(angle)*side*2.0;if(Math.random()>.35)addRock(x,z,.18+Math.random()*.2)}
    }
  }

  // Forest with varied tree silhouettes and a clear playable starting area.
  for(let i=0;i<105;i++){
    const x=(Math.random()-.5)*108,z=(Math.random()-.5)*108;
    if((Math.abs(x)<8&&z>-1&&z<13)||(Math.abs(x)<8&&z<-22&&z>-35))continue;
    const h=4+Math.random()*6,r=.16+Math.random()*.22;
    const t=new THREE.Mesh(new THREE.CylinderGeometry(r*.7,r*1.5,h,7),trunk);t.position.set(x,h/2,z);t.castShadow=true;scene.add(t);
    const crownCount=Math.random()>.55?2:1;
    for(let j=0;j<crownCount;j++){
      const crown=new THREE.Mesh(new THREE.ConeGeometry(1.8+Math.random()*1.3,3.5+Math.random()*2.5,7),leaves);
      crown.position.set(x,h*.72+j*1.35,z);crown.rotation.y=Math.random()*Math.PI;crown.castShadow=true;scene.add(crown);
    }
    colliders.push({x,z,r:.8});
  }
  // Fallen logs, stumps, boulders, ferns and grass clumps make the forest less empty.
  for(let i=0;i<34;i++){
    const x=(Math.random()-.5)*96,z=(Math.random()-.5)*96;
    if(Math.abs(x)<5&&z>-27&&z<12)continue;
    if(i%3===0){const log=new THREE.Mesh(new THREE.CylinderGeometry(.22,.28,2.8,7),warmWood);log.rotation.z=Math.PI/2;log.rotation.y=Math.random();log.position.set(x,.35,z);log.castShadow=true;scene.add(log)}
    else if(i%3===1)addRock(x,z,.35+Math.random()*.65);
    else{
      for(let k=0;k<4;k++){const blade=new THREE.Mesh(new THREE.ConeGeometry(.18,.8,5),moss);blade.position.set(x+(Math.random()-.5)*.6,.35,z+(Math.random()-.5)*.6);blade.rotation.z=(Math.random()-.5)*.5;scene.add(blade)}
    }
  }
  // Abandoned cabin with porch, windows, steps, roof beams and a lit entrance.
  const cabin=new THREE.Group();
  const base=new THREE.Mesh(new THREE.BoxGeometry(9,4.4,7),darkWood);base.position.y=2.2;base.castShadow=true;base.receiveShadow=true;cabin.add(base);
  for(let y=.45;y<4.2;y+=.48){const plank=new THREE.Mesh(new THREE.BoxGeometry(9.05,.055,7.05),warmWood);plank.position.y=y;cabin.add(plank)}
  const roof=new THREE.Mesh(new THREE.ConeGeometry(6.7,3.4,4),mat(0x303832));roof.rotation.y=Math.PI/4;roof.position.y=6;roof.castShadow=true;cabin.add(roof);
  for(const x of [-4.25,4.25])for(const z of [-3.25,3.25]){const post=new THREE.Mesh(new THREE.BoxGeometry(.22,3.7,.22),warmWood);post.position.set(x,1.85,z);cabin.add(post)}
  const windowMat=new THREE.MeshStandardMaterial({color:0x9b7447,emissive:0x5a3515,emissiveIntensity:.6});
  for(const x of [-2.8,2.8]){const win=new THREE.Mesh(new THREE.BoxGeometry(1.15,1.05,.08),windowMat);win.position.set(x,2.65,3.56);cabin.add(win);addBox(x,2.65,-31.56,1.3,1.2,.12,metal)}
  const porch=new THREE.Mesh(new THREE.BoxGeometry(5, .25, 2),warmWood);porch.position.set(0,.35,4.25);cabin.add(porch);
  for(const x of [-1.8,1.8]){const step=new THREE.Mesh(new THREE.BoxGeometry(1.2,.2,.65),darkWood);step.position.set(x,.18,5.2);cabin.add(step)}
  cabin.position.set(0,0,-28);scene.add(cabin);
  addBox(0,1.4,-24.42,1.5,2.8,.18,mat(0x17110c));
  addBox(-.48,1.45,-24.3,.08,2.7,.08,metal);
  // Cabin lantern and campfire glow.
  const light=new THREE.PointLight(0xffc47a,2.6,26);light.position.set(0,3.2,-23.8);scene.add(light);
  const lantern=new THREE.Group();const lampGlass=new THREE.Mesh(new THREE.BoxGeometry(.32,.48,.32),new THREE.MeshBasicMaterial({color:0xffc16d}));lampGlass.position.y=1.9;lantern.add(lampGlass);const cap=new THREE.Mesh(new THREE.ConeGeometry(.28,.18,4),metal);cap.position.y=2.23;lantern.add(cap);lantern.position.set(-3.9,0,-23.8);scene.add(lantern);const lanternLight=new THREE.PointLight(0xffb65c,1.4,12);lanternLight.position.set(-3.9,2,-23.8);scene.add(lanternLight);
  // Small campfire area and supply crates.
  const fireBase=new THREE.Mesh(new THREE.CylinderGeometry(.9,1.05,.18,9),rockMat);fireBase.position.set(-7,.1,-5);scene.add(fireBase);
  for(let i=0;i<6;i++){const a=i*Math.PI/3;addBox(-7+Math.cos(a)*.65,.28,-5+Math.sin(a)*.65,.85,.18,.18,darkWood,a)}
  const fire=new THREE.PointLight(0xff7b32,2.2,13);fire.position.set(-7,1,-5);scene.add(fire);
  const flame=new THREE.Mesh(new THREE.ConeGeometry(.34,1.2,7),new THREE.MeshBasicMaterial({color:0xff8a32}));flame.position.set(-7,.85,-5);scene.add(flame);
  addBox(-9,.55,-7,1.2,1.1,1,warmWood,.2);addBox(-8.2,.4,-7.9,.8,.8,.8,darkWood,-.3);
  // Broken fence and warning sign around the cabin approach.
  for(let i=0;i<7;i++){const x=-8+i*1.1;addBox(x,.8,-19,.12,1.6,.12,metal);if(i<6)addBox(x+.55,1.15,-19,1.1,.12,.12,warmWood)}
  addBox(7,1.7,-18,.18,3.4,.18,darkWood);addBox(7,2.65,-18,2.2,.8,.16,warmWood);addBox(7,2.65,-17.88,1.85,.48,.03,mat(0x252a24));
  // Exit gate with side pillars and warning lights.
  const gate=new THREE.Group();
  for(let x=-2;x<=2;x+=.5){const bar=new THREE.Mesh(new THREE.BoxGeometry(.09,4,.12),metal);bar.position.set(x,2,0);gate.add(bar)}
  const beam=new THREE.Mesh(new THREE.BoxGeometry(4.2,.15,.15),metal);beam.position.y=4;gate.add(beam);
  for(const x of [-2.35,2.35]){const pillar=new THREE.Mesh(new THREE.BoxGeometry(.35,4.6,.35),darkWood);pillar.position.set(x,2.2,0);gate.add(pillar)}
  gate.position.set(0,0,-48);scene.add(gate);
  for(const x of [-2.3,2.3]){const glow=new THREE.PointLight(0xff563e,1.2,9);glow.position.set(x,3,-47.5);scene.add(glow)}
  // Three fuse pickups with brighter beacon rings.
  const positions=[[-9,0,-12],[12,0,-24],[2,0,18]];
  positions.forEach((p,i)=>{
    const g=new THREE.Group();const box=new THREE.Mesh(new THREE.BoxGeometry(.45,.7,.28),mat(0xb8894d));box.castShadow=true;g.add(box);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.58,.035,6,24),new THREE.MeshBasicMaterial({color:0x73e8d8}));ring.rotation.x=Math.PI/2;ring.position.y=-.25;g.add(ring);
    const glow=new THREE.PointLight(0x73e8d8,2.8,8);glow.position.y=.7;g.add(glow);
    g.position.set(...p);g.position.y=.8;g.userData.fuse=i;scene.add(g);fuseMeshes.push(g);
  });
  // Exploration points: radio, field notebook and emergency supply box.
  const radio=new THREE.Group();addBox(-4,.55,-26,1.0,.55,.55,metal);addBox(-4,.95,-26,.75,.12,.38,darkWood);const antenna=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,1.15,6),metal);antenna.position.set(-3.65,1.45,-26);antenna.rotation.z=-.25;radio.add(antenna);radio.position.set(0,0,0);scene.add(radio);radio.userData={kind:"radio",label:"วิทยุฉุกเฉิน"};
  const notebook=new THREE.Group();const book=new THREE.Mesh(new THREE.BoxGeometry(.65,.12,.85),mat(0x8b4f38));book.position.y=.75;notebook.add(book);notebook.position.set(5,0,-8);scene.add(notebook);notebook.userData={kind:"note",label:"สมุดบันทึก"};
  const supply=new THREE.Group();const crate=new THREE.Mesh(new THREE.BoxGeometry(1.1,.9,1),warmWood);crate.position.y=.45;supply.add(crate);for(let y=.1;y<.9;y+=.25){const strap=new THREE.Mesh(new THREE.BoxGeometry(1.12,.06,1.02),metal);strap.position.y=y;supply.add(strap)}supply.position.set(9,0,9);scene.add(supply);supply.userData={kind:"supply",label:"ลังเสบียง"};
  window.explorationObjects=[radio,notebook,supply];
}
function makePlayer(){
  player=new THREE.Group();const body=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.85,4,8),mat(0x455e55));body.position.y=1;body.castShadow=true;player.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.28,12,10),mat(0xc6a78d));head.position.y=1.72;player.add(head);
  const lamp=new THREE.SpotLight(0xffe8bb,5,23,Math.PI/7,.45,1.1);lamp.position.set(0,1.65,.15);lamp.target.position.set(0,1,-5);player.add(lamp,lamp.target);flashlight=lamp;
  player.position.set(-3,0,5);scene.add(player);
}
function makePartner(p){
  if(partner)return;
  partner=new THREE.Group();const b=new THREE.Mesh(new THREE.CapsuleGeometry(.38,.85,4,8),mat(0x536b82));b.position.y=1;partner.add(b);
  const h=new THREE.Mesh(new THREE.SphereGeometry(.28,12,10),mat(0xc6a78d));h.position.y=1.72;partner.add(h);
  const glow=new THREE.PointLight(0x77b9ff,.6,5);glow.position.y=2;partner.add(glow);
  partner.position.set(p.x??3,0,p.z??5);scene.add(partner);
  $("partnerStatus").textContent="♥ เพื่อนร่วมทีม: "+(p.name||"เชื่อมต่อแล้ว");
}
function makeMonster(){
  monster=new THREE.Group();const black=mat(0x080b0a),eyes=new THREE.MeshBasicMaterial({color:0xff1e16});
  const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.65,1.7,5,8),black);torso.position.y=1.8;monster.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.48,12,10),black);head.position.y=3.15;monster.add(head);
  for(const x of [-.19,.19]){const e=new THREE.Mesh(new THREE.SphereGeometry(.075,8,8),eyes);e.position.set(x,3.2,-.42);monster.add(e)}
  monster.position.set(22,0,-35);
  monster.userData.targetPosition=new THREE.Vector3(22,0,-35);
  monster.userData.targetRotation=0;
  scene.add(monster);
}
function setupControls(){
  const keyMap={
    KeyW:"w",ArrowUp:"w",KeyS:"s",ArrowDown:"s",
    KeyA:"a",ArrowLeft:"a",KeyD:"d",ArrowRight:"d"
  };
  document.addEventListener("keydown",e=>{
    const target=e.target;
    if(target&&(target.tagName==="INPUT"||target.tagName==="TEXTAREA"||target.isContentEditable))return;
    const key=keyMap[e.code];
    if(key){keys[key]=true;e.preventDefault()}
    if(e.code==="KeyC")$("cameraBtn").click();
    if(e.code==="KeyE"){e.preventDefault();interact()}
    if(e.code==="ShiftLeft"||e.code==="ShiftRight")setSprint(true);
  });
  document.addEventListener("keyup",e=>{
    const key=keyMap[e.code];
    if(key){keys[key]=false;e.preventDefault()}
    if(e.code==="ShiftLeft"||e.code==="ShiftRight")setSprint(false);
  });
  window.addEventListener("blur",()=>{keys={};setSprint(false);touchLookId=null});
  renderer.domElement.addEventListener("click",()=>{
    if(!("ontouchstart" in window)&&document.pointerLockElement!==renderer.domElement){
      renderer.domElement.requestPointerLock?.();
    }
  });
  renderer.domElement.addEventListener("contextmenu",e=>e.preventDefault());
  document.addEventListener("pointerlockchange",()=>mouseLocked=document.pointerLockElement===renderer.domElement);
  document.addEventListener("mousemove",e=>{
    if(!mouseLocked)return;
    yaw-=e.movementX*.0025;
    pitch=THREE.MathUtils.clamp(pitch-e.movementY*.002,-.72,.72);
  });

  // Mobile camera look: listen at document capture phase so HUD overlays
  // cannot swallow the drag. Left side is reserved for the movement joystick.
  const isTouchPointer=e => e.pointerType === "touch" ||
    (e.pointerType === "" && navigator.maxTouchPoints > 0);
  const isUiTarget=el => Boolean(el?.closest?.("button,input,textarea,select,#joystick,#v2Puzzle"));
  document.addEventListener("pointerdown",e=>{
    if(!isTouchPointer(e) || e.clientX < innerWidth * .42 || touchLookId !== null || isUiTarget(e.target)) return;
    touchLookId=e.pointerId;
    touchLookLast={x:e.clientX,y:e.clientY};
    e.preventDefault();
  },{capture:true,passive:false});
  document.addEventListener("pointermove",e=>{
    if(e.pointerId !== touchLookId) return;
    const dx=e.clientX-touchLookLast.x, dy=e.clientY-touchLookLast.y;
    touchLookLast={x:e.clientX,y:e.clientY};
    yaw -= dx * .007;
    pitch = THREE.MathUtils.clamp(pitch - dy * .006, -1.05, 1.05);
    e.preventDefault();
  },{capture:true,passive:false});
  const stopTouchLook=e=>{if(e.pointerId===touchLookId)touchLookId=null};
  document.addEventListener("pointerup",stopTouchLook,true);
  document.addEventListener("pointercancel",stopTouchLook,true);

  // Fallback for older iOS Safari versions without Pointer Events.
  if(!window.PointerEvent){
    let legacyTouchId=null;
    document.addEventListener("touchstart",e=>{
      const t=[...e.changedTouches].find(t=>t.clientX>=innerWidth*.42);
      if(!t || legacyTouchId!==null || isUiTarget(e.target)) return;
      legacyTouchId=t.identifier; touchLookLast={x:t.clientX,y:t.clientY};
    },{passive:true});
    document.addEventListener("touchmove",e=>{
      if(legacyTouchId===null)return;
      const t=[...e.changedTouches].find(t=>t.identifier===legacyTouchId);
      if(!t)return;
      const dx=t.clientX-touchLookLast.x,dy=t.clientY-touchLookLast.y;
      touchLookLast={x:t.clientX,y:t.clientY};
      yaw-=dx*.007; pitch=THREE.MathUtils.clamp(pitch-dy*.006,-1.05,1.05);
      e.preventDefault();
    },{passive:false});
    const stopLegacy=()=>{legacyTouchId=null};
    document.addEventListener("touchend",stopLegacy,{passive:true});
    document.addEventListener("touchcancel",stopLegacy,{passive:true});
  }

  const joy=$("joystick"),stick=$("stick");
  joy.addEventListener("pointerdown",e=>{joystickActive=true;joy.setPointerCapture(e.pointerId);const r=joy.getBoundingClientRect();joystickOrigin={x:r.left+r.width/2,y:r.top+r.height/2};});
  joy.addEventListener("pointermove",e=>{if(!joystickActive)return;let dx=e.clientX-joystickOrigin.x,dy=e.clientY-joystickOrigin.y;const len=Math.hypot(dx,dy),max=35;if(len>max){dx=dx/len*max;dy=dy/len*max}stick.style.transform=`translate(${dx}px,${dy}px)`;move.x=dx/max;move.z=dy/max});
  const stop=()=>{joystickActive=false;move.x=0;move.z=0;stick.style.transform="translate(0,0)"};
  joy.addEventListener("pointerup",stop);joy.addEventListener("pointercancel",stop);
  $("interactBtn").onclick=interact;
  $("v2Sprint").addEventListener("pointerdown",()=>setSprint(true));
  ["pointerup","pointercancel","pointerleave"].forEach(evt=>$("v2Sprint").addEventListener(evt,()=>setSprint(false)));
  $("v2Use").onclick=interact;
  $("v2Lamp").onclick=toggleFlashlight;
  $("v2Revive").onclick=revivePartner;
  $("v2PuzzleClose").onclick=closePuzzle;
  document.querySelectorAll("#v2Puzzle [data-code]").forEach(b=>b.onclick=()=>socket.emit("puzzleInput",Number(b.dataset.code)));
}
function interact(){
  if(!gameLive||myState.downed)return;
  let nearest=null,dist=2.6;
  fuseMeshes.forEach(g=>{if(g.visible){const d=player.position.distanceTo(g.position);if(d<dist){nearest=g;dist=d}}});
  if(nearest){socket.emit("collectFuse",nearest.userData.fuse);showMessage("กำลังเก็บฟิวส์…");return;}
  const cabinDistance=Math.hypot(player.position.x,player.position.z+27);
  if(cabinDistance<=8&&!puzzleState.solved){openPuzzle();return;}
  if(partnerState?.downed&&partner&&player.position.distanceTo(partner.position)<=3.5){revivePartner();return;}
  let nearby=null,nearDist=3.2;
  (window.explorationObjects||[]).forEach(o=>{const d=player.position.distanceTo(o.position);if(d<nearDist&&!exploredObjects.has(o.userData.kind)){nearby=o;nearDist=d}});
  if(nearby){
    exploredObjects.add(nearby.userData.kind);
    const messages={radio:"วิทยุฉุกเฉิน: ได้ยินเสียงรบกวน… มีใครบางคนอยู่ในป่านี้",note:"สมุดบันทึก: ‘อย่าเปิดประตูห้องใต้ดินหลังเที่ยงคืน’",supply:"คุณค้นลังเสบียง พบผ้าพันแผลเก่าและแบตเตอรี่ที่ยังใช้ได้"};
    showMessage(messages[nearby.userData.kind]||"คุณพบเบาะแสใหม่");return;
  }
  showMessage("ไม่มีสิ่งของหรือจุดสำรวจอยู่ใกล้ๆ");
}
function updateFuses(ids){collected=new Set(ids);fuseMeshes.forEach(g=>g.visible=!collected.has(g.userData.fuse));$("fuseCount").textContent=`FUSES ${ids.length} / 3`;if(ids.length>=3){$("objectiveText").textContent="กลับไปที่ประตูทางออก";showMessage("ฟิวส์ครบแล้ว! กลับไปที่ประตู");}}
function sendMove(){if(!player||!gameLive||myState.downed)return;const now=performance.now();if(now-lastMove<70)return;lastMove=now;socket.emit("move",{x:player.position.x,z:player.position.z,rot:yaw,camera:cameraMode})}
function animate(){
  requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);
  if(gameLive&&player){
    let forward=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0)-move.z;
    let side=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+move.x;
    const len=Math.hypot(forward,side);if(len>1){forward/=len;side/=len}
    const speed=sprinting&&(myState.stamina??100)>0?8:5.2;
    // Move in the same direction the camera faces: W forward, S backward,
    // A left and D right. The input vector is normalized above for diagonals.
    const forwardX=-Math.sin(yaw), forwardZ=-Math.cos(yaw);
    const rightX=Math.cos(yaw), rightZ=-Math.sin(yaw);
    player.position.x+=(forwardX*forward+rightX*side)*speed*dt;
    player.position.z+=(forwardZ*forward+rightZ*side)*speed*dt;
    player.position.x=THREE.MathUtils.clamp(player.position.x,-49,49);player.position.z=THREE.MathUtils.clamp(player.position.z,-49,49);
    player.rotation.y=yaw;sendMove();
    // Monster AI is authoritative on the server. The client only interpolates its position.
    if(monster?.userData.targetPosition){
      monster.position.lerp(monster.userData.targetPosition,Math.min(1,dt*8));
      monster.rotation.y=THREE.MathUtils.lerp(monster.rotation.y,monster.userData.targetRotation||0,Math.min(1,dt*8));
      if(monster.position.distanceTo(player.position)<12&&performance.now()-lastMonsterWarning>5000){lastMonsterWarning=performance.now();showMessage("มีบางอย่างกำลังตามคุณอยู่…")}
    }
    // camera modes
    if(cameraMode==="first"){
      camera.position.set(player.position.x,player.position.y+1.62,player.position.z);
      camera.rotation.order="YXZ";
      camera.rotation.set(pitch,yaw,0);
    }else{
      // Third-person orbit camera: horizontal mouse controls yaw,
      // vertical mouse controls elevation, while remaining behind the player.
      const distance=5;
      const horizontal=Math.cos(pitch)*distance;
      camera.position.set(
        player.position.x+Math.sin(yaw)*horizontal,
        player.position.y+1.7+Math.sin(pitch)*distance,
        player.position.z+Math.cos(yaw)*horizontal
      );
      camera.lookAt(
        player.position.x-Math.sin(yaw)*Math.sin(pitch)*2,
        player.position.y+1.35+Math.sin(pitch)*2,
        player.position.z+Math.cos(yaw)*Math.sin(pitch)*2
      );
    }
    // Win/loss is confirmed only by server events.
  } else if(player){camera.position.set(player.position.x+7,5,player.position.z+9);camera.lookAt(player.position)}
  if(flashlight){flashlight.visible=flashlightOn}
  if(renderer)renderer.render(scene,camera);
}
function onResize(){if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}
