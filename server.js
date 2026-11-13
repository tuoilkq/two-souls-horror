
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

app.use(express.static("public"));

const rooms = new Map();

const makeCode = () =>
  crypto.randomBytes(3).toString("hex").toUpperCase();

const clamp = (n, min, max) =>
  Math.max(min, Math.min(max, n));

const distance = (a, b) =>
  Math.hypot(a.x - b.x, a.z - b.z);

// ตำแหน่ง Fuse ทั้ง 3 จุด
const FUSE_POSITIONS = [
  [-9, -12],
  [12, -24],
  [2, 18]
];

// รหัสตู้ปริศนา
const PUZZLE_SEQUENCE = [2, 4, 1];

function createGameRoom(socket) {
  return {
    players: new Map(),
    fuses: [],
    started: false,
    won: false,
    hostId: socket.id,

    monster: {
      x: 22,
      z: -35,
      rot: 0,
      alert: false
    },

    puzzle: {
      progress: 0,
      solved: false,
      sequence: [...PUZZLE_SEQUENCE]
    },

    createdAt: Date.now()
  };
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    z: p.z,
    rot: p.rot,
    camera: p.camera,
    hp: p.hp,
    stamina: p.stamina,
    battery: p.battery,
    flashlight: p.flashlight,
    sprinting: p.sprinting,
    downed: p.downed
  };
}

function emitState(code, room) {
  io.to(code).emit("v2State", {
    players: [...room.players.values()].map(publicPlayer),
    monster: { ...room.monster },
    fuses: [...room.fuses],
    puzzle: {
      progress: room.puzzle.progress,
      solved: room.puzzle.solved
    },
    won: room.won
  });
}

function emitRoomState(code, room) {
  io.to(code).emit("roomState", {
    players: [...room.players.values()].map(publicPlayer),
    count: room.players.size,
    started: room.started,
    fuses: [...room.fuses]
  });
}

// ==================================================
// SOCKET CONNECTION
// ==================================================

