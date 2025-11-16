import { validationResult } from 'express-validator';

// Middleware to handle validation errors
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const extractedErrors = [];
    errors.array().map(err => extractedErrors.push({ [err.param]: err.msg }));
    
    return res.status(422).json({
      status: 'error',
      message: 'Validation failed',
      errors: extractedErrors
    });
  }
  next();
};

// Common validation rules
export const validationRules = {
  email: {
    in: ['body'],
    isEmail: {
      errorMessage: 'Please provide a valid email address'
    },
    normalizeEmail: true,
    trim: true
  },
  
  phone: {
    in: ['body'],
    matches: {
      options: /^[\+]?[1-9][\d]{0,15}$/,
      errorMessage: 'Please provide a valid phone number'
    },
    trim: true
  },
  
  password: {
    in: ['body'],
    isLength: {
      errorMessage: 'Password must be at least 8 characters long',
      options: { min: 8 }
    },
    matches: {
      options: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      errorMessage: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
    }
  },
  
  name: {
    in: ['body'],
    isLength: {
      errorMessage: 'Name must be between 2 and 50 characters',
      options: { min: 2, max: 50 }
    },
    trim: true,
    escape: true
  },
  
  date: {
    in: ['body'],
    isISO8601: {
      errorMessage: 'Please provide a valid date'
    },
    toDate: true
  },
  
  mongoId: {
    in: ['params'],
    isMongoId: {
      errorMessage: 'Invalid ID format'
    }
  }
};

// Sanitization middleware
export const sanitizeInput = (req, res, next) => {
  // Recursively sanitize all string inputs
  const sanitize = (obj) => {
    for (let key in obj) {
      if (typeof obj[key] === 'string') {
        // Remove any HTML tags and trim whitespace
        obj[key] = obj[key].replace(/<[^>]*>/g, '').trim();
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitize(obj[key]);
      }
    }
  };
  
  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  
  next();
};

// Create validation middleware file: middleware/validation.js
import { body, validationResult } from 'express-validator';

export const validateCorpseRegistration = [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('middleName').trim().notEmpty().withMessage('Middle name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('sex').isIn(['Male', 'Female']).withMessage('Invalid sex value'),
  body('dateOfBirth').isISO8601().withMessage('Invalid date of birth'),
  body('dateOfDeath').isISO8601().withMessage('Invalid date of death')
    .custom((value, { req }) => {
      if (new Date(value) < new Date(req.body.dateOfBirth)) {
        throw new Error('Date of death cannot be before date of birth');
      }
      return true;
    }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }
    next();
  }
];

export default {
  handleValidationErrors,
  validationRules,
  sanitizeInput,
  validateCorpseRegistration
};
