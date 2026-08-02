import { MedicineBatch } from '../models/MedicineBatch.js';
import { StockMovement } from '../models/StockMovement.js';

/**
 * Deduct stock from a medicine's batches, oldest expiry first.
 *
 * Each batch is decremented with a single conditional update rather than
 * read-modify-save. The `quantityRemaining: { $gte: n }` guard is evaluated by
 * the server at write time, so two concurrent dispensings cannot both pass a
 * stale in-memory check and drive a batch negative. When a batch is taken by
 * someone else first the update matches nothing and we simply move to the next
 * batch.
 *
 * Note that this is atomic per batch, not across batches: without a
 * transaction, a failure part-way through leaves earlier batches decremented.
 * Callers that need all-or-nothing should pass a session.
 *
 * @returns {Promise<{batchesUsed: Array, movements: Array, remaining: number}>}
 *          `remaining` is how much could not be sourced (0 when fully filled).
 */
export const deductFromBatches = async ({
  medicineId,
  quantity,
  reason,
  patient,
  performedBy,
  session,
}) => {
  const sessionOpt = session ? { session } : {};
  const batchesUsed = [];
  const movements = [];
  let remaining = Math.abs(quantity);

  const batches = await MedicineBatch.find({
    medicine: medicineId,
    status: 'active',
    quantityRemaining: { $gt: 0 },
    expiryDate: { $gt: new Date() },
  })
    .sort('expiryDate')
    .session(session || null);

  for (const batch of batches) {
    if (remaining <= 0) break;

    const take = Math.min(remaining, batch.quantityRemaining);
    if (take <= 0) continue;

    const updated = await MedicineBatch.findOneAndUpdate(
      {
        _id: batch._id,
        status: 'active',
        quantityRemaining: { $gte: take },
      },
      [
        {
          $set: {
            quantityRemaining: { $subtract: ['$quantityRemaining', take] },
          },
        },
        {
          $set: {
            status: {
              $cond: [{ $lte: ['$quantityRemaining', 0] }, 'depleted', '$status'],
            },
          },
        },
      ],
      { new: true, ...sessionOpt }
    );

    // Lost the race for this batch — another dispensing consumed it.
    if (!updated) continue;

    const [movement] = await StockMovement.create(
      [
        {
          medicine: medicineId,
          batch: batch._id,
          type: 'OUT',
          quantity: take,
          reason,
          patient,
          performedBy,
        },
      ],
      sessionOpt
    );

    movements.push(movement);
    batchesUsed.push({ batchNumber: batch.batchNumber, quantity: take });
    remaining -= take;
  }

  return { batchesUsed, movements, remaining };
};

export default deductFromBatches;
