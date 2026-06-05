#!/usr/bin/env node
/**
 * Generate a Sign in with Apple client_secret JWT for Supabase.
 *
 * Apple requires the OAuth secret to be a JWT signed with the .p8
 * private key (ES256). Supabase's dashboard takes that signed JWT
 * directly. Apple caps the JWT's expiry at 6 months — you'll need
 * to re-run this script and re-paste into Supabase twice a year.
 *
 * Usage:
 *   node scripts/generate-apple-jwt.mjs <path-to-.p8>
 *
 * Example:
 *   node scripts/generate-apple-jwt.mjs ~/Downloads/AuthKey_L8TR8SWBR2.p8
 *
 * The script prints the JWT to stdout. Copy it into Supabase Auth
 * Providers Apple Secret Key (for OAuth).
 *
 * No npm deps required — uses Node's built-in crypto.
 */

import { readFileSync } from 'node:fs';
import { createPrivateKey, createSign } from 'node:crypto';
import process from 'node:process';

// ─── Edit these if your IDs ever change ───────────────────────────────
const TEAM_ID = '46ZZD94H9G';
const KEY_ID = 'L8TR8SWBR2';
const SERVICES_ID = 'com.koc.padel.web';
// ──────────────────────────────────────────────────────────────────────

const p8Path = process.argv[2];
if (!p8Path) {
  console.error('Usage: node scripts/generate-apple-jwt.mjs <path-to-.p8>');
  console.error('Example: node scripts/generate-apple-jwt.mjs AuthKey_L8TR8SWBR2.p8');
  process.exit(1);
}

const privateKeyPem = readFileSync(p8Path, 'utf8').trim();

const base64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const now = Math.floor(Date.now() / 1000);
const sixMonths = 60 * 60 * 24 * 180; // Apple caps at this.

const header = base64url(
  JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }),
);
const payload = base64url(
  JSON.stringify({
    iss: TEAM_ID,
    iat: now,
    exp: now + sixMonths,
    aud: 'https://appleid.apple.com',
    sub: SERVICES_ID,
  }),
);

const signingInput = `${header}.${payload}`;
const keyObject = createPrivateKey(privateKeyPem);

const signer = createSign('SHA256');
signer.update(signingInput);
const signature = signer.sign({
  key: keyObject,
  dsaEncoding: 'ieee-p1363', // ES256 requires raw r||s, not DER
});

const jwt = `${signingInput}.${base64url(signature)}`;

console.log('\n--- Paste this JWT as the Supabase "Secret Key (for OAuth)" ---\n');
console.log(jwt);
console.log('\n--- Expires:', new Date((now + sixMonths) * 1000).toISOString(), '---\n');
