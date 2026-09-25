import { ROOM_ID_PATTERN } from "../shared/rules.js";

export type Route =
  | { readonly name: "home" }
  | { readonly name: "room"; readonly roomId: string }
  | { readonly name: "not-found" };

const HOME: Route = { name: "home" };
const NOT_FOUND: Route = { name: "not-found" };

/** The shared room id rule, so a bad link never opens a socket the server refuses. */
export function parseRoute(pathname: string): Route {
  if (pathname === "/") return HOME;
  const roomId = /^\/r\/([^/]+)\/?$/.exec(pathname)?.[1];
  return roomId !== undefined && ROOM_ID_PATTERN.test(roomId)
    ? { name: "room", roomId }
    : NOT_FOUND;
}

export function roomPath(roomId: string): string {
  return `/r/${roomId}`;
}

type RouterWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  readonly location: Pick<Location, "pathname">;
  readonly history: Pick<History, "pushState">;
};

export interface Router {
  /** Stable: the same object until the route changes (useSyncExternalStore). */
  getRoute(): Route;
  subscribe(listener: () => void): () => void;
  navigate(path: string): void;
}

/**
 * Two routes (/ and /r/:roomId) do not justify a dependency: pushState to
 * navigate, popstate for back and forward, and a store React can subscribe to.
 */
export function createRouter(win: RouterWindow): Router {
  const listeners = new Set<() => void>();
  let route = parseRoute(win.location.pathname);

  const update = () => {
    const next = parseRoute(win.location.pathname);
    if (JSON.stringify(next) === JSON.stringify(route)) return;
    route = next;
    for (const listener of listeners) listener();
  };

  return {
    getRoute: () => route,
    subscribe(listener) {
      if (listeners.size === 0) win.addEventListener("popstate", update);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) win.removeEventListener("popstate", update);
      };
    },
    navigate(path) {
      win.history.pushState(null, "", path);
      update();
    },
  };
}
