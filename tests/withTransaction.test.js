/**
 * Tests for utils/withTransaction.js.
 *
 * The important behaviour is the fallback: MongoDB rejects transactions on a
 * standalone mongod, and if that rejection were treated as a failure every
 * payment would break on such a deployment. Mongoose is mocked so both
 * topologies can be exercised without a server.
 */
import { jest } from '@jest/globals';

const warnings = [];

jest.unstable_mockModule('../utils/logger.js', () => ({
  default: {
    warn: (msg) => warnings.push(msg),
    info: () => {},
    error: () => {},
  },
}));

let sessionFactory;

jest.unstable_mockModule('mongoose', () => ({
  default: {
    startSession: async () => sessionFactory(),
  },
}));

const freshModule = async () => {
  jest.resetModules();
  return import(`../utils/withTransaction.js?${Math.random()}`);
};

beforeEach(() => {
  warnings.length = 0;
});

describe('on a deployment that supports transactions', () => {
  let committed;
  let ended;

  beforeEach(() => {
    committed = false;
    ended = false;
    sessionFactory = () => ({
      withTransaction: async (fn) => {
        await fn();
        committed = true;
      },
      endSession: async () => {
        ended = true;
      },
    });
  });

  it('runs the callback inside a session and commits', async () => {
    const { withTransaction } = await freshModule();
    let received;

    const result = await withTransaction(async (session) => {
      received = session;
      return 'done';
    }, 'test');

    expect(received).not.toBeNull();
    expect(committed).toBe(true);
    expect(result).toBe('done');
    expect(ended).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('propagates application errors instead of swallowing them', async () => {
    const { withTransaction } = await freshModule();

    await expect(
      withTransaction(async () => {
        throw new Error('insufficient funds');
      }, 'test')
    ).rejects.toThrow('insufficient funds');
  });
});

describe('on a standalone deployment', () => {
  beforeEach(() => {
    sessionFactory = () => ({
      withTransaction: async () => {
        const err = new Error(
          'Transaction numbers are only allowed on a replica set member or mongos'
        );
        err.code = 20;
        err.codeName = 'IllegalOperation';
        throw err;
      },
      endSession: async () => {},
    });
  });

  it('still completes the work, without a session', async () => {
    const { withTransaction } = await freshModule();
    let received = 'unset';

    const result = await withTransaction(async (session) => {
      received = session;
      return 'fallback';
    }, 'test');

    expect(result).toBe('fallback');
    expect(received).toBeNull();
  });

  it('warns that atomicity is unavailable', async () => {
    const { withTransaction } = await freshModule();
    await withTransaction(async () => 'x', 'test');

    expect(warnings.join(' ')).toMatch(/not atomic/i);
  });

  it('stops retrying transactions after the first rejection', async () => {
    const { withTransaction } = await freshModule();

    await withTransaction(async () => 'first', 'test');
    warnings.length = 0;

    // A second attempt must not pay the cost of starting a doomed session, nor
    // repeat the warning on every subsequent write.
    let startCalled = false;
    sessionFactory = () => {
      startCalled = true;
      throw new Error('should not be called');
    };

    const result = await withTransaction(async () => 'second', 'test');

    expect(result).toBe('second');
    expect(startCalled).toBe(false);
    expect(warnings).toHaveLength(0);
  });
});
