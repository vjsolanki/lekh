/**
 * The page's pictures: the editor drawn flat, at the moment each feature is
 * about. Inline SVG so the page's colours and fonts reach inside. Every word
 * in them is real copy, so a picture reads on its own.
 */
import {
  createContext,
  useContext,
  useId,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import {
  ArrowUpIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  Bars3BottomLeftIcon,
  BoldIcon,
  CheckIcon,
  CursorArrowRaysIcon,
  DocumentDuplicateIcon,
  H1Icon,
  ItalicIcon,
  LinkIcon,
  MinusIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  RectangleGroupIcon,
  SparklesIcon,
  TicketIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/20/solid";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

// The id prefix of the picture being drawn, for its gradient and shadow.
const Ids = createContext("");

function Art({
  width,
  height,
  label,
  dark = false,
  dots = false,
  children,
}: {
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly dark?: boolean;
  /** A dotted canvas behind everything, like a design tool. */
  readonly dots?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const id = useId();
  return (
    <svg
      className="art"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <clipPath id={`${id}c`}>
          <rect width={width} height={height} rx={14} />
        </clipPath>
        <pattern
          id={`${id}d`}
          width={18}
          height={18}
          patternUnits="userSpaceOnUse"
        >
          <circle className="art-dot" cx={1.5} cy={1.5} r={1.1} />
        </pattern>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e3f3dd" />
          <stop offset="1" stopColor="#b5dfa9" />
        </linearGradient>
        <filter id={`${id}s`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow
            dx="0"
            dy="8"
            stdDeviation="10"
            floodColor="#10180c"
            floodOpacity="0.1"
          />
        </filter>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect
          className={dark ? "art-term" : "art-well"}
          width={width}
          height={height}
        />
        {dots ? (
          <rect width={width} height={height} fill={`url(#${id}d)`} />
        ) : null}
        <Ids.Provider value={id}>{children}</Ids.Provider>
      </g>
      <rect
        className="art-edge"
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={13.5}
      />
    </svg>
  );
}

function useShadow(): string {
  return `url(#${useContext(Ids)}s)`;
}

function Glyph({
  icon: I,
  x,
  y,
  size = 16,
  className,
}: {
  readonly icon: Icon;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
  readonly className: string;
}): ReactNode {
  return <I x={x} y={y} width={size} height={size} className={className} />;
}

/** A white floating card, the way panels sit over the canvas. */
function Card({
  x,
  y,
  w,
  h,
}: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}): ReactNode {
  return (
    <rect
      className="art-card"
      x={x}
      y={y}
      width={w}
      height={h}
      rx={14}
      filter={useShadow()}
    />
  );
}

function ShopButton({
  x,
  y,
  small = false,
}: {
  readonly x: number;
  readonly y: number;
  readonly small?: boolean;
}): ReactNode {
  const w = small ? 98 : 132;
  const h = small ? 28 : 40;
  return (
    <>
      <rect
        className="art-fern"
        x={x}
        y={y}
        width={w}
        height={h}
        rx={small ? 5 : 7}
      />
      <text
        className={small ? "art-xs art-on-ink" : "art-t art-on-ink art-b"}
        x={x + w / 2}
        y={y + h / 2 + 4.5}
        textAnchor="middle"
      >
        Shop the sale
      </text>
    </>
  );
}

/** The suggestion: a new line drawn dashed, waiting for an answer. */
function Suggested({
  x,
  y,
  w,
  small = false,
}: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly small?: boolean;
}): ReactNode {
  return (
    <>
      <rect
        className="art-sugg"
        x={x}
        y={y}
        width={w}
        height={small ? 26 : 34}
        rx={4}
      />
      <text
        className={small ? "art-s2" : "art-t"}
        x={x + 12}
        y={y + (small ? 17 : 22)}
      >
        Free shipping on orders over £50.
      </text>
    </>
  );
}

function Pill({
  x,
  y,
  w,
  label,
  primary = false,
  check = false,
}: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly label: string;
  readonly primary?: boolean;
  readonly check?: boolean;
}): ReactNode {
  return (
    <>
      <rect
        className={primary ? "art-go" : "art-pill"}
        x={x}
        y={y}
        width={w}
        height={28}
        rx={14}
      />
      {check ? (
        <Glyph
          icon={CheckIcon}
          x={x + 12}
          y={y + 7}
          size={14}
          className="art-i-solid"
        />
      ) : null}
      <text
        className={primary ? "art-s art-on-ink" : "art-s art-ink-t"}
        x={check ? x + 31 : x + w / 2}
        y={y + 18}
        textAnchor={check ? "start" : "middle"}
      >
        {label}
      </text>
    </>
  );
}

function Ticket({
  x,
  y,
  w,
}: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}): ReactNode {
  return (
    <>
      <rect className="art-paper" x={x} y={y} width={w} height={66} rx={10} />
      <rect className="art-clay" x={x} y={y} width={w} height={5} rx={2.5} />
      <text className="art-code" x={x + 20} y={y + 38}>
        SPRING20
      </text>
      <text className="art-xs" x={x + 20} y={y + 55}>
        20% off everything
      </text>
      <line
        className="art-perf"
        x1={x + w - 90}
        y1={y + 16}
        x2={x + w - 90}
        y2={y + 56}
      />
      <text className="art-xs" x={x + w - 45} y={y + 41} textAnchor="middle">
        One week
      </text>
    </>
  );
}

