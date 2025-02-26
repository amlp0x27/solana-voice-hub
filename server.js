const express = require('express');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const app = express();
const server = app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`[Server v2] Server running on port ${process.env.PORT || 3000}`);
});
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(__dirname));
const peerServer = ExpressPeerServer(server, { path: '/peerjs' });
app.use('/peerjs', peerServer);

io.on('connection', (socket) => {
  console.log('[Server v2] User connected:', socket.id);

  socket.on('joinRoom', ({ address, peerId, avatar, username }) => {
    console.log(`[Server v2] Join request: ${address}, peerId: ${peerId}, username: ${username}`);
    socket.join(address);
    const roomUsers = [...io.sockets.adapter.rooms.get(address) || []].map(id => ({
      id,
      username: id === socket.id ? username : 'User', // Default to 'User' if not the joining socket
      avatar: id === socket.id ? avatar : 'https://via.placeholder.com/50', // Default avatar
      peerId: id === socket.id ? peerId : null // Only set peerId for joining user
    }));
    io.to(address).emit('roomUpdate', { address, users: roomUsers });
    console.log(`[Server v2] Room update sent to ${address}:`, roomUsers);
  });

  socket.on('disconnect', () => {
    console.log('[Server v2] User disconnected:', socket.id);
  });
});