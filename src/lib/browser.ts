/**
 * Open an external URL.
 *
 * On native (Capacitor) this uses @capacitor/browser, which presents an
 * in-app SFSafariViewController (iOS) / Chrome Custom Tab (Android) so the
 * user never leaves the app. This matters for App Review Guideline 4 and
 * because plain `target="_blank"` anchors do not reliably open in an iOS
 * WKWebView. On the web it opens a normal new tab.
 */

import { Capacitor } from '@capacitor/core';

export async function openUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
