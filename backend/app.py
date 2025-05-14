######################### IMPORTS #########################



from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit
from pymongo import MongoClient
import os
from bson import ObjectId
import copy # Added for deepcopying board states in chess logic



######################### APPLICATION INITIALIZATION #########################



app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
app.config["SECRET_KEY"] = "lalalalala"
socketio = SocketIO(app, cors_allowed_origins="*")



######################### MONGODB SETUP #########################



mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/chess")
client = MongoClient(mongo_uri)
db = client.chess
games_collection = db.games



######################### BOARD SETUP #########################



def create_initial_board(is_white_bottom=True):
    empty_row = [None] * 8
    white_pieces = ["R", "N", "B", "Q", "K", "B", "N", "R"]
    black_pieces = [p.lower() for p in white_pieces]
    white_pawns = [f"P{i+1}" for i in range(8)]
    black_pawns = [f"p{i+1}" for i in range(8)]

    return [
        black_pieces if is_white_bottom else white_pieces,
        black_pawns if is_white_bottom else white_pawns,
        *[empty_row.copy() for _ in range(4)],
        white_pawns if is_white_bottom else black_pawns,
        white_pieces if is_white_bottom else black_pieces,
    ]

def create_empty_board():
    return [[None for _ in range(8)] for _ in range(8)]


######################### CHESS LOGIC HELPERS #########################

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
    # Only returns attack squares, not forward moves
    attacks = []
    direction = -1 if player_color == "White" else 1 # White moves from high to low index, Black low to high
    for dc in [-1, 1]:
        nr, nc = r + direction, c + dc
        if is_on_board(nr, nc):
            # For attack map, we don't care if it's an enemy piece, just that it's a valid attack square
            attacks.append((nr, nc))
    return attacks

def is_square_attacked(board, r, c, attacker_color):
    # Check attacks from all pieces of attacker_color
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
    return None # Should not happen in a valid game

def is_king_in_check(board, king_color):
    king_pos = find_king(board, king_color)
    if not king_pos:
        return False # Or raise error, king not found
    opponent_color = "Black" if king_color == "White" else "White"
    return is_square_attacked(board, king_pos[0], king_pos[1], opponent_color)


# Simplified version for backend: check if a SINGLE move is legal
def is_move_legal(board, from_r, from_c, to_r, to_c, player_color):
    piece_to_move = board[from_r][from_c]
    if not piece_to_move or get_piece_info(piece_to_move)["color"] != player_color:
        return False # Not player's piece or no piece

    # Create a temporary board to simulate the move
    temp_board = copy.deepcopy(board)
    temp_board[to_r][to_c] = temp_board[from_r][from_c]
    temp_board[from_r][from_c] = None

    # Check if this move puts the player's own king in check
    if is_king_in_check(temp_board, player_color):
        return False
    return True


# Generates all pseudo-legal moves for a piece (doesn't check for self-check)
def get_pseudo_legal_moves_for_piece(board, piece_char, r, c, player_color):
    moves = []
    info = get_piece_info(piece_char)
    if not info or info["color"] != player_color:
        return []

    if info["type"] == "Pawn":
        direction = -1 if player_color == "White" else 1
        # Forward one
        if is_on_board(r + direction, c) and not board[r + direction][c]:
            moves.append((r + direction, c))
            # Forward two (from starting row)
            start_row = 6 if player_color == "White" else 1
            if r == start_row and is_on_board(r + 2 * direction, c) and not board[r + 2 * direction][c]:
                moves.append((r + 2 * direction, c))
        # Captures
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
                            return True # Found at least one legal move
    return False

def is_checkmate(board, king_color):
    if not is_king_in_check(board, king_color):
        return False
    return not has_any_legal_moves(board, king_color)

def is_stalemate(board, king_color):
    if is_king_in_check(board, king_color):
        return False
    return not has_any_legal_moves(board, king_color)


######################### UTILITIES #########################


def serialize_game_state(game_state):
    if "_id" in game_state:
        game_state["_id"] = str(game_state["_id"])
    return game_state



######################### ROUTES #########################



# Route: Get all games data
@app.route("/api/games", methods=["GET"])
def get_all_games():
    games = list(games_collection.find({"status": "completed"}, {"_id": 0}))
    return jsonify(games), 200


# Route: Delete all games data, NOT FOR PRODUCTION
@app.route("/api/delete_all_games", methods=["POST"])
def delete_all_games():
    result = games_collection.delete_many({})

    if result.deleted_count > 0:
        return jsonify({"message": f"{result.deleted_count} games deleted successfully"}), 200
    else:
        return jsonify({"message": "No games found to delete"}), 404


