/**
 * Default Block identity generator.
 *
 * Deliberately depends on no platform global — the build targets neutral, so
 * `crypto` cannot be assumed. Ids only have to be unique within a Document; a
 * Consumer who wants UUIDs supplies their own factory at construction, which
 * is also how tests make ids predictable.
 */
export function createDefaultIdFactory(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    const random = Math.random().toString(36).slice(2, 10);
    return `b${random}${counter.toString(36)}`;
  };
}
