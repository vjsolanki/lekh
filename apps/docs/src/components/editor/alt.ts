import type { Asset } from "lekh";

/** What the Author said about alt text, after picking. */
export interface AltAnswer {
  readonly alt: string;
  /** "It's decorative": the picture says nothing, so it gets no alt. */
  readonly decorative: boolean;
}

/** A picture, before anything has been said about it. */
export type Picture = Pick<Asset, "src" | "width" | "height">;

/**
 * The Asset the gallery answers with: the picked picture, and the alt text the
 * Author gave it, if any.
 */
export function withAlt(picture: Picture, answer: AltAnswer): Asset {
  const { src, width, height } = picture;
  const alt = answer.decorative ? "" : answer.alt.trim();
  return { src, width, height, ...(alt === "" ? {} : { alt }) };
}
