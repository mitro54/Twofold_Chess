import { Server } from 'socket.io';
import { logger } from '../utils/logger';

export const setupSocketHandlers = (io: Server) => {
  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });

    // Add your game-specific socket handlers here
    socket.on('joinGame', (gameId: string) => {
      socket.join(gameId);
      logger.info(`Client ${socket.id} joined game ${gameId}`);
    });

    socket.on('leaveGame', (gameId: string) => {
      socket.leave(gameId);
      logger.info(`Client ${socket.id} left game ${gameId}`);
    });

    socket.on('makeMove', (data: { gameId: string; move: any }) => {
      io.to(data.gameId).emit('moveMade', data.move);
      logger.info(`Move made in game ${data.gameId} by ${socket.id}`);
    });
  });
}; 