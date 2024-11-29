import React, { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { FaDoorOpen } from "react-icons/fa";
import { GetServerSideProps } from "next";
import { getSession } from "next-auth/react";
import ReturnToMainMenu from "../components/ReturnToMainMenu";

interface Game {
  room: string;
  winner: string;
  board: string;
  moves: string[];
}

const HistoryPage: React.FC = () => {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  if (loading) {
    return (
      <div className="text-center text-lg font-semibold mt-10 bg-gray-900 text-white min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="p-6 pt-0 max-w-4xl mx-auto bg-gray-900 text-white min-h-screen">
      <div className="flex justify-between items-end mb-6">
      <ReturnToMainMenu />
        <button
          onClick={() => signOut()}
          className="text-white bg-red-600 opacity-65 px-3 py-1 h-10 rounded-md flex items-center gap-2 hover:bg-red-400 transition"
        >
          <FaDoorOpen size={18} />
          Logout
        </button>
      </div>


      {games.length === 0 ? (
        <div className="text-center">
          <p className="text-lg font-semibold">No games history available.</p>
          <p className="text-sm text-gray-400 mt-2">
            Try playing a game and finishing it to see it here.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-bold text-center mb-6">Games History</h1>
          {games.map((game, index) => (
            <div
              key={index}
              className="mb-8 p-4 border border-gray-700 rounded-md bg-gray-800"
            >
              <div className="flex flex-wrap gap-4 justify-between items-center">
                <div>
                  <p className="font-semibold text-lg">
                    <span className="text-gray-400">Room:</span>{" "}
                    {game.room === "local" ? "Local Game" : game.room}
                  </p>
                  <p className="font-semibold text-lg">
                    <span className="text-gray-400">Winner:</span> {game.winner}
                  </p>
                  <p className="font-semibold text-lg">
                    <span className="text-gray-400">Checkmate Board:</span>{" "}
                    {game.board}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <h2 className="text-lg font-bold mb-2">Moves:</h2>
                <ul className="list-decimal pl-6 text-gray-200">
                  {game.moves.map((move, moveIndex) => (
                    <li key={moveIndex}>{move}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default HistoryPage;

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getSession(context);
  
  if (!session) {
    return {
      redirect: {
        destination: `/auth/signin?callbackUrl=${encodeURIComponent('/history')}`,
        permanent: false,
      },
    };
  }

  return {
    props: {},
  };
};