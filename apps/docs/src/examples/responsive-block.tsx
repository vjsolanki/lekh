import { classNames, defineBlock, MobileStyles } from "lekh";

/** A column that stacks and can be hidden — both ordinary boolean props. */
export const column = defineBlock<{
  stackOnMobile: boolean;
  hideOnMobile: boolean;
  fontSize: number;
}>({
  type: "column",
  label: "Column",
  accepts: ["text", "image"],
  schema: {
    stackOnMobile: {
      kind: "boolean",
      label: "Stack on mobile",
      defaultValue: true,
    },
    hideOnMobile: {
      kind: "boolean",
      label: "Hide on mobile",
      defaultValue: false,
    },
    // Declaring `mobile` is what lets this prop have a phone-only value.
    // The library adds the !important each rule needs.
    fontSize: {
      kind: "number",
      label: "Font size",
      defaultValue: 16,
      mobile: (size) => ({ "font-size": `${size}px` }),
    },
  },

  render: ({ props, children, mobile }) => (
    <td
      // Only call `use` when you actually want the class — calling it is what
      // marks the rule as needed.
      className={classNames(
        props.stackOnMobile && mobile.use("stack"),
        props.hideOnMobile && mobile.use("hide"),
        // The class carrying this Block's phone-only values.
        mobile.className,
      )}
      style={{ fontSize: props.fontSize }}
    >
      {children}
    </td>
  ),
});

/** The root emits the one stylesheet, and nothing when none is needed. */
export const email = defineBlock<Record<string, never>>({
  type: "email",
  label: "Email",
  accepts: ["column"],
  schema: {},
  render: ({ children, mobile }) => (
    <html lang="en">
      <head>
        <MobileStyles css={mobile.stylesheet()} />
      </head>
      <body>
        <table role="presentation">
          <tbody>
            <tr>{children}</tr>
          </tbody>
        </table>
      </body>
    </html>
  ),
});
