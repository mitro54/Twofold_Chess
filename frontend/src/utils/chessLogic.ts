export type Piece = string | null; // e.g., 'P1', 'r', null
export type Board = Piece[][];
export type Position = { row: number; col: number };
// export type Move = { from: Position; to: Position }; // Not used yet, but could be useful

/**
 * Represents a chess piece with its type and color.
 * Type is the uppercase letter (P, R, N, B, Q, K).
 * Color is 'White' or 'Black'.
 */
export interface PieceInfo {
  type: 'P' | 'R' | 'N' | 'B' | 'Q' | 'K';
  color: 'White' | 'Black';
  id: string; // The original piece string, e.g., "P1", "r"
}

/**
 * Gets detailed information about a piece.
 * @param piece The piece string (e.g., "P1", "r", "K") or null.
 * @returns PieceInfo object or null if the piece string is invalid or null.
 */
export function getPieceInfo(piece: Piece): PieceInfo | null {
  if (!piece) return null;
  const letter = piece.charAt(0).toUpperCase();
  const color = piece.charAt(0) === letter ? 'White' : 'Black';

  if (!['P', 'R', 'N', 'B', 'Q', 'K'].includes(letter)) {
    // console.warn(\`Invalid piece type for: \${piece}\`); // Could enable for debugging
    return null;
  }

  return {
    type: letter as 'P' | 'R' | 'N' | 'B' | 'Q' | 'K',
    color: color,
    id: piece
  };
}


/**
 * Checks if a square is on the board (0-7 for row and col).
 */
