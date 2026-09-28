import { useEffect } from "react";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { NUDGE_COPY, PRODUCT_NAME } from "./copy.js";
import { roundStatus } from "./status.js";

const APP = PRODUCT_NAME;

/** "Votes revealed – Planning Poker Session"; the name alone on the landing page. */
export function documentTitle(part: string | null): string {
  return part === null ? APP : `${part} – ${APP}`;
}

/** A heading that is a sentence, as a title: "You left the room". */
export function titleOf(heading: string): string {
  return heading.replace(/\.$/, "");
}

/**
 * The room's title carries the round, so a facilitator in another tab (the
 * issue tracker, say) can see whether everyone has voted without switching
 * back. Only what everyone in the room can see: never a vote, and never the
 * room id, which is the room's credential. Screen readers do not announce
 * title changes, so it stays calm.
 */
export function roomTitle(snapshot: RoomSnapshot): string {
  if (snapshot.phase === "revealed") return "Votes revealed";
  const waiting = roundStatus(snapshot).waitingFor.length;
  return waiting === 0 ? "Everyone voted" : `${waiting} waiting`;
}

/**
 * The room's tab title and its nudge banner, decided together so they can
 * never disagree: while a nudge stands, the title asks for your vote and
 * the banner says the room is waiting; otherwise the title carries the
 * round and there is no banner. Both are fixed words chosen by a yes or no,
 * so nothing about who nudged, or anyone else, can reach them.
 */
export function roomTitleAndBanner(
  round: string,
  nudged: boolean,
): { readonly title: string; readonly banner: string | null } {
  return nudged
    ? { title: NUDGE_COPY.title, banner: NUDGE_COPY.banner }
    : { title: round, banner: null };
}

/** Sets the document title while this screen is shown. */
export function useDocumentTitle(part: string | null): void {
  useEffect(() => {
    document.title = documentTitle(part);
  }, [part]);
}
