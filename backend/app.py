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
from logging.handlers import RotatingFileHandler
import random
import datetime
import time
from apscheduler.schedulers.background import BackgroundScheduler

######################### CONSTANTS #########################

LOCAL_ROOM_PREFIX = "local_"  # Prefix for local game room IDs
# Grace period for disconnection
GRACE_SECONDS = int(os.getenv("DISC_GRACE_SEC", 90))

######################### APPLICATION INITIALIZATION #########################

# Get CORS origins from environment variable
CORS_ORIGINS = os.getenv('CORS_ORIGINS', 'https://twofoldchess.com').split(',')

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}})
app.config["SECRET_KEY"] = os.getenv('FLASK_SECRET_KEY')

# Create logs directory if it doesn't exist
if not os.path.exists('logs'):
    os.makedirs('logs')

# Configure logging
logging.basicConfig(
    level=logging.INFO,  # Change from DEBUG to INFO for production
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        RotatingFileHandler(
            'logs/app.log',
            maxBytes=10485760,  # 10MB
            backupCount=5
        ),
        logging.StreamHandler()  # Keep console output but with INFO level
    ]
)

logger = logging.getLogger(__name__)

socketio = SocketIO(
    app,
    cors_allowed_origins=CORS_ORIGINS,
    async_mode='eventlet',
    ping_timeout=120,
    ping_interval=30,
    logger=False,
    engineio_logger=False  # Disable engine.io logging in production
)

######################### MONGODB SETUP #########################

mongo_uri = os.getenv("MONGO_URI")
if not mongo_uri:
    raise ValueError("MONGO_URI environment variable is required")
client = MongoClient(mongo_uri)
db = client.chess
games_collection = db.games

######################### SOCKET HANDLERS #########################

@socketio.on('connect')
def handle_connect():
    logger.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    logger.info(f"Client disconnected: {sid}")
    
    game = games_collection.find_one({"socket_ids": {"$in": [sid]}})
    if not game:
        return

    player = next((u for u, s in game["socket_ids"].items() if s == sid), None)
    if not player:
        return

    room = game["room"]
    emit("player_disconnected", {"username": player}, room=room)

    games_collection.update_one(
        {"_id": game["_id"]},
        {
            "$unset": {f"socket_ids.{player}": ""},
            "$set":   {f"disconnected_at.{player}": datetime.datetime.utcnow()}
        }
    )

    leave_room(room)

@socketio.on('error')
def handle_error(error):
    logger.error(f"Socket error: {error}")

@socketio.on('*')
def catch_all(event, data):
    logger.info(f"Received event: {event} with data: {data}")

@socketio.on("vote_reset")
def on_vote_reset(data):
    logger.info("Vote reset event received")
    room = data.get("room")
    color = data.get("color")

    if not room or not color:
        logger.error("Invalid vote reset data received")
        emit("error", {"message": "Invalid vote reset data"})
        return

    try:
        logger.info(f"Processing vote reset for room {room}, color {color}")
        
        # Get current game state
        game_state = games_collection.find_one({"room": room})
        if not game_state:
            logger.error(f"Game state not found for room {room}")
            emit("error", {"message": "Game not found"})
            return

        # Get existing votes and add new vote
        votes = game_state.get("reset_votes", {})
        logger.info(f"Current votes before update: {votes}")
        
        # Add the new vote
        votes[color] = True
        logger.info(f"Votes after adding {color}: {votes}")

        # Update the game state with new votes
        result = games_collection.update_one(
            {"_id": game_state["_id"]},
            {"$set": {"reset_votes": votes}}
        )
        logger.info(f"Database update result: {result.modified_count} documents modified")

        # Verify the update
        updated_state = games_collection.find_one({"_id": game_state["_id"]})
        current_votes = updated_state.get("reset_votes", {})
        logger.info(f"Verified votes in database: {current_votes}")

        # Broadcast vote update
        socketio.emit("reset_votes_update", {"votes": current_votes}, room=room)

        # Check if both colors have voted
        if len(current_votes) == 2:
            logger.info(f"Both players have voted to reset in room {room}")
            
            # Generate new game ID
            new_game_id = str(ObjectId())
            
            # Create initial board
            initial_board = create_initial_board()
            
            # Create new game state with new ID
            reset_state = {
                "_id": new_game_id,
                "room": room,
                "host": game_state.get("host"),
                "is_private": game_state.get("is_private", False),
                "createdAt": datetime.datetime.utcnow(),
                "players": game_state.get("players", []),
                "player_colors": game_state.get("player_colors", {}),
                "socket_ids": game_state.get("socket_ids", {}),
                "mainBoard": initial_board,
                "secondaryBoard": copy.deepcopy(initial_board),
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
                "reset_votes": {},  # Clear votes after reset
                "position_history": {  # Initialize fresh position history
                    "main": [],
                    "secondary": []
                }
            }

            # Delete the old game and insert the new one
            games_collection.delete_one({"_id": game_state["_id"]})
            games_collection.insert_one(reset_state)

            # Clear vote indicators
            socketio.emit("reset_votes_update", {"votes": {}}, room=room)
            # Push new game state
            socketio.emit("game_reset", serialize_game_state(reset_state), room=room)
            logger.info(f"Game reset completed for room {room} with new ID {new_game_id}")

    except Exception as e:
        logger.error(f"Error handling reset vote: {str(e)}")
        emit("error", {"message": "Failed to process reset vote"})

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
    """
    Converts Mongo document to JSON-serializable:
        • ObjectId  → str
        • datetime  → epoch-ms (int)
    Recursive – works with nested structures
        (e.g. last_seen / disconnected_at).
    """

    def _coerce(obj):
        # datetime → milliseconds
        if isinstance(obj, datetime.datetime):
            return int(obj.timestamp() * 1000)
        # ObjectId → str
        if isinstance(obj, ObjectId):
            return str(obj)
        # lists are processed element by element
        if isinstance(obj, list):
            return [_coerce(i) for i in obj]
        # dictionaries are processed key by key
        if isinstance(obj, dict):
            return {k: _coerce(v) for k, v in obj.items()}
        # basic types are returned as is
        return obj

    # Returns a copy; does not modify the original game_state object
    return _coerce(game_state)

