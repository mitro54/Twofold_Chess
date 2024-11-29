import React, { useEffect, useState } from "react";
import ReturnToMainMenu from "../components/ReturnToMainMenu";
import { useSession, signIn } from "next-auth/react";

interface Game {
  room: string;
  winner: string;
  board: string;
  moves: string[];
}

const HistoryPage: React.FC = () => {
  const { data: session, status } = useSession();
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) return;

    const fetchGames = async () => {
      try {
        const response = await fetch("http://localhost:5001/api/games");
        const data = await response.json();
        setGames(data);
      } catch (error) {
        console.error("Error fetching games history:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchGames();
  }, [session]);

  if (status === "loading") {
    return <div className="text-center text-lg font-semibold mt-10">Checking authentication...</div>;
  }

  if (!session) {
    return (
      <div className="text-center mt-10">
        <p className="text-lg font-semibold mb-4">You need to sign in to view game history.</p>
        <button
          onClick={() => signIn()}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          Sign in with GitHub
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center text-lg font-semibold mt-10">Loading...</div>;
  }

  if (games.length === 0) {
    return <div className="text-center text-lg font-semibold mt-10">No games history available.</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto bg-transparent">
      <h1 className="text-3xl font-bold text-center mb-6">Games History</h1>
      <table className="w-full border-collapse border border-gray-300">
        <thead>
          <tr>
            <th className="border border-gray-300 p-2">Room</th>
            <th className="border border-gray-300 p-2">Winner</th>
            <th className="border border-gray-300 p-2">Checkmate Board</th>
            <th className="border border-gray-300 p-2">Moves</th>
          </tr>
        </thead>
        <tbody>
          {games.map((game, index) => (
            <tr key={index}>
              <td className="border border-gray-300 p-2 text-center">{game.room === "local" ? "Local Game" : game.room}</td>
              <td className="border border-gray-300 p-2 text-center">{game.winner}</td>
              <td className="border border-gray-300 p-2 text-center">{game.board}</td>
              <td className="border border-gray-300 p-2">
                <ul className="list-decimal pl-4">
                  {game.moves.map((move, moveIndex) => (
                    <li key={moveIndex}>{move}</li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ReturnToMainMenu />
    </div>
  );
};

export default HistoryPage;