# Route: Save game data
@app.route("/api/games", methods=["POST"])
def save_game():
    data = request.json
    print(f"Received data: {data}")
    required_fields = {"room", "winner", "board", "moves"}
    missing_fields = required_fields - data.keys()
    if missing_fields:
        return jsonify({"error": f"Missing fields: {', '.join(missing_fields)}"}), 400
    
    existing_game = games_collection.find_one({"room": data["room"], "winner": {"$exists": True}})
    if existing_game:
        return jsonify({"error": "Game already saved"}), 400

    db.games.insert_one(data)
    return jsonify({"message": "Game saved successfully!"}), 201


# Route: Reset game state
@app.route("/api/reset", methods=["POST"])
def reset_game():
    room = request.json.get("room")
    if not room:
        return jsonify({"error": "Room is required"}), 400

    initial_board = create_initial_board()
    game_state = {
        "mainBoard": initial_board,
        "secondaryBoard": initial_board,
        "turn": "White",
        "active_board_phase": "main",
        "moves": [],
        "winner": None,
        "status": "ongoing",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "is_responding_to_check_on_board": None,
    }
    
    games_collection.update_one(
        {"room": room}, {"$set": game_state}, upsert=True
    )

    socketio.emit("game_reset", game_state, room=room)
    return jsonify({"message": "Game reset successfully"})


# Route: Update game state
@app.route("/api/update", methods=["POST"])
def update_game():
    data = request.json
    room = data.get("room")
    board_type = data.get("boardType")
    board = data.get("board")
    move = data.get("move")

    if not room or not board_type or not board or not move:
        return jsonify({"error": "Invalid payload"}), 400

    update_field = {
        "mainBoard": board if board_type == "main" else None,
        "secondaryBoard": board if board_type == "secondary" else None,
    }
    update_field = {k: v for k, v in update_field.items() if v is not None}

    games_collection.update_one(
        {"room": room},
        {"$set": update_field, "$push": {"moves": move}},
    )

    game_state = games_collection.find_one({"room": room}, {"_id": 0})
    socketio.emit("game_update", game_state, room=room)

    return jsonify({"message": "Board updated successfully"})


# Route: Fetch game state
@app.route("/api/state", methods=["GET"])
def get_game_state():
    room = request.args.get("room")
    if not room:
        return jsonify({"error": "Room is required"}), 400

    game_state = games_collection.find_one({"room": room}, {"_id": 0})
    if not game_state:
        initial_board = create_initial_board()
        game_state = {
            "mainBoard": initial_board,
            "secondaryBoard": initial_board,
            "turn": "White",
            "active_board_phase": "main",
            "moves": [],
            "winner": None,
            "status": "ongoing",
            "main_board_outcome": "active",
            "secondary_board_outcome": "active",
            "game_over": False,
            "is_responding_to_check_on_board": None,
        }
        games_collection.insert_one({"room": room, **game_state})

    return jsonify(game_state)


######################### DEBUG SCENARIO SETUP ROUTES #########################

