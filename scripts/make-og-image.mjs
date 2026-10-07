// Makes assets/og-image.png (the social preview image) from assets/og-image.svg.
// It uses sharp, which wrangler already installs. Run it with: node scripts/make-og-image.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', { paths: [path.join(root, 'node_modules', 'miniflare')] }));

await sharp(path.join(root, 'assets/og-image.svg'))
  .resize(1200, 630)
  .png({ compressionLevel: 9 })
  .toFile(path.join(root, 'assets/og-image.png'));
console.log('Wrote assets/og-image.png');
