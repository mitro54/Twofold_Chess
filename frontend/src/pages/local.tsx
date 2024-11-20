import Gameboard from "../components/Gameboard";

export default function LocalGame() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
      <h1 className="text-4xl font-bold mb-6 text-gray-800">Local Game</h1>
      <Gameboard />
      <p className="mt-4 text-lg text-gray-600">
        Play a game locally with a friend on the same device.
      </p>
    </div>
  );
}
