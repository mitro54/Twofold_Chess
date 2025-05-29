######################### IMPORTS #########################



from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit
from pymongo import MongoClient
import os
from bson import ObjectId 
import copy # Added for deepcopying board states in chess logic
from chess_adapter import arr_to_board, board_to_arr
from original_helpers import (
    create_initial_board, create_empty_board, get_piece_info, is_on_board,
    get_rook_moves_for_attack, get_bishop_moves_for_attack, get_queen_moves_for_attack,
    get_knight_moves_for_attack, get_king_moves_for_attack, get_pawn_attacks,
    is_square_attacked, find_king, is_king_in_check, is_move_legal,
    get_pseudo_legal_moves_for_piece, has_any_legal_moves, is_checkmate, is_stalemate,
    update_castling_rights, update_secondary_board
)
import chess
import logging
import random
import datetime
import time
from apscheduler.schedulers.background import BackgroundScheduler



######################### APPLICATION INITIALIZATION #########################



app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["http://localhost:3000", "http://frontend:3000", "http://192.168.100.135:3000"]}})
app.config["SECRET_KEY"] = "lalalalala"

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

socketio = SocketIO(
    app,
    cors_allowed_origins=["http://localhost:3000", "http://frontend:3000", "http://192.168.100.135:3000"],
    async_mode='eventlet',
    ping_timeout=60,
    ping_interval=25,
    logger=True,
    engineio_logger=True
)



######################### MONGODB SETUP #########################



mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/chess")
client = MongoClient(mongo_uri)
db = client.chess
games_collection = db.games



######################### BOARD SETUP #########################



######################### CHESS LOGIC HELPERS #########################



######################### UTILITIES #########################


# ─── en-passant helper ────────────────────────────────────────────────
def _init_ep_dict(game_doc):
    """
    Ensure game_doc['en_passant_target'] is a dict
        {"main": None | [r,c], "secondary": None | [r,c]}
    """
    if not isinstance(game_doc.get("en_passant_target"), dict):
        game_doc["en_passant_target"] = {"main": None, "secondary": None}
# ──────────────────────────────────────────────────────────────────────

def _init_position_history(game_doc):
    """
    Ensure game_doc has position history tracking
    """
    if "position_history" not in game_doc:
        game_doc["position_history"] = {
            "main": [],  # List of FEN strings for main board
            "secondary": []  # List of FEN strings for secondary board
        }

def _check_threefold_repetition(fen_history):
    """
    Check if the current position has occurred three times
    """
    if len(fen_history) < 3:
        return False
    
    # Get the current position (last FEN)
    current_fen = fen_history[-1]
    
    # Count how many times this position has occurred
    count = sum(1 for fen in fen_history if fen == current_fen)
    
    return count >= 3

def serialize_game_state(game_state):
    if "_id" in game_state:
        game_state["_id"] = str(game_state["_id"])
    if isinstance(game_state.get("createdAt"), datetime.datetime):
        game_state["createdAt"] = int(game_state["createdAt"].timestamp() * 1000)
    return game_state



######################### ROUTES #########################



