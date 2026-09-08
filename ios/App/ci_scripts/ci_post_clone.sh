#!/bin/sh
# Xcode Cloud starts from a clean checkout: prepare the current web bundle
# and CocoaPods before Xcode resolves or archives the native workspace.
set -eu
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1
export COCOAPODS_DISABLE_STATS=true

RELEASE_ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)}"
test -n "$RELEASE_ROOT"
test -f "$RELEASE_ROOT/package-lock.json"
cd "$RELEASE_ROOT"

if ! brew list --versions node@22 >/dev/null 2>&1; then
  brew install node@22
fi
export PATH="$(brew --prefix node@22)/bin:$PATH"
if ! command -v pod >/dev/null 2>&1; then
  brew install cocoapods
fi

npm ci
node scripts/check-ios-build-env.mjs
npm run build
npm exec -- cap sync ios
test -f ios/App/Pods/Target\ Support\ Files/Pods-App/Pods-App.release.xcconfig
echo "Current app assets and native dependencies are ready for archive."
