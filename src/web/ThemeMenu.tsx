import { useId, useSyncExternalStore } from "react";
import { HEADER_COPY } from "./copy.js";
import { parseTheme, THEMES, type Theme, type ThemeStore } from "./theme.js";

const LABELS: Readonly<Record<Theme, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** System, Light or Dark. A native select: keyboard and screen reader work as is. */
export function ThemeMenu({ store }: { readonly store: ThemeStore }) {
  const theme = useSyncExternalStore(
    store.subscribe,
    store.getTheme,
    store.getTheme,
  );
  const id = useId();
  return (
    <div className="menu-row">
      <label htmlFor={id} className="menu-label">
        {HEADER_COPY.theme}
      </label>
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
