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