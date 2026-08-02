import mongoose from 'mongoose';

/**
 * Monotonic counters used to allocate human-readable identifiers
 * (invoice numbers, payment numbers, visit IDs, patient IDs).
 *
 * These replace the previous "read the highest existing value, add one"
 * approach, which allocated the same number to two concurrent requests and,
 * in the countDocuments() variant, reissued identifiers after a deletion.
 *
 * The _id is the counter key, e.g. "invoice:202608" or "patient:2026".
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false }
);

export default mongoose.model('Counter', counterSchema);
