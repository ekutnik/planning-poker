import {
  RoomConnection,
  type Clock,
  type Identity,
  type Socket,
  type SocketEvents,
} from "./room-connection.js";

/**
 * WebSocket as RoomConnection's Socket, on the page's own origin (ws: or wss:
 * to match http: or https:, which the Vite proxy and later Fastify serve).
 * send and close never throw: WebSocket.send throws while still connecting.
 */
export function openBrowserSocket(path: string, events: SocketEvents): Socket {
  const url = new URL(path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  socket.onopen = () => events.onOpen();
  socket.onmessage = (event: MessageEvent) => {
    if (typeof event.data === "string") events.onMessage(event.data);
  };
  socket.onclose = (event: CloseEvent) => events.onClose(event.code);
  return {
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
    close: (code, reason) => {
      try {
        socket.close(code, reason);
      } catch {
        // Already closing, or a reason too long for the frame: nothing to do.
      }
    },
  };
}

const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export function createBrowserConnection(
  roomId: string,
  identity: Identity,
): RoomConnection {
  return new RoomConnection(roomId, identity, {
    openSocket: openBrowserSocket,
    clock: browserClock,
    random: Math.random,
    warn: (message, fields) => console.warn(message, fields),
  });
}
