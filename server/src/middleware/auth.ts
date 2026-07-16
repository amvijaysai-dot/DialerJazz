import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getInsforgeClient } from '../lib/insforge.js';
import { ApiError } from './errorHandler.js';

export interface AuthenticatedRequest extends Request {
  user?: any;
  db?: ReturnType<typeof getInsforgeClient>;
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new ApiError(401, 'Missing or unsupported authorization header', 'missing_token');
    }

    const token = authHeader.split(' ')[1];

    // Decode the JWT to get the user payload
    const decoded = jwt.decode(token) as any;
    
    if (!decoded || !decoded.sub) {
      throw new ApiError(401, 'Invalid or expired token.', 'invalid_token');
    }

    if (decoded.exp && Date.now() >= decoded.exp * 1000) {
      throw new ApiError(401, 'JWT expired', 'expired_token');
    }

    // Set user info from JWT
    req.user = { id: decoded.sub, email: decoded.email, role: decoded.role };
    
    // Create admin client with service key for database operations
    // The service key bypasses RLS, but we still scope queries to the user's ID
    req.db = getInsforgeClient();
    
    next();
  } catch (error) {
    next(error);
  }
};