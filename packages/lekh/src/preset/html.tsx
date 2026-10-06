import { defineBlock, SchemaKind } from "../core/document/definition";
import { htmlScopeOf } from "../core/markup/html";
import { presetBlock } from "./block";
import { leafShell } from "./leaf";
import { BLOCK_TYPE } from "./names";
import { leafSchema, type PaddingProps } from "./schema";

/**
 * Markup the Author wrote by hand (ADR-0028).
 *
 * `render` receives it already cleaned, with every `<style>` rule scoped to
 * the class this Block's cell carries. The shell's cell is the whole Block:
 * padding, the Mobile Override class and the scope all sit on it, and the
 * markup goes inside as written, structure and all. Nothing is drawn round it,
 * so the Author's markup is the only look it has.
 *
 * Markup that cleans down to nothing renders nothing, and the Canvas gives it
 * its stand-in.
 */
function htmlDefinition() {
  return defineBlock<{ html: string; showOn: string } & PaddingProps>({
    type: BLOCK_TYPE.html,
    label: "HTML",
    schema: {
      html: { kind: SchemaKind.html, label: "HTML", defaultValue: "" },
      ...leafSchema(),
    },
    render: ({ block, props, mobile }) => {
      if (props.html === "") return null;
      return leafShell(props, mobile, {
        className: htmlScopeOf(block.id),
        html: props.html,
      });
    },
  });
}

/** The HTML Block, for `pickReactEmailPreset`. */
export const htmlBlock = presetBlock(BLOCK_TYPE.html, () => [htmlDefinition()]);