function isOnBoard(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

/**
 * Calculates all valid moves for a given piece on the board.
 * This version generates fully legal moves by checking for self-check.
 */
export function getValidMoves(
  board: Board,
  pieceId: Piece, // The specific piece, e.g., 'P1' or 'k'
  fromRow: number,
  fromCol: number,
  playerTurn: 'White' | 'Black',
  // lastMove?: Move // Will be needed for en passant
): Position[] {
  const pieceInfo = getPieceInfo(pieceId);
  if (!pieceInfo || pieceInfo.color !== playerTurn) {
    return []; // Not a valid piece or not the player's turn for this piece
  }

  let pseudoLegalMoves: Position[] = [];

  switch (pieceInfo.type) {
    case 'P':
      pseudoLegalMoves = getPawnMoves(board, pieceInfo, fromRow, fromCol);
      break;
    case 'N':
      pseudoLegalMoves = getKnightMoves(board, pieceInfo, fromRow, fromCol);
      break;
    case 'R':
      pseudoLegalMoves = getRookMoves(board, pieceInfo, fromRow, fromCol);
      break;
    case 'B':
      pseudoLegalMoves = getBishopMoves(board, pieceInfo, fromRow, fromCol);
      break;
    case 'Q':
      pseudoLegalMoves = getQueenMoves(board, pieceInfo, fromRow, fromCol);
      break;
    case 'K':
      // For King moves, we will handle check prevention differently inside getKingMoves
      // to correctly implement castling, which has its own check-related rules.
      // For now, getKingMoves returns moves that don't land on friendly pieces.
      // The self-check filter below will still apply.
      pseudoLegalMoves = getKingMoves(board, pieceInfo, fromRow, fromCol);
      break;
    default:
      return [];
  }

  const legalMoves: Position[] = [];
  for (const move of pseudoLegalMoves) {
    // Create a hypothetical board state after the move
    const tempBoard: Board = board.map(row => [...row]); // Deep copy
    tempBoard[move.row][move.col] = pieceId; // Move the piece
    tempBoard[fromRow][fromCol] = null;      // Clear the original square

    // Check if this move puts the current player's king in check
    if (!isKingInCheck(tempBoard, playerTurn)) {
      legalMoves.push(move);
    }
  }
  
  // Special handling for King to integrate castling and its specific check rules later
  // For now, the above filter is good for non-castling king moves.
  // If pieceInfo.type === 'K', we might re-evaluate or add castling moves here
  // after ensuring they also pass all check conditions.

  return legalMoves;
}

function getPawnMoves(
  board: Board,
  pawnInfo: PieceInfo,
  row: number,
  col: number,
  // lastMove?: Move
): Position[] {
  const moves: Position[] = [];
  const direction = pawnInfo.color === 'White' ? -1 : 1; // White moves up (row index decreases), Black moves down

  // 1. Move one square forward
  const oneStepRow = row + direction;
  if (isOnBoard(oneStepRow, col) && !board[oneStepRow][col]) {
    // TODO: Handle promotion when oneStepRow is 0 (for White) or 7 (for Black)
    moves.push({ row: oneStepRow, col });

    // 2. Move two squares forward (only from starting position)
    const startingRow = pawnInfo.color === 'White' ? 6 : 1;
    if (row === startingRow) {
      const twoStepsRow = row + 2 * direction;
      if (isOnBoard(twoStepsRow, col) && !board[twoStepsRow][col]) {
        // No promotion check here as it's a two-step move from start
        moves.push({ row: twoStepsRow, col });
      }
    }
  }

  // 3. Captures
  const captureOffsets = [-1, 1]; // columns to the left and right
  for (const offset of captureOffsets) {
    const captureRow = row + direction;
    const captureCol = col + offset;
    if (isOnBoard(captureRow, captureCol)) {
      const targetPieceId = board[captureRow][captureCol];
      if (targetPieceId) {
        const targetPieceInfo = getPieceInfo(targetPieceId);
        if (targetPieceInfo && targetPieceInfo.color !== pawnInfo.color) {
          // TODO: Handle promotion on capture
          moves.push({ row: captureRow, col: captureCol });
        }
      }
      // TODO: En passant:
      // Check if lastMove was a two-square pawn advance to [row, captureCol]
      // and if the pawn that made that move is adjacent to current pawn at [row, captureCol]
    }
  }
  return moves;
}

function getKnightMoves(
  board: Board,
  knightInfo: PieceInfo,
  row: number,
  col: number
): Position[] {
  const moves: Position[] = [];
  const knightMoveOffsets: [number, number][] = [
    [1, 2], [1, -2], [-1, 2], [-1, -2],
    [2, 1], [2, -1], [-2, 1], [-2, -1],
  ];

  for (const [dr, dc] of knightMoveOffsets) {
    const newRow = row + dr;
    const newCol = col + dc;
    if (isOnBoard(newRow, newCol)) {
      const targetPieceId = board[newRow][newCol];
      if (targetPieceId) {
        const targetPieceInfo = getPieceInfo(targetPieceId);
        if (targetPieceInfo && targetPieceInfo.color !== knightInfo.color) {
          moves.push({ row: newRow, col: newCol }); // Capture
        }
        // Else, it's a friendly piece, cannot move there
      } else {
        moves.push({ row: newRow, col: newCol }); // Empty square
      }
    }
  }
  return moves;
}

// --- Stubs for other pieces ---

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getRookMoves(board: Board, pieceInfo: PieceInfo, row: number, col: number): Position[] {
  const moves: Position[] = [];
  const directions: [number, number][] = [
    [0, 1], // Right
    [0, -1], // Left
    [1, 0], // Down
    [-1, 0], // Up
  ];

  for (const [dr, dc] of directions) {
    for (let i = 1; i < 8; i++) {
      const newRow = row + dr * i;
      const newCol = col + dc * i;

      if (!isOnBoard(newRow, newCol)) {
        break; // Off board
      }

      const targetPieceId = board[newRow][newCol];
      if (targetPieceId) {
        const targetPieceInfo = getPieceInfo(targetPieceId);
        if (targetPieceInfo && targetPieceInfo.color !== pieceInfo.color) {
          moves.push({ row: newRow, col: newCol }); // Capture enemy piece
        }
        // Friendly piece or invalid piece info, path is blocked
        break;
      } else {
        moves.push({ row: newRow, col: newCol }); // Empty square
      }
    }
  }
  return moves;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getBishopMoves(board: Board, pieceInfo: PieceInfo, row: number, col: number): Position[] {
  const moves: Position[] = [];
  const directions: [number, number][] = [
    [1, 1],   // Down-Right
    [1, -1],  // Down-Left
    [-1, 1],  // Up-Right
    [-1, -1], // Up-Left
  ];

  for (const [dr, dc] of directions) {
    for (let i = 1; i < 8; i++) {
      const newRow = row + dr * i;
      const newCol = col + dc * i;

      if (!isOnBoard(newRow, newCol)) {
        break; // Off board
      }

      const targetPieceId = board[newRow][newCol];
      if (targetPieceId) {
        const targetPieceInfo = getPieceInfo(targetPieceId);
        if (targetPieceInfo && targetPieceInfo.color !== pieceInfo.color) {
          moves.push({ row: newRow, col: newCol }); // Capture enemy piece
        }
        // Friendly piece or invalid piece info, path is blocked
        break;
      } else {
        moves.push({ row: newRow, col: newCol }); // Empty square
      }
    }
  }
  return moves;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getQueenMoves(board: Board, pieceInfo: PieceInfo, row: number, col: number): Position[] {
  // Queen moves are a combination of Rook and Bishop moves
  const rookMoves = getRookMoves(board, pieceInfo, row, col);
  const bishopMoves = getBishopMoves(board, pieceInfo, row, col);
  return [...rookMoves, ...bishopMoves];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getKingMoves(board: Board, pieceInfo: PieceInfo, row: number, col: number): Position[] {
  const moves: Position[] = [];
  const kingMoveOffsets: [number, number][] = [
    [0, 1],  // Right
    [0, -1], // Left
    [1, 0],  // Down
    [-1, 0], // Up
    [1, 1],  // Down-Right
    [1, -1], // Down-Left
    [-1, 1], // Up-Right
    [-1, -1] // Up-Left
  ];

  for (const [dr, dc] of kingMoveOffsets) {
    const newRow = row + dr;
    const newCol = col + dc;

    if (isOnBoard(newRow, newCol)) {
      const targetPieceId = board[newRow][newCol];
      if (targetPieceId) {
        const targetPieceInfo = getPieceInfo(targetPieceId);
        if (targetPieceInfo && targetPieceInfo.color !== pieceInfo.color) {
          moves.push({ row: newRow, col: newCol }); // Capture enemy piece
        }
        // Friendly piece or invalid piece info, cannot move there
      } else {
        moves.push({ row: newRow, col: newCol }); // Empty square
      }
    }
  }
  // TODO: Implement Castling (will require tracking if King/Rooks have moved and check status)
  // TODO: Ensure King does not move into check (will be handled by a higher-level filter or isSquareAttacked)
  return moves;
}

// --- Advanced Logic (to be integrated later) ---

/**
 * Checks if a given square is attacked by any piece of the specified attacker's color.
 * This function considers the raw attack patterns of pieces, not whether 
 * moving an attacking piece would put its own king in check.
 */
function isSquareAttacked(board: Board, targetRow: number, targetCol: number, attackerColor: 'White' | 'Black'): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const pieceId = board[r][c];
      if (!pieceId) continue;

      const pieceInfo = getPieceInfo(pieceId);
      if (pieceInfo && pieceInfo.color === attackerColor) {
        // Get potential moves for this attacking piece
        // Note: For pawn attacks, getPawnMoves needs to correctly identify only its capture squares.
        // For other pieces, their standard move generation covers their attack squares.
        let pseudoLegalMoves: Position[] = [];
        switch (pieceInfo.type) {
          case 'P':
            // Pawn attacks are special: only diagonal forward squares
            const pawnDirection = pieceInfo.color === 'White' ? -1 : 1;
            const pawnAttackOffsets = [-1, 1];
            for (const offset of pawnAttackOffsets) {
              const attackRow = r + pawnDirection;
              const attackCol = c + offset;
              if (isOnBoard(attackRow, attackCol)) {
                // We don't care if the target square is empty or occupied for an attack check,
                // just if the pawn *could* move there in a capture.
                pseudoLegalMoves.push({ row: attackRow, col: attackCol });
              }
            }
            break;
          case 'N':
            pseudoLegalMoves = getKnightMoves(board, pieceInfo, r, c);
            break;
          case 'R':
            pseudoLegalMoves = getRookMoves(board, pieceInfo, r, c);
            break;
          case 'B':
            pseudoLegalMoves = getBishopMoves(board, pieceInfo, r, c);
            break;
          case 'Q':
            pseudoLegalMoves = getQueenMoves(board, pieceInfo, r, c);
            break;
          case 'K':
            pseudoLegalMoves = getKingMoves(board, pieceInfo, r, c); // King can attack adjacent squares
            break;
        }

        for (const move of pseudoLegalMoves) {
          if (move.row === targetRow && move.col === targetCol) {
            return true; // Square is attacked
          }
        }
      }
    }
  }
  return false; // Square is not attacked
}

function isKingInCheck(board: Board, kingColor: 'White' | 'Black'): boolean {
  let kingRow = -1;
  let kingCol = -1;

  // Find the king's position
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const pieceId = board[r][c];
      if (pieceId) {
        const pieceInfo = getPieceInfo(pieceId);
        if (pieceInfo && pieceInfo.type === 'K' && pieceInfo.color === kingColor) {
          kingRow = r;
          kingCol = c;
          break;
        }
      }
    }
    if (kingRow !== -1) break; // King found
  }

  if (kingRow === -1) {
    // This should ideally not happen in a valid game state
    // console.error(`King of color ${kingColor} not found on the board.`);
    return false; // Or throw an error, depending on desired strictness
  }

  const attackerColor = kingColor === 'White' ? 'Black' : 'White';
  return isSquareAttacked(board, kingRow, kingCol, attackerColor);
}

