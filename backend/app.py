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
    print(f"{username} joined room {room}")  # Debugging log
    game_state = games_collection.find_one({"room": room}, {"_id": 0})

    if not game_state:
        print(f"Creating initial game state for room: {room}")
        initial_board = create_initial_board()
        game_state = {
            "room": room,
            "mainBoard": initial_board,
            "secondaryBoard": initial_board,
            "turn": "White",
            "moves": [],
        }
        games_collection.insert_one(game_state)
        print(f"Initialized game state for room {room}: {game_state}")

    game_state = serialize_game_state(game_state)
    print(f"Game state for room {room} after join:", game_state)
    emit("game_state", game_state, room=room)
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
    board = data.get("board")
    move = data.get("move")

    if not room or not board_type or not board or not move:
        print("Invalid data in move event:", data)
        return

    piece = move.get("piece")
    from_pos = move.get("from")
    to_pos = move.get("to")
    captured = move.get("captured", None)

    if not piece or not from_pos or not to_pos:
        print("Invalid move data:", move)
        return

    game_state = games_collection.find_one({"room": room}, {"_id": 0})
    if not game_state:
        print(f"Game state not found for room {room}. Initializing game state.")
        initial_board = create_initial_board()
        game_state = {
            "room": room,
            "mainBoard": initial_board,
            "secondaryBoard": initial_board,
            "turn": "White",
            "moves": [],
            "status": "ongoing",
        }
        games_collection.insert_one(game_state)

    print(f"Current game state for room {room}: {game_state}")

    from_pos_str = f"{chr(97 + from_pos[1])}{8 - from_pos[0]}"
    to_pos_str = f"{chr(97 + to_pos[1])}{8 - to_pos[0]}"

    if captured:
        move_description = f"{piece} captured {captured} at {to_pos_str} on {board_type} board"
    else:
        move_description = f"{piece} moved from {from_pos_str} to {to_pos_str} on {board_type} board"

    update_field = {
        "mainBoard": board if board_type == "main" else game_state["mainBoard"],
        "secondaryBoard": board if board_type == "secondary" else game_state["secondaryBoard"],
    }

    if captured and board_type == "main":
        secondary_board = game_state["secondaryBoard"]
        for row in secondary_board:
            for col_index, cell in enumerate(row):
                if cell == captured:
                    row[col_index] = None
                    break
        update_field["secondaryBoard"] = secondary_board

    games_collection.update_one(
        {"room": room},
        {"$set": update_field, "$push": {"moves": move_description}},
    )

    game_state = games_collection.find_one({"room": room}, {"_id": 0})
    print(f"Updated game state for room {room}: {game_state}")

    socketio.emit("game_update", game_state, room=room)



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