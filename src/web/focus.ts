import { useEffect, type RefObject } from "react";

/**
 * One rule for every screen change (docs/design.md): when the view is
 * replaced, whatever had focus (the Reveal button, a card, Leave, the name
 * form's button) goes with it, and focus falls to the page. The new
 * screen's heading takes it instead, so a screen reader reads where you
 * are, and the keyboard starts from there. A heading is not a control, so a
 * stray Space or Enter does nothing.
 *
 * "Focus was lost" means focus is on the page itself although something in
 * it has had focus since the page loaded. On a fresh load nothing has, so
 * the first screen leaves focus to the browser; and focus that is still on
 * something (the Theme menu, say) is never moved.
 */
export function shouldRecoverFocus(
  focusSeen: boolean,
  active: Element | null,
  body: Element | null,
): boolean {
  return focusSeen && (active === null || active === body);
}

let focusSeen = false;

/** Call once at startup: remembers that something in the page has had focus. */
export function trackFocus(doc: Document): void {
  doc.addEventListener("focusin", () => {
    focusSeen = true;
  });
}

/**
 * On mount, moves focus to target if focus was lost (shouldRecoverFocus),
 * then tells onDecided whether target now has focus. onDecided should be
 * stable: a new function would run the effect, and the report, again.
 */
export function useRecoverFocus(
  target: RefObject<HTMLElement | null>,
  onDecided?: (tookFocus: boolean) => void,
): void {
  useEffect(() => {
    if (shouldRecoverFocus(focusSeen, document.activeElement, document.body)) {
      target.current?.focus({ preventScroll: true });
    }
    onDecided?.(
      target.current !== null && document.activeElement === target.current,
    );
  }, [target, onDecided]);
}
