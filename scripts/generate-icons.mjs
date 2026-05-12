/**
 * Generates the PWA icon family from public/icons/icon.svg.
 * Run once with `node scripts/generate-icons.mjs` after editing the SVG.
 * Outputs are committed alongside the SVG; not regenerated at build time.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'public/icons/icon.svg');
const svg = readFileSync(src);

async function render({ out, size, padded = false, bg = null }) {
  const dest = resolve(root, out);
  let pipe = sharp(svg, { density: 384 });

  if (padded) {
    // Maskable icons need a safe zone — render the artwork at 80% inside a full-bleed background.
    const inner = Math.round(size * 0.8);
    const inset = Math.round((size - inner) / 2);
    const innerPng = await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer();
    pipe = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: bg ?? { r: 22, g: 27, b: 35, alpha: 1 },
      },
    }).composite([{ input: innerPng, top: inset, left: inset }]);
  } else {
    pipe = pipe.resize(size, size);
  }

  await pipe.png({ compressionLevel: 9 }).toFile(dest);
  console.log(`✓ ${out} (${size}×${size})`);
}

await render({ out: 'public/icons/apple-touch-icon.png', size: 180 });
await render({ out: 'public/icons/icon-192.png', size: 192 });
await render({ out: 'public/icons/icon-512.png', size: 512 });
await render({ out: 'public/icons/icon-maskable-512.png', size: 512, padded: true });
await render({ out: 'public/favicon-32.png', size: 32 });
await render({ out: 'public/favicon-16.png', size: 16 });

console.log('\nAll icons regenerated.');
