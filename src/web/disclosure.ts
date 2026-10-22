import { useEffect, useRef, type FocusEvent } from "react";
import { menuTransition, type MenuEvent } from "./menu.js";

/**
 * A disclosure's open and close, as the header's Menu does it (menu.ts has
 * the rules): the button toggles it; while it is open, Escape anywhere and a
 * pointer down outside the wrapper close it, and so does focus leaving the
 * wrapper; Escape puts focus back on the button. Shared by the Menu and the
 * scale's "+n more" panels, so the two behave alike, with no browser
 * feature the rest of the app doesn't already need.
 *
 * The open state is the caller's, so a parent can keep one panel open at a
 * time; setOpen may change from render to render.
 */
export function useDisclosure(open: boolean, setOpen: (open: boolean) => void) {
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const latest = useRef(setOpen);
  useEffect(() => {
    latest.current = setOpen;
  });

  const apply = (from: boolean, event: MenuEvent) => {
    const next = menuTransition(from, event);
    latest.current(next.open);
    if (next.focusButton) button.current?.focus();
  };

  // While open: a click outside closes it, and so does Escape anywhere.
  // Anywhere, because Safari does not focus a button on click, so after a
  // mouse click focus is not in the disclosure at all.
  useEffect(() => {
    if (!open) return;
    const close = (event: MenuEvent) => {
      const next = menuTransition(true, event);
      latest.current(next.open);
      if (next.focusButton) button.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) {
        close("click-outside");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close("escape");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return {
    wrapper,
    button,
    toggle: () => apply(open, "toggle"),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      // relatedTarget is null for a click on the panel's plain text, or
      // when the window loses focus: neither means focus left it.
      const next = event.relatedTarget;
      if (open && next !== null && !event.currentTarget.contains(next)) {
        apply(open, "focus-left");
      }
    },
  };
}
