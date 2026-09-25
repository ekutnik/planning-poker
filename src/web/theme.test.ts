import { describe, expect, it } from "vitest";
import themeInit from "./public/theme-init.js?raw";
import type { KeyValueStore } from "./storage.js";
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
