// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import {
  getValidMoves,
  getPieceInfo,
  Position,
  Piece as ChessPieceType,
  Board as ChessBoardType,
  PieceInfo,
  // isCheckmate, // Keep for potential UI hint if king is in check, or for local validation before send
  // isStalemate, // Keep for potential UI hint
} from "../utils/chessLogic";

interface GameStateData {
  mainBoard: Array<Array<string | null>>;
  secondaryBoard: Array<Array<string | null>>;
  turn: "White" | "Black";
  active_board_phase?: "main" | "secondary"; // Optional for backward compatibility during migration
  moves?: string[];
  winner?: "White" | "Black" | "Draw" | null;
  status?: string;
  main_board_outcome?: "active" | "white_wins" | "black_wins" | "draw_stalemate";
  secondary_board_outcome?: "active" | "white_wins" | "black_wins" | "draw_stalemate";
  game_over?: boolean;
  is_responding_to_check_on_board?: "main" | "secondary" | null;
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

  const [mainBoard, setMainBoard] = useState<ChessBoardType>(createInitialBoard(true));
  const [secondaryBoard, setSecondaryBoard] = useState<ChessBoardType>(createInitialBoard(true));
  const [activeBoard, setActiveBoard] = useState<"main" | "secondary">("main");
  const [serverActiveBoardPhase, setServerActiveBoardPhase] = useState<"main" | "secondary">("main");
  const [selectedPieceSquare, setSelectedPieceSquare] = useState<Position | null>(null);
  const [possibleMoves, setPossibleMoves] = useState<Position[]>([]);
  const [turn, setTurn] = useState<"White" | "Black">("White");

  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [gameFinished, setGameFinished] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showCheckmateModal, setShowCheckmateModal] = useState(false);
  const [gameEndMessage, setGameEndMessage] = useState("");
  const [winner, setWinner] = useState<"White" | "Black" | "Draw" | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const visualUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [mainBoardOutcome, setMainBoardOutcome] = useState<string>("active");
  const [secondaryBoardOutcome, setSecondaryBoardOutcome] = useState<string>("active");
  const [respondingToCheckBoard, setRespondingToCheckBoard] = useState<"main" | "secondary" | null>(null);

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
    console.log(`EFFECT: serverActiveBoardPhase (${serverActiveBoardPhase}) !== activeBoard (${activeBoard}). Setting timeout to sync.`);
    visualUpdateTimeoutRef.current = setTimeout(() => {
      console.log(`EFFECT TIMEOUT: Setting activeBoard to ${serverActiveBoardPhase}`);
      setActiveBoard(serverActiveBoardPhase);
      visualUpdateTimeoutRef.current = null;
    }, 500);

    return () => {
      if (visualUpdateTimeoutRef.current) {
        clearTimeout(visualUpdateTimeoutRef.current);
        visualUpdateTimeoutRef.current = null;
      }
    };
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [serverActiveBoardPhase]);

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
        setMoveHistory(data.moves || []);
        setGameFinished(data.game_over || false);
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
        setWinner(data.winner || null);
        setMainBoardOutcome(data.main_board_outcome || "active");
        setSecondaryBoardOutcome(data.secondary_board_outcome || "active");
        setShowCheckmateModal(false);
        setRespondingToCheckBoard(data.is_responding_to_check_on_board || null);
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
      setMoveHistory(data.moves || []);
      setSelectedPieceSquare(null);
      setPossibleMoves([]);
      setGameFinished(data.game_over || false); 
      setShowFinishModal(false);    
      setWinner(data.winner || null); 
      setMainBoardOutcome(data.main_board_outcome || "active");
      setSecondaryBoardOutcome(data.secondary_board_outcome || "active");
      setRespondingToCheckBoard(data.is_responding_to_check_on_board || null);

      if (data.game_over) {
        let endMsg = `Game Over.`;
        if (data.winner === "Draw") {
          endMsg = "The game is a Draw!";
        } else if (data.winner) {
          endMsg = `${data.winner} wins the game!`;
        }
        setGameEndMessage(endMsg);
        setShowCheckmateModal(true);
      }
    });
  
    newSocketInstance.on("game_update", (data: GameStateData) => {
      if (!data || !data.mainBoard || !data.secondaryBoard) {
        console.error("FRONTEND ERROR: Invalid game_update data received:", data);
        return;
      }
      console.log("FRONTEND: game_update received:", JSON.parse(JSON.stringify(data)));
    
      setMainBoard(data.mainBoard);
      setSecondaryBoard(data.secondaryBoard);
      setTurn(data.turn || "White");
      setServerActiveBoardPhase(data.active_board_phase || "main");
      setMoveHistory(data.moves || []);
      setWinner(data.winner || null);
      setGameFinished(data.game_over || false);
      setMainBoardOutcome(data.main_board_outcome || "active");
      setSecondaryBoardOutcome(data.secondary_board_outcome || "active");
      setRespondingToCheckBoard(data.is_responding_to_check_on_board || null);
      
      setSelectedPieceSquare(null);
      setPossibleMoves([]);

      if (data.game_over && !showCheckmateModal) {
        let endMsg = `Game Over.`;
        if (data.winner === "Draw") {
          endMsg = "The game is a Draw!";
        } else if (data.winner) {
          endMsg = `${data.winner} wins the game!`;
        } else {
           if (data.main_board_outcome === "draw_stalemate" && data.secondary_board_outcome === "draw_stalemate") {
            endMsg = "The game is a Draw due to stalemate on both boards!";
           } else {
            endMsg = "The game has concluded.";
           }
        }
        console.log(`FRONTEND: Game ended by server. Message: ${endMsg}`);
        setGameEndMessage(endMsg);
        setShowCheckmateModal(true); 
      }
    });    

    newSocketInstance.on("move_error", (errorData: MoveErrorData) => {
      alert(`Error: ${errorData.message}`);
    });

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        if (visualUpdateTimeoutRef.current) {
          console.log("SPACEBAR: Clearing pending visual update timeout.");
          clearTimeout(visualUpdateTimeoutRef.current);
          visualUpdateTimeoutRef.current = null;
        }
        setActiveBoard(prev => {
          const nextBoard = prev === "main" ? "secondary" : "main";
          console.log(`SPACEBAR: Toggling activeBoard from ${prev} to ${nextBoard}`);
          return nextBoard;
        });
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usernameFromProps, roomFromProps, gameFinished]);

  const resetBoard = async () => {
    console.log("FRONTEND: Resetting board for room:", roomFromProps);
    if (socket) {
      socket.emit("reset", { room: roomFromProps });
    } else {
      console.warn("FRONTEND: Reset called but socket is null.");
    }
    setShowCheckmateModal(false);
    setGameEndMessage("");
  };

  const setupDebugScenario = async (scenarioName: string) => {
    if (!socket || !roomFromProps) {
      console.error("FRONTEND: Cannot setup debug scenario, socket or room is missing.");
      alert("Socket or room not available. Cannot setup debug scenario.");
      return;
    }
    console.log(`FRONTEND: Requesting debug scenario: ${scenarioName} for room: ${roomFromProps}`);
    const backendUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5001"; // Default for local dev
    try {
      const response = await fetch(`${backendUrl}/api/debug/setup/${scenarioName}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ room: roomFromProps }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json();
        console.error("FRONTEND: Error setting up debug scenario:", errorData.message);
        alert(`Error setting up scenario: ${errorData.message}`);
      } else {
        console.log(`FRONTEND: Debug scenario ${scenarioName} request successful.`);
        // Backend will emit game_update, no need to manually set state here
      }
    } catch (error) {
      console.error("FRONTEND: Network or other error setting up debug scenario:", error);
      alert("Failed to request debug scenario. Check console.");
    }
  };

  const handleSquareClick = (row: number, col: number, boardClicked: "main" | "secondary") => {
    console.log(`FRONTEND: handleSquareClick triggered. ClickedBoard: ${boardClicked} Current ServerActivePhase: ${serverActiveBoardPhase} Current PlayerTurn: ${turn} SelectedSquareBeforeClick: ${JSON.stringify(selectedPieceSquare)} GameFinished? ${gameFinished}`);

    const boardOutcome = boardClicked === "main" ? mainBoardOutcome : secondaryBoardOutcome;
    if (boardOutcome !== "active") {
      console.log(`FRONTEND CLICK IGNORED: Clicked on ${boardClicked} board which has outcome: ${boardOutcome}.`);
      return;
    }

    if (!socket || gameFinished) {
      console.log("FRONTEND: Click ignored. Socket null or game finished.", { socketExists: !!socket, gameFinished });
      return;
    }
  
    if (boardClicked !== activeBoard || boardClicked !== serverActiveBoardPhase) {
      console.log(`FRONTEND CLICK IGNORED: Clicked on ${boardClicked}. Visually active: ${activeBoard}. Logically active phase: ${serverActiveBoardPhase}.`);
      return;
    }
  
    const currentBoardState: ChessBoardType = serverActiveBoardPhase === "main" ? mainBoard : secondaryBoard;
    const pieceAtClickedSquare: ChessPieceType = currentBoardState[row][col];
    const pieceInfoAtClickedSquare: PieceInfo | null = getPieceInfo(pieceAtClickedSquare);

    if (selectedPieceSquare) {
      const { row: fromRow, col: fromCol } = selectedPieceSquare;
      const selectedPieceId = currentBoardState[fromRow][fromCol];

      if (possibleMoves.some(move => move.row === row && move.col === col)) {
        const targetPieceId = currentBoardState[row][col];

        if (socket && selectedPieceId) {
          const moveDetails = {
            from: [fromRow, fromCol],
            to: [row, col],
            piece: selectedPieceId,
            captured: targetPieceId || null,
          };
          console.log("FRONTEND: Emitting move", { room: roomFromProps, boardType: serverActiveBoardPhase, board: currentBoardState, move: moveDetails });
          socket.emit("move", {
            room: roomFromProps, 
            boardType: serverActiveBoardPhase,
            board: currentBoardState,
            move: moveDetails,
          });
        }
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
      } else if (pieceInfoAtClickedSquare && pieceInfoAtClickedSquare.color === turn) {
        const newPossibleMoves = getValidMoves(currentBoardState, pieceAtClickedSquare, row, col, turn);
        setSelectedPieceSquare({ row, col });
        setPossibleMoves(newPossibleMoves);
      } else {
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
      }
    } else if (pieceInfoAtClickedSquare) {
      if (pieceInfoAtClickedSquare.color === turn) {
        const validMovesArray = getValidMoves(currentBoardState, pieceAtClickedSquare, row, col, turn);
        setSelectedPieceSquare({ row, col });
        setPossibleMoves(validMovesArray);
        console.log("FRONTEND: Selected piece:", pieceAtClickedSquare, "at", {row, col}, "Possible moves:", validMovesArray);
      } else {
        console.log(`FRONTEND: Clicked opponent's piece (${pieceAtClickedSquare}) or invalid piece. Turn: ${turn}`);
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
      }
    } else {
      setSelectedPieceSquare(null);
      setPossibleMoves([]);
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
    if (boardType === serverActiveBoardPhase) {
       console.log(`FRONTEND RENDER getBoardState: Rendering ACTIVE boardType="${boardType}".`);
    }

    return boardData.map((rowItem, rowIndex) =>
      rowItem.map((piece, colIndex) => {
        const isBlackSquare = (rowIndex + colIndex) % 2 === 1;
        const isCurrentSelectedPieceSquare = selectedPieceSquare?.row === rowIndex && selectedPieceSquare?.col === colIndex && boardType === serverActiveBoardPhase;
        
        const currentBoardOutcome = boardType === "main" ? mainBoardOutcome : secondaryBoardOutcome;
        const isBoardResolved = currentBoardOutcome !== "active";
        // isDisabled is true if it's not the server's active phase for this board OR if the board itself is resolved.
        const isDisabled = (boardType !== serverActiveBoardPhase) || isBoardResolved;

        const isPossibleMoveTarget = possibleMoves.some(move => move.row === rowIndex && move.col === colIndex) && boardType === serverActiveBoardPhase && !isBoardResolved;

        let titleText = `${turn}'s turn on the ${serverActiveBoardPhase} board`;
        if (isBoardResolved) {
          titleText = `Board resolved: ${currentBoardOutcome.replace("_", " ")}`;
        } else if (boardType !== serverActiveBoardPhase) {
          titleText = `Waiting for ${turn} on the ${serverActiveBoardPhase} board`;
        } else if (gameFinished) {
          titleText = "Game Over";
        }

        return (
          <div
            key={`square-${boardType}-${rowIndex}-${colIndex}`}
            onClick={() => !isDisabled && handleSquareClick(rowIndex, colIndex, boardType)} // Prevent click if disabled
            className={`w-[50px] h-[50px] flex items-center justify-center relative transition-all duration-150 ease-in-out 
              ${isBlackSquare ? colors.dark : colors.light} 
              ${isCurrentSelectedPieceSquare ? "ring-2 ring-red-500 ring-inset" : ""}
              ${(isDisabled) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} 
              ${isBoardResolved ? "filter grayscale(70%) opacity-60" : ""} // Extra styling for resolved boards
              `}
            title={titleText}
          >
            {isPossibleMoveTarget && (
              <div className="absolute w-full h-full bg-green-400 opacity-40 rounded-sm pointer-events-none"></div>
            )}
            {isPossibleMoveTarget && !boardData[rowIndex][colIndex] && (
              <div className="absolute w-3 h-3 bg-green-700 opacity-50 rounded-full pointer-events-none"></div>
            )}
            {isPossibleMoveTarget && boardData[rowIndex][colIndex] && (
              <div className="absolute w-[80%] h-[80%] border-4 border-green-600 opacity-70 rounded-full pointer-events-none"></div>
            )}

            {piece && (
              <span
                className={`text-3xl font-bold leading-none z-10 ${
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
      <h3 className="text-xl font-semibold mb-1 text-indigo-700">
        {gameFinished ? `Game Over: ${winner || "Unknown Result"}` : `${turn}'s turn on the ${serverActiveBoardPhase} board`}
      </h3>
      {respondingToCheckBoard && (
        <p className="text-lg text-red-700 font-bold animate-pulse">
          {turn} must respond to check on the {respondingToCheckBoard} board!
        </p>
      )}
      {mainBoardOutcome !== "active" && <p className="text-sm text-red-600 font-semibold">Main Board: {mainBoardOutcome.replace("_"," ")}</p>}
      {secondaryBoardOutcome !== "active" && <p className="text-sm text-blue-600 font-semibold">Secondary Board: {secondaryBoardOutcome.replace("_"," ")}</p>}

      <div className="relative w-[400px] h-[400px] mt-2">
        <div
          className={`absolute inset-0 grid grid-cols-8 ${activeBoard === "main" ? "shadow-lg" : ""}`}
          style={{
            transform: activeBoard === "main" ? "none" : "translate(5px, 5px)",
            zIndex: activeBoard === "main" ? 2 : 1,
            opacity: activeBoard === "main" ? 1 : (mainBoardOutcome !== "active" ? 0.4 : 0.6),
            filter: activeBoard === "main" ? "none" : (mainBoardOutcome !== "active" ? "grayscale(90%)" : "grayscale(80%)"),
            transition: "transform 0.3s ease-in-out, opacity 0.3s ease-in-out, filter 0.3s ease-in-out, box-shadow 0.3s ease-in-out",
            boxShadow: activeBoard === "main" ? "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)" : "none",
          }}
        >
          {getBoardState(
            mainBoard,
            squareColors.main,
            "main"
          )}
          {mainBoardOutcome !== "active" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 pointer-events-none z-10">
              <span className="text-white text-2xl font-bold uppercase tracking-wider p-2 bg-gray-700 bg-opacity-70 rounded">{mainBoardOutcome.replace("_"," ")}</span>
            </div>
          )}
        </div>

        <div
          className={`absolute inset-0 grid grid-cols-8 ${activeBoard === "secondary" ? "shadow-lg" : ""}`}
          style={{
            transform: activeBoard === "secondary" ? "none" : "translate(5px, 5px)",
            zIndex: activeBoard === "secondary" ? 2 : 1,
            opacity: activeBoard === "secondary" ? 1 : (secondaryBoardOutcome !== "active" ? 0.4 : 0.6),
            filter: activeBoard === "secondary" ? "none" : (secondaryBoardOutcome !== "active" ? "grayscale(90%)" : "grayscale(80%)"),
            transition: "transform 0.3s ease-in-out, opacity 0.3s ease-in-out, filter 0.3s ease-in-out, box-shadow 0.3s ease-in-out",
            boxShadow: activeBoard === "secondary" ? "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)" : "none",
          }}
        >
          {getBoardState(
            secondaryBoard,
            squareColors.secondary,
            "secondary"
          )}
          {secondaryBoardOutcome !== "active" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 pointer-events-none z-10">
              <span className="text-white text-2xl font-bold uppercase tracking-wider p-2 bg-gray-700 bg-opacity-70 rounded">{secondaryBoardOutcome.replace("_"," ")}</span>
            </div>
          )}
        </div>
      </div>

      {showCheckmateModal && (
        <div className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg text-center z-60 max-w-md mx-auto">
            <h3 className="text-xl font-bold mb-4 text-gray-800">Game Over</h3>
            <p className="mb-6 text-lg text-gray-700">{gameEndMessage}</p>
            <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3 justify-center">
              <button
                onClick={() => resetBoard()} 
                className="px-6 py-3 bg-blue-500 text-white font-semibold rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition ease-in-out duration-150"
              >
                Play Again
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Debug Scenarios Section */}
      <div className="mt-6 p-4 border border-dashed border-red-400 rounded-md">
        <h4 className="text-lg font-semibold text-red-600 mb-3 text-center">Debug Scenarios</h4>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setupDebugScenario('main_white_checkmates_black')} className="px-3 py-1.5 bg-red-200 text-red-800 text-xs rounded hover:bg-red-300">Main: W mates B</button>
          <button onClick={() => setupDebugScenario('secondary_black_checkmates_white')} className="px-3 py-1.5 bg-red-200 text-red-800 text-xs rounded hover:bg-red-300">Sec: B mates W</button>
          <button onClick={() => setupDebugScenario('main_stalemate_black_to_move')} className="px-3 py-1.5 bg-yellow-200 text-yellow-800 text-xs rounded hover:bg-yellow-300">Main: Stalemate (B)</button>
          <button onClick={() => setupDebugScenario('secondary_stalemate_white_to_move')} className="px-3 py-1.5 bg-yellow-200 text-yellow-800 text-xs rounded hover:bg-yellow-300">Sec: Stalemate (W)</button>
          <button onClick={() => setupDebugScenario('main_black_in_check_black_to_move')} className="px-3 py-1.5 bg-orange-200 text-orange-800 text-xs rounded hover:bg-orange-300">Main: B in Check</button>
          <button onClick={() => setupDebugScenario('secondary_white_in_check_white_to_move')} className="px-3 py-1.5 bg-orange-200 text-orange-800 text-xs rounded hover:bg-orange-300">Sec: W in Check</button>
          <button onClick={() => setupDebugScenario('main_white_causes_check_setup')} className="px-3 py-1.5 bg-purple-200 text-purple-800 text-xs rounded hover:bg-purple-300">Main: W causes Check Setup</button>
        </div>
      </div>
    </div>
  );
};

export default Gameboard;
