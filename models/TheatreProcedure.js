import mongoose from "mongoose";

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
    const year = new Date().getFullYear();
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(year, 0, 1),
        $lt: new Date(year + 1, 0, 1)
      }
    });
    this.procedureNumber = `PR${year}${(count + 1).toString().padStart(5, '0')}`;
  }
  next();
});

export default mongoose.model('TheatreProcedure', theatreProcedureSchema);