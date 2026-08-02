/**
 * Tests for utils/sequence.js, which allocates invoice numbers, payment
 * numbers, visit IDs, patient IDs and mortuary receipt numbers.
 *
 * The Counter model is replaced with an in-memory stand-in that reproduces the
 * behaviour these tests depend on: findByIdAndUpdate applies its update
 * indivisibly, and an upsert keyed on _id inserts at most once. Each call
 * yields to the event loop first, so any read-then-write gap in the code under
 * test would interleave and show up as duplicate allocations.
 */
import { jest } from '@jest/globals';

const store = new Map();

jest.unstable_mockModule('../models/Counter.js', () => ({
  default: {
    async findByIdAndUpdate(id, update, opts = {}) {
      await new Promise((r) => setImmediate(r));

      let doc = store.get(id);

      if (update.$inc) {
        if (!doc) {
          if (!opts.upsert) return null;
          doc = { _id: id, seq: 0 };
          store.set(id, doc);
        }
        doc.seq += update.$inc.seq;
        return { ...doc };
      }

      if (update.$setOnInsert) {
        if (!doc) {
          doc = { _id: id, ...update.$setOnInsert };
          store.set(id, doc);
        }
        return { ...doc };
      }

      return doc ? { ...doc } : null;
    },
  },
}));

const { nextSequence, highestExisting } = await import('../utils/sequence.js');

beforeEach(() => store.clear());

describe('nextSequence', () => {
  it('continues above identifiers that already exist', async () => {
    // Starting from zero would collide with historical records and trip the
    // unique index on the first allocation.
    const first = await nextSequence('invoice:202608', { seedFrom: async () => 42 });
    expect(first).toBe(43);
  });

  it('increases by one on each sequential call', async () => {
    const values = [];
    for (let i = 0; i < 5; i++) {
      values.push(await nextSequence('k', { seedFrom: async () => 0 }));
    }
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it('never hands the same value to two concurrent callers', async () => {
    const results = await Promise.all(
      Array.from({ length: 200 }, () => nextSequence('busy', { seedFrom: async () => 100 }))
    );

    expect(new Set(results).size).toBe(200);
    expect(Math.min(...results)).toBe(101);
    expect(Math.max(...results)).toBe(300);
  });

  it('stays correct when many callers race to create the counter', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => nextSequence('fresh', { seedFrom: async () => 7 }))
    );

    expect(new Set(results).size).toBe(50);
    // The seed is the high-water mark of existing data and must not be reissued.
    expect(results).not.toContain(7);
  });
});

describe('highestExisting', () => {
  const model = (values) => ({
    find: () => ({
      select: () => ({
        lean: async () => values.map((v) => ({ invoiceNumber: v })),
      }),
    }),
  });

  it('returns the largest numeric suffix', async () => {
    const max = await highestExisting(
      model(['INV-202608-00001', 'INV-202608-00042', 'INV-202608-00007']),
      'invoiceNumber',
      'INV-202608-'
    );
    expect(max).toBe(42);
  });

  it('returns zero when nothing matches', async () => {
    expect(await highestExisting(model([]), 'invoiceNumber', 'INV-202608-')).toBe(0);
  });

  it('ignores malformed suffixes rather than producing NaN', async () => {
    const max = await highestExisting(
      model(['INV-202608-00003', 'INV-202608-corrupt']),
      'invoiceNumber',
      'INV-202608-'
    );
    expect(max).toBe(3);
  });
});
