import { toPng } from 'html-to-image';

export interface ShareOptions {
  filename: string;
  shareTitle?: string;
  shareText?: string;
}

/**
 * Capture a DOM node as a PNG. Tries the Web Share API on mobile / supporting
 * browsers; falls back to a regular file download otherwise.
 */
export async function captureAndShare(node: HTMLElement, opts: ShareOptions): Promise<void> {
  // 2x pixel ratio for crisp results on retina / when shared to social
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: '#0e1219',
    // Inline Google Fonts so the off-screen capture renders with Archivo Black
    // even before the page font has cached, otherwise the export defaults to
    // a system fallback.
    fontEmbedCSS: undefined,
  });

  // Prefer Web Share API for native share sheet (iOS + modern Android)
  const blob = await dataUrlToBlob(dataUrl);
  const file = new File([blob], opts.filename, { type: 'image/png' });

  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });

  if (canShareFiles && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        files: [file],
        title: opts.shareTitle,
        text: opts.shareText,
      });
      return;
    } catch (err) {
      // User cancelled or share failed — fall through to download
      if ((err as Error).name === 'AbortError') return;
    }
  }

  // Download fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
