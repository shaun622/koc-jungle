#!/usr/bin/env node
/**
 * Capture App Store screenshots at the exact pixel dimensions Apple
 * requires for the iOS app submission.
 *
 * Output:
 *   screenshots/iphone-6.7/01-landing.png       (1290x2796)
 *   screenshots/iphone-6.7/02-setup.png
 *   screenshots/iphone-6.7/03-display.png
 *   screenshots/iphone-6.7/04-leaderboard.png
 *   screenshots/iphone-6.7/05-podium.png
 *   screenshots/ipad-13/01-landing.png          (2752x2064 landscape)
 *   …same five for iPad
 *
 * Strategy:
 *   1. Pre-build a complete-state EventState fixture (a 14-team event
 *      with 5 played rounds + 1 unfinished round so every screen has
 *      something to show).
 *   2. For each frame: inject the right localStorage state + theme,
 *      navigate to the route, snap the screenshot.
 *
 * The PWA reads from localStorage on boot, so injecting state before
 * page load gives us deterministic visuals without driving the UI.
 *
 * Run: node scripts/capture-screenshots.mjs
 *      (or: BASE_URL=http://localhost:5173 node scripts/capture-screenshots.mjs)
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const outRoot = resolve(projectRoot, 'screenshots');
const BASE = process.env.BASE_URL || 'https://koc-jungle.pages.dev';

// ─── Devices ──────────────────────────────────────────────────────────
const DEVICES = [
  {
    folder: 'iphone-6.7',
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    // → 1290x2796 physical pixels (Apple's iPhone 6.7" target)
    isMobile: true,
    isLandscape: false,
  },
  {
    folder: 'ipad-13',
    viewport: { width: 1376, height: 1032 },
    deviceScaleFactor: 2,
    // → 2752x2064 physical pixels (Apple's iPad Pro 13" landscape target)
    isMobile: false,
    isLandscape: true,
  },
];

// ─── Fixture data ─────────────────────────────────────────────────────
// A 6-team event with 3 completed rounds + standings, all built so the
// Live / Leaderboard / Podium screens render realistically.

function buildFixture(status, completedRounds) {
  const teams = [
    ['Jon', 'Sven'],
    ['Wallace', 'Patrick'],
    ['Maxime', 'Jonas'],
    ['Tom WH', 'Dan'],
    ['Andy S', 'Zach'],
    ['Chris DH', 'William'],
  ].map(([p1, p2], i) => ({
    id: `t${i + 1}`,
    name: undefined,
    players: [
      { id: `p${i}a`, name: p1 },
      { id: `p${i}b`, name: p2 },
    ],
    createdAt: 1700000000000 + i,
    active: true,
  }));

  const courts = [
    { id: 'c3', position: 3, name: 'Centre Court', pointValue: 9 },
    { id: 'c2', position: 2, name: 'Court 2', pointValue: 7 },
    { id: 'c1', position: 1, name: 'Court 1', pointValue: 5 },
  ];

  // Helper to build a completed round with realistic scores
  function makeRound(idx, matchups, completed) {
    return {
      id: `r${idx}`,
      index: idx,
      durationMs: 20 * 60 * 1000,
      totalPausedMs: 0,
      startedAt: 1700000000000 + idx * 1_300_000,
      pausedAt: completed ? undefined : 1700000000000 + idx * 1_300_000 + 700_000,
      completedAt: completed ? 1700000000000 + idx * 1_300_000 + 1_200_000 : undefined,
      matches: matchups.map(([cId, a, b, sA, sB], mi) => {
        const court = courts.find((c) => c.id === cId);
        return {
          id: `m${idx}-${mi}`,
          courtId: cId,
          teamAId: a,
          teamBId: b,
          scoreA: sA,
          scoreB: sB,
          status: completed ? 'completed' : 'in-progress',
          pointValueAtTime: court.pointValue,
        };
      }),
    };
  }

  const rounds = [
    makeRound(1, [
      ['c3', 't1', 't2', 11, 8],
      ['c2', 't3', 't4', 9, 11],
      ['c1', 't5', 't6', 12, 7],
    ], true),
    makeRound(2, [
      ['c3', 't1', 't4', 11, 6],
      ['c2', 't5', 't2', 10, 11],
      ['c1', 't3', 't6', 8, 11],
    ], true),
    makeRound(3, [
      ['c3', 't1', 't2', 9, 11],
      ['c2', 't4', 't6', 11, 5],
      ['c1', 't3', 't5', 12, 8],
    ], true),
  ];

  // A live (in-progress) round for the Display screen
  if (status === 'round-in-progress') {
    rounds.push(
      makeRound(4, [
        ['c3', 't2', 't1', 7, 4],
        ['c2', 't6', 't3', 5, 6],
        ['c1', 't5', 't4', 9, 3],
      ], false),
    );
  }

  return {
    state: {
      event: {
        id: 'screenshot-event',
        name: 'Monday Night Padel',
        venue: 'High Court Padel',
        createdAt: 1700000000000,
        status,
        settings: {
          defaultRoundDurationMs: 20 * 60 * 1000,
          tieRule: 'operator-decides',
          soundOnTimerEnd: true,
          warningAtMs: 60 * 1000,
          roundsTotal: completedRounds + (status === 'round-in-progress' ? 1 : 0),
          announceRoundStart: false,
        },
        courts,
        teams,
        rounds,
        format: 'koc',
      },
    },
    version: 1,
  };
}

// ─── Page injectors ───────────────────────────────────────────────────

async function injectFixture(page, fixture) {
  await page.addInitScript(({ key, fixture }) => {
    try {
      localStorage.setItem(key, JSON.stringify(fixture));
      // Set theme to dark for consistent screenshots
      localStorage.setItem('koc-theme-v1', JSON.stringify({
        state: { preference: 'dark' },
        version: 2,
      }));
      // Pre-grant Pro so the paywall doesn't get in the way
      localStorage.setItem('koc-entitlements-v1', JSON.stringify({
        state: {
          pro: true,
          loading: false,
          trialEndsAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
          trialUsed: true,
        },
        version: 0,
      }));
    } catch (e) {
      console.error('inject failed', e);
    }
  }, { key: 'koc-event-v1', fixture });
}

async function injectCleanCss(page) {
  // Hide UI affordances that shouldn't appear in store screenshots:
  // PWA install / update / offline-ready toasts.
  await page.addStyleTag({
    content: `
      .pwa-toast, .update-prompt { display: none !important; }
    `,
  });
}

// ─── Capture sequence ─────────────────────────────────────────────────

async function captureFrame(context, label, opts) {
  const page = await context.newPage();
  if (opts.fixture) await injectFixture(page, opts.fixture);
  else {
    // Clean state — clear any stored event
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('koc-event-v1');
        localStorage.setItem('koc-theme-v1', JSON.stringify({
          state: { preference: 'dark' },
          version: 2,
        }));
        localStorage.setItem('koc-entitlements-v1', JSON.stringify({
          state: { pro: true, loading: false, trialEndsAt: Date.now() + 6 * 24 * 60 * 60 * 1000, trialUsed: true },
          version: 0,
        }));
      } catch (e) { /* ignore */ }
    });
  }

  const url = `${BASE}${opts.hash || ''}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await injectCleanCss(page);
  await page.waitForTimeout(opts.settleMs ?? 700);
  if (opts.beforeShot) await opts.beforeShot(page);

  await page.screenshot({ path: opts.outPath, type: 'png', fullPage: false });
  console.log(`  ✓ ${label} -> ${opts.outPath}`);
  await page.close();
}

// ─── Main ─────────────────────────────────────────────────────────────

const browser = await chromium.launch();

for (const device of DEVICES) {
  const folder = resolve(outRoot, device.folder);
  mkdirSync(folder, { recursive: true });
  console.log(`\n${device.folder}  (${device.viewport.width * device.deviceScaleFactor}x${device.viewport.height * device.deviceScaleFactor})`);

  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    // iPhone 6.7" has 'iPhone' UA, iPad has 'iPad' UA; influences any
    // device-detection but the PWA mostly responds to viewport size.
    userAgent: device.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  });

  // 1. Landing (no event)
  await captureFrame(context, 'Landing', {
    outPath: resolve(folder, '01-landing.png'),
    hash: '/#/setup',
  });

  // 2. Setup with demo event loaded
  await captureFrame(context, 'Setup', {
    outPath: resolve(folder, '02-setup.png'),
    fixture: buildFixture('setup', 0),
    hash: '/#/setup',
  });

  // 3. Live display (round in progress)
  await captureFrame(context, 'Display (live)', {
    outPath: resolve(folder, '03-display.png'),
    fixture: buildFixture('round-in-progress', 3),
    hash: '/#/display',
    settleMs: 1200, // canvas scale calc needs a beat
  });

  // 4. Leaderboard
  await captureFrame(context, 'Leaderboard', {
    outPath: resolve(folder, '04-leaderboard.png'),
    fixture: buildFixture('between-rounds', 3),
    hash: '/#/leaderboard',
  });

  // 5. Podium (complete)
  await captureFrame(context, 'Podium', {
    outPath: resolve(folder, '05-podium.png'),
    fixture: buildFixture('complete', 3),
    hash: '/#/display',
    settleMs: 1200,
  });

  await context.close();
}

await browser.close();
console.log('\nAll screenshots written to ./screenshots/');
