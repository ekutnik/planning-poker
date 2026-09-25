import { useEffect, type RefObject } from "react";

/**
 * When the round changes phase, the view is replaced, and whatever had focus
 * (the Reveal button, a card, the masked field) goes with it: focus falls to
 * the page. Put it on the new status line instead, which is not a control,
 * so a stray Space or Enter cannot start a round, and a screen reader reads
 * where you are. Only after a phase change, never on first load, and never
 * when focus is still somewhere on the page.
 */
export function useRecoverFocus(
  target: RefObject<HTMLElement | null>,
  afterPhaseChange: boolean,
): void {
  useEffect(() => {
    if (!afterPhaseChange) return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      target.current?.focus({ preventScroll: true });
    }
  }, [target, afterPhaseChange]);
}
