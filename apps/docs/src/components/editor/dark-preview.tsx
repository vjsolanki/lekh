import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  cssOf,
  DARK_PAGE,
  DARK_STRATEGIES,
  darken,
  edgeColours,
  mayVanish,
  rgbaOf,
  type DarkStrategy,
  type Rgba,
} from "./dark";
import { Icon } from "./icons";
import { Grip, useRememberedSize } from "./panels";
import { Quiet, PanelTitle } from "./parts";
import type { SizeBounds } from "./layout";

/** What the Dark menu shows: nothing, one strategy, or all three. */
export type DarkView = "off" | DarkStrategy | "all";

function isDarkView(value: string): value is DarkView {
  return (
    value === "off" ||
    value === "all" ||
    DARK_STRATEGIES.some((entry) => entry.strategy === value)
  );
}

/** The Dark menu, beside the Stage and the zoom: what is being looked at. */
export function DarkMenu({
  value,
  onValue,
}: {
  readonly value: DarkView;
  readonly onValue: (value: DarkView) => void;
}): ReactNode {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="aria-pressed:bg-wash aria-pressed:text-ink-mark aria-pressed:hover:bg-wash"
          aria-pressed={value !== "off"}
        >
          <Icon name="dark" />
          <span className="max-md:hidden">Dark</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-64">
        <DropdownMenuLabel>Preview in dark mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isDarkView(next)) onValue(next);
          }}
        >
          <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {DARK_STRATEGIES.map((entry) => (
            <DropdownMenuRadioItem key={entry.strategy} value={entry.strategy}>
              {entry.label}
              <DropdownMenuShortcut className="tracking-normal">
                {entry.clients[0]}
              </DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem value="all">
            All three, side by side
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** How tall the strip is. */
const STRIP_HEIGHT: SizeBounds = { min: 160, max: 640, fallback: 300, step: 8 };

/**
 * The email under the dark strategies the menu picked, docked under the email
 * being edited.
 *
 * Read-only, and redrawn from the rendered HTML after each change. Nothing it
 * works out is kept.
 *
 * `html` is `undefined` while the email can't be rendered.
 */
export function DarkStrip({
  html,
  width,
  view,
  onClose,
}: {
  readonly html: string | undefined;
  /** The Stage's width: the email is laid out at this, then shrunk to fit. */
  readonly width: number;
  readonly view: Exclude<DarkView, "off">;
  readonly onClose: () => void;
}): ReactNode {
  const [height, setHeight] = useRememberedSize(
    "lekh.example.dark",
    STRIP_HEIGHT,
  );
  const shown =
    view === "all"
      ? DARK_STRATEGIES
      : DARK_STRATEGIES.filter((entry) => entry.strategy === view);

  return (
    <section
      aria-label="Dark preview"
      className="relative flex flex-none flex-col border-t bg-rail"
      style={{ height }}
    >
      <Grip
        label="Resize the dark preview"
        edge="top"
        size={height}
        bounds={STRIP_HEIGHT}
        onSize={setHeight}
      />
      <header className="flex min-h-9 flex-none items-center gap-2 border-b border-rule-soft px-3 py-1">
        <Icon name="dark" className="size-3.5 text-muted-foreground" />
        <PanelTitle className="mb-0">Dark</PanelTitle>
        <span className="truncate text-[0.75rem] text-muted-foreground">
          An approximation. Each client darkens in its own way, and none says
          how.
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close the dark preview"
          title="Close the dark preview"
          onClick={onClose}
        >
          <Icon name="close" />
        </Button>
      </header>
      {html === undefined ? (
        <p className="m-auto text-[0.75rem] text-muted-foreground">
          This email cannot be rendered yet. The Diagnostics say why.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-px bg-rule-soft">
          {shown.map((entry) => (
            <DarkPreview
              key={entry.strategy}
              html={html}
              width={width}
              shows={entry}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One strategy: its name, where it is met, and the email under it.
 *
 * The frame is laid out at the Stage's width, so the email's media queries
 * fire as they would, and then shrunk to the column. Where it was scrolled to
 * survives a redraw.
 */
function DarkPreview({
  html,
  width,
  shows: { strategy, label, clients },
}: {
  readonly html: string;
  readonly width: number;
  readonly shows: (typeof DARK_STRATEGIES)[number];
}): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scrolled = useRef(0);
  // Which load is the latest, so a slow image check can't report on an old one.
  const loads = useRef(0);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  const [vanishing, setVanishing] = useState<readonly string[]>([]);

  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry === undefined) return;
      setRoom({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const onLoad = (): void => {
    const doc = frame.current?.contentDocument;
    const win = frame.current?.contentWindow;
    if (!doc || !win) return;
    loads.current += 1;
    const load = loads.current;
    showDark(doc, strategy);
    win.scrollTo(0, scrolled.current);
    win.addEventListener("scroll", () => {
      scrolled.current = win.scrollY;
    });
    void flagVanishing(doc, load);
  };

  const flagVanishing = async (doc: Document, load: number): Promise<void> => {
    const images = await findVanishing(doc);
    if (load !== loads.current) return;
    for (const image of images) {
      image.style.setProperty("outline", `2px dashed ${FLAG}`, "important");
      image.style.setProperty("outline-offset", "2px", "important");
    }
    setVanishing(images.map((image) => image.alt.trim() || "An image"));
  };

  const scale = room.width > 0 ? Math.min(1, room.width / width) : 1;

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-rail">
      <div className="flex min-h-8 flex-none items-center gap-2 px-3 py-1">
        <span className="flex-none text-[0.75rem] font-medium">{label}</span>
        <Quiet className="truncate">{clients.join(", ")}</Quiet>
      </div>
      <div
        ref={box}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ background: cssOf(DARK_PAGE) }}
      >
        {/* Over the email rather than in the header, so the three frames
            start at the same height whichever of them has something to say. */}
        {vanishing.length === 0 ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="absolute bottom-2 left-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-warn-wash px-2 py-0.5 text-[0.75rem] text-warn shadow-md"
              >
                <Icon name="warning" className="size-3.5" />
                <span className="truncate">
                  {vanishing.length === 1
                    ? "An image may vanish"
                    : `${String(vanishing.length)} images may vanish`}
                  {" · a guess"}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-72">
              {vanishing.join(", ")}. A transparent image whose outline is close
              to the dark behind it. Guessed from its edge pixels, so check it
              in the client.
            </TooltipContent>
          </Tooltip>
        )}
        <iframe
          // A new width lays the email out again, and its own media queries
          // may pick other colours, so it is darkened afresh.
          key={width}
          ref={frame}
          title={`The email in dark mode: ${label}`}
          // No scripts run in it. Same origin, so this page can darken it.
          sandbox="allow-same-origin"
          srcDoc={html}
          onLoad={onLoad}
          className="absolute top-0 border-0"
          style={{
            width,
            height: scale > 0 ? room.height / scale : room.height,
            left: Math.max(0, (room.width - width * scale) / 2),
            transform: `scale(${String(scale)})`,
            transformOrigin: "0 0",
            // A client that leaves the colours alone lets the email's own
            // dark styles apply instead.
            colorScheme: strategy === "none" ? "dark" : "light",
          }}
        />
      </div>
    </div>
  );
}

/** The dashed ring round an image that may vanish. Amber in both themes. */
const FLAG = "#f59e0b";

const SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * Paint a rendered email the way the strategy would.
 *
 * Every colour is read before any is written. Text colour is inherited, so a
 * child read after its parent was flipped would be flipped back.
 */
function showDark(doc: Document, strategy: DarkStrategy): void {
  const view = doc.defaultView;
  if (!view) return;
  const page = doc.createElement("style");
  page.textContent = `html { background: ${cssOf(DARK_PAGE)}; }`;
  doc.head.append(page);
  if (strategy === "none") return;

  // SVG elements are not HTMLElements, but carry a `style` all the same.
  const read = [...doc.querySelectorAll<HTMLElement>("body, body *")].map(
    (element) => {
      const style = view.getComputedStyle(element);
      return {
        element,
        ink: rgbaOf(style.color),
        ground: rgbaOf(style.backgroundColor),
        borders: SIDES.map((side) => ({
          property: `border-${side}-color`,
          colour: rgbaOf(style.getPropertyValue(`border-${side}-color`)),
        })),
      };
    },
  );

  for (const { element, ink, ground, borders } of read) {
    const { style } = element;
    const paint = (property: string, colour: string): void => {
      style.setProperty(property, colour, "important");
    };
    if (ink) paint("color", cssOf(darken(strategy, "ink", ink)));
    if (ground && ground[3] > 0) {
      paint("background-color", cssOf(darken(strategy, "ground", ground)));
    }
    for (const { property, colour } of borders) {
      if (colour && colour[3] > 0) {
        paint(property, cssOf(darken(strategy, "ground", colour)));
      }
    }
  }
}

/** The images whose outline is close to the dark ground behind them. */
async function findVanishing(doc: Document): Promise<HTMLImageElement[]> {
  const images = [...doc.images];
  const found = await Promise.all(
    images.map(async (image) => {
      const source = image.currentSrc || image.src;
      if (source === "") return false;
      const edges = await edgesOf(source);
      return edges !== undefined && mayVanish(edges, groundBehind(image));
    }),
  );
  return images.filter((_, at) => found[at] ?? false);
}

/** The first painted background behind an element, or the client's page. */
function groundBehind(element: Element): Rgba {
  const view = element.ownerDocument.defaultView;
  if (!view) return DARK_PAGE;
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const ground = rgbaOf(view.getComputedStyle(at).backgroundColor);
    if (ground && ground[3] > 0) return ground;
  }
  return DARK_PAGE;
}

/**
 * An image's outline colours, worked out once per source.
 *
 * Read by drawing the image small on a canvas. An image from a server that
 * won't share its pixels can't be read, and is never flagged.
 */
const EDGES = new Map<string, Promise<readonly Rgba[] | undefined>>();

function edgesOf(source: string): Promise<readonly Rgba[] | undefined> {
  const known = EDGES.get(source);
  if (known) return known;
  const reading = new Promise<readonly Rgba[] | undefined>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.addEventListener("load", () => {
      try {
        const scale = Math.min(
          1,
          SAMPLE / Math.max(image.naturalWidth, image.naturalHeight, 1),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(undefined);
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const { data } = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        );
        resolve(edgeColours(data, canvas.width, canvas.height));
      } catch {
        // A canvas the image tainted. Nothing to read.
        resolve(undefined);
      }
    });
    image.addEventListener("error", () => {
      // Maybe only this once. Let the next redraw try again.
      EDGES.delete(source);
      resolve(undefined);
    });
    image.src = source;
  });
  EDGES.set(source, reading);
  return reading;
}

/** The longest side an image is read at. Enough to find an outline. */
const SAMPLE = 160;
