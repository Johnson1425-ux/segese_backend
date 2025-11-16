import mongoose from "mongoose";

const theatreSchema = new mongoose.Schema({
    theatreNumber: {
        type: String,
        required: [true, 'Theatre number is required'],
        unique: true,
        trim: true
    },
    name: {
        type: String,
        required: [true, 'Theatre name is required'],
        trim: true,
        maxlength: [50, 'Theatre name cannot be more than 50 characters']
    },
    type: {
        type: String,
        enum: [],
        required: [true, 'Theatre type is required']
    },
    floor: {
        type: Number,
        required: [true, 'Floor number is required']
    },
    description: {
        type: String,
        maxlength: [200, 'Description cannot be more than 200 characters']
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'maintenance'],
        default: 'active'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

export default mongoose.model('Theatre', theatreSchema);