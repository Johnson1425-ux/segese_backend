import Counter from '../models/Counter.js';

/**
 * Atomically allocate the next value for a counter.
 *
 * A single findOneAndUpdate with $inc is atomic in MongoDB, so two concurrent
 * callers can never receive the same number — unlike the previous
 * read-then-increment generators.
 *
 * Counters have to line up with identifiers that already exist in the
 * database, otherwise the first allocation would collide with historical
 * records and fail the unique index. The first time a key is used, `seedFrom`
 * is consulted for the highest value already in use. Seeding and allocation
 * are deliberately separate steps: the counter document is created at the
 * seed value without consuming it, then the $inc allocates. Concurrent
 * seeding is safe because the upsert is keyed on _id, so only one insert
 * wins and the loser simply proceeds to the $inc.
 *
 * @param {string} key         Counter key, e.g. "invoice:202608"
 * @param {object} [options]
 * @param {() => Promise<number>} [options.seedFrom]
 *        Returns the highest sequence already used for this key. Called only
 *        when the counter does not yet exist. Defaults to 0.
 * @param {import('mongoose').ClientSession} [options.session]
 * @returns {Promise<number>} the allocated sequence value
 */
export const nextSequence = async (key, { seedFrom, session } = {}) => {
  const sessionOpt = session ? { session } : {};

  const allocate = () =>
    Counter.findByIdAndUpdate(
      key,
      { $inc: { seq: 1 } },
      { new: true, ...sessionOpt }
    );

  let counter = await allocate();
  if (counter) return counter.seq;

  // Counter does not exist yet: create it at the current high-water mark.
  const seed = seedFrom ? await seedFrom() : 0;
  await Counter.findByIdAndUpdate(
    key,
    { $setOnInsert: { seq: seed } },
    { upsert: true, ...sessionOpt }
  );

  counter = await allocate();
  return counter.seq;
};

/**
 * Highest numeric suffix among existing documents whose `field` matches
 * `prefix`, used to seed a counter from legacy data.
 *
 * @param {import('mongoose').Model} Model
 * @param {string} field    field holding the identifier
 * @param {string} prefix   literal prefix, e.g. "INV-202608-"
 */
export const highestExisting = async (Model, field, prefix) => {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const docs = await Model.find({ [field]: new RegExp(`^${escaped}`) })
    .select(field)
    .lean();

  return docs.reduce((max, doc) => {
    const suffix = String(doc[field]).slice(prefix.length);
    const n = parseInt(suffix, 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
};

export default nextSequence;
