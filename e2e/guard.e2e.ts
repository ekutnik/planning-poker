import { expect, test, watch } from "./fixtures.js";

/**
 * Every other test relies on watch() to fail on a Content-Security-Policy
 * violation or an uncaught error. This proves it sees both, in each
 * browser, so a quiet run means there were none, not that nothing listened.
 */
test("the guard sees a CSP violation and an uncaught error", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const context = await browser.newContext({ baseURL });
  await watch(context, problems);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // An inline script, which the page's script-src 'self' refuses.
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "document.title = 'ran'";
    document.head.append(script);
  });
  await expect
    .poll(() => problems)
    .toEqual([
      expect.stringMatching(/^CSP script-src(-elem)? blocked inline on \/$/),
    ]);
  await expect(page).not.toHaveTitle("ran");

  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("from the page");
    });
  });
  await expect
    .poll(() => problems.at(-1))
    .toBe("uncaught error: from the page");
  await context.close();
});
