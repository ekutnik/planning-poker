import {
  safeStorage,
  type KeyValueStore,
  type StorageWatch,
} from "./storage.js";

/**
 * The nudge's sound (v1.1, on the team's feedback): the person nudged is
 * usually watching the video call, not this tab, so a nudge also plays a
 * short chime. Synthesised with the Web Audio API: no file to load, nothing
 * for the Content-Security-Policy to allow.
 */

export const SOUND_KEY = "planning-poker:sound";

/** Function properties, so they can be handed to useSyncExternalStore detached. */
export interface SoundStore {
  readonly isOn: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly set: (on: boolean) => void;
}

/**
 * The Sound switch, remembered per browser like the theme. On unless this
 * browser turned it off: a nudge that makes no sound is the problem it fixes.
 * Turned on or off in another tab, it applies here too, as Theme does (#41).
 */
export function createSoundStore(
  getStorage: () => KeyValueStore,
  watch: StorageWatch = () => () => undefined,
): SoundStore {
  const storage = safeStorage(getStorage);
  const listeners = new Set<() => void>();
  const parse = (value: string | null) => value !== "off";
  let on = parse(storage.read(SOUND_KEY));
  const show = (next: boolean) => {
    if (next === on) return;
    on = next;
    for (const listener of listeners) listener();
  };
  // Another tab changed it, or cleared storage (key null): show it here,
  // without writing it back. Watched for the page's whole life, unlike
  // Theme's, which watches only while subscribed: a nudge reads isOn
  // whenever it arrives, with or without the switch on screen.
  watch((key, value) => {
    if (key === SOUND_KEY || key === null) show(parse(value));
  });
  return {
    isOn: () => on,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (next === on) return;
      storage.write(SOUND_KEY, next ? "on" : "off");
      show(next);
    },
  };
}

/** What the chime needs of an AudioContext, so tests can fake one. */
export type ChimeContext = Pick<
  AudioContext,
  | "state"
  | "currentTime"
  | "destination"
  | "resume"
  | "createOscillator"
  | "createGain"
>;

export interface Chime {
  /** On a user's gesture: creates the audio once, and resumes it if suspended. */
  readonly unlock: () => void;
  /** The chime, if the audio is unlocked and running; otherwise nothing. */
  readonly play: () => void;
}

/** Two notes, G5 then C6, about 300 ms in all, at a moderate volume. */
const NOTES = [
  { hz: 784, at: 0, length: 0.14 },
  { hz: 1047, at: 0.15, length: 0.15 },
];
const PEAK = 0.15;

/**
 * Browsers only let a page make sound after the person has interacted with
 * it, so the audio is created on a gesture (unlock), never before: created
 * earlier, it would start suspended and the browser would warn. Until then,
 * and whenever the audio isn't running, play does nothing. Nothing here
 * throws: a sound that can't play must never break the room, and the banner
 * and the title still say you were nudged.
 */
export function createChime(createContext: () => ChimeContext): Chime {
  let context: ChimeContext | null = null;
  return {
    unlock: () => {
      try {
        // Created during a gesture, the audio should be running, but a
        // browser may still start it suspended: resume it at once, while the
        // gesture still counts, rather than wait for the next one.
        context ??= createContext();
        if (context.state === "suspended") {
          // A rejected resume is the browser saying no: nothing to report.
          context.resume().catch(() => undefined);
        }
      } catch {
        context = null;
      }
    },
    play: () => {
      if (context === null || context.state !== "running") return;
      try {
        const start = context.currentTime;
        for (const note of NOTES) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = note.hz;
          const from = start + note.at;
          const to = from + note.length;
          gain.gain.setValueAtTime(0, from);
          gain.gain.linearRampToValueAtTime(PEAK, from + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, to);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(from);
          oscillator.stop(to);
        }
      } catch {
        // Audio that fails mid-way plays nothing; the room carries on.
      }
    },
  };
}

/**
 * Unlocks the chime on the person's gestures, wherever they are on the page.
 * Joining by clicking Join counts. Only while the browser says a gesture is
 * active (navigator.userActivation), since a touch's pointerdown, say,
 * doesn't count, and audio created then would start suspended.
 */
export function unlockOnGesture(
  target: EventTarget,
  chime: Chime,
  isActive: () => boolean,
): () => void {
  const events = ["pointerdown", "pointerup", "keydown", "touchend"];
  const unlock = () => {
    if (isActive()) chime.unlock();
  };
  for (const type of events) {
    target.addEventListener(type, unlock, { capture: true, passive: true });
  }
  return () => {
    for (const type of events) {
      target.removeEventListener(type, unlock, { capture: true });
    }
  };
}

/**
 * What a nudge plays: the chime, while this browser's Sound switch is on.
 * Call it once per page (main.tsx) and pass that one function down: it must
 * stay the same function, since RoomPage's session depends on it, and a new
 * one would make a new session, reconnecting the room.
 */
export function nudgeSound(store: SoundStore, chime: Chime): () => void {
  return () => {
    if (store.isOn()) chime.play();
  };
}
