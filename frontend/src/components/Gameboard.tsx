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
  isCheckmate,
  isStalemate,
  // isKingInCheck // Removed as it's not actively used yet for UI display
} from "../utils/chessLogic";

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
  const [winner, setWinner] = useState<"White" | "Black" | null>(null);
  const [checkmateBoard, setCheckmateBoard] = useState<"main" | "secondary" | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const visualUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Function to automatically save the game when it ends
  const handleAutoSaveGameEnd = async (currentWinner: "White" | "Black" | null, endedOnBoard: "main" | "secondary", currentMoves: string[]) => {
    const gameRoom = roomFromProps || "local_game_room"; // Ensure consistent room ID
    const payload = {
      room: gameRoom,
      winner: currentWinner,
      board: endedOnBoard, 
      moves: currentMoves,
      status: "completed"
    };
    console.log("FRONTEND: Attempting to automatically save game to history:", JSON.parse(JSON.stringify(payload)));

    const backendBaseUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:5001";
    const cleanBackendBaseUrl = backendBaseUrl.replace(/\/$/, '');

    try {
      const response = await fetch(`${cleanBackendBaseUrl}/api/games`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("FRONTEND ERROR: API auto save_game failed.", { status: response.status, error: errorText, payload });
        // alert(`Failed to auto-save game: ${errorText}`); // Optional: alert user
      } else {
        console.log("FRONTEND: Game auto-saved successfully.", { payload });
      }
    } catch (error) {
      console.error("FRONTEND ERROR: Error calling API for auto save_game:", { error, payload });
      // alert(`Error auto-saving game: ${error}`); // Optional: alert user
    }
  };

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
  }, [serverActiveBoardPhase, turn, activeBoard]);

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
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
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
      setSelectedPieceSquare(null);
      setPossibleMoves([]);
      setGameFinished(false);       // Ensure game is not finished
      setShowFinishModal(false);    // Close finish modal if open
      setWinner(null);              // Clear any winner
      setCheckmateBoard(null);      // Clear any checkmate board status
    });
  
    newSocketInstance.on("game_update", async (data: GameStateData) => {
      if (!data || !data.mainBoard || !data.secondaryBoard) {
        console.error("FRONTEND ERROR: Invalid game_update data received:", data);
        return;
      }
      console.log("FRONTEND: game_update received:", JSON.parse(JSON.stringify(data)));
    
      const newMainBoard = data.mainBoard;
      const newSecondaryBoard = data.secondaryBoard;
      const newTurn = data.turn || "White";
      const newActivePhase = data.active_board_phase || "main";
      const newMoves = data.moves || [];

      setMainBoard(newMainBoard);
      setSecondaryBoard(newSecondaryBoard);
      setTurn(newTurn);
      setServerActiveBoardPhase(newActivePhase);
      setMoveHistory(newMoves);
      setSelectedPieceSquare(null);
      setPossibleMoves([]);

      if (!gameFinished) {
        const boardToCheck = newActivePhase === "main" ? newMainBoard : newSecondaryBoard;
        const opponent = newTurn === "White" ? "Black" : "White";

        let gameHasEnded = false;
        let endMessage = "";
        let determinedWinner: "White" | "Black" | null = null;

        if (isCheckmate(boardToCheck, newTurn)) {
          determinedWinner = opponent;
          endMessage = `Checkmate! ${opponent} wins on the ${newActivePhase} board.`;
          gameHasEnded = true;
        } else if (isStalemate(boardToCheck, newTurn)) {
          determinedWinner = null; // Draw
          endMessage = `Stalemate on the ${newActivePhase} board. The game is a draw.`;
          gameHasEnded = true;
        }

        if (gameHasEnded) {
          console.log(`FRONTEND: Game ended. Message: ${endMessage}`);
          // Attempt to auto-save before showing modal
          await handleAutoSaveGameEnd(determinedWinner, newActivePhase, newMoves);

          setGameEndMessage(endMessage);
          setWinner(determinedWinner);
          setCheckmateBoard(newActivePhase);
          setGameFinished(true);
          setShowCheckmateModal(true); 
        }
      }
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
    // The server's "game_reset" or "game_state" event should reset other game states like
    // gameFinished, winner, checkmateBoard, mainBoard, secondaryBoard, turn, etc.
    // No need to call the /api/reset fetch here if socket.emit("reset") triggers a server-side reset
    // that then emits game_reset to all clients. The existing API call might be redundant
    // if the socket 'reset' event already correctly resets state via a game_reset emission.
  };

  const handleSquareClick = (row: number, col: number, boardClicked: "main" | "secondary") => {
    console.log(`FRONTEND: handleSquareClick triggered. ClickedBoard: ${boardClicked} Current ServerActivePhase: ${serverActiveBoardPhase} Current PlayerTurn: ${turn} SelectedSquareBeforeClick: ${JSON.stringify(selectedPieceSquare)} GameFinished? ${gameFinished}`);

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

        // let moveDescription = `${selectedPieceId} moved from ${String.fromCharCode(97 + fromCol)}${8 - fromRow} to ${String.fromCharCode(97 + col)}${8 - row} on ${serverActiveBoardPhase} board`;
        // if (targetPieceId) {
        //   moveDescription = `${selectedPieceId} captured ${targetPieceId} at ${String.fromCharCode(97 + col)}${8 - row} on ${serverActiveBoardPhase} board`;
        // }

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
        // This emits a finish_game event, backend then saves and emits game_reset
        socket.emit("finish_game", {
          room: gameRoom,
          winner,
          board: checkmateBoard, // The board where checkmate (manually decided) occurred
          moves: moveHistory,
        });
  
        setShowFinishModal(false); // Close the manual finish modal
        // setGameFinished(true); // Backend will send game_reset which handles this
        // resetBoard(); // Backend will send game_reset
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
    console.log(`FRONTEND RENDER getBoardState: Rendering for boardType="${boardType}". Current serverActiveBoardPhase="${serverActiveBoardPhase}". SelectedPieceSquare: ${JSON.stringify(selectedPieceSquare)}. PossibleMoves: ${possibleMoves.length}`);

    return boardData.map((row, rowIndex) =>
      row.map((piece, colIndex) => {
        const isBlackSquare = (rowIndex + colIndex) % 2 === 1;
        const isCurrentSelectedPieceSquare = selectedPieceSquare?.row === rowIndex && selectedPieceSquare?.col === colIndex && boardType === serverActiveBoardPhase;
        const isDisabled = boardType !== serverActiveBoardPhase;
        const isPossibleMoveTarget = possibleMoves.some(move => move.row === rowIndex && move.col === colIndex) && boardType === serverActiveBoardPhase;

        return (
          <div
            key={`square-${boardType}-${rowIndex}-${colIndex}`}
            onClick={() => handleSquareClick(rowIndex, colIndex, boardType)}
            className={`w-[50px] h-[50px] flex items-center justify-center relative transition-all duration-150 ease-in-out 
              ${isBlackSquare ? colors.dark : colors.light} 
              ${isCurrentSelectedPieceSquare ? "ring-2 ring-red-500 ring-inset" : ""}
              ${(isDisabled && boardType !== activeBoard) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"} 
              `}
            title={boardType !== activeBoard || boardType !== serverActiveBoardPhase ? `Waiting for ${turn} on the ${serverActiveBoardPhase} board` : `${turn}'s turn on the ${serverActiveBoardPhase} board`}
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
              {/* <button
                onClick={() => resetBoard()} // Or a different quit action
                className="px-6 py-3 bg-red-500 text-white font-semibold rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 transition ease-in-out duration-150"
              >
                Quit
              </button> */}
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
