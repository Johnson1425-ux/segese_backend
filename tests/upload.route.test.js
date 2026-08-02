/**
 * Tests for routes/upload.js.
 *
 * Authentication is mocked so the route's own behaviour can be exercised
 * without a database: what matters here is that the file filter, the size
 * limit and the on-disk naming behave, since those are what stand between the
 * public internet and the server's filesystem.
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'radiology');

process.env.MAX_UPLOAD_BYTES = String(1024); // 1 KB, to keep the size test small

jest.unstable_mockModule('../middleware/auth.js', () => ({
  protect: (req, res, next) => {
    req.user = { _id: 'test-user-id', role: 'radiologist' };
    next();
  },
  authorize: () => (req, res, next) => next(),
}));

const { default: uploadRoutes } = await import('../routes/upload.js');

const app = express();
app.use('/api/upload', uploadRoutes);

const written = [];

afterAll(() => {
  // Remove anything this suite wrote to disk.
  for (const f of written) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, f)); } catch { /* already gone */ }
  }
});

describe('POST /api/upload/radiology', () => {
  it('accepts a permitted image type and returns a served URL', async () => {
    const res = await request(app)
      .post('/api/upload/radiology')
      .attach('file', Buffer.from('fake-png-bytes'), {
        filename: 'scan.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.url).toMatch(/^\/uploads\/radiology\/.+\.png$/);
    expect(res.body.data.originalName).toBe('scan.png');
    written.push(res.body.data.filename);
  });

  it('rejects a disallowed file type', async () => {
    const res = await request(app)
      .post('/api/upload/radiology')
      .attach('file', Buffer.from('#!/bin/sh\necho pwned'), {
        filename: 'payload.sh',
        contentType: 'application/x-sh',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Unsupported file type/);
  });

  it('rejects a file over the size limit', async () => {
    const res = await request(app)
      .post('/api/upload/radiology')
      .attach('file', Buffer.alloc(4096, 'x'), {
        filename: 'big.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds/i);
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post('/api/upload/radiology');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/No file was uploaded/);
  });

  it('does not write the client-supplied filename to disk', async () => {
    // A traversal attempt must not escape the upload directory, and the
    // stored name must not be attacker-controlled at all.
    const res = await request(app)
      .post('/api/upload/radiology')
      .attach('file', Buffer.from('data'), {
        filename: '../../../../etc/passwd.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.filename).not.toContain('..');
    expect(res.body.data.filename).not.toContain('/');
    expect(res.body.data.filename).toMatch(/^\d+-[a-f0-9]{16}\.png$/);
    written.push(res.body.data.filename);

    // And the file really is inside the upload directory.
    const resolved = path.resolve(UPLOAD_DIR, res.body.data.filename);
    expect(resolved.startsWith(path.resolve(UPLOAD_DIR))).toBe(true);
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it('derives the extension from the MIME type, not the client filename', async () => {
    const res = await request(app)
      .post('/api/upload/radiology')
      .attach('file', Buffer.from('data'), {
        filename: 'disguised.html',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.filename.endsWith('.png')).toBe(true);
    written.push(res.body.data.filename);
  });
});
