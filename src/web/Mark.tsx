/**
 * The mark: a card with an index dot. The outline follows the text colour
 * and the dot is Cobalt, so both follow the theme.
 */
export function Mark({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="6" y="3" width="12" height="18" rx="2.5" />
      <circle className="mark-dot" cx="9.5" cy="7" r="1.25" stroke="none" />
    </svg>
  );
}
