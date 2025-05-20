import { lobbyManager } from './lobbyManager';

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join", ({ username, room }) => {
    console.log(`User ${username} joining room: ${room}`);
    socket.join(room);
    socket.data.username = username;
    socket.data.room = room;

    // Add player to lobby if it exists
    const lobby = lobbyManager.getLobby(room);
    if (lobby) {
      lobbyManager.addPlayerToLobby(room, username);
    }
  });

  socket.on("create_lobby", ({ roomId, host, isPrivate }) => {
    console.log(`Creating lobby: ${roomId} by ${host} (private: ${isPrivate})`);
    lobbyManager.createLobby(roomId, host, isPrivate);
  });

  socket.on("get_lobbies", () => {
    console.log(`User ${socket.data.username} requesting lobby list`);
    socket.emit("lobby_list", lobbyManager.getLobbies());
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (socket.data.username && socket.data.room) {
      lobbyManager.removePlayerFromLobby(socket.data.room, socket.data.username);
    }
  });

  // ... rest of the existing socket event handlers ...
}); 