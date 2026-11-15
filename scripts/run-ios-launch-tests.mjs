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
const deviceName = family === 'iphone' ? 'iPhone 17 Pro Max' : 'iPad Pro 13-inch (M5)';
const deviceType = runtime.supportedDeviceTypes.find(d => d.name === deviceName);
if (!deviceType) throw new Error(`iOS 27 runtime does not support the required ${deviceName}.`);
// Each hosted run owns a new device, never a simulator with image-baked state.
const udid = run('xcrun', ['simctl', 'create', `Padel CI ${deviceName}`, deviceType.identifier, runtime.identifier]).trim();
const device = { name: deviceName, udid, state: 'Shutdown', deviceTypeIdentifier: deviceType.identifier };
const evidence = { commit: run('git', ['rev-parse', 'HEAD']).trim(), xcode: run('xcodebuild', ['-version']).trim(), sdk, runtime, device };
fs.writeFileSync(path.join(output, 'environment.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ ...evidence, runtime: { name: runtime.name, version: runtime.version, buildversion: runtime.buildversion } }, null, 2));
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
