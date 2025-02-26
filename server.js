const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const peerServer = ExpressPeerServer(server, { debug: true, path: '/peerjs' });
app.use('/peerjs', peerServer);
app.use(express.static('public'));

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' http://localhost:3000 https://unpkg.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://api.dicebear.com; connect-src 'self' ws://localhost:3000 http://localhost:3000 ws://192.168.1.184:3000 http://192.168.1.184:3000 https://public-api.solscan.io https://api.coingecko.com;"
  );
  next();
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

const rooms = {};
const KICK_THRESHOLD = 10;

io.on('connection', (socket) => {
  console.log('[Server v2] User connected:', socket.id);

  socket.on('joinRoom', ({ address, peerId, avatar, username }) => {
    console.log(`[Server v2] Joining room: ${address} with peerId: ${peerId}, username: ${username}`);
    socket.join(address);
    if (!rooms[address]) {
      rooms[address] = { users: [], votes: {}, messages: [], typing: [], muted: {} };
    }
    const user = { id: socket.id, peerId, avatar, username, muted: false };
    rooms[address].users.push(user);
    console.log(`[Server v2] Room ${address} users after join:`, JSON.stringify(rooms[address].users, null, 2));

    const roomData = {
      address: address,
      users: rooms[address].users.slice(),
      messages: rooms[address].messages.slice(),
      totalUsers: getTotalUsers()
    };
    console.log('[Server v2] Emitting roomUpdate:', JSON.stringify(roomData, null, 2));
    io.to(address).emit('roomUpdate', roomData);
    io.to(address).emit('userJoined', user);
  });

  socket.on('voteKick', ({ address, targetId }) => {
    if (!rooms[address]) return;
    console.log(`[Server v2] Vote kick for ${targetId} in room ${address}`);
    rooms[address].votes[targetId] = (rooms[address].votes[targetId] || 0) + 1;
    io.to(address).emit('voteUpdate', { targetId, votes: rooms[address].votes[targetId] });
    if (rooms[address].votes[targetId] >= KICK_THRESHOLD) {
      console.log(`[Server v2] Kicking user ${targetId} from room ${address}`);
      io.to(address).emit('userKicked', targetId);
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) targetSocket.disconnect();
    }
  });

  socket.on('chatMessage', ({ address, message, username }) => {
    if (!rooms[address]) return;
    const msg = { id: socket.id, text: message, username, timestamp: Date.now() };
    rooms[address].messages.push(msg);
    console.log('[Server v2] Message broadcast:', JSON.stringify(msg, null, 2));
    io.to(address).emit('newMessage', rooms[address].messages.slice());
  });

  socket.on('typing', ({ address, username }) => {
    if (!rooms[address]) return;
    if (!rooms[address].typing.includes(username)) {
      rooms[address].typing.push(username);
      console.log('[Server v2] Typing update:', rooms[address].typing);
      io.to(address).emit('typingUpdate', rooms[address].typing.slice());
    }
  });

  socket.on('stopTyping', ({ address, username }) => {
    if (!rooms[address]) return;
    rooms[address].typing = rooms[address].typing.filter(u => u !== username);
    console.log('[Server v2] Typing update:', rooms[address].typing);
    io.to(address).emit('typingUpdate', rooms[address].typing.slice());
  });

  socket.on('muteUser', ({ address, targetId }) => {
    if (!rooms[address]) return;
    console.log(`[Server v2] Muting user ${targetId} in room ${address}`);
    const user = rooms[address].users.find(u => u.id === targetId);
    if (user) {
      user.muted = !user.muted;
      const roomData = {
        address: address,
        users: rooms[address].users.slice(),
        messages: rooms[address].messages.slice(),
        totalUsers: getTotalUsers()
      };
      console.log('[Server v2] Emitting roomUpdate after mute:', JSON.stringify(roomData, null, 2));
      io.to(address).emit('roomUpdate', roomData);
    }
  });

  socket.on('disconnect', () => {
    console.log('[Server v2] User disconnected:', socket.id);
    for (const address in rooms) {
      if (rooms[address].users.some(u => u.id === socket.id)) {
        rooms[address].users = rooms[address].users.filter(u => u.id !== socket.id);
        rooms[address].typing = rooms[address].typing.filter(u => u !== socket.username);
        const roomData = {
          address: address,
          users: rooms[address].users.slice(),
          messages: rooms[address].messages.slice(),
          totalUsers: getTotalUsers()
        };
        console.log('[Server v2] Emitting roomUpdate on disconnect:', JSON.stringify(roomData, null, 2));
        io.to(address).emit('roomUpdate', roomData);
        io.to(address).emit('userLeft', socket.id);
        io.to(address).emit('typingUpdate', rooms[address].typing.slice());
        if (rooms[address].users.length === 0) {
          console.log(`[Server v2] Room ${address} empty, deleting`);
          delete rooms[address];
        }
        break;
      }
    }
  });
});

function getTotalUsers() {
  const total = Object.values(rooms).reduce((sum, room) => sum + room.users.length, 0);
  console.log('[Server v2] Total users:', total);
  return total;
}

// Bind to 0.0.0.0 for LAN access
server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log(`[Server v2] Server running on port ${process.env.PORT || 3000}`);
});