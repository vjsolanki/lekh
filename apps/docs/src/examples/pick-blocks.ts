import { createEditor } from "lekh";
import {
  buttonBlock,
  imageBlock,
  pickReactEmailPreset,
  REACT_EMAIL_ROOT_TYPE,
  textBlock,
} from "lekh/blocks";

// Only these three, plus `email` and `section`, reach your bundle.
const definitions = pickReactEmailPreset([textBlock, imageBlock, buttonBlock], {
  fontFamily: "Inter, sans-serif",
});

export const editor = createEditor({
  definitions,
  rootType: REACT_EMAIL_ROOT_TYPE,
});
