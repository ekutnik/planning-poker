import { readdirSync, readFileSync } from "node:fs";

/**
 * Helpers for the Node-run stylesheet tests. Vitest turns every CSS import
 * into an empty string, so the tests read the files from disk.
 */

/** Every stylesheet the app loads, joined, with comments removed. */
export function readStyles(): string {
  const dir = new URL("./", import.meta.url);
  return [
    ...readdirSync(dir)
      .filter((file) => file.endsWith(".css"))
      .map((file) => new URL(file, dir)),
    new URL("../index.css", import.meta.url),
  ]
    .map((url) => readFileSync(url, "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The CSS split into what is inside `@media <query>` blocks, and the rest. */
export function split(
  source: string,
  query: string,
): { inside: string; outside: string } {
  const at = `@media ${query}`;
  let inside = "";
  let outside = "";
  let from = 0;
  for (
    let start = source.indexOf(at);
    start !== -1;
    start = source.indexOf(at, from)
  ) {
    outside += source.slice(from, start);
    let end = source.indexOf("{", start);
    let depth = 0;
    do {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      end += 1;
    } while (depth > 0 && end < source.length);
    inside += source.slice(start, end);
    from = end;
  }
  return { inside, outside: outside + source.slice(from) };
}

/** The declarations of every rule whose selector list is exactly `selector`. */
export function declarations(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, "g");
  return [...source.matchAll(rule)].map(([, body = ""]) => body).join(";");
}
