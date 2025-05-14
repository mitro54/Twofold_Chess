import { Button } from "@heroui/react";
import { useState } from "react";
import { useRouter } from "next/router";

export default function Home() {
  const [showGameOptions, setShowGameOptions] = useState(false);
  const router = useRouter();

  const handlePlayGame = () => {
    setShowGameOptions(true);
  };

  const handleLocalGame = () => {
    router.push("/local");
  };

  const handlePlayWithFriend = () => {
    router.push("/multiplayer");
  };

  const handleSeeHistory = () => {
    router.push("/history");
  };

  return (
    <div className="flex flex-col justify-center items-center h-screen">
      <h1 className="text-4xl font-bold mb-6">Twofold Chess</h1>
      <div className="flex space-x-4">
        {!showGameOptions ? (
          <>
            <Button
              className="px-6 py-3 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition text-center flex justify-center items-center"
              onClick={handlePlayGame}
            >
              Play Game
            </Button>
            <Button
              className="px-6 py-3 bg-gray-800 text-white rounded-md hover:bg-gray-700 transition text-center flex justify-center items-center"
              onClick={handleSeeHistory}
            >
              See History
            </Button>
          </>
        ) : (
          <>
            <Button
              className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-500 transition text-center flex justify-center items-center"
              onClick={handleLocalGame}
            >
              Local Game
            </Button>
            <Button
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition text-center flex justify-center items-center"
              onClick={handlePlayWithFriend}
            >
              Play with a Friend
            </Button>
          </>
        )}
      </div>
      {showGameOptions && (
        <div className="mt-4">
          <Button
            className="bg-gray-800 text-white rounded-md hover:bg-gray-700 transition text-center"
            onPress={() => setShowGameOptions(false)}
          >
            Return to Main Menu
          </Button>
        </div>
      )}
    </div>
  );
}