######################### ROUTES #########################

# Route: Get all games data
@app.route("/api/games", methods=["GET"])
def get_all_games():
    games = list(games_collection.find(
        {"status": {"$in": ["completed", "draw"]}},
        {"_id": 0}
    ).sort("_id", -1))  # Sort by _id in descending order (newest first)
    return jsonify(games), 200

# Route: Save game data
@app.route("/api/games", methods=["POST"])
def save_game():
    data = request.json
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

    # Only look for ongoing games
    game_state = games_collection.find_one({
        "room": room,
        "status": "ongoing",
        "game_over": {"$ne": True}
    }, {"_id": 0})

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

    if not game_state: # Should be extremely rare
        return

    # Ensure the game_state sent to the client includes all necessary fields
    # This will be the game_state from DB, which now includes the new fields if newly created
    # or if fetched after a reset.
    final_game_state_for_client = games_collection.find_one({
        "room": room,
        "status": "ongoing",
        "game_over": {"$ne": True}
    })
    if final_game_state_for_client: # Should always exist here
        emit("game_state", serialize_game_state(final_game_state_for_client), room=room)
    else:
        # This case should ideally not happen if insert_one or update_one in reset worked
        print(f"ERROR: Game state not found for room {room} after join/creation attempt.")


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
        # Check if room exists and is active
        game_state = games_collection.find_one({
            "room": room,
            "status": "ongoing",  # Only check for ongoing games
            "game_over": {"$ne": True}  # Ensure game is not over
        })
        if not game_state:
            logger.error(f"Game state not found for room {room} or game is not active")
            emit("error", {"message": "Game not found or not active"})
            return

        # Check if room is full
        if len(game_state.get("players", [])) >= 2:
            logger.error(f"Room {room} is full")
            emit("error", {"message": "Room is full"})
            return

        # Join the room
        join_room(room)
        logger.info(f"{username} joined room {room}")
        
        # Store socket ID for this player
        if "socket_ids" not in game_state:
            game_state["socket_ids"] = {}
        game_state["socket_ids"][username] = request.sid
        
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
                {"_id": game_state["_id"]},  # Use game ID for update
                {
                    "$set": {
                        "players": game_state["players"],
                        "player_colors": game_state["player_colors"],
                        "socket_ids": game_state["socket_ids"]
                    }
                }
            )
            
            # Notify both players
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
        final_game_state_for_client = games_collection.find_one({"_id": game_state["_id"]})  # Use game ID for lookup
        if final_game_state_for_client:
            emit("game_state", serialize_game_state(final_game_state_for_client), room=room)
            logger.info(f"Game state sent to {username} in room {room}")
        else:
            logger.error(f"Game state not found for room {room} after join attempt")
        
        # Broadcast updated lobby list to all clients
        lobbies = list(games_collection.find(
            {"is_private": False, "players.1": {"$exists": False}, "status": "ongoing", "game_over": {"$ne": True}},
            {"room": 1, "host": 1, "is_private": 1, "createdAt": 1, "_id": 0}
        ).sort("createdAt", -1))
        for lobby in lobbies:
            if isinstance(lobby.get("createdAt"), datetime.datetime):
                lobby["createdAt"] = int(lobby["createdAt"].timestamp() * 1000)
        socketio.emit("lobby_list", lobbies)

        # leima aktiiviseksi
        _touch_player(game_state["_id"], username)
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

        # leima aktiiviseksi
        _touch_player(games_collection.find_one({"room": room})["_id"], sender)
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
        game_state = games_collection.find_one({"room": room, "status": "ongoing"})
        if game_state:
            if username in game_state.get("players", []):
                # Notify other players before removing the player
                emit("player_disconnected", {"message": "Player disconnected"}, room=room)
                
                # Remove the player from the game state
                game_state["players"].remove(username)
                if username in game_state.get("player_colors", {}):
                    del game_state["player_colors"][username]
                if username in game_state.get("socket_ids", {}):
                    del game_state["socket_ids"][username]
                
                # If no players left, mark the game as completed due to disconnection
                if not game_state["players"]:
                    logger.info(f"Marking game {room} as completed due to disconnection")
                    game_state["status"] = "completed"
                    game_state["end_reason"] = "disconnection"
                    game_state["game_over"] = True
                    
                    # Only save to history if the game was properly completed (not due to disconnection)
                    if game_state.get("winner") and game_state.get("end_reason") != "disconnection":
                        completed_game_data = {
                            "room": room,
                            "winner": game_state.get("winner"),
                            "checkmate_board": game_state.get("checkmate_board"),
                            "moves": game_state.get("moves", []),
                            "status": "completed",
                            "status_message": f"{game_state.get('winner')} wins by {game_state.get('end_reason')}",
                            "end_reason": game_state.get("end_reason"),
                            "main_board_outcome": game_state.get("main_board_outcome"),
                            "secondary_board_outcome": game_state.get("secondary_board_outcome")
                        }
                        games_collection.insert_one(completed_game_data)
                        logger.info(f"Game {room} saved to history")
                    
                    # Delete the game document since it's no longer needed
                    games_collection.delete_one({"_id": game_state["_id"]})
                    logger.info(f"Deleted completed game {room}")
                    
                    # Broadcast room deletion to all clients
                    socketio.emit("room_deleted", {"room": room})
                else:
                    # Update the game state without marking it as completed
                    games_collection.update_one(
                        {"_id": game_state["_id"]},
                        {
                            "$set": {
                                "players": game_state["players"],
                                "player_colors": game_state["player_colors"],
                                "socket_ids": game_state["socket_ids"]
                            }
                        }
                    )
                    logger.info(f"Updated game state after {username} left")
        
        # Broadcast updated lobby list
        lobbies = list(games_collection.find(
            {"is_private": False, "players.1": {"$exists": False}, "status": "ongoing", "game_over": {"$ne": True}},
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
                "status": "ongoing",
                "game_over": {"$ne": True},  # Don't show games that are over
                "players": {"$exists": True, "$ne": []},  # Has at least one player
                "players.1": {"$exists": False},  # Not full (no second player)
                "$expr": {"$gt": [{"$size": "$players"}, 0]},  # Ensure players array is not empty
                "socket_ids": {"$exists": True}  # Must have socket IDs
            },
            {"room": 1, "host": 1, "is_private": 1, "createdAt": 1, "_id": 0}
        ).sort("createdAt", -1))  # Sort by creation time, newest first
        
        # Clean up any empty rooms or games that are over
        games_collection.delete_many({
            "$or": [
                {"status": "ongoing", "game_over": True},  # Delete games that are over
                {"status": "ongoing", "players": {"$exists": False}},  # No players field
                {"status": "ongoing", "players": []},  # Empty players array
                {"status": "ongoing", "players": None},  # Null players
                {"status": "ongoing", "players.0": {"$exists": False}},  # No first player
                {"status": "ongoing", "socket_ids": {"$exists": False}}  # No socket IDs
            ]
        })
        
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

