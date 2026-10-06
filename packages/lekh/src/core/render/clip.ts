/**
 * Gmail's clip: roughly 102 KB of HTML, past which it hides the rest of the
 * email behind a "View entire message" link. Unsubscribe links and tracking
 * pixels near the bottom go with it.
 */
export const GMAIL_CLIP_BYTES = 102 * 1024;

export interface ClipCheckOptions {
  /** The size, in bytes, past which the email is clipped. Defaults to Gmail's. */
  limit?: number;
  /**
   * How much of the limit to keep free, as a share of it. An email inside this
   * last part is `near`. Defaults to a tenth.
   */
  headroom?: number;
}

export interface ClipCheck {
  /** The HTML's size in UTF-8 bytes, which is what a mail client counts. */
  readonly bytes: number;
  readonly limit: number;
  readonly risk: "ok" | "near" | "clipped";
}

/**
 * How close an email's HTML is to being clipped.
 *
 * Measure the final HTML, after whatever a send pipeline adds to it — tracking,
 * a footer, inlined CSS. That is why this is not a Diagnostic: the Document
 * alone can't say how big the sent email will be.
 *
 * Throws a `RangeError` when `headroom` is outside 0 to 1.
 */
export function clipCheck(
  html: string,
  options: ClipCheckOptions = {},
): ClipCheck {
  const { limit = GMAIL_CLIP_BYTES, headroom = 0.1 } = options;
  if (!(headroom >= 0 && headroom <= 1)) {
    throw new RangeError(
      `headroom is a share of the limit, from 0 to 1. Got ${String(headroom)}.`,
    );
  }
  const bytes = new TextEncoder().encode(html).length;
  // Whole bytes, so the edge doesn't move with floating-point error.
  const nearFrom = limit - Math.round(limit * headroom);
  const risk = bytes > limit ? "clipped" : bytes > nearFrom ? "near" : "ok";
  return { bytes, limit, risk };
}
