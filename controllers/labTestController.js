import LabTest from '../models/LabTest.js';
import Visit from '../models/Visit.js';

// @desc    Get all lab tests
// @route   GET /api/lab-tests
// @access  Private
export const getLabTests = async (req, res) => {
  try {
    const labTests = await LabTest.find().populate('patient').populate('orderedBy');
    res.status(200).json({ 
      success: true, 
      data: labTests 
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// @desc    Get single lab test
// @route   GET /api/lab-tests/:id
// @access  Private
export const getLabTest = async (req, res) => {
  try {
    const labTest = await LabTest.findById(req.params.id).populate('patient').populate('orderedBy');
    if (!labTest) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lab test not found' 
      });
    }
    res.status(200).json({ 
      success: true, 
      data: labTest 
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
};


// @desc    Create a lab test (usually part of a visit)
// @route   POST /api/lab-tests
// @access  Private
export const createLabTest = async (req, res) => {
  try {
    const { orderData, patient, visit } = req.body;
    
    const labTest = await LabTest.create({
      testName: orderData.testName,
      notes: orderData.notes,
      patient,
      visit,
      orderedBy: req.user.id
    });
    
    res.status(201).json({ 
      success: true, 
      data: labTest 
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
};

// @desc    Update a lab test with results
// @route   PUT /api/lab-tests/:id
// @access  Private (Lab Technician)
export const updateLabTest = async (req, res) => {
  try {
    const { results, status } = req.body;
    const labTest = await LabTest.findByIdAndUpdate(
      req.params.id,
      { results, status, completedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!labTest) {
      return res.status(404).json({ 
        success: false, 
        message: 'Lab test not found' 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: labTest 
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      error: error.message 
    });
  }
};