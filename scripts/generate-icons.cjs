const sharp = require('sharp');
const fs = require('fs');

const sizes = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  const { default: pngToIco } = await import('png-to-ico');
  const buffers = [];

  for (const size of sizes) {
    const buf = await sharp('src/assets/logo-mark.png')
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    buffers.push(buf);
    fs.writeFileSync(`build/icons/icon-${size}.png`, buf);
  }

  const ico = await pngToIco(buffers);
  fs.writeFileSync('build/icon.ico', ico);
  fs.copyFileSync('build/icons/icon-256.png', 'build/icon.png');
  console.log('icon.ico size', ico.length);
})();
