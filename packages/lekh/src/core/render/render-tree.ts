import {
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  richTextPropOf,
  textShapeOf,
  type BlockDefinition,
  type BlockRenderContext,
} from "../document/definition";
import type { Block } from "../document/document";
import { renderProps } from "../document/props";
import { TextShapeProvider } from "./rich-text";
import { collectMobileRules, mobileRenderContext } from "../layout/responsive";
import type { MobileRules, MobileStructure } from "../layout/responsive";
import { childrenOf } from "../document/tree";

/**
 * What a Block rendered to, and what it put in the mobile stylesheet on the
 * way there.
 *
 * Both halves, because a Block's render is not only its markup: a Definition
 * asks for structural rules and contributes bespoke ones as it renders
 * (ADR-0012), and the root reads the finished stylesheet. Handing back the
 * markup without the rules would drop a Block's mobile behaviour the first
 * time it was reused.
 */
export interface RenderedBlock {
  readonly node: ReactNode;
  readonly structures: readonly MobileStructure[];
  readonly bespoke: readonly string[];
  /** Whether the subtree asked for the mobile-only reveal rule. */
  readonly revealed: boolean;
}

/**
 * Somewhere to keep what a Block rendered to, so an unchanged Block is not
 * rendered again.
 *
 * Keyed on the Block itself, which is exactly the right key: the Document is
 * applied with structural sharing, so a Block that did not change *is* the same
 * object, and one that did is a different one.
 *
 * Returning the identical node is what makes this worth doing. React compares
 * elements by reference and skips a subtree whose element it has already
 * rendered, so a cache hit costs nothing further down — no Definition runs, no
 * children reconcile.
 *
 * A caller that leaves it out renders everything, every time. The render path
 * does exactly that: it emits an email once and stops, so there is no second
 * pass for a cache to save.
 *
 * One thing a reused Block cannot carry with it is `stylesheet()`, which reads
 * the collection as it stands and is therefore only meaningful to the Block
 * that renders last. That is the root, and the root is a new object whenever
 * anything below it changed — so the Block that reads the stylesheet is never
 * the Block that skipped its render.
 */
export type RenderCache = WeakMap<Block, RenderedBlock>;

/** What one Block's subtree asked the stylesheet for. */
interface Contribution {
  structures: MobileStructure[];
  bespoke: string[];
  revealed: boolean;
}

const emptyContribution = (): Contribution => ({
  structures: [],
  bespoke: [],
  revealed: false,
});

/**
 * The stylesheet accumulator, wrapped so that each Block's contribution to it
 * can be recorded and, later, replayed on its behalf.
 *
 * A frame is open per Block being rendered, and a contribution goes into every
 * open frame rather than only the innermost — so a Block's record covers
 * everything its whole subtree asked for, which is what a cache hit has to
 * replay when the subtree does not render.
 */
interface Recorder {
  /** What a Block Definition is handed. */
  readonly rules: MobileRules;
  open(): void;
  close(): Contribution;
  /** Contribute what a cached Block asked for the last time it rendered. */
  replay(cached: RenderedBlock): void;
}

function createRecorder(mobile: MobileRules): Recorder {
  const frames: Contribution[] = [];

  const rules: MobileRules = {
    classOf: (blockId) => mobile.classOf(blockId),

    use: (...names) => {
      for (const frame of frames) frame.structures.push(...names);
      return mobile.use(...names);
    },

    add: (css) => {
      for (const frame of frames) frame.bespoke.push(css);
      mobile.add(css);
    },

    reveal: () => {
      for (const frame of frames) frame.revealed = true;
      return mobile.reveal();
    },

    stylesheet: () => mobile.stylesheet(),
  };

  return {
    rules,

    open: () => {
      frames.push(emptyContribution());
    },

    close: () => frames.pop() ?? emptyContribution(),

    replay: (cached) => {
      // Through `rules` rather than `mobile`, so an ancestor whose own frame is
      // open records what its cached child asked for as though it had rendered.
      if (cached.structures.length > 0) rules.use(...cached.structures);
      for (const css of cached.bespoke) rules.add(css);
      if (cached.revealed) rules.reveal();
    },
  };
}