DEBUG_SCENARIOS = {
    "main_white_checkmates_black": {
        "mainBoard_func": lambda: (
            b := create_empty_board(),
            b[0].__setitem__(7, "k"), # Black King h8
            b[1].__setitem__(6, "Q"), # White Queen g7
            b[7].__setitem__(0, "K"), # White King a1
            b
        )[-1],
        "secondaryBoard_func": lambda: create_initial_board(),
        "turn": "Black", # Game is over, but was Black's turn to be checkmated
        "active_board_phase": "main",
        "main_board_outcome": "white_wins",
        "secondary_board_outcome": "active",
        "game_over": True,
        "winner": "White",
        "status": "White wins by checkmate on main board."
    },
    "secondary_black_checkmates_white": {
        "mainBoard_func": lambda: create_initial_board(),
        "secondaryBoard_func": lambda: (
            b := create_empty_board(),
            b[7].__setitem__(7, "K"), # White King h1
            b[6].__setitem__(6, "q"), # Black Queen g2
            b[0].__setitem__(0, "k"), # Black King a8
            b
        )[-1],
        "turn": "White",
        "active_board_phase": "secondary",
        "main_board_outcome": "active",
        "secondary_board_outcome": "black_wins",
        "game_over": True,
        "winner": "Black",
        "status": "Black wins by checkmate on secondary board."
    },
    "main_stalemate_black_to_move": {
        "mainBoard_func": lambda: (
            b := create_empty_board(),
            b[0].__setitem__(0, "k"), # Black King a8
            b[2].__setitem__(0, "K"), # White King a6 (b2[0] is row 2, col 0)
                                     # White Queen at c7 to control b8, b7, c8. (b[1][2] = 'Q')
            b[1].__setitem__(2, "Q"),
            b
        )[-1],
        "secondaryBoard_func": lambda: create_initial_board(),
        "turn": "Black",
        "active_board_phase": "main",
        "main_board_outcome": "active", # Will become stalemate after Black attempts to move
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "Setup for Stalemate on Main (Black to move)."
    },
    "secondary_stalemate_white_to_move": {
        "mainBoard_func": lambda: create_initial_board(),
        "secondaryBoard_func": lambda: (
            b := create_empty_board(),
            b[0].__setitem__(0, "K"), # White King a8
            b[2].__setitem__(0, "k"), # Black King a6
            b[1].__setitem__(2, "q"), # Black Queen c7
            b
        )[-1],
        "turn": "White",
        "active_board_phase": "secondary",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active", # Will become stalemate
        "game_over": False,
        "winner": None,
        "status": "Setup for Stalemate on Secondary (White to move)."
    },
    "main_black_in_check_black_to_move": {
        "mainBoard_func": lambda: (
            b := create_empty_board(),
            b[0].__setitem__(0, "k"), # Black King a8
            b[0].__setitem__(7, "R"), # White Rook h8 (checking a8)
            b[7].__setitem__(4, "K"), # White King e1
            b
        )[-1],
        "secondaryBoard_func": lambda: create_initial_board(),
        "turn": "Black",
        "active_board_phase": "main",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "Black in Check on Main (Black to move)."
    },
    "secondary_white_in_check_white_to_move": {
        "mainBoard_func": lambda: create_initial_board(),
        "secondaryBoard_func": lambda: (
            b := create_empty_board(),
            b[7].__setitem__(0, "K"), # White King a1
            b[7].__setitem__(7, "r"), # Black Rook h1 (checking a1)
            b[0].__setitem__(4, "k"), # Black King e8
            b
        )[-1],
        "turn": "White",
        "active_board_phase": "secondary",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "White in Check on Secondary (White to move)."
    },
    "main_white_causes_check_setup": {
        "mainBoard_func": lambda: (
            b := create_empty_board(),
            b[1].__setitem__(0, "R"), # White Rook a7 (row 1, col 0)
            b[7].__setitem__(4, "K"), # White King e1 (row 7, col 4)
            b[0].__setitem__(2, "k"), # Black King c8 (row 0, col 2)
            b
        )[-1],
        "secondaryBoard_func": lambda: create_initial_board(),
        "turn": "White",
        "active_board_phase": "main",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "Setup for White to cause check (move Rook from a7 to c7)."
    }
}

