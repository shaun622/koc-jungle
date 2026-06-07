#!/usr/bin/env node
/**
 * Render 3 logo concepts to ./logo-concepts/*.png for selection.
 * Each is a 512x512 rounded-square app-icon tile.
 *   A — Ball wordmark: padel ball with PADEL across the seam
 *   B — Dynamic band: ball with a bold angled PADEL band + motion
 *   C — Emblem: ball over crossed paddles, premium badge
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, '..', 'logo-concepts');
mkdirSync(out, { recursive: true });

const DEFS = `
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#1c2330"/>
    <stop offset="100%" stop-color="#0e1219"/>
  </linearGradient>
  <radialGradient id="ball" cx="0.36" cy="0.32" r="0.85">
    <stop offset="0%" stop-color="#eaff9e"/>
    <stop offset="40%" stop-color="#c6f84e"/>
    <stop offset="100%" stop-color="#84bb1f"/>
  </radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#fbcf5f"/>
    <stop offset="100%" stop-color="#b9842a"/>
  </linearGradient>
`;

// Concept A — Ball wordmark
const conceptA = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${DEFS}</defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="168" fill="url(#ball)" stroke="#5a7d12" stroke-width="8"/>
  <!-- padel ball seam -->
  <path d="M 110 210 Q 256 150 402 210" fill="none" stroke="#5a7d12" stroke-width="7" opacity="0.5"/>
  <path d="M 110 302 Q 256 362 402 302" fill="none" stroke="#5a7d12" stroke-width="7" opacity="0.5"/>
  <!-- highlight -->
  <ellipse cx="205" cy="200" rx="42" ry="28" fill="#ffffff" opacity="0.45"/>
  <!-- wordmark -->
  <text x="256" y="278" font-family="Arial Black, Helvetica, sans-serif" font-size="74" font-weight="900" fill="#16321a" text-anchor="middle" letter-spacing="2">PADEL</text>
</svg>`;

// Concept B — Dynamic band
const conceptB = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${DEFS}</defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <!-- motion streaks -->
  <g stroke="#c6f84e" stroke-width="10" stroke-linecap="round" opacity="0.30">
    <line x1="70" y1="150" x2="150" y2="150"/>
    <line x1="50" y1="195" x2="160" y2="195"/>
    <line x1="80" y1="240" x2="140" y2="240"/>
  </g>
  <circle cx="290" cy="220" r="150" fill="url(#ball)" stroke="#5a7d12" stroke-width="8"/>
  <ellipse cx="245" cy="172" rx="38" ry="25" fill="#ffffff" opacity="0.45"/>
  <!-- angled band -->
  <g transform="rotate(-18 256 330)">
    <rect x="36" y="296" width="440" height="78" rx="12" fill="#0e1219" opacity="0.92"/>
    <text x="256" y="350" font-family="Arial Black, Helvetica, sans-serif" font-size="62" font-weight="900" fill="#c6f84e" text-anchor="middle" letter-spacing="4">PADEL</text>
  </g>
</svg>`;

// Concept C — Emblem with crossed paddles
const conceptC = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${DEFS}</defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <!-- crossed paddles behind -->
  <g opacity="0.9">
    <g transform="rotate(38 256 250)">
      <rect x="236" y="120" width="40" height="150" rx="18" fill="url(#gold)" stroke="#5a3f10" stroke-width="5"/>
      <rect x="246" y="250" width="20" height="70" rx="8" fill="#85601c" stroke="#5a3f10" stroke-width="4"/>
    </g>
    <g transform="rotate(-38 256 250)">
      <rect x="236" y="120" width="40" height="150" rx="18" fill="url(#gold)" stroke="#5a3f10" stroke-width="5"/>
      <rect x="246" y="250" width="20" height="70" rx="8" fill="#85601c" stroke="#5a3f10" stroke-width="4"/>
    </g>
  </g>
  <!-- ball on top -->
  <circle cx="256" cy="232" r="104" fill="url(#ball)" stroke="#5a7d12" stroke-width="7"/>
  <path d="M 168 205 Q 256 168 344 205" fill="none" stroke="#5a7d12" stroke-width="5" opacity="0.5"/>
  <ellipse cx="226" cy="200" rx="26" ry="17" fill="#ffffff" opacity="0.45"/>
  <!-- bottom wordmark -->
  <text x="256" y="430" font-family="Arial Black, Helvetica, sans-serif" font-size="58" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="3">PADEL</text>
</svg>`;

const concepts = [
  ['concept-A-wordmark', conceptA],
  ['concept-B-dynamic', conceptB],
  ['concept-C-emblem', conceptC],
];

for (const [name, svg] of concepts) {
  await sharp(Buffer.from(svg)).png().toFile(resolve(out, `${name}.png`));
  console.log(`wrote ${name}.png`);
}
console.log('done');
