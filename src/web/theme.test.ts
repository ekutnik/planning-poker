import { describe, expect, it } from "vitest";
import themeInit from "./public/theme-init.js?raw";
import {
  watchStorage,
  type KeyValueStore,
  type StorageWatch,
} from "./storage.js";
import {
  applyTheme,
  createThemeStore,
  parseTheme,
  THEME_KEY,
  type ThemeRoot,
} from "./theme.js";

class FakeRoot implements ThemeRoot {
  readonly attributes = new Map<string, string>();
  readonly style = { colorScheme: "" };
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  snapshot() {
    return {
      theme: this.attributes.get("data-theme") ?? null,
      colorScheme: this.style.colorScheme,
    };
  }
}

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("parseTheme and applyTheme", () => {
  it("treats anything unknown as following the system", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("Dark")).toBe("system");
  });

  it("pins data-theme and color-scheme, and clears both for system", () => {
    const root = new FakeRoot();
    applyTheme(root, "dark");
    expect(root.snapshot()).toEqual({ theme: "dark", colorScheme: "dark" });
    applyTheme(root, "system");
    expect(root.snapshot()).toEqual({ theme: null, colorScheme: "" });
  });
});

describe("createThemeStore", () => {
  it("applies the stored choice at once, and remembers a new one", () => {
    const storage = new MemoryStore();
    storage.setItem(THEME_KEY, "dark");
    const root = new FakeRoot();
    const store = createThemeStore(() => storage, root);
    expect(store.getTheme()).toBe("dark");
    expect(root.snapshot().theme).toBe("dark");

    let calls = 0;
    store.subscribe(() => (calls += 1));
    store.setTheme("light");
    store.setTheme("light"); // no change, no notification
    expect(calls).toBe(1);
    expect(storage.getItem(THEME_KEY)).toBe("light");
    expect(root.snapshot()).toEqual({ theme: "light", colorScheme: "light" });
  });

  it("still switches themes when storage is unavailable", () => {
    const root = new FakeRoot();
    const store = createThemeStore(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    }, root);
    expect(store.getTheme()).toBe("system");
    store.setTheme("dark");
    expect(store.getTheme()).toBe("dark");
    expect(root.snapshot().theme).toBe("dark");
  });
});

describe("createThemeStore across tabs (#41)", () => {
  /** A StorageWatch the test drives, counting starts and stops. */
  function fakeWatch() {
    let onChange: Parameters<StorageWatch>[0] | null = null;
    const counts = { started: 0, stopped: 0 };
    const watch: StorageWatch = (callback) => {
      counts.started += 1;
      onChange = callback;
      return () => {
        counts.stopped += 1;
        onChange = null;
      };
    };
    const fire = (key: string | null, value: string | null) =>
      onChange?.(key, value);
    return { watch, fire, counts };
  }

  function setUp() {
    const storage = new MemoryStore();
    const root = new FakeRoot();
    const tabs = fakeWatch();
    const store = createThemeStore(() => storage, root, tabs.watch);
    let calls = 0;
    const unsubscribe = store.subscribe(() => (calls += 1));
    return { storage, root, tabs, store, unsubscribe, calls: () => calls };
  }

  it("shows a theme chosen in another tab, without writing it back", () => {
    const { storage, root, tabs, store, calls } = setUp();
    tabs.fire(THEME_KEY, "dark");
    expect(store.getTheme()).toBe("dark");
    expect(root.snapshot()).toEqual({ theme: "dark", colorScheme: "dark" });
    expect(calls()).toBe(1);
    expect(storage.data.size).toBe(0); // the other tab already stored it
  });

  it("ignores changes to other keys", () => {
    const { tabs, store, calls } = setUp();
    tabs.fire(THEME_KEY, "dark");
    // Parsed as a theme, "Ada" would mean system: a change the test can see.
    tabs.fire("planning-poker:name", "Ada");
    expect(store.getTheme()).toBe("dark");
    expect(calls()).toBe(1);
  });

  it("parses an unknown value, or cleared storage, as it does at load", () => {
    const { tabs, store } = setUp();
    tabs.fire(THEME_KEY, "dark");
    tabs.fire(THEME_KEY, "purple");
    expect(store.getTheme()).toBe("system");
    tabs.fire(THEME_KEY, "light");
    tabs.fire(null, null); // localStorage.clear() in another tab
    expect(store.getTheme()).toBe("system");
  });

  it("catches up on a change made while nobody was watching", () => {
    const { storage, root, store, unsubscribe } = setUp();
    unsubscribe();
    storage.setItem(THEME_KEY, "dark"); // another tab, during the gap
    store.subscribe(() => undefined);
    expect(store.getTheme()).toBe("dark");
    expect(root.snapshot().theme).toBe("dark");
  });

  it("watches only while someone is subscribed", () => {
    const { tabs, store, unsubscribe } = setUp();
    const second = store.subscribe(() => undefined);
    expect(tabs.counts).toEqual({ started: 1, stopped: 0 });
    unsubscribe();
    expect(tabs.counts.stopped).toBe(0);
    second();
    expect(tabs.counts).toEqual({ started: 1, stopped: 1 });
    store.subscribe(() => undefined);
    expect(tabs.counts.started).toBe(2);
  });
});

describe("watchStorage", () => {
  it("passes the storage event's key and new value, until stopped", () => {
    const target = new EventTarget();
    const seen: [string | null, string | null][] = [];
    const stop = watchStorage(target)((key, value) => seen.push([key, value]));
    const storageEvent = (key: string | null, newValue: string | null) =>
      Object.assign(new Event("storage"), { key, newValue });
    target.dispatchEvent(storageEvent(THEME_KEY, "dark"));
    stop();
    target.dispatchEvent(storageEvent(THEME_KEY, "light"));
    expect(seen).toEqual([[THEME_KEY, "dark"]]);
  });
});

describe("public/theme-init.js", () => {
  /** Runs the real script against a fake window and document. */
  function runInit(storage: () => string | null): FakeRoot {
    const root = new FakeRoot();
    const win = {
      get localStorage() {
        return { getItem: () => storage() };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const script = new Function("window", "document", themeInit) as (
      window: unknown,
      document: unknown,
    ) => void;
    script(win, { documentElement: root });
    return root;
  }

  it.each([null, "light", "dark", "system", "Dark", "garbage"])(
    "applies the same theme as the app for a stored %j",
    (stored) => {
      const expected = new FakeRoot();
      applyTheme(expected, parseTheme(stored));
      expect(runInit(() => stored).snapshot()).toEqual(expected.snapshot());
    },
  );

  it("does nothing, and does not throw, when storage throws", () => {
    const root = runInit(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(root.snapshot()).toEqual({ theme: null, colorScheme: "" });
  });

  it("uses the same storage key as the app", () => {
    expect(themeInit).toContain(`"${THEME_KEY}"`);
  });
});
