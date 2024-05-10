const createPeerServerListeners = (peerServer) => {
  peerServer.on('connection', (client) => {
    console.log('connected to peer js server client', client.id);
  });
};

module.exports = {
  createPeerServerListeners,
};
