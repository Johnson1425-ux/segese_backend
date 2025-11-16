import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'user-service' },
  transports: [
    //
    // - Write all logs with importance level of `error` or less to `/tmp/logs/error.log`
    // - Write all logs with importance level of `info` or less to `/tmp/logs/combined.log`
    //
    // **CRITICAL FIX: Changed paths to use the Vercel/Lambda writable directory /tmp/**
    new winston.transports.File({ filename: '/tmp/logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: '/tmp/logs/combined.log' }),
  ],
  exceptionHandlers: [
    // **CRITICAL FIX: Changed paths to use the Vercel/Lambda writable directory /tmp/**
    new winston.transports.File({ filename: '/tmp/logs/exceptions.log' })
  ]
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

export default logger;