import Gameboard from "../components/Gameboard";

export default function LocalGame() {
  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-4xl font-bold mb-6">Local Game</h1>
      <Gameboard />
    </div>
  );
}
