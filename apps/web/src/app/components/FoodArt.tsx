import type { ReactNode } from "react";
import { MORE, MORE_ALIAS } from "./foodArtMore";
/**
 * Small pen-and-ink drawings for the Foods list, in the manner of old herbals and anatomical studies: fine outlines,
 * hatching for shade, no flat colour. Plain SVG on a 64-unit grid, ink in the accent colour drawn straight onto the card, in its top right corner, with no tile behind it
 * (the paper fill is the card's own surface colour, so it also works in dark mode). Matched by guide id or by catalogue name; foods without a drawing show no tile.
 */
import { INK, Leaf, P2, P3, PAPER, Round, Solid, shade, ticks } from "./foodArtParts";

function Blueberry({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const kx = cx - r * 0.1;
  const ky = cy - r * 0.55;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={PAPER} />
      {shade(cx, cy, r, 0.15 * r, 1.15 * r, 9)}
      <circle cx={cx} cy={cy} r={r} fill="none" />
      {/* the crown: a small ring with five points, as drawn on every blueberry */}
      <ellipse cx={kx} cy={ky} rx={r * 0.3} ry={r * 0.22} fill={PAPER} />
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        return <line key={i} x1={kx} y1={ky} x2={kx + Math.cos(a) * r * 0.42} y2={ky + Math.sin(a) * r * 0.32} />;
      })}
      <path d={`M${cx - r * 0.62} ${cy - r * 0.1}Q${cx - r * 0.55} ${cy + r * 0.35} ${cx - r * 0.2} ${cy + r * 0.55}`} strokeWidth="0.6" opacity=".55" />
    </g>
  );
}

const PEAR = "M32 14C37 14 39 20 39 25 39 31 48 35 48 45 48 54 41 59 32 59 23 59 16 54 16 45 16 35 25 31 25 25 25 20 27 14 32 14z";
const CARROT = "M24 24C24 22 27 21 32 21 37 21 40 22 40 24 40 36 36 50 32 62 28 50 24 36 24 24z";