/**
 * What one caller of the recursion decides for itself.
 *
 * Everything the two callers share — the recursion, child keying, prop
 * resolution and the Mobile Override collection — is the recursion's. Two things
 * are left, and they are left for different reasons.
 *
 * `unregistered` is the difference ADR-0006 draws: the render path refuses a
 * Block nobody registered, and the Canvas stands in for it so an Author can
 * still see, move and delete something the editor does not understand.
 *
 * `decorate` is not that difference. It is where the Canvas marks what it drew
 * so the tree can be measured and selected, and hands a Block's rich text to the
 * Text Engine (ADR-0005) — neither of which the render path has any use for,
 * because it emits the markup a mail client will get and stops.
 *
 * `standIn` is the same kind of thing as `decorate`: the Canvas has to keep every
 * Block hittable, and the render path has to emit the email as written.
 */
export interface RenderPolicy {
  /** Find a Block's Definition. */
  lookup(type: string): BlockDefinition | undefined;
  /**
   * What an unregistered Block becomes. Handed its already-rendered children,
   * because a stand-in has to keep them; a policy that refuses throws here.
   */
  unregistered(block: Block, children: readonly ReactNode[]): ReactNode;
  /**
   * A last pass over what a Definition rendered — the Canvas marks the element
   * with its Block's id and makes rich text editable. The render path wants the
   * markup a mail client will get, so it supplies nothing.
   */
  decorate?(
    element: ReactElement,
    block: Block,
    definition: BlockDefinition,
  ): ReactNode;
  /**
   * Something with a box, for a Block that would otherwise have none.
   *
   * Asked in the two ways a Block comes to nothing: a container with no
   * children, where the result is handed to the Definition as its only child so
   * that it lands wherever that Definition puts children; and a Definition whose
   * `render` returned `null`, where it becomes the Block's own element.
   *
   * Only the second passes through `decorate`, which is what marks an element
   * with its Block's id — and is exactly right both times. A substitute stands
   * in for the Block and has to be measurable in its place. A container's filler
   * must not be, or Drop Target resolution would read it as a measured child and
   * stop resolving the container as empty.
   *
   * The render path supplies none, so it emits the email as written: a Block
   * that renders to nothing renders to nothing.
   *
   * `own` is the Definition's own stand-in, when it has one and `render`
   * returned `null`. Never for a container's filler.
   */
  standIn?(
    block: Block,
    definition: BlockDefinition,
    own?: ReactElement,
  ): ReactElement;
  /**
   * The wrapper `mobile.only` builds round what a Block rendered, given the
   * class the reveal rule is emitted under (ADR-0025).
   *
   * The same kind of difference as `decorate`. The render path keeps the
   * markup from Outlook on the desktop with a conditional comment, which means
   * turning it into a string. The Canvas cannot have a string: it has to
   * measure, select and edit what is inside.
   *
   * Required rather than defaulted, because the render path's version needs
   * `react-dom/server`, and a default here would put it in the editor's bundle.
   */
  mobileOnly(element: ReactElement, className: string): ReactElement;
  /**
   * What `outlook` does with an element and its two halves.
   *
   * The same difference as `mobileOnly`, and required for the same reason. The
   * render path turns the contents into a string between conditional comments.
   * The Canvas hands the element back, because it is never Outlook and has to
   * keep what is inside live.
   */
  outlook(
    element: ReactElement,
    open: string,
    close: string,
    between?: readonly string[],
  ): ReactElement;
  /**
   * Where to keep what each Block rendered to, so that an unchanged Block is
   * handed back rather than rendered again.
   *
   * The Canvas supplies one and drops it whenever something outside a Block
   * changes what that Block would render to. The render path supplies none.
   */
  cache?: RenderCache;
}

/**
 * Render a Block tree.
 *
 * Two passes: the Mobile Override rules follow from the Document alone and are
 * worked out first, so every Block knows its class before it renders; the
 * structural rules a Definition asks for arrive during the render itself. A
 * Block renders before its parent, so the root — which renders last — is handed
 * the finished stylesheet to put in its head.
 *
 * The rules are collected here rather than passed in, so the tree they describe
 * and the tree that renders are the same tree by construction.
 *
 * The Block handed over is the root, and two things depend on it: the stylesheet
 * is collected from it, and its props are what every Block below reads as the
 * email's (ADR-0017). Rendering a subtree through here would hand that subtree's
 * props to its children under the name of the email's.
 */
