/**
 * Portal: render children directly under <body>.
 *
 * Overlays (menus, modals) must escape any ancestor that establishes a
 * stacking context or a containing block for fixed positioning (e.g. a
 * sticky header with backdrop-filter, or an animated screen with a
 * transform). Portaling to <body> guarantees the overlay covers the
 * viewport and sits above everything.
 */

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
