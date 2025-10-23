// --- Server Script ---
// --- Ephemeral Chat Application ---
// --- Everything Was Highlited for Customazation Purposes ---
// --- This is all open source you can modify anything you want ---
// --- Made by windows98unc on Discord ---
// --- Version 1.5.3 fixed commands and server since git changed it ---
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const bcrypt = require("bcrypt");
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(express.json());

// --- Serve static files ---
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// Explicitly serve uploads
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Config ---
const CHAT_PASSWORD = process.env.CHAT_PASSWORD || "default_guest_password";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "default_owner_password";
const OWNER_NAME = process.env.OWNER_NAME || "default_owner_name";

let CHAT_HASH, OWNER_HASH;
(async () => {
  CHAT_HASH = await bcrypt.hash(CHAT_PASSWORD, 10);
  OWNER_HASH = await bcrypt.hash(OWNER_PASSWORD, 10);
})();

// Token system
const tokens = {}; // token -> { expiry, user }
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

let messages = [];
const onlineUsers = new Set();

// --- File uploads ---
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.random().toString(36).slice(2);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// --- Auth endpoint ---
app.post("/auth", async (req, res) => {
  const { password, name } = req.body || {};
  if (!password || !name) return res.status(400).json({ ok: false });

  let user;
  // owner check
  if (name === OWNER_NAME && await bcrypt.compare(password, OWNER_HASH)) {
    user = { displayName: OWNER_NAME, isOwner: true };
  } else if (await bcrypt.compare(password, CHAT_HASH)) {
    user = { displayName: name, isOwner: false };
  } else {
    return res.status(403).json({ ok: false });
  }

  const token = Math.random().toString(36).slice(2);
  tokens[token] = { expiry: Date.now() + TOKEN_TTL_MS, user };
  res.json({ ok: true, token, user });
});

// --- File upload endpoint ---
app.post("/upload", upload.single("file"), (req, res) => {
  const token = req.body.token;
  if (!token || !tokens[token] || tokens[token].expiry < Date.now()) {
    return res.status(403).json({ ok: false, msg: "unauthorized" });
  }
  const user = tokens[token].user;

  if (!req.file) return res.status(400).json({ ok: false, msg: "No file" });

  const msg = {
    type: "message",
    name: user.displayName,
    text: "",
    file: `/uploads/${req.file.filename}`,
    ts: Date.now(),
    isOwner: user.isOwner,
  };
  messages.push(msg);
  broadcast(msg);
  res.json({ ok: true, file: msg.file });
});

// --- WebSocket Logic ---
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  if (!token || !tokens[token] || tokens[token].expiry < Date.now()) {
    ws.send(JSON.stringify({ type: "error", msg: "unauthorized" }));
    ws.close();
    return;
  }

  ws.user = tokens[token].user;
  onlineUsers.add(ws);

  // send history + update users list for everyone
  ws.send(JSON.stringify({ type: "history", messages }));
  broadcastUsers();

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    // Handle joins
    if (data.type === "join") {
      ws.user.displayName = data.name || ws.user.displayName;
      broadcastUsers();
      return;
    }

    // Owner commands (handled in helper)
    if (data.type === "message" && ws.user.isOwner && typeof data.text === "string" && data.text.startsWith("/")) {
      handleOwnerCommand(ws, data.text);
      return;
    }

    // Normal message
    if (data.type === "message") {
      const msg = {
        type: "message",
        ts: Date.now(),
        name: ws.user.displayName,
        text: data.text || "",
        file: data.file || null,
        isOwner: ws.user.isOwner,
      };
      messages.push(msg);
      broadcast(msg);
    }
  });

  ws.on("close", () => {
    onlineUsers.delete(ws);
    broadcastUsers();
  });
});

// --- Owner Commands ---
function handleOwnerCommand(ws, text) {
  const parts = text.split(" ");
  const cmd = parts[0];

  // Use ws.user (the connected user's info)
  const user = ws.user;

  if (cmd === "/clearmessages") {
    messages = [];
    broadcast({ type: "cleared" });
    return;
  }

  if (cmd === "/clearuploads") {
    fs.readdir(UPLOAD_DIR, (err, files) => {
      if (err) return;
      for (const f of files) {
        fs.unlink(path.join(UPLOAD_DIR, f), () => {});
      }
    });
    messages = messages.filter(m => !m.file);
    broadcast({ type: "filesCleared" });
    return;
  }

  if (cmd === "/kick") {
    const name = parts[1];
    wss.clients.forEach((c) => {
      if (c.user && c.user.displayName === name) {
        c.send(JSON.stringify({ type: "error", msg: "You were kicked!" }));
        c.close();
      }
    });
    return;
  }

  if (cmd === "/shutdown") {
    broadcast({ type: "error", msg: "Server shutting down..." });
    setTimeout(() => process.exit(0), 2000);
    return;
  }

  // --- Cat raid command ---
  if (cmd === "/catraid") {
    const raidMsg = {
      type: "message",
      name: user.displayName,
      text: "/catraid",
      isOwner: true
    };

    // Broadcast to all connected websocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(raidMsg));
      }
    });

    console.log('🐱 Cat raid triggered by owner:', user.displayName);
    return;
  }

  // Unknown owner command -> optionally broadcast as notice
  broadcast({ type: "error", msg: `Unknown command: ${cmd}` });
}

// --- Broadcast Helpers ---
function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

function broadcastUsers() {
  const list = Array.from(onlineUsers).map((ws) =>
    ws.user.isOwner ? `${ws.user.displayName} 👑` : ws.user.displayName
  );
  broadcast({ type: "users", list });
}

// --- Cleanup Tokens ---
setInterval(() => {
  const now = Date.now();
  for (const t in tokens) if (tokens[t].expiry < now) delete tokens[t];
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Ephemeral running at http://localhost:${PORT}`);
});