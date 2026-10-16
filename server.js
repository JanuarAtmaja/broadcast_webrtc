const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require("socket.io");

const app = express();
const port = 8080;

const options = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
};

app.use(express.static(path.join(__dirname, 'public')));

const server = https.createServer(options, app);
const io = new Server(server);

// Logika Signaling
io.on('connection', (socket) => {
  console.log('User terhubung:', socket.id);

  // Broadcaster bergabung ke room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`Broadcaster ${socket.id} membuat/bergabung ke room ${roomId}`);
  });

  // Viewer bergabung ke room
  socket.on('join-as-viewer', (roomId) => {
    socket.join(roomId);
    console.log(`Viewer ${socket.id} bergabung ke room ${roomId}`);
    // Beri tahu broadcaster bahwa ada viewer baru
    socket.to(roomId).emit('viewer-joined', { viewerId: socket.id });
  });

  // Relay offer dari broadcaster ke viewer
  socket.on('offer', (payload) => {
    io.to(payload.target).emit('offer', {
      sdp: payload.sdp,
      broadcasterId: socket.id
    });
  });

  // Relay answer dari viewer ke broadcaster
  socket.on('answer', (payload) => {
    io.to(payload.target).emit('answer', {
      sdp: payload.sdp,
      viewerId: socket.id
    });
  });

  // Relay ICE candidates
  socket.on('ice-candidate', (payload) => {
    socket.to(payload.roomId).emit('ice-candidate', {
      candidate: payload.candidate,
      senderId: socket.id
    });
  });

  socket.on('disconnect', () => {
    console.log('User terputus:', socket.id);
  });
});

server.listen(port, () => {
  console.log(`Server HTTPS berjalan di https://localhost:${port}`);
});