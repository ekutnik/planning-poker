// Fails when the client's main chunk grows past its budget, so a regression
// is a failing check instead of something someone happens to notice. Zod
// slipped into the bundle this way and went unnoticed for a whole session.
//
// The budget is the gzipped size after that fix (73,728 bytes) plus about
// 15% headroom. Raise it deliberately, in the PR that needs the bytes, and
// say why there.
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_GZIP_BYTES = 85_000;
const DIST = "dist/web";

if (!existsSync(`${DIST}/index.html`)) {
  console.error(`No ${DIST}/index.html. Run npm run build:web first.`);
  process.exit(1);
}

// The main chunk is the module script the built page loads.
const html = readFileSync(`${DIST}/index.html`, "utf8");
const entry = /<script type="module"[^>]*\ssrc="\/([^"]+\.js)"/.exec(html)?.[1];
if (!entry) {
  console.error(`No module script found in ${DIST}/index.html.`);
  process.exit(1);
}

const bytes = gzipSync(readFileSync(`${DIST}/${entry}`)).length;
const percent = Math.round((bytes / BUDGET_GZIP_BYTES) * 100);
const summary = `${entry}: ${bytes.toLocaleString("en")} bytes gzipped, ${percent}% of the ${BUDGET_GZIP_BYTES.toLocaleString("en")}-byte budget`;
if (bytes > BUDGET_GZIP_BYTES) {
  console.error(`Over budget. ${summary}.`);
  process.exit(1);
}
console.log(summary);
