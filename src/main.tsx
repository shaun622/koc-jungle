import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initIAP } from '@/lib/iap';
import { publicSignupHashFromPath } from '@/lib/signups';
import './index.css';
import './styles/event-design.css';
import './styles/app-design.css';
import './styles/tournament-v1.css';

// Shared links use a real path so installed PWAs and mobile browsers navigate
// reliably. Convert it before HashRouter mounts; old #/signup links continue
// to work unchanged.
const publicSignupHash = publicSignupHashFromPath(window.location.pathname, window.location.search);
if (publicSignupHash) {
  window.history.replaceState(null, '', `/${publicSignupHash}`);
} else if (window.location.pathname === '/auth/recovery') {
  window.history.replaceState(null, '', `/#/auth/recovery${window.location.search}`);
}

// Fire-and-forget; no-op on web, configures RevenueCat on native.
void initIAP();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
