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
import type { ToolsStore } from "./tools.js";
import { bannerFor, canAct } from "./view.js";

interface Stores {
  readonly theme: ThemeStore;
  readonly facilitate: FacilitateStore;
  readonly tools: ToolsStore;
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
          initialRunning={stores.facilitate.isOn()}
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
  const { state, notice, nudged } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const facilitating = useSyncExternalStore(
    stores.facilitate.subscribe,
    stores.facilitate.isOn,
  );
  const tools = useSyncExternalStore(stores.tools.subscribe, stores.tools.get);

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
  // The Session tools: the facilitator view's, once the room is shown.
  const shown = facilitating ? state.snapshot : null;
  const live = canAct(state);
  const header = (
    <Header
      theme={stores.theme}
      room={{
        facilitate: stores.facilitate,
        link: window.location.href,
        onLeave: () => session.leave(),
        ...(shown && {
          ticket: {
            on: tools.ticket,
            live,
            onChange: (on) => {
              stores.tools.set("ticket", on);
              // Nobody is left managing a ticket once its controls go, so
              // it goes for the whole room, by the room's own message.
              if (!on && shown.ticket !== null) {
                session.send({ type: "setTicket", text: "" });
              }
            },
          },
          timer: {
            on: tools.timer,
            busy: tools.timer && shown.timer.state !== "idle",
            onChange: (on) => stores.tools.set("timer", on),
          },
          scoring: {
            on: shown.scores !== null,
            live,
            onChange: (on) => session.send({ type: "setScoring", on }),
          },
        }),
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
        tools={tools}
        nudged={nudged}
        onAction={(action) => session.send(action)}
      />
    </>
  );
}

/**
 * A room link in a browser with no name yet: ask for one first. The
 * Facilitate switch starts as this browser last left it, off if it never
 * chose, as on the landing page.
 */
export function JoinScreen({
  initialRunning,
  onJoin,
}: {
  readonly initialRunning: boolean;
  readonly onJoin: (name: string, running: boolean) => void;
}) {
  useDocumentTitle(JOIN_COPY.heading);
  const [running, setRunning] = useState(initialRunning);
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
