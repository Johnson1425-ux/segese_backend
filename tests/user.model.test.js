/**
 * Regression tests for models/User.js.
 *
 * These cover the two defects that made authentication unreliable: a pre-save
 * hook that re-hashed an already-hashed password, and a default role that was
 * missing from the role enum.
 *
 * The hooks are driven directly rather than through a database, so the suite
 * needs no MongoDB. Model.hydrate() reproduces the state a document is in when
 * loaded from a query, including the projection, which is what determines
 * whether the password field counts as deselected.
 */
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';

const { default: User } = await import('../models/User.js');

const PLAINTEXT = 'Str0ng!Pass';

/**
 * Run the registered pre('save') middleware against a document.
 *
 * The settle delay matters: the buggy version of the hook called next() and
 * then continued hashing in a later microtask, so a check made the instant
 * execPre resolved would miss the corruption entirely.
 */
const runPreSave = (doc) =>
  new Promise((resolve, reject) => {
    User.schema.s.hooks.execPre('save', doc, [{}], (err) => (err ? reject(err) : resolve()));
  }).then(() => new Promise((r) => setTimeout(r, 250)));

const hydrateWithPassword = (hash) =>
  User.hydrate({
    _id: new mongoose.Types.ObjectId(),
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    role: 'admin',
    password: hash,
  });

describe('password hashing on save', () => {
  it('hashes a newly set password', async () => {
    const doc = new User({
      firstName: 'Ada', lastName: 'Lovelace',
      email: 'ada@example.com', password: PLAINTEXT,
    });

    await runPreSave(doc);

    expect(doc.password).not.toBe(PLAINTEXT);
    expect(bcrypt.compareSync(PLAINTEXT, doc.password)).toBe(true);
  });

  it('leaves an unmodified password untouched', async () => {
    // This is the failed-login path: incrementFailedLoginAttempts() saves a
    // document that has the password loaded but not modified. Re-hashing here
    // locks the account out permanently.
    const stored = bcrypt.hashSync(PLAINTEXT, 10);
    const doc = hydrateWithPassword(stored);
    doc.failedLoginAttempts = 1;

    await runPreSave(doc);

    expect(doc.password).toBe(stored);
    expect(bcrypt.compareSync(PLAINTEXT, doc.password)).toBe(true);
  });

  it('does not throw when the password was not selected', async () => {
    // .select('-password') leaves the field absent; hashing undefined throws.
    const doc = User.hydrate(
      {
        _id: new mongoose.Types.ObjectId(),
        firstName: 'Ada', lastName: 'Lovelace',
        email: 'ada@example.com', role: 'admin',
      },
      { password: 0 }
    );
    doc.lastLogin = new Date();

    await expect(runPreSave(doc)).resolves.toBeUndefined();
    expect(doc.password).toBeUndefined();
  });

  it('re-hashes when the password is deliberately changed', async () => {
    const doc = hydrateWithPassword(bcrypt.hashSync(PLAINTEXT, 10));
    doc.password = 'N3w!Password';

    await runPreSave(doc);

    expect(bcrypt.compareSync('N3w!Password', doc.password)).toBe(true);
    expect(bcrypt.compareSync(PLAINTEXT, doc.password)).toBe(false);
  });
});

describe('role', () => {
  it('accepts the default role, so registration validates', async () => {
    const doc = new User({
      firstName: 'Ada', lastName: 'Lovelace',
      email: 'ada@example.com', password: PLAINTEXT,
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.role).toBe('user');
  });

  it('grants the default role no permissions', () => {
    const doc = new User({
      firstName: 'A', lastName: 'B', email: 'a@b.com', password: PLAINTEXT,
    });

    expect(doc.hasPermission('view_patients')).toBe(false);
    expect(doc.hasPermission('all')).toBe(false);
  });

  it('rejects a role outside the enum', async () => {
    const doc = new User({
      firstName: 'A', lastName: 'B', email: 'a@b.com',
      password: PLAINTEXT, role: 'superuser',
    });

    await expect(doc.validate()).rejects.toThrow(/not a valid enum value/);
  });
});

describe('password policy', () => {
  it('rejects a password shorter than eight characters', async () => {
    const doc = new User({
      firstName: 'A', lastName: 'B', email: 'a@b.com', password: 'short',
    });

    await expect(doc.validate()).rejects.toThrow(/at least 8/);
  });
});

describe('signed tokens', () => {
  const doc = () =>
    new User({ firstName: 'A', lastName: 'B', email: 'a@b.com', password: PLAINTEXT });

  it('sets an expiry when JWT_EXPIRE is configured', () => {
    process.env.JWT_EXPIRE = '1h';
    expect(typeof jwt.decode(doc().getSignedJwtToken()).exp).toBe('number');
  });

  it('still sets an expiry when JWT_EXPIRE is unset', () => {
    // An undefined expiresIn produces a token that never expires.
    delete process.env.JWT_EXPIRE;
    expect(typeof jwt.decode(doc().getSignedJwtToken()).exp).toBe('number');
  });
});
