import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import type { Asset, ImageRequest, ImageResolver } from "lekh";
import { useEditor } from "lekh/canvas";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { Icon } from "./icons";
import { Meta } from "./parts";
import { withAlt, type AltAnswer, type Picture } from "./alt";
import {
  backgroundOfImage,
  fallbackColorOf,
  renderingOf,
  type Background,
} from "./background";
import { STOCK, type StockImage } from "./stock";

/**
 * The Consumer's half of the one image hook.
 *
 * `lekh` never assumes a file means an upload — it says why it wants an image,
 * hands over whatever files arrived with the gesture, and waits. Everything
 * below is this example's answer to that: an asset gallery, a fake upload that
 * reports progress and respects the abort signal, and a switch for making it
 * fail so the retry path can be tried.
 *
 * A real product would open its digital asset manager here, or upload to its
 * own storage and return the CDN location. The Asset it returns is what enters
 * the Document — the example inlines an SVG or the dropped file as a data URL
 * so the page works offline, and so the Document never carries a `blob:` URL
 * that would mean nothing an hour later (ADR-0010).
 */
export interface ImageGallery {
  /** Hand this to `createEditor` as `resolveImage`. */
  readonly resolveImage: ImageResolver;
  /** Render this once, anywhere inside the editor. */
  readonly Dialog: ComponentType;
}

/** One outstanding ask, as the dialog needs it. */
interface Ask {
  /** Distinguishes one ask from the next, so the dialog resets between them. */
  readonly key: number;
  readonly request: ImageRequest;
  /** Close the dialog without answering — the resolution carries on. */
  hide(): void;
  settle(asset: Asset | undefined): void;
  fail(error: unknown): void;
}

/** How many progress ticks the fake upload reports, and how far apart. */
const STEPS = 8;
const STEP_MS = 140;

export function createImageGallery(): ImageGallery {
  const listeners = new Set<() => void>();
  let visible: Ask | undefined;
  let keys = 0;

  const announce = (): void => {
    for (const listener of listeners) listener();
  };

  const resolveImage: ImageResolver = (request) =>
    new Promise<Asset | undefined>((resolve, reject) => {
      keys += 1;
      const ask: Ask = {
        key: keys,
        request,
        hide() {
          if (visible !== ask) return;
          visible = undefined;
          announce();
        },
        settle(asset) {
          ask.hide();
          resolve(asset);
        },
        fail(error) {
          ask.hide();
          reject(error);
        },
      };

      // The library aborts when the place the image was going leaves the
      // Document — an undo that takes back the Block a replacement was headed
      // for. The dialog has to go with it.
      request.signal.addEventListener("abort", () => {
        ask.settle(undefined);
      });

      visible = ask;
      announce();
    });

  function GalleryDialog(): ReactNode {
    const ask = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      () => visible,
      () => undefined,
    );

    return (
      <Dialog
        open={ask !== undefined}
        onOpenChange={(open) => {
          // Dismissing the dialog any way at all — the close button, Escape, a
          // click outside — is the Author saying they did not want an image.
          if (!open) ask?.settle(undefined);
        }}
      >
        {ask ? <Panel key={ask.key} ask={ask} /> : null}
      </Dialog>
    );
  }

  return { resolveImage, Dialog: GalleryDialog };
}

/** What a request is for: its reason, and where the picture will land. */
type Job = Pick<ImageRequest, "reason" | "placement">;

/** The background the picture goes behind a Block as, if it is one. */
function backgroundOf({ placement }: Job): Background | undefined {
  return placement.kind === "replace"
    ? backgroundOfImage(placement.prop)
    : undefined;
}

/** Whether the picture is never shown with alt text, so none is asked for. */
function isDecorative({ placement }: Job): boolean {
  return placement.kind === "replace" && placement.decorative;
}

const TITLES: Record<ImageRequest["reason"], string> = {
  insert: "Choose an image",
  add: "Add an image",
  replace: "Replace the image",
  drop: "You dropped an image on the email",
  paste: "You pasted an image",
};