io.on("connection", socket => {

  // สร้างห้อง
  socket.on("createRoom", (name, cb) => {
    let code;

    do {
      code = makeCode();
    } while (rooms.has(code));

    const room = createGameRoom(socket);
    rooms.set(code, room);

    joinRoom(socket, code, name, cb);
  });

  // เข้าร่วมห้อง
  socket.on("joinRoom", ({ code, name } = {}, cb) => {
    code = String(code || "").trim().toUpperCase();

    const room = rooms.get(code);

    if (!room) {
      return cb?.({
        ok: false,
        error: "ไม่พบห้องนี้ กรุณาตรวจสอบรหัส"
      });
    }

    if (room.started) {
      return cb?.({
        ok: false,
        error: "เกมเริ่มไปแล้ว ไม่สามารถเข้าร่วมได้"
      });
    }

    if (room.players.size >= 2) {
      return cb?.({
        ok: false,
        error: "ห้องนี้มีผู้เล่นครบ 2 คนแล้ว"
      });
    }

    joinRoom(socket, code, name, cb);
  });

  // ==================================================
  // PLAYER MOVEMENT
  // ==================================================

  socket.on("move", data => {
    const room = rooms.get(socket.data.room);

    if (!room || !data) return;

    const p = room.players.get(socket.id);

    if (!p || !room.started || p.downed) return;

    const x = Number(data.x);
    const z = Number(data.z);
    const rot = Number(data.rot);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      !Number.isFinite(rot)
    ) return;

    p.x = clamp(x, -49, 49);
    p.z = clamp(z, -49, 49);
    p.rot = clamp(rot, -Math.PI * 20, Math.PI * 20);
    p.camera = data.camera === "first" ? "first" : "third";

    socket.to(socket.data.room).emit(
      "playerMoved",
      { id: socket.id, ...publicPlayer(p) }
    );
  });

  // ==================================================
  // SURVIVAL SYSTEM
  // ==================================================

  socket.on("sprint", enabled => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);

    if (!room?.started || !p || p.downed) return;

    p.sprinting = Boolean(enabled) &&
      p.stamina > 5 &&
      p.hp > 0;
  });

  socket.on("flashlightState", enabled => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);

    if (!p || !room?.started) return;

    p.flashlight =
      Boolean(enabled) &&
      p.battery > 0 &&
      !p.downed;
  });

  // ==================================================
  // COLLECT FUSE
  // ==================================================

  socket.on("collectFuse", fuseId => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);

    if (!room || !room.started || !p || p.downed) return;

    const index = Number(fuseId);

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= FUSE_POSITIONS.length
    ) return;

    const [fx, fz] = FUSE_POSITIONS[index];

    // ต้องเดินเข้าใกล้ Fuse ก่อนเก็บ
    if (Math.hypot(p.x - fx, p.z - fz) > 3.2) {
      return;
    }

    if (room.fuses.includes(index)) return;

    room.fuses.push(index);

    io.to(socket.data.room).emit(
      "fusesUpdated",
      room.fuses
    );

    io.to(socket.data.room).emit(
      "fuseCollected",
      { id: index, by: socket.id }
    );

    emitState(socket.data.room, room);
  });

  // ==================================================
  // PUZZLE SYSTEM
  // ==================================================

  socket.on("puzzleInput", value => {
    const room = rooms.get(socket.data.room);
    const p = room?.players.get(socket.id);

    if (
      !room ||
      !room.started ||
      !p ||
      p.downed ||
      room.puzzle.solved
    ) return;

    // ต้องอยู่ใกล้ตู้รหัส
    if (Math.hypot(p.x, p.z + 27) > 8) return;

    const n = Number(value);

    if (!Number.isInteger(n) || n < 1 || n > 9) return;

    const expected =
      room.puzzle.sequence[room.puzzle.progress];

    if (n === expected) {
      room.puzzle.progress++;

      if (
        room.puzzle.progress >=
        room.puzzle.sequence.length
      ) {
        room.puzzle.solved = true;

        io.to(socket.data.room).emit("puzzleSolved");
      }
    } else {
      room.puzzle.progress = 0;

      io.to(socket.data.room).emit("puzzleWrong");
    }

    io.to(socket.data.room).emit("puzzleState", {
      progress: room.puzzle.progress,
      solved: room.puzzle.solved
    });

    emitState(socket.data.room, room);
  });

  // ==================================================
  // CO-OP REVIVE
  // ==================================================

  socket.on("revivePartner", targetId => {
    const room = rooms.get(socket.data.room);

    if (!room || !room.started) return;

    const helper = room.players.get(socket.id);
    const target = room.players.get(targetId);

    if (!helper || !target || !target.downed) return;
    if (helper.downed || helper.hp <= 0) return;

    if (distance(helper, target) > 3) return;

    target.hp = 35;
    target.downed = false;
    target.sprinting = false;

    io.to(socket.data.room).emit("playerRevived", {
      id: target.id,
      hp: target.hp
    });

    emitState(socket.data.room, room);
  });

  // ==================================================
  // START GAME
  // ==================================================

  socket.on("gameStarted", () => {
    const room = rooms.get(socket.data.room);

    if (!room) return;

    if (room.players.size !== 2) return;
    if (room.hostId !== socket.id) return;
    if (room.started || room.won) return;

    room.started = true;
    room.won = false;
    room.fuses = [];

    room.monster = {
      x: 22,
      z: -35,
      rot: 0,
      alert: false
    };

    room.puzzle = {
      progress: 0,
      solved: false,
      sequence: [...PUZZLE_SEQUENCE]
    };

    for (const p of room.players.values()) {
      p.hp = 100;
      p.stamina = 100;
      p.battery = 100;
      p.flashlight = true;
      p.sprinting = false;
      p.downed = false;
    }

    io.to(socket.data.room).emit("gameStarted");

    emitState(socket.data.room, room);
  });

  // ==================================================
  // DISCONNECT
  // ==================================================

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);

    if (!room) return;

    room.players.delete(socket.id);

    socket.to(code).emit("partnerLeft");

    if (room.players.size === 0) {
      rooms.delete(code);
      return;
    }

    // หยุดเกมเมื่อเพื่อนออก
    room.started = false;
    room.won = false;
    room.hostId = [...room.players.keys()][0];

    for (const p of room.players.values()) {
      p.sprinting = false;
    }

    emitRoomState(code, room);
    emitState(code, room);
  });
});