@app.route('/api/debug/setup/<scenario_name>', methods=['POST'])
def setup_debug_scenario(scenario_name):
    data = request.get_json()
    room = data.get("room")

    if not room:
        return jsonify({"message": "Room ID is required."}), 400

    scenario_config = DEBUG_SCENARIOS.get(scenario_name)
    if not scenario_config:
        return jsonify({"message": f"Unknown scenario: {scenario_name}"}), 404

    game = games_collection.find_one({"room": room})
    if not game:
        # Option: Create a default game state if not found, then apply scenario
        # For now, require game to exist (created on join)
        return jsonify({"message": "Game not found. Ensure you've joined the room."}), 404

    # Initialize game_doc with current game state, then selectively override with scenario
    game_doc = dict(game) 

    # Prepare the new state based on scenario config
    game_doc["mainBoard"] = scenario_config["mainBoard_func"]()
    game_doc["secondaryBoard"] = scenario_config["secondaryBoard_func"]()
    game_doc["turn"] = scenario_config["turn"]
    game_doc["active_board_phase"] = scenario_config["active_board_phase"]
    game_doc["main_board_outcome"] = scenario_config["main_board_outcome"]
    game_doc["secondary_board_outcome"] = scenario_config["secondary_board_outcome"]
    game_doc["game_over"] = scenario_config["game_over"]
    game_doc["winner"] = scenario_config["winner"]
    game_doc["status"] = scenario_config.get("status", "Debug scenario activated.")
    game_doc["moves"] = game_doc.get("moves", []) # Keep existing or use scenario's if provided
    game_doc["is_responding_to_check_on_board"] = scenario_config.get("is_responding_to_check_on_board", None)

    current_player_color = game_doc["turn"]
    opponent_color = "Black" if current_player_color == "White" else "White"
    board_type_just_set = game_doc["active_board_phase"] # The board active for the current player by scenario default
    
    # If a scenario sets up an immediate stalemate for the current player on their active board:
    if "stalemate" in scenario_name: 
        board_to_check_stalemate_key = "mainBoard" if board_type_just_set == "main" else "secondaryBoard"
        board_outcome_to_set_key = "main_board_outcome" if board_type_just_set == "main" else "secondary_board_outcome"
        
        if game_doc[board_outcome_to_set_key] == "active" and is_stalemate(game_doc[board_to_check_stalemate_key], current_player_color):
            game_doc[board_outcome_to_set_key] = "draw_stalemate"
            game_doc["status"] = f"Immediate stalemate on {board_type_just_set} for {current_player_color} by debug setup."
            # Now, because this board was just stalemated, we need to determine the next turn/phase
            # This replicates part of the logic from on_move's turn progression

            next_player_candidate = current_player_color
            next_phase_candidate = ""

            if board_type_just_set == "main": # The board that just got stalemated was main
                secondary_outcome_field = "secondary_board_outcome"
                if game_doc[secondary_outcome_field] == "active":
                    if is_stalemate(game_doc["secondaryBoard"], current_player_color):
                        game_doc[secondary_outcome_field] = "draw_stalemate"
                        next_player_candidate = opponent_color
                        next_phase_candidate = "main"
                    else:
                        next_player_candidate = current_player_color
                        next_phase_candidate = "secondary"
                else: # Secondary board already resolved
                    next_player_candidate = opponent_color
                    next_phase_candidate = "main"
            else: # The board that just got stalemated was secondary
                next_player_candidate = opponent_color
                next_phase_candidate = "main"
            
            game_doc["turn"] = next_player_candidate
            game_doc["active_board_phase"] = next_phase_candidate
            # Fall through to the loop below to ensure the new phase is playable

    # Loop to handle if the *new* player/phase is on a resolved board (applies after scenario load or immediate stalemate adjustment)
    # This is copied & adapted from the on_move handler
    for i in range(3): 
        new_turn_player = game_doc["turn"]
        new_active_phase = game_doc["active_board_phase"]
        
        current_board_key = "mainBoard" if new_active_phase == "main" else "secondaryBoard"
        current_board_outcome_key = "main_board_outcome" if new_active_phase == "main" else "secondary_board_outcome"
        
        alternate_phase = "secondary" if new_active_phase == "main" else "main"
        alternate_board_key = "mainBoard" if alternate_phase == "main" else "secondaryBoard"
        alternate_board_outcome_key = "main_board_outcome" if alternate_phase == "main" else "secondary_board_outcome"

        if game_doc[current_board_outcome_key] != "active": 
            if game_doc[alternate_board_outcome_key] != "active": 
                break 
            else: 
                if is_stalemate(game_doc[alternate_board_key], new_turn_player):
                    game_doc[alternate_board_outcome_key] = "draw_stalemate" 
                    break 
                else:
                    game_doc["active_board_phase"] = alternate_phase 
                    break 
        else: 
            if is_stalemate(game_doc[current_board_key], new_turn_player):
                game_doc[current_board_outcome_key] = "draw_stalemate" 
                if game_doc[alternate_board_outcome_key] != "active": 
                    break 
                else: 
                    if is_stalemate(game_doc[alternate_board_key], new_turn_player):
                        game_doc[alternate_board_outcome_key] = "draw_stalemate" 
                        break 
                    else:
                        game_doc["active_board_phase"] = alternate_phase 
                        break 
            else: 
                break 

    # Final check for game over if not already set by scenario (e.g., due to double stalemate)
    if not game_doc["game_over"]:
        m_outcome = game_doc["main_board_outcome"]
        s_outcome = game_doc["secondary_board_outcome"]
        if (m_outcome == "white_wins" and (s_outcome == "white_wins" or s_outcome == "draw_stalemate" or s_outcome == "active")) or \
           (s_outcome == "white_wins" and (m_outcome == "white_wins" or m_outcome == "draw_stalemate" or m_outcome == "active")):
            if not (m_outcome == "black_wins" or s_outcome == "black_wins"): game_doc["winner"] = "White"
        elif (m_outcome == "black_wins" and (s_outcome == "black_wins" or s_outcome == "draw_stalemate" or s_outcome == "active")) or \
             (s_outcome == "black_wins" and (m_outcome == "black_wins" or m_outcome == "draw_stalemate" or m_outcome == "active")):
            if not (m_outcome == "white_wins" or s_outcome == "white_wins"): game_doc["winner"] = "Black"
        elif m_outcome == "draw_stalemate" and s_outcome == "draw_stalemate":
            game_doc["winner"] = "Draw"
        
        if game_doc.get("winner"):
            game_doc["game_over"] = True
            game_doc["status"] = f"Game over. Winner: {game_doc['winner']}."
            if game_doc["winner"] == "Draw": game_doc["status"] = "Game over. Draw."

    # Fields to explicitly update in the database document
    fields_to_set_in_db = {
        "mainBoard": game_doc["mainBoard"],
        "secondaryBoard": game_doc["secondaryBoard"],
        "turn": game_doc["turn"],
        "active_board_phase": game_doc["active_board_phase"],
        "main_board_outcome": game_doc["main_board_outcome"],
        "secondary_board_outcome": game_doc["secondary_board_outcome"],
        "game_over": game_doc["game_over"],
        "winner": game_doc["winner"],
        "status": game_doc["status"],
        "moves": game_doc["moves"], # Ensure moves are also updated/kept
        "is_responding_to_check_on_board": game_doc["is_responding_to_check_on_board"]
    }

    games_collection.update_one(
        {"_id": game["_id"]},
        {"$set": fields_to_set_in_db}
    )

    # Emit the potentially modified game_doc (which includes all fields for serialization)
    socketio.emit("game_update", serialize_game_state(game_doc), room=room)
    print(f"DEBUG: Activated scenario {scenario_name} for room {room}. Final state emitted: turn {game_doc['turn']}, phase {game_doc['active_board_phase']}, main_o {game_doc['main_board_outcome']}, sec_o {game_doc['secondary_board_outcome']}")
    return jsonify({"message": f"Scenario '{scenario_name}' activated successfully."}), 200



