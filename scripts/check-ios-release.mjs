import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const passes = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function pass(message) {
  passes.push(message);
}

function error(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function envKeys() {
  const found = new Set(Object.keys(process.env));
  for (const filename of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    if (!exists(filename)) continue;
    for (const line of read(filename).split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) found.add(match[1]);
    }
  }
  return found;
}

function pngSize(relativePath) {
  const data = fs.readFileSync(path.join(root, relativePath));
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function latestMtime(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) return 0;
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(0, ...fs.readdirSync(absolute).map((entry) => latestMtime(path.join(relativePath, entry))));
}

const packageJson = JSON.parse(read('package.json'));
if (packageJson.version === '1.1.0') pass('Release version is 1.1.0.');
else error(`package.json version must be 1.1.0 (found ${packageJson.version}).`);

const capacitorConfig = read('capacitor.config.ts');
if (capacitorConfig.includes("appId: 'com.koc.padel'")) pass('Bundle ID matches App Store Connect.');
else error('Capacitor bundle ID must be com.koc.padel.');

if (exists('ios/App/App.xcodeproj/project.pbxproj')) {
  pass('Capacitor iOS project exists.');
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  if (project.includes('MARKETING_VERSION = 1.1;')) pass('Xcode marketing version is 1.1.');
  else error('Xcode MARKETING_VERSION must be 1.1.');
  if (project.includes('CURRENT_PROJECT_VERSION = 3;')) pass('Xcode build number is 3.');
  else error('Xcode CURRENT_PROJECT_VERSION must be 3 or higher.');
} else {
  error('Missing ios/App/App.xcodeproj. Run `npx cap add ios --packagemanager CocoaPods`.');
}

if (exists('ios/App/Podfile') && read('ios/App/Podfile').includes('CapacitorCommunityKeepAwake')) {
  pass('CocoaPods includes the native keep-awake plugin.');
} else {
  error('The iOS project must include CapacitorCommunityKeepAwake for TV mirroring.');
}

if (exists('ios/App/App/PrivacyInfo.xcprivacy')) pass('App privacy manifest exists.');
else error('Missing ios/App/App/PrivacyInfo.xcprivacy.');

if (
  exists('ios/App/App/Info.plist') &&
  read('ios/App/App/Info.plist').includes('ITSAppUsesNonExemptEncryption')
) {
  pass('Export-compliance encryption declaration exists.');
} else {
  error('Info.plist must declare ITSAppUsesNonExemptEncryption.');
}

const keys = envKeys();
if (keys.has('VITE_REVENUECAT_PUBLIC_API_KEY_IOS')) pass('RevenueCat iOS public key is configured.');
else error('Missing VITE_REVENUECAT_PUBLIC_API_KEY_IOS in the release environment.');

const icon = exists('resources/icon.png') ? pngSize('resources/icon.png') : null;
if (icon?.width === 1024 && icon.height === 1024) pass('App icon source is 1024 × 1024.');
else error(`resources/icon.png must be a 1024 × 1024 PNG${icon ? ` (found ${icon.width} × ${icon.height})` : ''}.`);

for (const [folder, label] of [
  ['screenshots/iphone-6.5', 'iPhone 6.5-inch'],
  ['screenshots/ipad-13', 'iPad 13-inch'],
]) {
  const absolute = path.join(root, folder);
  const screenshots = exists(folder)
    ? fs.readdirSync(absolute).filter((name) => name.toLowerCase().endsWith('.png'))
    : [];
  if (screenshots.length >= 3) pass(`${label} screenshot set has ${screenshots.length} images.`);
  else error(`${label} screenshot set needs at least 3 PNG images.`);
}

const latestSource = Math.max(latestMtime('src'), latestMtime('public'));
const latestScreenshots = Math.max(
  latestMtime('screenshots/iphone-6.5'),
  latestMtime('screenshots/ipad-13'),
);
if (latestScreenshots >= latestSource) pass('Store screenshots are newer than the current UI.');
else warn('Store screenshots predate current UI changes; regenerate them before submission.');

if (exists('public/privacy/index.html') && exists('public/terms/index.html')) pass('Privacy policy and terms pages exist.');
else error('Privacy policy and terms pages are required.');

console.log('\nPadel Tournament Maker — iOS release check\n');
for (const item of passes) console.log(`✓ ${item}`);
for (const item of warnings) console.log(`⚠ ${item}`);
for (const item of errors) console.log(`✗ ${item}`);
console.log(`\n${passes.length} passed, ${warnings.length} warning(s), ${errors.length} blocker(s).\n`);

if (errors.length) process.exitCode = 1;
