######################### IMPORTS #########################



from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit
from pymongo import MongoClient
import os
from bson import ObjectId 



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
        }
        games_collection.insert_one({"room": room, **game_state})

    return jsonify(game_state)



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
        game_state_data = {
            "room": room,
            "mainBoard": initial_board,
            "secondaryBoard": initial_board,
            "turn": "White",
            "active_board_phase": "main",
            "moves": [],
            "status": "ongoing"
        }
        games_collection.insert_one(game_state_data)
        game_state = games_collection.find_one({"room": room})
    else:
        if "active_board_phase" not in game_state:
            print(f"Migrating existing game state for room {room} to include active_board_phase.")
            # Ensure 'turn' also exists, defaulting to 'White' if not
            current_turn = game_state.get("turn", "White")
            games_collection.update_one(
                {"_id": game_state["_id"]},
                {"$set": {"active_board_phase": "main", "turn": current_turn}}
            )
            game_state["active_board_phase"] = "main"
            game_state["turn"] = current_turn
    
    if not game_state: # Should be extremely rare
        print(f"CRITICAL: game_state for room {room} is None after create/find attempt.")
        return

    game_state_to_emit = serialize_game_state(game_state.copy())
    print(f"Game state for room {room} after join:", game_state_to_emit)
    emit("game_state", game_state_to_emit, room=room)
    emit("player_joined", {"username": username}, room=room)


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
        "status": "in_progress",
    }

    games_collection.update_one(
        {"room": room},
        {"$set": game_state},
        upsert=True
    )

    socketio.emit("game_reset", game_state, room=room)
    print(f"Game reset successfully for room {room}")


