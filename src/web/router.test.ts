import { describe, expect, it } from "vitest";
import { createRouter, parseRoute, roomPath } from "./router.js";

const ROOM = "abcdefghij_";

describe("parseRoute", () => {
  it.each([
    ["/", { name: "home" }],
    [`/r/${ROOM}`, { name: "room", roomId: ROOM }],
    [`/r/${ROOM}/`, { name: "room", roomId: ROOM }],
    ["/r/too-short", { name: "not-found" }],
    ["/r/abcdefghij!", { name: "not-found" }],
    ["/r/", { name: "not-found" }],
    [`/r/${ROOM}/extra`, { name: "not-found" }],
    ["/rooms", { name: "not-found" }],
  ])("%s", (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });

  it("round-trips roomPath", () => {
    expect(parseRoute(roomPath(ROOM))).toEqual({ name: "room", roomId: ROOM });
  });
});

function fakeWindow(pathname: string) {
  const events = new EventTarget();
  const win = {
    location: { pathname },
    history: {
      pushState: (
        _state: unknown,
        _unused: string,
        url?: string | URL | null,
      ) => {
        win.location.pathname = String(url);
      },
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    back(to: string) {
      win.location.pathname = to;
      events.dispatchEvent(new Event("popstate"));
    },
  };
  return win;
}

describe("createRouter", () => {
  it("navigates with pushState and notifies subscribers", () => {
    const win = fakeWindow("/");
    const router = createRouter(win);
    let calls = 0;
    router.subscribe(() => (calls += 1));

    router.navigate(roomPath(ROOM));
    expect(win.location.pathname).toBe(`/r/${ROOM}`);
    expect(router.getRoute()).toEqual({ name: "room", roomId: ROOM });
    expect(calls).toBe(1);
  });

  it("follows back and forward through popstate", () => {
    const win = fakeWindow(`/r/${ROOM}`);
    const router = createRouter(win);
    router.subscribe(() => undefined);
    win.back("/");
    expect(router.getRoute()).toEqual({ name: "home" });
  });

  it("returns the same route object until the route changes", () => {
    const win = fakeWindow("/");
    const router = createRouter(win);
    let calls = 0;
    router.subscribe(() => (calls += 1));
    const first = router.getRoute();

    router.navigate("/"); // same route: no new object, no re-render
    expect(router.getRoute()).toBe(first);
    expect(calls).toBe(0);
  });

  it("stops listening to popstate when the last subscriber leaves", () => {
    const win = fakeWindow("/");
    const router = createRouter(win);
    let calls = 0;
    const unsubscribe = router.subscribe(() => (calls += 1));
    unsubscribe();
    win.back(`/r/${ROOM}`);
    expect(calls).toBe(0);
  });
});
