const { v4: uuidv4 } = require('uuid');
const express = require('express');
const cors = require('cors');
const socket = require('socket.io');
const twilio = require('twilio');
const { ExpressPeerServer } = require('peer');
const groupCallHandler = require('./groupCallHandler');

const PORT = process.env.PORT || 8000;
const app = express();

app.use(cors());

app.get('/', (req, res) => {
  res.send({ api: 'video-talker-api' });
});

app.get('/api/get-turn-credentials', (req, res) => {
  const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);

  client.tokens.create().then(token => res.send({ token }));
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port http://localhost:${PORT}`);
});

const peerServer = ExpressPeerServer(server, {
  debug: true,
});

app.use('/peerjs', peerServer);
groupCallHandler.createPeerServerListeners(peerServer);

const io = socket(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  }
});

let peers = [];
let groupCallRooms = [];
const broadcastTypes = {
  ACTIVE_USERS: 'ACTIVE_USERS',
  GROUP_CALL_ROOMS: 'GROUP_CALL_ROOMS'
};


io.on('connection', (socket) => {
  console.log(`User is connected with id: ${socket.id}`);

  socket.emit('connection');

  // #region video

  socket.on('register-new-user', (newUser) => {
    peers.push(newUser);
    // console.log('new user', peers);

    handleBroadcast(peers, broadcastTypes.ACTIVE_USERS);
    handleBroadcast(groupCallRooms, broadcastTypes.GROUP_CALL_ROOMS);
  });

  socket.on('disconnect', () => {
    // console.log('user was disconnected', socket.id);
    const filteredPeers = peers.filter(peer => peer.socketId !== socket.id);
    peers = filteredPeers;
    handleBroadcast(peers, broadcastTypes.ACTIVE_USERS);

    groupCallRooms = groupCallRooms.filter(room => room.socketId !== socket.id);
    handleBroadcast(groupCallRooms, broadcastTypes.GROUP_CALL_ROOMS);
  });

  socket.on('pre-offer', (data) => {
    // console.log('pre offer data', data);
    io.to(data.callee.socketId).emit('pre-offer', {
      callerSocketId: socket.id,
      callerUserName: data.caller.username,
    });
  });

  socket.on('pre-offer-answer', (data) => {
    // console.log('server pre-offer-answer', data);
    io.to(data.callerSocketId).emit('pre-offer-answer', {
      answer: data.answer,
    });
  });

  socket.on('webRTC-offer', (data) => {
    // console.log('web rtc offer', data);
    io.to(data.calleeSocketId).emit('webRTC-offer', { offer: data.offer });
  });

  socket.on('webRTC-answer', (data) => {
    // console.log('web rtc answer', data);
    io.to(data.callerSocketId).emit('webRTC-answer', { answer: data.answer });
  });

  socket.on('webRTC-candidate', (data) => {
    // console.log('webRTC-candidate', data);
    io.to(data.connectedUserSocketId).emit('webRTC-candidate', { candidate: data.candidate });
  });

  socket.on('user-hang-up', (data) => {
    // console.log('user-hang-up', data);
    io.to(data.connectedUserSocketId).emit('user-hang-up');
  });

  // #endregion

  // #region group call

  socket.on('grop-call-register', (data) => {
    const roomId = uuidv4();

    socket.join(roomId);

    const newRoom = {
      peerId: data.peerId,
      hostName: data.username,
      socketId: socket.id,
      roomId,
    };

    groupCallRooms.push(newRoom);

    handleBroadcast(groupCallRooms, broadcastTypes.GROUP_CALL_ROOMS);
  });

  socket.on('group-call-join-request', (data) => {
    io.to(data.roomId).emit('group-call-join-request', {
      peerId: data.peerId,
      streamId: data.streamId,
    });

    socket.join(data.roomId);
  });

  socket.on('group-call-user-left', (data) => {
    socket.leave(data.roomId);

    io.to(data.roomId).emit('group-call-user-left', { streamId: data.streamId });
  });

  socket.on('group-call-closed-by-host', (data) => {
    groupCallRooms = groupCallRooms.filter(room => room.peerId !== data.peerId);
    handleBroadcast(groupCallRooms, broadcastTypes.GROUP_CALL_ROOMS);
  });

  // #endregion
});

const handleBroadcast = (data, eventType) => {
  io.sockets.emit('broadcast', { data, event: eventType });
};
