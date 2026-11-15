import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkIOSScene(root = process.cwd()) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const plist = read('ios/App/App/Info.plist');
  const app = read('ios/App/App/AppDelegate.swift');
  const scene = read('ios/App/App/SceneDelegate.swift');
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(plist, /<key>UIApplicationSceneManifest<\/key>/, 'iOS 27 requires scene lifecycle configuration');
  assert.match(plist, /<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\s*\/>/, 'Keep the single-window tournament app');
  assert.match(plist, /<key>UISceneDelegateClassName<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>/);
  assert.doesNotMatch(plist, /<key>(?:UIMainStoryboardFile|UISceneStoryboardFile)<\/key>/, 'Programmatic scene must not create a second storyboard bridge');
  assert.match(app, /configurationForConnecting[\s\S]*delegateClass = SceneDelegate\.self/);
  assert.match(app, /if connectingSceneSession\.role == \.windowApplication\s*\{\s*configuration\.delegateClass = SceneDelegate\.self/,
    'AirPlay must not create a second app instance');
  assert.match(scene, /guard session\.role == \.windowApplication/, 'Only the device application scene may create a bridge');
  assert.match(scene, /window\?\.rootViewController = CAPBridgeViewController\(\)/);
  for (const callback of ['willConnectTo: session, options: connectionOptions', 'openURLContexts: URLContexts', 'continue: userActivity']) {
    assert.ok(scene.includes(`SceneDelegateProxy.shared.scene(scene, ${callback})`), `Missing Capacitor callback: ${callback}`);
  }
  assert.match(project, /SceneDelegate\.swift in Sources/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['@capacitor/ios'], '8.5.3', 'Use the verified scene-support release');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkIOSScene();
  console.log('iOS scene configuration, single window and link forwarding checks passed. Native launch still requires XCTest.');
}
