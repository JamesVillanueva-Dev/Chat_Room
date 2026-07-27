'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const multer = require('multer');

const config = require('../config');
const { ValidationError } = require('../lib/errors');

fs.mkdirSync(config.uploads.dir, { recursive: true });

const extensionsFor = (mimeType) => config.uploads.types[mimeType] || [];

const isImage = (mimeType) => config.uploads.imageMimeTypes.includes(mimeType);

/**
 * Stored filenames are generated, never derived from user input, so a name like
 * `../../server.js` or `x.png.exe` cannot escape the upload directory or change
 * how the file is served. The original name is kept in the database for display.
 */
const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, config.uploads.dir),
  filename: (req, file, callback) => {
    const extension = extensionsFor(file.mimetype)[0] || '.bin';
    callback(null, `${Date.now().toString(36)}-${crypto.randomBytes(12).toString('hex')}${extension}`);
  },
});

const fileFilter = (allowedMimeTypes) => (req, file, callback) => {
  const mimeType = file.mimetype;
  if (!allowedMimeTypes.includes(mimeType)) {
    return callback(new ValidationError(`Files of type ${mimeType} are not allowed.`, 'file'));
  }

  // The claimed type and the actual extension have to agree.
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (extension && !extensionsFor(mimeType).includes(extension)) {
    return callback(
      new ValidationError(`A ${extension} file cannot be a ${mimeType} upload.`, 'file')
    );
  }

  return callback(null, true);
};

const attachmentUpload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: fileFilter(config.uploads.allowedMimeTypes),
}).single('file');

const avatarUpload = multer({
  storage,
  limits: { fileSize: config.uploads.avatarMaxBytes, files: 1 },
  fileFilter: fileFilter(config.uploads.imageMimeTypes),
}).single('avatar');

/** Turns multer's own errors into the app's error shape. */
const runUpload = (uploader) => (req, res, next) =>
  uploader(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        const limit = req.path.includes('avatar') ? config.uploads.avatarMaxBytes : config.uploads.maxBytes;
        return next(
          new ValidationError(`File is too large. Limit is ${Math.round(limit / 1024 / 1024)} MB.`, 'file')
        );
      }
      return next(new ValidationError(error.message, 'file'));
    }
    return next(error);
  });

const removeFile = (storedName) => {
  if (!storedName) return;
  // Guard against a stored name that somehow contains path separators.
  const safeName = path.basename(storedName);
  fs.promises.unlink(path.join(config.uploads.dir, safeName)).catch(() => {});
};

module.exports = {
  attachmentUpload: runUpload(attachmentUpload),
  avatarUpload: runUpload(avatarUpload),
  isImage,
  removeFile,
};