function Field({
  x,
  y,
  label,
  value,
  width,
  mono = false,
}: {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly value: string;
  readonly width: number;
  readonly mono?: boolean;
}): ReactNode {
  return (
    <>
      <text className="art-xs" x={x} y={y}>
        {label}
      </text>
      <rect
        className="art-input"
        x={x}
        y={y + 8}
        width={width}
        height={30}
        rx={8}
      />
      <text className={mono ? "art-mono" : "art-t"} x={x + 11} y={y + 28}>
        {value}
      </text>
    </>
  );
}

// ===================================================================== hero

const LAYERS: readonly (readonly [Icon, string, number])[] = [
  [RectangleGroupIcon, "Sale", 0],
  [PhotoIcon, "Image", 1],
  [H1Icon, "Heading", 1],
  [Bars3BottomLeftIcon, "Text", 1],
  [CursorArrowRaysIcon, "Button", 1],
  [MinusIcon, "Divider", 1],
  [RectangleGroupIcon, "Footer", 0],
];

const DOCK: readonly (readonly [Icon, string, number])[] = [
  [H1Icon, "Heading", 78],
  [Bars3BottomLeftIcon, "Text", 58],
  [PhotoIcon, "Image", 64],
  [CursorArrowRaysIcon, "Button", 70],
];

function HeroEmail(): ReactNode {
  const id = useContext(Ids);
  return (
    <g className="art-mail">
      <rect
        className="art-paper"
        x={300}
        y={32}
        width={460}
        height={600}
        rx={3}
        filter={useShadow()}
      />
      <text className="art-brand" x={334} y={74}>
        Fernhill
      </text>
      <text className="art-xs" x={726} y={74} textAnchor="end">
        View in browser
      </text>
      <rect
        x={334}
        y={92}
        width={392}
        height={150}
        rx={8}
        fill={`url(#${id}g)`}
      />
      <text className="art-hero-t" x={360} y={172}>
        Spring sale
      </text>
      <text className="art-hero-s" x={362} y={198}>
        Every plant and pot, one week only
      </text>
      <text className="art-h" x={334} y={284}>
        The spring sale starts Monday
      </text>
      <text className="art-body" x={334} y={310}>
        Every plant and pot is 20% off for one week.
      </text>
      <text className="art-body" x={334} y={330}>
        The ferns you liked are back in stock.
      </text>
      <ShopButton x={334} y={360} />
      <rect
        className="art-sel"
        x={328}
        y={354}
        width={404}
        height={52}
        rx={4}
      />
      <rect className="art-tag" x={328} y={336} width={50} height={18} rx={4} />
      <text className="art-tag-t" x={335} y={349}>
        Button
      </text>
      <rect className="art-ink" x={664} y={328} width={68} height={26} rx={7} />
      <Glyph
        icon={DocumentDuplicateIcon}
        x={674}
        y={334}
        size={14}
        className="art-i-ink"
      />
      <Glyph icon={TrashIcon} x={704} y={334} size={14} className="art-i-ink" />
      <line className="art-rule" x1={334} y1={432} x2={726} y2={432} />
      <text className="art-xs" x={530} y={458} textAnchor="middle">
        You get this because you ordered from Fernhill.
      </text>
      <text className="art-xs art-u" x={530} y={478} textAnchor="middle">
        Unsubscribe
      </text>
      <text className="art-xs" x={530} y={496} textAnchor="middle">
        Fernhill Plants, 14 Mill Lane, Bristol
      </text>
    </g>
  );
}

