import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const socket = io();
const $ = id => document.getElementById(id);
let scene, camera, renderer, clock, player, partner, monster, flashlight;
let myId=null, roomCode=null, isHost=false, gameLive=false, cameraMode="third", flashlightOn=true;
let yaw=0, pitch=0, keys={}, move={x:0,z:0}, fuseMeshes=[], collected=new Set(), playerName="Player";
let monsterSpeed=1.6, lastMove=0, mouseLocked=false, joystickActive=false, joystickOrigin={x:0,y:0};\nlet hp=100, stamina=100, battery=100, puzzleSolved=false, puzzleProgress=0, sprinting=false, downed=false;
const world={x:0,z:0};
const mats={};
const colliders=[];
const socketReady=()=>socket.connected;

function toast(t){$("errorToast").textContent=t;$("errorToast").style.display="block";setTimeout(()=>$("errorToast").style.display="none",3000)}
function showMessage(t){$("message").textContent=t;$("message").classList.add("show");setTimeout(()=>$("message").classList.remove("show"),2600)}
function connectRoom(result){
  if(!result?.ok){toast(result?.error||"เชื่อมต่อห้องไม่สำเร็จ");return}
  myId=result.id;roomCode=result.code;isHost=isHost;
  $("hud").classList.remove("hidden");
  $("connection").textContent="● ONLINE · "+roomCode;
  $("lobby").classList.remove("hidden");$("codeDisplay").textContent=roomCode;
  $("playersText").textContent="รอผู้เล่นอีกคนเข้าร่วมห้อง…";
  $("startBtn").disabled=true;
  initGame();
}
$("createBtn").onclick=()=>{playerName=$("playerName").value.trim()||"Player";isHost=true;socket.emit("createRoom",playerName,connectRoom)};
$("joinBtn").onclick=()=>{playerName=$("playerName").value.trim()||"Player";socket.emit("joinRoom",{code:$("roomCode").value,name:playerName},connectRoom)};
$("copyBtn").onclick=()=>navigator.clipboard?.writeText(roomCode).then(()=>showMessage("คัดลอกรหัสห้องแล้ว"));
$("startBtn").onclick=()=>{if(isHost)socket.emit("gameStarted")};
$("cameraBtn").onclick=()=>{cameraMode=cameraMode==="third"?"first":"third";showMessage(cameraMode==="first"?"มุมมองบุคคลที่หนึ่ง":"มุมมองบุคคลที่สาม");sendMove()};
$("flashBtn").onclick=()=>{flashlightOn=!flashlightOn;flashlight.visible=flashlightOn;socket.emit("flashlightState",flashlightOn);$("flashBtn").textContent="ไฟฉาย: "+(flashlightOn?"เปิด":"ปิด")};

socket.on("roomState",state=>{
  $("playersText").textContent=state.count===2?"ผู้เล่นครบแล้ว! พร้อมเริ่มเกม":"กำลังรอผู้เล่นอีกคน…";
  $("startBtn").disabled=state.count!==2||!isHost;
  $("startBtn").textContent=state.count===2?"เริ่มเกม":"รอผู้เล่น 2 คน";
  state.players.forEach(p=>{if(p.id!==myId)makePartner(p)});
  if(state.fuses)updateFuses(state.fuses);
});
socket.on("playerMoved",p=>{makePartner(p);if(partner){partner.position.set(p.x,0,p.z);partner.rotation.y=p.rot}});
socket.on("partnerLeft",()=>{showMessage("ผู้เล่นอีกคนออกจากห้องแล้ว");$("partnerStatus").textContent="♥ เพื่อนร่วมทีม: หลุดการเชื่อมต่อ"});
socket.on("gameStarted",()=>{gameLive=true;$("menu").classList.add("hidden");$("lobby").classList.add("hidden");showMessage("ภารกิจเริ่มแล้ว… จงอยู่ด้วยกัน");});
socket.on("fusesUpdated",updateFuses);
socket.on("v2State",state=>{
  if(state.monster&&monster){monster.position.set(state.monster.x,0,state.monster.z);monster.rotation.y=state.monster.rot||0;}
  const mine=state.players?.find(p=>p.id===myId);
  if(mine){hp=mine.hp;stamina=mine.stamina;battery=mine.battery;updateVitals();}
  if(state.puzzle){puzzleProgress=state.puzzle.progress;puzzleSolved=state.puzzle.solved;updatePuzzle();}
});
socket.on("puzzleState",state=>{puzzleProgress=state.progress;puzzleSolved=state.solved;updatePuzzle();});
socket.on("gameWon",()=>{$("hud").classList.add("hidden");$("ending").classList.remove("hidden");});

socket.on("connect",()=>{$("connection").textContent="● ONLINE"});
socket.on("disconnect",()=>{$("connection").textContent="● DISCONNECTED";toast("การเชื่อมต่อขาดหาย")});