export function isCheckmate(board: Board, kingColor: 'White' | 'Black'): boolean {
  if (!isKingInCheck(board, kingColor)) {
    return false; // Not in check, so cannot be checkmate
  }

  // Check if there are any legal moves for the player in check
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const pieceId = board[r][c];
      if (pieceId) {
        const pieceInfo = getPieceInfo(pieceId);
        if (pieceInfo && pieceInfo.color === kingColor) {
          const legalMoves = getValidMoves(board, pieceId, r, c, kingColor);
          if (legalMoves.length > 0) {
            return false; // Found a legal move, so not checkmate
          }
        }
      }
    }
  }
  return true; // In check and no legal moves available
}

export function isStalemate(board: Board, kingColor: 'White' | 'Black'): boolean {
  if (isKingInCheck(board, kingColor)) {
    return false; // In check, so cannot be stalemate
  }

  // Check if there are any legal moves for the player whose turn it is
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const pieceId = board[r][c];
      if (pieceId) {
        const pieceInfo = getPieceInfo(pieceId);
        if (pieceInfo && pieceInfo.color === kingColor) {
          const legalMoves = getValidMoves(board, pieceId, r, c, kingColor);
          if (legalMoves.length > 0) {
            return false; // Found a legal move, so not stalemate
          }
        }
      }
    }
  }
  return true; // Not in check, but no legal moves available
} 