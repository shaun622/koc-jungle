import { useCallback, useEffect, useState } from 'react';
import { safeGet, safeSet } from '@/utils/storage';

const KEY = 'koc-presentation-v1';
const EVENT = 'koc-presentation-change';

function readInitial(): boolean {
  return safeGet(KEY) === '1';
}

function broadcast() {
  window.dispatchEvent(new Event(EVENT));
}

export function usePresentationMode(): [boolean, () => void, (next: boolean) => void] {
  const [on, setOn] = useState<boolean>(readInitial);

  useEffect(() => {
    const onChange = () => setOn(readInitial());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) onChange();
    });
    return () => {
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  const set = useCallback((next: boolean) => {
    safeSet(KEY, next ? '1' : '0');
    broadcast();
  }, []);

  const toggle = useCallback(() => set(!readInitial()), [set]);

  return [on, toggle, set];
}