export function HeroArt(): ReactNode {
  return (
    <Art
      width={1080}
      height={580}
      dots
      label="An email editor. The email sits in the middle with its button selected. Floating panels show the email's layers on the left, the button's settings on the right, and the blocks you can add along the bottom."
    >
      <HeroEmail />

      {/* Layers. */}
      <Card x={28} y={110} w={232} h={268} />
      <text className="art-title" x={48} y={142}>
        Layers
      </text>
      {LAYERS.map(([I, name, depth], i) => {
        const y = 160 + i * 30;
        const on = name === "Button";
        return (
          <g key={name}>
            {on ? (
              <rect
                className="art-row-on"
                x={40}
                y={y}
                width={208}
                height={26}
                rx={7}
              />
            ) : null}
            <Glyph
              icon={I}
              x={52 + depth * 18}
              y={y + 5}
              className={on ? "art-i-mark" : "art-i-muted"}
            />
            <text
              className={on ? "art-t art-mark-t art-b" : "art-t"}
              x={76 + depth * 18}
              y={y + 17}
            >
              {name}
            </text>
          </g>
        );
      })}

      {/* Settings. */}
      <Card x={812} y={110} w={240} h={300} />
      <text className="art-title" x={832} y={142}>
        Button
      </text>
      <Field x={832} y={172} label="Label" value="Shop the sale" width={200} />
      <Field
        x={832}
        y={234}
        label="Link"
        value="fernhill.shop/sale"
        width={200}
        mono
      />
      <text className="art-xs" x={832} y={298}>
        Color
      </text>
      {(["art-fern", "art-swatch-ink", "art-clay", "art-sky"] as const).map(
        (tone, i) => (
          <g key={tone}>
            {i === 0 ? (
              <circle className="art-ring" cx={845 + i * 34} cy={322} r={15} />
            ) : null}
            <circle className={tone} cx={845 + i * 34} cy={322} r={11} />
          </g>
        ),
      )}
      <text className="art-xs" x={832} y={366}>
        Corners
      </text>
      <rect
        className="art-track"
        x={832}
        y={380}
        width={200}
        height={4}
        rx={2}
      />
      <rect className="art-fill" x={832} y={380} width={56} height={4} rx={2} />
      <circle className="art-knob" cx={888} cy={382} r={8} />

      {/* Blocks to add. */}
      <Card x={262} y={510} w={556} h={48} />
      {(() => {
        let x = 282;
        const items = DOCK.map(([I, name, w]) => {
          const at = x;
          x += w + 10;
          return (
            <g key={name}>
              <Glyph icon={I} x={at} y={526} className="art-i-muted" />
              <text className="art-t" x={at + 22} y={539}>
                {name}
              </text>
            </g>
          );
        });
        return (
          <>
            {items}
            <rect
              className="art-fresh"
              x={x - 8}
              y={518}
              width={114}
              height={32}
              rx={9}
            />
            <Glyph icon={TicketIcon} x={x} y={526} className="art-i-mark" />
            <text className="art-t art-mark-t art-b" x={x + 22} y={539}>
              Promo code
            </text>
            <line
              className="art-rule"
              x1={x + 120}
              y1={524}
              x2={x + 120}
              y2={544}
            />
            <Glyph
              icon={ArrowUturnLeftIcon}
              x={x + 134}
              y={526}
              className="art-i-muted"
            />
            <Glyph
              icon={ArrowUturnRightIcon}
              x={x + 162}
              y={526}
              className="art-i-faint"
            />
          </>
        );
      })()}
    </Art>
  );
}

