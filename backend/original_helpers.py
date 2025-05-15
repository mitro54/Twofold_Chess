# Board setup and chess logic helpers extracted from app.py
import copy

def create_initial_board(is_white_bottom=True):
    """Create initial board with piece IDs matching the frontend."""
    board = [[None for _ in range(8)] for _ in range(8)]
    
    # Set up pawns with IDs P1-P8 and p1-p8
    for col in range(8):
        board[1][col] = f"p{col + 1}"  # Black pawns
        board[6][col] = f"P{col + 1}"  # White pawns
    
    # Set up other pieces with IDs matching frontend
    # Black pieces
    board[0][0] = "r1"  # Rook
    board[0][1] = "n1"  # Knight
    board[0][2] = "b1"  # Bishop
    board[0][3] = "q1"  # Queen
    board[0][4] = "k1"  # King
    board[0][5] = "b2"  # Bishop
    board[0][6] = "n2"  # Knight
    board[0][7] = "r2"  # Rook
    
    # White pieces
    board[7][0] = "R1"  # Rook
    board[7][1] = "N1"  # Knight
    board[7][2] = "B1"  # Bishop
    board[7][3] = "Q1"  # Queen
    board[7][4] = "K1"  # King
    board[7][5] = "B2"  # Bishop
    board[7][6] = "N2"  # Knight
    board[7][7] = "R2"  # Rook
    
    return board

def create_empty_board():
    return [[None for _ in range(8)] for _ in range(8)]

def get_piece_info(piece_char):
    if not piece_char:
        return None
    color = "White" if "A" <= piece_char[0] <= "Z" else "Black"
    type_char = piece_char[0].upper()
    piece_type = None
    if type_char == "P": piece_type = "Pawn"
    elif type_char == "N": piece_type = "Knight"
    elif type_char == "B": piece_type = "Bishop"
    elif type_char == "R": piece_type = "Rook"
    elif type_char == "Q": piece_type = "Queen"
    elif type_char == "K": piece_type = "King"
    return {"color": color, "type": piece_type, "id": piece_char}

def is_on_board(r, c):
    return 0 <= r < 8 and 0 <= c < 8

def _get_sliding_moves(board, r, c, player_color, directions):
    moves = []
    for dr, dc in directions:
        for i in range(1, 8):
            nr, nc = r + dr * i, c + dc * i
            if not is_on_board(nr, nc):
                break
            target_piece = board[nr][nc]
            if target_piece:
                target_info = get_piece_info(target_piece)
                if target_info["color"] != player_color:
                    moves.append((nr, nc)) # Can capture
                break # Blocked by own or opponent piece
            else:
                moves.append((nr, nc)) # Empty square
    return moves

def get_rook_moves_for_attack(board, r, c, player_color):
    return _get_sliding_moves(board, r, c, player_color, [(0, 1), (0, -1), (1, 0), (-1, 0)])

def get_bishop_moves_for_attack(board, r, c, player_color):
    return _get_sliding_moves(board, r, c, player_color, [(1, 1), (1, -1), (-1, 1), (-1, -1)])

def get_queen_moves_for_attack(board, r, c, player_color):
    return get_rook_moves_for_attack(board, r, c, player_color) + get_bishop_moves_for_attack(board, r, c, player_color)

def get_knight_moves_for_attack(board, r, c, player_color):
    moves = []
    knight_hops = [
        (2, 1), (2, -1), (-2, 1), (-2, -1),
        (1, 2), (1, -2), (-1, 2), (-1, -2)
    ]
    for dr, dc in knight_hops:
        nr, nc = r + dr, c + dc
        if is_on_board(nr, nc):
            target_piece = board[nr][nc]
            if not target_piece or get_piece_info(target_piece)["color"] != player_color:
                moves.append((nr, nc))
    return moves

def get_king_moves_for_attack(board, r, c, player_color):
    moves = []
    for dr in [-1, 0, 1]:
        for dc in [-1, 0, 1]:
            if dr == 0 and dc == 0:
                continue
            nr, nc = r + dr, c + dc
            if is_on_board(nr, nc):
                target_piece = board[nr][nc]
                if not target_piece or get_piece_info(target_piece)["color"] != player_color:
                    moves.append((nr, nc))
    return moves

def get_pawn_attacks(board, r, c, player_color):
    attacks = []
    direction = -1 if player_color == "White" else 1
    for dc in [-1, 1]:
        nr, nc = r + direction, c + dc
        if is_on_board(nr, nc):
            attacks.append((nr, nc))
    return attacks

def is_square_attacked(board, r, c, attacker_color):
    for i in range(8):
        for j in range(8):
            piece = board[i][j]
            if piece:
                info = get_piece_info(piece)
                if info["color"] == attacker_color:
                    potential_attacks = []
                    if info["type"] == "Pawn":
                        potential_attacks = get_pawn_attacks(board, i, j, attacker_color)
                    elif info["type"] == "Knight":
                        potential_attacks = get_knight_moves_for_attack(board, i, j, attacker_color)
                    elif info["type"] == "Rook":
                        potential_attacks = get_rook_moves_for_attack(board, i, j, attacker_color)
                    elif info["type"] == "Bishop":
                        potential_attacks = get_bishop_moves_for_attack(board, i, j, attacker_color)
                    elif info["type"] == "Queen":
                        potential_attacks = get_queen_moves_for_attack(board, i, j, attacker_color)
                    elif info["type"] == "King":
                        potential_attacks = get_king_moves_for_attack(board, i, j, attacker_color)
                    if (r, c) in potential_attacks:
                        return True
    return False

