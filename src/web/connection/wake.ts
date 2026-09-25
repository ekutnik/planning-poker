import type { RoomConnection } from "./room-connection.js";

interface VisibilityTarget extends EventTarget {
  readonly visibilityState: string;
}

/**
 * Retry at once instead of waiting out the backoff when the browser comes
 * back online or the tab becomes visible again. Returns the unsubscribe.
 */
export function retryOnReturn(
  connection: Pick<RoomConnection, "retryNow">,
  win: EventTarget,
  doc: VisibilityTarget,
): () => void {
  const onOnline = () => connection.retryNow();
  const onVisibility = () => {
    if (doc.visibilityState === "visible") connection.retryNow();
  };
  win.addEventListener("online", onOnline);
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    win.removeEventListener("online", onOnline);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
