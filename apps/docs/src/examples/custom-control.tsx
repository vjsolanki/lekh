import { defineBlock, type ControlDescriptor } from "lekh";

/**
 * A kind the library has never heard of.
 *
 * `kind` is an open string. Declare whatever you like and handle it in your
 * own inspector — the library passes `constraints` straight through untouched.
 */
export const spacer = defineBlock<{ height: number }>({
  type: "spacer",
  label: "Spacer",
  schema: {
    height: {
      kind: "step-slider",
      label: "Height",
      defaultValue: 24,
      constraints: { steps: [8, 16, 24, 40, 64], unit: "px" },
    },
  },
  render: ({ props }) => <div style={{ height: props.height }} />,
});

/** Your inspector's case for it. */
export function StepSlider({ control }: { control: ControlDescriptor }) {
  const steps = readSteps(control.constraints);
  const current = typeof control.value === "number" ? control.value : steps[0];

  return (
    <fieldset>
      <legend>{control.label}</legend>
      {steps.map((step) => (
        <button
          key={step}
          type="button"
          aria-pressed={step === current}
          onClick={() => {
            control.set(step);
          }}
        >
          {step}
        </button>
      ))}
    </fieldset>
  );
}

/** Constraints arrive as `unknown`, because you put them there. */
function readSteps(
  constraints: ControlDescriptor["constraints"],
): readonly number[] {
  const steps = constraints?.["steps"];
  return Array.isArray(steps) && steps.every((s) => typeof s === "number")
    ? steps
    : [8, 16, 24];
}