# Route: Get all games data
@app.route("/api/games", methods=["GET"])
def get_all_games():
    games = list(games_collection.find(
        {"status": "completed"}, 
        {"_id": 0}
    ).sort("_id", -1))  # Sort by _id in descending order (newest first)
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
        "castling_rights": {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}},
        "en_passant_target": {"main": None, "secondary": None},
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
            "castling_rights": {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}},
            "en_passant_target": {"main": None, "secondary": None},
        }
        games_collection.insert_one({"room": room, **game_state})
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
                    "is_responding_to_check_on_board": None, # Ensure it's added on migration
                    "castling_rights": {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}},
                    "en_passant_target": {"main": None, "secondary": None}
                }}
            )
            game_state["active_board_phase"] = "main"
            game_state["turn"] = current_turn
            game_state["is_responding_to_check_on_board"] = None
            game_state["castling_rights"] = {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}}
            game_state["en_passant_target"] = {"main": None, "secondary": None}

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
    },
    "promotion_white_main": {
        "mainBoard_func": lambda: (
            b := create_empty_board(),
            b[1].__setitem__(4, "P1"),  # White pawn on e7 (row 1, col 4)
            b[7].__setitem__(4, "K"),   # White King on e1 (row 7, col 4)
            b[0].__setitem__(0, "k"),   # Black King on a8 (row 0, col 0)
            b
        )[-1],
        "secondaryBoard_func": lambda: create_empty_board(),
        "turn": "White",
        "active_board_phase": "main",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "White pawn ready to promote on main board."
    },
    "promotion_black_secondary": {
        "mainBoard_func": lambda: create_empty_board(),
        "secondaryBoard_func": lambda: (
            b := create_empty_board(),
            b[6].__setitem__(3, "p1"),  # Black pawn on d2 (row 6, col 3)
            b[0].__setitem__(7, "k"),   # Black King on h8 (row 0, col 7)
            b[7].__setitem__(7, "K"),   # White King on h1 (row 7, col 7)
            b
        )[-1],
        "turn": "Black",
        "active_board_phase": "secondary",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "Black pawn ready to promote on secondary board."
    },
    "castling_white_kingside_main": {
        "mainBoard_func": lambda: (
            b := create_empty_board(),
            b[7].__setitem__(4, "K"),   # White King on e1
            b[7].__setitem__(7, "R"),   # White Rook on h1
            b[0].__setitem__(0, "k"),   # Black King on a8
            b
        )[-1],
        "secondaryBoard_func": lambda: create_empty_board(),
        "turn": "White",
        "active_board_phase": "main",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "White can castle kingside on main board."
    },
    "castling_black_queenside_secondary": {
        "mainBoard_func": lambda: create_empty_board(),
        "secondaryBoard_func": lambda: (
            b := create_empty_board(),
            b[0].__setitem__(4, "k"),   # Black King on e8
            b[0].__setitem__(0, "r"),   # Black Rook on a8
            b[7].__setitem__(7, "K"),   # White King on h1
            b
        )[-1],
        "turn": "Black",
        "active_board_phase": "secondary",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "Black can castle queenside on secondary board."
    },
    "enpassant_white_main": {
        "mainBoard_func": lambda: (
            b := create_empty_board(),
            b[6].__setitem__(4, "P1"),  # White pawn on e2 (row 6, col 4)
            b[4].__setitem__(5, "p1"),  # Black pawn on f4 (row 4, col 5)
            b[0].__setitem__(0, "k"),   # Black King on a8
            b[7].__setitem__(4, "K"),   # White King on e1
            b
        )[-1],
        "secondaryBoard_func": lambda: create_empty_board(),
        "turn": "White",
        "active_board_phase": "main",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "White can play e2-e4, then Black can en passant on main board."
    },
    "enpassant_black_secondary": {
        "mainBoard_func": lambda: create_empty_board(),
        "secondaryBoard_func": lambda: (
            b := create_empty_board(),
            b[1].__setitem__(3, "p1"),  # Black pawn on d7 (row 1, col 3)
            b[3].__setitem__(2, "P1"),  # White pawn on c5 (row 3, col 2)
            b[0].__setitem__(7, "k"),   # Black King on h8
            b[7].__setitem__(0, "K"),   # White King on a1
            b
        )[-1],
        "turn": "Black",
        "active_board_phase": "secondary",
        "main_board_outcome": "active",
        "secondary_board_outcome": "active",
        "game_over": False,
        "winner": None,
        "status": "Black can play d7-d5, then White can en passant on secondary board."
    },
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
    game_doc["castling_rights"] = {
        "White": {"K": True, "Q": True},
        "Black": {"K": True, "Q": True}
    }

    # Set en passant target for en passant debug scenarios
    if scenario_name == "enpassant_white_main":
        game_doc["en_passant_target"] = [3, 5]  # e.g., f4 square (row 3, col 5)
    elif scenario_name == "enpassant_black_secondary":
        game_doc["en_passant_target"] = [4, 2]  # e.g., c5 square (row 4, col 2)

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
            elif is_stalemate(game_doc[alternate_board_key], new_turn_player):
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
                elif is_stalemate(game_doc[alternate_board_key], new_turn_player):
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

    logger.info(f"Join request: room={room}, username={username}")

    if not room or not username:
        logger.error("Invalid join data received")
        emit("error", {"message": "Invalid join data"})
        return

    try:
        # Check if room exists
        game_state = games_collection.find_one({"room": room})
        if not game_state:
            logger.error(f"Game state not found for room {room}")
            emit("error", {"message": "Game not found"})
            return

        # Check if room is full
        if len(game_state.get("players", [])) >= 2:
            logger.error(f"Room {room} is full")
            emit("error", {"message": "Room is full"})
            return

        # Join the room
        join_room(room)
        logger.info(f"{username} joined room {room}")
        
        # Second player joins
        if len(game_state.get("players", [])) < 2:
            # Second player gets opposite color of first player
            first_player = game_state["players"][0]
            first_player_color = game_state["player_colors"][first_player]
            second_player_color = "Black" if first_player_color == "White" else "White"
            
            game_state["players"].append(username)
            game_state["player_colors"][username] = second_player_color
            
            logger.info(f"Updating game state with new player: {username} as {second_player_color}")
            games_collection.update_one(
                {"room": room},
                {
                    "$set": {
                        "players": game_state["players"],
                        "player_colors": game_state["player_colors"]
                    }
                }
            )
            
            # Notify both players — now include the target username so
            # each client can ignore the message meant for the other one.
            emit(
                "player_joined",
                {"color": second_player_color, "username": username},
                room=room,
            )
            emit(
                "game_start",
                {"color": first_player_color, "username": first_player},
                room=room,
            )

            logger.info(f"Second player {username} joined room {room} as {second_player_color}")
            
            # Ensure the game_state sent to the client includes all necessary fields
            final_game_state_for_client = games_collection.find_one({"room": room})
            if final_game_state_for_client:
                emit("game_state", serialize_game_state(final_game_state_for_client), room=room)
                logger.info(f"Game state sent to {username} in room {room}")
            else:
                logger.error(f"Game state not found for room {room} after join attempt")
            
            # Broadcast updated lobby list to all clients
            lobbies = list(games_collection.find(
                {"is_private": False, "players.1": {"$exists": False}},
                {"room": 1, "host": 1, "is_private": 1, "createdAt": 1, "_id": 0}
            ).sort("createdAt", -1))
            for lobby in lobbies:
                if isinstance(lobby.get("createdAt"), datetime.datetime):
                    lobby["createdAt"] = int(lobby["createdAt"].timestamp() * 1000)
            socketio.emit("lobby_list", lobbies)
    except Exception as e:
        logger.error(f"Error joining game: {str(e)}")
        emit("error", {"message": "Failed to join game"})


