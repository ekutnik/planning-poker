import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";
import { PAGE_CSP, PERMISSIONS_POLICY, SVG_CSP } from "./headers.js";
import { IMMUTABLE, REVALIDATE } from "./web.js";

/** A built client in miniature: the page, a hashed asset, and public files. */
const root = mkdtempSync(join(tmpdir(), "planning-poker-web-"));
const PAGE =
  '<!doctype html><title>Fixture page</title><script src="/theme-init.js"></script><script type="module" src="/assets/index-abc123.js"></script>';
const SCRIPT = "console.log('a hashed asset');\n".repeat(100); // over 1 KB
beforeAll(() => {
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), PAGE);
  writeFileSync(join(root, "assets", "index-abc123.js"), SCRIPT);
  writeFileSync(join(root, "theme-init.js"), "document.documentElement;");
  writeFileSync(
    join(root, "favicon.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{}</style></svg>',
  );
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function serving() {
  const app = buildServer({ webRoot: root });
  await app.ready();
  return app;
}

const ROOM = "/r/abcdefghijk";
const html = { accept: "text/html,application/xhtml+xml" };

describe("the pages", () => {
  it.each(["/", ROOM])(
    "serves index.html at %s, revalidated every time",
    async (url) => {
      const app = await serving();
      const response = await app.inject({ url, headers: html });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^text\/html/);
      expect(response.body).toBe(PAGE);
      expect(response.headers["cache-control"]).toBe(REVALIDATE);
      await app.close();
    },
  );

  it("answers a malformed room link, or any unknown page, with the page and a 404", async () => {
    const app = await serving();
    for (const url of ["/r/not-a-room", "/somewhere"]) {
      const response = await app.inject({ url, headers: html });
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(PAGE);
    }
    await app.close();
  });

  it("answers an unknown path that is not a page with an empty 404", async () => {
    const app = await serving();
    const response = await app.inject({ url: "/api/nothing" });
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
    await app.close();
  });

  it("serves no page without a build: the API alone, as in development", async () => {
    const app = buildServer();
    await app.ready();
    const response = await app.inject({ url: "/", headers: html });
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
    await app.close();
  });
});

describe("caching", () => {
  it("caches a hashed asset for good, and revalidates the rest", async () => {
    const app = await serving();
    const asset = await app.inject({ url: "/assets/index-abc123.js" });
    expect(asset.headers["cache-control"]).toBe(IMMUTABLE);
    for (const url of ["/theme-init.js", "/favicon.svg"]) {
      const response = await app.inject({ url });
      expect(response.headers["cache-control"]).toBe(REVALIDATE);
    }
    await app.close();
  });

  it("compresses a file when the browser accepts it", async () => {
    const app = await serving();
    const response = await app.inject({
      url: "/assets/index-abc123.js",
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(response.headers["content-encoding"]).toBe("br");
    expect(brotliDecompressSync(response.rawPayload).toString()).toBe(SCRIPT);
    await app.close();
  });
});

describe("security headers", () => {
  it.each(["/", ROOM])("sends every header on %s", async (url) => {
    const app = await serving();
    const { headers } = await app.inject({ url, headers: html });
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["permissions-policy"]).toBe(PERMISSIONS_POLICY);
    expect(headers["content-security-policy"]).toBe(PAGE_CSP);
    await app.close();
  });

  it("holds the page to this origin, with nothing inline and no framing", () => {
    const directives = new Map(
      PAGE_CSP.split("; ").map((directive) => {
        const [name = "", ...values] = directive.split(" ");
        return [name, values.join(" ")];
      }),
    );
    expect(Object.fromEntries(directives)).toEqual({
      "default-src": "'self'",
      "script-src": "'self'",
      "style-src": "'self'",
      "font-src": "'self'",
      "img-src": "'self'",
      "connect-src": "'self'",
      "frame-ancestors": "'none'",
      "base-uri": "'none'",
      "form-action": "'self'",
      "object-src": "'none'",
    });
    expect(PAGE_CSP).not.toMatch(/unsafe|data:|\*/);
  });

  it("keeps the room link out of Referer headers on the API and files too", async () => {
    const app = await serving();
    for (const url of ["/health", "/assets/index-abc123.js"]) {
      const { headers } = await app.inject({ url });
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      // The page's policy is for documents; JSON and scripts need none.
      expect(headers["content-security-policy"]).toBeUndefined();
    }
    await app.close();
  });

  it("lets an SVG draw its own styles and nothing else", async () => {
    const app = await serving();
    const { headers } = await app.inject({ url: "/favicon.svg" });
    expect(headers["content-type"]).toMatch(/^image\/svg\+xml/);
    expect(headers["content-security-policy"]).toBe(SVG_CSP);
    await app.close();
  });
});

describe("the page needs nothing the policy forbids", () => {
  const page = readFileSync(
    new URL("../web/index.html", import.meta.url),
    "utf8",
  );

  it("loads every script from a file, with no inline script or handler", () => {
    for (const [tag] of page.matchAll(/<script\b[^>]*>/g)) {
      expect(tag).toMatch(/\ssrc="\//);
    }
    expect(page).not.toMatch(/\son[a-z]+=/i);
  });

  it("has no inline style", () => {
    expect(page).not.toMatch(/<style|\sstyle=/);
  });
});
