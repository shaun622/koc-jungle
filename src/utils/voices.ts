/**
 * Web Speech API voice helpers — used by the announcements hook and the
 * Settings modal's voice picker.
 *
 * Chrome/Edge load voices asynchronously and fire `voiceschanged` once the
 * list is available; iOS Safari has them ready synchronously. Both code
 * paths are handled below so callers can pretend it's all sync.
 */

/**
 * Preference list for the "Surprise me" default. The first match wins.
 *
 * Ordering rationale: lead with characterful English-accented voices that
 * sound less generic than the iPad default ("Samantha"). We bias UK/AU/IE
 * first, then fall through to alternative US voices, finally Samantha
 * herself as an absolute backstop so we never end up silent.
 */
const PREFERRED_VOICE_NAMES = [
  // UK
  'Daniel',
  'Oliver',
  'Arthur',
  'Serena',
  'Kate',
  // Australia
  'Karen',
  'Lee',
  // Ireland
  'Moira',
  // Scotland
  'Fiona',
  // South Africa
  'Tessa',
  // US (avoid Samantha unless nothing else exists)
  'Aaron',
  'Nicky',
  'Allison',
  // Last-resort fallback
  'Samantha',
];

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve([]);
  }
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve(voices);
    };
    const onChange = () => settle(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    // Some browsers populate eventually without firing the event. Time out
    // after 1s and return whatever's there (often still empty — caller will
    // handle that).
    window.setTimeout(() => settle(window.speechSynthesis.getVoices()), 1000);
  });
}

export function isEnglishVoice(v: SpeechSynthesisVoice): boolean {
  return typeof v.lang === 'string' && v.lang.toLowerCase().startsWith('en');
}

/**
 * Pick a sensible default announcement voice from the available list.
 *
 * Iterates the preference list and returns the first matching English voice,
 * preferring "Enhanced" / "Premium" / "Neural" variants when both base and
 * enhanced are present (iOS exposes each as two separate entries).
 *
 * Falls back through: any non-Samantha English voice → any English voice →
 * first voice → undefined.
 */
export function pickDefaultVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  if (voices.length === 0) return undefined;
  const english = voices.filter(isEnglishVoice);
  for (const preferredName of PREFERRED_VOICE_NAMES) {
    const matches = english.filter((v) => v.name.includes(preferredName));
    if (matches.length === 0) continue;
    // Prefer enhanced variants when both exist.
    const enhanced = matches.find((v) =>
      /enhanced|premium|neural/i.test(v.name),
    );
    return enhanced ?? matches[0];
  }
  // No named preference matched — return any non-Samantha English voice,
  // then any English, then anything at all.
  const nonSamantha = english.find((v) => !v.name.includes('Samantha'));
  if (nonSamantha) return nonSamantha;
  if (english[0]) return english[0];
  return voices[0];
}

export function findVoiceByUri(
  voices: SpeechSynthesisVoice[],
  uri: string | undefined,
): SpeechSynthesisVoice | undefined {
  if (!uri) return undefined;
  return voices.find((v) => v.voiceURI === uri);
}

/**
 * Resolve which voice to actually use, given a user preference. Falls back
 * to the auto-pick when the preference is missing or unavailable.
 */
export function resolveVoice(
  voices: SpeechSynthesisVoice[],
  preferredUri: string | undefined,
): SpeechSynthesisVoice | undefined {
  return findVoiceByUri(voices, preferredUri) ?? pickDefaultVoice(voices);
}

/**
 * Format a voice for display in the picker — "Daniel — English (UK)".
 * Falls back to the raw name + lang when the locale isn't recognised.
 */
export function formatVoiceLabel(v: SpeechSynthesisVoice): string {
  const region = REGION_LABELS[v.lang] ?? v.lang;
  return `${v.name} — ${region}`;
}

const REGION_LABELS: Record<string, string> = {
  'en-AU': 'English (AU)',
  'en-CA': 'English (Canada)',
  'en-GB': 'English (UK)',
  'en-IE': 'English (Ireland)',
  'en-IN': 'English (India)',
  'en-NZ': 'English (NZ)',
  'en-US': 'English (US)',
  'en-ZA': 'English (SA)',
};
