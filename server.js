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

io.on("connection", socket => {
  socket.on("createRoom", (name, cb) => {
    let code;
    do { code = makeCode(); } while (rooms.has(code));
    rooms.set(code, { players: new Map(), fuses: [], started: false });
    joinRoom(socket, code, name, cb);
  });

  socket.on("joinRoom", ({ code, name }, cb) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb?.({ ok: false, error: "ไม่พบห้องนี้ กรุณาตรวจสอบรหัส" });
    if (room.players.size >= 2) return cb?.({ ok: false, error: "ห้องนี้มีผู้เล่นครบ 2 คนแล้ว" });
    joinRoom(socket, code, name, cb);
  });

  socket.on("move", data => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.players.has(socket.id)) return;
    const p = room.players.get(socket.id);
    p.x = clamp(Number(data.x) || 0, -48, 48);
    p.z = clamp(Number(data.z) || 0, -48, 48);
    p.rot = Number(data.rot) || 0;
    p.camera = data.camera === "first" ? "first" : "third";
    socket.to(socket.data.room).emit("playerMoved", { id: socket.id, ...p });
  });

  socket.on("collectFuse", fuseId => {
    const room = rooms.get(socket.data.room);
    if (!room || !room.started) return;
    if (!room.fuses.includes(fuseId)) room.fuses.push(fuseId);
    io.to(socket.data.room).emit("fusesUpdated", room.fuses);
  });

  socket.on("gameStarted", () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.players.size !== 2) return;
    room.started = true;
    room.fuses = [];
    io.to(socket.data.room).emit("gameStarted");
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    room.players.delete(socket.id);
    socket.to(code).emit("partnerLeft");
    if (room.players.size === 0) rooms.delete(code);
  });
});

function joinRoom(socket, code, name, cb) {
  const room = rooms.get(code);
  const player = {
    id: socket.id, name: String(name || "นักสำรวจ").slice(0, 18),
    x: room.players.size === 0 ? -3 : 3, z: 5, rot: 0, camera: "third"
  };
  room.players.set(socket.id, player);
  socket.join(code);
  socket.data.room = code;
  cb?.({ ok: true, code, id: socket.id, players: [...room.players.values()] });
  io.to(code).emit("roomState", {
    players: [...room.players.values()],
    count: room.players.size,
    started: room.started,
    fuses: room.fuses
  });
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Two Souls Horror running on port ${PORT}`));