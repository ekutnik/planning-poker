import { describe, expect, it, vi } from "vitest";
import {
  createChime,
  createSoundStore,
  nudgeSound,
  SOUND_KEY,
  unlockOnGesture,
  type Chime,
  type ChimeContext,
} from "./sound.js";
import type { KeyValueStore } from "./storage.js";

function memory(initial: Record<string, string> = {}): KeyValueStore & {
  values: Record<string, string>;
} {
  const values = { ...initial };
  return {
    values,
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

/** An AudioContext that records what the chime asks of it. */
class FakeContext {
  state: AudioContextState = "running";
  currentTime = 10;
  destination = {} as AudioDestinationNode;
  readonly started: { hz: number; at: number }[] = [];
  resumes = 0;
  resume = (): Promise<void> => {
    this.resumes += 1;
    this.state = "running";
    return Promise.resolve();
  };
  createGain = () =>
    ({
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    }) as unknown as GainNode;
  createOscillator = () => {
    const oscillator = {
      type: "sine",
      frequency: { value: 0 },
      connect: () => undefined,
      start: (at: number) =>
        this.started.push({ hz: oscillator.frequency.value, at }),
      stop: () => undefined,
    };
    return oscillator as unknown as OscillatorNode;
  };
}

const asContext = (fake: FakeContext) => fake as unknown as ChimeContext;

describe("the Sound switch (sound.ts)", () => {
  it("is on in a browser that never chose", () => {
    expect(createSoundStore(() => memory()).isOn()).toBe(true);
  });

  it("is off once this browser turned it off, and remembers it", () => {
    const storage = memory();
    const store = createSoundStore(() => storage);
    const heard = vi.fn();
    store.subscribe(heard);
    store.set(false);
    expect(store.isOn()).toBe(false);
    expect(storage.values[SOUND_KEY]).toBe("off");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(createSoundStore(() => storage).isOn()).toBe(false);
    store.set(true);
    expect(storage.values[SOUND_KEY]).toBe("on");
  });

  it("is on when storage can't be read (a private window, say)", () => {
    const store = createSoundStore(() => {
      throw new Error("SecurityError");
    });
    expect(store.isOn()).toBe(true);
  });
});

describe("the chime", () => {
  it("plays nothing before a gesture: no audio is even created", () => {
    const create = vi.fn(() => asContext(new FakeContext()));
    const chime = createChime(create);
    chime.play();
    expect(create).not.toHaveBeenCalled();
  });

  it("plays two notes, about 300 ms in all, once unlocked by a gesture", () => {
    const fake = new FakeContext();
    const chime = createChime(() => asContext(fake));
    chime.unlock();
    chime.play();
    expect(fake.started).toEqual([
      { hz: 784, at: 10 },
      { hz: 1047, at: 10.15 },
    ]);
  });

  it("creates its audio once, and resumes it on a later gesture if suspended", () => {
    const fake = new FakeContext();
    const create = vi.fn(() => asContext(fake));
    const chime = createChime(create);
    chime.unlock();
    fake.state = "suspended";
    chime.play(); // suspended: nothing
    expect(fake.started).toEqual([]);
    chime.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    expect(fake.resumes).toBe(1);
    chime.play();
    expect(fake.started).toHaveLength(2);
  });

  it("never throws when the browser won't create the audio, and plays nothing", () => {
    const chime = createChime(() => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    expect(() => {
      chime.unlock();
      chime.play();
    }).not.toThrow();
  });

  it("never throws, and handles the rejection, when a resume is refused", () => {
    const fake = new FakeContext();
    const chime = createChime(() => asContext(fake));
    chime.unlock();
    fake.state = "suspended";
    const refused = Promise.reject(new DOMException("no", "NotAllowedError"));
    const handled = vi.spyOn(refused, "catch");
    fake.resume = () => refused;
    expect(() => chime.unlock()).not.toThrow();
    // Handled, so the browser logs no "Uncaught (in promise)".
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("never throws when the audio fails mid-way: a nudge must never break the room", () => {
    const fake = new FakeContext();
    fake.createOscillator = () => {
      throw new DOMException("closed", "InvalidStateError");
    };
    const chime = createChime(() => asContext(fake));
    chime.unlock();
    expect(() => chime.play()).not.toThrow();
  });
});

describe("unlocking on a gesture", () => {
  const counting = (): Chime & { unlocks: number } => {
    const chime = {
      unlocks: 0,
      play: () => undefined,
      unlock: () => undefined,
    };
    chime.unlock = () => {
      chime.unlocks += 1;
    };
    return chime;
  };

  it("unlocks on a pointer or a key, while the browser says a gesture is active", () => {
    const target = new EventTarget();
    const chime = counting();
    unlockOnGesture(target, chime, () => true);
    target.dispatchEvent(new Event("pointerup"));
    target.dispatchEvent(new Event("keydown"));
    expect(chime.unlocks).toBe(2);
  });

  it("does nothing when no gesture is active, such as a touch's pointerdown", () => {
    const target = new EventTarget();
    const chime = counting();
    unlockOnGesture(target, chime, () => false);
    target.dispatchEvent(new Event("pointerdown"));
    expect(chime.unlocks).toBe(0);
  });

  it("stops listening when cleaned up", () => {
    const target = new EventTarget();
    const chime = counting();
    const stop = unlockOnGesture(target, chime, () => true);
    stop();
    target.dispatchEvent(new Event("keydown"));
    expect(chime.unlocks).toBe(0);
  });
});

describe("a nudge's sound", () => {
  it("plays the chime once per nudge while Sound is on", () => {
    const play = vi.fn();
    const sound = nudgeSound(
      createSoundStore(() => memory()),
      {
        play,
        unlock: () => undefined,
      },
    );
    sound();
    sound();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("plays nothing while Sound is off", () => {
    const play = vi.fn();
    const store = createSoundStore(() => memory({ [SOUND_KEY]: "off" }));
    nudgeSound(store, { play, unlock: () => undefined })();
    expect(play).not.toHaveBeenCalled();
  });
});
