from flask import Flask, jsonify, request
from pymongo import MongoClient
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

client = MongoClient(os.getenv("MONGO_URI", "mongodb://mongo:27017/chess"))
db = client.chess

@app.route("/api/boards", methods=["GET"])
def get_boards():
    boards = list(db.boards.find({}, {"_id": 0}))
    return jsonify(boards)

@app.route("/api/boards", methods=["POST"])
def create_board():
    board_data = request.json
    db.boards.insert_one(board_data)
    return jsonify(board_data), 201

@app.route("/api/boards/<game_id>", methods=["GET"])
def get_board(game_id):
    board = db.boards.find_one({"game_id": game_id}, {"_id": 0})
    if board:
        return jsonify(board)
    else:
        return jsonify({"error": "Board not found"}), 404

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
