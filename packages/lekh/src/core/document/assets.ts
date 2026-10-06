import type { DropTarget } from "../editor/drop-target";

/**
 * A resolved image — a durable location plus the dimensions needed to render
 * it reliably in mail clients.
 *
 * Dimensions are not optional. Several mail clients render an image at its
 * intrinsic size when no explicit width and height are emitted, so a library
 * that carried only a location could not produce markup that lands the same
 * way twice.
 */
export interface Asset {
  /** Where the image lives — somewhere a mail client can still fetch it. */
  readonly src: string;
  /** Intrinsic width, in pixels. */
  readonly width: number;
  /** Intrinsic height, in pixels. */
  readonly height: number;
  /** What the image says when images are blocked. */
  readonly alt?: string;
}

/**
 * Read an Asset out of a stored prop value.
 *
 * A Block's props are whatever a Document once held, so a Definition
 * validating its own image narrows here rather than trusting the shape.
 */
export function assetOf(value: unknown): Asset | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("src" in value) || typeof value.src !== "string") return undefined;
  if (!("width" in value) || typeof value.width !== "number") return undefined;
  if (!("height" in value) || typeof value.height !== "number")
    return undefined;

  const alt = "alt" in value && typeof value.alt === "string" ? value.alt : "";
  return {
    src: value.src,
    width: value.width,
    height: value.height,
    ...(alt === "" ? {} : { alt }),
  };
}

/**
 * The Assets an Asset Schema entry lists as already resolved, from its
 * `constraints.options`, or `undefined` when it lists none (ADR-0030).
 *
 * Each option is `{ label, asset }`. An option whose `asset` is not one is
 * skipped.
 */
export function listedAssetsOf(
  constraints: Readonly<Record<string, unknown>> | undefined,
): readonly Asset[] | undefined {
  const options = constraints?.["options"];
  if (!Array.isArray(options)) return undefined;
  return options.flatMap((option: unknown) => {
    const asset =
      typeof option === "object" && option !== null && "asset" in option
        ? assetOf(option.asset)
        : undefined;
    return asset ? [asset] : [];
  });
}

/**
 * Whether a value is an Asset that needs nothing more done to it: a location,
 * and a real width and height above zero. What a listed Asset has to be,
 * since it goes in with no Image Request (ADR-0030).
 */
