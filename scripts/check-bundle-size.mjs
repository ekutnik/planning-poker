// Fails when all client JavaScript grows past its budget, so a regression is
// a failing check instead of something someone happens to notice. Zod
// slipped into the bundle this way and went unnoticed for a whole session.
//
// It sums the gzipped size of every .js file the build emits, not only the
// entry chunk: that is what users download, and it still holds once a
// dynamic import() splits the code into more chunks.
//
// The budget was the gzipped total after the Zod fix (73,728 bytes, one
// chunk then) plus about 15% headroom: 85,000. Raise it deliberately, in the
// PR that needs the bytes, and say why here.
//
// Raised to 90,000 in Session 8 (2026-09-28), at 79,000 bytes after 7b. A
// bundle visualiser, run once with npx and not added to the project, showed
// nothing to trim: of the minified bundle (254 KB), react-dom is 81%, react
// and scheduler 5% more, and the app's own code the remaining 14%, spread
// over about fifty small modules. No other package is in it. The only large
// lever left would be a smaller React-compatible library, a change of
// platform rather than a trim, so the budget rises instead, keeping about
// 14% headroom over today's size.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const BUDGET_GZIP_BYTES = 90_000;
const ASSETS = "dist/web/assets";

if (!existsSync(ASSETS)) {
  console.error(`No ${ASSETS}. Run npm run build:web first.`);
  process.exit(1);
}

const chunks = readdirSync(ASSETS)
  .filter((file) => file.endsWith(".js"))
  .map((file) => ({
    file,
    bytes: gzipSync(readFileSync(`${ASSETS}/${file}`)).length,
  }));
if (chunks.length === 0) {
  console.error(`No JavaScript in ${ASSETS}.`);
  process.exit(1);
}

/** @param {number} bytes */
const format = (bytes) => bytes.toLocaleString("en");
const total = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
for (const { file, bytes } of chunks) {
  console.log(`  ${file}: ${format(bytes)} bytes gzipped`);
}
const percent = Math.round((total / BUDGET_GZIP_BYTES) * 100);
const summary = `All client JavaScript: ${format(total)} bytes gzipped in ${chunks.length} ${chunks.length === 1 ? "file" : "files"}, ${percent}% of the ${format(BUDGET_GZIP_BYTES)}-byte budget`;
if (total > BUDGET_GZIP_BYTES) {
  console.error(`Over budget. ${summary}.`);
  process.exit(1);
}
console.log(summary);
