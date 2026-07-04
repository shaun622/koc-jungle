import html2canvas from 'html2canvas';
import { shareImageBlob, type ShareResult } from '@/lib/share';

export interface ShareOptions {
  filename: string;
  shareTitle?: string;
  shareText?: string;
}

/**
 * Capture a DOM node as a PNG via html2canvas, then hand it to the
 * platform-aware share layer (native share sheet on iOS/Android, Web Share /
 * download on the web — see src/lib/share.ts). Returns a result the caller
 * can surface to the user instead of failing silently.
 *
 * We use html2canvas (rather than html-to-image) because it reads each
 * element's computed style via `getComputedStyle`, which the browser already
 * resolves to plain RGB even when the source CSS uses `oklch()` or
 * `color-mix()`. html-to-image's SVG-foreignObject path serialises the
 * source CSS, which iOS Safari doesn't always render — producing a black
 * blank capture when oklch shows up. html2canvas avoids that entire class
 * of bug at the cost of a slightly heavier (~50 KB gz) library.
 */
export async function captureAndShare(
  node: HTMLElement,
  opts: ShareOptions,
): Promise<ShareResult> {
  let blob: Blob;
  try {
    const canvas = await html2canvas(node, {
      backgroundColor: '#0e1219',
      scale: 2, // retina-friendly
      useCORS: true,
      logging: false,
      // html2canvas measures the node by default; we still pass explicit dims
      // so the off-screen positioning (left: -10000px) doesn't confuse it.
      width: node.offsetWidth,
      height: node.offsetHeight,
      windowWidth: node.offsetWidth,
      windowHeight: node.offsetHeight,
    });
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Could not encode the image.'));
      }, 'image/png');
    });
  } catch (err) {
    console.warn('[share] capture failed', err);
    return { ok: false, error: 'Could not create the image.' };
  }

  return shareImageBlob(blob, {
    filename: opts.filename,
    title: opts.shareTitle,
    text: opts.shareText,
  });
}
