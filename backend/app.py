from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, leave_room, emit
from pymongo import MongoClient
import os

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
app.config["SECRET_KEY"] = "lalalalala"
socketio = SocketIO(app, cors_allowed_origins="*")

# MongoDB setup
mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/chess")
client = MongoClient(mongo_uri)
db = client.chess
games_collection = db.games

def create_initial_board(is_white_bottom=True):
    empty_row = [None] * 8
    white_pieces = ["R", "N", "B", "Q", "K", "B", "N", "R"]
    black_pieces = [p.lower() for p in white_pieces]
    white_pawns = "P"
    black_pawns = "p"

    return [
        black_pieces if is_white_bottom else white_pieces,
        [black_pawns] * 8 if is_white_bottom else [white_pawns] * 8,
        *[empty_row.copy() for _ in range(4)],
        [white_pawns] * 8 if is_white_bottom else [black_pawns] * 8,
        white_pieces if is_white_bottom else black_pieces,
    ]

# Route: Get all games data
@app.route("/api/games", methods=["GET"])
def get_all_games():
    games = list(games_collection.find({}, {"_id": 0}))
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
    if not data or "room" not in data or "winner" not in data or "board" not in data or "moves" not in data:
        return jsonify({"error": "Invalid data"}), 400

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


# WebSocket: Handle player joining a room
@socketio.on("join")
def on_join(data):
    room = data.get("room")
    username = data.get("username")

    if not room or not username:
        return

    join_room(room)
    game_state = games_collection.find_one({"room": room}, {"_id": 0})

    if not game_state:
        initial_board = create_initial_board()
        game_state = {
            "mainBoard": initial_board,
            "secondaryBoard": initial_board,
            "turn": "White",
            "moves": [],
        }

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


# WebSocket: Handle move events
@socketio.on("move")
def on_move(data):
    room = data.get("room")
    board_type = data.get("boardType")
    board = data.get("board")
    move = data.get("move")

    if not room or not board_type or not board or not move:
        return

    if isinstance(move, dict):
        from_pos = f"{chr(97 + move['from'][1])}{8 - move['from'][0]}"
        to_pos = f"{chr(97 + move['to'][1])}{8 - move['to'][0]}"
        move = f"Moved from {from_pos} to {to_pos}"

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



# WebSocket: Handle finishing game
@socketio.on("finish_game")
def on_finish_game(data):
    room = data.get("room")
    winner = data.get("winner")
    board = data.get("board")

    if not room or not winner or not board:
        return

    game_state = games_collection.find_one({"room": room}, {"_id": 0})
    if game_state:
        games_collection.update_one(
            {"room": room},
            {"$set": {"winner": winner, "checkmateBoard": board}},
        )
        emit("game_finished", {"winner": winner, "board": board}, room=room)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)