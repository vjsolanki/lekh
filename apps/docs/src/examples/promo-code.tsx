import { defineBlock } from "lekh-editor";

// A type alias rather than an interface: an interface has no implicit index
// signature, so it does not satisfy the `Record<string, unknown>` constraint.
type PromoCodeProps = {
  code: string;
  offer: string;
  color: string;
  radius: number;
};

/**
 * A discount code, set as a dashed ticket.
 *
 * Four props, each one a control in your Inspector. The markup is a table with
 * inline styles, because that is what every inbox can draw.
 */
export const promoCode = defineBlock<PromoCodeProps>({
  type: "promo-code",
  label: "Promo code",
  schema: {
    code: { kind: "text", label: "Code", defaultValue: "SPRING25" },
    offer: { kind: "text", label: "Offer", defaultValue: "25% off" },
    color: { kind: "color", label: "Color", defaultValue: "#6d28d9" },
    radius: { kind: "number", label: "Corners", defaultValue: 12 },
  },
  render: ({ props }) => (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{
        maxWidth: 420,
        backgroundColor: "#ffffff",
        borderRadius: props.radius,
        borderTop: `6px solid ${props.color}`,
      }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            style={{
              padding: "24px 24px 8px",
              fontFamily: "Helvetica, Arial, sans-serif",
              fontSize: 15,
              color: "#46423d",
            }}
          >
            {props.offer} your next order
          </td>
        </tr>
        <tr>
          <td align="center" style={{ padding: "4px 24px 26px" }}>
            <span
              style={{
                display: "inline-block",
                padding: "10px 18px",
                border: `2px dashed ${props.color}`,
                borderRadius: Math.max(0, props.radius - 4),
                fontFamily: "Menlo, Consolas, monospace",
                fontSize: 22,
                letterSpacing: 3,
                color: props.color,
              }}
            >
              {props.code}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  ),
});
