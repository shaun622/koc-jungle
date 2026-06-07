#!/usr/bin/env node
/**
 * Build the full app-icon set from the supplied logo JPG
 * (crowned padel ball on navy).
 *
 * Source: ./padel tournament maker app logo.jpg (784x1168 portrait)
 * Steps:
 *   1. Crop a centered 784x784 square (logo sits in the middle).
 *   2. Scale to a 1024 master -> resources/icon.png (for capacitor-assets)
 *      + public/icons/icon-1024.png.
 *   3. Generate PWA variants: icon-192, icon-512, apple-touch-icon (180),
 *      favicon-32, favicon-16.
 *   4. Maskable 512: logo scaled to ~80% inside the Android safe zone on
 *      a matched navy background so the crown doesn't clip under the
 *      circular mask.
 *
 * Run: node scripts/generate-icons-from-logo.mjs
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const SRC = resolve(root, 'padel tournament maker app logo.jpg');
const iconsDir = resolve(root, 'public/icons');
const publicDir = resolve(root, 'public');
const resourcesDir = resolve(root, 'resources');
mkdirSync(iconsDir, { recursive: true });
mkdirSync(resourcesDir, { recursive: true });

const SIDE = 784; // square side = source width
const TOP = Math.round((1168 - SIDE) / 2); // centre vertically

// 1. Cropped square buffer (1024) — the master.
const masterBuf = await sharp(SRC)
  .extract({ left: 0, top: TOP, width: SIDE, height: SIDE })
  .resize(1024, 1024)
  .png()
  .toBuffer();

// Sample the top-left pixel of the master for the maskable background.
const { data: corner } = await sharp(masterBuf)
  .extract({ left: 2, top: 2, width: 1, height: 1 })
  .raw()
  .toBuffer({ resolveWithObject: true });
const bg = { r: corner[0], g: corner[1], b: corner[2], alpha: 1 };
console.log(`matched bg: rgb(${bg.r}, ${bg.g}, ${bg.b})`);

async function emit(buf, file, size) {
  await sharp(buf).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  console.log(`  ${file}  (${size})`);
}

// 2. Master — only in resources/ (for capacitor-assets). NOT in public/
// so the PWA service worker doesn't precache a ~1 MB unused file.
await sharp(masterBuf).png().toFile(resolve(resourcesDir, 'icon.png'));
console.log('wrote 1024 master to resources/');

// 3. PWA variants
await emit(masterBuf, resolve(iconsDir, 'icon-512.png'), 512);
await emit(masterBuf, resolve(iconsDir, 'icon-192.png'), 192);
await emit(masterBuf, resolve(iconsDir, 'apple-touch-icon.png'), 180);
await emit(masterBuf, resolve(publicDir, 'favicon-32.png'), 32);
await emit(masterBuf, resolve(publicDir, 'favicon-16.png'), 16);

// 4. Maskable — logo at 80% inside safe zone on matched navy.
const inner = Math.round(512 * 0.8);
const innerPng = await sharp(masterBuf).resize(inner, inner).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
  .composite([{ input: innerPng, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(iconsDir, 'icon-maskable-512.png'));
console.log('  icon-maskable-512.png  (512, maskable)');

console.log('\nAll icons generated from logo.');
