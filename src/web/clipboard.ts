export type CopyResult = "copied" | "failed";

/**
 * Writes text to the clipboard and says whether it worked. It fails in more
 * ways than a rejected promise: no clipboard at all outside a secure context,
 * a permission the browser or the person refused, or a synchronous throw.
 * Every one of them is "failed", so the button can say so.
 */
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
): Promise<CopyResult> {
  try {
    if (clipboard === undefined) return "failed";
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
