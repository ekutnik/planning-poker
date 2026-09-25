import { safeStorage, type KeyValueStore } from "./storage.js";

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

/** The stored choice, applied now and on every change, remembered when storage allows. */
export function createThemeStore(
  getStorage: () => KeyValueStore,
  root: ThemeRoot,
): ThemeStore {
  const storage = safeStorage(getStorage);
  const listeners = new Set<() => void>();
  let theme = parseTheme(storage.read(THEME_KEY));
  applyTheme(root, theme);
  return {
    getTheme: () => theme,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTheme: (next) => {
      if (next === theme) return;
      theme = next;
      storage.write(THEME_KEY, next);
      applyTheme(root, next);
      for (const listener of listeners) listener();
    },
  };
}
