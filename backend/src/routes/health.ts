import { Router } from 'express';
import mongoose from 'mongoose';
import { logger } from '../utils/logger';

const router = Router();

// Basic health check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Detailed health check
router.get('/health/detailed', async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    const memoryUsage = process.memoryUsage();
    
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: {
        status: dbStatus,
        readyState: mongoose.connection.readyState,
      },
      memory: {
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
      },
      environment: process.env.NODE_ENV,
    };

    res.status(200).json(healthData);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({ status: 'error', message: 'Health check failed' });
  }
});

export default router; 