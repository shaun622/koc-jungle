#!/usr/bin/env node

import sharp from 'sharp';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const marketing = resolve(root, 'screenshots', 'marketing');

function textOverlay({ width, height, variant }) {
  const portrait = variant === 'iphone';
  const left = portrait ? 88 : 150;
  const iconSize = portrait ? 112 : 124;
  const iconTop = portrait ? 92 : 118;
  const headlineTop = portrait ? 315 : 405;
  const headlineSize = portrait ? 84 : 104;
  const subSize = portrait ? 37 : 44;
  const subTop = portrait ? 555 : 690;
  const lineTwo = portrait ? 105 : 128;

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="5" stdDeviation="10" flood-color="#000814" flood-opacity="0.7"/>
        </filter>
      </defs>
      <text x="${left}" y="${headlineTop}" fill="#f7fafc" font-family="Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="800" letter-spacing="-2" filter="url(#shadow)">
        <tspan x="${left}" dy="0">Best on iPad.</tspan>
        <tspan x="${left}" dy="${lineTwo}" fill="#a3f542">Brilliant on TV.</tspan>
      </text>
      <text x="${left}" y="${subTop}" fill="#b5c1cd" font-family="Arial, Helvetica, sans-serif" font-size="${subSize}" font-weight="500">
        <tspan x="${left}" dy="0">Enter scores courtside.</tspan>
        <tspan x="${left}" dy="${Math.round(subSize * 1.42)}">Mirror the live scoreboard for everyone to follow.</tspan>
      </text>
      <rect x="${left + iconSize + 26}" y="${iconTop + Math.round(iconSize * 0.23)}" width="${portrait ? 438 : 520}" height="${portrait ? 58 : 66}" rx="29" fill="#102536" stroke="#2c495d" stroke-width="2"/>
      <text x="${left + iconSize + 52}" y="${iconTop + Math.round(iconSize * 0.62)}" fill="#e8eef4" font-family="Arial, Helvetica, sans-serif" font-size="${portrait ? 27 : 31}" font-weight="700" letter-spacing="1.2">PADEL TOURNAMENT MAKER</text>
    </svg>
  `);
}

async function createHero({ variant, width, height, source, output }) {
  const iconSize = variant === 'iphone' ? 112 : 124;
  const left = variant === 'iphone' ? 88 : 150;
  const iconTop = variant === 'iphone' ? 92 : 118;

  await sharp(resolve(marketing, source))
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .composite([
      { input: textOverlay({ width, height, variant }), left: 0, top: 0 },
      {
        input: await sharp(resolve(root, 'resources', 'icon.png'))
          .resize(iconSize, iconSize)
          .png()
          .toBuffer(),
        left,
        top: iconTop,
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(resolve(marketing, output));

  console.log(`${variant}: ${output} (${width}x${height})`);
}

await createHero({
  variant: 'iphone',
  width: 1284,
  height: 2778,
  source: 'app-store-hero-iphone-v2-source.png',
  output: 'app-store-hero-iphone-v2.png',
});

await createHero({
  variant: 'ipad',
  width: 2752,
  height: 2064,
  source: 'app-store-hero-ipad-v2-source.png',
  output: 'app-store-hero-ipad-v2.png',
});