export function isResolvedAsset(value: unknown): boolean {
  const asset = assetOf(value);
  return (
    asset !== undefined &&
    asset.src.trim() !== "" &&
    isPositive(asset.width) &&
    isPositive(asset.height)
  );
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Whether two values are the same picture: the same location at the same
 * size. The alt text is left out, because changing it is editing the Asset,
 * not swapping it.
 */
export function isSamePicture(a: unknown, b: unknown): boolean {
  const first = assetOf(a);
  const second = assetOf(b);
  return (
    first !== undefined &&
    second !== undefined &&
    first.src === second.src &&
    first.width === second.width &&
    first.height === second.height
  );
}

/**
 * Why the library asked for an image.
 *
 * The Consumer decides what each one does: a gallery dialog for one, a direct
 * upload for another, or the same dialog for every one of them.
 */
export type ImageRequestReason =
  /** An image Block was placed and has nothing in it yet. */
  | "insert"
  /** An Asset prop that holds no image is getting its first one. */
  | "add"
  /** An Asset prop that already holds an image is getting another. */
  | "replace"
  /** Files were dropped onto the Canvas. */
  | "drop"
  /** An image was pasted from the clipboard. */
  | "paste";

/** Where a resolved Asset will land. */
export type ImagePlacement =
  | {
      readonly kind: "insert";
      /** The Block type that will be created. */
      readonly type: string;
      /** The position it will take, once there is something to put in it. */
      readonly target: DropTarget;
    }
  | {
      readonly kind: "replace";
      readonly blockId: string;
      /**
       * The Asset prop it lands in: the Block's Primary Asset, or an optional
       * one such as a section's background (ADR-0026).
       */
      readonly prop: string;
      /**
       * Whether the prop's Schema entry is `decorative`: the image is never
       * shown with alt text, so there is none to ask for.
       */
      readonly decorative: boolean;
    };

/**
 * What one Image Request is about: why it was raised, what came with it, and
 * where the image is going.
 *
 * The same three facts reach the Consumer twice — once as the request their
 * resolver answers, once as the state their Chrome draws — so they are
 * described in one place.
 */
export interface ImageRequestFacts {
  readonly reason: ImageRequestReason;
  /**
   * The files the Author supplied, for a drop or a paste. Empty otherwise.
   *
   * Files do not imply an upload: a Consumer whose images already live in a
   * digital asset manager may hand these to a gallery's upload tab, or ignore
   * them entirely.
   */
  readonly files: readonly File[];
  readonly placement: ImagePlacement;
}

/**
 * The library's ask for an Asset.
 *
 * One request covers every route an image arrives by, so a Consumer has one
 * place to make policy decisions. It says why it was raised and carries
 * whatever files were involved — enough to open a gallery for one reason and
 * upload straight away for another.
 */
export interface ImageRequest extends ImageRequestFacts {
  /**
   * Report how far along the resolution is, from 0 to 1.
   *
   * Optional — a Consumer with no number to report simply never calls it, and
   * the pending Chrome shows no percentage.
   */
  onProgress(fraction: number): void;
  /**
   * Aborted when the Author cancels, and when the place the image was going
   * leaves the Document. Respect it and slow work stops when it stops
   * mattering.
   */
  readonly signal: AbortSignal;
}

/**
 * What the Consumer does when the library needs an image.
 *
 * Resolve with an Asset to place it, or with `undefined` to signal that the
 * Author cancelled — dismissing a dialog must leave the Document untouched.
 * Reject to signal failure; the Author is offered a retry.
 */
export type ImageResolver = (
  request: ImageRequest,
) => Promise<Asset | undefined>;

/** What every reported request carries, pending or failed. */
interface ImageRequestFields extends ImageRequestFacts {
  readonly id: string;
  /**
   * Drop the request. Aborts the resolution, produces no Op, and so leaves no
   * undo entry.
   */
  readonly cancel: () => void;
}

/** A resolution the library is waiting on. */
export interface PendingImage extends ImageRequestFields {
  readonly status: "pending";
  /** How far along, from 0 to 1, when the Consumer reports it. */
  readonly progress?: number;
}

/** A resolution that was rejected, and can be asked for again. */
export interface FailedImage extends ImageRequestFields {
  readonly status: "failed";
  /** Whatever the resolver rejected with. */
  readonly error: unknown;
  /** Ask again, with the same request. */
  readonly retry: () => void;
}

/**
 * An outstanding image resolution.
 *
 * Chrome, not content: none of it is in the Document, which is what makes a
 * Document safe to persist at any moment during an upload.
 */
export type ImageRequestState = PendingImage | FailedImage;

export interface ImageRequestsSetup {
  readonly resolve: ImageResolver;
  readonly createId: () => string;
  /** Put a resolved Asset into the Document. Returns whether it landed. */
  place(placement: ImagePlacement, asset: Asset, reveal: boolean): boolean;
  /** Tell the world that the reported requests changed. */
  announce(): void;
  /**
   * Run several changes as the one action they are.
   *
   * An Asset arriving is one thing an Author did, however many pieces it takes
   * to carry out: the request leaves the list, a Block appears, and it becomes
   * the selected one.
   */
  asOneAction<TResult>(act: () => TResult): TResult;
}

/** The outstanding image resolutions, and their lifecycle. */
export interface ImageRequests {
  list(): readonly ImageRequestState[];
  /**
   * Hold a request until the Consumer answers it.
   *
   * `reveal` says whether the Block should be brought into view when it
   * finally lands — decided when the request is raised, because by the time an
   * Asset arrives the gesture that asked for it is long over.
   */
  start(request: ImageRequestFacts, reveal: boolean): void;
  /**
   * Abandon any request whose place in the Document has gone — the Block it
   * was replacing deleted, the container it was landing in undone.
   *
   * Announces nothing itself: the Document change that caused it is about to.
   */
  prune(exists: (blockId: string) => boolean): void;
}

/** No outstanding requests, and no files: shared so identity is stable. */
export const NO_IMAGE_REQUESTS: readonly ImageRequestState[] = [];
export const NO_FILES: readonly File[] = [];

/** One outstanding request, and the state of the attempt behind it. */
interface Entry extends ImageRequestFacts {
  readonly id: string;
  /** Whether the Block is brought into view when the Asset finally lands. */
  readonly reveal: boolean;
  controller: AbortController;
  /** Bumped per attempt, so a reply from an abandoned one is ignored. */
  attempt: number;
  progress: number | undefined;
  /** Boxed, so that rejecting with `undefined` is still a failure. */
  failure: { readonly error: unknown } | undefined;
}

/**
 * The pending-image state machine.
 *
 * Nothing here writes to the Document except through `place`, and that happens
 * exactly once, when an Asset has arrived. Cancellation and failure touch it
 * not at all.
 */
export function createImageRequests(setup: ImageRequestsSetup): ImageRequests {
  const entries: Entry[] = [];
  let snapshot: readonly ImageRequestState[] = NO_IMAGE_REQUESTS;

  function forget(entry: Entry): void {
    const at = entries.indexOf(entry);
    if (at !== -1) entries.splice(at, 1);
  }

  /** Stop the work and drop the request. The Document is never touched. */
  function abandon(entry: Entry): void {
    if (!entries.includes(entry)) return;
    // Bumped before aborting, so the reply the abort provokes is ignored.
    entry.attempt += 1;
    entry.controller.abort();
    forget(entry);
  }

  function stateOf(entry: Entry): ImageRequestState {
    const fields = {
      id: entry.id,
      reason: entry.reason,
      files: entry.files,
      placement: entry.placement,
      cancel: () => {
        if (!entries.includes(entry)) return;
        abandon(entry);
        restate();
        setup.announce();
      },
    };

    if (entry.failure) {
      return {
        ...fields,
        status: "failed",
        error: entry.failure.error,
        retry: () => {
          if (!entries.includes(entry)) return;
          attempt(entry);
          restate();
          setup.announce();
        },
      };
    }
    return {
      ...fields,
      status: "pending",
      ...(entry.progress === undefined ? {} : { progress: entry.progress }),
    };
  }

  /** A fresh snapshot, so a subscriber can tell one list from the next. */
  function restate(): void {
    snapshot = entries.length === 0 ? NO_IMAGE_REQUESTS : entries.map(stateOf);
  }

  /** Ask the Consumer, and hold the request until they answer. */
  function attempt(entry: Entry): void {
    entry.attempt += 1;
    entry.controller = new AbortController();
    entry.progress = undefined;
    entry.failure = undefined;

    const generation = entry.attempt;
    const live = (): boolean =>
      entry.attempt === generation && entries.includes(entry);

    const request: ImageRequest = {
      reason: entry.reason,
      files: entry.files,
      placement: entry.placement,
      onProgress: (fraction) => {
        if (!live() || entry.failure) return;
        entry.progress = Math.min(Math.max(fraction, 0), 1);
        restate();
        setup.announce();
      },
      signal: entry.controller.signal,
    };

    const settle = (asset: Asset | undefined): void => {
      if (!live()) return;
      setup.asOneAction(() => {
        // Out of the list before the Document changes, so a subscriber woken
        // by the insertion never sees the request that caused it still
        // pending. No Asset means the Author cancelled, and this is where it
        // ends: no Op, and so no undo entry either.
        forget(entry);
        restate();

        // The last-moment race: the position went between the Document change
        // that would have pruned this request and the Asset arriving.
        if (asset && !setup.place(entry.placement, asset, entry.reveal)) {
          entries.push(entry);
          entry.failure = {
            error: new Error("The image had nowhere left to go."),
          };
          restate();
        }
        setup.announce();
      });
    };

    const reject = (error: unknown): void => {
      if (!live()) return;
      entry.failure = { error };
      restate();
      setup.announce();
    };

    // A resolver that throws where it should have rejected is treated the same
    // way; either is a failure the Author can retry.
    try {
      setup.resolve(request).then(settle, reject);
    } catch (error) {
      reject(error);
    }
  }

  return {
    list: () => snapshot,

    start(request, reveal) {
      const entry: Entry = {
        id: setup.createId(),
        reason: request.reason,
        files: request.files,
        placement: request.placement,
        reveal,
        controller: new AbortController(),
        attempt: 0,
        progress: undefined,
        failure: undefined,
      };
      entries.push(entry);
      attempt(entry);
      restate();
      setup.announce();
    },

    prune(exists) {
      const stranded = entries.filter((entry) =>
        entry.placement.kind === "replace"
          ? !exists(entry.placement.blockId)
          : !exists(entry.placement.target.parentId),
      );
      if (stranded.length === 0) return;
      for (const entry of stranded) abandon(entry);
      restate();
    },
  };
}
