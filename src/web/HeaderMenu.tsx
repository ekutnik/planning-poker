import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { HEADER_COPY } from "./copy.js";
import { menuTransition, type MenuEvent } from "./menu.js";

/**
 * The header's Menu: a disclosure (see menu.ts for its rules). The panel
 * comes straight after the button in the page, so Tab goes from the button
 * into it, and opening it does not move focus. The panel's controls take
 * effect at once and leave it open.
 */
export function HeaderMenu({
  children,
  defaultOpen = false,
}: {
  readonly children: ReactNode;
  /** For tests of the open markup. */
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `${useId()}-panel`;
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const apply = (event: MenuEvent) => {
    const next = menuTransition(open, event);
    setOpen(next.open);
    if (next.focusButton) button.current?.focus();
  };

  // While open: a click outside closes it, and so does Escape anywhere.
  // Anywhere, because Safari does not focus a button on click, so after a
  // mouse click focus is not in the menu at all.
  useEffect(() => {
    if (!open) return;
    const close = (event: MenuEvent) => {
      const next = menuTransition(true, event);
      setOpen(next.open);
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

  return (
    <div
      ref={wrapper}
      className="menu"
      onBlur={(event) => {
        // relatedTarget is null for a click on the panel's plain text, or
        // when the window loses focus: neither means focus left the menu.
        const next = event.relatedTarget;
        if (open && next !== null && !event.currentTarget.contains(next)) {
          apply("focus-left");
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="menu-button"
        aria-label={HEADER_COPY.menu}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => apply("toggle")}
      >
        <span className="menu-button-label" aria-hidden="true">
          {HEADER_COPY.menu}
        </span>
        <svg
          className="menu-icon menu-icon--chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <svg
          className="menu-icon menu-icon--bars"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <div id={panelId} className="menu-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
