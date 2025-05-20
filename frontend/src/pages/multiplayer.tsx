import React, { useState, useEffect } from "react";
import Gameboard from "../components/Gameboard";
import ReturnToMainMenu from "../components/ReturnToMainMenu";
import { v4 as uuidv4 } from "uuid";
import PageLayout from "../components/PageLayout";
import { io, Socket } from "socket.io-client";
import environment from "../config/environment";

interface Lobby {
  roomId: string;
  host: string;
  isPrivate: boolean;
  createdAt: number;
}

export default function MultiplayerSetup() {
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("");
  const [gameStarted, setGameStarted] = useState(false);
  const [showLobbies, setShowLobbies] = useState(false);
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const socket = io(environment.apiUrl, {
      transports: ['websocket'],
      autoConnect: false,
    });
    setSocket(socket);

    socket.on("lobby_list", (lobbyList: Lobby[]) => {
      setLobbies(lobbyList);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleStartGame = () => {
    if (!username.trim()) {
      alert("Please enter a username.");
      return;
    }
    if (!room.trim()) {
      setRoom(uuidv4());
    }
    if (socket) {
      socket.emit("create_lobby", {
        roomId: room,
        host: username,
        isPrivate: isPrivate
      });
    }
    setGameStarted(true);
  };

  const handleJoinLobby = (roomId: string) => {
    if (!username.trim()) {
      alert("Please enter a username.");
      return;
    }
    setRoom(roomId);
    setGameStarted(true);
  };

  const refreshLobbies = () => {
    if (socket) {
      socket.emit("get_lobbies");
    }
  };

  if (gameStarted) {
    return (
      <PageLayout>
        <div className="w-full">
        <Gameboard username={username} room={room} />
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
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-indigo-500/30 focus:border-indigo-400/50 focus:outline-none transition-all duration-300"
          />
          <input
            type="text"
            placeholder="Enter room code (optional)"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
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
                    key={lobby.roomId}
                    className="flex justify-between items-center p-4 bg-gray-700 rounded-lg"
                  >
                    <div>
                      <p className="text-white font-semibold">Host: {lobby.host}</p>
                      <p className="text-gray-400 text-sm">Room: {lobby.roomId}</p>
                    </div>
                    <button
                      onClick={() => handleJoinLobby(lobby.roomId)}
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