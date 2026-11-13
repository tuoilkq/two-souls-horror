import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const socket = io();
const $ = id => document.getElementById(id);
let scene, camera, renderer, clock, player, partner, monster, flashlight;
let myId=null, roomCode=null, isHost=false, gameLive=false, cameraMode="third", flashlightOn=true;
let yaw=0, pitch=0, keys={}, move={x:0,z:0}, fuseMeshes=[], collected=new Set(), playerName="Player";
let monsterSpeed=1.6, lastMove=0, mouseLocked=false, joystickActive=false, joystickOrigin={x:0,y:0};
let sprinting=false, myState={hp:100,stamina:100,battery:100,downed:false};
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
  `;document.head.appendChild(style);
  const hud=document.createElement("div");hud.id="v2Hud";hud.innerHTML=`<b>TWO SOULS · SURVIVAL</b>
  <div class="v2row"><label>HP <span id="v2HpText">100%</span></label><div class="v2track"><div id="v2Hp" class="v2fill" style="background:#d65b55"></div></div></div>
  <div class="v2row"><label>STAMINA <span id="v2StText">100%</span></label><div class="v2track"><div id="v2St" class="v2fill" style="background:#e2c36c"></div></div></div>
  <div class="v2row"><label>BATTERY <span id="v2BatText">100%</span></label><div class="v2track"><div id="v2Bat" class="v2fill" style="background:#80c9cf"></div></div></div>
  <div id="v2Status">เก็บ Fuse 3 ชิ้น และแก้รหัส</div>`;document.body.appendChild(hud);
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
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
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
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),mat(0x344638));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const trunk=mat(0x493a2d),leaves=mat(0x263d30),rock=mat(0x566057);
  for(let i=0;i<115;i++){
    const x=(Math.random()-.5)*100,z=(Math.random()-.5)*100;if(Math.abs(x)<5&&z>0&&z<15)continue;
    const h=3+Math.random()*5;
    const t=new THREE.Mesh(new THREE.CylinderGeometry(.18,.35,h,6),trunk);t.position.set(x,h/2,z);t.castShadow=true;scene.add(t);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(1.8+Math.random(),4+Math.random()*2,7),leaves);crown.position.set(x,h+1.2,z);crown.castShadow=true;scene.add(crown);
    colliders.push({x,z,r:.65});
  }
  // Abandoned cabin
  const cabin=new THREE.Group();const wood=mat(0x51402f);
  const base=new THREE.Mesh(new THREE.BoxGeometry(9,4.4,7),wood);base.position.y=2.2;cabin.add(base);
  const roof=new THREE.Mesh(new THREE.ConeGeometry(6.7,3.4,4),mat(0x303832));roof.rotation.y=Math.PI/4;roof.position.y=6;cabin.add(roof);
  cabin.position.set(0,0,-28);scene.add(cabin);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.5,2.8,.15),mat(0x100d0b));door.position.set(0,1.4,-24.45);scene.add(door);
  // Exit gate
  const gate=new THREE.Group();const iron=mat(0x58645b);
  for(let x=-2;x<=2;x+=.5){const bar=new THREE.Mesh(new THREE.BoxGeometry(.09,4,.12),iron);bar.position.set(x,2,0);gate.add(bar)}
  const beam=new THREE.Mesh(new THREE.BoxGeometry(4.2,.15,.15),iron);beam.position.y=4;gate.add(beam);gate.position.set(0,0,-48);scene.add(gate);
  const light=new THREE.PointLight(0xffc47a,2.0,24);light.position.set(0,3,-25);scene.add(light);
  // Fuse pickups
  const positions=[[-9,0,-12],[12,0,-24],[2,0,18]];
  positions.forEach((p,i)=>{const g=new THREE.Group();const box=new THREE.Mesh(new THREE.BoxGeometry(.45,.7,.28),mat(0x9a6d3e));g.add(box);const glow=new THREE.PointLight(0x73e8d8,2.4,7);glow.position.y=.7;g.add(glow);g.position.set(...p);g.position.y=.8;g.userData.fuse=i;scene.add(g);fuseMeshes.push(g)});
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
  window.addEventListener("blur",()=>{
    keys={};
    setSprint(false);
  });
  renderer.domElement.addEventListener("click",()=>{
    if(!("ontouchstart"in window)&&document.pointerLockElement!==renderer.domElement){
      renderer.domElement.requestPointerLock?.();
    }
  });
  renderer.domElement.addEventListener("contextmenu",e=>e.preventDefault());
  document.addEventListener("pointerlockchange",()=>mouseLocked=document.pointerLockElement===renderer.domElement);
  document.addEventListener("mousemove",e=>{
    if(!mouseLocked)return;
    yaw-=e.movementX*.0025;
    pitch=THREE.MathUtils.clamp(pitch-e.movementY*.002,-.65,.65);
  });
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
        THREE.MathUtils.clamp(2.5-Math.sin(pitch)*4,.55,5.5),
        player.position.z+Math.cos(yaw)*horizontal
      );
      camera.lookAt(player.position.x,player.position.y+1.35,player.position.z);
    }
    // Win/loss is confirmed only by server events.
  } else if(player){camera.position.set(player.position.x+7,5,player.position.z+9);camera.lookAt(player.position)}
  if(flashlight){flashlight.visible=flashlightOn}
  if(renderer)renderer.render(scene,camera);
}
function onResize(){if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}
