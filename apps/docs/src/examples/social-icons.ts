import {
  createReactEmailPreset,
  type ReactEmailIcon,
} from "lekh-editor/blocks";

/**
 * Your social links, offered in every icon row.
 *
 * Each picture is already hosted, at a URL that will still work in a year, so
 * picking one asks your `resolveImage` for nothing. The size is the file's real
 * size: a 2x PNG for a 32px icon is 64 by 64.
 */
const CDN = "https://cdn.example.com/email/social";

const icons: readonly ReactEmailIcon[] = [
  {
    label: "Instagram",
    asset: {
      src: `${CDN}/instagram.png`,
      width: 64,
      height: 64,
      alt: "Acme on Instagram",
    },
    href: "https://instagram.com/acme",
  },
  {
    label: "LinkedIn",
    asset: {
      src: `${CDN}/linkedin.png`,
      width: 64,
      height: 64,
      alt: "Acme on LinkedIn",
    },
    href: "https://linkedin.com/company/acme",
  },
  {
    label: "YouTube",
    asset: {
      src: `${CDN}/youtube.png`,
      width: 64,
      height: 64,
      alt: "Acme on YouTube",
    },
    href: "https://youtube.com/@acme",
  },
];

// A new icon row starts with the first three, links included.
export const definitions = createReactEmailPreset({ icons });
