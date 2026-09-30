import { useState } from "react";
import { createRoom } from "./api.js";
import { HOME_COPY, RUNNING_COPY } from "./copy.js";
import type { FacilitateStore } from "./facilitate.js";
import type { Identity } from "./identity.js";
import { LandingPreview } from "./LandingPreview.js";
import { NameForm } from "./NameForm.js";
import { ScreenHeading } from "./ScreenHeading.js";
import { SwitchRow } from "./SwitchRow.js";
import { useDocumentTitle } from "./title.js";

/**
 * The landing page: a name, one button, and the promise the tool keeps.
 * The Facilitate switch starts as this browser last left it, off if it never
 * chose: most people in a room aren't facilitating, and whoever runs the
 * session turns it on once. The choice is saved with the room, as the Menu
 * would save it.
 */
export function HomePage({
  identity,
  facilitate,
  onCreated,
}: {
  readonly identity: Identity;
  readonly facilitate: FacilitateStore;
  readonly onCreated: (roomId: string) => void;
}) {
  useDocumentTitle(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(() => facilitate.isOn());

  const create = (name: string) => {
    setBusy(true);
    setFailed(false);
    createRoom().then(
      (roomId) => {
        identity.rememberName(name);
        facilitate.set(running);
        onCreated(roomId);
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <main className="page page--landing">
      <div className="landing-form">
        <ScreenHeading>{HOME_COPY.heading}</ScreenHeading>
        <p className="page-intro">{HOME_COPY.intro}</p>
        <NameForm
          initial={identity.lastName()}
          submitLabel={HOME_COPY.submit}
          busy={busy}
          onSubmit={create}
        >
          <SwitchRow
            label={RUNNING_COPY.label}
            note={RUNNING_COPY.note}
            checked={running}
            onChange={setRunning}
            leading
          />
        </NameForm>
        <p className="page-note">{HOME_COPY.invite}</p>
        {failed && <p role="alert">{HOME_COPY.failed}</p>}
      </div>
      <LandingPreview />
    </main>
  );
}
