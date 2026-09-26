import { useSyncExternalStore } from "react";

/**
 * The breakpoint between compact and wide (docs/design.md, Layout): the same
 * 55em as the stylesheets' @media (min-width: 55em). For the rare control
 * that must be in the page in only one place per layout, rather than hidden
 * with CSS, which would leave a second copy for screen readers to find.
 */
export const WIDE_QUERY = "(min-width: 55em)";

/** Whether the window is wide now, re-rendering when that changes. */
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
