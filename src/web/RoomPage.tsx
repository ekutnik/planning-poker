import { useMemo, useState, useSyncExternalStore } from "react";
import { createBrowserConnection } from "./connection/browser.js";
import { retryOnReturn } from "./connection/wake.js";
import type { Identity } from "./identity.js";
import { NameForm } from "./NameForm.js";
import { RoomSession } from "./room-session.js";
import { RoomView } from "./RoomView.js";
import { StoppedScreen } from "./StoppedScreen.js";
import { bannerFor, canAct } from "./view.js";

/** A direct link asks for a name first; then the room itself. */
export function RoomPage({
  roomId,
  identity,
  onHome,
}: {
  readonly roomId: string;
  readonly identity: Identity;
  readonly onHome: () => void;
}) {
  const [name, setName] = useState(() => identity.lastName());
  if (name === null) {
    return (
      <main>
        <h1>Join the room</h1>
        <NameForm
          initial={null}
          submitLabel="Join"
          onSubmit={(chosen) => {
            identity.rememberName(chosen);
            setName(chosen);
          }}
        />
      </main>
    );
  }
  return (
    <Room
      key={name}
      roomId={roomId}
      name={name}
      identity={identity}
      onChangeName={() => setName(null)}
      onHome={onHome}
    />
  );
}

function Room({
  roomId,
  name,
  identity,
  onChangeName,
  onHome,
}: {
  readonly roomId: string;
  readonly name: string;
  readonly identity: Identity;
  readonly onChangeName: () => void;
  readonly onHome: () => void;
}) {
  const { sessionToken } = identity;
  const session = useMemo(
    () =>
      new RoomSession({
        connect: () => createBrowserConnection(roomId, { sessionToken, name }),
        watchReturn: (connection) =>
          retryOnReturn(connection, window, document),
      }),
    [roomId, sessionToken, name],
  );
  const { state, notice } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );

  if (state.status === "stopped") {
    return (
      <StoppedScreen
        reason={state.reason}
        onRestart={() => session.restart()}
        onReload={() => window.location.reload()}
        onChangeName={onChangeName}
        onHome={onHome}
      />
    );
  }
  if (state.snapshot === null) {
    return (
      <main>
        <p role="status">{bannerFor(state)}</p>
      </main>
    );
  }
  return (
    <RoomView
      snapshot={state.snapshot}
      live={canAct(state)}
      banner={bannerFor(state)}
      notice={notice}
      link={window.location.href}
      persistent={identity.persistent}
      onAction={(action) => session.send(action)}
      onLeave={() => session.leave()}
    />
  );
}
