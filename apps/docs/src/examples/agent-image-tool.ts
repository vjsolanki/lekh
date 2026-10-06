import {
  type AgentToolResult,
  agentTools,
  type Asset,
  type Editor,
} from "lekh";

/** Where your image library serves pictures from. */
const YOUR_IMAGES = "https://images.example.com/";

/** Your own tool, in the same shape as lekh's. */
const findImageTool = {
  name: "find_image",
  description:
    "Search the image library for pictures that match a query. Gives back " +
    "Assets. To place one, pass it whole as an image prop in `suggest`, " +
    "with alt text that says what it shows.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What the picture shows." },
    },
    required: ["query"],
    additionalProperties: false,
  },
} as const;

/**
 * lekh's four tools and `find_image`, behind one `call`.
 *
 * An image your agent places must come from your library. A picture from
 * anywhere else is refused before your users see it.
 */
export function toolsWithImages(editor: Editor) {
  const tools = agentTools(editor, { focus: editor.getSelection() });

  return {
    definitions: [...tools.definitions, findImageTool],

    async call(name: string, input: unknown): Promise<AgentToolResult> {
      if (name === "find_image") {
        const query = isRecord(input) ? input.query : undefined;
        if (typeof query !== "string") {
          return { isError: true, content: { error: "`query` is missing." } };
        }
        const assets = await searchYourImageLibrary(query);
        return { isError: false, content: { assets } };
      }

      if (name === "suggest") {
        const foreign = imageSources(input).filter(
          (src) => !src.startsWith(YOUR_IMAGES),
        );
        if (foreign.length > 0) {
          return {
            isError: true,
            content: {
              error: `Use find_image for every picture. Not from it: ${foreign.join(", ")}`,
            },
          };
        }
      }

      return tools.call(name, input);
    },
  };
}

/** Every image `src` in a `suggest` call's Edits, however deep. */
function imageSources(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => imageSources(item));
  if (!isRecord(value)) return [];
  const own =
    typeof value.src === "string" && typeof value.width === "number"
      ? [value.src]
      : [];
  return [
    ...own,
    ...Object.values(value).flatMap((item) => imageSources(item)),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Your own code: an Asset is a URL you host, with its size in pixels.
declare function searchYourImageLibrary(
  query: string,
): Promise<readonly Asset[]>;
