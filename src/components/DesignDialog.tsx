import { useEffect, useRef, type ReactNode } from 'react';

/** Native dialog supplies focus containment, Escape and top-layer rendering. */
export function DesignDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => { if (typeof dialog.close === 'function') dialog.close(); };
  }, []);
  return <dialog ref={ref} className="event-design ed-dialog" aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ed-dialog-inner"><div className="ed-dialog-heading"><h2>{title}</h2><button className="btn" onClick={onClose} aria-label="Close">×</button></div>{children}</div>
  </dialog>;
}
