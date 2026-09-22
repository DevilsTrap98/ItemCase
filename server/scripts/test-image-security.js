// Regression test for image-upload security (see imageStorage.js). Run
// before any release that touches that file.
// Usage: node scripts/test-image-security.js
require('dotenv').config();
const path = require('path');
process.env.UPLOADS_DIR = path.join(__dirname, '.tmp-uploads-test');
const sharp = require('sharp');
const fs = require('fs/promises');

let pass = 0, fail = 0;
function check(label, condition) {
  if (condition) { pass++; console.log(`  ok — ${label}`); }
  else { fail++; console.error(`  FAIL — ${label}`); }
}

async function main() {
  const { storeDataUrl, uploadsRoot } = require('../src/utils/imageStorage');

  console.log('\n[1] EXIF/GPS metadata is stripped on every upload');
  {
    const withExif = await sharp({ create: { width: 200, height: 150, channels: 3, background: { r: 200, g: 50, b: 50 } } })
      .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'contains identifying/location-adjacent info' } } }).toBuffer();
    const metaBefore = await sharp(withExif).metadata();
    check('test fixture actually carries EXIF (sanity check)', !!metaBefore.exif);
    const stored = await storeDataUrl(`data:image/jpeg;base64,${withExif.toString('base64')}`, 'test', 'owner1', 'img1');
    const storedBuffer = await fs.readFile(path.join(uploadsRoot, ...stored.split('/')));
    const metaAfter = await sharp(storedBuffer).metadata();
    check('stored file has no EXIF block', !metaAfter.exif);
    check('stored bytes are a re-encode, not the original passed through', !storedBuffer.equals(withExif));
  }

  console.log('\n[2] Oversized images are downscaled, never rejected');
  {
    const big = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer();
    const stored = await storeDataUrl(`data:image/png;base64,${big.toString('base64')}`, 'test', 'owner1', 'imgbig');
    const storedBuffer = await fs.readFile(path.join(uploadsRoot, ...stored.split('/')));
    const meta = await sharp(storedBuffer).metadata();
    check('downscaled to at most 4000px on the long edge', meta.width <= 4000 && meta.height <= 4000);
  }

  console.log('\n[3] Non-image bytes are rejected regardless of claimed type');
  {
    const fake = Buffer.from('not a real png, just plain text pretending to be one');
    let rejected = false;
    try { await storeDataUrl(`data:image/png;base64,${fake.toString('base64')}`, 'test', 'owner1', 'imgfake'); }
    catch (e) { rejected = e.status === 415; }
    check('fake PNG bytes rejected with 415', rejected);
  }

  console.log('\n[4] SVG/HTML/script content is never accepted as an image');
  {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    let rejected = false;
    try { await storeDataUrl(`data:image/svg+xml;base64,${svg.toString('base64')}`, 'test', 'owner1', 'imgsvg'); }
    catch (e) { rejected = true; } // regex only matches jpeg/png/webp/gif — svg+xml never matches at all
    check('SVG data URL is rejected outright (unsupported mime never matched)', rejected);
  }

  console.log('\n[5] GIF path re-encodes without crashing');
  {
    const gif = await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: 0, g: 0, b: 200 } } }).gif().toBuffer();
    const stored = await storeDataUrl(`data:image/gif;base64,${gif.toString('base64')}`, 'test', 'owner1', 'imggif');
    const storedBuffer = await fs.readFile(path.join(uploadsRoot, ...stored.split('/')));
    const meta = await sharp(storedBuffer).metadata();
    check('GIF re-encodes successfully', meta.format === 'gif');
  }

  console.log('\n[6] Path traversal in namespace/owner/id is neutralized');
  {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 1, b: 1 } } }).png().toBuffer();
    const stored = await storeDataUrl(`data:image/png;base64,${png.toString('base64')}`, '../../etc', '../../passwd', '../../../evil');
    const resolved = path.resolve(uploadsRoot, ...stored.split('/'));
    check('resolved path stays inside uploadsRoot despite path-traversal attempts in inputs', resolved.startsWith(uploadsRoot + path.sep));
  }

  await fs.rm(uploadsRoot, { recursive: true, force: true }).catch(() => {});
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
