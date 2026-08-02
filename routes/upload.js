import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { protect, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

const router = express.Router();

/**
 * File uploads.
 *
 * Files are written to uploads/ on local disk, which server.js already serves
 * statically at /uploads. Note that this only persists on a host with a
 * durable filesystem — on an ephemeral platform (Render's default disk,
 * Vercel, Heroku) uploads are lost on every redeploy and are not shared
 * between instances. Point MEDIA_STORAGE at object storage before relying on
 * this for records that must be retained.
 */

const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
  ['application/dicom', '.dcm'],
]);

const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 15 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, req.uploadCategory || 'misc');
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    // The client-supplied name is never used on disk: it can contain path
    // separators, null bytes or an extension that disagrees with the actual
    // content type. A random name plus an extension derived from the verified
    // MIME type avoids both traversal and content-type confusion.
    const ext = ALLOWED_MIME_TYPES.get(file.mimetype) || '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(
        new Error(
          `Unsupported file type '${file.mimetype}'. Allowed: ` +
          [...ALLOWED_MIME_TYPES.keys()].join(', ')
        )
      );
    }
    cb(null, true);
  },
});

const setCategory = (category) => (req, res, next) => {
  req.uploadCategory = category;
  next();
};

/**
 * Wraps a multer middleware so its errors become clean 400s rather than
 * reaching the generic error handler as a 500.
 */
const handleUpload = (middleware) => (req, res, next) => {
  middleware(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File exceeds the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB limit`
          : err.message;
      return res.status(400).json({ status: 'error', message });
    }

    return res.status(400).json({ status: 'error', message: err.message });
  });
};

// @desc    Upload a radiology image or report
// @route   POST /api/upload/radiology
// @access  Private (admin, radiologist, doctor)
router.post(
  '/radiology',
  protect,
  authorize('admin', 'radiologist', 'doctor'),
  setCategory('radiology'),
  handleUpload(upload.single('file')),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No file was uploaded. Send the file under the "file" field.',
      });
    }

    const url = `/uploads/radiology/${req.file.filename}`;

    logger.info('Radiology file uploaded', {
      filename: req.file.filename,
      size: req.file.size,
      uploadedBy: req.user._id,
    });

    res.status(201).json({
      status: 'success',
      message: 'File uploaded successfully',
      data: {
        url,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });
  }
);

export default router;