def find_king(board, king_color):
    king_char_prefix = "K" if king_color == "White" else "k"
    for r in range(8):
        for c in range(8):
            piece = board[r][c]
            if piece and piece[0] == king_char_prefix:
                return (r, c)
    return None

def is_king_in_check(board, king_color):
    king_pos = find_king(board, king_color)
    if not king_pos:
        return False
    opponent_color = "Black" if king_color == "White" else "White"
    return is_square_attacked(board, king_pos[0], king_pos[1], opponent_color)

def is_move_legal(board, from_r, from_c, to_r, to_c, player_color):
    piece_to_move = board[from_r][from_c]
    if not piece_to_move or get_piece_info(piece_to_move)["color"] != player_color:
        return False
    temp_board = copy.deepcopy(board)
    temp_board[to_r][to_c] = temp_board[from_r][from_c]
    temp_board[from_r][from_c] = None
    if is_king_in_check(temp_board, player_color):
        return False
    return True

def get_pseudo_legal_moves_for_piece(board, piece_char, r, c, player_color):
    moves = []
    info = get_piece_info(piece_char)
    if not info or info["color"] != player_color:
        return []
    if info["type"] == "Pawn":
        direction = -1 if player_color == "White" else 1
        if is_on_board(r + direction, c) and not board[r + direction][c]:
            moves.append((r + direction, c))
            start_row = 6 if player_color == "White" else 1
            if r == start_row and is_on_board(r + 2 * direction, c) and not board[r + 2 * direction][c]:
                moves.append((r + 2 * direction, c))
        for dc in [-1, 1]:
            nr, nc = r + direction, c + dc
            if is_on_board(nr, nc) and board[nr][nc] and get_piece_info(board[nr][nc])["color"] != player_color:
                moves.append((nr, nc))
    elif info["type"] == "Knight":
        moves = get_knight_moves_for_attack(board, r, c, player_color)
    elif info["type"] == "Rook":
        moves = get_rook_moves_for_attack(board, r, c, player_color)
    elif info["type"] == "Bishop":
        moves = get_bishop_moves_for_attack(board, r, c, player_color)
    elif info["type"] == "Queen":
        moves = get_queen_moves_for_attack(board, r, c, player_color)
    elif info["type"] == "King":
        moves = get_king_moves_for_attack(board, r, c, player_color)
    return moves

def has_any_legal_moves(board, player_color):
    for r in range(8):
        for c in range(8):
            piece = board[r][c]
            if piece:
                info = get_piece_info(piece)
                if info["color"] == player_color:
                    pseudo_legal = get_pseudo_legal_moves_for_piece(board, piece, r, c, player_color)
                    for nr, nc in pseudo_legal:
                        temp_board = copy.deepcopy(board)
                        temp_board[nr][nc] = temp_board[r][c]
                        temp_board[r][c] = None
                        if not is_king_in_check(temp_board, player_color):
                            return True
    return False

def is_checkmate(board, king_color):
    if not is_king_in_check(board, king_color):
        return False
    return not has_any_legal_moves(board, king_color)

def is_stalemate(board, king_color):
    if is_king_in_check(board, king_color):
        return False
    return not has_any_legal_moves(board, king_color)

def update_castling_rights(game_doc,
                           from_r, from_c, to_r, to_c,
                           moved_piece_id,
                           captured_piece_id=None):
    rights = game_doc.get("castling_rights",
                          {"White": {"K": True, "Q": True},
                           "Black": {"K": True, "Q": True}})
    moved_info    = get_piece_info(moved_piece_id)
    captured_info = get_piece_info(captured_piece_id) if captured_piece_id else None
    if moved_info["type"] == "King":
        rights[moved_info["color"]]["K"] = False
        rights[moved_info["color"]]["Q"] = False
    elif moved_info["type"] == "Rook":
        if moved_info["color"] == "White":
            if (from_r, from_c) == (7, 0): rights["White"]["Q"] = False
            if (from_r, from_c) == (7, 7): rights["White"]["K"] = False
        else:
            if (from_r, from_c) == (0, 0): rights["Black"]["Q"] = False
            if (from_r, from_c) == (0, 7): rights["Black"]["K"] = False
    if captured_info and captured_info["type"] == "Rook":
        if captured_info["color"] == "White":
            if (to_r, to_c) == (7, 0): rights["White"]["Q"] = False
            if (to_r, to_c) == (7, 7): rights["White"]["K"] = False
        else:
            if (to_r, to_c) == (0, 0): rights["Black"]["Q"] = False
            if (to_r, to_c) == (0, 7): rights["Black"]["K"] = False
    game_doc["castling_rights"] = rights 

def update_secondary_board(main_board, secondary_board, from_r, from_c, to_r, to_c, captured_piece_id):
    # If a piece was captured on the main board, remove the corresponding piece from the secondary board
    if captured_piece_id:
        print(f"[DEBUG] Captured piece ID: {captured_piece_id}")
        print(f"[DEBUG] Secondary board before removal: {secondary_board}")
        for r in range(8):
            for c in range(8):
                if secondary_board[r][c] == captured_piece_id:
                    secondary_board[r][c] = None
                    print(f"[DEBUG] Removed piece with ID {captured_piece_id} from secondaryBoard at (row={r}, col={c})")
                    break
        print(f"[DEBUG] Secondary board after removal: {secondary_board}")
    return secondary_board 