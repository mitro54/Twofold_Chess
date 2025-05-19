import { Button } from "@heroui/react";
import { useState } from "react";
import { useRouter } from "next/router";
import PageLayout from "../components/PageLayout";

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
    <PageLayout title="Twofold Chess">
      <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto px-4 -mt-8 sm:mt-0">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 justify-center w-full">
          {!showGameOptions ? (
            <>
              <Button
                className="w-full sm:w-auto px-3 sm:px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-300 transform hover:scale-105 text-base font-semibold shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)] flex items-center justify-center min-w-[120px] sm:min-w-[160px] group"
                onClick={handlePlayGame}
              >
                <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent group-hover:from-indigo-300 group-hover:to-purple-300 transition-colors">
                  Play Game
                </span>
              </Button>
              <Button
                className="w-full sm:w-auto px-3 sm:px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-purple-500/30 hover:border-purple-400/50 transition-all duration-300 transform hover:scale-105 text-base font-semibold shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)] flex items-center justify-center min-w-[120px] sm:min-w-[160px] group"
                onClick={handleSeeHistory}
              >
                <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent group-hover:from-purple-300 group-hover:to-pink-300 transition-colors">
                  See History
                </span>
              </Button>
            </>
          ) : (
            <>
              <Button
                className="w-full sm:w-auto px-3 sm:px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-green-500/30 hover:border-green-400/50 transition-all duration-300 transform hover:scale-105 text-base font-semibold shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:shadow-[0_0_20px_rgba(34,197,94,0.5)] flex items-center justify-center min-w-[120px] sm:min-w-[160px] group"
                onClick={handleLocalGame}
              >
                <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent group-hover:from-green-300 group-hover:to-emerald-300 transition-colors">
                  Local Game
                </span>
              </Button>
              <Button
                className="w-full sm:w-auto px-3 sm:px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-blue-500/30 hover:border-blue-400/50 transition-all duration-300 transform hover:scale-105 text-base font-semibold shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] flex items-center justify-center min-w-[120px] sm:min-w-[160px] group"
                onClick={handlePlayWithFriend}
              >
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent group-hover:from-blue-300 group-hover:to-cyan-300 transition-colors">
                  Play with a Friend
                </span>
              </Button>
            </>
          )}
        </div>
        
        {showGameOptions && (
          <div className="mt-6 flex justify-center w-full">
            <Button
              className="w-full sm:w-auto px-3 sm:px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-gray-500/30 hover:border-gray-400/50 transition-all duration-300 transform hover:scale-105 text-base font-semibold shadow-[0_0_15px_rgba(156,163,175,0.3)] hover:shadow-[0_0_20px_rgba(156,163,175,0.5)] flex items-center justify-center min-w-[120px] sm:min-w-[160px] group"
              onPress={() => setShowGameOptions(false)}
            >
              <span className="bg-gradient-to-r from-gray-400 to-gray-300 bg-clip-text text-transparent group-hover:from-gray-300 group-hover:to-gray-200 transition-colors">
                Return to Main Menu
              </span>
            </Button>
          </div>
        )}
      </div>
    </PageLayout>
  );
}