import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyText } from "./clipboard.js";
import { copyLinkLabel, CopyLinkButton } from "./CopyLinkButton.js";

describe("copyText", () => {
  it("copies the text it is given", async () => {
    const written: string[] = [];
    const clipboard = {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    };
    expect(await copyText("http://example.test/r/x", clipboard)).toBe("copied");
    expect(written).toEqual(["http://example.test/r/x"]);
  });

  it("fails when the browser refuses", async () => {
    const refused = {
      writeText: () =>
        Promise.reject(
          new DOMException("Write permission denied.", "NotAllowedError"),
        ),
    };
    expect(await copyText("link", refused)).toBe("failed");
  });

  it("fails when there is no clipboard, outside a secure context", async () => {
    expect(await copyText("link", undefined)).toBe("failed");
  });

  it("fails when writing throws instead of rejecting", async () => {
    const throws = {
      writeText: (): Promise<void> => {
        throw new TypeError("not a function");
      },
    };
    expect(await copyText("link", throws)).toBe("failed");
  });
});

describe("Copy link", () => {
  it("says what happened, and on failure what to do instead", () => {
    expect(copyLinkLabel("idle")).toBe("Copy link");
    expect(copyLinkLabel("copied")).toBe("Link copied");
    expect(copyLinkLabel("failed")).toBe(
      "Couldn't copy. Copy the address from your browser.",
    );
  });

  it("has its own live region, empty until a copy, and none on the button", () => {
    const html = renderToStaticMarkup(<CopyLinkButton link="x" />);
    expect(html).toBe(
      '<button type="button">Copy link</button><span role="status" class="visually-hidden"></span>',
    );
  });
});
