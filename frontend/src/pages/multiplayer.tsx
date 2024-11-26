import React, { useState } from "react";
import Gameboard from "../components/Gameboard";
import { v4 as uuidv4 } from "uuid";

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
    return <Gameboard username={username} room={room} />;
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-4xl font-bold mb-6">Play with a Friend</h1>
      <div className="flex flex-col space-y-4">
        <input
          type="text"
          placeholder="Enter your username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="border p-2 rounded text-black text-center"
        />
        <input
          type="text"
          placeholder="Enter room code (optional)"
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          className="border p-2 rounded text-black text-center"
        />
        <button
          onClick={handleStartGame}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          {room ? "Join Game" : "Create Game"}
        </button>
      </div>
    </div>
  );
}