const WAITING: Record<ImageRequest["reason"], string> = {
  insert: "Waiting for an image",
  add: "Adding the image",
  replace: "Replacing the image",
  drop: "Uploading the file you dropped",
  paste: "Uploading what you pasted",
};

/** The picker's title, naming the job. */
export function titleOf(job: Job): string {
  if (job.reason === "add" && backgroundOf(job) !== undefined)
    return "Add a background image";
  return TITLES[job.reason];
}

/** What the pending placeholder says while the picture is on its way. */
export function waitingOf(job: Job): string {
  if (job.reason === "add" && backgroundOf(job) !== undefined)
    return "Adding the background";
  return WAITING[job.reason];
}

/** The picture the Author has selected, and not yet committed. */
type Picked =
  | { readonly from: "library"; readonly image: StockImage }
  | { readonly from: "file"; readonly file: File };

function Panel({ ask }: { readonly ask: Ask }): ReactNode {
  const { request } = ask;
  const altId = useId();
  const decorativeId = useId();
  const failId = useId();
  // Whatever came with the gesture, then whatever the Author adds here.
  const [uploads, setUploads] = useState<readonly File[]>(request.files);
  const [tab, setTab] = useState(
    request.files.length > 0 ? "upload" : "library",
  );
  const [picked, setPicked] = useState<Picked | undefined>(() => {
    const [file] = request.files;
    return file === undefined ? undefined : { from: "file", file };
  });
  const [alt, setAlt] = useState("");
  const [decorative, setDecorative] = useState(false);
  const [failing, setFailing] = useState(false);
  const background = backgroundOf(request);

  /**
   * Answer the ask with the chosen picture, and get out of the way.
   *
   * The dialog closes the moment the Author commits, because the placeholder the
   * library reports through the `pendingImage` Slot is where progress and the
   * cancel button belong — nothing has entered the Document yet.
   */
  const commit = (choice: Picked): void => {
    const answer: AltAnswer = {
      alt,
      decorative: decorative || isDecorative(request),
    };
    ask.hide();
    void deliver(ask, () => assetOf(choice, answer), failing);
  };

  const isPicked = (choice: Picked): boolean =>
    picked !== undefined && pickTarget(picked) === pickTarget(choice);

  /** Click selects; a double-click commits at once. */
  const pickable = (choice: Picked) => ({
    "aria-pressed": isPicked(choice),
    onClick: () => {
      setPicked(choice);
    },
    onDoubleClick: () => {
      commit(choice);
    },
  });

  /** Files from the drop zone join the list, and the first is picked. */
  const add = (files: readonly File[]): void => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const [first] = images;
    if (first === undefined) return;
    setUploads((current) => [...images, ...current]);
    setPicked({ from: "file", file: first });
  };

  return (
    <DialogContent
      className="flex max-h-[calc(100%-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      showCloseButton={false}
    >
      <DialogHeader className="border-b border-rule-soft px-4 py-3.5 text-left">
        <DialogTitle className="text-[0.9375rem]">
          {titleOf(request)}
        </DialogTitle>
        <DialogDescription>
          Nothing has changed yet. Cancel and the email stays exactly as it was.
        </DialogDescription>
      </DialogHeader>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList
          variant="line"
          className="h-10 w-full flex-none justify-start rounded-none border-b border-rule-soft px-2"
        >
          <TabsTrigger value="library" className="flex-none px-2.5 text-xs">
            <Icon name="image" className="size-3.5" />
            Library
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex-none px-2.5 text-xs">
            <Icon name="upload" className="size-3.5" />
            Upload
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="library"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
            {STOCK.map((image) => (
              <button
                key={image.label}
                type="button"
                className={THUMBNAIL}
                {...pickable({ from: "library", image })}
              >
                {/* Contained, not cropped: a wordmark shows whole. */}
                <img
                  src={image.src}
                  alt=""
                  className="block aspect-3/2 w-full bg-muted object-contain"
                />
                <span className="flex items-baseline justify-between gap-1.5 border-t border-rule-soft px-1.5 py-1 text-xs">
                  {image.label}
                  <Meta>
                    {image.width}×{image.height}
                  </Meta>
                </span>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent
          value="upload"
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3"
        >
          <DropZone onFiles={add} />
          {uploads.map((file) => (
            <Button
              key={previewKey({ from: "file", file })}
              variant="outline"
              className="w-full justify-between aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary"
              {...pickable({ from: "file", file })}
            >
              <span className="min-w-0 truncate">{file.name}</span>
              <Meta>{Math.round(file.size / 1024)} kB</Meta>
            </Button>
          ))}
        </TabsContent>
      </Tabs>

      {picked ? (
        <section className="flex gap-3 border-t border-rule-soft px-4 py-3">
          {background ? (
            <BackgroundPreview
              key={previewKey(picked)}
              picked={picked}
              background={background}
              blockId={
                request.placement.kind === "replace"
                  ? request.placement.blockId
                  : undefined
              }
            />
          ) : (
            <Preview key={previewKey(picked)} picked={picked} />
          )}
          {background ? null : isDecorative(request) ? (
            <p className="self-center text-xs text-muted-foreground">
              It&rsquo;s decorative, so it needs no alt text.
            </p>
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div>
                <Label htmlFor={altId} className="mb-1">
                  Alt text
                </Label>
                <Input
                  id={altId}
                  value={decorative ? "" : alt}
                  disabled={decorative}
                  placeholder="What the image says when images are blocked"
                  onChange={(event) => {
                    setAlt(event.target.value);
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={decorativeId}
                  checked={decorative}
                  onCheckedChange={(checked) => {
                    setDecorative(checked === true);
                  }}
                />
                <Label htmlFor={decorativeId} className="normal-case">
                  It&rsquo;s decorative
                </Label>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <DialogFooter className="flex-row items-center gap-2 border-t border-rule-soft bg-muted px-4 py-3 sm:justify-start">
        {/* The example's own switch, not a real action: kept apart from
            Cancel and labelled as a demo so nobody mistakes it for one. */}
        <Switch
          id={failId}
          size="sm"
          checked={failing}
          onCheckedChange={setFailing}
        />
        <Label
          htmlFor={failId}
          className="text-xs font-normal normal-case text-muted-foreground"
        >
          Demo: fail the upload
        </Label>
        <span className="flex-1" />
        <Button
          variant="outline"
          onClick={() => {
            ask.settle(undefined);
          }}
        >
          Cancel
        </Button>
        <Button
          disabled={picked === undefined}
          onClick={() => {
            if (picked) commit(picked);
          }}
        >
          Use image
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

const THUMBNAIL =
  "flex flex-col overflow-hidden rounded-md border bg-card text-left transition-[border-color,transform] hover:-translate-y-px hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary";

/**
 * Where a file is dropped or chosen. The browser's file input is underneath,
 * hidden, so a click still opens the system's picker.
 */
function DropZone({
  onFiles,
}: {
  readonly onFiles: (files: readonly File[]) => void;
}): ReactNode {
  const inputId = useId();
  const [over, setOver] = useState(false);

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-card/50 px-3 py-6 text-center text-muted-foreground transition-colors hover:border-primary hover:bg-wash hover:text-ink-mark has-focus-visible:ring-2 has-focus-visible:ring-ring",
        over && "border-primary bg-wash text-ink-mark",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles([...event.dataTransfer.files]);
      }}
    >
      <Icon name="upload" className="size-5" />
      <span className="text-[0.8125rem]">Drop an image here</span>
      <span className="text-xs">or click to choose a file</span>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
    </label>
  );
}

/** What a pick points at, so two picks of the same thing compare equal. */
function pickTarget(picked: Picked): StockImage | File {
  return picked.from === "library" ? picked.image : picked.file;
}

/** One preview per picture, so a new file never shows the last one's URL. */
function previewKey(picked: Picked): string {
  return picked.from === "library"
    ? `library:${picked.image.label}`
    : `file:${picked.file.name}:${String(picked.file.lastModified)}`;
}

/** Where the selected picture can be drawn from. */
function usePickedSrc(picked: Picked): string | undefined {
  const file = picked.from === "file" ? picked.file : undefined;
  const [fileUrl, setFileUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return picked.from === "library" ? picked.image.src : fileUrl;
}

/** The selected picture, shown larger beside its alt text. */
function Preview({ picked }: { readonly picked: Picked }): ReactNode {
  const src = usePickedSrc(picked);
  return (
    <div className="aspect-3/2 w-56 shrink-0 overflow-hidden rounded-md border bg-muted">
      {src === undefined ? null : (
        <img src={src} alt="" className="block size-full object-contain" />
      )}
    </div>
  );
}

/**
 * The selected picture as the background it will be: behind a line of text,
 * filling or tiling as it will render, and the colour a reader with images off
 * sees instead.
 */
function BackgroundPreview({
  picked,
  background,
  blockId,
}: {
  readonly picked: Picked;
  readonly background: Background;
  readonly blockId: string | undefined;
}): ReactNode {
  const editor = useEditor();
  const src = usePickedSrc(picked);
  const fallback =
    blockId === undefined
      ? undefined
      : fallbackColorOf(editor, blockId, background);

  return (
    <>
      <div
        className="flex aspect-3/2 w-56 shrink-0 items-center justify-center overflow-hidden rounded-md border p-3"
        style={{
          backgroundColor: fallback,
          ...(src === undefined
            ? {}
            : {
                backgroundImage: `url("${src}")`,
                ...(background.fit === "cover"
                  ? {
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      backgroundRepeat: "no-repeat",
                    }
                  : { backgroundRepeat: "repeat" }),
              }),
        }}
      >
        <span className="rounded-sm bg-white/85 px-2 py-1 text-center text-[0.8125rem] font-semibold text-neutral-900">
          Your text sits on top
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 text-xs text-muted-foreground">
        <p>{renderingOf(background.fit)}</p>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-5 shrink-0 rounded border",
              fallback === undefined && "checkerboard",
            )}
            style={{ backgroundColor: fallback }}
          />
          {fallback === undefined ? (
            <span>No color shows when images are off.</span>
          ) : (
            <span>
              <Meta className="text-foreground">{fallback}</Meta> shows when
              images are off.
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/** Turn the committed pick into the Asset the library places. */
async function assetOf(choice: Picked, answer: AltAnswer): Promise<Asset> {
  const picture =
    choice.from === "library"
      ? choice.image
      : await pictureFromFile(choice.file);
  return withAlt(picture, answer);
}

/**
 * Pretend to upload, then answer.
 *
 * Progress is reported as it goes so the pending Slot has a number to draw,
 * and the abort signal is honoured so cancelling actually stops the work
 * rather than leaving it running against a placement that has gone.
 */
async function deliver(
  ask: Ask,
  produce: () => Promise<Asset>,
  failing: boolean,
): Promise<void> {
  const { request } = ask;
  try {
    for (let step = 1; step <= STEPS; step += 1) {
      await wait(STEP_MS, request.signal);
      request.onProgress(step / (STEPS + 1));
    }
    if (failing) throw new Error("The upload service turned it down.");

    const asset = await produce();
    request.onProgress(1);
    ask.settle(asset);
  } catch (error) {
    // An abort has already settled the ask, and the library has already
    // forgotten the request — reporting a failure now would be reporting one
    // for something nobody is waiting on.
    if (request.signal.aborted) return;
    ask.fail(error);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled.", "AbortError"));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Turn a dropped or pasted file into a picture an Asset can be made from.
 *
 * The dimensions are measured rather than guessed: an Asset carries them
 * because several mail clients render an image at its intrinsic size when the
 * markup does not say otherwise.
 */
async function pictureFromFile(file: File): Promise<Picture> {
  const src = await readDataUrl(file);
  const { width, height } = await intrinsicSize(src);
  return { src, width, height };
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("That file could not be read as an image."));
    });
    reader.addEventListener("error", () => {
      reject(new Error("That file could not be read."));
    });
    reader.readAsDataURL(file);
  });
}

function intrinsicSize(
  src: string,
): Promise<{ readonly width: number; readonly height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    });
    image.addEventListener("error", () => {
      reject(new Error("That file is not an image a browser can decode."));
    });
    image.src = src;
  });
}
