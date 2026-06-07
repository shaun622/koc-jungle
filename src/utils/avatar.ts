import type { Player } from '@/types/domain';

/**
 * Two letters max — first letter of first name, first letter of last name if
 * present. Falls back to "?" for empty names.
 */
export function playerInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

/**
 * Deterministic colour from the player's name. Returns an oklch() string.
 *
 * The hue rotates around the colour wheel; lightness/chroma are constrained
 * so the resulting circles stay readable against both light and dark text.
 */
export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  // 60% lightness + 0.12 chroma gives a saturated mid-tone that's safe with
  // white text and visible on the dark UI.
  return `oklch(60% 0.14 ${hue})`;
}

export function avatarColor(player: Player): string {
  return player.avatar?.color ?? colorForName(player.name);
}

/**
 * Crop the centre square of an image File and downscale it to a 128×128 PNG
 * data URL suitable for stashing in localStorage on a Player record.
 *
 * Throws if the file isn't an image.
 */
export async function cropImageFileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selected file is not an image.');
  }
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, 128, 128);
  return canvas.toDataURL('image/png');
}

/**
 * Fit an image File inside a 256×256 transparent PNG (contain, not crop)
 * so a club's whole logo is preserved (wide or tall). Returns a data URL
 * for localStorage. Throws if the file isn't an image.
 */
export async function fitImageFileToLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selected file is not an image.');
  }
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const SIZE = 256;
  const scale = Math.min(SIZE / img.width, SIZE / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  return canvas.toDataURL('image/png');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = src;
  });
}
