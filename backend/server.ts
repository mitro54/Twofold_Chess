import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import environment from "./src/config/environment";
import { setupSocketHandlers } from "./src/socket/socketHandlers";
import { connectDB } from "./src/database/connection";
import { errorHandler } from "./src/middleware/errorHandler";
import { logger } from "./src/utils/logger";
import healthRoutes from "./src/routes/health";

const app = express();
const httpServer = createServer(app);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: environment.corsOrigin,
  methods: ['GET', 'POST'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Health check routes
app.use('/', healthRoutes);

// Socket.IO setup with production settings
const io = new Server(httpServer, {
  cors: {
    origin: environment.corsOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ['websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Connect to database
connectDB()
  .then(() => {
    logger.info('Connected to database');
  })
  .catch((error) => {
    logger.error('Database connection error:', error);
    process.exit(1);
  });

// Setup socket handlers
setupSocketHandlers(io);

// Error handling middleware
app.use(errorHandler);

// Start server
const PORT = environment.port;
httpServer.listen(PORT, () => {
  logger.info(`Server running in ${environment.isProduction ? 'production' : 'development'} mode`);
  logger.info(`Server listening on port ${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Rejection:', error);
  process.exit(1);
}); 