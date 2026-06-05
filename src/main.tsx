import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initIAP } from '@/lib/iap';
import './index.css';

// Fire-and-forget; no-op on web, configures RevenueCat on native.
void initIAP();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
