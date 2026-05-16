import html2canvas from 'html2canvas';

export interface ShareOptions {
  filename: string;
  shareTitle?: string;
  shareText?: string;
}

/**
 * Capture a DOM node as a PNG via html2canvas, then share via Web Share API
 * (iOS / modern Android) or fall back to a regular file download.
 *
 * We use html2canvas (rather than html-to-image) because it reads each
 * element's computed style via `getComputedStyle`, which the browser already
 * resolves to plain RGB even when the source CSS uses `oklch()` or
 * `color-mix()`. html-to-image's SVG-foreignObject path serialises the
 * source CSS, which iOS Safari doesn't always render — producing a black
 * blank capture when oklch shows up. html2canvas avoids that entire class
 * of bug at the cost of a slightly heavier (~50 KB gz) library.
 */
export async function captureAndShare(node: HTMLElement, opts: ShareOptions): Promise<void> {
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

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Could not encode canvas as PNG'));
    }, 'image/png');
  });

  const file = new File([blob], opts.filename, { type: 'image/png' });

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
