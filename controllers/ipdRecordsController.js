import IPDRecord from '../models/IPDRecord.js';
import logger from '../utils/logger.js';

// @desc    Get medications from IPD records
// @route   GET /api/ipd-records/medications
// @access  Private
// Query params: ipdRecordId, patientId, medicationStatus, medicationName
export const getIPDMedications = async (req, res) => {
  try {
    const { ipdRecordId, patientId, medicationStatus, medicationName } = req.query;

    const matchStage = {};
    const projectStage = {
      medications: 1,
      patient: 1,
      admissionNumber: 1,
      admissionDate: 1,
      dischargeDate: 1,
      status: 1,
      ward: 1,
      bed: 1,
      admittingDoctor: 1,
      assignedNurse: 1
    };

    // Filter by IPD Record ID
    if (ipdRecordId) {
      matchStage._id = ipdRecordId;
    }

    // Filter by Patient ID
    if (patientId) {
      matchStage.patient = patientId;
    }

    // Find IPD records matching the criteria
    const ipdRecords = await IPDRecord.find(matchStage)
      .populate('patient', 'firstName lastName patientId email phone')
      .populate('ward', 'name wardNumber')
      .populate('bed', 'bedNumber')
      .populate('admittingDoctor', 'firstName lastName')
      .populate('assignedNurse', 'firstName lastName')
      .populate('medications.medicineId', 'name category')
      .populate('medications.prescribedBy', 'firstName lastName');

    // Filter and flatten medications
    let allMedications = [];

    ipdRecords.forEach((record) => {
      if (record.medications && record.medications.length > 0) {
        record.medications.forEach((medication) => {
          // Filter by medication status if provided
          if (medicationStatus && medication.status !== medicationStatus) {
            return;
          }

          // Filter by medication name if provided
          if (medicationName && !medication.medication.toLowerCase().includes(medicationName.toLowerCase())) {
            return;
          }

          allMedications.push({
            _id: medication._id,
            medication: medication.medication,
            medicineId: medication.medicineId,
            status: medication.status,
            quantifiedQuantity: medication.quantifiedQuantity,
            quantifiedPrice: medication.quantifiedPrice,
            totalPrice: medication.totalPrice,
            dosage: medication.dosage,
            frequency: medication.frequency,
            startDate: medication.startDate,
            endDate: medication.endDate,
            prescribedBy: medication.prescribedBy,
            notes: medication.notes,
            
            // IPD Record context
            ipdRecordId: record._id,
            admissionNumber: record.admissionNumber,
            patient: record.patient,
            ward: record.ward,
            bed: record.bed,
            admissionDate: record.admissionDate,
            dischargeDate: record.dischargeDate,
            ipdStatus: record.status,
            admittingDoctor: record.admittingDoctor,
            assignedNurse: record.assignedNurse
          });
        });
      }
    });

    // Sort by date in descending order
    allMedications.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    res.status(200).json({
      success: true,
      count: allMedications.length,
      data: allMedications
    });
  } catch (error) {
    logger.error('Get IPD medications error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @desc    Get medications for a specific IPD record
// @route   GET /api/ipd-records/:id/medications
// @access  Private
export const getIPDRecordMedications = async (req, res) => {
  try {
    const { id } = req.params;

    const ipdRecord = await IPDRecord.findById(id)
      .populate('patient', 'firstName lastName patientId email phone')
      .populate('ward', 'name wardNumber')
      .populate('bed', 'bedNumber')
      .populate('admittingDoctor', 'firstName lastName')
      .populate('assignedNurse', 'firstName lastName')
      .populate('medications.medicineId', 'name category')
      .populate('medications.prescribedBy', 'firstName lastName');

    if (!ipdRecord) {
      return res.status(404).json({
        success: false,
        message: 'IPD Record not found'
      });
    }

    const medications = ipdRecord.medications.map((med) => ({
      _id: med._id,
      medication: med.medication,
      medicineId: med.medicineId,
      status: med.status,
      quantifiedQuantity: med.quantifiedQuantity,
      quantifiedPrice: med.quantifiedPrice,
      totalPrice: med.totalPrice,
      dosage: med.dosage,
      frequency: med.frequency,
      startDate: med.startDate,
      endDate: med.endDate,
      prescribedBy: med.prescribedBy,
      notes: med.notes
    }));

    res.status(200).json({
      success: true,
      ipdRecord: {
        _id: ipdRecord._id,
        admissionNumber: ipdRecord.admissionNumber,
        patient: ipdRecord.patient,
        ward: ipdRecord.ward,
        bed: ipdRecord.bed,
        admittingDoctor: ipdRecord.admittingDoctor,
        assignedNurse: ipdRecord.assignedNurse,
        status: ipdRecord.status,
        admissionDate: ipdRecord.admissionDate,
        dischargeDate: ipdRecord.dischargeDate
      },
      count: medications.length,
      data: medications
    });
  } catch (error) {
    logger.error('Get IPD record medications error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
