/**
 * Cross-platform image sharing.
 *
 * On the native iOS/Android app (Capacitor WKWebView) the Web Share API with
 * files is unavailable and an `<a download>` click silently no-ops — so the
 * "share" button appears to do nothing. There we route through the native
 * Share plugin (write the image to the cache dir, hand its file URI to the OS
 * share sheet). On the web we keep the Web Share API with a download fallback.
 *
 * Mirrors the dynamic-import Capacitor pattern in src/lib/haptics.ts so the
 * plugins are only pulled in on native.
 */
import { Capacitor } from '@capacitor/core';

const native = Capacitor.isNativePlatform();

export interface ShareResult {
  ok: boolean;
  error?: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image data.'));
    reader.onload = () => {
      const result = String(reader.result);
      // data:image/png;base64,XXXX -> XXXX
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function shareImageBlob(
  blob: Blob,
  opts: { filename: string; title?: string; text?: string },
): Promise<ShareResult> {
  if (native) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const base64 = await blobToBase64(blob);
      const written = await Filesystem.writeFile({
        path: opts.filename,
        data: base64,
        directory: Directory.Cache,
      });
      await Share.share({ title: opts.title, text: opts.text, url: written.uri });
      return { ok: true };
    } catch (err) {
      // Dismissing the share sheet rejects on iOS — treat cancels as success.
      const msg = (err as { message?: string }).message ?? '';
      if (/cancel/i.test(msg)) return { ok: true };
      console.warn('[share] native share failed', err);
      return { ok: false, error: 'Could not open the share sheet.' };
    }
  }

  // Web: Web Share API with files, else download.
  const file = new File([blob], opts.filename, { type: blob.type || 'image/png' });
  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });
  if (canShareFiles && typeof navigator.share === 'function') {
    try {
      await navigator.share({ files: [file], title: opts.title, text: opts.text });
      return { ok: true };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return { ok: true };
      // fall through to download
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = opts.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err) {
    console.warn('[share] download fallback failed', err);
    return { ok: false, error: 'Could not share or download the image.' };
  }
}
