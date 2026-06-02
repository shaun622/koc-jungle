import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration (Stage 2.2).
 *
 * The Vite build writes to `dist/`. Capacitor's `npx cap sync` copies
 * this into `ios/App/App/public` and `android/app/src/main/assets/public`
 * so the native shell loads the same SPA the PWA serves.
 *
 *   1. Run on the user's Mac (iOS) / Windows or Mac (Android):
 *        npm run build && npx cap sync
 *        npx cap add ios     # one-time, requires Xcode
 *        npx cap add android # one-time, requires Android Studio
 *
 *   2. Open the native project for store submission:
 *        npx cap open ios     # opens Xcode
 *        npx cap open android # opens Android Studio
 *
 *   3. The `appId` doubles as the iOS bundle ID and the Android
 *      applicationId. Reverse-DNS, must match App Store Connect.
 *
 * Note: the PWA at koc-jungle.pages.dev keeps deploying from
 * Cloudflare Pages off `main` exactly as today — the native shell is
 * a parallel distribution channel, not a migration.
 */

const config: CapacitorConfig = {
  appId: 'com.koc.padel',
  appName: 'King of the Court',
  webDir: 'dist',
  bundledWebRuntime: false,

  ios: {
    // iOS 14+ covers WebKit's modern oklch / color-mix support, which
    // the app uses heavily for the gold court accents.
    contentInset: 'always',
  },

  android: {
    // Bypass cleartext blocking in dev only; remove for store builds.
    allowMixedContent: false,
  },

  // Server config: leave empty for store builds so the app loads the
  // bundled web assets. For live-reload dev: `npx cap run ios --livereload`.
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
};

export default config;
