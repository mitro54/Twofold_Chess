import React from "react";
import { useRouter } from "next/router";
import { Button } from "@heroui/react";

const ReturnToMainMenu: React.FC = () => {
  const router = useRouter();

  const handleReturnToMainMenu = () => {
    router.push("/");
  };

  return (
    <div className="mt-4">
      <Button
        className="bg-gray-800 text-white rounded-md hover:bg-gray-700 transition"
        onPress={handleReturnToMainMenu}
      >
        Return to Main Menu
      </Button>
    </div>
  );
};

export default ReturnToMainMenu;
