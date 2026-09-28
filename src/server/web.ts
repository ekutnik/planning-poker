import { join, sep } from "node:path";
import compress from "@fastify/compress";
import staticFiles from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ROOM_ID_PATTERN } from "../shared/rules.js";

/** Hashed build output: its name changes when its content does. */
export const IMMUTABLE = "public, max-age=31536000, immutable";
/** Everything else, index.html above all: check with the server every time. */
export const REVALIDATE = "no-cache";

/**
 * Serves the built client from `root` (vite build's dist/web). The pages
 * are the one index.html: at /, and at every room link, where the client's
 * router takes over. Files under assets/ carry a content hash, so they are
 * cached for good; anything else, index.html and theme-init.js included,
 * is revalidated on every load (an ETag makes that cheap), so a deploy is
 * picked up at once. Responses are compressed when the browser accepts it.
 *
 * Queued in order: compression first, so its hook covers the file routes
 * and the pages registered after it.
 */
export function serveClient(app: FastifyInstance, root: string): void {
  const assets = join(root, "assets") + sep;
  void app.register(compress);
  void app.register(staticFiles, {
    root,
    // One route per file in the build, found at startup, rather than a
    // catch-all: an unknown path stays a 404, and the API keeps its routes.
    wildcard: false,
    index: false,
    setHeaders: (reply, path) => {
      reply.header(
        "Cache-Control",
        path.startsWith(assets) ? IMMUTABLE : REVALIDATE,
      );
    },
  });
  void app.register((scope, _options, done) => {
    scope.get("/", (_request, reply) => reply.sendFile("index.html"));
    // Every room link is the same page. A malformed one is still the page,
    // with a 404, so the client can say "There's no room at this link."
    scope.get<{ Params: { roomId: string } }>("/r/:roomId", (request, reply) =>
      reply
        .code(ROOM_ID_PATTERN.test(request.params.roomId) ? 200 : 404)
        .sendFile("index.html"),
    );
    done();
  });
}

/**
 * A path that is not a page or a file. A browser asking for HTML gets the
 * page with a 404, so the client says there is nothing here; anything else
 * gets an empty 404, which, unlike Fastify's default, does not log the raw
 * URL (#21).
 */
export function notFound(serving: boolean) {
  return (request: FastifyRequest, reply: FastifyReply) => {
    if (serving && request.headers.accept?.includes("text/html")) {
      return reply.code(404).sendFile("index.html");
    }
    return reply.code(404).send();
  };
}
