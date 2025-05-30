// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import React, { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import environment from "../config/environment";
import {
  getValidMoves,
  getPieceInfo,
  Position,
  Piece as ChessPieceType,
  Board as ChessBoardType,
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
  en_passant_target?: [number, number] | null;
  castling_rights?: { White:{K:boolean;Q:boolean}; Black:{K:boolean;Q:boolean} };
  reset_votes?: Record<string, boolean>;
}

interface MoveErrorData {
  message: string;
  expectedBoard?: "main" | "secondary";
  actualBoard?: "main" | "secondary";
}

interface GameboardProps {
  room?: string | undefined;
  playerColor?: "White" | "Black" | null;
  socket: Socket | null;
}

const pieceSymbols: Record<string, string> = {
  P: "♙",
  p: "♙",
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


const Gameboard: React.FC<GameboardProps> = ({ 
  room: propsRoom,
  playerColor,
  socket
}) => {
  const roomFromProps = propsRoom ?? "local_game_room";

  // Use myColor for orientation and UI, set from socket events
  const [myColor, setMyColor] = useState<"White" | "Black" | null>(playerColor ?? null);
  const isPlayerBlack = myColor === "Black";
  const [mainBoard, setMainBoard] = useState<ChessBoardType>(() => createInitialBoard(!isPlayerBlack));
  const [secondaryBoard, setSecondaryBoard] = useState<ChessBoardType>(() => createInitialBoard(!isPlayerBlack));
  const [activeBoard, setActiveBoard] = useState<"main" | "secondary">("main");
  const [serverActiveBoardPhase, setServerActiveBoardPhase] = useState<"main" | "secondary">("main");
  const [selectedPieceSquare, setSelectedPieceSquare] = useState<Position | null>(null);
  const [possibleMoves, setPossibleMoves] = useState<Position[]>([]);
  const [turn, setTurn] = useState<"White" | "Black">("White");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [gameFinished, setGameFinished] = useState(false);
  const [showCheckmateModal, setShowCheckmateModal] = useState(false);
  const [gameEndMessage, setGameEndMessage] = useState("");
  const visualUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const boardSwapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [mainBoardOutcome, setMainBoardOutcome] = useState<string>("active");
  const [secondaryBoardOutcome, setSecondaryBoardOutcome] = useState<string>("active");
  const [respondingToCheckBoard, setRespondingToCheckBoard] = useState<"main" | "secondary" | null>(null);

  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Position;
    to: Position;
    piece: string;
    boardType: "main" | "secondary";
  } | null>(null);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [promotionChoices] = useState([
    { label: "Queen", value: "Q" },
    { label: "Rook", value: "R" },
    { label: "Bishop", value: "B" },
    { label: "Knight", value: "N" },
  ]);

  const [castlingCandidate, setCastlingCandidate] = useState<{
    kingPos: Position;
    rooks: { pos: Position; type: 'kingside' | 'queenside' }[];
    boardType: 'main' | 'secondary';
  } | null>(null);

  const [enPassantTarget, setEnPassantTarget] = useState<{
    main: [number, number] | null;
    secondary: [number, number] | null;
  }>({
    main: null,
    secondary: null
  });

  const [castlingRights,setCastlingRights] =
  useState<{ White:{K:boolean;Q:boolean}; Black:{K:boolean;Q:boolean} }|
           null>(null);

  const [showDebugMenu, setShowDebugMenu] = useState(false);
  const [lastTapTime, setLastTapTime] = useState<number>(0);
  const [lastTapPosition, setLastTapPosition] = useState<{ x: number; y: number } | null>(null);
  const DOUBLE_TAP_DELAY = 300; // milliseconds
  const DOUBLE_TAP_DISTANCE = 50; // pixels

  const [isManualBoardSwitch, setIsManualBoardSwitch] = useState(false);
  const manualSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{sender: string, message: string}>>([]);
  const [newMessage, setNewMessage] = useState("");
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [resetVotes, setResetVotes] = useState<Record<string, boolean>>({});

  // Helper to determine castling rights and eligible rooks for the selected king
  const getCastlingOptions = (
    board: ChessBoardType,
    kingRow: number,
    kingCol: number,
    player: 'White' | 'Black',
    rights: { K: boolean; Q: boolean } | null
  ): { pos: Position; type: 'kingside' | 'queenside' }[] => {
    // if the server hasn't sent rights yet, allow both sides for now
    if (!rights) rights = { K: true, Q: true };
  
    const opts: { pos: Position; type: 'kingside' | 'queenside' }[] = [];
    const homeRank = player === 'White' ? 7 : 0;
  
    // king must be on e-file of its home rank
    if (kingRow !== homeRank || kingCol !== 4) {
      console.log(`[CASTLING DEBUG] King not on home square: row=${kingRow}, col=${kingCol}, expected row=${homeRank}, col=4`);
      return opts;
    }
  
    // Print all relevant info for kingside
    console.log('[CASTLING DEBUG] Checking kingside:', {
      rightsK: rights.K,
      rook: board[homeRank][7],
      rookInfo: getPieceInfo(board[homeRank][7]),
      between5: board[homeRank][5],
      between6: board[homeRank][6],
    });
    // -------- kingside --------
    if (
      rights.K &&
      board[homeRank][7] &&
      ['Rook', 'R'].includes(getPieceInfo(board[homeRank][7])?.type) &&
      !board[homeRank][5] && !board[homeRank][6]
    ) {
      opts.push({ pos: { row: homeRank, col: 7 }, type: 'kingside' });
    }
  
    // Print all relevant info for queenside
    console.log('[CASTLING DEBUG] Checking queenside:', {
      rightsQ: rights.Q,
      rook: board[homeRank][0],
      rookInfo: getPieceInfo(board[homeRank][0]),
      between1: board[homeRank][1],
      between2: board[homeRank][2],
      between3: board[homeRank][3],
    });
    // -------- queenside -------
    if (
      rights.Q &&
      board[homeRank][0] &&
      ['Rook', 'R'].includes(getPieceInfo(board[homeRank][0])?.type) &&
      !board[homeRank][1] && !board[homeRank][2] && !board[homeRank][3]
    ) {
      opts.push({ pos: { row: homeRank, col: 0 }, type: 'queenside' });
    }
  
    console.log(`[CASTLING DEBUG] getCastlingOptions for ${player} at (${kingRow},${kingCol}) rights=`, rights, 'opts=', opts);
    return opts;
  };
  

  /** keep the visible board in sync with the phase sent by the server */
  useEffect(() => {
    if (activeBoard !== serverActiveBoardPhase) {
      // Only sync if there's no pending board swap and it's not a manual switch
      if (!boardSwapTimeoutRef.current && !isManualBoardSwitch) {
        console.log(
          `Syncing active board from ${activeBoard} to ${serverActiveBoardPhase}`
        );
      setActiveBoard(serverActiveBoardPhase);
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
      }
    }
  }, [serverActiveBoardPhase, activeBoard, isManualBoardSwitch]);

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
        if (boardSwapTimeoutRef.current) {
            clearTimeout(boardSwapTimeoutRef.current);
            boardSwapTimeoutRef.current = null;
        }
        setMoveHistory(data.moves || []);
        setGameFinished(data.game_over || false);
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
        setMainBoardOutcome(data.main_board_outcome || "active");
        setSecondaryBoardOutcome(data.secondary_board_outcome || "active");
        setShowCheckmateModal(false);
        setRespondingToCheckBoard(data.is_responding_to_check_on_board || null);
        setEnPassantTarget(data.en_passant_target ?? { main: null, secondary: null });
        setCastlingRights(
        data.castling_rights ?? { White: { K: true, Q: true },
        Black: { K: true, Q: true } }
        );

        // 🔄 wipe vote indicators after a successful reset
        setResetVotes({});
      });
    }
    return () => {
      if (socket) {
        socket.off("game_reset");
      }
    };
  }, [socket]);  

  /** keep myColour in sync with prop from MultiplayerSetup */
  useEffect(() => {
    if (playerColor) {
      setMyColor(playerColor);
      const isBlack = playerColor === "Black";
      // Create initial boards with correct orientation
      setMainBoard(createInitialBoard(!isBlack));
      setSecondaryBoard(createInitialBoard(!isBlack));
    }
  }, [playerColor]);

  // Add effect to handle game state updates
  useEffect(() => {
    if (!socket) return;

    const handleGameState = (data: GameStateData) => {
      console.log("Game state update received:", JSON.stringify(data, null, 2));
      if (data) {
        // Force React to recognize the state change by creating new arrays
        const newMainBoard = data.mainBoard.map(row => [...row]);
        const newSecondaryBoard = data.secondaryBoard.map(row => [...row]);
        
        console.log("Updating boards:", {
          mainBoard: newMainBoard,
          secondaryBoard: newSecondaryBoard,
          turn: data.turn,
          phase: data.active_board_phase,
          isManualSwitch: isManualBoardSwitch,
          isPlayerBlack
        });

        setMainBoard(newMainBoard);
        setSecondaryBoard(newSecondaryBoard);
        setTurn(data.turn);
        const currentPhase = data.active_board_phase || "main";
        setServerActiveBoardPhase(currentPhase);
        
        // Only update active board if it's different from current phase and not a manual switch
        if (activeBoard !== currentPhase && !isManualBoardSwitch) {
          // Clear any existing timeouts
          if (boardSwapTimeoutRef.current) {
            clearTimeout(boardSwapTimeoutRef.current);
          }
          
          // Set new timeout to swap boards after 0.8 seconds
          boardSwapTimeoutRef.current = setTimeout(() => {
            setActiveBoard(currentPhase);
            setSelectedPieceSquare(null);
            setPossibleMoves([]);
            boardSwapTimeoutRef.current = null; // Clear the ref after timeout
          }, 800);
        }
        
        setMoveHistory(data.moves || []);
        setGameFinished(data.game_over || false);
        setMainBoardOutcome(data.main_board_outcome || "active");
        setSecondaryBoardOutcome(data.secondary_board_outcome || "active");
        setRespondingToCheckBoard(data.is_responding_to_check_on_board || null);
        setEnPassantTarget(data.en_passant_target ?? { main: null, secondary: null });
        setCastlingRights(data.castling_rights ?? { White: { K: true, Q: true }, Black: { K: true, Q: true } });
      
        // keep local vote indicators in sync with server
        if (data.reset_votes) {
          setResetVotes(data.reset_votes);
        }
      
        // Clear selection after move
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
        setCastlingCandidate(null);
      }
    };

    // Listen for all game state updates
    socket.on("game_state", handleGameState);
    socket.on("game_update", handleGameState);
    socket.on("move_made", handleGameState);

    // Only request initial game state on mount
    socket.emit("get_game_state", { room: roomFromProps });

    return () => {
      socket.off("game_state", handleGameState);
      socket.off("game_update", handleGameState);
      socket.off("move_made", handleGameState);
      if (boardSwapTimeoutRef.current) {
        clearTimeout(boardSwapTimeoutRef.current);
      }
      if (manualSwitchTimeoutRef.current) {
        clearTimeout(manualSwitchTimeoutRef.current);
      }
    };
  }, [socket, roomFromProps, activeBoard, isManualBoardSwitch, isPlayerBlack]);

  /** show server-side move errors */
  useEffect(() => {
    if (!socket) return;
    const handleMoveError = (err: MoveErrorData) =>
      alert(`Error: ${err.message}`);
    socket.on("move_error", handleMoveError);
    return () => {
      socket.off("move_error", handleMoveError);
    };
  }, [socket]);

  // Add spacebar event listener
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Ignore spacebar if we're typing in chat
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.code === 'Space' && !showPromotionModal) {
        event.preventDefault();
        if (visualUpdateTimeoutRef.current) {
          clearTimeout(visualUpdateTimeoutRef.current);
          visualUpdateTimeoutRef.current = null;
        }
        if (boardSwapTimeoutRef.current) {
          clearTimeout(boardSwapTimeoutRef.current);
          boardSwapTimeoutRef.current = null;
        }
        if (manualSwitchTimeoutRef.current) {
          clearTimeout(manualSwitchTimeoutRef.current);
          manualSwitchTimeoutRef.current = null;
        }
        setIsManualBoardSwitch(true);
        setActiveBoard(prev => prev === "main" ? "secondary" : "main");
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
        // Reset manual switch flag after a longer delay
        manualSwitchTimeoutRef.current = setTimeout(() => {
          setIsManualBoardSwitch(false);
          manualSwitchTimeoutRef.current = null;
        }, 1000);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      if (manualSwitchTimeoutRef.current) {
        clearTimeout(manualSwitchTimeoutRef.current);
      }
    };
  }, [showPromotionModal]);

  // Add effect to handle board swapping after moves
  useEffect(() => {
    if (socket) {
      const handleMoveComplete = () => {
        // Only swap boards if we're not responding to check
        if (!respondingToCheckBoard) {
          // Clear any existing timeout
          if (boardSwapTimeoutRef.current) {
            clearTimeout(boardSwapTimeoutRef.current);
          }
          
          // Set new timeout to swap boards after 0.5 seconds
          boardSwapTimeoutRef.current = setTimeout(() => {
            setActiveBoard(prev => prev === "main" ? "secondary" : "main");
            setSelectedPieceSquare(null);
            setPossibleMoves([]);
          }, 500);
        }
      };

      socket.on("move_made", handleMoveComplete);
      socket.on("game_update", handleMoveComplete);

      return () => {
        socket.off("move_made", handleMoveComplete);
        socket.off("game_update", handleMoveComplete);
        if (boardSwapTimeoutRef.current) {
          clearTimeout(boardSwapTimeoutRef.current);
        }
      };
    }
  }, [socket, respondingToCheckBoard]);

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
    try {
      const response = await fetch(`${environment.apiUrl}/api/debug/setup/${scenarioName}`,
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

const handleSquareClick = (
  row: number,
  col: number,
  boardClicked: "main" | "secondary"
) => {
  // Block all input if promotion modal is open
  if (showPromotionModal) return;

  // Clear any existing board swap timeout
  if (boardSwapTimeoutRef.current) {
    clearTimeout(boardSwapTimeoutRef.current);
    boardSwapTimeoutRef.current = null;
  }

  /* ------------------------------------------------------------------ *
   *      EARLY OUTS – same as before (trimmed for brevity)             *
   * ------------------------------------------------------------------ */
  const boardOutcome =
    boardClicked === "main" ? mainBoardOutcome : secondaryBoardOutcome;
  
  // Add debug logging
  console.log("Move attempt:", {
    boardOutcome,
    socket: !!socket,
    gameFinished,
    boardClicked,
    activeBoard,
    serverActiveBoardPhase,
    turn,
    myColor,
    isPlayerBlack,
    currentMainBoard: mainBoard,
    currentSecondaryBoard: secondaryBoard
  });

  // Check if we're in multiplayer mode and it's not the player's turn
  const isMultiplayerMode = playerColor !== null;
  const isPlayerTurn = !isMultiplayerMode || turn === myColor;

  if (
    boardOutcome !== "active" ||
    !socket ||
    gameFinished ||
    boardClicked !== activeBoard ||
    boardClicked !== serverActiveBoardPhase ||
    !isPlayerTurn // Only check turn in multiplayer mode
  ) {
    console.log("Move blocked:", {
      boardOutcome,
      socket: !!socket,
      gameFinished,
      boardClicked,
      activeBoard,
      serverActiveBoardPhase,
      turn,
      myColor,
      isPlayerBlack,
      reason: !isPlayerTurn ? "Not your turn" :
              boardClicked !== activeBoard ? "Wrong active board" :
              boardClicked !== serverActiveBoardPhase ? "Wrong server phase" :
              "Other reason"
    });
    return;
  }

  const currentBoardState: ChessBoardType =
    serverActiveBoardPhase === "main" ? mainBoard : secondaryBoard;
  const pieceAtSquare: ChessPieceType = currentBoardState[row][col];
  const pieceInfo = getPieceInfo(pieceAtSquare);
  console.log(`[DEBUG] Square clicked: row=${row}, col=${col}, board=${boardClicked}, pieceAtSquare=`, pieceAtSquare, ', getPieceInfo=', pieceInfo);
  if (pieceInfo && pieceInfo.type === "King") {
    console.log(`[DEBUG] King clicked at row=${row}, col=${col}, piece=`, pieceAtSquare, pieceInfo);
  }

  /* ------------------------------------------------------------------ *
   *                 1) SECOND TAP –- try to make a move                *
   * ------------------------------------------------------------------ */
  if (selectedPieceSquare) {
    const { row: fromRow, col: fromCol } = selectedPieceSquare;
    const selectedPieceId = currentBoardState[fromRow][fromCol];

    /* ----------  a) CASTLING ---------------------------------------- */
    if (
      castlingCandidate &&
      castlingCandidate.kingPos.row === fromRow &&
      castlingCandidate.kingPos.col === fromCol
    ) {
      // recognise either the rook square *or* the king-destination square
      const match =
        castlingCandidate.rooks.find(
          r => r.pos.row === row && r.pos.col === col
        ) ||
        // user clicked the empty destination square (g or c file)
        (row === fromRow && (col === 6 || col === 2)
          ? { type: col === 6 ? "kingside" : "queenside" }
          : null);

      if (match && socket && selectedPieceId) {
        const kingTargetCol = match.type === "kingside" ? 6 : 2;
        socket.emit("move", {
          room: roomFromProps,
          boardType: serverActiveBoardPhase,
          board: currentBoardState,
          move: {
            from: [fromRow, fromCol],           // king start (e-file)
            to:   [fromRow, kingTargetCol],     // e1→g1  or  e1→c1
            piece: selectedPieceId,
            captured: null,
            castle: match.type,                 // "kingside" | "queenside"
          },
        });
        setCastlingCandidate(null);
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
        return;
      }
    }

    /* ----------  b) EN PASSANT  &  ORDINARY MOVES (unchanged) ------- */
    const targetId = currentBoardState[row][col];
    const isPawn =
      selectedPieceId && getPieceInfo(selectedPieceId)?.type === "P";
    const movingPieceColour = getPieceInfo(selectedPieceId)?.color as "White"|"Black";
    const lastRank = movingPieceColour === "White" ? row === 0 : row === 7;
    const isDiagonal =
      fromCol !== col &&
      Math.abs(fromCol - col) === 1 &&
      ((turn === "White" && row === fromRow - 1) ||
        (turn === "Black" && row === fromRow + 1));
    const isEnPassant =
      isPawn &&
      targetId === null &&
      isDiagonal &&
      enPassantTarget[serverActiveBoardPhase] &&
      row === enPassantTarget[serverActiveBoardPhase][0] &&
      col === enPassantTarget[serverActiveBoardPhase][1];

    // pawn promotion… (unchanged)
    if (isPawn && lastRank && possibleMoves.some((m) => m.row === row && m.col === col)) {
      setPendingPromotion({
        from: { row: fromRow, col: fromCol },
        to: { row, col },
        piece: selectedPieceId,
        boardType: boardClicked,
      });
      setShowPromotionModal(true);
      setSelectedPieceSquare(null);
      setPossibleMoves([]);
      return;
    }

    // en-passant
    if (isEnPassant) {
      socket.emit("move", {
        room: roomFromProps,
        boardType: serverActiveBoardPhase,
        board: currentBoardState,
        move: {
          from: [fromRow, fromCol],
          to: [row, col],
          piece: selectedPieceId,
          captured: null,
          en_passant: true,
        },
      });
      setSelectedPieceSquare(null);
      setPossibleMoves([]);
      return;
    }

    // ordinary capture / quiet move
    if (possibleMoves.some((m) => m.row === row && m.col === col)) {
      socket.emit("move", {
        room: roomFromProps,
        boardType: serverActiveBoardPhase,
        board: currentBoardState,
        move: {
          from: [fromRow, fromCol],
          to: [row, col],
          piece: selectedPieceId,
          captured: targetId || null,
        },
      });
    }
    setSelectedPieceSquare(null);
    setPossibleMoves([]);
    setCastlingCandidate(null);
    return;
  }

  /* ------------------------------------------------------------------ *
   *                 2) FIRST TAP –- select a piece                     *
   * ------------------------------------------------------------------ */
  if (pieceInfo && pieceInfo.color === turn) {
    // normal legal moves
    const basicMoves = getValidMoves(
      currentBoardState,
      pieceAtSquare,
      row,
      col,
      turn,
      enPassantTarget[serverActiveBoardPhase]
    );

    // ---- Castling availability (king only) ----
    let finalMoves = basicMoves;
    let newCandidate: typeof castlingCandidate = null;
    if (pieceInfo.type === "King" || pieceInfo.type === "K") {
      const castlingOpts = getCastlingOptions(
        currentBoardState,
        row,
        col,
        turn,
        castlingRights ? castlingRights[turn] : null
      );
      if (castlingOpts.length) {
        // highlight destination *and* rook squares
        const addSquares = [
          ...castlingOpts.map(o => ({ row, col: o.type === "kingside" ? 6 : 2 })),
          ...castlingOpts.map(o => o.pos),
        ];
        finalMoves = [...basicMoves, ...addSquares];
        newCandidate = {
          kingPos: { row, col },
          rooks: castlingOpts,
          boardType: boardClicked,
        };
      }
    }

    setSelectedPieceSquare({ row, col });
    setPossibleMoves(finalMoves);
    setCastlingCandidate(newCandidate);
    if (newCandidate) {
      console.log('[CASTLING DEBUG] setCastlingCandidate:', newCandidate);
    }
  } else {
    // clicked empty or enemy square – clear
    setSelectedPieceSquare(null);
    setPossibleMoves([]);
    setCastlingCandidate(null);
  }
};


  const handlePromotionChoice = (choice: string) => {
    if (!pendingPromotion || !socket) return;
    const { from, to, piece, boardType } = pendingPromotion;
    const moveDetails = {
      from: [from.row, from.col],
      to: [to.row, to.col],
      piece,
      captured: null,
      promotion: choice,
    };
    socket.emit("move", {
      room: roomFromProps,
      boardType,
      board: boardType === "main" ? mainBoard : secondaryBoard,
      move: moveDetails,
    });
    setPendingPromotion(null);
    setShowPromotionModal(false);
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
    // Fix: Flip board based on player color
    const displayRows = isPlayerBlack ? [...boardData].reverse() : boardData;
    return displayRows.map((rowItem, rowIndex) => {
      const actualRow = isPlayerBlack ? 7 - rowIndex : rowIndex;
      const displayCols = isPlayerBlack ? [...rowItem].reverse() : rowItem;
      return displayCols.map((piece, colIndex) => {
        const actualCol = isPlayerBlack ? 7 - colIndex : colIndex;
        const isBlackSquare = (actualRow + actualCol) % 2 === 1;
        const isCurrentSelectedPieceSquare = selectedPieceSquare?.row === actualRow && selectedPieceSquare?.col === actualCol && boardType === serverActiveBoardPhase;
        
        const currentBoardOutcome = boardType === "main" ? mainBoardOutcome : secondaryBoardOutcome;
        const isBoardResolved = currentBoardOutcome !== "active";
        const isDisabled = (boardType !== serverActiveBoardPhase) || isBoardResolved;

        const isPossibleMoveTarget =
          possibleMoves.some(
            (move) => move.row === actualRow && move.col === actualCol
        ) &&
        boardType === serverActiveBoardPhase &&
        !isBoardResolved;

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
            key={`square-${boardType}-${actualRow}-${actualCol}`}
            onClick={() => !isDisabled && handleSquareClick(actualRow, actualCol, boardType)}
            className={`aspect-square w-full h-full flex items-center justify-center relative transition-all duration-150 ease-in-out 
              ${isBlackSquare ? colors.dark : colors.light} 
              ${isCurrentSelectedPieceSquare ? "ring-2 ring-red-500 ring-inset" : ""}
              ${(isDisabled) ? "opacity-90 cursor-not-allowed" : "cursor-pointer"} 
              ${isBoardResolved ? "filter grayscale(70%) opacity-60" : ""}
              `}
            title={titleText}
          >
            {isPossibleMoveTarget && (
              <div className="absolute inset-0 bg-green-400 opacity-40 rounded-sm pointer-events-none"></div>
            )}
            {isPossibleMoveTarget && !boardData[actualRow][actualCol] && (
              <div className="absolute w-3 h-3 md:w-4 md:h-4 lg:w-5 lg:h-5 bg-green-700 opacity-50 rounded-full pointer-events-none"></div>
            )}
            {isPossibleMoveTarget && boardData[actualRow][actualCol] && (
              <div className="absolute inset-[10%] border-4 border-green-600 opacity-70 rounded-full pointer-events-none"></div>
            )}

            {piece && (
              <span
                className={`text-4xl md:text-5xl lg:text-6xl font-extrabold leading-none z-10 ${
                  piece.toUpperCase() === piece 
                    ? "text-white drop-shadow-[0_3px_3px_rgba(0,0,0,0.9)]" 
                    : "text-black drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]"
                }`}
              >
                {pieceSymbols[piece[0]]}
              </span>
            )}
          </div>
        );
      });
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;
    
    if (lastTapPosition && tapLength < DOUBLE_TAP_DELAY && tapLength > 0) {
      // Check if the second tap is close to the first tap
      const distance = Math.sqrt(
        Math.pow(touch.clientX - lastTapPosition.x, 2) +
        Math.pow(touch.clientY - lastTapPosition.y, 2)
      );
      
      if (distance < DOUBLE_TAP_DISTANCE) {
        // Double tap detected
        if (visualUpdateTimeoutRef.current) {
          clearTimeout(visualUpdateTimeoutRef.current);
          visualUpdateTimeoutRef.current = null;
        }
        if (boardSwapTimeoutRef.current) {
          clearTimeout(boardSwapTimeoutRef.current);
          boardSwapTimeoutRef.current = null;
        }
        if (manualSwitchTimeoutRef.current) {
          clearTimeout(manualSwitchTimeoutRef.current);
          manualSwitchTimeoutRef.current = null;
        }
        setIsManualBoardSwitch(true);
        setActiveBoard(prev => {
          const nextBoard = prev === "main" ? "secondary" : "main";
          console.log(`DOUBLE TAP: Toggling activeBoard from ${prev} to ${nextBoard}`);
          return nextBoard;
        });
        setSelectedPieceSquare(null);
        setPossibleMoves([]);
        // Reset manual switch flag after a longer delay
        manualSwitchTimeoutRef.current = setTimeout(() => {
          setIsManualBoardSwitch(false);
          manualSwitchTimeoutRef.current = null;
        }, 1000);
      }
    }
    
    setLastTapTime(currentTime);
    setLastTapPosition({ x: touch.clientX, y: touch.clientY });
  };

  // Scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Add chat message handler with unread message tracking
  useEffect(() => {
    if (socket) {
      socket.on("chat_message", (data: {sender: string, message: string}) => {
        setChatMessages(prev => [...prev, data]);
        if (!showChat) {
          setHasUnreadMessages(true);
        }
      });
    }
    return () => {
      if (socket) {
        socket.off("chat_message");
      }
    };
  }, [socket, showChat]);

  // Reset unread messages when chat is opened
  useEffect(() => {
    if (showChat) {
      setHasUnreadMessages(false);
    }
  }, [showChat]);

  const handleSendMessage = () => {
    if (newMessage.trim() && socket) {
      socket.emit("chat_message", {
        room: roomFromProps,
        message: newMessage,
        sender: myColor || "Anonymous"
      });
      setNewMessage("");
    }
  };

  useEffect(() => {
    if (!socket) return;

    const handleResetVotesUpdate = (data: { votes: Record<string, boolean> }) => {
      setResetVotes(data.votes);
    };

    socket.on("reset_votes_update", handleResetVotesUpdate);

    return () => {
      socket.off("reset_votes_update", handleResetVotesUpdate);
    };
  }, [socket]);

  const handleVoteReset = () => {
    if (!roomFromProps) return;
    
    if (socket) {
      if (playerColor) {
        // For multiplayer games, use vote-based reset
        socket.emit("vote_reset", { room: roomFromProps, color: myColor });
        // Optimistic local update
        setResetVotes(prev => ({ ...prev, [myColor]: true }));
      } else {
        // For local games, use direct reset
        resetBoard();
      }
    } else {
      // Fallback for when socket is not available
      resetBoard();
    }
  };

  return (
    <div className="flex flex-col items-center select-none">
      <div className="flex justify-between items-center w-full max-w-[600px] px-4 mb-2">
        <h2 className="text-2xl font-bold text-gray-600 break-all text-center">
          Room: {roomFromProps}
        </h2>
        {playerColor && (
          <div className="relative">
            <button
              onClick={() => setShowChat(true)}
              className="px-4 py-2 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-300 transform hover:scale-105 text-sm sm:text-base font-semibold shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)] flex items-center justify-center min-w-[100px] group"
            >
              <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent group-hover:from-indigo-300 group-hover:to-purple-300 transition-colors">
                Chat
              </span>
            </button>
            {hasUnreadMessages && (
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            )}
          </div>
        )}
      </div>
      <div className="relative h-6 mb-1 flex items-center justify-center px-4">
        {respondingToCheckBoard && (
          <p className="absolute text-sm md:text-lg text-red-700 font-bold animate-pulse whitespace-nowrap">
            {turn} must respond to check on the {respondingToCheckBoard} board!
          </p>
        )}
      </div>
      <div className="relative h-4 mb-1 flex items-center justify-center gap-2">
        {mainBoardOutcome !== "active" && (
          <p className="text-xs md:text-sm text-red-600 font-semibold whitespace-nowrap">
            Main Board: {mainBoardOutcome.replace("_"," ")}
          </p>
        )}
        {secondaryBoardOutcome !== "active" && (
          <p className="text-xs md:text-sm text-blue-600 font-semibold whitespace-nowrap">
            Secondary Board: {secondaryBoardOutcome.replace("_"," ")}
          </p>
        )}
      </div>
      <h3 className="text-lg md:text-xl font-semibold mb-1 text-gray-400">
        <span className="text-gray-400">It&apos;s </span>
        <span className={`${turn === "White" ? "text-white" : "text-black drop-shadow-[0_0_2px_rgba(255,255,255,0.5)]"}`}>
          {turn}
        </span>
        <span className="text-gray-400">&apos;s turn on the </span>
        <span className="text-gray-400">{serverActiveBoardPhase}</span>
        <span className="text-gray-400"> board</span>
      </h3>

      <div 
        className="relative w-[min(400px,90vw)] h-[min(400px,90vw)] md:w-[600px] md:h-[600px] touch-none"
        onTouchStart={handleTouchStart}
        style={{ touchAction: 'manipulation' }}
      >
        <div
          className={`absolute inset-0 grid grid-cols-8 ${activeBoard === "main" ? "shadow-lg" : ""}`}
          style={{
            transform: activeBoard === "main" ? "none" : "translate(10px, 10px)",
            zIndex: activeBoard === "main" ? 2 : 1,
            opacity: activeBoard === "main" ? 1 : (mainBoardOutcome !== "active" ? 0 : 1),
            filter: activeBoard === "main" ? "none" : (mainBoardOutcome !== "active" ? "grayscale(90%)" : "grayscale(50%)"),
            transition: "transform 0.3s ease-in-out, opacity 0.8s ease-in-out, filter 0.8s ease-in-out, box-shadow 0.3s ease-in-out",
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
            transform: activeBoard === "secondary" ? "none" : "translate(10px, 10px)",
            zIndex: activeBoard === "secondary" ? 2 : 1,
            opacity: activeBoard === "secondary" ? 1 : (secondaryBoardOutcome !== "active" ? 0.7 : 1),
            filter: activeBoard === "secondary" ? "none" : (secondaryBoardOutcome !== "active" ? "grayscale(90%)" : "grayscale(50%)"),
            transition: "transform 0.3s ease-in-out, opacity 0.8s ease-in-out, filter 0.8s ease-in-out, box-shadow 0.3s ease-in-out",
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

      {/* Mobile Board Switch Text */}
      <p className="md:hidden mt-4 text-gray-500 text-sm">
        Double tap the board to change view
      </p>

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

      <p className="text-lg text-gray-600 mt-2 hidden md:block">Press Spacebar to swap boards</p>
      <div className="flex flex-row gap-2 mt-2">
        <div className="flex items-center space-x-2">
          {socket && ( // Only show vote indicators for multiplayer games
            <div className="flex flex-col space-y-1">
              {(["White","Black"] as const).map(col => (
                <div
                  key={col}
                  className={`w-3 h-3 rounded-full ${resetVotes[col] ? "bg-blue-500" : "bg-gray-600"}`}
                />
              ))}
            </div>
          )}
          <button
            onClick={handleVoteReset}
            className="px-4 py-2 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-blue-500/30 hover:border-blue-400/50 transition-all duration-300 transform hover:scale-105 text-sm sm:text-base font-semibold shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] flex items-center justify-center min-w-[140px] sm:min-w-[180px] group"
          >
            <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent group-hover:from-blue-300 group-hover:to-cyan-300 transition-colors">
              Reset Both Boards
            </span>
          </button>
        </div>
        <button
          onClick={() => setShowDebugMenu(!showDebugMenu)}
          className="px-4 py-2 sm:px-6 sm:py-3 bg-gray-900/80 backdrop-blur-sm text-white rounded-lg border border-purple-500/30 hover:border-purple-400/50 transition-all duration-300 transform hover:scale-105 text-sm sm:text-base font-semibold shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)] flex items-center justify-center min-w-[140px] sm:min-w-[180px] group"
        >
          <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent group-hover:from-purple-300 group-hover:to-pink-300 transition-colors">
            Debug Menu
          </span>
        </button>
      </div>

      {/* Debug Scenarios Modal */}
      {showDebugMenu && (
        <div 
          className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowDebugMenu(false)}
        >
          <div 
            className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-2xl w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-xl font-semibold text-red-400">Debug Scenarios</h4>
              <button
                onClick={() => setShowDebugMenu(false)}
                className="text-gray-400 hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setupDebugScenario('main_white_checkmates_black'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-red-900 text-red-200 text-xs rounded hover:bg-red-800">Main: W mates B</button>
              <button onClick={() => { setupDebugScenario('secondary_black_checkmates_white'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-red-900 text-red-200 text-xs rounded hover:bg-red-800">Sec: B mates W</button>
              <button onClick={() => { setupDebugScenario('main_stalemate_black_to_move'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-yellow-900 text-yellow-200 text-xs rounded hover:bg-yellow-800">Main: Stalemate (B)</button>
              <button onClick={() => { setupDebugScenario('secondary_stalemate_white_to_move'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-yellow-900 text-yellow-200 text-xs rounded hover:bg-yellow-800">Sec: Stalemate (W)</button>
              <button onClick={() => { setupDebugScenario('main_black_in_check_black_to_move'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-orange-900 text-orange-200 text-xs rounded hover:bg-orange-800">Main: B in Check</button>
              <button onClick={() => { setupDebugScenario('secondary_white_in_check_white_to_move'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-orange-900 text-orange-200 text-xs rounded hover:bg-orange-800">Sec: W in Check</button>
              <button onClick={() => { setupDebugScenario('main_white_causes_check_setup'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-purple-900 text-purple-200 text-xs rounded hover:bg-purple-800">Main: W causes Check Setup</button>
              <button onClick={() => { setupDebugScenario('promotion_white_main'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-green-900 text-green-200 text-xs rounded hover:bg-green-800">Promotion: White (Main)</button>
              <button onClick={() => { setupDebugScenario('promotion_black_secondary'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-green-900 text-green-200 text-xs rounded hover:bg-green-800">Promotion: Black (Secondary)</button>
              <button onClick={() => { setupDebugScenario('castling_white_kingside_main'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-blue-900 text-blue-200 text-xs rounded hover:bg-blue-800">Castling: White Kingside (Main)</button>
              <button onClick={() => { setupDebugScenario('castling_black_queenside_secondary'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-blue-900 text-blue-200 text-xs rounded hover:bg-blue-800">Castling: Black Queenside (Secondary)</button>
              <button onClick={() => { setupDebugScenario('enpassant_white_main'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-pink-900 text-pink-200 text-xs rounded hover:bg-pink-800">En Passant: White (Main)</button>
              <button onClick={() => { setupDebugScenario('enpassant_black_secondary'); setShowDebugMenu(false); }} className="px-3 py-1.5 bg-pink-900 text-pink-200 text-xs rounded hover:bg-pink-800">En Passant: Black (Secondary)</button>
            </div>
            {/* --- DEBUG: Force Kingside Castling for White on Main Board --- */}
            <div className="mt-4 flex flex-col items-center">
              <button
                onClick={() => {
                  if (!socket) { alert('Socket not connected'); return; }
                  socket.emit("move", {
                    room: roomFromProps,
                    boardType: "main",
                    board: mainBoard,
                    move: {
                      from: [7, 4], // White king's starting position
                      to: [7, 6],   // White king's kingside castling destination
                      piece: mainBoard[7][4],
                      captured: null,
                      castle: "kingside"
                    }
                  });
                  setShowDebugMenu(false);
                }}
                className="px-4 py-2 bg-orange-900 text-orange-200 font-bold rounded hover:bg-orange-800 mt-2"
              >
                TEST: Force White Kingside Castle (Main Board)
              </button>
            </div>
          </div>
        </div>
      )}

      {showPromotionModal && (
        <div className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <div className="bg-white p-6 rounded-lg shadow-lg text-center z-[10000] max-w-md mx-auto">
            <h3 className="text-xl font-bold mb-4 text-gray-800">Promote Pawn</h3>
            <p className="mb-4 text-lg text-gray-700">Choose a piece:</p>
            <div className="flex justify-center gap-4 mb-6">
              {promotionChoices.map(choice => (
                <button
                  key={choice.value}
                  onClick={() => handlePromotionChoice(choice.value)}
                  className="px-4 py-2 bg-green-500 text-white font-semibold rounded hover:bg-green-600"
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setShowPromotionModal(false); setPendingPromotion(null); }}
              className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Castling Action Buttons (appear when king is selected and castling is available) */}
      {castlingCandidate && castlingCandidate.rooks.length > 0 && (
        <div className="flex gap-4 mb-2">
          {castlingCandidate.rooks.map((rookOpt) => (
            <button
              key={rookOpt.type}
              onClick={() => {
                const { kingPos } = castlingCandidate;
                if (!socket) { alert('Socket not connected'); return; }
                socket.emit("move", {
                  room: roomFromProps,
                  boardType: serverActiveBoardPhase,
                  board: serverActiveBoardPhase === "main" ? mainBoard : secondaryBoard,
                  move: {
                    from: [kingPos.row, kingPos.col],
                    to: [kingPos.row, rookOpt.type === 'kingside' ? 6 : 2],
                    piece: (serverActiveBoardPhase === "main" ? mainBoard : secondaryBoard)[kingPos.row][kingPos.col],
                    captured: null,
                    castle: rookOpt.type
                  }
                });
                setCastlingCandidate(null);
                setSelectedPieceSquare(null);
                setPossibleMoves([]);
              }}
              className={`px-4 py-2 rounded font-bold text-white ${rookOpt.type === 'kingside' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'}`}
            >
              Castle {rookOpt.type.charAt(0).toUpperCase() + rookOpt.type.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Chat Modal */}
      {showChat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg p-4 w-[90%] max-w-md border border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.3)]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-indigo-400">Game Chat</h3>
              <button
                onClick={() => setShowChat(false)}
                className="text-gray-400 hover:text-gray-200 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="h-64 overflow-y-auto mb-4 border border-indigo-500/30 rounded p-2 bg-gray-800/50">
              {chatMessages.map((msg, index) => (
                <div key={index} className="mb-2 text-left">
                  <span className={`font-bold ${msg.sender === myColor ? 'text-indigo-400' : 'text-gray-300'}`}>
                    {msg.sender === "White" ? "⚪ White" : "⚫ Black"}:
                  </span>
                  <span className="ml-2 text-gray-200">{msg.message}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 bg-gray-800 border border-indigo-500/30 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <button
                onClick={handleSendMessage}
                className="px-4 py-2 bg-gray-800 text-white rounded border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-300 transform hover:scale-105 font-semibold shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:shadow-[0_0_20px_rgba(99,102,241,0.5)]"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Gameboard;
