/**
 * Marks a branch the type system has already ruled out.
 *
 * Keeps a `switch` over a closed union exhaustive: adding an Op kind without
 * handling it fails to compile here rather than falling through silently.
 */
export function unreachable(value: never): never {
  throw new TypeError(`Unhandled variant: ${JSON.stringify(value)}`);
}
