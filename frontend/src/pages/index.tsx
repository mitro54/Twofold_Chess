import { Button, Spacer } from "@nextui-org/react";
import { useState } from "react";

export default function Home() {
  const [showGameOptions, setShowGameOptions] = useState(false);

  const handlePlayGame = () => {
    setShowGameOptions(true);
  };

  const handleLocalGame = () => {
    window.location.href = "/local";
  };  

  const handlePlayWithFriend = () => {
    window.location.href = "/multiplayer";
  };  

  const handleSeeHistory = () => {
  };

  return (
    <div className="flex flex-col justify-center items-center h-screen">
      <h1 className="text-4xl font-bold mb-6">2-Step Chess</h1>
      <div className="flex space-x-4">

      {!showGameOptions ? (
        <>
        <Button
          className="px-6 py-3 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition"
          onPress={handlePlayGame}
        >
          Play a Game
        </Button>
          <Spacer y={1} />
          <Button
          className="px-6 py-3 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition"
          onPress={handleSeeHistory}
        >
          See All Games History
        </Button>
        </>
      ) : (
        <>
          <Button
           className="px-6 py-3 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition"
           onPress={handleLocalGame}>
            Local Game
          </Button>
          <Spacer y={1} />
          <Button
           className="px-6 py-3 bg-gray-500 text-white rounded-md hover:bg-gray-400 transition"
           onPress={handlePlayWithFriend}>
            Play with Friend
          </Button>
        </>
      )}
      </div>
    </div>
  );
}

