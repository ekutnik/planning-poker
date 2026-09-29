import type { FastifyInstance } from "fastify";

/**
 * The page's Content-Security-Policy. Everything comes from this origin, and
 * nothing inline: the theme is set by an external blocking script
 * (theme-init.js) rather than an inline one, which is what makes a strict
 * script-src possible. React's style props are fine: script sets them
 * through the DOM, which style-src does not govern; only style attributes
 * written into the HTML would be blocked, and there are none.
 */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Hardening for an SVG opened directly as a page, where it is a document
 * like any other: no script, no request, nothing loaded. The favicon needs
 * no policy to switch its colours with the system's dark mode; this one
 * only has to leave its inline <style> working while it takes the rest
 * away (the page's style-src 'self' would block that <style>).
 */
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/**
 * HTTPS only, for a year, on production responses. Nothing more: no
 * includeSubDomains or preload, since the domain (fly.dev) is not ours to
 * make promises for. Development runs over plain HTTP, where browsers
 * ignore it anyway, but it is left out there so a local server never
 * claims what it doesn't serve.
 */
export const HSTS = "max-age=31536000";

/** Features the app never uses, switched off for this origin and any frame. */
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

/**
 * Headers on every response. The room link is the only credential, so
 * Referrer-Policy matters most here: with no-referrer, following a link out
 * of the app never sends the room's URL, with its id, to another site.
 * `production` adds HSTS.
 */
export function securityHeaders(
  app: FastifyInstance,
  { production }: { readonly production: boolean },
): void {
  app.addHook("onSend", (_request, reply, payload, done) => {
    if (production) reply.header("Strict-Transport-Security", HSTS);
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Permissions-Policy", PERMISSIONS_POLICY);
    const type = String(reply.getHeader("content-type") ?? "");
    if (type.startsWith("text/html")) {
      reply.header("Content-Security-Policy", PAGE_CSP);
    } else if (type.startsWith("image/svg+xml")) {
      reply.header("Content-Security-Policy", SVG_CSP);
    }
    done(null, payload);
  });
}
