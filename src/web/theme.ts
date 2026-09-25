import {
  safeStorage,
  type KeyValueStore,
  type StorageWatch,
} from "./storage.js";

/** Must match src/web/public/theme-init.js, which runs before React loads. */
export const THEME_KEY = "planning-poker:theme";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** Anything unknown, including nothing stored, means follow the system. */
export function parseTheme(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/** The part of <html> the theme touches. */
export interface ThemeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  readonly style: { colorScheme: string };
}

/**
 * data-theme overrides prefers-color-scheme in the tokens. The inline
 * color-scheme makes the browser's own canvas match before any CSS arrives.
 */
export function applyTheme(root: ThemeRoot, theme: Theme): void {
  if (theme === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "";
  } else {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
  }
}

/** Function properties, so they can be handed to useSyncExternalStore detached. */
export interface ThemeStore {
  readonly getTheme: () => Theme;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setTheme: (theme: Theme) => void;
}

/**
 * The stored choice, applied now and on every change, remembered when
 * storage allows. A choice made in another tab applies here too (#41):
 * while anyone is subscribed, the store watches storage for the theme key.
 */
export function createThemeStore(
  getStorage: () => KeyValueStore,
  root: ThemeRoot,
  watch: StorageWatch = () => () => undefined,
): ThemeStore {
  const storage = safeStorage(getStorage);
  const listeners = new Set<() => void>();
  let theme = parseTheme(storage.read(THEME_KEY));
  applyTheme(root, theme);

  const show = (next: Theme) => {
    if (next === theme) return;
    theme = next;
    applyTheme(root, next);
    for (const listener of listeners) listener();
  };

  // Another tab chose a theme, or cleared storage (key null): show it here,
  // parsed the same way as at load, without writing it back.
  const onStorage = (key: string | null, value: string | null) => {
    if (key === THEME_KEY || key === null) show(parseTheme(value));
  };
  let unwatch: (() => void) | null = null;

  return {
    getTheme: () => theme,
    subscribe: (listener) => {
      if (unwatch === null) {
        // Nobody was watching, so a choice made in another tab meanwhile was
        // missed: catch up once. No listeners yet, so nobody is notified.
        show(parseTheme(storage.read(THEME_KEY)));
        unwatch = watch(onStorage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unwatch?.();
          unwatch = null;
        }
      };
    },
    setTheme: (next) => {
      if (next === theme) return;
      storage.write(THEME_KEY, next);
      show(next);
    },
  };
}
