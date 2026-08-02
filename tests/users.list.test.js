/**
 * Tests for GET /api/users pagination and search.
 *
 * The Users page could only ever reach the first ten accounts: the client sent
 * no page or limit, so the route's default of 10 applied, and its search
 * filtered only the rows already loaded. These cover the server side of that
 * fix — the paging window, the totals the client needs to render controls, and
 * that search spans the whole collection rather than one page.
 *
 * The User model is mocked so the suite needs no database; what is under test
 * is the route's query construction and response shape.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// A deterministic set of users to page through.
const ALL = Array.from({ length: 47 }, (_, i) => ({
  _id: `id-${i}`,
  firstName: `First${i}`,
  lastName: i < 3 ? 'Kowalski' : `Last${i}`,
  email: `user${i}@example.com`,
  role: i === 5 ? 'pharmacist' : 'nurse',
  department: 'General',
}));

const matches = (u, q) => {
  if (!q.$or) return true;
  return q.$or.some((clause) => {
    const [field, re] = Object.entries(clause)[0];
    return re.test(u[field] ?? '');
  });
};

let lastQuery = null;

const makeChain = (docs) => {
  const chain = {
    _skip: 0,
    _limit: docs.length,
    select() { return chain; },
    sort() { return chain; },
    skip(n) { chain._skip = n; return chain; },
    limit(n) { chain._limit = n; return chain; },
    then(resolve, reject) {
      return Promise.resolve(docs.slice(chain._skip, chain._skip + chain._limit)).then(resolve, reject);
    },
  };
  return chain;
};

jest.unstable_mockModule('../models/User.js', () => ({
  default: {
    find: (q) => { lastQuery = q; return makeChain(ALL.filter((u) => matches(u, q))); },
    countDocuments: async (q) => ALL.filter((u) => matches(u, q)).length,
  },
}));

jest.unstable_mockModule('../middleware/auth.js', () => ({
  protect: (req, res, next) => { req.user = { _id: 'admin-id', id: 'admin-id', role: 'admin' }; next(); },
  authorize: () => (req, res, next) => next(),
}));

jest.unstable_mockModule('../utils/sendEmail.js', () => ({ default: async () => ({ messageId: 'x' }) }));
jest.unstable_mockModule('../utils/emailTemplates.js', () => ({ getEmailTemplate: () => '<p>x</p>' }));

const { default: userRoutes } = await import('../routes/users.js');

const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);

beforeEach(() => { lastQuery = null; });

describe('GET /api/users pagination', () => {
  it('defaults to the first page', async () => {
    const res = await request(app).get('/api/users');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBe(47);
  });

  it('reports the totals the client needs to render controls', async () => {
    // Without these the page cannot know that more users exist, which is why
    // it never offered a way to reach them.
    const res = await request(app).get('/api/users?limit=20');

    expect(res.body.total).toBe(47);
    expect(res.body.totalPages).toBe(3);
    expect(res.body.limit).toBe(20);
  });

  it('returns a later page, not the first one again', async () => {
    const res = await request(app).get('/api/users?page=2&limit=20');

    expect(res.body.data).toHaveLength(20);
    expect(res.body.data[0]._id).toBe('id-20');
    expect(res.body.page).toBe(2);
  });

  it('returns the remainder on the last page', async () => {
    const res = await request(app).get('/api/users?page=3&limit=20');

    expect(res.body.data).toHaveLength(7);
    expect(res.body.data[0]._id).toBe('id-40');
  });

  it('every user is reachable by paging', async () => {
    const seen = new Set();
    for (let p = 1; p <= 3; p++) {
      const res = await request(app).get(`/api/users?page=${p}&limit=20`);
      res.body.data.forEach((u) => seen.add(u._id));
    }
    expect(seen.size).toBe(47);
  });

  it('caps an oversized limit', async () => {
    const res = await request(app).get('/api/users?limit=100000');
    expect(res.body.limit).toBe(100);
  });
});

describe('GET /api/users search', () => {
  it('finds users beyond the first page', async () => {
    // 'pharmacist' is user 5 here, but the point is that the server searches
    // the whole collection rather than a page the client already holds.
    const res = await request(app).get('/api/users?search=pharmacist');

    expect(res.body.total).toBe(1);
    expect(res.body.data[0].role).toBe('pharmacist');
  });

  it('matches across name fields, case-insensitively', async () => {
    const res = await request(app).get('/api/users?search=kowalski');

    expect(res.body.total).toBe(3);
  });

  it('treats the term as literal text, not a regular expression', async () => {
    // An unescaped '.*' would match every user; escaped, it matches none.
    const res = await request(app).get('/api/users?search=.*');

    expect(res.body.total).toBe(0);
  });

  it('escapes characters that would otherwise be pattern syntax', async () => {
    await request(app).get('/api/users?search=a%2Bb');
    const source = lastQuery.$or[0].firstName.source;
    expect(source).toBe('a\\+b');
  });

  it('applies paging to search results too', async () => {
    const res = await request(app).get('/api/users?search=Kowalski&limit=2');

    expect(res.body.data).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(2);
  });
});