def validate_room_code(room_id: str) -> bool:
    """
    Validate room code format:
    - Max length of 30 characters
    - Only alphanumeric characters and underscores allowed
    """
    if not room_id or len(room_id) > 30:
        return False
    return all(c.isalnum() or c == '_' for c in room_id)

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

        # Validate room code format
        if not validate_room_code(room_id):
            logger.error(f"Invalid room code format: {room_id}")
            emit("error", {"message": "Room code must be alphanumeric and max 30 characters"})
            return

        # Generate a unique game ID
        game_id = str(ObjectId())

        # First, clean up any stale rooms with this name, but ONLY ongoing games
        games_collection.delete_many({
            "room": room_id,
            "status": "ongoing",  # Only delete ongoing games
            "$or": [
                {"game_over": True},
                {"players": {"$exists": False}},
                {"players": []},
                {"players": None},
                {"players.0": {"$exists": False}},
                {"socket_ids": {"$exists": False}}
            ]
        })

        # Check if room exists and is active
        existing_room = games_collection.find_one({
            "room": room_id,
            "status": "ongoing",  # Only check for ongoing games
            "game_over": {"$ne": True}  # Ensure game is not over
        })
        if existing_room:
            logger.error(f"Room {room_id} already exists and is active")
            emit("error", {"message": "Room already exists"})
            return

        # Randomly assign host's color
        host_color = random.choice(["White", "Black"])

        # Create initial game state with ALL required fields explicitly set
        initial_board = create_initial_board()
        current_time = datetime.datetime.utcnow()
        game_state = {
            "_id": game_id,  # Add unique game ID
            "room": room_id,
            "host": host,
            "is_private": is_private,
            "createdAt": current_time,
            "players": [host],
            "player_colors": {host: host_color},
            "socket_ids": {host: request.sid},  # Store socket ID for host
            "mainBoard": initial_board,
            "secondaryBoard": copy.deepcopy(initial_board),  # Ensure distinct copy
            "turn": "White",  # Explicitly set turn
            "active_board_phase": "main",
            "moves": [],
            "winner": None,
            "status": "ongoing",
            "status_message": "",
            "main_board_outcome": "active",
            "secondary_board_outcome": "active",
            "game_over": False,
            "is_responding_to_check_on_board": None,
            "castling_rights": {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}},
            "en_passant_target": {"main": None, "secondary": None},
            "reset_votes": {},  # Track reset votes
            "position_history": {  # Initialize position history
                "main": [],
                "secondary": []
            }
        }

        # Insert the new game state
        games_collection.insert_one(game_state)
        logger.info(f"Created new lobby: {room_id} by {host} as {host_color}")

        # Join the room
        join_room(room_id)

        # Get updated lobby list and convert datetime to timestamp
        lobbies = list(games_collection.find(
            {"is_private": False, "players.1": {"$exists": False}, "status": "ongoing", "game_over": {"$ne": True}},
            {"room": 1, "host": 1, "is_private": 1, "createdAt": 1, "_id": 0}
        ))
        for lobby in lobbies:
            if isinstance(lobby.get("createdAt"), datetime.datetime):
                lobby["createdAt"] = int(lobby["createdAt"].timestamp() * 1000)

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
        return

    try:
        # First check if the game exists (either ongoing or local)
        existing_game = games_collection.find_one({
            "room": room,
            "$or": [
                {"status": "ongoing"},
                {"room": {"$regex": "^local_"}}  # Match local game rooms
            ]
        })
        
        if not existing_game:
            return

        # Generate a new game ID
        new_game_id = str(ObjectId())

        initial_board = create_initial_board()
        game_state = {
            "_id": new_game_id,  # New game ID
            "room": room,
            "host": existing_game.get("host"),
            "is_private": existing_game.get("is_private", False),
            "createdAt": datetime.datetime.utcnow(),
            "players": existing_game.get("players", []),
            "player_colors": existing_game.get("player_colors", {}),
            "socket_ids": existing_game.get("socket_ids", {}),
            "mainBoard": initial_board,
            "secondaryBoard": copy.deepcopy(initial_board),
            "turn": "White",
            "active_board_phase": "main",
            "moves": [],
            "winner": None,
            "status": "ongoing",
            "status_message": "",
            "main_board_outcome": "active",
            "secondary_board_outcome": "active",
            "game_over": False,
            "is_responding_to_check_on_board": None,
            "castling_rights": {"White": {"K": True, "Q": True}, "Black": {"K": True, "Q": True}},
            "en_passant_target": {"main": None, "secondary": None},
            "reset_votes": {},  # Clear reset votes
            "position_history": {  # Initialize fresh position history
                "main": [],
                "secondary": []
            }
        }

        # Delete the old game and insert the new one
        games_collection.delete_one({"_id": existing_game["_id"]})
        games_collection.insert_one(game_state)

        # Emit the new game state
        socketio.emit("game_reset", serialize_game_state(game_state), room=room)
    except Exception as e:
        logger.error(f"Error resetting game: {str(e)}")
        emit("error", {"message": "Failed to reset game"})

