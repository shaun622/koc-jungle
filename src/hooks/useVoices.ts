import { useEffect, useState } from 'react';

/**
 * Live SpeechSynthesisVoice list. Reactive — re-renders when the browser
 * fires `voiceschanged` (Chrome/Edge populate the list asynchronously).
 *
 * Returns an empty array on environments without the Web Speech API.
 */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
    return window.speechSynthesis.getVoices();
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    // Call once at mount in case the list populated between render and effect.
    update();
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);

  return voices;
}