# WebSocket: Handle chat messages
@socketio.on("chat_message")
def on_chat_message(data):
    room = data.get("room")
    message = data.get("message")
    sender = data.get("sender")

    if not room or not message or not sender:
        logger.error("Invalid chat message data received")
        emit("error", {"message": "Invalid chat message data"})
        return

    try:
        # Broadcast the message to all players in the room
        socketio.emit("chat_message", {
            "sender": sender,
            "message": message
        }, room=room)
        logger.info(f"Chat message from {sender} in room {room}: {message}")
    except Exception as e:
        logger.error(f"Error handling chat message: {str(e)}")
        emit("error", {"message": "Failed to send chat message"})

# WebSocket: Handle player leaving a room
@socketio.on("leave_room")
def on_leave_room(data):
    room = data.get("room")
    username = data.get("username")

    logger.info(f"Leave room request: room={room}, username={username}")

    if not room:
        logger.error("Invalid leave room data received")
        emit("error", {"message": "Invalid leave room data"})
        return

    try:
        # Leave the socket room
        leave_room(room)
        
        # Update game state
        game_state = games_collection.find_one({"room": room})
        if game_state:
            if username in game_state.get("players", []):
                game_state["players"].remove(username)
                if username in game_state.get("player_colors", {}):
                    del game_state["player_colors"][username]
                
                # If no players left, delete the game immediately
                if not game_state["players"]:
                    logger.info(f"Deleting empty room {room}")
                    games_collection.delete_one({"room": room})
                    # Broadcast room deletion to all clients
                    socketio.emit("room_deleted", {"room": room})
                else:
                    games_collection.update_one(
                        {"room": room},
                        {
                            "$set": {
                                "players": game_state["players"],
                                "player_colors": game_state["player_colors"]
                            }
                        }
                    )
                    logger.info(f"Updated game state after {username} left")
        
        # Notify other players
        emit("player_left", {"username": username}, room=room)
        
        # Broadcast updated lobby list
        lobbies = list(games_collection.find(
            {"is_private": False, "players.1": {"$exists": False}},
            {"room": 1, "host": 1, "is_private": 1, "createdAt": 1, "_id": 0}
        ).sort("createdAt", -1))
        
        for lobby in lobbies:
            if isinstance(lobby.get("createdAt"), datetime.datetime):
                lobby["createdAt"] = int(lobby["createdAt"].timestamp() * 1000)
        socketio.emit("lobby_list", lobbies)
        
    except Exception as e:
        logger.error(f"Error leaving room: {str(e)}")
        emit("error", {"message": "Failed to leave room"})