export function renderTree(root: Block, policy: RenderPolicy): ReactNode {
  const definition = policy.lookup(root.type);
  // Resolved once, here, rather than read off the Block: a Block that renders
  // against the email's width has to see the same number the root rendered
  // against, defaults included. The Mobile Overrides resolve against the same
  // props, so an override of `start` lands on the side the inline value did.
  // The root follows nothing: it is what everything else follows.
  const rootProps = definition ? renderProps(root, definition, {}) : {};
  return renderNode(
    root,
    createRecorder(
      collectMobileRules(root, (type) => policy.lookup(type), rootProps),
    ),
    policy,
    rootProps,
  );
}

function renderNode(
  block: Block,
  recorder: Recorder,
  policy: RenderPolicy,
  rootProps: Readonly<Record<string, unknown>>,
): ReactNode {
  const cached = policy.cache?.get(block);
  if (cached) {
    // The markup is only half of what this Block did. Its rules go back into
    // the stylesheet as though it had rendered, because from here the finished
    // stylesheet cannot tell the difference — and the root, which reads it,
    // must not be able to either.
    recorder.replay(cached);
    return cached.node;
  }

  recorder.open();
  const node = drawNode(block, recorder, policy, rootProps);
  const contribution = recorder.close();
  policy.cache?.set(block, { node, ...contribution });
  return node;
}

function drawNode(
  block: Block,
  recorder: Recorder,
  policy: RenderPolicy,
  rootProps: Readonly<Record<string, unknown>>,
): ReactNode {
  const mobile = recorder.rules;

  // Children first, because a stand-in for an unregistered Block needs them and
  // a Definition is handed them already rendered.
  const children: ReactNode[] = childrenOf(block).map((child) =>
    createElement(
      Fragment,
      { key: child.id },
      renderNode(child, recorder, policy, rootProps),
    ),
  );

  const definition = policy.lookup(block.type);
  if (!definition) return policy.unregistered(block, children);

  // A container is the only thing that can be empty in the sense that matters:
  // `childrenOf` returns nothing for a leaf too, and `accepts` is what tells the
  // two apart — the same test Drop Target resolution uses to mean "container".
  const empty = children.length === 0 && definition.accepts !== undefined;

  const only = (element: ReactElement): ReactElement =>
    // Inside the text shape, because the render path stringifies the element
    // here, before the shape below is wrapped round it.
    policy.mobileOnly(withTextShape(definition, element), mobile.reveal());

  const context: BlockRenderContext<Record<string, unknown>> = {
    block,
    // The desktop values, always: mobile is a stylesheet over this same markup.
    props: renderProps(block, definition, rootProps),
    children:
      empty && policy.standIn
        ? [
            createElement(
              Fragment,
              { key: "stand-in" },
              policy.standIn(block, definition),
            ),
          ]
        : children,
    mobile: mobileRenderContext(mobile, block.id, only),
    rootProps,
    outlook: (element, open, close, between) =>
      policy.outlook(element, open, close, between),
  };
  const rendered = definition.render(context);

  // The Definition's own stand-in is asked for only where a policy draws one,
  // so the render path never builds it.
  const element =
    rendered ??
    policy.standIn?.(block, definition, definition.standIn?.(context)) ??
    null;
  if (element === null) return null;

  return withTextShape(
    definition,
    policy.decorate?.(element, block, definition) ?? element,
  );
}

/**
 * A Block's markup inside the shape its text may hold.
 *
 * Every Block with rich text says what its text may hold, even when that is
 * nothing more than a line: a Block's children render inside it, and must not
 * read a parent's paragraphs as their own.
 */
function withTextShape<TNode extends ReactNode>(
  definition: BlockDefinition,
  node: TNode,
): TNode | ReactElement {
  return richTextPropOf(definition) === undefined
    ? node
    : createElement(
        TextShapeProvider,
        { value: textShapeOf(definition) },
        node,
      );
}
