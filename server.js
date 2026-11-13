const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static("public"));

const rooms = new Map();
const makeCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const FUSE_POSITIONS = [[-9, -12], [12, -24], [2, 18]];
const PUZZLE_SEQUENCE = [2, 4, 1];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

io.on("connection", socket => {
  socket.on("createRoom", (name, cb) => {
    let code;
    do { code = makeCode(); } while (rooms.has(code));
    rooms.set(code, {
      players: new Map(), fuses: [], started: false, won: false, hostId: socket.id,
      monster: { x: 22, z: -35, rot: 0, alert: false },
      puzzle: { progress: 0, solved: false, sequence: PUZZLE_SEQUENCE },
      createdAt: Date.now()
    });
    joinRoom(socket, code, name, cb);
  });

  socket.on("joinRoom", ({ code, name } = {}, cb) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "ไม่พบห้องนี้ กรุณาตรวจสอบรหัส" });
    if (room.players.size >= 2) return cb?.({ ok: false, error: "ห้องนี้มีผู้เล่นครบ 2 คนแล้ว" });
    joinRoom(socket, code, name, cb);
  });

  socket.on("move", data => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.players.has(socket.id) || !data) return;
    const p = room.players.get(socket.id);
    const x = Number(data.x), z = Number(data.z), rot = Number(data.rot);
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(rot)) return;
    p.x = clamp(x, -49, 49);
    p.z = clamp(z, -49, 49);
    p.rot = clamp(rot, -Math.PI * 20, Math.PI * 20);
    p.camera = data.camera === "first" ? "first" : "third";
    socket.to(socket.data.room).emit("playerMoved", { id: socket.id, ...publicPlayer(p) });
  });

  socket.on("sprint", enabled => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);
    if (p) p.sprinting = Boolean(enabled);
  });

  socket.on("flashlightState", enabled => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);
    if (!p) return;
    p.flashlight = Boolean(enabled) && p.battery > 0;
  });

  socket.on("collectFuse", fuseId => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);
    const index = Number(fuseId);
    if (!room || !room.started || !p || !Number.isInteger(index) || index < 0 || index >= FUSE_POSITIONS.length) return;
    const [x, z] = FUSE_POSITIONS[index];
    if (Math.hypot(p.x - x, p.z - z) > 3.2) return;
    if (!room.fuses.includes(index)) room.fuses.push(index);
    io.to(socket.data.room).emit("fusesUpdated", room.fuses);
    emitState(socket.data.room, room);
  });

  socket.on("puzzleInput", value => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);
    if (!room || !room.started || !p || room.puzzle.solved) return;
    if (Math.hypot(p.x, p.z + 27) > 8) return;
    const n = Number(value);
    const expected = room.puzzle.sequence[room.puzzle.progress];
    if (n === expected) {
      room.puzzle.progress++;
      if (room.puzzle.progress >= room.puzzle.sequence.length) room.puzzle.solved = true;
    } else {
      room.puzzle.progress = 0;
    }
    io.to(socket.data.room).emit("puzzleState", {
      progress: room.puzzle.progress, solved: room.puzzle.solved
    });
  });

  socket.on("gameStarted", () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.players.size !== 2 || room.won || room.hostId !== socket.id || room.started) return;
    room.started = true;
    room.fuses = [];
    room.monster = { x: 22, z: -35, rot: 0, alert: false };
    room.puzzle = { progress: 0, solved: false, sequence: PUZZLE_SEQUENCE };
    for (const p of room.players.values()) {
      p.hp = 100; p.stamina = 100; p.battery = 100; p.flashlight = true; p.sprinting = false;
    }
    io.to(socket.data.room).emit("gameStarted");
    emitState(socket.data.room, room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    room.players.delete(socket.id);
    socket.to(code).emit("partnerLeft");
    if (room.players.size === 0) rooms.delete(code);
    else {
      room.started = false;
      for (const p of room.players.values()) p.sprinting = false;
      io.to(code).emit("roomState", { players: [...room.players.values()].map(publicPlayer), count: room.players.size, started: false, fuses: room.fuses });
      emitState(code, room);
    }
  });
});

function joinRoom(socket, code, name, cb) {
  const room = rooms.get(code);
  const player = {
    id: socket.id, name: String(name || "นักสำรวจ").slice(0, 18),
    x: room.players.size === 0 ? -3 : 3, z: 5, rot: 0, camera: "third",
    hp: 100, stamina: 100, battery: 100, flashlight: true
  };
  room.players.set(socket.id, player);
  socket.join(code);
  socket.data.room = code;
  cb?.({ ok: true, code, id: socket.id, players: [...room.players.values()].map(publicPlayer) });
  io.to(code).emit("roomState", {
    players: [...room.players.values()].map(publicPlayer),
    count: room.players.size, started: room.started, fuses: room.fuses
  });
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, x: p.x, z: p.z, rot: p.rot, camera: p.camera,
    hp: p.hp, stamina: p.stamina, battery: p.battery, flashlight: p.flashlight
  };
}

function emitState(code, room) {
  io.to(code).emit("v2State", {
    players: [...room.players.values()].map(publicPlayer),
    monster: room.monster,
    fuses: room.fuses,
    puzzle: { progress: room.puzzle.progress, solved: room.puzzle.solved },
    won: room.won
  });
}

// Server-authoritative monster and survival simulation.
// The client sends movement intent/position; monster damage and resources are decided here.
setInterval(() => {
  for (const [code, room] of rooms) {
    if (!room.started || room.won || room.players.size === 0) continue;
    const players = [...room.players.values()];
    let target = null;
    for (const p of players) {
      if (!target || distance(p, room.monster) < distance(target, room.monster)) target = p;
      p.stamina = clamp(p.stamina + (p.sprinting ? -2.8 : 1.8), 0, 100);
      if (p.stamina <= 0) p.sprinting = false;
      if (p.flashlight && p.battery > 0) p.battery = clamp(p.battery - 0.22, 0, 100);
      if (p.battery <= 0) p.flashlight = false;
    }
    if (target) {
      const dx = target.x - room.monster.x, dz = target.z - room.monster.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.45) {
        const speed = d < 12 ? 2.15 : 1.45;
        room.monster.x += dx / Math.max(d, 0.001) * speed * 0.25;
        room.monster.z += dz / Math.max(d, 0.001) * speed * 0.25;
        room.monster.rot = Math.atan2(dx, dz);
      }
      room.monster.alert = d < 16;
      for (const p of players) {
        if (distance(p, room.monster) < 1.65) p.hp = clamp(p.hp - 2.5, 0, 100);
      }
    }
    // The fuse gate opens only after both the collection and cabin keypad puzzle.
    if (room.fuses.length === 3 && room.puzzle.solved) {
      const atExit = players.some(p => Math.hypot(p.x, p.z + 46) < 3.5);
      if (atExit) {
        room.won = true;
        io.to(code).emit("gameWon");
      }
    }
    emitState(code, room);
  }
}, 250);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Two Souls V2 running on port ${PORT}`));
