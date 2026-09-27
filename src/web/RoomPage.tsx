import { useMemo, useState, useSyncExternalStore } from "react";
import { JOIN_COPY, RUNNING_COPY } from "./copy.js";
import { createBrowserConnection } from "./connection/browser.js";
import { retryOnReturn } from "./connection/wake.js";
import type { FacilitateStore } from "./facilitate.js";
import { Header } from "./Header.js";
import type { Identity } from "./identity.js";
import { NameForm } from "./NameForm.js";
import { ScreenHeading } from "./ScreenHeading.js";
import { useDocumentTitle } from "./title.js";
import { RoomSession } from "./room-session.js";
import { RoomView } from "./RoomView.js";
import { StoppedScreen } from "./StoppedScreen.js";
import { SwitchRow } from "./SwitchRow.js";
import type { ThemeStore } from "./theme.js";
import { bannerFor, canAct } from "./view.js";

interface Stores {
  readonly theme: ThemeStore;
  readonly facilitate: FacilitateStore;
}

/** A direct link asks for a name first; then the room itself. */
export function RoomPage({
  roomId,
  identity,
  stores,
  onHome,
}: {
  readonly roomId: string;
  readonly identity: Identity;
  readonly stores: Stores;
  readonly onHome: () => void;
}) {
  const [name, setName] = useState(() => identity.lastName());
  if (name === null) {
    return (
      <>
        <Header theme={stores.theme} />
        <JoinScreen
          onJoin={(chosen, running) => {
            identity.rememberName(chosen);
            stores.facilitate.set(running);
            setName(chosen);
          }}
        />
      </>
    );
  }
  return (
    <Room
      key={name}
      roomId={roomId}
      name={name}
      identity={identity}
      stores={stores}
      onChangeName={() => setName(null)}
      onHome={onHome}
    />
  );
}

function Room({
  roomId,
  name,
  identity,
  stores,
  onChangeName,
  onHome,
}: {
  readonly roomId: string;
  readonly name: string;
  readonly identity: Identity;
  readonly stores: Stores;
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
  const facilitating = useSyncExternalStore(
    stores.facilitate.subscribe,
    stores.facilitate.isOn,
  );

  if (state.status === "stopped") {
    return (
      <>
        <Header theme={stores.theme} />
        <StoppedScreen
          reason={state.reason}
          onRestart={() => session.restart()}
          onReload={() => window.location.reload()}
          onChangeName={onChangeName}
          onHome={onHome}
        />
      </>
    );
  }
  const header = (
    <Header
      theme={stores.theme}
      room={{
        facilitate: stores.facilitate,
        link: window.location.href,
        onLeave: () => session.leave(),
      }}
    />
  );
  if (state.snapshot === null) {
    return (
      <>
        {header}
        <Connecting banner={bannerFor(state)} />
      </>
    );
  }
  return (
    <>
      {header}
      <RoomView
        snapshot={state.snapshot}
        facilitating={facilitating}
        live={canAct(state)}
        banner={bannerFor(state)}
        notice={notice}
        persistent={identity.persistent}
        onAction={(action) => session.send(action)}
      />
    </>
  );
}

/**
 * A room link in a browser with no name yet: ask for one first. Someone
 * following a link usually joins someone else's session, so the Facilitate
 * switch starts off.
 */
export function JoinScreen({
  onJoin,
}: {
  readonly onJoin: (name: string, running: boolean) => void;
}) {
  useDocumentTitle(JOIN_COPY.heading);
  const [running, setRunning] = useState(false);
  return (
    <main className="page page--join">
      <ScreenHeading>{JOIN_COPY.heading}</ScreenHeading>
      <p className="page-intro">{JOIN_COPY.intro}</p>
      <NameForm
        initial={null}
        submitLabel={JOIN_COPY.submit}
        onSubmit={(name) => onJoin(name, running)}
      >
        <SwitchRow
          label={RUNNING_COPY.label}
          note={RUNNING_COPY.note}
          checked={running}
          onChange={setRunning}
          leading
        />
      </NameForm>
    </main>
  );
}

/**
 * Before the first snapshot: no heading, so focus waits for the room's; the
 * status text is enough for the moment it shows.
 */
function Connecting({ banner }: { readonly banner: string | null }) {
  useDocumentTitle(JOIN_COPY.heading);
  return (
    <main className="page">
      <p role="status">{banner}</p>
    </main>
  );
}
