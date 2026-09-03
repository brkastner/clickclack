// Audible alert for workflow decisions that are waiting on a person.
//
// A durable workflow that stops at a human decision is the one event worth
// interrupting for: nothing proceeds until the operator answers. Ordinary
// messages stay silent so the sound keeps meaning "you are blocking something".
//
// Tones are synthesized rather than loaded from audio files. The alert is a
// short two-note chime, so a generated envelope avoids shipping binary assets
// and works offline with no request on the alert path.

const STORAGE_PREFIX = "clickclack:decision-sound:v1:";

export const decisionSounds = ["chime", "knock", "bell", "off"] as const;
export type DecisionSound = (typeof decisionSounds)[number];

export const defaultDecisionSound: DecisionSound = "chime";

type ToneSpec = {
  /** Frequencies in Hz, played in order. */
  notes: readonly number[];
  /** Seconds per note. */
  noteSeconds: number;
  type: OscillatorType;
  gain: number;
};

const tones: Record<Exclude<DecisionSound, "off">, ToneSpec> = {
  chime: { notes: [880, 1320], noteSeconds: 0.12, type: "sine", gain: 0.09 },
  knock: { notes: [180, 140], noteSeconds: 0.07, type: "triangle", gain: 0.14 },
  bell: { notes: [1568, 2093, 1568], noteSeconds: 0.1, type: "sine", gain: 0.06 },
};

function storageKey(userID: string): string {
  return `${STORAGE_PREFIX}${userID}`;
}

export function isDecisionSound(value: string): value is DecisionSound {
  return (decisionSounds as readonly string[]).includes(value);
}

export function readDecisionSound(userID: string): DecisionSound {
  if (!userID) return defaultDecisionSound;
  try {
    const stored = window.localStorage.getItem(storageKey(userID));
    if (stored === null) return defaultDecisionSound;
    return isDecisionSound(stored) ? stored : defaultDecisionSound;
  } catch {
    return defaultDecisionSound;
  }
}

export function writeDecisionSound(userID: string, sound: DecisionSound): boolean {
  if (!userID) return false;
  try {
    window.localStorage.setItem(storageKey(userID), sound);
    return true;
  } catch {
    return false;
  }
}

/**
 * Namespace the Pi bridge uses on turn_id to mark a decision prompt.
 *
 * ClickClack has no decision message kind, and adding one would diverge this
 * fork from upstream on its own message contract. A decision therefore posts as
 * agent_commentary with a namespaced turn_id, which ClickClack passes through
 * unvalidated and publishes on message.created.
 */
const decisionTurnPrefix = "decision:";

/**
 * True when this realtime event is a workflow decision awaiting an answer.
 *
 * Keyed to the turn marker rather than to any command name, so a decision
 * raised by any workflow alerts rather than only one entry point.
 */
export function isDecisionEvent(event: {
  type?: string;
  payload?: Record<string, unknown>;
}): boolean {
  if (event.type !== "message.created") return false;
  if (event.payload?.kind !== "agent_commentary") return false;
  const turnID = event.payload?.turn_id;
  return typeof turnID === "string" && turnID.startsWith(decisionTurnPrefix);
}

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const candidate = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  return candidate;
}

let sharedContext: AudioContext | undefined;

/**
 * Plays one alert.
 *
 * Returns false when the sound is off, unsupported, or blocked. Autoplay policy
 * can suspend the context until the page has been interacted with, which is
 * acceptable: the alert matters when the operator is away, and a browser
 * notification covers that case regardless.
 */
export async function playDecisionSound(sound: DecisionSound): Promise<boolean> {
  if (sound === "off") return false;
  const Constructor = audioContextConstructor();
  if (Constructor === undefined) return false;

  try {
    sharedContext ??= new Constructor();
    const context = sharedContext;
    if (context.state === "suspended") await context.resume();
    if (context.state !== "running") return false;

    const spec = tones[sound];
    spec.notes.forEach((frequency, index) => {
      const startAt = context.currentTime + index * spec.noteSeconds;
      const endAt = startAt + spec.noteSeconds;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();

      oscillator.type = spec.type;
      oscillator.frequency.value = frequency;
      // Ramp both edges: an abrupt start or stop on a square-edged envelope
      // clicks audibly.
      envelope.gain.setValueAtTime(0.0001, startAt);
      envelope.gain.exponentialRampToValueAtTime(spec.gain, startAt + spec.noteSeconds * 0.25);
      envelope.gain.exponentialRampToValueAtTime(0.0001, endAt);

      oscillator.connect(envelope);
      envelope.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt);
    });
    return true;
  } catch {
    return false;
  }
}

/** Releases the shared context. Used by tests and on sign-out. */
export function resetDecisionSound(): void {
  void sharedContext?.close().catch(() => undefined);
  sharedContext = undefined;
}
