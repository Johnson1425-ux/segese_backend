import mongoose from 'mongoose';
import logger from './logger.js';

/**
 * MongoDB multi-document transactions require a replica set or a sharded
 * cluster. A standalone mongod rejects them outright, so this module detects
 * that once and degrades to running the callback without a session rather than
 * failing every write on such a deployment.
 *
 * Atlas and any replica-set deployment get real atomicity. A standalone
 * deployment keeps the previous (non-atomic) behaviour and logs a warning, so
 * the failure mode is "no worse than before" instead of "totally broken".
 */
let transactionsSupported = null;

const NON_TRANSACTIONAL_ERRORS = [
  'Transaction numbers are only allowed on a replica set member or mongos',
  'Transactions are not supported',
  'this deployment does not support transactions',
];

const looksUnsupported = (err) => {
  const message = err?.message || '';
  return (
    err?.code === 20 ||
    err?.codeName === 'IllegalOperation' ||
    NON_TRANSACTIONAL_ERRORS.some((m) => message.includes(m))
  );
};

/**
 * Run `fn` inside a transaction when the deployment supports one.
 *
 * The callback receives a session (or null when unsupported) and must pass it
 * to every database call it makes, otherwise those writes fall outside the
 * transaction and will not roll back.
 *
 * @param {(session: import('mongoose').ClientSession|null) => Promise<any>} fn
 * @param {string} [label] used in log messages
 */
export const withTransaction = async (fn, label = 'operation') => {
  if (transactionsSupported === false) {
    return fn(null);
  }

  let session;
  try {
    session = await mongoose.startSession();
  } catch (err) {
    transactionsSupported = false;
    logger.warn(
      `Could not start a session for ${label}; running without a transaction. ` +
      `Multi-document writes will not be atomic. (${err.message})`
    );
    return fn(null);
  }

  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    transactionsSupported = true;
    return result;
  } catch (err) {
    if (looksUnsupported(err)) {
      transactionsSupported = false;
      logger.warn(
        `This MongoDB deployment does not support transactions, so ${label} ran ` +
        'without one. Multi-document writes are not atomic. Use a replica set ' +
        'or Atlas to get rollback on partial failure.'
      );
      return fn(null);
    }
    throw err;
  } finally {
    await session.endSession().catch(() => {});
  }
};

export default withTransaction;