# WebSocket: Handle move events
@socketio.on("move")
def on_move(data):
    room = data.get("room")
    board_type = data.get("boardType")
    board_state_from_client = data.get("board")
    move_details = data.get("move")

    # Initial fetch of game doc to get initial turn/phase for logging
    temp_game_doc_for_log = games_collection.find_one({"room": room}) 
    initial_player_turn_log = temp_game_doc_for_log.get('turn') if temp_game_doc_for_log else 'N/A'
    initial_phase_log = temp_game_doc_for_log.get('active_board_phase') if temp_game_doc_for_log else 'N/A'
    print(f"MOVE START: room={room}, clientBoardType={board_type}, clientMoveDetails={move_details}, playerTurnBeforeLogic={initial_player_turn_log}, phaseBeforeLogic={initial_phase_log}")

    if not room or not board_type or not board_state_from_client or not move_details:
        print("Invalid data in move event:", data)
        return

    piece = move_details.get("piece")
    from_pos = move_details.get("from")
    to_pos = move_details.get("to")
    captured = move_details.get("captured", None)

    if not piece or not from_pos or not to_pos:
        print("Invalid move data:", move_details)
        return

    current_game_doc = games_collection.find_one({"room": room})

    if not current_game_doc:
        print(f"Game state not found for room {room}. Initializing game state.")
        initial_board = create_initial_board()
        game_state_data = {
            "room": room,
            "mainBoard": initial_board,
            "secondaryBoard": initial_board,
            "turn": "White",
            "active_board_phase": "main",
            "moves": [],
            "status": "ongoing",
        }
        games_collection.insert_one(game_state_data)
        current_game_doc = games_collection.find_one({"room": room})
        if not current_game_doc:
            print(f"CRITICAL: Failed to initialize and fetch game state for room {room} in on_move.")
            return

    if "active_board_phase" not in current_game_doc:
        current_game_doc["active_board_phase"] = "main"
        current_game_doc["turn"] = current_game_doc.get("turn", "White")
        games_collection.update_one(
            {"_id": current_game_doc["_id"]},
            {"$set": {"active_board_phase": "main", "turn": current_game_doc["turn"]}}
        )
        print(f"Migrated game state for room {room} in on_move to include active_board_phase.")

    print(f"Current game state for room {room} before move: {current_game_doc}")

    current_player_turn = current_game_doc["turn"]
    current_active_board_phase = current_game_doc["active_board_phase"]

    if board_type != current_active_board_phase:
        print(f"Invalid move: Attempted move on '{board_type}' board, but expected on '{current_active_board_phase}' board for player {current_player_turn}.")
        emit("move_error", {
            "message": f"Incorrect board. It's {current_player_turn}'s turn on the {current_active_board_phase} board.",
            "expectedBoard": current_active_board_phase,
            "actualBoard": board_type
        }, room=request.sid)
        return

    from_pos_str = f"{chr(97 + from_pos[1])}{8 - from_pos[0]}"
    to_pos_str = f"{chr(97 + to_pos[1])}{8 - to_pos[0]}"

    # Added before the if captured block for comprehensive logging
    print(f"DEBUG CAPTURE INFO: PlayerTurn={current_player_turn}, BoardTypeForMove={board_type}, CapturedPieceString={captured}, TargetSquare={to_pos}, MainBoardStateBeforeAnyCaptureLogic={current_game_doc['mainBoard']}, SecondaryBoardStateBeforeAnyCaptureLogic={current_game_doc['secondaryBoard']}")

    if captured:
        move_description = f"{piece} captured {captured} at {to_pos_str} on {board_type} board"
    else:
        move_description = f"{piece} moved from {from_pos_str} to {to_pos_str} on {board_type} board"
    
    # Initialize definitive board states for the update by copying from the current game document
    # These will be modified by the current move.
    new_main_board_state = [row[:] for row in current_game_doc["mainBoard"]]
    new_secondary_board_state = [row[:] for row in current_game_doc["secondaryBoard"]]

    # Extract move coordinates for clarity
    f_row, f_col = from_pos
    t_row, t_col = to_pos

    if board_type == "main":
        # Apply the move to the main board
        print(f"APPLYING MOVE TO MAIN BOARD: Piece '{piece}' from [{f_row},{f_col}] to [{t_row},{t_col}]")
        if not (0 <= f_row < len(new_main_board_state) and 0 <= f_col < len(new_main_board_state[0]) and \
                0 <= t_row < len(new_main_board_state) and 0 <= t_col < len(new_main_board_state[0])):
            print(f"ERROR: Move coordinates out of bounds for main board. From: {from_pos}, To: {to_pos}")
            # Consider emitting an error back to client or handling more gracefully
            return 
        
        # It's important that 'piece' from move_details is the actual piece ID being moved.
        # The client sends board_state_from_client which is the state *before* this move.
        # We apply the move to our server-side copy (new_main_board_state).
        
        # Verify piece at source on our server copy (optional, client should ensure this)
        # if new_main_board_state[f_row][f_col] != piece:
        #     print(f"WARNING: Piece mismatch. Client says '{piece}' moved from {from_pos}, but server main board has '{new_main_board_state[f_row][f_col]}'")
            # Decide handling strategy: trust client, or use server's piece, or error

        new_main_board_state[t_row][t_col] = piece # Place the piece at the destination
        new_main_board_state[f_row][f_col] = None  # Clear the source square
        print(f"Main board state AFTER move application: {new_main_board_state}")

        if captured:
            print(f"ASYMMETRIC CAPTURE (MAIN BOARD): Detected capture of '{captured}' at {to_pos} on main board.")
            # If a capture happened on the main board, find and remove the *captured piece* (by its name) from the secondary board.
            captured_piece_name = captured # e.g., 'p5'
            print(f"ASYMMETRIC CAPTURE: Attempting to find and remove '{captured_piece_name}' from secondary board.")
            print(f"ASYMMETRIC CAPTURE: Secondary board state BEFORE '{captured_piece_name}' removal: {new_secondary_board_state}")
            piece_removed = False
            for r_idx, row_content in enumerate(new_secondary_board_state):
                for c_idx, piece_on_square in enumerate(row_content):
                    if piece_on_square == captured_piece_name:
                        print(f"ASYMMETRIC CAPTURE: Found '{captured_piece_name}' at secondary_board[{r_idx}][{c_idx}]. Setting to None.")
                        new_secondary_board_state[r_idx][c_idx] = None
                        piece_removed = True
                        break # Assume piece names are unique, so we can stop once found
                if piece_removed:
                    break
            if not piece_removed:
                print(f"ASYMMETRIC CAPTURE: WARNING - '{captured_piece_name}' was not found on the secondary board.")
            print(f"ASYMMETRIC CAPTURE: Secondary board state AFTER '{captured_piece_name}' removal attempt: {new_secondary_board_state}")
        # If no capture on main, new_secondary_board_state remains as it was from current_game_doc (already copied)

    elif board_type == "secondary":
        # Apply the move to the secondary board
        print(f"APPLYING MOVE TO SECONDARY BOARD: Piece '{piece}' from [{f_row},{f_col}] to [{t_row},{t_col}]")
        if not (0 <= f_row < len(new_secondary_board_state) and 0 <= f_col < len(new_secondary_board_state[0]) and \
                0 <= t_row < len(new_secondary_board_state) and 0 <= t_col < len(new_secondary_board_state[0])):
            print(f"ERROR: Move coordinates out of bounds for secondary board. From: {from_pos}, To: {to_pos}")
            # Consider emitting an error back to client or handling more gracefully
            return

        # Apply the move to our server-side copy (new_secondary_board_state).
        new_secondary_board_state[t_row][t_col] = piece # Place the piece at the destination
        new_secondary_board_state[f_row][f_col] = None  # Clear the source square
        print(f"Secondary board state AFTER move application: {new_secondary_board_state}")
        # Captures on the secondary board do not affect the main board.
        # new_main_board_state remains as it was from current_game_doc (already copied)

    # Determine next turn and active board phase
    new_player_turn = current_player_turn
    new_active_board_phase = current_active_board_phase

    if current_active_board_phase == "main":
        new_active_board_phase = "secondary"
    elif current_active_board_phase == "secondary":
        new_active_board_phase = "main"
        new_player_turn = "Black" if current_player_turn == "White" else "White"

    # Prepare the complete payload for the $set operation
    final_db_set_payload = {
        "mainBoard": new_main_board_state,
        "secondaryBoard": new_secondary_board_state,
        "turn": new_player_turn,
        "active_board_phase": new_active_board_phase
    }
    
    print(f"DB UPDATE PAYLOAD ($set): {final_db_set_payload}") # Log before DB update

    games_collection.update_one(
        {"_id": current_game_doc["_id"]},
        {
            "$set": final_db_set_payload,
            "$push": {"moves": move_description}
        }
    )

    updated_game_state_full = games_collection.find_one({"_id": current_game_doc["_id"]})
    
    # Log before emitting game_update
    if updated_game_state_full:
        print(f"EMITTING GAME_UPDATE: {serialize_game_state(updated_game_state_full.copy())}")
    else:
        print(f"CRITICAL WARNING: updated_game_state_full is None before emitting game_update for room {room}")

    socketio.emit("game_update", serialize_game_state(updated_game_state_full.copy()), room=room)



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