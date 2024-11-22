import React, { useState, useEffect } from "react";

const Gameboard: React.FC = () => {
  const initialBoard = Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => (row === 1 ? "P" : row === 6 ? "p" : null))
  );

  const [mainBoard, setMainBoard] = useState(initialBoard);
  const [secondaryBoard, setSecondaryBoard] = useState(initialBoard);
  const [activeBoard, setActiveBoard] = useState<"main" | "secondary">("main");
  const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);

  const resetBoard = () => {
    setMainBoard(initialBoard);
    setSecondaryBoard(initialBoard);
    setSelectedSquare(null);
  };

  const isBlackSquare = (row: number, col: number) => (row + col) % 2 === 1;

  const handleSquareClick = (row: number, col: number) => {
    const board = activeBoard === "main" ? mainBoard : secondaryBoard;
    const setBoard = activeBoard === "main" ? setMainBoard : setSecondaryBoard;

    if (selectedSquare) {
      const [fromRow, fromCol] = selectedSquare;
      const piece = board[fromRow][fromCol];

      if (piece) {
        const newBoard = board.map((r, i) =>
          r.map((c, j) => (i === row && j === col ? piece : i === fromRow && j === fromCol ? null : c))
        );

        setBoard(newBoard);
        setSelectedSquare(null);
      }
    } else if (board[row][col]) {
      setSelectedSquare([row, col]);
    }
  };

  const toggleBoard = () => {
    setActiveBoard((prev) => (prev === "main" ? "secondary" : "main"));
    setSelectedSquare(null);
  };

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        toggleBoard();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, []);

  const squareColors = {
    main: { light: "bg-[#f0d9b5]", dark: "bg-[#b58863]" },
    secondary: { light: "bg-[#d9e6f0]", dark: "bg-[#637db5]" },
  };

  const getBoardState = (board: typeof mainBoard, colors: { light: string; dark: string }) =>
    board.map((row, rowIndex) =>
      row.map((piece, colIndex) => {
        const isBlack = isBlackSquare(rowIndex, colIndex);
        const isSelected = selectedSquare?.[0] === rowIndex && selectedSquare?.[1] === colIndex;

        return (
          <div
            key={`square-${rowIndex}-${colIndex}`}
            onClick={() => handleSquareClick(rowIndex, colIndex)}
            className={`w-[50px] h-[50px] flex items-center justify-center ${
              isBlack ? colors.dark : colors.light
            } ${isSelected ? "border-4 border-yellow-400" : ""}`}
          >
            <span className="text-xl font-bold leading-none">{piece && (piece === "P" ? "♙" : "♟")}</span>
          </div>
        );
      })
    );

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-4">{activeBoard === "main" ? "Main Board" : "Secondary Board"}</h2>

      <div className="relative w-[400px] h-[400px]">
        <div
          className="absolute inset-0 grid grid-cols-8 shadow-lg"
          style={{
            transform: "translate(15px, 15px)",
            zIndex: activeBoard === "secondary" ? 1 : 2,
          }}
        >
          {getBoardState(
            activeBoard === "main" ? secondaryBoard : mainBoard,
            activeBoard === "main" ? squareColors.secondary : squareColors.main
          )}
        </div>

        <div
          className="absolute inset-0 grid grid-cols-8"
          style={{
            zIndex: activeBoard === "main" ? 2 : 1,
          }}
        >
          {getBoardState(
            activeBoard === "main" ? mainBoard : secondaryBoard,
            activeBoard === "main" ? squareColors.main : squareColors.secondary
          )}
        </div>
      </div>

      <p className="text-lg mt-4">Press Spacebar to swap boards</p>
      <button
        onClick={resetBoard}
        className="px-4 py-2 bg-gray-600 text-white font-bold rounded hover:bg-gray-500 mt-4"
      >
        Reset Both Boards
      </button>
    </div>
  );
};

export default Gameboard;
