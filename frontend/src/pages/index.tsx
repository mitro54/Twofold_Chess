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
    <div className="flex flex-col justify-center items-center h-screen bg-gray-100">
      <h1 className="text-4xl font-bold mb-6 text-gray-800">Chess Project</h1>

      {!showGameOptions ? (
        <>
          <Button size="lg" color="primary" onPress={handlePlayGame}>
            Play a Game
          </Button>
          <Spacer y={1} />
          <Button size="lg" color="secondary" onPress={handleSeeHistory}>
            See All Games History
          </Button>
        </>
      ) : (
        <>
          <Button size="lg" color="primary" onPress={handleLocalGame}>
            Local Game
          </Button>
          <Spacer y={1} />
          <Button size="lg" color="secondary" onPress={handlePlayWithFriend}>
            Play with Friend
          </Button>
        </>
      )}
    </div>
  );
}

