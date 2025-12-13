import Visit from '../models/Visit.js';
import Patient from '../models/Patient.js';
import logger from '../utils/logger.js';

/**
 * Middleware to check if a patient is eligible for services based on insurance/payment status
 * This prevents non-insured patients from ordering services before payment is confirmed
 */
export const checkPaymentEligibility = async (req, res, next) => {
  try {
    let visit;
    let visitId;

    // Extract visitId from different possible locations
    if (req.body.visit) {
      visitId = req.body.visit;
    } else if (req.body.visitId) {
      visitId = req.body.visitId;
    } else if (req.params.id) {
      visitId = req.params.id;
    }

    // If no visit ID found, return error
    if (!visitId) {
      return res.status(400).json({
        status: 'error',
        message: 'Visit ID is required'
      });
    }

    // Fetch the visit with patient details
    visit = await Visit.findById(visitId).populate('patient');

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Visit not found'
      });
    }

    // Check if patient has insurance
    const hasInsurance = !!(visit.patient.insurance?.provider);

    // For non-insured patients, check if payment is confirmed
    if (!hasInsurance) {
      // If visit status is still 'Pending Payment', block service ordering
      if (visit.status === 'Pending Payment') {
        logger.warn(`Service order blocked for visit ${visit.visitId} - Payment pending`);
        return res.status(403).json({
          status: 'error',
          message: 'Payment required before ordering services. Please complete payment at the reception.',
          requiresPayment: true,
          visitId: visit.visitId
        });
      }
    }

    // Attach visit and insurance info to request for use in route handlers
    req.visit = visit;
    req.hasInsurance = hasInsurance;
    req.patientId = visit.patient._id;

    next();
  } catch (error) {
    logger.error('Payment eligibility check error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error checking payment eligibility'
    });
  }
};

/**
 * Middleware to check if a visit is active before allowing operations
 */
export const checkVisitActive = async (req, res, next) => {
  try {
    const visitId = req.params.id || req.body.visit || req.body.visitId;

    if (!visitId) {
      return res.status(400).json({
        status: 'error',
        message: 'Visit ID is required'
      });
    }

    const visit = await Visit.findById(visitId);

    if (!visit) {
      return res.status(404).json({
        status: 'error',
        message: 'Visit not found'
      });
    }

    if (!visit.isActive) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot modify an inactive visit'
      });
    }

    req.visit = visit;
    next();
  } catch (error) {
    logger.error('Visit active check error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error checking visit status'
    });
  }
};

/**
 * Optional: Middleware to track service charges
 * This can be used to maintain a running total of all services ordered
 */
// export const trackServiceCharge = (serviceType) => {
//   return async (req, res, next) => {
//     // Store the original res.json to intercept successful responses
//     const originalJson = res.json.bind(res);

//     res.json = function(data) {
//       // Only track if the request was successful
//       if (res.statusCode === 201 && data.status === 'success') {
//         // In a production system, you would:
//         // 1. Look up the service price from your services collection
//         // 2. Add it to a billing/charges collection
//         // 3. Calculate insurance coverage if applicable
//         logger.info(`Service charge tracked: ${serviceType} for visit ${req.visit?.visitId}`);
//       }
//       return originalJson(data);
//     };

//     next();
//   };
// };