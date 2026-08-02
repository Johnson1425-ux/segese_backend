import logger from '../utils/logger.js';

/**
 * Central error handler.
 *
 * Client-facing messages are only ever taken from errors we have classified
 * below. Anything unrecognised is reported as a generic 500 so that driver,
 * database and stack details are not leaked to callers — the full error is
 * still written to the server log.
 */
const errorHandler = (err, req, res, next) => {
  logger.error(err.stack || err.message);

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Server Error';
  let safe = Boolean(err.statusCode); // errors we raised deliberately

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    statusCode = 404;
    message = 'Resource not found';
    safe = true;
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 400;
    message = 'Duplicate field value entered';
    safe = true;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((val) => val.message).join(', ');
    safe = true;
  }

  // JSON Web Token errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Not authorized to access this route';
    safe = true;
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Session expired, please log in again';
    safe = true;
  }

  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Invalid JSON payload';
    safe = true;
  }

  if (!safe && process.env.NODE_ENV === 'production') {
    message = 'Server Error';
  }

  res.status(statusCode).json({
    success: false,
    error: message,
  });
};

export default errorHandler;
