import { toCanvas, toPng } from 'html-to-image';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

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

  const blob = await dataUrlToBlob(dataUrl);
  const file = new File([blob], opts.filename, { type: 'image/png' });
  await shareOrDownload(file, blob, opts);
}

export interface GifShareOptions extends ShareOptions {
  /** Optional progress callback: invoked after each captured frame. */
  onProgress?: (framesDone: number, total: number) => void;
}

/**
 * Capture a DOM node as an animated GIF. Used for the podium share so the
 * recipient sees the confetti animating.
 *
 * Internally takes N frames of toCanvas at a reduced pixel ratio, then
 * quantises each frame to a 256-colour palette and writes them into a GIF
 * via gifenc. The frames are taken sequentially with a delay between each
 * so the CSS confetti animation has time to advance.
 */
export async function captureAndShareGif(
  node: HTMLElement,
  opts: GifShareOptions,
): Promise<void> {
  const FRAMES = 15;
  const FRAME_DELAY_MS = 130; // also the GIF playback delay between frames

  const enc = GIFEncoder();
  let width = 0;
  let height = 0;

  for (let i = 0; i < FRAMES; i++) {
    const canvas = await toCanvas(node, {
      pixelRatio: 0.667, // 1920x1080 → ~1280x720 per frame
      cacheBust: i === 0,
      backgroundColor: '#0e1219',
    });
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    width = canvas.width;
    height = canvas.height;
    const { data } = ctx.getImageData(0, 0, width, height);
    // 256-colour palette per frame. Acceptable size/quality trade for a podium
    // shot with a fixed-palette background and a handful of confetti colours.
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    enc.writeFrame(index, width, height, {
      palette,
      delay: FRAME_DELAY_MS,
    });
    opts.onProgress?.(i + 1, FRAMES);
    // Yield to the browser so the confetti CSS animation can advance before
    // the next capture.
    await new Promise((r) => setTimeout(r, FRAME_DELAY_MS));
  }
  enc.finish();
  const bytes = enc.bytes();
  // ArrayBuffer is required by Blob; pass the typed array's underlying buffer.
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' });
  const file = new File([blob], opts.filename, { type: 'image/gif' });
  await shareOrDownload(file, blob, opts);
}

async function shareOrDownload(
  file: File,
  blob: Blob,
  opts: ShareOptions,
): Promise<void> {
  // Prefer Web Share API for native share sheet (iOS + modern Android)
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
      if ((err as Error).name === 'AbortError') return;
      // Fall through to download on other errors
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
