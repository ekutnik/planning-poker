import { useEffect, useState } from "react";
import { freshAnnouncement } from "./announce.js";
import { copyText, type CopyResult } from "./clipboard.js";
import { COPY_LINK_COPY } from "./copy.js";

type CopyState = "idle" | CopyResult;

/** How long "Link copied", or the failure, shows before "Copy link" returns. */
export const COPY_MESSAGE_MS = 3000;

/** The button's words for each state. */
export function copyLinkLabel(state: CopyState): string {
  switch (state) {
    case "idle":
      return COPY_LINK_COPY.copy;
    case "copied":
      return COPY_LINK_COPY.copied;
    case "failed":
      return COPY_LINK_COPY.failed;
  }
}

/**
 * Copies the room link without showing it: the link is the room's
 * credential, and the facilitator's screen is shared. It says whether the
 * copy worked, and when it did not, what to do instead. The outcome is also
 * announced through its own live region: a focused button whose text
 * changes is not reliably read out.
 */
export function CopyLinkButton({ link }: { readonly link: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), COPY_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = () => {
    void copyText(link, navigator.clipboard).then((result) => {
      setState(result);
      // The same outcome twice must still be spoken.
      setAnnouncement((previous) =>
        freshAnnouncement(previous, copyLinkLabel(result)),
      );
    });
  };

  return (
    <>
      <button type="button" onClick={copy}>
        {copyLinkLabel(state)}
      </button>
      <span role="status" className="visually-hidden">
        {announcement}
      </span>
    </>
  );
}
