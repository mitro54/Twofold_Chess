import React, { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { FaDoorOpen, FaSearch, FaFilter, FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { GetServerSideProps } from "next";
import { getSession } from "next-auth/react";
import ReturnToMainMenu from "../components/ReturnToMainMenu";
import PageLayout from "../components/PageLayout";

interface Game {
  room: string;
  winner: string;
  checkmate_board: string | null;
  moves: string[];
  status: string;
  end_reason: string;
}

interface GameStats {
  totalGames: number;
  whiteWins: number;
  blackWins: number;
  draws: number;
  mainBoardCheckmates: number;
  secondaryBoardCheckmates: number;
}

const GAMES_PER_PAGE = 10;

const HistoryPage: React.FC = () => {
  const [games, setGames] = useState<Game[]>([]);
  const [filteredGames, setFilteredGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [stats, setStats] = useState<GameStats>({
    totalGames: 0,
    whiteWins: 0,
    blackWins: 0,
    draws: 0,
    mainBoardCheckmates: 0,
    secondaryBoardCheckmates: 0,
  });
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    winner: "all",
    board: "all",
    endReason: "all",
  });

  // Calculate pagination values
  const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);
  const startIndex = (currentPage - 1) * GAMES_PER_PAGE;
  const endIndex = startIndex + GAMES_PER_PAGE;
  const currentGames = filteredGames.slice(startIndex, endIndex);

  useEffect(() => {
    const fetchGames = async () => {
      try {
        const response = await fetch("http://localhost:5001/api/games");
        const data = await response.json();
        setGames(data);
        setFilteredGames(data);
        
        // Calculate statistics
        const newStats = {
          totalGames: data.length,
          whiteWins: data.filter((g: Game) => g.winner === "White").length,
          blackWins: data.filter((g: Game) => g.winner === "Black").length,
          draws: data.filter((g: Game) => g.winner === "Draw").length,
          mainBoardCheckmates: data.filter((g: Game) => g.checkmate_board === "main").length,
          secondaryBoardCheckmates: data.filter((g: Game) => g.checkmate_board === "secondary").length,
        };
        setStats(newStats);
      } catch (error) {
        console.error("Error fetching games history:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchGames();
  }, []);

  useEffect(() => {
    let filtered = [...games];

    // Apply search term
    if (searchTerm) {
      filtered = filtered.filter(game => 
        game.room.toLowerCase().includes(searchTerm.toLowerCase()) ||
        game.moves.some(move => move.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Apply filters
    if (filters.winner !== "all") {
      filtered = filtered.filter(game => game.winner === filters.winner);
    }
    if (filters.board !== "all") {
      filtered = filtered.filter(game => game.checkmate_board === filters.board);
    }
    if (filters.endReason !== "all") {
      filtered = filtered.filter(game => game.end_reason === filters.endReason);
    }

    setFilteredGames(filtered);
    setCurrentPage(1); // Reset to first page when filters change
  }, [games, searchTerm, filters]);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <PageLayout>
        <div className="text-white text-xl">Loading...</div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Games History">
      <div className="w-full">
        <div className="flex justify-between items-end mb-6">
          <ReturnToMainMenu />
          <button
            onClick={() => signOut()}
            className="px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-red-500/30 hover:border-red-400/50 transition-all duration-300 transform hover:scale-105 text-base font-semibold shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:shadow-[0_0_20px_rgba(239,68,68,0.5)] flex items-center justify-center min-w-[160px] group"
          >
            <span className="bg-gradient-to-r from-red-400 to-pink-400 bg-clip-text text-transparent group-hover:from-red-300 group-hover:to-pink-300 transition-colors flex items-center gap-2">
              <FaDoorOpen className="text-red-400 group-hover:text-red-300 transition-colors" size={18} />
              Logout
            </span>
          </button>
        </div>

        {/* Statistics Section */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8 p-4 bg-gray-900/80 backdrop-blur-sm rounded-lg border border-indigo-500/30">
          <div className="text-center">
            <p className="text-gray-400">Total Games</p>
            <p className="text-2xl font-bold text-white">{stats.totalGames}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400">White Wins</p>
            <p className="text-2xl font-bold text-white">{stats.whiteWins}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400">Black Wins</p>
            <p className="text-2xl font-bold text-gray-300">{stats.blackWins}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400">Draws</p>
            <p className="text-2xl font-bold text-gray-400">{stats.draws}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400">Main Board Checkmates</p>
            <p className="text-2xl font-bold text-red-400">{stats.mainBoardCheckmates}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400">Secondary Board Checkmates</p>
            <p className="text-2xl font-bold text-blue-400">{stats.secondaryBoardCheckmates}</p>
          </div>
        </div>

        {/* Search and Filter Section */}
        <div className="mb-8">
          <div className="flex gap-4 mb-4">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search games by room or moves..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-indigo-500/30 focus:border-indigo-400/50 focus:outline-none pl-10"
              />
              <FaSearch className="absolute left-3 top-3 text-gray-400" />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="px-4 py-2 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-purple-500/30 hover:border-purple-400/50 transition-all duration-300 flex items-center gap-2"
            >
              <FaFilter />
              Filters
            </button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-gray-900/80 backdrop-blur-sm rounded-lg border border-purple-500/30">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Winner</label>
                <select
                  value={filters.winner}
                  onChange={(e) => setFilters({ ...filters, winner: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800/80 text-white rounded-lg border border-indigo-500/30 focus:border-indigo-400/50 focus:outline-none"
                >
                  <option value="all">All Winners</option>
                  <option value="White">White</option>
                  <option value="Black">Black</option>
                  <option value="Draw">Draw</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Checkmate Board</label>
                <select
                  value={filters.board}
                  onChange={(e) => setFilters({ ...filters, board: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800/80 text-white rounded-lg border border-indigo-500/30 focus:border-indigo-400/50 focus:outline-none"
                >
                  <option value="all">All Boards</option>
                  <option value="main">Main Board</option>
                  <option value="secondary">Secondary Board</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">End Reason</label>
                <select
                  value={filters.endReason}
                  onChange={(e) => setFilters({ ...filters, endReason: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800/80 text-white rounded-lg border border-indigo-500/30 focus:border-indigo-400/50 focus:outline-none"
                >
                  <option value="all">All Reasons</option>
                  <option value="checkmate">Checkmate</option>
                  <option value="stalemate">Stalemate</option>
                  <option value="repetition">Threefold Repetition</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {filteredGames.length === 0 ? (
          <div className="text-center">
            <p className="text-lg font-semibold text-white">No games found matching your criteria.</p>
            <p className="text-sm text-gray-400 mt-2">
              Try adjusting your search or filters.
            </p>
          </div>
        ) : (
          <>
            {currentGames.map((game, index) => (
              <div
                key={index}
                className="mb-8 p-4 bg-gray-900/80 backdrop-blur-sm rounded-lg border border-indigo-500/30"
              >
                <div className="flex flex-wrap gap-4 justify-between items-center">
                  <div>
                    <p className="font-semibold text-lg text-white">
                      <span className="text-gray-400">Room:</span>{" "}
                      {game.room === "local" ? "Local Game" : game.room}
                    </p>
                    <p className="font-semibold text-lg text-white">
                      <span className="text-gray-400">Winner:</span> {game.winner}
                    </p>
                    <p className="font-semibold text-lg text-white">
                      <span className="text-gray-400">Checkmate Board:</span>{" "}
                      {game.checkmate_board ? game.checkmate_board : "Draw - No checkmate"}
                    </p>
                    <p className="font-semibold text-lg text-white">
                      <span className="text-gray-400">End Reason:</span>{" "}
                      {game.end_reason}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <h2 className="text-lg font-bold mb-2 text-white">Moves:</h2>
                  <ul className="list-decimal pl-6 text-gray-200">
                    {game.moves.map((move, moveIndex) => (
                      <li key={moveIndex}>{move}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}

            {/* Pagination Controls */}
            <div className="flex justify-center items-center gap-4 mt-8 mb-4">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  currentPage === 1
                    ? "bg-gray-800/80 text-gray-500 cursor-not-allowed"
                    : "bg-gray-900/80 backdrop-blur-sm text-white hover:bg-gray-800/80 border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-300"
                }`}
              >
                <FaChevronLeft />
                Previous
              </button>
              
              <div className="flex items-center gap-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`w-8 h-8 rounded-lg ${
                      currentPage === page
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-900/80 backdrop-blur-sm text-white hover:bg-gray-800/80 border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-300"
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  currentPage === totalPages
                    ? "bg-gray-800/80 text-gray-500 cursor-not-allowed"
                    : "bg-gray-900/80 backdrop-blur-sm text-white hover:bg-gray-800/80 border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-300"
                }`}
              >
                Next
                <FaChevronRight />
              </button>
            </div>
          </>
        )}
      </div>
    </PageLayout>
  );
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getSession(context);

  if (!session) {
    return {
      redirect: {
        destination: "/",
        permanent: false,
      },
    };
  }

  return {
    props: { session },
  };
};

export default HistoryPage;