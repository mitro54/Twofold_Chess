import React from "react";
import { useRouter } from "next/router";
import { Button } from "@heroui/react";

const ReturnToMainMenu: React.FC = () => {
  const router = useRouter();

  const handleReturnToMainMenu = () => {
    router.push("/");
  };

  return (
    <Button
      className="px-6 py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-gray-500/30 hover:border-gray-400/50 transition-all duration-300 transform hover:scale-105 text-base font-semibold shadow-[0_0_15px_rgba(156,163,175,0.3)] hover:shadow-[0_0_20px_rgba(156,163,175,0.5)] flex items-center justify-center min-w-[180px] group"
      onPress={handleReturnToMainMenu}
    >
      <span className="bg-gradient-to-r from-gray-400 to-gray-300 bg-clip-text text-transparent group-hover:from-gray-300 group-hover:to-gray-200 transition-colors">
        Return to Main Menu
      </span>
    </Button>
  );
};

export default ReturnToMainMenu;
