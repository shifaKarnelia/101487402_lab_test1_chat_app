require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const path = require("path");

const User = require("./models/User");
const GroupMessage = require("./models/GroupMessage");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/views", express.static(path.join(__dirname, "views"))); 

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((e) => console.error("MongoDB error:", e.message));

  //formate date according to document
function formatDate() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  let hh = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  const hh2 = String(hh).padStart(2, "0");
  return `${mm}-${dd}-${yyyy} ${hh2}:${min} ${ampm}`;
}


app.get("/", (req, res) => res.sendFile(path.join(__dirname, "views", "index.html")));
app.get("/signup", (req, res) => res.sendFile(path.join(__dirname, "views", "signup.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "views", "login.html")));
app.get("/rooms", (req, res) => res.sendFile(path.join(__dirname, "views", "rooms.html")));
app.get("/chat", (req, res) => res.sendFile(path.join(__dirname, "views", "chat.html")));

//signup
app.post("/api/signup", async (req, res) => {
  try {
    const { username, firstname, lastname, password } = req.body;
    if (!username || !firstname || !lastname || !password) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const existing = await User.findOne({ username: username.trim() });
    if (existing) return res.status(409).json({ message: "Username already exists." });

    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      username: username.trim(),
      firstname: firstname.trim(),
      lastname: lastname.trim(),
      password: hash,
      createon: formatDate()
    });

    return res.json({ message: "Signup successful", user: { username: user.username } });
  } catch (e) {
    return res.status(500).json({ message: "Server error", error: e.message });
  }
});

//login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Missing credentials." });

    const user = await User.findOne({ username: username.trim() });
    if (!user) return res.status(401).json({ message: "Invalid username/password." });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: "Invalid username/password." });

    return res.json({
      message: "Login successful",
      user: { username: user.username, firstname: user.firstname, lastname: user.lastname }
    });
  } catch (e) {
    return res.status(500).json({ message: "Server error", error: e.message });
  }
});

app.get("/api/room-messages", async (req, res) => {
  const { room } = req.query;
  if (!room) return res.status(400).json({ message: "room is required" });
  const msgs = await GroupMessage.find({ room }).sort({ _id: -1 }).limit(50);
  res.json(msgs.reverse());
});



const PREDEFINED_ROOMS = ["devops", "cloud computing", "covid19", "sports", "nodeJS"];
const roomMembers = new Map(); 

function getMembers(room) {
  return Array.from(roomMembers.get(room) || []);
}
function addMember(room, username) {
  if (!roomMembers.has(room)) roomMembers.set(room, new Set());
  roomMembers.get(room).add(username);
}
function removeMember(room, username) {
  if (!roomMembers.has(room)) return;
  roomMembers.get(room).delete(username);
  if (roomMembers.get(room).size === 0) roomMembers.delete(room);
}


//  Socket.io logic
io.on("connection", (socket) => {
  // join room
 socket.on("joinRoom", async ({ username, room }) => {
  if (!username || !room) return;
  if (!PREDEFINED_ROOMS.includes(room)) return;

  
  if (socket.data.room) {
    const oldRoom = socket.data.room;
    socket.leave(oldRoom);

    removeMember(oldRoom, socket.data.username);
    io.to(oldRoom).emit("members", getMembers(oldRoom));

    socket.to(oldRoom).emit("system", `${socket.data.username} left the room.`);
  }

  socket.data.username = username;
  socket.data.room = room;

  socket.join(room);

  addMember(room, username);
  io.to(room).emit("members", getMembers(room));

  socket.to(room).emit("system", `${username} joined the room.`);
});


  // leave room
 socket.on("leaveRoom", () => {
  const { username, room } = socket.data;
  if (!room || !username) return;

  socket.leave(room);

  removeMember(room, username);
  io.to(room).emit("members", getMembers(room));

  socket.to(room).emit("system", `${username} left the room.`);
  socket.data.room = null;
});

 
socket.on("typing", () => {
  const { username, room } = socket.data;
  if (!room || !username) return;

  socket.to(room).emit("typing", { username });
});

socket.on("stopTyping", () => {
  const { room } = socket.data;
  if (!room) return;

  socket.to(room).emit("stopTyping");
});

  // group message
  socket.on("groupMessage", async ({ message }) => {
    const { username, room } = socket.data;
    if (!username || !room || !message?.trim()) return;

    const payload = {
      from_user: username,
      room,
      message: message.trim(),
      date_sent: formatDate()
    };

    await GroupMessage.create(payload);
    io.to(room).emit("groupMessage", payload);
  });




  socket.on("disconnect", () => {
  const { username, room } = socket.data;
  if (room && username) {
    removeMember(room, username);
    io.to(room).emit("members", getMembers(room));
    socket.to(room).emit("system", `${username} disconnected.`);
  }
});

});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
});
