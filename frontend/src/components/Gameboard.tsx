// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

interface GameStateData {
  mainBoard: Array<Array<string | null>>;
  secondaryBoard: Array<Array<string | null>>;
  turn: "White" | "Black";
  active_board_phase?: "main" | "secondary"; // Optional for backward compatibility during migration
  moves?: string[];
}

interface MoveErrorData {
  message: string;
  expectedBoard?: "main" | "secondary";
  actualBoard?: "main" | "secondary";
}

interface GameboardProps {
  username?: string | undefined;
  room?: string | undefined;
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

const createInitialBoard = (isWhiteBottom: boolean): Array<Array<string | null>> => {
  const emptyRow: Array<string | null> = Array(8).fill(null);

  const whitePieces = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  const blackPieces = whitePieces.map((p) => p.toLowerCase());
  const whitePawns = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
  const blackPawns = Array.from({ length: 8 }, (_, index) => `p${index + 1}`);

  return [
    isWhiteBottom ? blackPieces : whitePieces, // Top row
    isWhiteBottom ? blackPawns : whitePawns, // Row 1
    ...Array(4).fill(emptyRow), // Rows 2-5
    isWhiteBottom ? whitePawns : blackPawns, // Row 6
    isWhiteBottom ? whitePieces : blackPieces, // Bottom row
  ];
};


const Gameboard: React.FC<GameboardProps> = ({ username: propsUsername, room: propsRoom }) => {
  const usernameFromProps = propsUsername ?? "LocalPlayer";
  const roomFromProps = propsRoom ?? "local_game_room";

  const [mainBoard, setMainBoard] = useState(createInitialBoard(true));
  const [secondaryBoard, setSecondaryBoard] = useState(createInitialBoard(true));
  const [activeBoard, setActiveBoard] = useState<"main" | "secondary">("main");
  const [serverActiveBoardPhase, setServerActiveBoardPhase] = useState<"main" | "secondary">("main");
  const [selectedSquare, setSelectedSquare] = useState<[number, number] | null>(null);
  const [turn, setTurn] = useState<"White" | "Black">("White");

  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [gameFinished, setGameFinished] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [winner, setWinner] = useState<"White" | "Black" | null>(null);
  const [checkmateBoard, setCheckmateBoard] = useState<"main" | "secondary" | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const visualUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (activeBoard === serverActiveBoardPhase) {
      if (visualUpdateTimeoutRef.current) {
        clearTimeout(visualUpdateTimeoutRef.current);
        visualUpdateTimeoutRef.current = null;
      }
      return;
    }

    if (visualUpdateTimeoutRef.current) {
      clearTimeout(visualUpdateTimeoutRef.current);
    }
    visualUpdateTimeoutRef.current = setTimeout(() => {
      setActiveBoard(serverActiveBoardPhase);
      visualUpdateTimeoutRef.current = null; 
    }, 500);

    return () => {
      if (visualUpdateTimeoutRef.current) {
        clearTimeout(visualUpdateTimeoutRef.current);
        visualUpdateTimeoutRef.current = null;
      }
    };
  }, [serverActiveBoardPhase, turn]);

  useEffect(() => {
    if (socket) {
      socket.on("game_reset", (data: GameStateData) => {
        console.log("FRONTEND: 'game_reset' event received. Data:", data ? JSON.parse(JSON.stringify(data)) : 'No data');
        setMainBoard(data.mainBoard);
        setSecondaryBoard(data.secondaryBoard);
        setTurn(data.turn);
        const currentPhase = data.active_board_phase || "main";
        setServerActiveBoardPhase(currentPhase);
        setActiveBoard(currentPhase);
        if (visualUpdateTimeoutRef.current) {
            clearTimeout(visualUpdateTimeoutRef.current);
            visualUpdateTimeoutRef.current = null;
        }
        setMoveHistory([]);
        setGameFinished(false);
        setSelectedSquare(null);
      });
    }
    return () => {
      if (socket) {
        socket.off("game_reset");
      }
    };
  }, [socket]);

  useEffect(() => {
    console.log(`FRONTEND: Initializing socket effect. Username: ${usernameFromProps}, Room: ${roomFromProps}`);
    const newSocketInstance = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5001");
    
    setSocket(newSocketInstance);

    console.log(`FRONTEND: Emitting 'join' for room: ${roomFromProps}`);
    newSocketInstance.emit("join", { username: usernameFromProps, room: roomFromProps });

    newSocketInstance.on("game_state", (data: GameStateData) => {
      console.log("FRONTEND: game_state event HANDLER ENTERED. Data:", data ? JSON.parse(JSON.stringify(data)) : 'No data received');
      setMainBoard(data.mainBoard);
      setSecondaryBoard(data.secondaryBoard);
      setTurn(data.turn || "White");
      const currentPhase = data.active_board_phase || "main";
      setServerActiveBoardPhase(currentPhase);
      setActiveBoard(currentPhase); 
      if (visualUpdateTimeoutRef.current) {
        clearTimeout(visualUpdateTimeoutRef.current);
        visualUpdateTimeoutRef.current = null;
      }
      // Explicitly reset all relevant states for a full reset scenario
      setMoveHistory(data.moves || []); // If backend sends empty moves on reset, this is fine.
      setSelectedSquare(null);
      setGameFinished(false);       // Ensure game is not finished
      setShowFinishModal(false);    // Close finish modal if open
      setWinner(null);              // Clear any winner
      setCheckmateBoard(null);      // Clear any checkmate board status
    });
  
    newSocketInstance.on("game_update", (data: GameStateData) => {
      if (!data || !data.mainBoard || !data.secondaryBoard) {
        console.error("FRONTEND ERROR: Invalid game_update data received:", data);
        return;
      }
      console.log("FRONTEND: game_update received (partial update after move):", JSON.parse(JSON.stringify(data))); // Log game update
    
      setMainBoard(data.mainBoard);
      setSecondaryBoard(data.secondaryBoard);
      setTurn(data.turn || "White");
      setServerActiveBoardPhase(data.active_board_phase || "main");
      setMoveHistory(data.moves || []);
      setSelectedSquare(null);
    });    

    newSocketInstance.on("move_error", (errorData: MoveErrorData) => {
      alert(`Error: ${errorData.message}`);
    });

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        if (visualUpdateTimeoutRef.current) {
          clearTimeout(visualUpdateTimeoutRef.current);
          visualUpdateTimeoutRef.current = null;
        }
        setActiveBoard(prev => prev === "main" ? "secondary" : "main");
        setSelectedSquare(null);
      }
    };

    window.addEventListener("keydown", handleKeyPress);

    return () => {
      console.log(`FRONTEND: Disconnecting socket for room: ${roomFromProps}`);
      newSocketInstance.disconnect();
      window.removeEventListener("keydown", handleKeyPress);
      if (visualUpdateTimeoutRef.current) {
        clearTimeout(visualUpdateTimeoutRef.current);
        visualUpdateTimeoutRef.current = null;
      }
    };
  }, [usernameFromProps, roomFromProps]);

  const resetBoard = async () => {
    console.log("FRONTEND: Resetting board for room:", roomFromProps);
    if (socket) {
      socket.emit("reset", { room: roomFromProps });
      console.log("FRONTEND: socket.emit('reset') called for room:", roomFromProps);
    } else {
      console.warn("FRONTEND: Reset called but socket is null.");
    }

    const backendBaseUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5001";
    // Ensure the base URL doesn't end with a trailing slash before appending /api/reset
    const cleanBackendBaseUrl = backendBaseUrl.replace(/\/$/, ''); 

    try {
      const response = await fetch(`${cleanBackendBaseUrl}/api/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomFromProps }),
      });
      if (!response.ok) {
        console.error("FRONTEND ERROR: API reset failed", await response.text());
      } else {
        console.log("FRONTEND: API /api/reset call successful for room:", roomFromProps);
      }
    } catch (error) {
      console.error("FRONTEND ERROR: Error calling API reset board:", error);
    }
  };

  const handleSquareClick = (row: number, col: number, boardClicked: "main" | "secondary") => {
    console.log(`FRONTEND: handleSquareClick triggered. ClickedBoard: ${boardClicked} Current ServerActivePhase: ${serverActiveBoardPhase} Current PlayerTurn: ${turn} SelectedSquareBeforeClick: ${JSON.stringify(selectedSquare)} GameFinished? ${gameFinished}`);

    if (!socket || gameFinished) {
      console.log("FRONTEND: Click ignored. Socket null or game finished.", { socketExists: !!socket, gameFinished });
      return;
    }
  
    if (boardClicked !== activeBoard || boardClicked !== serverActiveBoardPhase) {
      console.log(`FRONTEND CLICK IGNORED: Clicked on ${boardClicked}. Visually active: ${activeBoard}. Logically active phase: ${serverActiveBoardPhase}.`);
      return;
    }
  
    const currentBoardState = serverActiveBoardPhase === "main" ? mainBoard : secondaryBoard;
    const setCurrentBoardState = serverActiveBoardPhase === "main" ? setMainBoard : setSecondaryBoard;
  
    if (selectedSquare) {
      const [fromRow, fromCol] = selectedSquare;
  
      if (fromRow === row && fromCol === col) {
        setSelectedSquare(null);
        return;
      }
  
      const piece = currentBoardState[fromRow][fromCol];
      const targetPiece = currentBoardState[row][col];
  
      if (!piece) {
        setSelectedSquare(null);
        return;
      }
      const pieceColor = piece === piece.toUpperCase() ? "White" : "Black";
      if (pieceColor !== turn) {
        alert(`It's ${turn}'s turn. Cannot move ${pieceColor}'s piece.`);
        setSelectedSquare(null);
        return;
      }

      if (piece) {
        const newBoard = currentBoardState.map((r: Array<string | null>, i: number) =>
          r.map((c: string | null, j: number) => {
            if (i === row && j === col) {
              return piece;
            }
            if (i === fromRow && j === fromCol) {
              return null;
            }
            return c;
          })
        );
  
        setCurrentBoardState(newBoard);
  
        let moveDescription = `${piece} moved from ${String.fromCharCode(97 + fromCol)}${8 - fromRow} to ${String.fromCharCode(97 + col)}${8 - row} on ${serverActiveBoardPhase} board`;
  
        if (targetPiece) {
          moveDescription = `${piece} captured ${targetPiece} at ${String.fromCharCode(97 + col)}${8 - row} on ${serverActiveBoardPhase} board`;
        }
  
        setMoveHistory((prevHistory) => [...prevHistory, moveDescription]);
  
        setSelectedSquare(null);
  
        // Emit move to server
        if (socket && piece) {
          const moveDetails = {
            from: [fromRow, fromCol],
            to: [row, col],
            piece: piece,
            captured: targetPiece || null,
          };
          console.log("FRONTEND: Emitting move", { room: roomFromProps, boardType: serverActiveBoardPhase, board: newBoard, move: moveDetails });
          socket.emit("move", {
            room: roomFromProps, 
            boardType: serverActiveBoardPhase,
            board: newBoard,
            move: moveDetails,
          });
        }
     }
    } else if (currentBoardState[row][col]) {
      const pieceAtSelection = currentBoardState[row][col];
      if (pieceAtSelection) {
        const pieceColor = pieceAtSelection === pieceAtSelection.toUpperCase() ? "White" : "Black";
        if (pieceColor === turn) {
          setSelectedSquare([row, col]);
        } else {
          alert(`Cannot select opponent's piece. It's ${turn}'s turn.`);
        }
      }
    }
  };
  
  const handleFinishGame = () => {
    if (winner && checkmateBoard) {
      const gameRoom = roomFromProps || "local";
      
      if (socket) {
        socket.emit("finish_game", {
          room: gameRoom,
          winner,
          board: checkmateBoard,
          moves: moveHistory,
        });
  
        setShowFinishModal(false);
        setGameFinished(true);
        resetBoard();
      }
    }
  };

  const squareColors = {
    main: { light: "bg-[#f0d9b5]", dark: "bg-[#b58863]" },
    secondary: { light: "bg-[#d9e6f0]", dark: "bg-[#637db5]" },
  };

  const getBoardState = (
    boardData: Array<Array<string | null>>, 
    colors: { light: string; dark: string },
    boardType: "main" | "secondary"
  ) => {
    // Log current state for debugging disabled squares
    console.log(`FRONTEND RENDER getBoardState: Rendering for boardType=\"${boardType}\". Current serverActiveBoardPhase=\"${serverActiveBoardPhase}\", activeBoard (visual)=\"${activeBoard}\", turn=\"${turn}\"`);

    return boardData.map((row, rowIndex) =>
      row.map((piece, colIndex) => {
        const isBlackSquare = (rowIndex + colIndex) % 2 === 1;
        const isCurrentSelectedSquare = selectedSquare?.[0] === rowIndex && selectedSquare?.[1] === colIndex && boardType === serverActiveBoardPhase;
        const isDisabled = boardType !== serverActiveBoardPhase;

        if (boardType === "secondary" && isDisabled) {
            console.log(`FRONTEND RENDER DEBUG: Secondary board square [${rowIndex},${colIndex}] is BEING DISABLED. boardType=${boardType}, serverActiveBoardPhase=${serverActiveBoardPhase}`);
        }

        return (
          <div
            key={`square-${boardType}-${rowIndex}-${colIndex}`}
            onClick={() => !isDisabled && handleSquareClick(rowIndex, colIndex, boardType)}
            className={`w-[50px] h-[50px] flex items-center justify-center ${
              isBlackSquare ? colors.dark : colors.light
            } ${isCurrentSelectedSquare ? "bg-red-400 border-2 border-red-600" : ""}
              ${isDisabled ? "opacity-70 cursor-not-allowed" : "cursor-pointer"} 
              transition-all duration-150 ease-in-out`}
            title={isDisabled ? `Waiting for ${turn} on the ${serverActiveBoardPhase} board` : `${turn}'s turn on the ${serverActiveBoardPhase} board`}
          >
            {piece && (
              <span
                className={`text-3xl font-bold leading-none ${
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
  };

  return (
    <div className="flex flex-col items-center select-none">
      <h2 className="text-2xl font-bold mb-2 text-gray-600">Room: {roomFromProps}</h2>
      <h3 className="text-xl font-semibold mb-4 text-indigo-700">
        {turn}&apos;s turn on the {serverActiveBoardPhase} board
      </h3>

      <div className="relative w-[400px] h-[400px]">
        <div
          className={`absolute inset-0 grid grid-cols-8 ${activeBoard === "main" ? "shadow-lg" : ""}`}
          style={{
            transform: activeBoard === "main" ? "none" : "translate(15px, 15px)",
            zIndex: activeBoard === "main" ? 2 : 1,
            opacity: activeBoard === "main" ? 1 : 0.6,
            filter: activeBoard === "main" ? "none" : "grayscale(90%)",
            transition: "transform 0.3s ease-in-out, opacity 0.3s ease-in-out, filter 0.3s ease-in-out, box-shadow 0.3s ease-in-out",
          }}
        >
          {getBoardState(
            mainBoard,
            squareColors.main,
            "main"
          )}
        </div>

        <div
          className={`absolute inset-0 grid grid-cols-8 ${activeBoard === "secondary" ? "shadow-lg" : ""}`}
          style={{
            transform: activeBoard === "secondary" ? "none" : "translate(15px, 15px)",
            zIndex: activeBoard === "secondary" ? 2 : 1,
            opacity: activeBoard === "secondary" ? 1 : 0.6,
            filter: activeBoard === "secondary" ? "none" : "grayscale(90%)",
            transition: "transform 0.3s ease-in-out, opacity 0.3s ease-in-out, filter 0.3s ease-in-out, box-shadow 0.3s ease-in-out",
          }}
        >
          {getBoardState(
            secondaryBoard,
            squareColors.secondary,
            "secondary"
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
