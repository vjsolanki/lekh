import type { Asset, ImageResolver } from "lekh-editor";

/**
 * Answer every ask for an image.
 *
 * Return an Asset to place it, `undefined` if the person cancelled, and
 * reject if it went wrong — they are offered a retry.
 */
export const resolveImage: ImageResolver = async (request) => {
  const [file] = request.files;

  // No file came with the ask, so open your own picker instead.
  if (file === undefined) return openImagePicker(request.signal);

  const uploaded = await uploadToYourStorage(file, {
    signal: request.signal,
    onProgress: (fraction) => {
      request.onProgress(fraction);
    },
  });

  const asset: Asset = {
    src: uploaded.url,
    width: uploaded.width,
    height: uploaded.height,
    alt: "",
  };

  return asset;
};

// Your own code, from here down.
declare function openImagePicker(
  signal: AbortSignal,
): Promise<Asset | undefined>;
declare function uploadToYourStorage(
  file: File,
  options: {
    signal: AbortSignal;
    onProgress: (fraction: number) => void;
  },
): Promise<{ url: string; width: number; height: number }>;
