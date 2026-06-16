import express from "express";
import { createServer } from "http";
import path from "path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { RoomState, User, ChatMessage, SocketMessage } from "./src/types.js";
import fs from "fs";
import multer from "multer";

const app = express();
const PORT = 3000;

// Set up server-side uploads directory for persistent or device file streams
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded media files publicly/statically
app.use("/uploads", express.static(uploadsDir));

// Configure multer file upload storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    // Sanitize original name slightly to prevent special characters/spaces conflicts
    const nameSafe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `device-${uniqueSuffix}-${nameSafe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for high fidelity audio/video
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// File upload endpoint
app.post("/api/upload", upload.single("mediaFile"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No media file provided." });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    filename: req.file.originalname,
    mimeType: req.file.mimetype
  });
});

// Start server function
async function start() {
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // In-memory room storage
  const rooms = new Map<string, RoomState>();
  
  // Track socket connections: maps WebSocket -> connection info
  const socketRoomMap = new Map<WebSocket, { roomCode: string; userId: string; username: string }>();

  // Generate unique 6-digit room code
  function generateRoomCode(): string {
    let attempts = 0;
    while (attempts < 100) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      if (!rooms.has(code)) {
        return code;
      }
      attempts++;
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Helper helper to generate simple random IDs
  function generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  // Broadcaster
  function broadcastToRoom(roomCode: string, message: SocketMessage, excludeSocket?: WebSocket) {
    const rawMessage = JSON.stringify(message);
    for (const [ws, info] of socketRoomMap.entries()) {
      if (info.roomCode === roomCode && ws !== excludeSocket && ws.readyState === WebSocket.OPEN) {
        ws.send(rawMessage);
      }
    }
  }

  // Clean disconnect or leave logic
  function handleLeave(ws: WebSocket) {
    const info = socketRoomMap.get(ws);
    if (!info) return;

    const { roomCode, userId, username } = info;
    socketRoomMap.delete(ws);

    const room = rooms.get(roomCode);
    if (room) {
      // Remove user from room state
      room.users = room.users.filter(u => u.id !== userId);

      // System notification message
      const systemMsg: ChatMessage = {
        id: generateId(),
        sender: "System",
        text: `${username} left the room.`,
        timestamp: Date.now(),
      };
      room.chatHistory.push(systemMsg);
      if (room.chatHistory.length > 80) room.chatHistory.shift();

      if (room.users.length === 0) {
        // No one left, delete room
        rooms.delete(roomCode);
        console.log(`Room ${roomCode} deleted due to inactivity.`);
      } else {
        // If the admin left, designate next user as admin
        if (room.adminId === userId) {
          const nextAdmin = room.users[0];
          room.adminId = nextAdmin.id;
          room.adminUsername = nextAdmin.username;
          // Set their Admin status in users list
          room.users = room.users.map(u => u.id === nextAdmin.id ? { ...u, isAdmin: true } : u);

          const adminMsg: ChatMessage = {
            id: generateId(),
            sender: "System",
            text: `${nextAdmin.username} is now the host.`,
            timestamp: Date.now(),
          };
          room.chatHistory.push(adminMsg);
        }

        // Broadcast current room state after user left
        broadcastToRoom(roomCode, { type: "USER_LEFT", payload: { username, roomState: room } });
      }
    }
  }

  // Handle upgrade to WebSockets on port 3000
  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // Handle WebSocket connections
  wss.on("connection", (ws: WebSocket) => {
    console.log("New WebSocket client connected.");

    ws.on("message", (rawMessage: string) => {
      try {
        const message = JSON.parse(rawMessage) as SocketMessage;
        console.log("Received message:", message.type);

        switch (message.type) {
          case "CREATE_ROOM": {
            const { username } = message.payload;
            const roomCode = generateRoomCode();
            const userId = generateId();

            const newRoom: RoomState = {
              code: roomCode,
              adminId: userId,
              adminUsername: username,
              users: [{ id: userId, username, isAdmin: true }],
              videoUrl: null,
              videoStatus: "stopped",
              currentTime: 0,
              lastUpdated: Date.now(),
              chatHistory: [
                {
                  id: generateId(),
                  sender: "System",
                  text: `Room created by ${username}. Code: ${roomCode}`,
                  timestamp: Date.now(),
                }
              ],
            };

            rooms.set(roomCode, newRoom);
            socketRoomMap.set(ws, { roomCode, userId, username });

            ws.send(JSON.stringify({
              type: "ROOM_CREATED",
              payload: { roomCode, roomState: newRoom },
            }));
            break;
          }

          case "JOIN_ROOM": {
            const { roomCode, username } = message.payload;
            const cleanedCode = roomCode.trim();
            const room = rooms.get(cleanedCode);

            if (!room) {
              ws.send(JSON.stringify({
                type: "ERROR",
                payload: { message: `Room with code ${cleanedCode} not found` },
              }));
              return;
            }

            const userId = generateId();
            const newUser: User = { id: userId, username, isAdmin: false };
            room.users.push(newUser);

            const joinMsg: ChatMessage = {
              id: generateId(),
              sender: "System",
              text: `${username} joined the room.`,
              timestamp: Date.now(),
            };
            room.chatHistory.push(joinMsg);
            if (room.chatHistory.length > 80) room.chatHistory.shift();

            socketRoomMap.set(ws, { roomCode: cleanedCode, userId, username });

            ws.send(JSON.stringify({
              type: "ROOM_JOINED",
              payload: { roomCode: cleanedCode, roomState: room, userId },
            }));

            // Notify everyone in the room
            broadcastToRoom(cleanedCode, {
              type: "USER_JOINED",
              payload: { username, roomState: room },
            }, ws);
            break;
          }

          case "SET_VIDEO": {
            const info = socketRoomMap.get(ws);
            if (!info) return;

            const room = rooms.get(info.roomCode);
            if (!room || room.adminId !== info.userId) {
              ws.send(JSON.stringify({ type: "ERROR", payload: { message: "Unauthorized action." } }));
              return;
            }

            const { url } = message.payload;
            room.videoUrl = url;
            room.videoStatus = "paused";
            room.currentTime = 0;
            room.lastUpdated = Date.now();

            const sysChat: ChatMessage = {
              id: generateId(),
              sender: "System",
              text: `${info.username} updated the video link.`,
              timestamp: Date.now(),
            };
            room.chatHistory.push(sysChat);

            broadcastToRoom(info.roomCode, { type: "ROOM_UPDATED", payload: { roomState: room } });
            break;
          }

          case "SYNC_PLAY": {
            const info = socketRoomMap.get(ws);
            if (!info) return;

            const room = rooms.get(info.roomCode);
            if (!room || room.adminId !== info.userId) return;

            room.videoStatus = "playing";
            room.currentTime = message.payload.currentTime;
            room.lastUpdated = Date.now();

            broadcastToRoom(info.roomCode, { type: "ROOM_UPDATED", payload: { roomState: room } });
            break;
          }

          case "SYNC_PAUSE": {
            const info = socketRoomMap.get(ws);
            if (!info) return;

            const room = rooms.get(info.roomCode);
            if (!room || room.adminId !== info.userId) return;

            room.videoStatus = "paused";
            room.currentTime = message.payload.currentTime;
            room.lastUpdated = Date.now();

            broadcastToRoom(info.roomCode, { type: "ROOM_UPDATED", payload: { roomState: room } });
            break;
          }

          case "SYNC_SEEK": {
            const info = socketRoomMap.get(ws);
            if (!info) return;

            const room = rooms.get(info.roomCode);
            if (!room || room.adminId !== info.userId) return;

            room.currentTime = message.payload.currentTime;
            room.lastUpdated = Date.now();

            broadcastToRoom(info.roomCode, { type: "ROOM_UPDATED", payload: { roomState: room } });
            break;
          }

          case "SEND_CHAT": {
            const info = socketRoomMap.get(ws);
            if (!info) return;

            const room = rooms.get(info.roomCode);
            if (!room) return;

            const chat: ChatMessage = {
              id: generateId(),
              sender: info.username,
              text: message.payload.text,
              timestamp: Date.now(),
            };

            room.chatHistory.push(chat);
            if (room.chatHistory.length > 80) room.chatHistory.shift();

            broadcastToRoom(info.roomCode, { type: "CHAT_RECEIVED", payload: { chat } });
            break;
          }

          case "LEAVE_ROOM": {
            handleLeave(ws);
            break;
          }
        }
      } catch (err) {
        console.error("Error processing message:", err);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket client disconnected.");
      handleLeave(ws);
    });

    ws.on("error", (error) => {
      console.error("Socket error on client:", error);
      handleLeave(ws);
    });
  });

  // Serve static UI assets inside production container
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[MUSICA] Full-stack Server is running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start Musica full-stack server:", err);
});