# WebSocket: Handle get lobbies request
@socketio.on("get_lobbies")
def on_get_lobbies():
    try:
        logger.info("Received get_lobbies request")
        # Get all non-private games that aren't full and have at least one player
        lobbies = list(games_collection.find(
            {
                "is_private": False,
                "players.1": {"$exists": False},  # Not full
                "players.0": {"$exists": True}    # Has at least one player
            },
            {"room": 1, "host": 1, "is_private": 1, "createdAt": 1, "_id": 0}
        ).sort("createdAt", -1))  # Sort by creation time, newest first
        
        # Convert datetime to timestamp for JSON serialization
        for lobby in lobbies:
            if isinstance(lobby.get("createdAt"), datetime.datetime):
                lobby["createdAt"] = int(lobby["createdAt"].timestamp() * 1000)  # Convert to milliseconds
        
        # Remove duplicates by room ID
        unique_lobbies = {}
        for lobby in lobbies:
            room = lobby["room"]
            if room not in unique_lobbies:
                unique_lobbies[room] = lobby
        
        lobbies = list(unique_lobbies.values())
        logger.info(f"Found {len(lobbies)} unique lobbies")
        emit("lobby_list", lobbies)
    except Exception as e:
        logger.error(f"Error getting lobbies: {str(e)}")
        emit("error", {"message": "Failed to get lobbies"})

@socketio.on("create_lobby")
def on_create_lobby(data):
    try:
        room_id = data.get("roomId")
        host = data.get("host")
        is_private = data.get("isPrivate", False)

        if not room_id or not host:
            logger.error("Invalid create_lobby data received")
            emit("error", {"message": "Invalid lobby data"})
            return

        # Check if room already exists
        existing_room = games_collection.find_one({"room": room_id})
        if existing_room:
            logger.error(f"Room {room_id} already exists")
            emit("error", {"message": "Room already exists"})
            return

        # Randomly assign host's color
        host_color = random.choice(["White", "Black"])

        # Create initial game state
        initial_board = create_initial_board()
        current_time = datetime.datetime.utcnow()
        game_state = {
            "room": room_id,
            "host": host,
            "is_private": is_private,
            "createdAt": current_time,
            "players": [host],
            "player_colors": {host: host_color},
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
            "castling_rights": {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}},
            "en_passant_target": {"main": None, "secondary": None},
        }

        # Insert the new game state
        games_collection.insert_one(game_state)
        logger.info(f"Created new lobby: {room_id} by {host} as {host_color}")

        # Join the room
        join_room(room_id)

        # Get updated lobby list and convert datetime to timestamp
        lobbies = list(games_collection.find(
            {"is_private": False, "players.1": {"$exists": False}},
            {"room": 1, "host": 1, "is_private": 1, "createdAt": 1, "_id": 0}
        ))
        for lobby in lobbies:
            if isinstance(lobby.get("createdAt"), datetime.datetime):
                lobby["createdAt"] = int(lobby["createdAt"].timestamp() * 1000)  # Convert to milliseconds

        # Broadcast updated lobby list to all clients
        socketio.emit("lobby_list", lobbies)

    except Exception as e:
        logger.error(f"Error creating lobby: {str(e)}")
        emit("error", {"message": "Failed to create lobby"})

