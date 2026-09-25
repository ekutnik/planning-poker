import { useEffect, useState } from "react";

/**
 * Copies the room link without showing it: the link is the room's credential,
 * and the facilitator's screen is shared.
 */
export function CopyLinkButton({ link }: { readonly link: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <button type="button" onClick={copy} aria-live="polite">
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}
