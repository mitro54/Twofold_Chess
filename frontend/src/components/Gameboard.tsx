import React, { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";

interface GameboardProps {
  username?: string;
  room?: string;
}

const pieceSymbols: Record<string, string> = {
  P: "♟",
  p: "♟",
  R: "♜",
  r: "♜",
  N: "♞",
  n: "♞",
  B: "♝",
  b: "♝",
  Q: "♛",
  q: "♛",
  K: "♚",
  k: "♚",
};

const createInitialBoard = (): Array<Array<string | null>> => {
  const emptyRow: Array<string | null> = Array(8).fill(null);

  const whitePieces = ["R1", "N1", "B1", "Q1", "K1", "B2", "N2", "R2"];
  const blackPieces = whitePieces.map((p) => p.toLowerCase());
  const whitePawns = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];
  const blackPawns = whitePawns.map((p) => p.toLowerCase());

  return [
    blackPieces,
    blackPawns,
    ...Array(4).fill(emptyRow),
    whitePawns,
    whitePieces,
  ];
};

const Gameboard: React.FC<GameboardProps> = ({ username, room }) => {
  const [mainBoard, setMainBoard] = useState(createInitialBoard());
  const [secondaryBoard, setSecondaryBoard] = useState(createInitialBoard());
  const [activeBoard, setActiveBoard] = useState<"main" | "secondary">("main");
  const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);
  const [turn, setTurn] = useState<"White" | "Black">("White");

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [turnCount, setTurnCount] = useState(0);

  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [gameFinished, setGameFinished] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [winner, setWinner] = useState<"White" | "Black" | null>(null);
  const [checkmateBoard, setCheckmateBoard] = useState<"main" | "secondary" | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io("http://localhost:5001");
    setSocket(newSocket);

    newSocket.emit("join", { username, room });

    newSocket.on("game_state", (data) => {
      setMainBoard(data.mainBoard);
      setSecondaryBoard(data.secondaryBoard);
      setTurn(data.turn);
    });

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        toggleBoard();
      }
    };

    window.addEventListener("keydown", handleKeyPress);

    return () => {
      newSocket.disconnect();
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [username, room]);

  const resetBoard = async () => {
    const initialBoard = createInitialBoard();
    setMainBoard(initialBoard);
    setSecondaryBoard(initialBoard);
    setSelectedSquare(null);
    setTurn("White");
    setTurnCount(0);
    setMoveHistory([]);
    setGameFinished(false);
    setActiveBoard("main");
    setShowFinishModal(false);
    setWinner(null);
    setCheckmateBoard(null);

    if (socket) {
      socket.emit("reset", { room });
    }
  };

  const handleSquareClick = (row: number, col: number) => {
    if (!socket || gameFinished) return;
  
    const board = activeBoard === "main" ? mainBoard : secondaryBoard;
    const setBoard = activeBoard === "main" ? setMainBoard : setSecondaryBoard;
  
    if (selectedSquare) {
      const [fromRow, fromCol] = selectedSquare;
  
      if (fromRow === row && fromCol === col) {
        setSelectedSquare(null);
        return;
      }
  
      const piece = board[fromRow][fromCol];
      if (piece) {
        const targetPiece = board[row][col];
        const newBoard = board.map((r, i) =>
          r.map((c, j) => (i === row && j === col ? piece : i === fromRow && j === fromCol ? null : c))
        );
  
        setBoard(newBoard);
  
        const moveDescription = `${piece} moved from ${String.fromCharCode(97 + fromCol)}${8 - fromRow} to ${String.fromCharCode(97 + col)}${8 - row} on ${activeBoard} board`;
        setMoveHistory((prevHistory) => [...prevHistory, moveDescription]);
  
        if (activeBoard === "main" && targetPiece) {
          setSecondaryBoard((prevBoard) => {
            const newSecondaryBoard = [...prevBoard];
            // Loop through the rows and columns to find the target piece in the secondary board
            for (let i = 0; i < 8; i++) {
              for (let j = 0; j < 8; j++) {
                if (newSecondaryBoard[i][j] === targetPiece) {
                  newSecondaryBoard[i][j] = null; // Remove the piece from the secondary board
                  break;
                }
              }
            }
            return newSecondaryBoard;
          });
        }
  
        setSelectedSquare(null);
  
        socket.emit("move", {
          room,
          boardType: activeBoard,
          board: newBoard,
        });
  
        toggleBoard();
  
        setTurnCount((prevCount) => {
          const newCount = prevCount + 1;
          if (newCount >= 2) {
            setTurn((prevTurn) => (prevTurn === "White" ? "Black" : "White"));
            return 0;
          }
          return newCount;
        });
      }
    } else if (board[row][col]) {
      setSelectedSquare([row, col]);
    }
  };
  

  const toggleBoard = () => {
    setActiveBoard((prev) => (prev === "main" ? "secondary" : "main"));
    setSelectedSquare(null);
  };

  const handleFinishGame = async () => {
    if (winner && checkmateBoard) {
      const gameData = {
        room,
        winner,
        board: checkmateBoard,
        moves: moveHistory,
      };

      await fetch("http://localhost:5001/api/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gameData),
      });

      setGameFinished(true);
      setShowFinishModal(false);
      alert(`Game finished! Winner: ${winner} on ${checkmateBoard} board`);
    }
  };

  const squareColors = {
    main: { light: "bg-[#f0d9b5]", dark: "bg-[#b58863]" },
    secondary: { light: "bg-[#d9e6f0]", dark: "bg-[#637db5]" },
  };

  const getBoardState = (board: Array<Array<string | null>>, colors: { light: string; dark: string }) =>
    board.map((row, rowIndex) =>
      row.map((piece, colIndex) => {
        const isBlack = (rowIndex + colIndex) % 2 === 1;
        const isSelected = selectedSquare?.[0] === rowIndex && selectedSquare?.[1] === colIndex;

        return (
          <div
            key={`square-${rowIndex}-${colIndex}`}
            onClick={() => handleSquareClick(rowIndex, colIndex)}
            className={`w-[50px] h-[50px] flex items-center justify-center ${
              isBlack ? colors.dark : colors.light
            } ${isSelected ? "bg-red-300" : ""}`}
          >
            {piece && (
              <span
                className={`text-2xl font-bold leading-none ${
                  piece.toUpperCase() === piece ? "text-white" : "text-black"
                }`}
              >
                {pieceSymbols[piece[0]]}
              </span>
            )}
          </div>
        );
      })
    );

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Room: {room}</h2>
      <p className="text-lg font-semibold mb-2">Turn: {turn}</p>

      <div className="relative w-[400px] h-[400px]">
        <div
          className="absolute inset-0 grid grid-cols-8 shadow-lg"
          style={{ transform: "translate(15px, 15px)", zIndex: activeBoard === "secondary" ? 1 : 2 }}
        >
          {getBoardState(
            activeBoard === "main" ? secondaryBoard : mainBoard,
            activeBoard === "main" ? squareColors.secondary : squareColors.main
          )}
        </div>

        <div
          className="absolute inset-0 grid grid-cols-8"
          style={{ zIndex: activeBoard === "main" ? 2 : 1 }}
        >
          {getBoardState(
            activeBoard === "main" ? mainBoard : secondaryBoard,
            activeBoard === "main" ? squareColors.main : squareColors.secondary
          )}
        </div>
      </div>

      {showFinishModal && (
  <div
    className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-50"
  >
    <div className="bg-white p-6 rounded-lg shadow-lg text-center z-60">
      <h3 className="text-lg font-bold mb-4">Finish Game</h3>
      <p className="mb-4 text-black">Select the winner:</p>
      <div className="flex justify-center items-center gap-4 mb-6">
        <button
          onClick={() => setWinner("White")}
          className={`px-6 py-2 rounded ${
            winner === "White" ? "bg-blue-500 text-white" : "bg-gray-200"
          }`}
        >
          White
        </button>
        <button
          onClick={() => setWinner("Black")}
          className={`px-6 py-2 rounded ${
            winner === "Black" ? "bg-blue-500 text-white" : "bg-gray-200"
          }`}
        >
          Black
        </button>
      </div>
      <p className="mb-4 text-black">Select the board where checkmate occurred:</p>
      <div className="flex justify-center items-center gap-4 mb-6">
        <button
          onClick={() => setCheckmateBoard("main")}
          className={`px-6 py-2 rounded ${
            checkmateBoard === "main" ? "bg-blue-500 text-white" : "bg-gray-200"
          }`}
        >
          Main
        </button>
        <button
          onClick={() => setCheckmateBoard("secondary")}
          className={`px-6 py-2 rounded ${
            checkmateBoard === "secondary" ? "bg-blue-500 text-white" : "bg-gray-200"
          }`}
        >
          Secondary
        </button>
      </div>
      <div className="flex justify-center items-center gap-4 mt-6">
        <button
          onClick={handleFinishGame}
          className="px-6 py-2 bg-green-500 text-white rounded"
        >
          Confirm
        </button>
        <button
          onClick={() => setShowFinishModal(false)}
          className="px-6 py-2 bg-red-500 text-white rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
)}

      <p className="text-lg text-gray-600 mt-4">Press Spacebar to swap boards</p>
      <div className="flex gap-4 mt-4">
        <button
          onClick={resetBoard}
          className="px-4 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700"
        >
          Reset Both Boards
        </button>
        <button
          onClick={() => setShowFinishModal(true)}
          className="px-4 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700"
        >
          Finish Game
        </button>
      </div>
    </div>
  );
};

export default Gameboard;