# WebSocket: Handle move events
@socketio.on("move")
def on_move(data):
    room = data.get("room")
    board_type_played = data.get("boardType") # "main" or "secondary"
    move_details = data.get("move") # {"from": [r,c], "to": [r,c], "piece": "P1", "captured": null, ...}

    if not room or not board_type_played or not move_details:
        emit("move_error", {"message": "Invalid move data received."})
        return

    # leima aktiiviseksi tämän socket-ID:n perusteella
    active_username = next(
        (u for u, s in games_collection
            .find_one({"room": room})
            .get("socket_ids", {}).items() if s == request.sid), None)
    if active_username:
        _touch_player(games_collection.find_one({"room": room})["_id"], active_username)

    # Only look for ongoing games
    game_doc_cursor = games_collection.find_one({
        "room": room,
        "status": "ongoing",
        "game_over": {"$ne": True}
    })
    if not game_doc_cursor:
        emit("move_error", {"message": "Game not found or not active."})
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
                "status_message": "Game over. Draw by threefold repetition on both boards.",
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
                found = False
                for r in range(8):
                    for c in range(8):
                        if game_doc["secondaryBoard"][r][c] == captured_piece:
                            game_doc["secondaryBoard"][r][c] = None
                            found = True
                            break
                    if found:
                        break
                if not found:
                    pass  # Silently continue if piece not found
            else:
                pass  # Silently continue if no captured piece
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
            else:
                # No captured piece on secondary board
                pass

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
        game_doc["status_message"] = f"{current_player_color} wins by checkmate on {board_type_played} board."
        
        # Save the completed game
        completed_game_data = {
            "room": room,
            "winner": game_doc["winner"],
            "checkmate_board": board_type_played,  # Add which board the checkmate occurred on
            "moves": game_doc["moves"],
            "status": "completed",
            "status_message": f"{current_player_color} wins by checkmate on {board_type_played} board.",
            "end_reason": "checkmate",
            "main_board_outcome": game_doc["main_board_outcome"],
            "secondary_board_outcome": game_doc["secondary_board_outcome"]
        }
        games_collection.insert_one(completed_game_data)
        
        # Create update doc without _id
        update_doc = {k: v for k, v in game_doc.items() if k != '_id'}
        games_collection.update_one({"_id": game_doc["_id"]}, {"$set": update_doc})
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
            game_doc["status"] = "completed"
            game_doc["status_message"] = f"{current_player_color} wins by checkmate on {board_type_played} board (after escaping check)."
        update_doc = {k: v for k, v in game_doc.items() if k != '_id'}
        games_collection.update_one({"_id": game_doc["_id"]}, {"$set": update_doc})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return

    # 3. Current player delivered a check (and it wasn't a mate, handled by #1)
    elif is_king_in_check(board_played_state, opponent_color):
        game_doc["turn"] = opponent_color
        game_doc["active_board_phase"] = board_type_played
        game_doc["is_responding_to_check_on_board"] = board_type_played
        game_doc["status_message"] = f"{opponent_color} is in check on {board_type_played} board."
        update_doc = {k: v for k, v in game_doc.items() if k != '_id'}
        games_collection.update_one({"_id": game_doc["_id"]}, {"$set": update_doc})
        socketio.emit("game_update", serialize_game_state(game_doc), room=room)
        return

    # 4. Current player caused Stalemate for opponent
    if is_stalemate(board_played_state, opponent_color):
        if game_doc[board_played_outcome_field] == "active":
            game_doc[board_played_outcome_field] = "draw_stalemate"
            game_doc["status"] = "draw"
            game_doc["status_message"] = "Game over. Draw by stalemate on both boards."
            
            # Check if both boards are now drawn
            if (game_doc["main_board_outcome"] == "draw_stalemate" and 
                game_doc["secondary_board_outcome"] == "draw_stalemate"):
                game_doc["game_over"] = True
                game_doc["winner"] = "Draw"
                game_doc["status"] = "draw"
                game_doc["status_message"] = "Game over. Draw by stalemate on both boards."
                
                # Save the completed game
                completed_game_data = {
                    "room": room,
                    "winner": "Draw",
                    "checkmate_board": None,  # No checkmate board for draws
                    "moves": game_doc["moves"],
                    "status": "draw",
                    "status_message": "Draw recorded (threefold repetition)",
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
        game_doc["status_message"] = f"Game over. Winner: {game_doc['winner']}."
        if game_doc["winner"] == "Draw":
            game_doc["status"] = "draw"
            game_doc["status_message"] = "Game over. Draw."
    
    # Create a copy of game_doc without the _id field for the update
    update_doc = {k: v for k, v in game_doc.items() if k != '_id'}
    # Use the game's _id for the update
    games_collection.update_one({"_id": game_doc["_id"]}, {"$set": update_doc})
    socketio.emit("game_update", serialize_game_state(game_doc), room=room)

# WebSocket: Handle finishing game
@socketio.on("finish_game")
def on_finish_game(data):
    room = data.get("room")
    winner = data.get("winner")
    board = data.get("board")
    moves = data.get("moves")

    if not room or not winner or not board or not moves:
        return

    completed_game_data = {
        "room": room,
        "winner": winner,
        "board": board,
        "moves": moves,
        "status": "completed",
        "status_message": f"{winner} wins by {moves[-1].split(': ')[1]}",
    }
    games_collection.insert_one(completed_game_data)

    initial_board = create_initial_board()
    reset_game_state = {
        "mainBoard": initial_board,
        "secondaryBoard": initial_board,
        "turn": "White",
        "moves": [],
        "status": "ongoing",
        "status_message": "",
    }
    games_collection.update_one(
        {"room": room},
        {"$set": reset_game_state},
        upsert=True
    )

    socketio.emit("game_reset", reset_game_state, room=room)

######################### MAIN EXECUTION #########################

def cleanup_stale_rooms():
    """Armonaika-tietoinen siivous.
       • Jos yksi pelaaja poissa > GRACE_SECONDS → forfeit-voitto toiselle  
       • Jos kaikki poissa > GRACE_SECONDS → huone poistetaan"""
    try:
        now = datetime.datetime.utcnow()
        deadline = now - datetime.timedelta(seconds=GRACE_SECONDS)

        # Poista "disconnected_at" niiltä jotka jo palasivat
        games_collection.update_many(
            {"disconnected_at": {"$exists": True}},
            {"$pull": {"disconnected_at": {"$gt": deadline}}}
        )

        for g in games_collection.find(
            {"status": "ongoing", "game_over": False,
             "disconnected_at": {"$exists": True}}
        ):
            long_gone = [p for p, t in g["disconnected_at"].items() if t and t < deadline]
            if not long_gone:
                continue

            alive = [p for p in g["players"] if p not in long_gone]

            if alive:
                winner = alive[0]
                games_collection.update_one(
                    {"_id": g["_id"]},
                    {"$set": {"game_over": True,
                              "status": "Opponent disconnected - forfeit",
                              "winner": winner,
                              "status_message": f"Opponent disconnected - forfeit: {winner}"}}
                )
                socketio.emit(
                    "game_update",
                    serialize_game_state(
                        {**g, "game_over": True,
                         "status": "Opponent disconnected - forfeit",
                         "winner": winner,
                         "status_message": f"Opponent disconnected - forfeit: {winner}"}
                    ),
                    room=g["room"]
                )
            else:
                games_collection.delete_one({"_id": g["_id"]})
                socketio.emit("room_deleted", {"room": g["room"]})

    except Exception as e:
        logger.error(f"cleanup error: {e}")

# Add cleanup call to the main execution block
if __name__ == "__main__":
    # Initial cleanup
    cleanup_stale_rooms()
    # Set up periodic cleanup
    scheduler = BackgroundScheduler()
    scheduler.add_job(cleanup_stale_rooms, 'interval', seconds=30)  # Run cleanup every 30 seconds
    scheduler.start()
    socketio.run(app, host="0.0.0.0", port=8080)

@app.route("/api/health", methods=["GET"])
def health_check():                    # docker-compose uses this
    return {"status": "ok"}, 200

# --------------------------------------------------------------------
# Päivitä pelaajan "viimeksi nähty" -leima aina kun hänestä kuullaan
# --------------------------------------------------------------------
def _touch_player(game_id: str, username: str) -> None:
    """Merkkaa käyttäjä aktiiviseksi ja nollaa mahdollinen disconnected_at"""
    games_collection.update_one(
        {"_id": game_id},
        {"$set": {
            f"last_seen.{username}": datetime.datetime.utcnow(),
            f"disconnected_at.{username}": None          # tyhjennä jos oli
        }}
    )