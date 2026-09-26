/**
 * The breakpoint between compact and wide (docs/design.md, Layout), in one
 * place. The stylesheets repeat it in their @media rules, since CSS cannot
 * import it; a stylesheet test holds every one of them to this value.
 */
export const WIDE_MIN_WIDTH = "55em";

export const WIDE_QUERY = `(min-width: ${WIDE_MIN_WIDTH})`;
