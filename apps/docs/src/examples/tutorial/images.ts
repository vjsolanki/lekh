import type { Asset, ImageResolver } from "lekh-editor";

/**
 * Measure an image the browser can already fetch.
 *
 * An Asset carries width and height because several mail clients render an
 * image at its intrinsic size when the markup does not say otherwise. So a URL
 * on its own is not an Asset, and this is the shortest honest way to get from
 * one to the other.
 */
const measure = (src: string, signal: AbortSignal): Promise<Asset> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Cancelled"));
      return;
    }

    const image = new Image();

    // Aborted when the Author cancels, and when the place the image was going
    // leaves the Document.
    signal.addEventListener("abort", () => {
      image.src = "";
      reject(new Error("Cancelled"));
    });

    image.addEventListener("load", () => {
      resolve({ src, width: image.naturalWidth, height: image.naturalHeight });
    });
    image.addEventListener("error", () => {
      // Rejecting is how a failure is reported. The Document is left alone and
      // the Author is offered a retry.
      reject(new Error(`Could not load ${src}`));
    });

    image.src = src;
  });

/**
 * Answer every ask for an image.
 *
 * One resolver covers all four reasons — a Block placed from the palette, an
 * image being changed, a file dropped, a paste — because they are all the same
 * question: what picture goes here?
 *
 * A prompt is the placeholder here — swap it for your own dialog. What matters
 * is that it answers with a URL that outlives the tab, so the HTML the last
 * step produces is HTML you can really send. Uploading the Author's own files
 * to your storage is this same function with a fetch in it: [Handle images and
 * uploads](/guides/images/).
 */
export const resolveImage: ImageResolver = async (request) => {
  const url = globalThis.prompt("Image URL");

  // Nobody typed anything. Returning undefined leaves the Document untouched,
  // which is what dismissing a dialog has to do.
  if (url === null || url === "") return undefined;

  return await measure(url, request.signal);
};
