import React, { useState } from "react";
import Gameboard from "../components/Gameboard";
import ReturnToMainMenu from "../components/ReturnToMainMenu";
import { v4 as uuidv4 } from "uuid";
import PageLayout from "../components/PageLayout";

export default function MultiplayerSetup() {
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("");
  const [gameStarted, setGameStarted] = useState(false);

  const handleStartGame = () => {
    if (!username.trim()) {
      alert("Please enter a username.");
      return;
    }
    if (!room.trim()) {
      // Generate a random room ID if none is provided
      setRoom(uuidv4());
    }
    setGameStarted(true);
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
        </div>
        <button
          onClick={handleStartGame}
          className="px-8 py-4 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-blue-500/30 hover:border-blue-400/50 transition-all duration-300 transform hover:scale-105 text-lg font-semibold shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] flex items-center justify-center min-w-[200px] mx-auto group"
        >
          <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent group-hover:from-blue-300 group-hover:to-cyan-300 transition-colors">
          {room ? "Join Game" : "Create Game"}
          </span>
        </button>
        <div className="mt-8 flex justify-center">
          <ReturnToMainMenu />
        </div>
      </div>
    </PageLayout>
  );
}