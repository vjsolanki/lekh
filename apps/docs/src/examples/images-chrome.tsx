import type { FailedImageProps, PendingImageProps } from "lekh/canvas";

const box = ({ rect }: PendingImageProps | FailedImageProps) => ({
  position: "absolute" as const,
  top: rect.top,
  left: rect.left,
  width: rect.width,
  height: rect.height,
  pointerEvents: "auto" as const,
});

export function PendingImage(props: PendingImageProps) {
  const { pending } = props;
  const percent =
    pending.progress === undefined
      ? undefined
      : Math.round(pending.progress * 100);

  return (
    <div style={box(props)}>
      <span>{percent === undefined ? "Adding image…" : `${percent}%`}</span>
      <button type="button" onClick={pending.cancel}>
        Cancel
      </button>
    </div>
  );
}

export function FailedImage(props: FailedImageProps) {
  const { failure } = props;

  return (
    <div style={box(props)}>
      <span>That image did not load.</span>
      <button type="button" onClick={failure.retry}>
        Try again
      </button>
      <button type="button" onClick={failure.cancel}>
        Remove
      </button>
    </div>
  );
}
