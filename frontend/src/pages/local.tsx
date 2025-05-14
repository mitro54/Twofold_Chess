import Gameboard from "../components/Gameboard";
import ReturnToMainMenu from "../components/ReturnToMainMenu";
import { useEffect, useState } from 'react';

export default function LocalGame() {
  const [localRoomId, setLocalRoomId] = useState<string | null>(null);

  useEffect(() => {
    const newRoomId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setLocalRoomId(newRoomId);
  }, []);

  if (!localRoomId) {
    return <p>Loading local game...</p>;
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-4xl font-bold mb-6">Local Game</h1>
      <Gameboard room={localRoomId} username="Local Player" />
      <ReturnToMainMenu />
    </div>
  );
}