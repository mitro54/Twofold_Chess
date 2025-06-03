import React, { useState, useEffect } from "react";
import Gameboard from "../components/Gameboard";
import ReturnToMainMenu from "../components/ReturnToMainMenu";
import { v4 as uuidv4 } from "uuid";
import PageLayout from "../components/PageLayout";
import { io, Socket } from "socket.io-client";
import environment from "../config/environment";

interface Lobby {
  room: string;
  host: string;
  is_private: boolean;
  createdAt: number;
}

export default function MultiplayerSetup() {
  /* every tab gets an internal handle – never shown in the UI */
  const [username] = useState(() => uuidv4().slice(0, 8));
  const [room, setRoom] = useState("");
  const [gameStarted, setGameStarted] = useState(false);
  const [showLobbies, setShowLobbies] = useState(false);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [playerColor, setPlayerColor] = useState<"White" | "Black" | null>(null);

  // Function to initialize socket connection
  const initializeSocket = () => {
    if (socket) {
      console.log("Socket already exists, cleaning up");
      socket.disconnect();
    }

    console.log("Initializing new socket connection at:", environment.apiUrl);
    const newSocket = io(environment.apiUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      autoConnect: true,
    });

    newSocket.on("connect", () => {
      console.log("Socket connected successfully");
      // Refresh lobbies when connected
      newSocket.emit("get_lobbies");
    });

    newSocket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      alert("Failed to connect to game server. Please try again.");
    });

    newSocket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
      if (reason === "io server disconnect") {
        alert("Disconnected from server. Please refresh the page.");
      }
      // If we're in a game, emit player_disconnected to notify the other player
      if (gameStarted && room) {
        newSocket.emit("leave_room", { room, username });
      }
    });

    newSocket.on("lobby_list", (lobbyList: Lobby[]) => {
      console.log("Received lobby list:", lobbyList);
      setLobbies(lobbyList);
    });

    newSocket.on("error", (data: { message: string }) => {
      console.error("Game error:", data);
      if (data.message === "Room already exists") {
        // Try to join the room instead
        console.log("Room exists, attempting to join instead.");
        newSocket.emit("join", { username, room });
        setIsWaiting(true);
        setGameStarted(true);
        return;
      }
      alert(data.message);
      setGameStarted(false);
      setIsWaiting(false);
    });

    newSocket.on("player_joined", (data: { color: "White" | "Black"; username: string }) => {
      console.log("Player joined:", data);
      if (data.username === username) {
        setPlayerColor(data.color);
        setIsWaiting(false);
        setGameStarted(true);
      }
    });

    newSocket.on("game_start", (data: { color: "White" | "Black"; username: string }) => {
      console.log("Game started:", data);
      if (data.username === username) {
        setPlayerColor(data.color);
      }
      setIsWaiting(false);
      setGameStarted(true);
    });

    newSocket.on("game_state", (state) => {
      console.log("Received game state:", state);
    });

    newSocket.on("player_left", (data: { username: string }) => {
      console.log("Player left:", data);
      if (data.username === username) {
        setGameStarted(false);
        setIsWaiting(false);
        setPlayerColor(null);
        setRoom("");
        // Clean up socket when player leaves
        newSocket.disconnect();
        setSocket(null);
      }
    });

    newSocket.on("player_disconnected", () => {
      // Let Gameboard show its "opponent disconnected" modal and wait for
      // the user to click "Return to Multiplayer".  Nothing to do here.
      console.log("Other player disconnected – waiting for user action.");
    });

    setSocket(newSocket);
    return newSocket;
  };

  // Clean up socket on component unmount
  useEffect(() => {
    return () => {
      if (socket) {
        console.log("Cleaning up socket connection on unmount");
      socket.disconnect();
      }
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const colourHandler = (d: { color: "White" | "Black"; username: string }) =>
      d.username === username && setPlayerColor(d.color);

    socket.on("player_joined", colourHandler);
    socket.on("game_start", colourHandler);

    return () => {
      socket.off("player_joined", colourHandler);
      socket.off("game_start", colourHandler);
    };
  }, [socket, username]);

  useEffect(() => {
    if (!socket) return;

    const handleLobbyList = (lobbies: Lobby[]) => {
      setLobbies(lobbies);
    };

    const handleRoomDeleted = (data: { room: string }) => {
      // If we're in the deleted room, redirect to home
      if (data.room === room) {
        setGameStarted(false);
        setIsWaiting(false);
        setRoom("");
        setPlayerColor(null);
      }
      // Refresh lobby list
      socket.emit("get_lobbies");
    };

    socket.on("lobby_list", handleLobbyList);
    socket.on("room_deleted", handleRoomDeleted);

    // Initial lobby fetch
    socket.emit("get_lobbies");

    return () => {
      socket.off("lobby_list", handleLobbyList);
      socket.off("room_deleted", handleRoomDeleted);
    };
  }, [socket, room]);

  const handleStartGame = () => {
    // Initialize socket first
    const gameSocket = initializeSocket();
    
    // Generate room ID if none provided
    if (!room.trim()) {
      const randomRoom = uuidv4().slice(0, 8);
      setRoom(randomRoom);
      
      // Wait for socket to be ready before creating lobby
      gameSocket.on("connect", () => {
        console.log("Creating lobby with:", { room: randomRoom, username, isPrivate });
        gameSocket.emit("create_lobby", {
          roomId: randomRoom,
          host: username,
          isPrivate: isPrivate
        });
        setIsWaiting(true);
        setGameStarted(true);
      });
    } else {
      // If room ID is provided, create lobby immediately
      console.log("Creating lobby with:", { room, username, isPrivate });
      gameSocket.emit("create_lobby", {
        roomId: room,
        host: username,
        isPrivate: isPrivate
      });
      setIsWaiting(true);
      setGameStarted(true);
    }
  };

  const handleJoinLobby = (roomId: string) => {
    setRoom(roomId);
    
    const gameSocket = initializeSocket();
    console.log("Joining lobby:", { roomId, username });
    gameSocket.emit("join", { username: username, room: roomId });
    setIsWaiting(true);
    setGameStarted(true);
  };

  const refreshLobbies = () => {
    if (!socket) {
      const lobbySocket = initializeSocket();
      lobbySocket.emit("get_lobbies");
    } else {
      socket.emit("get_lobbies");
    }
  };

  const handleLeaveLobby = () => {
    if (window.confirm("Leave and close lobby?")) {
      if (socket && room) {
        console.log("Leaving lobby:", { room, username });
        socket.emit("leave_lobby", { roomId: room, username });
      }
      setGameStarted(false);
      setIsWaiting(false);
      setPlayerColor(null);
      setRoom("");
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
    }
  };

  if (gameStarted) {
    return (
      <PageLayout>
        <div className="w-full">
          {isWaiting ? (
            <div className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-gray-800 p-8 rounded-lg shadow-lg text-center relative">
                <button
                  className="absolute top-2 right-2 text-gray-400 hover:text-white text-2xl font-bold focus:outline-none"
                  onClick={handleLeaveLobby}
                  aria-label="Close waiting modal"
                >
                  ×
                </button>
                <h2 className="text-2xl font-bold text-white mb-4">Waiting for Opponent</h2>
                <p className="text-gray-300 mb-4">Share this room code with your friend:</p>
                <div className="bg-gray-700 p-4 rounded-lg mb-4">
                  <code className="text-xl font-mono text-white">{room}</code>
                </div>
                <p className="text-gray-400">Waiting for someone to join...</p>
              </div>
            </div>
          ) : (
            <Gameboard 
              room={room} 
              playerColor={playerColor}
              socket={socket}
            />
          )}
          <div className="mt-8 flex justify-center">
            <ReturnToMainMenu />
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Play with a Friend">
      <div className="flex flex-col space-y-6 w-full max-w-md mx-auto">
        <div className="flex flex-col space-y-4">
          <input
            type="text"
            placeholder="Enter room code (optional)"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            autoFocus
            className="px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-purple-500/30 focus:border-purple-400/50 focus:outline-none transition-all duration-300"
          />
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="privateLobby"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
            />
            <label htmlFor="privateLobby" className="text-white">
              Private Lobby (won&apos;t show in open lobbies)
            </label>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={handleStartGame}
            className="px-8 py-4 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-blue-500/30 hover:border-blue-400/50 transition-all duration-300 transform hover:scale-105 text-lg font-semibold shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] flex items-center justify-center min-w-[200px] group"
          >
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent group-hover:from-blue-300 group-hover:to-cyan-300 transition-colors">
              {room ? "Join Game" : "Create Game"}
            </span>
          </button>
          <button
            onClick={() => {
              setShowLobbies(true);
              refreshLobbies();
            }}
            className="px-8 py-4 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-purple-500/30 hover:border-purple-400/50 transition-all duration-300 transform hover:scale-105 text-lg font-semibold shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)] flex items-center justify-center min-w-[200px] group"
          >
            <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent group-hover:from-purple-300 group-hover:to-pink-300 transition-colors">
              Open Lobbies
            </span>
          </button>
        </div>
        <div className="mt-8 flex justify-center">
          <ReturnToMainMenu />
        </div>
      </div>

      {/* Open Lobbies Modal */}
      {showLobbies && (
        <div 
          className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowLobbies(false)}
        >
          <div 
            className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-2xl w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-xl font-semibold text-white">Open Lobbies</h4>
              <button
                onClick={() => setShowLobbies(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4">
              {lobbies.length === 0 ? (
                <p className="text-gray-400 text-center py-4">No open lobbies available, create one!</p>
              ) : (
                lobbies.map((lobby) => (
                  <div 
                    key={lobby.room}
                    className="flex justify-between items-center p-4 bg-gray-700 rounded-lg"
                  >
                    <div>
                      <p className="text-white font-semibold">Room: {lobby.room}</p>
                      <p className="text-gray-400 text-sm">Created: {new Date(lobby.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                    </div>
                    <button
                      onClick={() => handleJoinLobby(lobby.room)}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                      Join
                    </button>
                  </div>
                ))
              )}
              <button
                onClick={refreshLobbies}
                className="w-full px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
              >
                Refresh List
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}