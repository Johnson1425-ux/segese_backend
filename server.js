import 'dotenv/config';
import 'express-async-errors';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import hpp from 'hpp';
import path from 'path';
import { fileURLToPath } from 'url';

// Import middleware and routes
import connectDB from './config/database.js';
import errorHandler from './middleware/errorHandler.js';
import logger from './utils/logger.js';

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import patientRoutes from './routes/patients.js';
import doctorRoutes from './routes/doctors.js';
import surgeonRoutes from './routes/surgeons.js';
import nurseRoutes from './routes/nurses.js';
import departmentRoutes from './routes/departments.js';
import appointmentRoutes from './routes/appointments.js';
import visitRoutes from './routes/visits.js';
import wardRoutes from './routes/wards.js';
import bedRoutes from './routes/beds.js';
import ipdRecordRoutes from './routes/ipd-records.js';
import dashboardRoutes from './routes/dashboard.js';
import labTestRoutes from './routes/labTests.js';
import radiologyRoutes from './routes/radiology.js';
import theatreRoutes from './routes/theatres.js';
import theatreProcedureRoutes from './routes/theatre-procedures.js';
import prescriptionRoutes from './routes/prescriptions.js';
import medicineRoutes from './routes/medicines.js';
import billingRoutes from './routes/billing.js';
import serviceRoutes from './routes/services.js';
import stockRoutes from './routes/stock.js';
import dispensingRoutes from './routes/dispensing.js';
import directDispensingRoutes from './routes/directDispensing.js';
import requisitionRoutes from './routes/requisitions.js';
import itemPricingRoutes from './routes/itemPricing.js';
import itemReceivingRoutes from './routes/itemReceiving.js';
import incomingItemsRoutes from './routes/incomingItems.js';
import corpsesRoutes from './routes/corpses.js';
import cabinetRoutes from './routes/cabinets.js';
import releaseRoutes from './routes/releases.js';

// Load environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy - MUST be before rate limiting
// This is required when behind reverse proxies (Render, Heroku, nginx, etc.)
app.set('trust proxy', 1);

// Connect to Database
connectDB();

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Prevent parameter pollution
app.use(hpp());

// CORS configuration - UPDATED FOR REMOTE ACCESS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5000',
  'https://localhost:3000',
  'https://localhost:5000',
  'http://192.168.43.25:3000',
];

// Add FRONTEND_URL from env if it exists
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
  // Also add version without trailing slash
  allowedOrigins.push(process.env.FRONTEND_URL.replace(/\/$/, ''));
}

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // In development, allow devtunnels and github.dev domains
    if (process.env.NODE_ENV === 'development') {
      if (origin.endsWith('.devtunnels.ms') || 
          origin.endsWith('.preview.app.github.dev') ||
          /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin) ||
          /^http:\/\/172\.\d+\.\d+\.\d+:\d+$/.test(origin) ||
          /^http:\/\/10\.\d+\.\d+\.\d+:\d+$/.test(origin)) {
        return callback(null, true);
      }
    }
    
    console.log(`❌ CORS blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }));
}

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Hospital Management API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/surgeons', surgeonRoutes);
app.use('/api/nurses', nurseRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/wards', wardRoutes);
app.use('/api/beds', bedRoutes);
app.use('/api/ipd-records', ipdRecordRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/lab-tests', labTestRoutes);
app.use('/api/radiology', radiologyRoutes);
app.use('/api/theatres', theatreRoutes);
app.use('/api/theatre-procedures', theatreProcedureRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/dispensing', dispensingRoutes);
app.use('/api/direct-dispensing', directDispensingRoutes);
app.use('/api/requisitions', requisitionRoutes);
app.use('/api/item-pricing', itemPricingRoutes);
app.use('/api/item-receiving', itemReceivingRoutes);
app.use('/api/incoming-items', incomingItemsRoutes);
app.use('/api/corpses', corpsesRoutes);
app.use('/api/cabinets', cabinetRoutes);
app.use('/api/releases', releaseRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`,
  });
});

// Error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Bind to 0.0.0.0 for remote access
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  logger.info(`Server accessible at http://0.0.0.0:${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  logger.error(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error(`Error: ${err.message}`);
  process.exit(1);
});

export default server;
