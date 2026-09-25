import { useId, useSyncExternalStore } from "react";
import { parseTheme, THEMES, type Theme, type ThemeStore } from "./theme.js";

const LABELS: Readonly<Record<Theme, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** System, Light or Dark. A native select: keyboard and screen reader work as is. */
export function ThemeMenu({ store }: { readonly store: ThemeStore }) {
  const theme = useSyncExternalStore(store.subscribe, store.getTheme);
  const id = useId();
  return (
    <div className="theme-menu">
      <label htmlFor={id}>Theme</label>
      <select
        id={id}
        value={theme}
        onChange={(event) => store.setTheme(parseTheme(event.target.value))}
      >
        {THEMES.map((option) => (
          <option key={option} value={option}>
            {LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
