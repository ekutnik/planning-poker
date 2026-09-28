import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

type Violation = Awaited<
  ReturnType<AxeBuilder["analyze"]>
>["violations"][number];

/** WCAG 2.2 AA, the level the September audit tested against. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** One line per violation: the rule, and where. */
function describe(violation: Violation): string {
  const targets = violation.nodes
    .map((node) => node.target.join(" "))
    .join(", ");
  return `${violation.id} (${violation.impact ?? "?"}): ${violation.help} at ${targets}`;
}

/**
 * Runs axe on the page as it is now, in the light theme and in the dark,
 * and fails on any violation. The theme follows the system (the default
 * choice), so switching the emulated colour scheme switches it without a
 * reload, and the page stays exactly on the screen being checked.
 */
export async function expectAccessible(page: Page, screen: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Let any transition finish, so contrast is measured on the colours
    // that stay. One cancelled meanwhile (its element replaced) rejects,
    // and has nothing left to wait for.
    // Two frames first, so one that starts with the next render is included.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.evaluate(() =>
      Promise.allSettled(
        document.getAnimations().map((animation) => animation.finished),
      ),
    );
    const { violations } = await new AxeBuilder({ page })
      .withTags(TAGS)
      .analyze();
    expect(violations.map(describe), `axe: ${screen}, ${colorScheme}`).toEqual(
      [],
    );
  }
  await page.emulateMedia({ colorScheme: null });
}
