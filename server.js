const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const bcrypt = require("bcrypt");
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Config ---
const CHAT_PASSWORD = process.env.CHAT_PASSWORD || "default_guest_password";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "default_owner_password";
const OWNER_NAME = process.env.OWNER_NAME || "default_owner_name";
// pre-hash passwords asynchronously
let CHAT_HASH, OWNER_HASH;
(async () => {
  CHAT_HASH = await bcrypt.hash(CHAT_PASSWORD, 10);
  OWNER_HASH = await bcrypt.hash(OWNER_PASSWORD, 10);
})();

// tokens memory
const tokens = {}; // token -> { expiry, user }
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

let messages = [];
const onlineUsers = new Set();

// uploads
const UPLOAD_DIR = path.join(__dirname, "public/uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

// --- WebSocket ---
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

  ws.send(JSON.stringify({ type: "history", messages }));
  broadcastUsers();

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }

    // Join
    if (data.type === "join") {
      ws.user.displayName = data.name || ws.user.displayName;
      broadcastUsers();
      return;
    }

    // Owner commands
    if (data.type === "message" && ws.user.isOwner && data.text.startsWith("/")) {
      const cmdParts = data.text.split(" ");
      const cmd = cmdParts[0];

      if (cmd === "/clearmessages") {
        messages = [];
        broadcast({ type: "cleared", ts: Date.now() });
        return;
      }
      if (cmd === "/clearuploads") {
        fs.readdir(UPLOAD_DIR, (err, files) => {
          if (err) throw err;
          for (const file of files) {
            fs.unlink(path.join(UPLOAD_DIR, file), (err) => {
              if (err) throw err;
            });
          }
        });
        messages = messages.filter(msg => !msg.file);
        broadcast({ type: "filesCleared", ts: Date.now() });
        return;
      }

      if (cmd === "/kick") {
        const kickName = cmdParts[1];
        wss.clients.forEach((c) => {
          if (c.user.displayName === kickName) {
            c.send(JSON.stringify({ type: "error", msg: "You were kicked!" }));
            c.close();
          }
        });
        return;
      }
      
      if (cmd === "/shutdown") {
        messages = [];
        fs.readdir(UPLOAD_DIR, (err, files) => {
          if (err) throw err;
          for (const file of files) {
            fs.unlink(path.join(UPLOAD_DIR, file), (err) => {
              if (err) throw err;
            });
          }
        });
        broadcast({ type: "cleared", ts: Date.now() });
        broadcast({ type: "filesCleared", ts: Date.now() });
        wss.clients.forEach((c) => {
          if (c.user.isOwner) return; // Don't kick the owner
          c.send(JSON.stringify({ type: "error", msg: "Server is shutting down!" }));
          c.close();
        });
        setTimeout(() => process.exit(0), 5000); // Exit after 5 seconds to allow messages to be sent
        return;
      }
    }

    // Normal message
    if (data.type === "message") {
      const msg = { ...data, ts: Date.now(), name: ws.user.displayName, isOwner: ws.user.isOwner };
      messages.push(msg);
      broadcast(msg);
    }
  });

  ws.on("close", () => {
    onlineUsers.delete(ws);
    broadcastUsers();
  });
});

// --- Broadcast helpers ---
function broadcast(obj) {
  const json = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(json);
  });
}

function broadcastUsers() {
  const list = Array.from(onlineUsers).map((ws) =>
    ws.user.isOwner ? `${ws.user.displayName} 👑` : ws.user.displayName
  );
  onlineUsers.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "users", list }));
  });
}

// --- Cleanup tokens ---
setInterval(() => {
  const now = Date.now();
  for (const t in tokens) if (tokens[t].expiry < now) delete tokens[t];
}, 60 * 1000);

const PORT = 3000;
server.listen(PORT, () =>
  console.log(`Ephemeral running at http://localhost:${PORT}`)
);