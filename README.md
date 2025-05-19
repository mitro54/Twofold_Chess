# Twofold Chess

Is a modern take on original chess using two "stacked" boards, where each player has two moves per turn, one for each board.


## General Board Rules

- Normal Chess moves.
- If either board ends up in Checkmate, game ends.
- If either board is in Stalemate, rest of the game is played normally on the other board.
  
- If player gets in a Check, player is only allowed to move the boards pieces they are checked in to get out of Check.
- If player causes a Check, player is not allowed to make more moves. Turn changes immediately to the defender.

- En passant move in either board captures the pawn from both boards.
- Castling is only allowed in one board per game.

## Specified Board Rules

Main Board
- Capturing a piece affects the same piece in Secondary board.

Secondary Board
- Capturing a piece does not affect the same piece in Main board, only exception is En passant.

## Setting up
- To run this project on your computer / server properly, you will need to set up the .env file in the root folder
- Before running the project for the first time, make sure to change the .env.example file name to just .env
- If you have issues with building the project in Docker or have Internal server error, make sure your .env file contains correct information.
