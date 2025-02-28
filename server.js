const express = require('express');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const app = express();
const server = app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`[Server v13] Server running on port ${process.env.PORT || 3000}`);
});
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(__dirname));
const peerServer = ExpressPeerServer(server, { path: '/peerjs' });
app.use('/peerjs', peerServer);

const rooms = {};
const profanityList = ['damn', 'hell', 'ass', 'fuck', 'shit', 'bitch', 'cunt', 'bastard'];
const messageCooldowns = new Map();
const voteKickRecords = new Map();

function filterText(text) {
  let cleaned = text;
  profanityList.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '****');
  });
  return cleaned;
}

io.on('connection', (socket) => {
  console.log(`[Server v13] User connected: ${socket.id}`);

  socket.on('userConnected', ({ peerId, username, avatar }) => {
    socket.username = filterText(username);
    socket.avatar = avatar;
    socket.peerId = peerId;
    console.log(`[Server v13] User ${socket.username} connected with peerId: ${peerId}, socket: ${socket.id}`);
    io.emit('roomUpdate', { totalUsers: io.engine.clientsCount, users: [], messages: [] });
  });

  socket.on('joinRoom', ({ address, peerId, avatar, username }) => {
    console.log(`[Server v13] Join: ${address}, peerId: ${peerId}, username: ${username}, socket: ${socket.id}`);
    socket.join(address);
    socket.address = address;

    if (!rooms[address]) rooms[address] = { users: [], messages: [], typing: [], votes: {} };
    const cleanUsername = filterText(username);
    const user = { id: socket.id, username: cleanUsername, avatar, peerId, muted: false };
    // Add user without filtering—each connection is unique by socket.id
    rooms[address].users.push(user);

    const roomData = {
      address,
      users: rooms[address].users.map(u => ({ id: u.id, username: u.username, avatar: u.avatar, peerId: u.peerId, muted: u.muted })),
      messages: rooms[address].messages,
      totalUsers: io.engine.clientsCount
    };
    io.to(address).emit('roomUpdate', roomData);
    socket.broadcast.to(address).emit('userJoined', { id: socket.id, avatar, username: cleanUsername });
    console.log(`[Server v13] Room ${address} updated:`, roomData);
  });

  socket.on('chatMessage', ({ address, message, username }) => {
    const now = Date.now();
    const lastMessageTime = messageCooldowns.get(socket.id) || 0;
    if (now - lastMessageTime < 5000) {
      socket.emit('messageCooldown', 'Please wait 5 seconds between messages.');
      return;
    }
    const cleanMessage = filterText(message);
    if (rooms[address]) {
      rooms[address].messages.push({ username, text: cleanMessage, timestamp: now });
      io.to(address).emit('newMessage', rooms[address].messages);
      messageCooldowns.set(socket.id, now);
      console.log(`[Server v13] Message in ${address}: ${username}: ${cleanMessage}`);
    }
  });

  socket.on('typing', ({ address, username }) => {
    if (rooms[address]) {
      rooms[address].typing = [username]; // Could expand to track multiple typers if needed
      io.to(address).emit('typingUpdate', rooms[address].typing);
    }
  });

  socket.on('stopTyping', ({ address }) => {
    if (rooms[address]) {
      rooms[address].typing = [];
      io.to(address).emit('typingUpdate', rooms[address].typing);
    }
  });

  socket.on('muteUser', ({ address, targetId }) => {
    if (rooms[address]) {
      const user = rooms[address].users.find(u => u.id === targetId);
      if (user) {
        user.muted = !user.muted;
        io.to(address).emit('roomUpdate', { address, users: rooms[address].users, messages: rooms[address].messages });
      }
    }
  });

  socket.on('voteKick', ({ address, targetId }) => {
    if (rooms[address]) {
      const voterId = socket.id;
      const targetUser = rooms[address].users.find(u => u.id === targetId);
      if (!targetUser) return;

      rooms[address].votes[targetId] = rooms[address].votes[targetId] || new Set();
      const votes = rooms[address].votes[targetId];

      if (votes.has(voterId)) return;
      votes.add(voterId);

      const voterName = socket.username;
      const targetName = targetUser.username;
      io.to(address).emit('voteUpdate', { 
        targetId, 
        votes: votes.size, 
        message: `${voterName} is kicking ${targetName}` 
      });

      if (votes.size >= 10) {
        io.to(address).emit('userKicked', targetId);
        const socketToKick = io.sockets.sockets.get(targetId);
        if (socketToKick) socketToKick.disconnect(true);
        rooms[address].users = rooms[address].users.filter(u => u.id !== targetId);
        delete rooms[address].votes[targetId];
        io.to(address).emit('roomUpdate', {
          address,
          users: rooms[address].users,
          messages: rooms[address].messages,
          totalUsers: io.engine.clientsCount
        });
      }
    }
  });

  socket.on('leaveRoom', ({ address, peerId }) => {
    if (rooms[address]) {
      rooms[address].users = rooms[address].users.filter(u => u.id !== socket.id);
      io.to(address).emit('userLeft', socket.id);
      io.to(address).emit('roomUpdate', {
        address,
        users: rooms[address].users,
        messages: rooms[address].messages,
        totalUsers: io.engine.clientsCount
      });
      socket.leave(address);
      socket.address = null; // Clear address to prevent stale references
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Server v13] User disconnected: ${socket.id}`);
    if (socket.address && rooms[socket.address]) {
      rooms[address].users = rooms[socket.address].users.filter(u => u.id !== socket.id);
      io.to(socket.address).emit('userLeft', socket.id);
      io.to(socket.address).emit('roomUpdate', {
        address: socket.address,
        users: rooms[socket.address].users,
        messages: rooms[socket.address].messages,
        totalUsers: io.engine.clientsCount
      });
      if (rooms[socket.address].users.length === 0) delete rooms[socket.address];
    }
    io.emit('roomUpdate', { totalUsers: io.engine.clientsCount });
    messageCooldowns.delete(socket.id);
  });
});
