const express = require('express');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const port = Number(process.env.PORT) || 8080;
const options = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
};

app.use(express.static(path.join(__dirname, 'public')));

const server = https.createServer(options, app);
const io = new Server(server);
const rooms = new Map();
const superchatTiers = new Map([
  [2, { tier: 1, color: '#5678d4' }],
  [5, { tier: 2, color: '#388f83' }],
  [10, { tier: 3, color: '#c49b43' }],
  [20, { tier: 4, color: '#d47742' }],
  [50, { tier: 5, color: '#ba547c' }]
]);

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(roomId);
}

function getViewerList(room) {
  return Array.from(room.viewers, ([socketId, viewer]) => ({
    socketId,
    username: viewer.username,
    joinedAt: viewer.joinedAt
  }));
}

function reportError(socket, message) {
  socket.emit('room-error', { message });
}

function leaveRoom(socket) {
  const membership = socket.data.membership;
  if (!membership) return;

  const { roomId, role } = membership;
  const room = rooms.get(roomId);
  socket.data.membership = null;
  socket.leave(roomId);
  if (!room) return;

  if (role === 'broadcaster' && room.broadcasterId === socket.id) {
    io.to(roomId).emit('stream-ended');
    for (const viewerId of room.viewers.keys()) {
      const viewerSocket = io.sockets.sockets.get(viewerId);
      if (viewerSocket) {
        viewerSocket.data.membership = null;
        viewerSocket.leave(roomId);
      }
    }
    rooms.delete(roomId);
    console.log(`Room ${roomId} ditutup karena broadcaster keluar`);
    return;
  }

  if (role === 'viewer' && room.viewers.has(socket.id)) {
    const { username } = room.viewers.get(socket.id);
    room.viewers.delete(socket.id);
    const viewerList = getViewerList(room);
    io.to(roomId).emit('viewer-left', {
      viewerId: socket.id,
      username,
      viewerCount: viewerList.length,
      viewerList
    });
    if (!room.broadcasterId && room.viewers.size === 0) rooms.delete(roomId);
  }
}

io.on('connection', (socket) => {
  console.log('Socket terhubung:', socket.id);

  socket.on('join-room', (roomId) => {
    if (!isValidRoomId(roomId)) {
      reportError(socket, 'Token room tidak valid.');
      return;
    }
    if (socket.data.membership) leaveRoom(socket);
    const room = rooms.get(roomId);
    if (room?.broadcasterId) {
      reportError(socket, 'Room tersebut sudah memiliki broadcaster aktif.');
      return;
    }

    const activeRoom = room || { broadcasterId: null, viewers: new Map() };
    activeRoom.broadcasterId = socket.id;
    rooms.set(roomId, activeRoom);
    socket.data.membership = { roomId, role: 'broadcaster', username: 'Broadcaster' };
    socket.join(roomId);
    const viewerList = getViewerList(activeRoom);
    socket.emit('room-info', { viewerCount: viewerList.length, viewerList });
    for (const [viewerId, viewer] of activeRoom.viewers) {
      io.to(socket.id).emit('viewer-joined', {
        viewerId,
        username: viewer.username,
        viewerCount: viewerList.length,
        viewerList
      });
    }
    console.log(`Broadcaster ${socket.id} membuat room ${roomId}`);
  });

  socket.on('join-as-viewer', (payload = {}) => {
    const { roomId } = payload;
    if (!isValidRoomId(roomId)) {
      reportError(socket, 'Token room tidak valid.');
      return;
    }
    if (socket.data.membership) leaveRoom(socket);
    let room = rooms.get(roomId);
    if (!room) {
      room = { broadcasterId: null, viewers: new Map() };
      rooms.set(roomId, room);
    }

    const username = typeof payload.username === 'string'
      ? payload.username.trim().replace(/\s+/g, ' ').slice(0, 30)
      : '';
    const safeUsername = username || `Viewer_${socket.id.slice(0, 4)}`;
    const joinedAt = new Date().toISOString();
    room.viewers.set(socket.id, { username: safeUsername, joinedAt });
    socket.data.membership = { roomId, role: 'viewer', username: safeUsername };
    socket.join(roomId);

    const viewerList = getViewerList(room);
    const joined = {
      viewerId: socket.id,
      username: safeUsername,
      viewerCount: viewerList.length,
      viewerList
    };
    socket.to(roomId).emit('viewer-joined', joined);
    socket.emit('room-info', { viewerCount: viewerList.length, viewerList });
    console.log(`Viewer "${safeUsername}" bergabung ke room ${roomId}`);
  });

  socket.on('leave-room', () => leaveRoom(socket));

  socket.on('offer', (payload = {}) => {
    const membership = socket.data.membership;
    if (!membership || membership.role !== 'broadcaster' ||
        typeof payload.target !== 'string' ||
        !rooms.get(membership.roomId)?.viewers.has(payload.target)) return;
    io.to(payload.target).emit('offer', { sdp: payload.sdp, broadcasterId: socket.id });
  });

  socket.on('answer', (payload = {}) => {
    const membership = socket.data.membership;
    const room = membership && rooms.get(membership.roomId);
    if (!membership || membership.role !== 'viewer' || !room ||
        payload.target !== room.broadcasterId) return;
    io.to(payload.target).emit('answer', { sdp: payload.sdp, viewerId: socket.id });
  });

  socket.on('ice-candidate', (payload = {}) => {
    const membership = socket.data.membership;
    const room = membership && rooms.get(membership.roomId);
    if (!membership || !room || payload.roomId !== membership.roomId || !payload.candidate) return;
    const targetId = membership.role === 'broadcaster'
      ? payload.target
      : room.broadcasterId;
    if (typeof targetId !== 'string' ||
        (membership.role === 'broadcaster' && !room.viewers.has(targetId)) ||
        (membership.role === 'viewer' && targetId !== room.broadcasterId)) return;
    io.to(targetId).emit('ice-candidate', {
      candidate: payload.candidate,
      senderId: socket.id
    });
  });

  socket.on('send-chat', (payload = {}) => {
    const membership = socket.data.membership;
    const room = membership && rooms.get(membership.roomId);
    const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 200) : '';
    if (!membership || !room || !message) return;

    io.to(membership.roomId).emit('chat-message', {
      senderId: socket.id,
      senderName: membership.username,
      message,
      isBroadcaster: membership.role === 'broadcaster',
      timestamp: new Date().toISOString()
    });
  });

  socket.on('send-superchat', (payload = {}) => {
    const membership = socket.data.membership;
    const room = membership && rooms.get(membership.roomId);
    const tier = superchatTiers.get(Number(payload.amount));
    if (!membership || membership.role !== 'viewer' || !room || !tier) return;

    const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 120) : '';
    io.to(membership.roomId).emit('new-superchat', {
      senderId: socket.id,
      username: membership.username,
      amount: Number(payload.amount),
      message,
      tier: tier.tier,
      color: tier.color,
      timestamp: new Date().toISOString()
    });
    console.log(`Superchat dari "${membership.username}" di room ${membership.roomId}`);
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
    console.log('Socket terputus:', socket.id);
  });
});

server.listen(port, () => {
  console.log(`HTTPS server berjalan di https://localhost:${port}`);
  const networkInterfaces = Object.values(os.networkInterfaces()).flat();
  const lanAddresses = networkInterfaces
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  lanAddresses.forEach((address) => {
    console.log(`Akses dari perangkat lain: https://${address}:${port}/broadcaster.html`);
  });
});
