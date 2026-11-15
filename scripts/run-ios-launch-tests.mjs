import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('Native iOS launch tests require a Mac with Xcode; browser emulation is not equivalent.');
const family = process.argv[2];
if (!['iphone', 'ipad'].includes(family)) throw new Error('Specify iphone or ipad.');
const output = path.resolve('ios-launch-results', family);
fs.mkdirSync(output, { recursive: true });
const run = (tool, args) => execFileSync(tool, args, { encoding: 'utf8' });
const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']).trim();
if (!sdk.startsWith('27.')) throw new Error(`Expected iOS 27 SDK, got ${sdk}.`);
const { runtimes } = JSON.parse(run('xcrun', ['simctl', 'list', 'runtimes', '--json']));
const runtime = runtimes.filter(r => r.isAvailable && r.identifier.includes('.iOS-') && r.version.startsWith('27.'))
  .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))[0];
if (!runtime) throw new Error('No installed iOS 27 simulator runtime. Do not substitute a browser or older iOS.');
const { devices } = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '--json']));
const candidates = (devices[runtime.identifier] ?? []).filter(d => d.isAvailable && d.name.startsWith(family === 'iphone' ? 'iPhone' : 'iPad'));
let device = family === 'iphone' ? candidates.find(d => d.name === 'iPhone 17 Pro Max')
  : candidates.find(d => d.name.includes('13-inch')) ?? candidates[0];
if (family === 'iphone' && !device) {
  const deviceType = runtime.supportedDeviceTypes.find(d => d.name === 'iPhone 17 Pro Max');
  if (!deviceType) throw new Error('iOS 27 runtime does not support the required iPhone 17 Pro Max.');
  const udid = run('xcrun', ['simctl', 'create', 'iPhone 17 Pro Max', deviceType.identifier, runtime.identifier]).trim();
  device = { name: 'iPhone 17 Pro Max', udid, state: 'Shutdown', deviceTypeIdentifier: deviceType.identifier };
}
if (!device) throw new Error(`No ${family} device for ${runtime.identifier}.`);
if (family === 'ipad') {
  // Isolate the app from any state baked into the hosted runner's simulator.
  const udid = run('xcrun', ['simctl', 'create', 'Padel clean iPad', device.deviceTypeIdentifier, runtime.identifier]).trim();
  device = { name: 'Padel clean iPad', udid, state: 'Shutdown', deviceTypeIdentifier: device.deviceTypeIdentifier };
}
const evidence = { commit: run('git', ['rev-parse', 'HEAD']).trim(), xcode: run('xcodebuild', ['-version']).trim(), sdk, runtime, device };
fs.writeFileSync(path.join(output, 'environment.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (device.state !== 'Booted') run('xcrun', ['simctl', 'boot', device.udid]);
const boot = spawnSync('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { stdio: 'inherit', timeout: 600000 });
if (boot.error) throw new Error(`Simulator boot failed before app testing: ${boot.error.message}`);
if (boot.status !== 0) throw new Error(`Simulator boot failed before app testing (${boot.status}).`);
const result = spawnSync('xcodebuild', [
  '-workspace', 'ios/App/App.xcworkspace', '-scheme', 'App', '-configuration', 'Release',
  '-destination', `platform=iOS Simulator,id=${device.udid}`, '-destination-timeout', '180',
  '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
  '-resultBundlePath', path.join(output, 'Launch.xcresult'),
  '-derivedDataPath', path.resolve('ios/DerivedData/LaunchTests'),
  'CODE_SIGNING_ALLOWED=NO', 'ONLY_ACTIVE_ARCH=YES', 'test',
], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Native ${device.name} launch, interaction, rotation and resume tests passed on iOS ${runtime.version}.`);
