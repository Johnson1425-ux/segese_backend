import mongoose from 'mongoose';
import logger from './logger.js';

/**
 * Safety net for unbounded queries.
 *
 * Around fifty `Model.find(...)` call sites in this codebase have no `.limit()`,
 * so each one returns however many documents happen to match. That is fine at
 * the current data volume and turns into a memory and latency problem as the
 * clinic accumulates history.
 *
 * Rather than edit every call site — which risks silently truncating lists the
 * frontend expects to be complete — this registers one global plugin that
 * applies a generous ceiling only where no explicit limit was set. Queries that
 * already paginate are untouched. Hitting the ceiling is logged, so the cases
 * that genuinely need pagination surface as warnings instead of outages.
 *
 * Must be imported before any model is compiled; mongoose only applies global
 * plugins to schemas registered after the plugin.
 */
export const DEFAULT_QUERY_LIMIT = Number(process.env.MAX_QUERY_RESULTS) || 1000;
export const DEFAULT_QUERY_TIMEOUT_MS = Number(process.env.QUERY_TIMEOUT_MS) || 15000;

let registered = false;

export const registerQueryGuard = () => {
  if (registered) return;
  registered = true;

  mongoose.plugin((schema) => {
    schema.pre(['find'], function applyDefaultLimit() {
      const options = this.getOptions();

      if (options.limit === undefined || options.limit === null) {
        this.limit(DEFAULT_QUERY_LIMIT);
        this.__guardApplied = true;
      }

      if (options.maxTimeMS === undefined) {
        this.maxTimeMS(DEFAULT_QUERY_TIMEOUT_MS);
      }
    });

    schema.post(['find'], function warnIfTruncated(docs) {
      if (this.__guardApplied && Array.isArray(docs) && docs.length === DEFAULT_QUERY_LIMIT) {
        logger.warn(
          `Query on ${this.model?.modelName} returned the ${DEFAULT_QUERY_LIMIT}-document ` +
          'safety limit and was probably truncated. This endpoint needs pagination.'
        );
      }
    });
  });
};

registerQueryGuard();

export default registerQueryGuard;
