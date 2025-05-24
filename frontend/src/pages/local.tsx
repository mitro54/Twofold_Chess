import Gameboard from "../components/Gameboard";
import ReturnToMainMenu from "../components/ReturnToMainMenu";
import { useEffect, useState } from 'react';
import PageLayout from "../components/PageLayout";
import { io, Socket } from "socket.io-client";
import environment from "../config/environment";

export default function LocalGame() {
  const [localRoomId, setLocalRoomId] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Generate a unique room ID for local play
    const newRoomId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setLocalRoomId(newRoomId);

    // Initialize socket connection
    const newSocket = io(environment.apiUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      autoConnect: true,
    });

    newSocket.on("connect", () => {
      console.log("Socket connected for local game");
      // Create a local game room
      newSocket.emit("create_lobby", {
        roomId: newRoomId,
        host: "local_player",
        isPrivate: true
      });
    });

    newSocket.on("error", (data: { message: string }) => {
      console.error("Socket error:", data);
      if (data.message === "Room already exists") {
        // Try to join the room instead
        console.log("Room exists, attempting to join instead.");
        newSocket.emit("join", { username: "local_player", room: newRoomId });
      }
    });

    setSocket(newSocket);

    // Cleanup on unmount
    return () => {
      if (newSocket) {
        newSocket.disconnect();
      }
    };
  }, []);

  if (!localRoomId || !socket) {
    return (
      <PageLayout>
        <div className="text-white text-xl">Loading local game...</div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="w-full">
        <Gameboard 
          room={localRoomId} 
          socket={socket}
          playerColor={null} // Pass null to allow playing both colors
        />
        <div className="mt-8 flex justify-center">
          <ReturnToMainMenu />
        </div>
      </div>
    </PageLayout>
  );
}