/**
 * How a container divides itself between the children it owns.
 *
 * Arithmetic over plain numbers, with no Block in sight, for the same reason
 * Drop Target resolution is: the rules are the part worth pinning, and a pure
 * function is the only shape a test can pin them in without standing up a
 * Document first.
 *
 * Every function here preserves two invariants, and every caller depends on
 * both: the widths come to {@link TOTAL}, and none of them is below the floor.
 * Give it inputs holding neither and it will hand back inputs holding neither —
 * these keep a sum, they do not repair one.
 *
 * Integers throughout. Each rule moves a whole number between whole numbers, so
 * a row that arrives on integers stays on them however it is edited, and an
 * Author is never shown 33.333 in a box they are expected to type into.
 */

/** What the widths of one container's children come to. */
export const TOTAL = 100;

/** Whether these are widths the rules below can be run on. */
export function areBalanced(widths: readonly number[], floor: number): boolean {
  if (widths.length === 0) return false;
  if (widths.some((width) => width < floor)) return false;
  return widths.reduce((total, width) => total + width, 0) === TOTAL;
}

/**
 * An even split, with whatever does not divide going to the first.
 *
 * Three children are 34/33/33 rather than 33.333 each: the widths an Author is
 * shown are the widths they can type, and a third of a hundred is not one of
 * them. The odd point goes to the front because that is where the eye starts.
 */
export function widthsEvenly(count: number): readonly number[] {
  if (count <= 0) return [];
  const each = Math.floor(TOTAL / count);
  return Array.from({ length: count }, (_, at) =>
    at === 0 ? TOTAL - each * (count - 1) : each,
  );
}

/**
 * Widths the rules can be run on: the ones given, or an even split.
 *
 * The one place a container that does not add up is dealt with, and it deals
 * with it by evening the container out rather than refusing to edit it
 * (ADR-0006). That covers a Document written by hand, one from a Consumer's own
 * JSON, and one whose Definition changed its floor under stored values — none
 * of which an Author did, and none of which should leave them with a row they
 * cannot touch.
 */
export function usableWidths(
  widths: readonly number[],
  floor: number,
): readonly number[] {
  return areBalanced(widths, floor) ? widths : widthsEvenly(widths.length);
}

/**
 * The width that absorbs a change to the one at `index`.
 *
 * The next one along, because moving a width is moving the boundary between two
 * neighbours and an Author watching one edge move expects the other side of it
 * to be what gives. The last child has no next, so it trades with the one
 * before it — its only neighbour.
 *
 * Undefined for a lone child, which divides nothing and has nobody to trade
 * with.
 */
function neighbourOf(count: number, index: number): number | undefined {
  if (count < 2 || index < 0 || index >= count) return undefined;
  return index + 1 < count ? index + 1 : index - 1;
}

/**
 * The largest the width at `index` may be set to.
 *
 * Its own width plus everything its neighbour can spare, because the neighbour
 * absorbs the change alone. That makes the ceiling tighter than the obvious
 * one: three children at 33 each cannot take the first past 56, however much
 * room the third is sitting on. Widening further means editing the neighbour
 * down first, which is the cost of trading locally rather than spreading a
 * change across children an Author did not touch.
 */
export function widthCeiling(
  widths: readonly number[],
  index: number,
  floor: number,
): number {
  const neighbour = neighbourOf(widths.length, index);
  if (neighbour === undefined) return TOTAL;
  return (widths[index] ?? 0) + ((widths[neighbour] ?? 0) - floor);
}

/**
 * The widths after the one at `index` is set, with its neighbour absorbing it.
 *
 * Clamped between the floor and {@link widthCeiling}, so a value the row cannot
 * take is taken as far as it goes rather than refused outright: a slider
 * dragged to the end should stop somewhere sensible, not snap back.
 *
 * Returns the widths unchanged when nothing would move, which is what stops an
 * Op — and an undo entry — being recorded for a set that changed nothing.
 */
export function widthsAfterSet(
  widths: readonly number[],
  index: number,
  value: number,
  floor: number,
): readonly number[] {
  const neighbour = neighbourOf(widths.length, index);
  if (neighbour === undefined) return widths;

  const current = widths[index] ?? 0;
  const wanted = Math.round(
    Math.min(Math.max(value, floor), widthCeiling(widths, index, floor)),
  );
  const change = wanted - current;
  if (change === 0) return widths;

  const next = [...widths];
  next[index] = wanted;
  next[neighbour] = (widths[neighbour] ?? 0) - change;
  return next;
}

/**
 * The widths after a child arrives at `index` holding the floor.
 *
 * Paid for by the nearest child with room, scanning back from the end — and by
 * the one before that when the first cannot cover it alone. Children already on
 * the floor are passed over, having nothing to give.
 *
 * Backwards rather than proportionally, so the widths an Author set at the
 * front of a row survive being added to: the leading child is the one carrying
 * the design, and the ones nearest the end are the ones most recently added.
 *
 * It cannot run out. A container's ceiling times the floor is well under
 * {@link TOTAL} for any sane pair — six children at ten leaves forty spare — so
 * there is always slack somewhere behind the new arrival.
 */
export function widthsAfterInsert(
  widths: readonly number[],
  index: number,
  floor: number,
): readonly number[] {
  if (widths.length === 0) return [TOTAL];

  const next = [...widths];
  let owed = floor;
  for (let at = next.length - 1; at >= 0 && owed > 0; at -= 1) {
    const paid = Math.min((next[at] ?? 0) - floor, owed);
    next[at] = (next[at] ?? 0) - paid;
    owed -= paid;
  }

  // `owed` is zero in every reachable case. Subtracting it anyway keeps the sum
  // true rather than trusting an argument about reachability.
  next.splice(index, 0, floor - owed);
  return next;
}

/**
 * The widths after the child at `index` goes, handing its width to a neighbour.
 *
 * The child that takes its place, or the one before it when it was last. The
 * same trade a set makes, run in reverse, so removing a child an Author has
 * just added leaves the row as it was before they added it.
 */
export function widthsAfterRemove(
  widths: readonly number[],
  index: number,
): readonly number[] {
  if (index < 0 || index >= widths.length) return widths;

  const next = [...widths];
  const [gone = 0] = next.splice(index, 1);
  if (next.length === 0) return next;

  const neighbour = index < next.length ? index : next.length - 1;
  next[neighbour] = (next[neighbour] ?? 0) + gone;
  return next;
}
