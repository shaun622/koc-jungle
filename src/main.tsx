import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initIAP } from '@/lib/iap';
import { publicSignupHashFromPath } from '@/lib/signups';
import './index.css';

// Shared links use a real path so installed PWAs and mobile browsers navigate
// reliably. Convert it before HashRouter mounts; old #/signup links continue
// to work unchanged.
const publicSignupHash = publicSignupHashFromPath(window.location.pathname, window.location.search);
if (publicSignupHash) {
  window.history.replaceState(null, '', `/${publicSignupHash}`);
}

// Fire-and-forget; no-op on web, configures RevenueCat on native.
void initIAP();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