const ART: Record<string, ReactNode> = {
  blueberries: (
    <>
      <path d="M32 19C30 13 27 9 22 7" />
      <path d="M22 7C16 6 12 9 11 13 16 14 21 12 22 7z" fill={PAPER} />
      <path d="M22 7L13 12M18 8.5L16.5 12.5M20 10L18 13" strokeWidth="0.6" />
      <Blueberry cx={21} cy={44} r={12} />
      <Blueberry cx={43} cy={42} r={12} />
      <Blueberry cx={32} cy={28} r={11} />
    </>
  ),
  pear: (
    <>
      <clipPath id="art-pear">
        <path d={PEAR} />
      </clipPath>
      <path d={PEAR} fill={PAPER} />
      <g clipPath="url(#art-pear)" strokeWidth="0.7">
        {Array.from({ length: 13 }, (_, i) => (
          <line key={i} x1={33 + i * 2.4 + 9} y1={18} x2={33 + i * 2.4 - 11} y2={62} />
        ))}
        <path d="M22 44Q23 53 30 56" strokeWidth="0.6" />
      </g>
      <path d="M32 14C32 10 33 7 36 4" strokeWidth="1.4" />
      <path d="M35 9C40 4 47 5 50 9 45 13 38 13 35 9z" fill={PAPER} />
      <path d="M35 9L48 8" strokeWidth="0.6" />
      <path d="M26 24C25 30 20 33 19 40" strokeWidth="0.6" opacity=".55" />
      <g strokeWidth="0.6">
        {ticks([
          [27, 52, 29, 53],
          [30, 55, 33, 55.5],
          [44, 52, 41, 55],
        ])}
      </g>
    </>
  ),
  kiwi: (
    <>
      <ellipse cx="32" cy="34" rx="23" ry="21" fill={PAPER} />
      {/* the hairy skin */}
      <g strokeWidth="0.6">
        {Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2;
          return <line key={i} x1={32 + Math.cos(a) * 23} y1={34 + Math.sin(a) * 21} x2={32 + Math.cos(a) * 25} y2={34 + Math.sin(a) * 23} />;
        })}
      </g>
      <ellipse cx="32" cy="34" rx="19" ry="17" />
      <ellipse cx="32" cy="34" rx="5.5" ry="5" />
      {/* the fibres running out from the core, and the ring of seeds */}
      <g strokeWidth="0.55">
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i / 36) * Math.PI * 2;
          return <line key={i} x1={32 + Math.cos(a) * 7} y1={34 + Math.sin(a) * 6.4} x2={32 + Math.cos(a) * 17} y2={34 + Math.sin(a) * 15.2} />;
        })}
      </g>
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2 + 0.2;
        const x = 32 + Math.cos(a) * 10.5;
        const y = 34 + Math.sin(a) * 9.5;
        return <ellipse key={i} cx={x} cy={y} rx="1.5" ry="0.8" transform={`rotate(${(a * 180) / Math.PI} ${x} ${y})`} fill={INK} stroke="none" />;
      })}
    </>
  ),
  carrots: (
    <g transform="rotate(32 32 36)">
      <clipPath id="art-carrot">
        <path d={CARROT} />
      </clipPath>
      <path d={CARROT} fill={PAPER} />
      <g clipPath="url(#art-carrot)" strokeWidth="0.7">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1={33 + i * 1.9 + 7} y1={21} x2={33 + i * 1.9 - 7} y2={64} />
        ))}
      </g>
      <path d="M25 30Q29 32 33 30M27 37Q30 39 34 37M29 44Q31 46 34 44M31 51Q32 52 34 51" strokeWidth="0.8" />
      {/* the fronds */}
      <path d="M32 21C31 15 28 10 23 6M32 21C32 14 33 9 34 4M32 21C34 15 38 11 44 8" />
      <g strokeWidth="0.7">
        {ticks([
          [30, 14, 26, 14],
          [28.5, 11, 25, 9],
          [26, 8.5, 22, 8],
          [31.5, 12, 35, 10],
          [32.5, 9, 30, 6],
          [33, 7, 36, 5],
          [34.5, 17, 38, 15],
          [37, 14, 40, 14],
          [40, 11.5, 42, 9],
          [41.5, 9.5, 45, 10],
        ])}
      </g>
    </g>
  ),
  strawberries: (
    <>
      <Solid id="straw" d="M32 58C20 50 12 38 14 28 16 20 24 17 32 20 40 17 48 20 50 28 52 38 44 50 32 58z" from={30} n={12} />
      {/* the seeds, in loose rows */}
      <g strokeWidth="1.1">
        {P2([
          [20, 28],
          [27, 30],
          [36, 30],
          [43, 28],
          [23, 36],
          [31, 37],
          [40, 36],
          [46, 34],
          [26, 44],
          [35, 44],
          [43, 42],
          [31, 51],
          [38, 50],
        ]).map(([x, y]) => (
          <line key={`${x},${y}`} x1={x} y1={y} x2={x} y2={y + 1.8} />
        ))}
      </g>
      <path
        d="M32 20C27 15 21 15 18 18 23 19 28 22 32 20zM32 20C37 15 43 15 46 18 41 19 36 22 32 20zM32 20C28 17 25 13 24 11 28 12 31 15 32 20zM32 20C36 17 39 13 40 11 36 12 33 15 32 20z"
        fill={PAPER}
      />
      <path d="M32 19L33 8" strokeWidth="1.3" />
    </>
  ),
  beetroot: (
    <>
      <Leaf x={32} y={22} a={-120} l={20} w={6} veins={3} />
      <Leaf x={32} y={22} a={-60} l={22} w={6} veins={3} />
      <Leaf x={32} y={22} a={-90} l={16} w={4.5} veins={2} />
      <Solid id="beet" d="M32 22C44 22 51 32 47 42 44 50 37 54 33 58L32 63 31 58C27 54 18 50 17 40 16 30 22 22 32 22z" from={30} n={11} />
      <path d="M22 28Q32 34 42 28M19 36Q32 44 45 36M21 44Q32 50 41 45" strokeWidth="0.5" opacity=".7" />
      <path d="M28 21L30 15M36 21L34 15" strokeWidth="1.1" />
    </>
  ),
  eggs: (
    <>
      <g transform="rotate(-14 24 34)">
        <Solid id="egg-b" d="M24 12C32 12 37 26 37 36 37 46 31 54 24 54 17 54 11 46 11 36 11 26 16 12 24 12z" from={22} n={8} />
      </g>
      <Solid id="egg-f" d="M41 9C51 9 57 25 57 37 57 49 50 59 41 59 32 59 25 49 25 37 25 25 31 9 41 9z" from={40} n={10} />
      <path d="M31 30C32 24 35 19 38 16" strokeWidth="0.6" opacity=".6" />
      <g strokeWidth="0.9">
        {ticks([
          [34, 46, 35, 46.5],
          [47, 41, 48, 41.5],
          [43, 52, 44, 52.4],
          [51, 33, 52, 33.4],
        ])}
      </g>
    </>
  ),
  evoo: (
    <>
      <path d="M8 56C22 46 40 32 56 10" strokeWidth="1.1" />
      <Leaf x={16} y={50} a={-60} l={16} w={3.2} />
      <Leaf x={22} y={46} a={20} l={16} w={3.2} />
      <Leaf x={32} y={38} a={-75} l={15} w={3} />
      <Leaf x={38} y={32} a={5} l={15} w={3} />
      <Leaf x={46} y={22} a={-80} l={13} w={2.8} />
      <Leaf x={50} y={18} a={-10} l={10} w={2.4} />
      {/* olives */}
      {P3([
        [30, 48, 8],
        [42, 44, -4],
        [24, 56, 12],
      ]).map(([x, y, a]) => (
        <g key={`${x},${y}`} transform={`rotate(${a} ${x} ${y})`}>
          <ellipse cx={x} cy={y} rx="4.6" ry="6" fill={PAPER} />
          {shade(x, y, 5, 0, 5, 4)}
          <ellipse cx={x} cy={y} rx="4.6" ry="6" fill="none" />
        </g>
      ))}
    </>
  ),
  figs: (
    <>
      <Solid
        id="fig"
        d="M32 16C38 16 40 22 42 27 48 34 50 42 46 50 42 58 36 60 32 60 28 60 22 58 18 50 14 42 16 34 22 27 24 22 26 16 32 16z"
        from={31}
        n={11}
      />
      <path d="M32 18C26 28 24 44 30 58M32 18C38 28 40 44 34 58M27 22C20 32 21 46 26 56" strokeWidth="0.5" opacity=".65" />
      <path d="M32 16L32 10" strokeWidth="1.5" />
      <path d="M30 17Q32 14 34 17" strokeWidth="0.8" />
      {/* the lobed leaf */}
      <g transform="translate(48 22) rotate(-30)">
        <path d="M0 0C2 -4 5 -6 9 -5 8 -8 12 -12 16 -10 15 -6 17 -4 20 -3 17 -1 17 3 14 5 12 4 8 7 6 4 3 5 1 3z" fill={PAPER} />
        <path d="M0 0L16 -6M6 -2L8 -6M10 -3L13 0" strokeWidth="0.5" />
      </g>
    </>
  ),
  ginger: (
    <>
      <Solid
        id="ginger"
        d="M9 41C8 35 14 30 21 32L25 26C25 20 32 18 34 24L36 30C42 26 48 28 50 22 52 18 58 20 58 26 58 32 54 36 49 38L51 44C51 52 41 54 35 50 29 56 17 55 13 49 11 47 9 44 9 41z"
        from={26}
        n={16}
        step={2}
        slant={9}
        y0={12}
        y1={60}
      />
      <path d="M17 37Q19 41 17 45M28 36Q31 40 29 45M39 38Q42 42 40 46M52 24Q55 27 53 31M30 27Q33 29 31 32" strokeWidth="0.6" />
      <path d="M34 24C35 18 38 14 42 12M52 22C53 18 56 15 59 15" strokeWidth="0.9" />
    </>
  ),
  grapes: (
    <g transform="translate(3.2 3.4) scale(0.9)">
      <path d="M32 18C32 12 34 9 38 7" strokeWidth="1.2" />
      <Leaf x={36} y={11} a={-25} l={20} w={5} veins={3} />
      {P2([
        [21, 24],
        [32, 24],
        [43, 24],
        [15.5, 33],
        [26.5, 33],
        [37.5, 33],
        [48.5, 33],
        [21, 42],
        [32, 42],
        [43, 42],
        [26.5, 51],
        [37.5, 51],
        [32, 59.5],
      ]).map(([x, y]) => (
        <Round key={`${x},${y}`} cx={x} cy={y} r={5.4} hatch={5} />
      ))}
    </g>
  ),
  green_tea: (
    <>
      <path d="M10 32C10 46 20 54 32 54 44 54 54 46 54 32z" fill={PAPER} />
      <clipPath id="art-tea">
        <path d="M10 32C10 46 20 54 32 54 44 54 54 46 54 32z" />
      </clipPath>
      <g clipPath="url(#art-tea)" strokeWidth="0.7">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1={32 + i * 2.6 + 9} y1={32} x2={32 + i * 2.6 - 9} y2={56} />
        ))}
      </g>
      <ellipse cx="32" cy="32" rx="22" ry="4" fill={PAPER} />
      <ellipse cx="32" cy="32.5" rx="19" ry="2.6" strokeWidth="0.6" />
      <path d="M24 56H40M26 54L25 58H39L38 54" />
      <path d="M26 24C22 20 30 16 26 11M34 24C30 20 38 16 34 11M42 24C38 20 46 16 42 11" strokeWidth="0.8" />
      <Leaf x={52} y={42} a={-40} l={12} w={3} veins={2} />
      <Leaf x={52} y={42} a={-80} l={9} w={2.4} />
    </>
  ),
  honey: (
    <>
      <path d="M21 14H43V22H21z" fill={PAPER} />
      <path d="M24 14V22M28 14V22M32 14V22M36 14V22M40 14V22" strokeWidth="0.6" />
      <Solid id="jar" d="M19 22C17 26 17 30 17 34L17 52C17 56 21 59 26 59L38 59C43 59 47 56 47 52L47 34C47 30 47 26 45 22z" from={32} n={10} />
      {/* a hexagon label, the honeycomb cell */}
      <path d="M32 31L38 34.5V41.5L32 45L26 41.5V34.5z" fill={PAPER} />
      <path d="M32 34L35.5 36V40L32 42L28.5 40V36z" strokeWidth="0.6" />
      <path d="M20 29Q32 32 44 29" strokeWidth="0.5" opacity=".6" />
      <path d="M32 6C34 6 35 8 35 10L35 14M29 8C30 6 33 6 34 8" strokeWidth="0.8" />
    </>
  ),
  pomegranate: (
    <>
      <path d="M24 14L26 7L30 12L32 5L34 12L38 7L40 14C36 16 28 16 24 14z" fill={PAPER} />
      <path d="M28 12L28.5 10M32 12V8M36 12L35.5 10" strokeWidth="0.5" />
      <circle cx="32" cy="38" r="23" fill={PAPER} />
      <circle cx="32" cy="38" r="19.5" strokeWidth="0.7" />
      <g strokeWidth="0.6">
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2 + 0.3;
          return <line key={i} x1={32} y1={38} x2={32 + Math.cos(a) * 19.5} y2={38 + Math.sin(a) * 19.5} />;
        })}
      </g>
      {Array.from({ length: 40 }, (_, i) => {
        const ring = i < 6 ? 0 : i < 18 ? 1 : 2;
        const n = ring === 0 ? 6 : ring === 1 ? 12 : 22;
        const k = ring === 0 ? i : ring === 1 ? i - 6 : i - 18;
        const rad = ring === 0 ? 5 : ring === 1 ? 10.6 : 15.8;
        const a = (k / n) * Math.PI * 2 + ring * 0.25 + 0.05;
        const x = 32 + Math.cos(a) * rad;
        const y = 38 + Math.sin(a) * rad;
        return ring === 2 && k >= 18 ? null : <Round key={i} cx={x} cy={y} r={ring === 2 ? 2.8 : 3.1} hatch={2} />;
      })}
    </>
  ),
  apple: (
    <>
      <Solid
        id="apple"
        d="M32 21C26 15 14 18 14 32 14 46 22 58 28 58 30 58 31 57 32 57 33 57 34 58 36 58 42 58 50 46 50 32 50 18 38 15 32 21z"
        from={31}
        n={12}
      />
      <path d="M32 21C32 15 34 11 37 8" strokeWidth="1.4" />
      <Leaf x={34} y={14} a={-28} l={14} w={4} veins={2} />
      <path d="M20 28C18 34 19 42 23 48" strokeWidth="0.6" opacity=".6" />
    </>
  ),
  lemon: (
    <>
      <g transform="rotate(-18 30 30)">
        <Solid
          id="lemon"
          d="M3 28C8 27 11 25 14 21 20 13 42 13 48 21 51 25 54 27 59 28 54 29 51 31 48 35 42 43 20 43 14 35 11 31 8 29 3 28z"
          from={28}
          n={14}
          step={2}
          slant={6}
          y0={10}
          y1={46}
        />
        <path d="M59 28C61 27 62 26 63 24" strokeWidth="1.2" />
        <g strokeWidth="0.55">
          {ticks([
            [20, 30, 22, 31],
            [30, 33, 32, 34],
            [40, 30, 42, 31],
            [26, 24, 28, 25],
          ])}
        </g>
      </g>
      <Leaf x={36} y={14} a={-40} l={16} w={4.6} veins={2} />
      <circle cx="44" cy="48" r="13" fill={PAPER} />
      <circle cx="44" cy="48" r="10.6" strokeWidth="0.7" />
      <path d="M44 48V37.4M44 48L51.5 40.5M44 48H54.6M44 48L51.5 55.5M44 48V58.6M44 48L36.5 55.5M44 48H33.4M44 48L36.5 40.5" strokeWidth="0.55" />
      <circle cx="44" cy="48" r="1.4" fill={INK} stroke="none" />
      <path d="M56 28C58 32 58 35 56 37 54 35 54 32 56 28z" fill={PAPER} />
    </>
  ),
  lime: (
    <>
      <Solid id="lime" d="M26 14C37 12 46 20 46 31 46 42 38 50 28 49 19 48 12 41 12 32 12 22 18 16 26 14z" from={22} n={10} />
      <path d="M26 14C26 11 27 9 29 8" strokeWidth="1.1" />
      {/* a cut slice */}
      <circle cx="45" cy="46" r="13" fill={PAPER} />
      <circle cx="45" cy="46" r="10.5" />
      <path d="M45 46V35.5M45 46L52.4 38.6M45 46H55.5M45 46L52.4 53.4M45 46V56.5M45 46L37.6 53.4M45 46H34.5M45 46L37.6 38.6" strokeWidth="0.55" />
      <circle cx="45" cy="46" r="1.6" fill={INK} stroke="none" />
    </>
  ),
  blackberry: (
    <>
      {Array.from({ length: 28 }, (_, k) => {
        const row = Math.floor(k / 4);
        const col = k % 4;
        const x = 22.5 + col * 7 + (row % 2) * 3.5;
        const y = 21 + row * 6.2;
        const dx = (x - 32) / 14;
        const dy = (y - 37) / 22;
        return dx * dx + dy * dy <= 1.15 ? <Round key={k} cx={x} cy={y} r={4} hatch={3} /> : null;
      })}
      <path d="M32 24C28 19 22 19 19 22 24 23 29 26 32 24zM32 24C36 19 42 19 45 22 40 23 35 26 32 24z" fill={PAPER} />
      <path d="M32 23L33 12" strokeWidth="1.2" />
    </>
  ),
  bilberry: (
    <>
      <path d="M10 14C22 14 36 20 46 30" strokeWidth="1" />
      <Leaf x={22} y={16} a={50} l={13} w={4} veins={2} />
      <Leaf x={34} y={21} a={-30} l={13} w={4} veins={2} />
      <Leaf x={42} y={27} a={55} l={12} w={3.6} veins={2} />
      {P3([
        [20, 40, 8],
        [36, 44, 8.5],
        [49, 40, 7.5],
      ]).map(([x, y, r]) => (
        <g key={x}>
          <path d={`M${x} ${y - r}L${x} ${y - r - 6}`} strokeWidth="0.7" />
          <Round cx={x} cy={y} r={r} hatch={6} />
          <ellipse cx={x} cy={y - r * 0.5} rx={r * 0.28} ry={r * 0.2} fill={PAPER} />
        </g>
      ))}
    </>
  ),
};

const ALIAS: Record<string, string> = {
  "carrots and carrot juice": "carrots",
  "lemon and lemon juice": "lemon",
};

function drawing(key: string): ReactNode {
  const k = key.toLowerCase();
  const id = ALIAS[k] ?? MORE_ALIAS[k] ?? k;
  return ART[id] ?? MORE[id];
}

export function hasFoodArt(key: string): boolean {
  return Boolean(drawing(key));
}

export function FoodArt({ name, className, large }: { name: string; className?: string; large?: boolean }) {
  const art = drawing(name);
  if (!art) return null;
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      role="presentation"
      className={`pointer-events-none absolute opacity-80 ${large ? "top-10 right-0 hidden size-28 sm:block" : "top-2 right-2 size-[4.5rem]"} ${className ?? ""}`}
      fill="none"
      stroke={INK}
      strokeWidth="0.85"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {art}
    </svg>
  );
}
