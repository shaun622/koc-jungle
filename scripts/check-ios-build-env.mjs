// Fail the native release before packaging a build without sync or billing.
// Only variable names appear in output, never their values.
import { loadEnv } from 'vite';
const env = loadEnv('production', process.cwd(), 'VITE_');
const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_REVENUECAT_PUBLIC_API_KEY_IOS'];
const missing = required.filter(key => !env[key]?.trim());
if (missing.length) throw new Error(`Missing release environment variables: ${missing.join(', ')}`);
const url = new URL(env.VITE_SUPABASE_URL);
if (url.protocol !== 'https:' || /^(localhost|127\.|0\.0\.0\.0)/.test(url.hostname)) {
  throw new Error('VITE_SUPABASE_URL must point to the production HTTPS service.');
}
if (!env.VITE_REVENUECAT_PUBLIC_API_KEY_IOS.startsWith('appl_')) {
  throw new Error('VITE_REVENUECAT_PUBLIC_API_KEY_IOS must be the iOS public SDK key.');
}
console.log('Production sync and iOS billing configuration is present.');
