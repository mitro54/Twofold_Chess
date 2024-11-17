import { Button, Spacer } from "@nextui-org/react";

export default function Home() {
  return (
    <div className="flex flex-col justify-center items-center h-screen">
      <h1 className="text-4xl font-bold mb-6 text-gray-800">Two-Step Chess</h1>
      <Button size="lg" color="primary" className="w-40" onPress={() => handleNavigation("/play")}>
        Play a Game
      </Button>
      <Spacer y={1} />
      <Button size="lg" color="primary" className="w-40" onPress={() => handleNavigation("/history")}>
        See All Games History
      </Button>
    </div>
  );
}

const handleNavigation = (path: string) => {
  window.location.href = path;
};
