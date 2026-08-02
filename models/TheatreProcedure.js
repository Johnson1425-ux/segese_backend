import mongoose from "mongoose";
import { nextSequence, highestExisting } from '../utils/sequence.js';

const theatreProcedureSchema = new mongoose.Schema({
    procedureNumber: {
        type: String,
        unique: true
    },
    procedure_name: {
        type: String,
        required: [true, 'Procedure name is required']
    },
    procedure_date: {
        type: Date,
    },
    procedure_type: {
        type: String
    },
    surgeon: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Surgeon is required']
    },
    anesthesiologist: {
        type: String,
    },
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: [true, 'Patient is required']
    },
    theatre: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Theatre',
        required: [true, 'Theatre room is required']
    },
    estimated_duration: {
        type: Date
    },
    priority: {
        type: String,
        enum: ['normal', 'emergency'],
        default: 'normal'
    },
    status: {
        type: String,
        enum: ['scheduled', 'on-going', 'completed'],
        default: 'scheduled'
    },
    pre_op_notes:{
        type: String
    },
    post_op_notes: {
        type: String
    },
    // Medications administered during or around the procedure. The theatre UI
    // has always had a form for this; there was no route or field behind it.
    medications: [{
        medication: { type: String, required: true },
        dosage: String,
        frequency: String,
        startDate: Date,
        endDate: Date,
        notes: String,
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        recordedAt: { type: Date, default: Date.now }
    }],
    // Diagnoses recorded against the procedure. The UI previously posted these
    // to /ipd-records/:id/diagnosis, but a theatre procedure has no IPD record
    // to attach to, so they belong here.
    diagnoses: [{
        condition: { type: String, required: true },
        notes: String,
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        recordedAt: { type: Date, default: Date.now }
    }],
    completion: {
        reason: {
            type: String,
            enum: ['recovered', 'referred', 'deceased', 'cancelled', 'other']
        },
        summary: String,
        completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        completedAt: Date
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true ,
    toJSON: { virtuals : true },
    toObject: { virtuals: true }
});

theatreProcedureSchema.pre('save', async function(next) {
  if (this.isNew && !this.procedureNumber) {
    // Was a countDocuments() of the current year, which collided under
    // concurrency and reissued numbers after a procedure was deleted.
    const year = new Date().getFullYear();
    const prefix = `PR${year}`;

    const sequence = await nextSequence(`theatre-procedure:${year}`, {
      seedFrom: () => highestExisting(this.constructor, 'procedureNumber', prefix),
    });

    this.procedureNumber = `${prefix}${String(sequence).padStart(5, '0')}`;
  }
  next();
});

export default mongoose.model('TheatreProcedure', theatreProcedureSchema);