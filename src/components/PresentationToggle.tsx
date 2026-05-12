import { usePresentationMode } from '@/hooks/usePresentationMode';
import { Icons } from './Icons';

export function PresentationToggle() {
  const [on, toggle] = usePresentationMode();

  return (
    <button
      onClick={toggle}
      className={'presentation-pill ' + (on ? 'presentation-pill--exit' : '')}
      title={on ? 'Exit presentation mode (P)' : 'Presentation mode (P)'}
    >
      {on ? (
        <>
          <Icons.Close className="icon sm" />
          <span>Exit presentation</span>
        </>
      ) : (
        <>
          <span>Presentation</span>
        </>
      )}
    </button>
  );
}
