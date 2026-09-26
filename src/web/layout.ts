import { useSyncExternalStore } from "react";
import { WIDE_QUERY } from "./breakpoint.js";

/**
 * Whether the window is wide now, at the same breakpoint as the stylesheets,
 * re-rendering when that changes. For the rare control that must be in the
 * page in only one place per layout, rather than hidden with CSS, which
 * would leave a second copy for screen readers to find.
 */
export function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE_QUERY).matches,
    // Rendering outside a browser (the tests) has no window; Header takes
    // an explicit layout there.
    () => true,
  );
}
