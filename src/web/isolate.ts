const FIRST_STRONG_ISOLATE = "⁨";
const POP_DIRECTIONAL_ISOLATE = "⁩";

/**
 * A name put into a sentence, isolated (#80): a right-to-left name can't
 * reorder the words around it, or the names beside it in a list. Every
 * place a name goes into a string uses this, and a test finds any that
 * doesn't; a name in an element of its own gets `dir="auto"` instead.
 * Screen readers don't speak the two characters, and input never keeps
 * them (stripInvisible), so only this adds them.
 */
export function isolate(name: string): string {
  return `${FIRST_STRONG_ISOLATE}${name}${POP_DIRECTIONAL_ISOLATE}`;
}
