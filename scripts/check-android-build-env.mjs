// Validate public build configuration without printing keys or credentials.
import { loadEnv } from 'vite';
const env = loadEnv('production', process.cwd(), 'VITE_');
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_PUBLIC_APP_URL', 'VITE_REVENUECAT_PUBLIC_API_KEY_ANDROID']) {
  if (!env[key]?.trim()) throw new Error(`Missing release environment variable: ${key}`);
}
for (const key of ['VITE_SUPABASE_URL', 'VITE_PUBLIC_APP_URL']) {
  const url = new URL(env[key]);
  if (url.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0)/.test(url.hostname)) {
    throw new Error(`${key} must point to the production HTTPS service.`);
  }
}
if (!env.VITE_REVENUECAT_PUBLIC_API_KEY_ANDROID.startsWith('goog_')) {
  throw new Error('Android billing requires the Google Play public SDK key, not an Apple or test-store key.');
}
console.log('Production sync and Android public billing configuration is present. Store credential validation and purchase testing are separate prerequisites.');
