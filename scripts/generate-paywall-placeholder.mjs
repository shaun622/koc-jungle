#!/usr/bin/env node
/**
 * Generate a 640x920 PNG paywall placeholder for Apple's
 * App Store Connect "Review Information" screenshot field on
 * subscription products.
 *
 * Real screenshots get captured in Step 2.6 and replace this.
 * For now Apple just needs *something* uploaded so the product
 * is submittable.
 *
 * Run: node scripts/generate-paywall-placeholder.mjs
 * Output: ./review-paywall-placeholder.png
 */

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const outPath = resolve(projectRoot, 'review-paywall-placeholder.png');

const W = 640;
const H = 920;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1c2330"/>
      <stop offset="100%" stop-color="#0e1219"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fbcf5f"/>
      <stop offset="100%" stop-color="#b9842a"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- App brand -->
  <g transform="translate(48 48)">
    <rect width="44" height="44" rx="10" fill="#c6f84e"/>
    <text x="22" y="33" font-family="Helvetica" font-size="22" font-weight="900" fill="#0e1219" text-anchor="middle">P</text>
    <text x="60" y="22" font-family="Helvetica" font-size="11" letter-spacing="2" font-weight="700" fill="#a8a8a8">PADEL TOURNAMENT MAKER</text>
    <text x="60" y="38" font-family="Helvetica" font-size="14" font-weight="600" fill="#fbcf5f">PRO</text>
  </g>

  <!-- Headline -->
  <text x="${W / 2}" y="180" font-family="Helvetica" font-size="34" font-weight="900" fill="#ffffff" text-anchor="middle">Unlock everything</text>
  <text x="${W / 2}" y="210" font-family="Helvetica" font-size="14" fill="#a8a8a8" text-anchor="middle">5 tournament formats &#183; cloud sync &#183; no ads</text>

  <!-- Features list -->
  <g transform="translate(80 260)" font-family="Helvetica" font-size="16" fill="#ffffff">
    <g transform="translate(0 0)">
      <circle cx="14" cy="14" r="14" fill="#c6f84e"/>
      <text x="14" y="19" font-size="16" font-weight="700" fill="#0e1219" text-anchor="middle">&#10003;</text>
      <text x="44" y="20" font-weight="600">King of the Court</text>
    </g>
    <g transform="translate(0 48)">
      <circle cx="14" cy="14" r="14" fill="#c6f84e"/>
      <text x="14" y="19" font-size="16" font-weight="700" fill="#0e1219" text-anchor="middle">&#10003;</text>
      <text x="44" y="20" font-weight="600">Americano</text>
    </g>
    <g transform="translate(0 96)">
      <circle cx="14" cy="14" r="14" fill="#c6f84e"/>
      <text x="14" y="19" font-size="16" font-weight="700" fill="#0e1219" text-anchor="middle">&#10003;</text>
      <text x="44" y="20" font-weight="600">Mexicano</text>
    </g>
    <g transform="translate(0 144)">
      <circle cx="14" cy="14" r="14" fill="#c6f84e"/>
      <text x="14" y="19" font-size="16" font-weight="700" fill="#0e1219" text-anchor="middle">&#10003;</text>
      <text x="44" y="20" font-weight="600">Round Robin</text>
    </g>
    <g transform="translate(0 192)">
      <circle cx="14" cy="14" r="14" fill="#c6f84e"/>
      <text x="14" y="19" font-size="16" font-weight="700" fill="#0e1219" text-anchor="middle">&#10003;</text>
      <text x="44" y="20" font-weight="600">Bracket (single elimination)</text>
    </g>
    <g transform="translate(0 240)">
      <circle cx="14" cy="14" r="14" fill="#c6f84e"/>
      <text x="14" y="19" font-size="16" font-weight="700" fill="#0e1219" text-anchor="middle">&#10003;</text>
      <text x="44" y="20" font-weight="600">Cloud sync across devices</text>
    </g>
  </g>

  <!-- CTA button -->
  <g transform="translate(48 600)">
    <rect width="${W - 96}" height="64" rx="14" fill="#c6f84e"/>
    <text x="${(W - 96) / 2}" y="42" font-family="Helvetica" font-size="20" font-weight="800" fill="#0e1219" text-anchor="middle">Start 7-day free trial</text>
  </g>

  <!-- Plans -->
  <g transform="translate(48 696)">
    <rect width="${W - 96}" height="56" rx="12" fill="#252b38" stroke="#444"/>
    <text x="20" y="34" font-family="Helvetica" font-size="14" font-weight="700" fill="#ffffff">Monthly</text>
    <text x="${W - 116}" y="34" font-family="Helvetica" font-size="14" fill="#a8a8a8" text-anchor="end">AUD $9.99 / month</text>
  </g>
  <g transform="translate(48 764)">
    <rect width="${W - 96}" height="56" rx="12" fill="#252b38" stroke="#fbcf5f"/>
    <text x="20" y="34" font-family="Helvetica" font-size="14" font-weight="700" fill="#ffffff">Annual</text>
    <text x="120" y="34" font-family="Helvetica" font-size="11" letter-spacing="1" fill="#fbcf5f">SAVE 33%</text>
    <text x="${W - 116}" y="34" font-family="Helvetica" font-size="14" fill="#a8a8a8" text-anchor="end">AUD $79.99 / year</text>
  </g>

  <!-- Fine print -->
  <text x="${W / 2}" y="860" font-family="Helvetica" font-size="11" fill="#666" text-anchor="middle">Auto-renews after the trial. Cancel anytime in your Apple subscriptions.</text>
  <text x="${W / 2}" y="880" font-family="Helvetica" font-size="11" fill="#666" text-anchor="middle">Restore Purchases &#183; Terms &#183; Privacy</text>
</svg>`;

await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(outPath);

console.log(`Wrote ${outPath} (${W}x${H})`);