######################### SOCKETS #########################



# WebSocket: Handle player joining a room
@socketio.on("join")
def on_join(data):
    room = data.get("room")
    username = data.get("username")

    if not room or not username:
        print("Invalid join data:", data)
        return

    join_room(room)
    print(f"{username} joined room {room}")
    game_state = games_collection.find_one({"room": room})

    if not game_state:
        print(f"Creating initial game state for room: {room}")
        initial_board = create_initial_board()
        game_state = {
            "room": room,
            "mainBoard": initial_board,
            "secondaryBoard": initial_board,
            "turn": "White",
            "active_board_phase": "main",
            "moves": [],
            "winner": None,
            "status": "ongoing",
            "main_board_outcome": "active",
            "secondary_board_outcome": "active",
            "game_over": False,
            "is_responding_to_check_on_board": None,
        }
        games_collection.insert_one(game_state)
        print(f"New game state created for room {room}: {game_state}")
    else:
        if "active_board_phase" not in game_state:
            print(f"Migrating existing game state for room {room} to include active_board_phase.")
            # Ensure 'turn' also exists, defaulting to 'White' if not
            current_turn = game_state.get("turn", "White")
            games_collection.update_one(
                {"_id": game_state["_id"]},
                {"$set": {
                    "active_board_phase": "main", 
                    "turn": current_turn,
                    "is_responding_to_check_on_board": None # Ensure it's added on migration
                    }}
            )
            game_state["active_board_phase"] = "main"
            game_state["turn"] = current_turn
            game_state["is_responding_to_check_on_board"] = None
    
    if not game_state: # Should be extremely rare
        print(f"CRITICAL: game_state for room {room} is None after create/find attempt.")
        return

    # Ensure the game_state sent to the client includes all necessary fields
    # This will be the game_state from DB, which now includes the new fields if newly created
    # or if fetched after a reset.
    final_game_state_for_client = games_collection.find_one({"room": room})
    if final_game_state_for_client: # Should always exist here
        emit("game_state", serialize_game_state(final_game_state_for_client), room=room)
        print(f"Player {username} joined room {room}. Game state sent.")
    else:
        # This case should ideally not happen if insert_one or update_one in reset worked
        print(f"ERROR: Game state not found for room {room} after join/creation attempt.")


# WebSocket: Handle player leaving a room
@socketio.on("leave")
def on_leave(data):
    room = data.get("room")
    username = data.get("username")

    if not room or not username:
        return

    leave_room(room)
    emit("player_left", {"username": username}, room=room)

#WebSocket: Handle game reset
@socketio.on("reset")
def on_reset(data):
    room = data.get("room")

    if not room:
        print("No room provided for reset")
        return

    initial_board = create_initial_board()
    game_state = {
        "mainBoard": initial_board,
        "secondaryBoard": initial_board,
        "turn": "White",
        "active_board_phase": "main",
        "moves": [],
        "winner": None, 
        "status": "ongoing",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "is_responding_to_check_on_board": None,
    }
    
    # Ensure secondaryBoard is a distinct copy
    game_state["secondaryBoard"] = copy.deepcopy(game_state["mainBoard"])


    games_collection.update_one(
        {"room": room}, {"$set": game_state}, upsert=True
    )
    # Emit the game_state that was set, ensuring it includes _id if client expects it (serialize if needed)
    # For game_reset, usually we send the clean state.
    socketio.emit("game_reset", serialize_game_state(game_state.copy()), room=room) # Send a copy


