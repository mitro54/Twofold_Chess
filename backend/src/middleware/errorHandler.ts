import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import environment from '../config/environment';

interface CustomError extends Error {
  statusCode?: number;
}

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  
  // Log error
  logger.error('Error:', {
    error: err.message,
    stack: environment.isProduction ? undefined : err.stack,
    path: req.path,
    method: req.method,
  });

  // Send response
  res.status(statusCode).json({
    error: {
      message: environment.isProduction 
        ? 'An error occurred' 
        : err.message,
      ...(environment.isProduction ? {} : { stack: err.stack }),
    },
  });
}; 