# WebSocket: Handle game reset
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
        "castling_rights": {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}},
        "en_passant_target": {"main": None, "secondary": None},
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
    move_details = data.get("move") # {"from": [r,c], "to": [r,c], "piece": "P1", "captured": null, ...}

    if not room or not board_type_played or not move_details:
        emit("move_error", {"message": "Invalid move data received."})
        return

    game_doc_cursor = games_collection.find_one({"room": room})
    if not game_doc_cursor:
        emit("move_error", {"message": "Game not found."})
        return
    game_doc = dict(game_doc_cursor)

    # make sure the en passant field exists
    _init_ep_dict(game_doc)
    # make sure position history exists
    _init_position_history(game_doc)

    if game_doc.get("game_over", False):
        emit("move_error", {"message": "Game is already over."})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return

    current_player_color = game_doc["turn"]
    expected_board_phase = game_doc["active_board_phase"]
    opponent_color = "Black" if current_player_color == "White" else "White"
    responding_to_check_board = game_doc.get("is_responding_to_check_on_board")

    # --- Move Validation: Color, Board, Check Response ---
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

    # --- Use python-chess for move validation and application ---
    castling_rights = game_doc.get("castling_rights", {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}})
    en_passant_target = game_doc["en_passant_target"][board_type_played]
    board = arr_to_board(current_board_state, turn=current_player_color, castling_rights=castling_rights, ep_target=en_passant_target)

    # ---------- build (and/or translate) the intended move ----------
    promotion = move_details.get("promotion")

    # --- CASTLING sent from the front-end ---
    if "castle" in move_details:       # "kingside" | "queenside"
        home_rank = 0 if current_player_color == "Black" else 7
        king_from = chess.square(4, 7 - home_rank)      # e-file
        if move_details["castle"] == "kingside":
            king_to   = chess.square(6, 7 - home_rank)  # g-file
        else:
            king_to   = chess.square(2, 7 - home_rank)  # c-file
        uci_move = chess.Move(king_from, king_to)       # no promotion
    else:
        from_sq = chess.square(from_c, 7 - from_r)
        to_sq   = chess.square(to_c,   7 - to_r)

        # --- AUTO-PROMOTE to queen if the front-end forgot the piece ---
        if (get_piece_info(piece_at_from)["type"] == "Pawn"
                and (to_r == 0 or to_r == 7) and promotion is None):
            promotion = "Q"

        promo_type = (
            chess.Piece.from_symbol(promotion).piece_type
            if promotion else None
        )
        uci_move = chess.Move(from_sq, to_sq, promotion=promo_type)

    # ---------- legality ----------
    logger.debug(f"Received move: {move_details} for {current_player_color} on {board_type_played}")
    logger.debug(f"Board FEN before move: {board.fen()}")
    logger.debug(f"Constructed uci_move: {uci_move.uci()} (promotion: {promotion})")
    if uci_move not in board.legal_moves:
        logger.error(f"Illegal move attempted: {uci_move.uci()} on FEN {board.fen()}")
        return emit("move_error", {"message": "Illegal move (python-chess)."})

    # Save captured piece for asymmetric logic
    captured_piece_name = move_details.get("captured")
    # --- Move Notation ---
    move_notation = board.san(uci_move)
    game_doc.setdefault("moves", []).append(f"{current_player_color}: {move_notation} on {board_type_played} board")

    # Save board state before move for capture detection
    prev_board_arr = [row[:] for row in current_board_state]

    # -------------------------------------------------------------
    # Detect whether this move is an en-passant capture *before*
    # we push it, because board.push() resets ep_square.
    # -------------------------------------------------------------
    is_ep_capture = board.is_en_passant(uci_move)

    # Apply the move
    board.push(uci_move)
    logger.debug(f"Board FEN after move: {board.fen()}")

    # Add current position to history
    current_fen = board.fen()
    game_doc["position_history"][board_type_played].append(current_fen)

    # Check for threefold repetition
    if _check_threefold_repetition(game_doc["position_history"][board_type_played]):
        board_outcome_field = "main_board_outcome" if board_type_played == "main" else "secondary_board_outcome"
        game_doc[board_outcome_field] = "draw_repetition"
        game_doc["status"] = f"Draw by threefold repetition on {board_type_played} board."
        
        # Check if both boards are now drawn
        if (game_doc["main_board_outcome"] == "draw_repetition" and 
            game_doc["secondary_board_outcome"] == "draw_repetition"):
            game_doc["game_over"] = True
            game_doc["winner"] = "Draw"
            game_doc["status"] = "Game over. Draw by threefold repetition on both boards."
            
            # Save the completed game
            completed_game_data = {
                "room": room,
                "winner": "Draw",
                "checkmate_board": None,  # No checkmate board for draws
                "moves": game_doc["moves"],
                "status": "completed",
                "end_reason": "repetition",
                "main_board_outcome": game_doc["main_board_outcome"],
                "secondary_board_outcome": game_doc["secondary_board_outcome"]
            }
            games_collection.insert_one(completed_game_data)

    # Update en passant target for the current board only
    ep_square = board.ep_square
    if ep_square is not None:
        ep_row = 7 - (ep_square // 8)
        ep_col = ep_square % 8
        game_doc["en_passant_target"][board_type_played] = [ep_row, ep_col]
    else:
        game_doc["en_passant_target"][board_type_played] = None

    # Update castling rights
    cr = {"White": {"K": board.has_kingside_castling_rights(chess.WHITE), "Q": board.has_queenside_castling_rights(chess.WHITE)},
        "Black": {"K": board.has_kingside_castling_rights(chess.BLACK), "Q": board.has_queenside_castling_rights(chess.BLACK)}}
    game_doc["castling_rights"] = cr

    # Convert back to array, preserving IDs
    new_board_arr = board_to_arr(board, current_board_state)
    game_doc[board_to_update_field] = new_board_arr

    # --- Asymmetric Capture Logic (robust) ---
    if board_type_played == "main":
        # En-passant: remove the *same-ID* pawn on the other board
        if is_ep_capture:
            captured_r = from_r               # rank pawn started from
            captured_c = to_c                 # file it moved to
            captured_piece = prev_board_arr[captured_r][captured_c]

            if captured_piece:
                sec = game_doc["secondaryBoard"]
                for r in range(8):
                    for c in range(8):
                        if sec[r][c] == captured_piece:
                            sec[r][c] = None
                            break
                    else:
                        continue
                    break
        # Normal capture: remove piece with same ID from secondary board
        elif board.is_capture(uci_move):
            to_sq = uci_move.to_square
            to_r = 7 - (to_sq // 8)
            to_c = to_sq % 8
            captured_piece = prev_board_arr[to_r][to_c]
            if captured_piece:
                print(f"[DEBUG] Found captured piece {captured_piece} at ({to_r}, {to_c})")
                found = False
                for r in range(8):
                    for c in range(8):
                        if game_doc["secondaryBoard"][r][c] == captured_piece:
                            print(f"[DEBUG] Removing piece {captured_piece} from secondary board at ({r}, {c})")
                            game_doc["secondaryBoard"][r][c] = None
                            found = True
                            break
                    if found:
                        break
                if not found:
                    print(f"[DEBUG] Warning: Could not find piece {captured_piece} on secondary board")
            else:
                print(f"[DEBUG] No captured piece found at (row={to_r}, col={to_c}) on main board.")
    elif board_type_played == "secondary":
        # En-passant: remove the *same-ID* pawn on the other board
        if is_ep_capture:
            captured_r = from_r               # rank pawn started from
            captured_c = to_c                 # file it moved to
            captured_piece = prev_board_arr[captured_r][captured_c]

            if captured_piece:
                sec = game_doc["mainBoard"]
                for r in range(8):
                    for c in range(8):
                        if sec[r][c] == captured_piece:
                            sec[r][c] = None
                            break
                    else:
                        continue
                    break

    # --- Promotion Fix: ensure correct promotion argument ---
    # (already handled by UCI move construction above, but ensure frontend sends correct char)

    # --- Post-Move Game State Evaluation ---
    board_played_state = game_doc[board_to_update_field]
    board_played_outcome_field = "main_board_outcome" if board_type_played == "main" else "secondary_board_outcome"

    # 1. Check for Checkmate delivered by current player
    if is_checkmate(board_played_state, opponent_color):
        game_doc[board_played_outcome_field] = f"{current_player_color.lower()}_wins"
        game_doc["game_over"] = True
        game_doc["winner"] = current_player_color
        game_doc["status"] = f"{current_player_color} wins by checkmate on {board_type_played} board."
        
        # Save the completed game
        completed_game_data = {
            "room": room,
            "winner": game_doc["winner"],
            "checkmate_board": board_type_played,  # Add which board the checkmate occurred on
            "moves": game_doc["moves"],
            "status": "completed",
            "end_reason": "checkmate",
            "main_board_outcome": game_doc["main_board_outcome"],
            "secondary_board_outcome": game_doc["secondary_board_outcome"]
        }
        games_collection.insert_one(completed_game_data)
        
        games_collection.update_one({"room": room}, {"$set": game_doc})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return

    # 2. Current player *was* responding to check and got out
    if responding_to_check_board == board_type_played and not is_king_in_check(board_played_state, current_player_color):
        game_doc["turn"] = opponent_color
        game_doc["active_board_phase"] = board_type_played
        game_doc["is_responding_to_check_on_board"] = None
        if is_checkmate(board_played_state, opponent_color):
            game_doc[board_played_outcome_field] = f"{current_player_color.lower()}_wins"
            game_doc["game_over"] = True
            game_doc["winner"] = current_player_color
            game_doc["status"] = f"{current_player_color} wins by checkmate on {board_type_played} board (after escaping check)."
        games_collection.update_one({"room": room}, {"$set": game_doc})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return

    # 3. Current player delivered a check (and it wasn't a mate, handled by #1)
    elif is_king_in_check(board_played_state, opponent_color):
        game_doc["turn"] = opponent_color
        game_doc["active_board_phase"] = board_type_played
        game_doc["is_responding_to_check_on_board"] = board_type_played
        game_doc["status"] = f"{opponent_color} is in check on {board_type_played} board."
        games_collection.update_one({"room": room}, {"$set": game_doc})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return

    # 4. Current player caused Stalemate for opponent
    if is_stalemate(board_played_state, opponent_color):
        if game_doc[board_played_outcome_field] == "active":
            game_doc[board_played_outcome_field] = "draw_stalemate"
            game_doc["status"] = f"Stalemate on {board_type_played} board for {opponent_color}."
            
            # Check if both boards are now drawn
            if (game_doc["main_board_outcome"] == "draw_stalemate" and 
                game_doc["secondary_board_outcome"] == "draw_stalemate"):
                game_doc["game_over"] = True
                game_doc["winner"] = "Draw"
                game_doc["status"] = "Game over. Draw by stalemate on both boards."
                
                # Save the completed game
                completed_game_data = {
                    "room": room,
                    "winner": "Draw",
                    "checkmate_board": None,  # No checkmate board for draws
                    "moves": game_doc["moves"],
                    "status": "completed",
                    "end_reason": "stalemate",
                    "main_board_outcome": game_doc["main_board_outcome"],
                    "secondary_board_outcome": game_doc["secondary_board_outcome"]
                }
                games_collection.insert_one(completed_game_data)

    # 5. Normal Turn Progression (or after stalemate/check escape processing that didn't end turn)
    game_doc["is_responding_to_check_on_board"] = None
    next_player_candidate = current_player_color
    next_phase_candidate = ""
    if board_type_played == "main":
        secondary_outcome_field = "secondary_board_outcome"
        if game_doc[secondary_outcome_field] == "active":
            if is_stalemate(game_doc["secondaryBoard"], current_player_color):
                game_doc[secondary_outcome_field] = "draw_stalemate"
                next_player_candidate = opponent_color
                next_phase_candidate = "main"
            else:
                next_player_candidate = current_player_color
                next_phase_candidate = "secondary"
        else:
            next_player_candidate = opponent_color
            next_phase_candidate = "main"
    elif board_type_played == "secondary":
        next_player_candidate = opponent_color
        next_phase_candidate = "main"
    game_doc["turn"] = next_player_candidate
    game_doc["active_board_phase"] = next_phase_candidate
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
            elif is_stalemate(game_doc[alternate_board_key], new_turn_player):
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
                elif is_stalemate(game_doc[alternate_board_key], new_turn_player):
                    game_doc[alternate_board_outcome_key] = "draw_stalemate"
                    break
                else:
                    game_doc["active_board_phase"] = alternate_phase
                    break
            else:
                break
    m_outcome = game_doc["main_board_outcome"]
    s_outcome = game_doc["secondary_board_outcome"]
    if not game_doc.get("winner"):
        if (m_outcome == "white_wins" and (s_outcome == "white_wins" or s_outcome == "draw_stalemate" or s_outcome == "active")) or \
        (s_outcome == "white_wins" and (m_outcome == "white_wins" or m_outcome == "draw_stalemate" or m_outcome == "active")):
            if not (m_outcome == "black_wins" or s_outcome == "black_wins"):
                game_doc["winner"] = "White"
        elif (m_outcome == "black_wins" and (s_outcome == "black_wins" or s_outcome == "draw_stalemate" or s_outcome == "active")) or \
            (s_outcome == "black_wins" and (m_outcome == "black_wins" or m_outcome == "draw_stalemate" or m_outcome == "active")):
            if not (m_outcome == "white_wins" or s_outcome == "white_wins"):
                game_doc["winner"] = "Black"
        elif m_outcome == "draw_stalemate" and s_outcome == "draw_stalemate":
            game_doc["winner"] = "Draw"
        elif (m_outcome == "draw_stalemate" and s_outcome == "active" and not has_any_legal_moves(game_doc["secondaryBoard"], game_doc["turn"])) or \
            (s_outcome == "draw_stalemate" and m_outcome == "active" and not has_any_legal_moves(game_doc["mainBoard"], game_doc["turn"])):
            if m_outcome == "draw_stalemate" and s_outcome == "active":
                game_doc["secondary_board_outcome"] = "draw_stalemate"
                s_outcome = "draw_stalemate"
            elif s_outcome == "draw_stalemate" and m_outcome == "active":
                game_doc["main_board_outcome"] = "draw_stalemate"
                m_outcome = "draw_stalemate"
            if m_outcome == "draw_stalemate" and s_outcome == "draw_stalemate":
                game_doc["winner"] = "Draw"
    if game_doc.get("winner") and not game_doc.get("game_over"):
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



def cleanup_stale_rooms():
    """Clean up rooms that have been empty for too long"""
    try:
        # On startup, clear all active game rooms (but not completed game history)
        if not hasattr(cleanup_stale_rooms, 'initialized'):
            result = games_collection.delete_many({
                "status": {"$ne": "completed"}  # Only delete non-completed games
            })
            if result.deleted_count > 0:
                logger.info(f"Cleared all {result.deleted_count} active rooms on startup")
            cleanup_stale_rooms.initialized = True
            return

        # Regular cleanup: find rooms with no players or only one player that haven't been updated recently
        stale_time = datetime.datetime.utcnow() - datetime.timedelta(minutes=5)  # Reduced from 1 hour to 5 minutes
        result = games_collection.delete_many({
            "status": {"$ne": "completed"},  # Only delete non-completed games
            "$or": [
                {"players": []},  # Empty rooms
                {"players.1": {"$exists": False}, "createdAt": {"$lt": stale_time}}  # Single player rooms older than 5 minutes
            ]
        })
        if result.deleted_count > 0:
            logger.info(f"Cleaned up {result.deleted_count} stale rooms")
    except Exception as e:
        logger.error(f"Error cleaning up stale rooms: {str(e)}")

# Add cleanup call to the main execution block
if __name__ == "__main__":
    # Initial cleanup
    cleanup_stale_rooms()
    # Set up periodic cleanup
    scheduler = BackgroundScheduler()
    scheduler.add_job(cleanup_stale_rooms, 'interval', minutes=1)  # Run cleanup every minute
    scheduler.start()
    socketio.run(app, host="0.0.0.0", port=5001)

@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on('error')
def handle_error(error):
    logger.error(f"Socket error: {error}")