// ==================================================
// JOIN ROOM
// ==================================================

function joinRoom(socket, code, name, cb) {
  const room = rooms.get(code);

  if (!room) return;

  const player = {
    id: socket.id,
    name: String(name || "นักสำรวจ").slice(0, 18),

    x: room.players.size === 0 ? -3 : 3,
    z: 5,
    rot: 0,
    camera: "third",

    hp: 100,
    stamina: 100,
    battery: 100,

    flashlight: true,
    sprinting: false,
    downed: false
  };

  room.players.set(socket.id, player);

  socket.join(code);
  socket.data.room = code;

  cb?.({
    ok: true,
    code,
    id: socket.id,
    isHost: room.hostId === socket.id,
    players: [...room.players.values()].map(publicPlayer)
  });

  emitRoomState(code, room);
  emitState(code, room);
}

// ==================================================
// MONSTER + SURVIVAL SIMULATION
// ==================================================

setInterval(() => {
  for (const [code, room] of rooms) {
    if (
      !room.started ||
      room.won ||
      room.players.size === 0
    ) continue;

    const players = [...room.players.values()];

    const activePlayers = players.filter(
      p => !p.downed && p.hp > 0
    );

    // ทรัพยากรผู้เล่น
    for (const p of players) {
      if (p.sprinting) {
        p.stamina = clamp(
          p.stamina - 2.8, 0, 100
        );
      } else {
        p.stamina = clamp(
          p.stamina + 1.8, 0, 100
        );
      }

      if (p.stamina <= 0) {
        p.sprinting = false;
      }

      if (p.flashlight && p.battery > 0) {
        p.battery = clamp(
          p.battery - 0.22, 0, 100
        );
      }

      if (p.battery <= 0) {
        p.flashlight = false;
      }
    }

    // Monster AI
    let target = null;

    for (const p of activePlayers) {
      if (
        !target ||
        distance(p, room.monster) <
        distance(target, room.monster)
      ) {
        target = p;
      }
    }

    if (target) {
      const dx = target.x - room.monster.x;
      const dz = target.z - room.monster.z;
      const d = Math.hypot(dx, dz);

      if (d > 1.45) {
        const speed = d < 12 ? 2.15 : 1.45;

        room.monster.x +=
          (dx / Math.max(d, 0.001)) *
          speed * 0.25;

        room.monster.z +=
          (dz / Math.max(d, 0.001)) *
          speed * 0.25;

        room.monster.rot = Math.atan2(dx, dz);
      }

      room.monster.alert = d < 16;

      // Monster attacks
      for (const p of activePlayers) {
        if (distance(p, room.monster) < 1.65) {
          p.hp = clamp(p.hp - 2.5, 0, 100);

          if (p.hp <= 0) {
            p.downed = true;
            p.sprinting = false;

            io.to(code).emit("playerDowned", {
              id: p.id
            });
          }
        }
      }
    } else {
      room.monster.alert = false;
    }

    // Both players down
    if (
      players.every(p => p.downed || p.hp <= 0)
    ) {
      room.started = false;

      io.to(code).emit("gameOver");
      emitState(code, room);
      continue;
    }

    // Exit condition:
    // Collect 3 fuses + solve puzzle + reach exit
    if (
      room.fuses.length === 3 &&
      room.puzzle.solved
    ) {
      const atExit = activePlayers.some(
        p => Math.hypot(p.x, p.z + 46) < 3.5
      );

      if (atExit) {
        room.won = true;

        io.to(code).emit("gameWon");
      }
    }

    emitState(code, room);
  }
}, 250);

// ==================================================
// SERVER START
// ==================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Two Souls V2 running on port ${PORT}`);
});
