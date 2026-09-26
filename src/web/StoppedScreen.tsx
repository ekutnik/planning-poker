import type { StopReason } from "./connection/policy.js";
import { STOP_ACTION_LABELS, STOP_COPY } from "./copy.js";
import { ScreenHeading } from "./ScreenHeading.js";
import { STOP_ACTIONS } from "./view.js";

/**
 * Why the room stopped, and the one way on. Nothing here retries on its own;
 * every way on is a button.
 */
export function StoppedScreen({
  reason,
  onRestart,
  onReload,
  onChangeName,
  onHome,
}: {
  readonly reason: StopReason;
  readonly onRestart: () => void;
  readonly onReload: () => void;
  readonly onChangeName: () => void;
  readonly onHome: () => void;
}) {
  const { title, body } = STOP_COPY[reason];
  const action = STOP_ACTIONS[reason];
  const handlers = {
    "use-this-tab": onRestart,
    reload: onReload,
    "try-again": onRestart,
    "change-name": onChangeName,
    home: onHome,
  };
  return (
    <main className="page">
      <ScreenHeading>{title}</ScreenHeading>
      <p>{body}</p>
      <button type="button" className="primary" onClick={handlers[action]}>
        {STOP_ACTION_LABELS[action]}
      </button>
    </main>
  );
}