// ================================================================ features
// One picture per feature card, drawn at the size it shows.

const W = 520;
const H = 300;

/** The email's top, as most cards show it. */
function EmailTop({
  x,
  y,
}: {
  readonly x: number;
  readonly y: number;
}): ReactNode {
  return (
    <>
      <text className="art-h2" x={x} y={y}>
        The spring sale starts Monday
      </text>
      <text className="art-body" x={x} y={y + 24}>
        Every plant and pot is 20% off for one week.
      </text>
    </>
  );
}

export function SuggestArt(): ReactNode {
  return (
    <Art
      width={W}
      height={H}
      label="Someone types 'Add a note about free shipping'. The new line appears on the email, marked as suggested, with Accept and Reject under it."
    >
      <g className="art-mail">
        <rect
          className="art-paper"
          x={70}
          y={84}
          width={380}
          height={260}
          rx={3}
        />
        <EmailTop x={96} y={122} />
        <ShopButton x={96} y={162} small />
        <rect
          className="art-tag"
          x={90}
          y={204}
          width={68}
          height={18}
          rx={4}
        />
        <text className="art-tag-t" x={97} y={217}>
          Suggested
        </text>
        <Suggested x={90} y={222} w={340} />
        <Pill x={90} y={264} w={92} label="Accept" primary check />
        <Pill x={188} y={264} w={72} label="Reject" />
      </g>

      {/* What they asked. */}
      <Card x={40} y={20} w={440} h={46} />
      <Glyph icon={SparklesIcon} x={58} y={35} className="art-i-mark" />
      <text className="art-t art-ink-t" x={84} y={48}>
        Add a note about free shipping
      </text>
      <circle className="art-ink" cx={455} cy={43} r={14} />
      <Glyph
        icon={ArrowUpIcon}
        x={448}
        y={36}
        size={14}
        className="art-i-ink"
      />
    </Art>
  );
}

export function ChatAppArt(): ReactNode {
  return (
    <Art
      width={W}
      height={H}
      label="A chat app. Someone asks it to add a free shipping note to their sale email. Your editor opens inside the chat with the new line suggested and an Accept button."
    >
      <rect className="art-frame" width={W} height={H} />
      <circle className="art-dot-ui" cx={22} cy={20} r={5} />
      <circle className="art-dot-ui" cx={40} cy={20} r={5} />
      <circle className="art-dot-ui" cx={58} cy={20} r={5} />
      <text className="art-xs" x={260} y={24} textAnchor="middle">
        Claude, ChatGPT or any chat app
      </text>
      <line className="art-rule" x1={0} y1={40} x2={W} y2={40} />

      <rect
        className="art-ink"
        x={190}
        y={54}
        width={306}
        height={34}
        rx={14}
      />
      <text className="art-t art-on-ink" x={206} y={76}>
        Add a free shipping note to my sale email
      </text>

      <rect
        className="art-well"
        x={24}
        y={102}
        width={472}
        height={146}
        rx={12}
      />
      <rect
        className="art-edge"
        x={24.5}
        y={102.5}
        width={471}
        height={145}
        rx={11.5}
      />
      <text className="art-xs" x={40} y={124}>
        Your editor, inside the chat
      </text>
      <g className="art-mail">
        <rect className="art-paper" x={40} y={136} width={320} height={112} />
        <text className="art-h3" x={56} y={162}>
          The spring sale starts Monday
        </text>
        <ShopButton x={56} y={174} small />
        <Suggested x={50} y={212} w={300} small />
      </g>
      <Pill x={384} y={212} w={96} label="Accept" primary check />

      <rect
        className="art-input"
        x={24}
        y={260}
        width={472}
        height={28}
        rx={14}
      />
      <text className="art-xs" x={42} y={278}>
        Reply
      </text>
    </Art>
  );
}