# WebSocket: Handle move events
@socketio.on("move")
def on_move(data):
    room = data.get("room")
    board_type_played = data.get("boardType") # "main" or "secondary"
    move_details = data.get("move") # {"from": [r,c], "to": [r,c], "piece": "P1", "captured": null}

    if not room or not board_type_played or not move_details:
        emit("move_error", {"message": "Invalid move data received."})
        return

    game_doc_cursor = games_collection.find_one({"room": room})
    if not game_doc_cursor:
        emit("move_error", {"message": "Game not found."})
        return
    
    game_doc = dict(game_doc_cursor)

    if game_doc.get("game_over", False):
        emit("move_error", {"message": "Game is already over."})
        # Send current state so UI doesn't get stuck if it missed the game_over update
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return

    current_player_color = game_doc["turn"]
    expected_board_phase = game_doc["active_board_phase"]
    opponent_color = "Black" if current_player_color == "White" else "White"
    responding_to_check_board = game_doc.get("is_responding_to_check_on_board")

    # --- Move Validation ---
    if get_piece_info(move_details["piece"])["color"] != current_player_color:
         emit("move_error", {"message": f"Not your piece. Expected {current_player_color}"})
         return
    if board_type_played != expected_board_phase:
        emit("move_error", {"message": f"Incorrect board. Expected {expected_board_phase}, got {board_type_played}."})
        return
    if responding_to_check_board and board_type_played != responding_to_check_board:
        emit("move_error", {"message": f"You must respond to check on the {responding_to_check_board} board."})
        return

    board_to_update_field = "mainBoard" if board_type_played == "main" else "secondaryBoard"
    current_board_state = copy.deepcopy(game_doc[board_to_update_field])
    from_r, from_c = move_details["from"]
    to_r, to_c = move_details["to"]
    piece_at_from = current_board_state[from_r][from_c]

    if not piece_at_from or piece_at_from != move_details["piece"]:
        emit("move_error", {"message": "Invalid piece or starting position for the move."})
        return

    # Simulate move for legality check
    temp_board_for_legality = copy.deepcopy(current_board_state)
    temp_board_for_legality[to_r][to_c] = temp_board_for_legality[from_r][from_c]
    temp_board_for_legality[from_r][from_c] = None
    if is_king_in_check(temp_board_for_legality, current_player_color):
        emit("move_error", {"message": "Illegal move: Your king would be in check."})
        return

    # --- Apply Move and Asymmetric Capture ---
    game_doc[board_to_update_field] = temp_board_for_legality # Assign the already validated board
    captured_piece_name = move_details.get("captured")
    if captured_piece_name and board_type_played == "main":
        secondary_board_state = game_doc.get("secondaryBoard", [])
        for r_idx, row_val in enumerate(secondary_board_state):
            for c_idx, piece_id_on_secondary in enumerate(row_val):
                if piece_id_on_secondary == captured_piece_name:
                    game_doc["secondaryBoard"][r_idx][c_idx] = None
                    break 
            else: continue
            break
    
    move_notation = f"{move_details['piece']}({chr(97+from_c)}{8-from_r}-{chr(97+to_c)}{8-to_r})"
    if captured_piece_name: move_notation += f"x{captured_piece_name}"
    game_doc.setdefault("moves", []).append(move_notation)

    # --- Post-Move Game State Evaluation ---
    board_played_state = game_doc[board_to_update_field]
    board_played_outcome_field = "main_board_outcome" if board_type_played == "main" else "secondary_board_outcome"

    # 1. Check for Checkmate delivered by current player
    if is_checkmate(board_played_state, opponent_color):
        game_doc[board_played_outcome_field] = f"{current_player_color.lower()}_wins"
        game_doc["game_over"] = True
        game_doc["winner"] = current_player_color
        game_doc["status"] = f"{current_player_color} wins by checkmate on {board_type_played} board."
        games_collection.update_one({"room": room}, {"$set": game_doc})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return

    # 2. Current player *was* responding to check and got out
    if responding_to_check_board == board_type_played and not is_king_in_check(board_played_state, current_player_color):
        game_doc["turn"] = opponent_color # Turn goes back to the player who delivered check
        game_doc["active_board_phase"] = board_type_played # On the same board where check was escaped
        game_doc["is_responding_to_check_on_board"] = None
        # Now, re-evaluate for this player (opponent_color) on this board. 
        # Are they now stalemated or checkmated by the move that just got out of check?
        if is_checkmate(board_played_state, opponent_color):
             game_doc[board_played_outcome_field] = f"{current_player_color.lower()}_wins"
             game_doc["game_over"] = True
             game_doc["winner"] = current_player_color
             game_doc["status"] = f"{current_player_color} wins by checkmate on {board_type_played} board (after escaping check)."
        
        # Regardless of counter-mate/stalemate, the turn has been set. Save and end this move's processing.
        games_collection.update_one({"room": room}, {"$set": game_doc})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return # <<< CRITICAL: End processing here for this specific turn transition
    
    # 3. Current player delivered a check (and it wasn't a mate, handled by #1)
    elif is_king_in_check(board_played_state, opponent_color):
        game_doc["turn"] = opponent_color
        game_doc["active_board_phase"] = board_type_played
        game_doc["is_responding_to_check_on_board"] = board_type_played
        game_doc["status"] = f"{opponent_color} is in check on {board_type_played} board."
        games_collection.update_one({"room": room}, {"$set": game_doc})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return # Opponent must respond to check

    # 4. Current player caused Stalemate for opponent
    if is_stalemate(board_played_state, opponent_color):
        if game_doc[board_played_outcome_field] == "active": # only update if not already decided
            game_doc[board_played_outcome_field] = "draw_stalemate"
            game_doc["status"] = f"Stalemate on {board_type_played} board for {opponent_color}."
        # Check for game over if both boards are now stalemated for opponent.
        # (This specific scenario is tricky; overall game end logic will catch most. Let's simplify here)

    # 5. Normal Turn Progression (or after stalemate/check escape processing that didn't end turn)
    game_doc["is_responding_to_check_on_board"] = None # Clear any prior check response state if turn proceeds normally

    next_player_candidate = current_player_color
    next_phase_candidate = ""

    if board_type_played == "main":
        # Player just played on main, so they try to play on secondary IF secondary is active for them
        secondary_outcome_field = "secondary_board_outcome"
        if game_doc[secondary_outcome_field] == "active":
            # Check if current player is stalemated on secondary *before* making it their phase
            if is_stalemate(game_doc["secondaryBoard"], current_player_color):
                game_doc[secondary_outcome_field] = "draw_stalemate"
                # Since secondary is now stalemated for current player, turn must pass to opponent on main
                next_player_candidate = opponent_color
                next_phase_candidate = "main"
            else:
                next_player_candidate = current_player_color # Player continues
                next_phase_candidate = "secondary"
        else: # Secondary board is resolved for current player, turn passes to opponent on main
            next_player_candidate = opponent_color
            next_phase_candidate = "main"
    else: # board_type_played == "secondary"
        # Player just played on secondary, turn passes to opponent on main
        next_player_candidate = opponent_color
        next_phase_candidate = "main"

    game_doc["turn"] = next_player_candidate
    game_doc["active_board_phase"] = next_phase_candidate

    # --- Handle if the *new* player/phase is on a resolved board --- 
    # This loop ensures the active phase lands on a playable board for the new current player.
    for i in range(3): # Max 3 transitions to find a playable board state (e.g., P1B1 stalemates -> P1B2, P1B2 stalemates -> P2B1)
        new_turn_player = game_doc["turn"]
        new_active_phase = game_doc["active_board_phase"]
        
        current_board_key = "mainBoard" if new_active_phase == "main" else "secondaryBoard"
        current_board_outcome_key = "main_board_outcome" if new_active_phase == "main" else "secondary_board_outcome"
        
        alternate_phase = "secondary" if new_active_phase == "main" else "main"
        alternate_board_key = "mainBoard" if alternate_phase == "main" else "secondaryBoard"
        alternate_board_outcome_key = "main_board_outcome" if alternate_phase == "main" else "secondary_board_outcome"

        # 1. Check current assigned board for the new_turn_player
        if game_doc[current_board_outcome_key] != "active": # Current board is already resolved
            # Try to switch to their other board
            if game_doc[alternate_board_outcome_key] != "active": # Their other board also resolved
                # Both boards are resolved for this player. Break and proceed to overall game end check.
                break 
            else: # Their other board is marked "active". Check if it's actually a stalemate for them.
                if is_stalemate(game_doc[alternate_board_key], new_turn_player):
                    game_doc[alternate_board_outcome_key] = "draw_stalemate" # Mark it as stalemate
                    # Both boards are now resolved for this player. Break.
                    break 
                else:
                    game_doc["active_board_phase"] = alternate_phase # Switch to this playable other board
                    break # Found a playable board for this player, exit loop.
        else: # Current assigned board is marked "active". Is it actually a stalemate for new_turn_player now?
            if is_stalemate(game_doc[current_board_key], new_turn_player):
                game_doc[current_board_outcome_key] = "draw_stalemate" # Mark it as stalemate
                # Now that this one became stalemate, check their other board.
                if game_doc[alternate_board_outcome_key] != "active": # Their other board already resolved
                    # Both boards are now resolved for this player. Break.
                    break 
                else: # Their other board is marked "active". Check if *it's* also a stalemate for them.
                    if is_stalemate(game_doc[alternate_board_key], new_turn_player):
                        game_doc[alternate_board_outcome_key] = "draw_stalemate" # Mark it as stalemate
                        # Both boards are now resolved for this player. Break.
                        break 
                    else:
                        game_doc["active_board_phase"] = alternate_phase # Switch to this playable other board
                        break # Found a playable board for this player, exit loop.
            else: # Current board is "active" and not a stalemate for this player.
                break # This is the playable board/player combo, exit loop.

    # --- Overall Game End Check (after all turn logic) ---
    m_outcome = game_doc["main_board_outcome"]
    s_outcome = game_doc["secondary_board_outcome"]
    
    # Check if game is already decided by checkmate (winner already set)
    if not game_doc.get("winner"): 
        if (m_outcome == "white_wins" and (s_outcome == "white_wins" or s_outcome == "draw_stalemate" or s_outcome == "active")) or \
           (s_outcome == "white_wins" and (m_outcome == "white_wins" or m_outcome == "draw_stalemate" or m_outcome == "active")):
            if not (m_outcome == "black_wins" or s_outcome == "black_wins"): # Ensure Black hasn't won the other board
                game_doc["winner"] = "White"
        elif (m_outcome == "black_wins" and (s_outcome == "black_wins" or s_outcome == "draw_stalemate" or s_outcome == "active")) or \
             (s_outcome == "black_wins" and (m_outcome == "black_wins" or m_outcome == "draw_stalemate" or m_outcome == "active")):
            if not (m_outcome == "white_wins" or s_outcome == "white_wins"): # Ensure White hasn't won the other board
                game_doc["winner"] = "Black"
        elif m_outcome == "draw_stalemate" and s_outcome == "draw_stalemate":
            game_doc["winner"] = "Draw"
        # Case: one board drawn, other active but no moves for current player (e.g., king is only piece, no moves)
        # This complex draw condition might arise if active boards are stalemated for the current player sequentially.
        elif (m_outcome == "draw_stalemate" and s_outcome == "active" and not has_any_legal_moves(game_doc["secondaryBoard"], game_doc["turn"])) or \
             (s_outcome == "draw_stalemate" and m_outcome == "active" and not has_any_legal_moves(game_doc["mainBoard"], game_doc["turn"])):
             # Check if the other board also becomes stalemate for the current player
             if m_outcome == "draw_stalemate" and s_outcome == "active":
                 game_doc["secondary_board_outcome"] = "draw_stalemate"
                 s_outcome = "draw_stalemate"
             elif s_outcome == "draw_stalemate" and m_outcome == "active":
                 game_doc["main_board_outcome"] = "draw_stalemate"
                 m_outcome = "draw_stalemate"
             if m_outcome == "draw_stalemate" and s_outcome == "draw_stalemate":
                 game_doc["winner"] = "Draw"

    if game_doc.get("winner") and not game_doc.get("game_over"): # If a winner was determined by outcomes but game not yet flagged
        game_doc["game_over"] = True
        game_doc["status"] = f"Game over. Winner: {game_doc['winner']}."
        if game_doc["winner"] == "Draw":
            game_doc["status"] = "Game over. Draw."

    games_collection.update_one({"room": room}, {"$set": game_doc})
    socketio.emit("game_update", serialize_game_state(game_doc), room=room)



# WebSocket: Handle finishing game
@socketio.on("finish_game")
def on_finish_game(data):
    room = data.get("room")
    winner = data.get("winner")
    board = data.get("board")
    moves = data.get("moves")

    if not room or not winner or not board or not moves:
        print("Invalid finish_game data:", data)
        return

    completed_game_data = {
        "room": room,
        "winner": winner,
        "board": board,
        "moves": moves,
        "status": "completed",
    }
    games_collection.insert_one(completed_game_data)

    initial_board = create_initial_board()
    reset_game_state = {
        "mainBoard": initial_board,
        "secondaryBoard": initial_board,
        "turn": "White",
        "moves": [],
        "status": "ongoing",
    }
    games_collection.update_one(
        {"room": room},
        {"$set": reset_game_state},
        upsert=True
    )

    socketio.emit("game_reset", reset_game_state, room=room)
    print(f"Game finished for room {room} and state reset for a new game.")



######################### MAIN EXECUTION #########################



if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, allow_unsafe_werkzeug=True)