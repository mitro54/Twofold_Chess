import React, { useState, useEffect } from "react";

const pieceSymbols: Record<string, string> = {
  P: "♙",
  p: "♟",
  R: "♖",
  r: "♜",
  N: "♘",
  n: "♞",
  B: "♗",
  b: "♝",
  Q: "♕",
  q: "♛",
  K: "♔",
  k: "♚",
};

const createInitialBoard = (isWhiteBottom: boolean): Array<Array<string | null>> => {
  const emptyRow: Array<string | null> = Array(8).fill(null);

  const whitePieces = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  const blackPieces = whitePieces.map((p) => p.toLowerCase());
  const whitePawns = "P";
  const blackPawns = "p";

  const board = [
    isWhiteBottom ? whitePieces : blackPieces, // Top row
    Array(8).fill(isWhiteBottom ? whitePawns : blackPawns), // Row 1
    ...Array(4).fill(emptyRow), // Rows 2-5
    Array(8).fill(isWhiteBottom ? blackPawns : whitePawns), // Row 6
    isWhiteBottom ? blackPieces : whitePieces, // Bottom row
  ];

  return isWhiteBottom ? board : board.reverse();
};

const Gameboard: React.FC = () => {
  const [mainBoard, setMainBoard] = useState(createInitialBoard(false));
  const [secondaryBoard, setSecondaryBoard] = useState(createInitialBoard(false));
  const [activeBoard, setActiveBoard] = useState<"main" | "secondary">("main");
  const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);

  const resetBoard = () => {
    setMainBoard(createInitialBoard(false));
    setSecondaryBoard(createInitialBoard(false));
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

  const getBoardState = (board: Array<Array<string | null>>, colors: { light: string; dark: string }) =>
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
            <span className="text-2xl font-bold leading-none">{piece ? pieceSymbols[piece] : null}</span>
          </div>
        );
      })
    );

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">{activeBoard === "main" ? "Main Board" : "Secondary Board"}</h2>

      {/* Board Container */}
      <div className="relative w-[400px] h-[400px]">
        {/* Bottom Board */}
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

        {/* Top Board */}
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

      <p className="text-lg text-gray-600 mt-4">Press Spacebar to swap boards</p>
      <button
        onClick={resetBoard}
        className="px-4 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 mt-4"
      >
        Reset Both Boards
      </button>
    </div>
  );
};

export default Gameboard;
