import { useRef, type ReactNode } from "react";
import { useRecoverFocus } from "./focus.js";

/**
 * Each screen's one h1. It takes focus when the screen replaced whatever had
 * it (useRecoverFocus), so tabIndex -1: focusable by script, not a Tab stop.
 * Never a live region: in the room its text changes as people vote, and a
 * heading does not chatter.
 */
export function ScreenHeading({
  className,
  onShown,
  children,
}: {
  readonly className?: string;
  /** Told, once shown, whether this heading took focus (stable function). */
  readonly onShown?: (tookFocus: boolean) => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useRecoverFocus(ref, onShown);
  return (
    <h1 ref={ref} className={className} tabIndex={-1}>
      {children}
    </h1>
  );
}
