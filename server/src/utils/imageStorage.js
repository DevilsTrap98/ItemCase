const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads'));
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 6 * 1024 * 1024);

const TYPES = {
  'image/jpeg': { extension: '.jpg', signatures: [[0xff, 0xd8, 0xff]] },
  'image/png': { extension: '.png', signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
  'image/webp': { extension: '.webp', webp: true },
  'image/gif': { extension: '.gif', signatures: [[0x47, 0x49, 0x46, 0x38]] }
};

function safeSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID();
}

function startsWith(buffer, signature) {
  return signature.every((byte, index) => buffer[index] === byte);
}

function validateImage(mime, buffer) {
  const type = TYPES[mime];
  if (!type) throw Object.assign(new Error('unsupported image type'), { status: 415 });
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('image is empty or too large'), { status: 413 });
  }
  const valid = type.webp
    ? buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    : type.signatures.some((signature) => startsWith(buffer, signature));
  if (!valid) throw Object.assign(new Error('image content does not match its type'), { status: 415 });
  return type;
}

function decodeDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(String(dataUrl));
  if (!match) throw Object.assign(new Error('invalid image data'), { status: 400 });
  const buffer = Buffer.from(match[2], 'base64');
  const type = validateImage(match[1], buffer);
  return { buffer, extension: type.extension };
}

async function storeDataUrl(dataUrl, namespace, ownerId, imageId) {
  if (!dataUrl) return null;
  const decoded = decodeDataUrl(dataUrl);
  const relativeDir = path.posix.join(safeSegment(namespace), safeSegment(ownerId));
  const fileName = `${safeSegment(imageId)}-${crypto.randomBytes(8).toString('hex')}${decoded.extension}`;
  const relativePath = path.posix.join(relativeDir, fileName);
  const directory = path.join(uploadsRoot, ...relativeDir.split('/'));
  const destination = path.join(uploadsRoot, ...relativePath.split('/'));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(destination, decoded.buffer, { flag: 'wx', mode: 0o600 });
  const written = await fs.readFile(destination);
  if (!written.equals(decoded.buffer)) {
    await fs.unlink(destination).catch(() => {});
    throw new Error('stored image verification failed');
  }
  return relativePath;
}

// Copies an already-stored, already-validated image into a different
// namespace — used when a private item's image is deliberately made public
// (e.g. added to a Showcase), mirroring how CommunityMarkt copies an item's
// image into its own 'market/' namespace rather than ever serving the
// private original through a public URL.
async function copyToNamespace(existingRelativePath, namespace, ownerId, imageId) {
  if (!existingRelativePath) return null;
  const source = path.resolve(uploadsRoot, ...String(existingRelativePath).split('/'));
  if (!source.startsWith(`${uploadsRoot}${path.sep}`)) throw new Error('invalid source path');
  const buffer = await fs.readFile(source);
  const extension = path.extname(existingRelativePath) || '.jpg';
  const relativeDir = path.posix.join(safeSegment(namespace), safeSegment(ownerId));
  const fileName = `${safeSegment(imageId)}-${crypto.randomBytes(8).toString('hex')}${extension}`;
  const relativePath = path.posix.join(relativeDir, fileName);
  const directory = path.join(uploadsRoot, ...relativeDir.split('/'));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(uploadsRoot, ...relativePath.split('/')), buffer, { mode: 0o600 });
  return relativePath;
}

async function removeStoredImage(relativePath) {
  if (!relativePath) return;
  const resolved = path.resolve(uploadsRoot, ...String(relativePath).split('/'));
  if (!resolved.startsWith(`${uploadsRoot}${path.sep}`)) return;
  await fs.unlink(resolved).catch((error) => { if (error.code !== 'ENOENT') throw error; });
}

function signingSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for private image URLs');
  return secret;
}

function imageSignature(relativePath, expires) {
  return crypto.createHmac('sha256', signingSecret()).update(`${relativePath}\n${expires}`).digest('hex');
}

function publicImageUrl(relativePath, req, { private: isPrivate = false } = {}) {
  if (!relativePath) return null;
  const base = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const encodedPath = String(relativePath).split('/').map(encodeURIComponent).join('/');
  if (!isPrivate) return `${base}/uploads/${encodedPath}`;
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  return `${base}/uploads/${encodedPath}?expires=${expires}&signature=${imageSignature(relativePath, expires)}`;
}

function authorizePrivateImage(req, res, next) {
  const relativePath = decodeURIComponent(String(req.path || '').replace(/^\/+/, ''));
  const isPrivate = relativePath.startsWith('collections/') || relativePath.startsWith('category-backgrounds/');
  if (!isPrivate) return next();
  const expires = Number(req.query.expires);
  const signature = String(req.query.signature || '');
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000) || !/^[a-f0-9]{64}$/.test(signature)) {
    return res.status(403).json({ error: 'Private image URL is invalid or expired' });
  }
  const expected = imageSignature(relativePath, expires);
  if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) {
    return res.status(403).json({ error: 'Private image URL is invalid or expired' });
  }
  next();
}

module.exports = { uploadsRoot, storeDataUrl, removeStoredImage, copyToNamespace, publicImageUrl, authorizePrivateImage };