export function ChecksArt(): ReactNode {
  return (
    <Art
      width={W}
      height={H}
      label="An email with its footer deleted, marked as a problem. Send is held back until the unsubscribe link is back."
    >
      <g className="art-mail">
        <rect
          className="art-paper"
          x={60}
          y={24}
          width={400}
          height={300}
          rx={3}
        />
        <EmailTop x={88} y={64} />
        <ShopButton x={88} y={104} small />
        <line className="art-rule" x1={88} y1={152} x2={432} y2={152} />
        <rect
          className="art-err"
          x={82}
          y={166}
          width={356}
          height={60}
          rx={6}
        />
        <Glyph icon={XCircleIcon} x={98} y={184} className="art-i-err" />
        <text className="art-t art-err-t art-b" x={122} y={192}>
          The footer was deleted
        </text>
        <text className="art-xs" x={122} y={211}>
          Every marketing email needs an unsubscribe link.
        </text>
      </g>
      <rect className="art-frame" x={0} y={248} width={W} height={52} />
      <line className="art-rule" x1={0} y1={248} x2={W} y2={248} />
      <Glyph icon={XCircleIcon} x={20} y={266} className="art-i-err" />
      <text className="art-t art-err-t art-b" x={44} y={279}>
        Can’t send yet: add the unsubscribe link.
      </text>
      <rect
        className="art-mute-btn"
        x={414}
        y={259}
        width={88}
        height={30}
        rx={15}
      />
      <Glyph
        icon={PaperAirplaneIcon}
        x={430}
        y={267}
        size={14}
        className="art-i-ink"
      />
      <text className="art-t art-on-ink" x={451} y={279}>
        Send
      </text>
    </Art>
  );
}

function Callout({
  x,
  y,
  to,
  title,
}: {
  readonly x: number;
  readonly y: number;
  readonly to: readonly [number, number];
  readonly title: string;
}): ReactNode {
  return (
    <>
      <polyline
        className="art-lead"
        points={`${String(x + 10)},${String(y - 4)} ${String(to[0])},${String(to[1])}`}
      />
      <circle className="art-lead-dot" cx={to[0]} cy={to[1]} r={3.5} />
      <text className="art-title" x={x} y={y} textAnchor="end">
        {title}
      </text>
    </>
  );
}

export function SlotsArt(): ReactNode {
  return (
    <Art
      width={W}
      height={H}
      label="The marks an editor draws on the email, each labelled as yours: the text toolbar, the selection outline and the drop line."
    >
      <g className="art-mail">
        <rect
          className="art-paper"
          x={196}
          y={20}
          width={300}
          height={300}
          rx={3}
        />
        <rect
          className="art-ink"
          x={218}
          y={34}
          width={100}
          height={28}
          rx={8}
        />
        <Glyph icon={BoldIcon} x={228} y={41} size={14} className="art-i-ink" />
        <Glyph
          icon={ItalicIcon}
          x={258}
          y={41}
          size={14}
          className="art-i-ink"
        />
        <Glyph icon={LinkIcon} x={288} y={41} size={14} className="art-i-ink" />
        <rect className="art-hl" x={216} y={72} width={76} height={18} rx={2} />
        <text className="art-body" x={218} y={85}>
          Every plant and pot is 20% off.
        </text>
        <rect
          className="art-tag"
          x={212}
          y={112}
          width={50}
          height={18}
          rx={4}
        />
        <text className="art-tag-t" x={219} y={125}>
          Button
        </text>
        <ShopButton x={218} y={136} small />
        <rect
          className="art-sel"
          x={212}
          y={130}
          width={268}
          height={40}
          rx={4}
        />
        <text className="art-body" x={218} y={204}>
          The ferns you liked are back.
        </text>
        <rect
          className="art-drop"
          x={218}
          y={222}
          width={256}
          height={3}
          rx={1.5}
        />
        <circle className="art-drop-end" cx={218} cy={223.5} r={4} />
        <rect
          className="art-ghost-block"
          x={226}
          y={238}
          width={150}
          height={34}
          rx={7}
        />
        <Glyph icon={TicketIcon} x={238} y={247} className="art-i-mark" />
        <text className="art-t art-mark-t art-b" x={262} y={260}>
          Promo code
        </text>
      </g>
      <Callout x={170} y={53} to={[212, 48]} title="Your toolbar" />
      <Callout x={170} y={155} to={[208, 150]} title="Your outline" />
      <Callout x={170} y={228} to={[214, 224]} title="Your drop line" />
    </Art>
  );
}

