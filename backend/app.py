from flask import Flask, jsonify, request
from pymongo import MongoClient
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app)

client = MongoClient(os.getenv("MONGO_URI", "mongodb://mongo:27017/chess"))
db = client.chess

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
