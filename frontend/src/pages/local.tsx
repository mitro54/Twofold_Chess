import Gameboard from "../components/Gameboard";
import ReturnToMainMenu from "../components/ReturnToMainMenu";
import { useEffect, useState } from 'react';
import PageLayout from "../components/PageLayout";

export default function LocalGame() {
  const [localRoomId, setLocalRoomId] = useState<string | null>(null);

  useEffect(() => {
    const newRoomId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setLocalRoomId(newRoomId);
  }, []);

  if (!localRoomId) {
    return (
      <PageLayout>
        <div className="text-white text-xl">Loading local game...</div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="w-full">
        <Gameboard room={localRoomId} username="Local Player" />
        <div className="mt-8 flex justify-center">
          <ReturnToMainMenu />
        </div>
      </div>
    </PageLayout>
  );
}