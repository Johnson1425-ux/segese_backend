import mongoose from "mongoose";

const prescriptionSchema = new mongoose.Schema({
    medication: {
        type: String,
        required: true
    },

    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    dosage: {
        type: String,
        required: true
    },

    frequency: {
        type: String,
        required: true
    },

    duration: String,
    notes: String,

    prescribedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    status: {
        type: String,
        enum: ['Pending', 'Pending Payment', 'Dispensed', 'Unavailable', 'Returned to Doctor'],
        default: 'Pending'
    },

    // Dispensing fields
    dispensedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    dispensedAt: {
        type: Date
    },
    dispensingNotes: {
        type: String
    },

    // Unavailable fields
    unavailableReason: {
        type: String
    },
    markedUnavailableBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    markedUnavailableAt: {
        type: Date
    },

    // Return to doctor fields
    returnedToDoctor: {
        type: Boolean,
        default: false
    },
    returnToDoctorReason: {
        type: String
    },
    returnedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    returnedAt: {
        type: Date
    },

    createdAt: {
        type: Date,
        default: Date.now
    },

    isActive: {
        type: Boolean,
        default: true
    }
});

export default mongoose.model('Prescription', prescriptionSchema);