export function BlockArt(): ReactNode {
  return (
    <Art
      width={W}
      height={H}
      label="A promo code block you wrote, selected on the email, with its own settings in the panel beside it."
    >
      <g className="art-mail">
        <rect
          className="art-paper"
          x={24}
          y={24}
          width={270}
          height={300}
          rx={3}
        />
        <text className="art-h3" x={44} y={58}>
          The spring sale starts Monday
        </text>
        <text className="art-xs" x={44} y={80}>
          Every plant and pot is 20% off.
        </text>
        <rect
          className="art-tag"
          x={38}
          y={100}
          width={78}
          height={18}
          rx={4}
        />
        <text className="art-tag-t" x={45} y={113}>
          Promo code
        </text>
        <Ticket x={44} y={124} w={230} />
        <rect
          className="art-sel"
          x={38}
          y={118}
          width={242}
          height={78}
          rx={4}
        />
        <line className="art-rule" x1={44} y1={222} x2={274} y2={222} />
        <text className="art-xs art-u" x={159} y={246} textAnchor="middle">
          Unsubscribe
        </text>
      </g>
      <rect className="art-frame" x={310} y={0} width={210} height={H} />
      <line className="art-rule" x1={310} y1={0} x2={310} y2={H} />
      <text className="art-title" x={328} y={42}>
        Promo code
      </text>
      <Field x={328} y={74} label="Code" value="SPRING20" width={172} mono />
      <Field
        x={328}
        y={136}
        label="Offer"
        value="20% off everything"
        width={172}
      />
      <text className="art-xs" x={328} y={218}>
        Color
      </text>
      {(["art-clay", "art-fern", "art-swatch-ink"] as const).map((tone, i) => (
        <g key={tone}>
          {i === 0 ? (
            <circle className="art-ring" cx={340 + i * 32} cy={240} r={14} />
          ) : null}
          <circle className={tone} cx={340 + i * 32} cy={240} r={10} />
        </g>
      ))}
    </Art>
  );
}

const HISTORY: readonly (readonly [Icon, string, string])[] = [
  [SparklesIcon, "Accepted the AI’s shipping note", "Undo takes it out"],
  [CursorArrowRaysIcon, "Changed the button colour", ""],
  [TicketIcon, "Added a promo code", ""],
  [H1Icon, "Edited the heading", ""],
];

export function UndoArt(): ReactNode {
  return (
    <Art
      width={W}
      height={H}
      label="The edit history, newest first: an accepted AI change, a colour change, an added promo code and a heading edit. Undo and redo buttons sit above."
    >
      <text className="art-title" x={24} y={42}>
        History
      </text>
      <rect
        className="art-input"
        x={418}
        y={22}
        width={40}
        height={30}
        rx={8}
      />
      <Glyph
        icon={ArrowUturnLeftIcon}
        x={430}
        y={29}
        className="art-i-ink-on-white"
      />
      <rect
        className="art-input"
        x={462}
        y={22}
        width={40}
        height={30}
        rx={8}
      />
      <Glyph
        icon={ArrowUturnRightIcon}
        x={474}
        y={29}
        className="art-i-faint"
      />
      {HISTORY.map(([I, text, note], i) => {
        const y = 70 + i * 54;
        return (
          <g key={text} className={i === 0 ? undefined : "art-older"}>
            <rect
              className="art-input"
              x={24}
              y={y}
              width={478}
              height={44}
              rx={10}
            />
            <Glyph
              icon={I}
              x={40}
              y={y + 14}
              className={i === 0 ? "art-i-mark" : "art-i-muted"}
            />
            <text className="art-t art-ink-t" x={66} y={y + 27}>
              {text}
            </text>
            {note ? (
              <text
                className="art-xs art-mark-t"
                x={488}
                y={y + 27}
                textAnchor="end"
              >
                {note}
              </text>
            ) : null}
          </g>
        );
      })}
    </Art>
  );
}