function initGame(){
  if(renderer)return;
  scene=new THREE.Scene();scene.background=new THREE.Color(0x07100d);scene.fog=new THREE.FogExp2(0x07100d,.027);
  camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.1,180);
  renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.appendChild(renderer.domElement);
  clock=new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0x8b9b9a,0x10150f,1.0));
  const moon=new THREE.DirectionalLight(0x9aaeb0,.65);moon.position.set(-20,35,10);moon.castShadow=true;scene.add(moon);
  makeWorld();makePlayer();makeMonster();setupControls();window.addEventListener("resize",onResize);animate();
}
function mat(color,roughness=1){return new THREE.MeshStandardMaterial({color,roughness})}
function makeWorld(){
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(120,120),mat(0x17231b));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const trunk=mat(0x211b16),leaves=mat(0x101d17),rock=mat(0x343a34);
  for(let i=0;i<115;i++){
    const x=(Math.random()-.5)*100,z=(Math.random()-.5)*100;if(Math.abs(x)<5&&z>0&&z<15)continue;
    const h=3+Math.random()*5;
    const t=new THREE.Mesh(new THREE.CylinderGeometry(.18,.35,h,6),trunk);t.position.set(x,h/2,z);t.castShadow=true;scene.add(t);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(1.8+Math.random(),4+Math.random()*2,7),leaves);crown.position.set(x,h+1.2,z);crown.castShadow=true;scene.add(crown);
    colliders.push({x,z,r:.65});
  }
  // Abandoned cabin
  const cabin=new THREE.Group();const wood=mat(0x30271f);
  const base=new THREE.Mesh(new THREE.BoxGeometry(9,4.4,7),wood);base.position.y=2.2;cabin.add(base);
  const roof=new THREE.Mesh(new THREE.ConeGeometry(6.7,3.4,4),mat(0x171817));roof.rotation.y=Math.PI/4;roof.position.y=6;cabin.add(roof);
  cabin.position.set(0,0,-28);scene.add(cabin);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.5,2.8,.15),mat(0x100d0b));door.position.set(0,1.4,-24.45);scene.add(door);
  // Exit gate
  const gate=new THREE.Group();const iron=mat(0x58645b);
  for(let x=-2;x<=2;x+=.5){const bar=new THREE.Mesh(new THREE.BoxGeometry(.09,4,.12),iron);bar.position.set(x,2,0);gate.add(bar)}
  const beam=new THREE.Mesh(new THREE.BoxGeometry(4.2,.15,.15),iron);beam.position.y=4;gate.add(beam);gate.position.set(0,0,-48);scene.add(gate);
  const light=new THREE.PointLight(0xffb05b,1.3,18);light.position.set(0,3,-25);scene.add(light);
  // Fuse pickups
  const positions=[[-9,0,-12],[12,0,-24],[2,0,18]];
  positions.forEach((p,i)=>{const g=new THREE.Group();const box=new THREE.Mesh(new THREE.BoxGeometry(.45,.7,.28),mat(0x9a6d3e));g.add(box);const glow=new THREE.PointLight(0x73d8c8,1.5,5);glow.position.y=.7;g.add(glow);g.position.set(...p);g.position.y=.8;g.userData.fuse=i;scene.add(g);fuseMeshes.push(g)});
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
  monster.position.set(22,0,-35);scene.add(monster);
}
function setupControls(){
  document.addEventListener("keydown",e=>{keys[e.key.toLowerCase()]=true;if(e.key.toLowerCase()==="c")$("cameraBtn").click();if(e.key.toLowerCase()==="e")interact()});
  document.addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);
  renderer.domElement.addEventListener("click",()=>{if(!("ontouchstart"in window))renderer.domElement.requestPointerLock?.()});
  document.addEventListener("pointerlockchange",()=>mouseLocked=document.pointerLockElement===renderer.domElement);
  document.addEventListener("mousemove",e=>{if(mouseLocked){yaw-=e.movementX*.0025;pitch=Math.max(-.5,Math.min(.5,pitch-e.movementY*.002))}});
  const joy=$("joystick"),stick=$("stick");
  joy.addEventListener("pointerdown",e=>{joystickActive=true;joy.setPointerCapture(e.pointerId);const r=joy.getBoundingClientRect();joystickOrigin={x:r.left+r.width/2,y:r.top+r.height/2};});
  joy.addEventListener("pointermove",e=>{if(!joystickActive)return;let dx=e.clientX-joystickOrigin.x,dy=e.clientY-joystickOrigin.y;const len=Math.hypot(dx,dy),max=35;if(len>max){dx=dx/len*max;dy=dy/len*max}stick.style.transform=`translate(${dx}px,${dy}px)`;move.x=dx/max;move.z=dy/max});
  const stop=()=>{joystickActive=false;move.x=0;move.z=0;stick.style.transform="translate(0,0)"};
  joy.addEventListener("pointerup",stop);joy.addEventListener("pointercancel",stop);
  $("interactBtn").onclick=interact;
}
function interact(){
  if(!gameLive)return;
  let nearest=null,dist=2.6;
  fuseMeshes.forEach(g=>{if(g.visible){const d=player.position.distanceTo(g.position);if(d<dist){nearest=g;dist=d}}});
  if(nearest){const id=nearest.userData.fuse;nearest.visible=false;socket.emit("collectFuse",id);showMessage("เก็บฟิวส์แล้ว!");}
  else if(Math.hypot(player.position.x,player.position.z+27)<8&&!puzzleSolved){
    const next=[2,4,1][puzzleProgress];socket.emit("puzzleInput",next);
    showMessage("แป้นรหัส: กด "+next+" · "+(puzzleProgress+1)+"/3");
  } else if(Math.hypot(player.position.x,player.position.z+27)<8&&puzzleSolved)showMessage("ปลดล็อกรหัสห้องใต้ดินแล้ว");
  else showMessage("ไม่มีสิ่งของอยู่ใกล้ๆ");
}
function updateFuses(ids){collected=new Set(ids);fuseMeshes.forEach(g=>g.visible=!collected.has(g.userData.fuse));$("fuseCount").textContent=`FUSES ${ids.length} / 3`;if(ids.length>=3){$("objectiveText").textContent=puzzleSolved?"กลับไปที่ประตูทางออก":"ค้นหารหัสที่กระท่อม";showMessage("ฟิวส์ครบแล้ว! ยังต้องไขรหัสที่กระท่อม");}}
function updateVitals(){
  if($("hpBar"))$("hpBar").style.width=hp+"%";
  if($("staminaBar"))$("staminaBar").style.width=stamina+"%";
  if($("batteryBar"))$("batteryBar").style.width=battery+"%";
  if($("hpValue"))$("hpValue").textContent=Math.ceil(hp);
  if($("batteryValue"))$("batteryValue").textContent=Math.ceil(battery);
  if(hp<=0&&!downed){downed=true;showMessage("คุณหมดแรง! เพื่อนต้องช่วยพาคุณหนี");}
}
function updatePuzzle(){
  if($("puzzleStatus"))$("puzzleStatus").textContent=puzzleSolved?"รหัสถูกต้อง ✓":"รหัสกระท่อม "+puzzleProgress+"/3 · ลำดับ 2-4-1";
  if(puzzleSolved)$("objectiveText").textContent="กลับไปที่ประตูทางออก";
}
function sendMove(){if(!player)return;const now=performance.now();if(now-lastMove<70)return;lastMove=now;socket.emit("move",{x:player.position.x,z:player.position.z,rot:yaw,camera:cameraMode})}
function animate(){
  requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);
  if(gameLive&&player){
    let forward=(keys.w||keys.arrowup?1:0)-(keys.s||keys.arrowdown?1:0)-move.z;\n    sprinting=!!(keys.shift&&stamina>8);socket.emit("sprint",sprinting);
    let side=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+move.x;
    const len=Math.hypot(forward,side);if(len>1){forward/=len;side/=len}
    const speed=sprinting?7.1:5.2;player.position.x+= (Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed*dt;player.position.z+=(-Math.cos(yaw)*forward+Math.sin(yaw)*side)*speed*dt;
    if(sprinting)socket.emit("sprint",true);\n    player.position.x=THREE.MathUtils.clamp(player.position.x,-49,49);player.position.z=THREE.MathUtils.clamp(player.position.z,-49,49);
    player.rotation.y=yaw;sendMove();
    // Monster follows the nearest player
    const target=partner&&partner.position.distanceTo(monster.position)<player.position.distanceTo(monster.position)?partner:player;
    const dir=new THREE.Vector3().subVectors(target.position,monster.position);const d=dir.length();
    if(d>1.8){dir.normalize();monster.position.addScaledVector(dir,monsterSpeed*dt);monster.rotation.y=Math.atan2(dir.x,dir.z)}
    if(d<1.8){showMessage("มันพบคุณแล้ว! รีบหนี!");monsterSpeed=2.4}
    // camera modes
    if(cameraMode==="first"){camera.position.set(player.position.x,player.position.y+1.62,player.position.z);camera.rotation.order="YXZ";camera.rotation.set(pitch,yaw,0)}
    else{const offset=new THREE.Vector3(Math.sin(yaw)*4,2.5,Math.cos(yaw)*4);camera.position.copy(player.position).add(offset);camera.lookAt(player.position.x,1.4,player.position.z)}
    // gate win
    if(collected.size===3&&puzzleSolved&&player.position.distanceTo(new THREE.Vector3(0,0,-46))<3){$("hud").classList.add("hidden");$("ending").classList.remove("hidden");}
    // lose condition: monster touch is intentionally a warning in this starter build
  } else if(player){camera.position.set(player.position.x+7,5,player.position.z+9);camera.lookAt(player.position)}
  if(flashlight){flashlight.visible=flashlightOn&&battery>0}
  if(renderer)renderer.render(scene,camera);
}
function onResize(){if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}
