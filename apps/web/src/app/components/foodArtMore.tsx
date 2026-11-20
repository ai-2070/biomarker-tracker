import type { ReactNode } from "react";
import { INK, Leaf, P2, PAPER, Round, Solid, shade, ticks } from "./foodArtParts";

/** More pen-and-ink drawings (see FoodArt.tsx), on the same 64-unit grid. */

/** A fish seen from the side, nose at the origin, `len` long and `h` deep. */
function Fish({ id, x, y, len, h, flip = false }: { id: string; x: number; y: number; len: number; h: number; flip?: boolean }) {
  const d = `M0 0C${len * 0.2} ${-h} ${len * 0.6} ${-h * 0.9} ${len * 0.8} ${-h * 0.25}L${len * 0.97} ${-h * 0.6}L${len * 0.93} 0L${len * 0.97} ${h * 0.6}L${len * 0.8} ${h * 0.25}C${len * 0.6} ${h * 0.9} ${len * 0.2} ${h} 0 0z`;
  const rows = Math.max(2, Math.round(h / 3.2));
  const scales: ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < Math.floor(len / 5); c++) {
      const sx = len * 0.3 + c * 3.6 + (r % 2) * 1.8;
      const sy = -h * 0.35 + r * ((h * 0.9) / rows);
      if (sx < len * 0.78) scales.push(<path key={`${r}-${c}`} d={`M${sx} ${sy}q1.6 1.8 3.2 0`} strokeWidth="0.4" />);
    }
  }
  return (
    <g transform={`translate(${x} ${y})${flip ? ` scale(-1 1) translate(${-len} 0)` : ""}`}>
      <clipPath id={`art-${id}`}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={PAPER} />
      <g clipPath={`url(#art-${id})`} strokeWidth="0.6">
        {Array.from({ length: Math.round(len / 2.4) }, (_, i) => (
          <line key={i} x1={i * 2.4 + 6} y1={h * 0.05} x2={i * 2.4 - 3} y2={h * 1.1} />
        ))}
      </g>
      {scales}
      <path d={d} />
      <path d={`M${len * 0.3} ${-h * 0.5}Q${len * 0.36} 0 ${len * 0.3} ${h * 0.5}`} strokeWidth="0.6" />
      <circle cx={len * 0.12} cy={-h * 0.12} r={Math.max(0.9, h * 0.07)} fill={INK} stroke="none" />
      <path d={`M${len * 0.45} ${-h * 0.8}L${len * 0.5} ${-h * 1.1}L${len * 0.62} ${-h * 0.85}`} strokeWidth="0.7" />
    </g>
  );
}

function hex(cx: number, cy: number, r: number) {
  return (
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      return `${i === 0 ? "M" : "L"}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
    }).join("") + "z"
  );
}

/** A wavy ribbon (kelp, a leaf with a ruffled edge) running along a sine spine. */
function Ribbon({ x, y, len, amp, w, phase = 0, a = 0 }: { x: number; y: number; len: number; amp: number; w: number; phase?: number; a?: number }) {
  const n = 40;
  const left: string[] = [];
  const right: string[] = [];
  const mid: string[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = Math.sin(t * Math.PI * 2.2 + phase) * amp;
    const py = -t * len;
    const width = w * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 + 0.12 * Math.sin(t * 60));
    left.push(`${(px - width).toFixed(1)} ${py.toFixed(1)}`);
    right.push(`${(px + width).toFixed(1)} ${py.toFixed(1)}`);
    mid.push(`${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  const d = `M${left.join("L")}L${right.reverse().join("L")}z`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${a})`}>
      <path d={d} fill={PAPER} />
      <path d={`M${mid.join("L")}`} strokeWidth="0.6" />
    </g>
  );
}

const BOTTLE = "M26 8H38V16C38 20 44 22 44 30V54C44 57 42 59 39 59H25C22 59 20 57 20 54V30C20 22 26 20 26 16z";

export const MORE: Record<string, ReactNode> = {
  avocado: (
    <>
      <Solid
        id="avo"
        d="M32 8C40 8 42 18 46 26 52 34 52 44 48 52 44 59 38 60 32 60 26 60 20 59 16 52 12 44 12 34 18 26 22 18 24 8 32 8z"
        from={30}
        n={5}
        step={3}
      />
      <path d="M32 14C37 14 38 21 41 27 46 33 46 42 43 48 40 54 36 55 32 55 28 55 24 54 21 48 18 42 18 33 23 27 26 21 27 14 32 14z" strokeWidth="0.6" />
      <Round cx={32} cy={42} r={9} hatch={6} />
      <path d="M27 38Q29 35 32 35" strokeWidth="0.6" />
    </>
  ),
  "baby spinach": (
    <>
      <path d="M32 61C30 52 27 44 25 36M32 61C32 50 32 42 32 32M32 61C34 52 37 44 39 36" strokeWidth="1" />
      <Leaf x={25} y={36} a={-112} l={26} w={8.5} veins={4} />
      <Leaf x={32} y={32} a={-90} l={28} w={9} veins={4} />
      <Leaf x={39} y={36} a={-68} l={26} w={8.5} veins={4} />
    </>
  ),
  "black pepper": (
    <>
      <path d="M20 8C32 12 40 24 38 38" strokeWidth="1" />
      {Array.from({ length: 13 }, (_, i) => {
        const t = i / 12;
        const x = 22 + t * 16 + Math.sin(t * 5) * 1.5;
        const y = 12 + t * 38;
        return <Round key={i} cx={x + (i % 2 ? 3 : -3)} cy={y} r={3.2} hatch={3} />;
      })}
      <Leaf x={40} y={14} a={30} l={16} w={6} veins={3} />
      <Round cx={14} cy={54} r={3.6} hatch={3} />
      <Round cx={22} cy={57} r={3.6} hatch={3} />
    </>
  ),
  "bone broth": (
    <>
      <path d="M12 34C12 48 20 56 32 56 44 56 52 48 52 34z" fill={PAPER} />
      <clipPath id="art-broth">
        <path d="M12 34C12 48 20 56 32 56 44 56 52 48 52 34z" />
      </clipPath>
      <g clipPath="url(#art-broth)" strokeWidth="0.7">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={30 + i * 2.4 + 9} y1={34} x2={30 + i * 2.4 - 9} y2={58} />
        ))}
      </g>
      <g transform="rotate(38 38 26)">
        <rect x="35" y="2" width="6" height="26" fill={PAPER} />
        <circle cx="35.5" cy="3" r="3.6" fill={PAPER} />
        <circle cx="40.5" cy="3" r="3.6" fill={PAPER} />
        <rect x="35" y="3" width="6" height="12" fill={PAPER} stroke="none" />
        <path d="M35 5V28M41 5V28" />
      </g>
      <ellipse cx="32" cy="34" rx="20" ry="5" fill={PAPER} />
      <ellipse cx="32" cy="34.5" rx="17" ry="3.4" strokeWidth="0.6" />
      <path d="M24 35.5Q28 34 32 35.5T40 35" strokeWidth="0.5" />
      <path d="M22 28C18 24 26 20 22 15M30 28C26 24 34 20 30 15" strokeWidth="0.8" />
      <path d="M26 56H38M28 54L27 58H37L36 54" />
    </>
  ),
  broccoli: (
    <>
      <Solid id="brocstem" d="M26 40H38L36 60H28z" from={29} n={4} step={2.2} slant={6} y0={38} />
      <path d="M32 40C28 36 22 34 19 33M32 40C36 36 42 34 45 33M32 42V30" strokeWidth="0.9" />
      <Round cx={20} cy={28} r={10} hatch={5} />
      <Round cx={44} cy={28} r={10} hatch={5} />
      <Round cx={32} cy={19} r={11} hatch={6} />
      <Round cx={27} cy={32} r={8} hatch={4} />
      <Round cx={38} cy={32} r={8} hatch={4} />
      <g strokeWidth="0.5">
        {ticks([
          [16, 22, 18, 21],
          [26, 14, 28, 13],
          [38, 15, 40, 16],
          [46, 23, 48, 24],
          [31, 25, 33, 26],
        ])}
      </g>
    </>
  ),
  cabbage: (
    <>
      <Solid id="cab" d="M32 10C47 10 57 22 57 36 57 50 46 59 32 59 18 59 7 50 7 36 7 22 17 10 32 10z" from={34} n={12} step={2.2} />
      <path d="M32 59C14 56 8 40 14 28 20 36 28 46 32 59z" fill={PAPER} />
      <path d="M32 59C50 56 56 40 50 28 44 36 36 46 32 59z" fill={PAPER} />
      <path d="M32 58C24 50 18 42 14 29M32 58C26 48 22 44 12 38M32 58C38 48 42 44 52 38M32 58C40 50 46 42 50 29" strokeWidth="0.55" />
      <path d="M32 59L32 50" strokeWidth="1" />
      <path d="M20 22C26 16 38 16 44 22M24 27C28 23 36 23 40 27M27 31C29 29 35 29 37 31" strokeWidth="0.6" />
    </>
  ),
  cauliflower: (
    <>
      <Leaf x={32} y={60} a={-158} l={26} w={9} veins={4} />
      <Leaf x={32} y={60} a={-22} l={26} w={9} veins={4} />
      <Leaf x={32} y={60} a={-90} l={22} w={7} veins={3} />
      <Round cx={19} cy={25} r={9} hatch={4} />
      <Round cx={32} cy={19} r={10} hatch={5} />
      <Round cx={45} cy={25} r={9} hatch={4} />
      <Round cx={14} cy={35} r={8.5} hatch={4} />
      <Round cx={50} cy={35} r={8.5} hatch={4} />
      <Round cx={25} cy={32} r={9.5} hatch={5} />
      <Round cx={39} cy={32} r={9.5} hatch={5} />
      <Round cx={21} cy={43} r={8} hatch={4} />
      <Round cx={32} cy={42} r={9} hatch={5} />
      <Round cx={43} cy={43} r={8} hatch={4} />
      <g strokeWidth="0.5">
        <path d="M14 21q3-2 5 0M28 15q3-2 6 0M41 21q3-2 5 0M22 28q3-2 6 0M36 28q3-2 6 0M28 38q3-2 6 0M17 40q3-2 5 0M40 40q3-2 5 0" />
      </g>
    </>
  ),
  "ceylon cinnamon": (
    <g transform="rotate(-24 32 34)">
      <g>
        <rect x="9" y="38" width="42" height="12" rx="1" fill={PAPER} />
        <ellipse cx="51" cy="44" rx="4" ry="6" fill={PAPER} />
        <path d="M51 40C53 40 54 43 52 45 50 47 48 44 50 43" strokeWidth="0.6" />
        <g strokeWidth="0.6">
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1={11 + i * 3.4} y1={44} x2={11 + i * 3.4 + 4} y2={50} />
          ))}
        </g>
      </g>
      <g>
        <rect x="9" y="22" width="42" height="12" rx="1" fill={PAPER} />
        <ellipse cx="51" cy="28" rx="4" ry="6" fill={PAPER} />
        <path d="M51 24C53 24 54 27 52 29 50 31 48 28 50 27" strokeWidth="0.6" />
        <g strokeWidth="0.6">
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1={11 + i * 3.4} y1={28} x2={11 + i * 3.4 + 4} y2={34} />
          ))}
        </g>
      </g>
    </g>
  ),
  "chia seeds": (
    <>
      <path d="M32 40V12" strokeWidth="1" />
      <Leaf x={32} y={32} a={-140} l={13} w={3.6} veins={2} />
      <Leaf x={32} y={32} a={-40} l={13} w={3.6} veins={2} />
      <Leaf x={32} y={22} a={-130} l={10} w={3} />
      <Leaf x={32} y={22} a={-50} l={10} w={3} />
      <path d="M32 12L29 6M32 12L32 5M32 12L35 6" strokeWidth="0.8" />
      {Array.from({ length: 22 }, (_, i) => {
        const x = 12 + ((i * 17) % 40) + (i % 3);
        const y = 46 + ((i * 7) % 13);
        const r = (i * 53) % 180;
        return (
          <g key={i} transform={`rotate(${r} ${x} ${y})`}>
            <ellipse cx={x} cy={y} rx="3" ry="2" fill={PAPER} />
            <path d={`M${x - 1} ${y}L${x + 1.5} ${y}`} strokeWidth="0.4" />
          </g>
        );
      })}
    </>
  ),
  "coconut oil": (
    <>
      <circle cx="26" cy="40" r="19" fill={PAPER} />
      <g strokeWidth="0.5">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d={`M${12 + i * 3.4} 24Q${14 + i * 3.4} 40 ${12 + i * 3.4} 56`} opacity=".5" />
        ))}
      </g>
      <circle cx="26" cy="40" r="19" fill="none" />
      {shade(26, 40, 19, 6, 19, 8)}
      <circle cx="21" cy="34" r="1.6" fill={INK} stroke="none" />
      <circle cx="28" cy="32" r="1.6" fill={INK} stroke="none" />
      <circle cx="25" cy="39" r="1.6" fill={INK} stroke="none" />
      <circle cx="46" cy="20" r="12" fill={PAPER} />
      <circle cx="46" cy="20" r="8.5" />
      <path d="M40 17C42 12 48 12 51 15" strokeWidth="0.6" />
    </>
  ),
  cucumber: (
    <>
      <g transform="rotate(-28 32 34)">
        <Solid
          id="cuc"
          d="M8 34C8 28 12 26 18 26H46C52 26 56 28 56 34 56 40 52 42 46 42H18C12 42 8 40 8 34z"
          from={26}
          n={14}
          step={2}
          slant={5}
          y0={24}
          y1={44}
        />
        <g strokeWidth="1.2">
          {ticks([
            [16, 30, 16.6, 30],
            [24, 31, 24.6, 31],
            [34, 30, 34.6, 30],
            [43, 31, 43.6, 31],
            [20, 37, 20.6, 37],
            [30, 38, 30.6, 38],
            [39, 37, 39.6, 37],
          ])}
        </g>
        <path d="M56 34C58 33 60 33 61 31" strokeWidth="1.2" />
      </g>
      <circle cx="16" cy="50" r="9" fill={PAPER} />
      <circle cx="16" cy="50" r="6.6" strokeWidth="0.6" />
      <g strokeWidth="0.9">
        {ticks([
          [16, 46, 16, 47],
          [19, 50, 20, 50],
          [16, 54, 16, 55],
          [13, 50, 12, 50],
        ])}
      </g>
    </>
  ),
  "dark chocolate and cocoa": (
    <>
      <g transform="rotate(-20 32 32)">
        <Solid id="pod" d="M8 32C14 20 26 16 36 16 46 16 54 24 58 32 54 40 46 48 36 48 26 48 14 44 8 32z" from={26} n={14} step={2} slant={6} y0={14} y1={50} />
        <path d="M10 32C22 25 44 25 56 32M12 28C24 21 42 21 52 25M12 37C24 43 42 43 52 40" strokeWidth="0.6" />
      </g>
      <ellipse cx="14" cy="52" rx="6.5" ry="4" fill={PAPER} />
      <path d="M8 52Q14 50 20 52" strokeWidth="0.5" />
      <ellipse cx="28" cy="57" rx="6.5" ry="4" fill={PAPER} />
      <path d="M22 57Q28 55 34 57" strokeWidth="0.5" />
    </>
  ),
  "dealcoholised wine": (
    <>
      <path d="M20 10C20 28 24 37 32 37 40 37 44 28 44 10z" fill={PAPER} />
      <clipPath id="art-glass">
        <path d="M20 10C20 28 24 37 32 37 40 37 44 28 44 10z" />
      </clipPath>
      <g clipPath="url(#art-glass)" strokeWidth="0.7">
        <path d="M18 22Q25 20 32 22T46 22" />
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={16 + i * 2.6} y1={23} x2={16 + i * 2.6 + 4} y2={38} />
        ))}
      </g>
      <path d="M32 37V56M22 58C22 55 42 55 42 58C42 60 22 60 22 58z" />
      <path d="M24 12C24 20 26 24 28 27" strokeWidth="0.6" opacity=".6" />
      <Leaf x={48} y={44} a={-60} l={13} w={4} veins={2} />
      <Round cx={50} cy={52} r={3.6} hatch={3} />
      <Round cx={55} cy={54} r={3.6} hatch={3} />
    </>
  ),
  flaxseed: (
    <>
      <path d="M32 54C32 40 33 28 32 14" strokeWidth="1" />
      {P2([
        [32, 46],
        [32, 38],
        [32, 30],
        [32, 22],
      ]).map(([x, y], i) => (
        <g key={y}>
          <Leaf x={x} y={y} a={-150 + i * 6} l={11} w={1.6} />
          <Leaf x={x} y={y} a={-30 - i * 6} l={11} w={1.6} />
        </g>
      ))}
      {Array.from({ length: 5 }, (_, i) => {
        const a = ((i * 72 - 90) * Math.PI) / 180;
        return (
          <ellipse
            key={i}
            cx={32 + Math.cos(a) * 5.5}
            cy={11 + Math.sin(a) * 5.5}
            rx="3.4"
            ry="2.2"
            transform={`rotate(${i * 72} ${32 + Math.cos(a) * 5.5} ${11 + Math.sin(a) * 5.5})`}
            fill={PAPER}
          />
        );
      })}
      {Array.from({ length: 7 }, (_, i) => {
        const x = 12 + i * 6 + (i % 2) * 2;
        const y = 56 + (i % 3);
        return (
          <g key={i} transform={`rotate(${20 + i * 17} ${x} ${y})`}>
            <path d={`M${x - 3} ${y}C${x - 2} ${y - 2.4} ${x + 2} ${y - 2.4} ${x + 3} ${y}C${x + 2} ${y + 2} ${x - 2} ${y + 2} ${x - 3} ${y}z`} fill={PAPER} />
          </g>
        );
      })}
    </>
  ),
  garlic: (
    <>
      <Solid
        id="garlic"
        d="M32 8C34 16 36 19 41 24 49 28 53 36 51 46 49 54 41 59 32 59 23 59 15 54 13 46 11 36 15 28 23 24 28 19 30 16 32 8z"
        from={31}
        n={11}
      />
      <path d="M32 18C24 28 21 44 28 58M32 18C40 28 43 44 36 58M25 22C17 32 17 46 22 55" strokeWidth="0.55" opacity=".7" />
      <path d="M27 60L26 63M32 60V63M37 60L38 63" strokeWidth="0.7" />
    </>
  ),
  "ginseng tea": (
    <>
      <Solid
        id="gins"
        d="M32 14C38 14 40 20 39 27 44 29 50 33 53 39 48 37 44 35 40 35 42 45 42 52 46 61 40 57 36 51 33 45 30 51 26 57 20 61 24 53 25 45 25 35 20 35 16 37 11 39 14 33 20 29 25 27 24 20 26 14 32 14z"
        from={30}
        n={11}
        y0={10}
      />
      <path d="M27 31Q32 33 37 31M26 38Q32 41 38 38" strokeWidth="0.55" />
      <path d="M32 14C32 10 31 7 28 5M32 14C34 10 37 8 40 8" strokeWidth="0.9" />
      <Leaf x={28} y={6} a={-170} l={10} w={3} />
      <Leaf x={40} y={8} a={-10} l={10} w={3} />
    </>
  ),
  "goat milk": (
    <>
      <path d="M24 16C16 14 14 6 18 3C18 8 22 11 26 11M40 16C48 14 50 6 46 3C46 8 42 11 38 11" strokeWidth="1" />
      <Solid id="goat" d={BOTTLE} from={30} n={9} />
      <path d="M26 16H38" strokeWidth="0.7" />
      <path d="M26 32H38V46H26z" fill={PAPER} />
      <path d="M32 35C34 38 35 40 32 43 29 40 30 38 32 35z" strokeWidth="0.7" />
    </>
  ),
  "sheep milk": (
    <>
      {P2([
        [18, 20],
        [26, 14],
        [38, 14],
        [46, 20],
        [48, 30],
        [16, 30],
      ]).map(([x, y]) => (
        <Round key={`${x},${y}`} cx={x} cy={y} r={6.5} hatch={3} />
      ))}
      <Solid id="sheep" d={BOTTLE} from={30} n={9} />
      <path d="M26 16H38" strokeWidth="0.7" />
      <path d="M26 32H38V46H26z" fill={PAPER} />
      <path d="M32 35C34 38 35 40 32 43 29 40 30 38 32 35z" strokeWidth="0.7" />
    </>
  ),
  "greek yoghurt": (
    <>
      <path d="M12 30C12 46 20 56 32 56 44 56 52 46 52 30z" fill={PAPER} />
      <clipPath id="art-yog">
        <path d="M12 30C12 46 20 56 32 56 44 56 52 46 52 30z" />
      </clipPath>
      <g clipPath="url(#art-yog)" strokeWidth="0.7">
        {Array.from({ length: 10 }, (_, i) => (
          <line key={i} x1={34 + i * 2.4 + 9} y1={30} x2={34 + i * 2.4 - 9} y2={58} />
        ))}
      </g>
      <ellipse cx="32" cy="30" rx="20" ry="4.4" fill={PAPER} />
      <path d="M18 29C22 22 30 22 32 16 34 22 42 22 46 29" fill={PAPER} />
      <path d="M26 26C30 24 34 24 38 26" strokeWidth="0.5" />
      <path d="M44 6L52 24M44 6C40 6 40 12 45 13" strokeWidth="1" />
    </>
  ),
  "hemp seeds": (
    <>
      {P2([[32, 24]]).flatMap(([x, y]) =>
        [
          [-160, 15],
          [-125, 19],
          [-90, 22],
          [-55, 19],
          [-20, 15],
        ].map(([a, l]) => <Leaf key={a} x={x} y={y} a={a!} l={l!} w={3} />),
      )}
      <path d="M32 24V34" strokeWidth="1" />
      {Array.from({ length: 16 }, (_, i) => {
        const x = 16 + ((i * 11) % 32);
        const y = 42 + ((i * 5) % 14);
        return <Round key={i} cx={x} cy={y} r={3.8} hatch={3} />;
      })}
    </>
  ),
  kale: (
    <>
      <Ribbon x={32} y={46} len={36} amp={0} w={14} />
      <path d="M32 46V10M32 38L24 30M32 38L40 30M32 28L25 21M32 28L39 21M32 20L28 15M32 20L36 15" strokeWidth="0.55" />
      <path d="M32 46C32 52 31 56 30 61" strokeWidth="1.3" />
    </>
  ),
  kimchi: (
    <>
      <Solid id="kjar" d="M17 24C15 28 15 31 15 35V52C15 57 19 60 24 60H40C45 60 49 57 49 52V35C49 31 49 28 47 24z" from={32} n={10} />
      <path d="M19 12H45V24H19z" fill={PAPER} />
      <path d="M22 12V24M26 12V24M30 12V24M34 12V24M38 12V24M42 12V24" strokeWidth="0.5" />
      <path d="M19 38C24 34 28 42 33 38S42 34 47 38M19 46C24 42 28 50 33 46S42 42 47 46" strokeWidth="0.55" />
      <g transform="rotate(-50 54 26)">
        <path d="M54 12C60 14 60 24 56 32 54 30 52 22 54 12z" fill={PAPER} />
        <path d="M54 12C54 9 56 7 58 7" strokeWidth="1" />
      </g>
    </>
  ),
  lentils: (
    <>
      {Array.from({ length: 24 }, (_, i) => {
        const row = Math.floor(i / 6);
        const col = i % 6;
        const x = 14 + col * 7.2 + (row % 2) * 3.6;
        const y = 32 + row * 6.4 - Math.abs(col - 2.5) * 1.4;
        return <Round key={i} cx={x} cy={y} r={3.5} hatch={3} />;
      })}
      <g transform="rotate(-20 40 16)">
        <path d="M30 12C36 8 46 8 52 12 46 18 36 18 30 12z" fill={PAPER} />
        <circle cx="37" cy="13" r="2" />
        <circle cx="45" cy="13" r="2" />
      </g>
    </>
  ),
  "macadamia nuts": (
    <>
      <Leaf x={8} y={40} a={-20} l={30} w={4.5} />
      <Round cx={30} cy={36} r={13} hatch={8} />
      <Round cx={48} cy={30} r={10} hatch={6} />
      <Round cx={44} cy={50} r={9} hatch={6} />
      <path d="M26 24L29 30 25 34 30 40" strokeWidth="0.8" />
      <path d="M44 22L46 27 43 31" strokeWidth="0.7" />
    </>
  ),
  oregano: (
    <>
      <path d="M26 60C28 44 30 30 34 12" strokeWidth="1" />
      {P2([
        [28, 52],
        [29, 44],
        [30, 36],
        [32, 28],
        [33, 20],
      ]).map(([x, y], i) => (
        <g key={y}>
          <Leaf x={x} y={y} a={-160 + i * 8} l={10 - i} w={3.6 - i * 0.3} veins={1} />
          <Leaf x={x} y={y} a={-20 - i * 8} l={10 - i} w={3.6 - i * 0.3} veins={1} />
        </g>
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <Round key={i} cx={30 + (i % 3) * 3.4} cy={10 + Math.floor(i / 3) * 4} r={1.9} hatch={2} />
      ))}
    </>
  ),
  oysters: (
    <>
      <path d="M10 36C8 22 20 10 34 8 48 8 58 16 58 28 52 24 42 24 34 27 24 29 16 32 10 36z" fill={PAPER} />
      <g fill="none" strokeWidth="0.55">
        <path d="M14 33C14 22 22 14 34 12M20 31C21 23 27 17 35 16M28 29C30 24 34 20 40 19" />
      </g>
      <Solid id="oyb" d="M6 46C6 38 20 32 34 32 50 32 60 38 60 46 60 54 46 59 32 59 18 59 6 54 6 46z" from={30} n={14} step={2.2} y0={30} y1={60} />
      <path d="M12 46C12 42 22 38 34 38 46 38 54 42 54 46 54 50 46 53 36 53 24 53 12 50 12 46z" fill={PAPER} />
      <path d="M12 46Q15 43 18 46T24 46 30 46 36 46 42 46 48 46 54 46" strokeWidth="0.5" />
      <path d="M16 48Q20 51 26 50T38 51 50 49" strokeWidth="0.5" />
      <circle cx="40" cy="45" r="3.4" fill={PAPER} />
      <path d="M38.6 44Q39.6 43 40.8 43.6" strokeWidth="0.5" />
    </>
  ),
  parsley: (
    <>
      <path d="M32 61C30 52 24 44 20 34M32 61C32 50 32 38 32 26M32 61C34 52 40 44 44 34" strokeWidth="1" />
      {[
        [20, 34, -120],
        [32, 26, -90],
        [44, 34, -60],
      ].map(([x, y, a]) => (
        <g key={x}>
          <Leaf x={x!} y={y!} a={a! - 38} l={12} w={4.2} veins={1} />
          <Leaf x={x!} y={y!} a={a!} l={15} w={4.6} veins={1} />
          <Leaf x={x!} y={y!} a={a! + 38} l={12} w={4.2} veins={1} />
        </g>
      ))}
    </>
  ),
  "peanut butter": (
    <>
      <g transform="translate(-6 0)">
        <path d="M12 8H36V16H12z" fill={PAPER} />
        <path d="M15 8V16M19 8V16M23 8V16M27 8V16M31 8V16" strokeWidth="0.5" />
        <Solid id="pbjar" d="M10 16C8 20 8 23 8 27V50C8 55 12 58 17 58H31C36 58 40 55 40 50V27C40 23 40 20 38 16z" from={24} n={10} />
        <path d="M12 30H36V46H12z" fill={PAPER} />
        <g transform="translate(24 38) rotate(-30)">
          <path d="M-8 0C-8 -4 -4 -5 -2 -3 0 -2 2 -2 4 -3 7 -5 10 -3 10 0 10 4 7 5 4 3 2 2 0 2 -2 3 -4 5 -8 4 -8 0z" fill={PAPER} transform="translate(-1 0)" />
        </g>
      </g>
      <g transform="translate(-2 8) scale(0.88)">
        <g transform="rotate(16 50 44)">
          <path d="M34 44C34 38 42 36 45 39 48 41 52 41 55 39 60 36 64 40 64 44 64 49 60 52 55 49 52 47 48 47 45 49 42 52 34 50 34 44z" fill={PAPER} />
          <circle cx="42" cy="44" r="3.4" />
          <circle cx="56" cy="44" r="3.4" />
          <path d="M44 38L46 50M52 38L54 50" strokeWidth="0.5" opacity=".6" />
        </g>
      </g>
    </>
  ),
  "pink salt": (
    <>
      <path d="M8 42L14 28 26 18 42 20 54 30 56 46 44 56 24 57z" fill={PAPER} />
      <clipPath id="art-rock1">
        <path d="M32 38L42 20 54 30 56 46z" />
      </clipPath>
      <g clipPath="url(#art-rock1)" strokeWidth="0.6">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={34 + i * 2.2 + 6} y1={18} x2={34 + i * 2.2 - 6} y2={58} />
        ))}
      </g>
      <clipPath id="art-rock2">
        <path d="M32 38L56 46 44 56 24 57z" />
      </clipPath>
      <g clipPath="url(#art-rock2)" strokeWidth="0.5">
        {Array.from({ length: 12 }, (_, i) => (
          <line key={i} x1={24 + i * 2.8} y1={40} x2={24 + i * 2.8} y2={58} />
        ))}
      </g>
      <path d="M8 42L14 28 26 18 42 20 54 30 56 46 44 56 24 57z" />
      <path d="M32 38L14 28M32 38L26 18M32 38L42 20M32 38L54 30M32 38L56 46M32 38L44 56M32 38L24 57M32 38L8 42" strokeWidth="0.7" />
      <path d="M26 18L32 38 42 20" strokeWidth="0.7" />
      <g strokeWidth="0.9">
        {ticks([
          [58, 52, 60, 51],
          [3, 52, 5, 54],
          [8, 58, 10, 57],
          [54, 58, 56, 59],
        ])}
      </g>
    </>
  ),
  propolis: (
    <>
      <ellipse cx="32" cy="44" rx="7" ry="10" fill={PAPER} />
      <path d="M26 40H38M25.5 45H38.5M26 50H38" strokeWidth="1.5" />
      <circle cx="32" cy="30" r="5" fill={PAPER} />
      <circle cx="32" cy="22" r="4" fill={PAPER} />
      <path d="M30 19C28 14 24 12 22 12M34 19C36 14 40 12 42 12" strokeWidth="0.7" />
      <path d="M27 28C16 20 14 30 22 36 26 36 28 32 27 28zM37 28C48 20 50 30 42 36 38 36 36 32 37 28z" fill={PAPER} />
      <path d="M24 32L20 27M40 32L44 27" strokeWidth="0.5" />
      <path d="M26 40L19 46M38 40L45 46M26 46L20 54M38 46L44 54" strokeWidth="0.7" />
      <circle cx="30.8" cy="21" r="0.8" fill={INK} stroke="none" />
      <circle cx="33.2" cy="21" r="0.8" fill={INK} stroke="none" />
    </>
  ),
  "royal jelly": (
    <>
      {P2([
        [32, 32],
        [32, 14],
        [32, 50],
        [16.4, 23],
        [47.6, 23],
        [16.4, 41],
        [47.6, 41],
      ]).map(([x, y]) => (
        <path key={`${x},${y}`} d={hex(x, y, 10)} fill={PAPER} />
      ))}
      <path d={hex(32, 32, 6.6)} strokeWidth="0.6" />
      <path d="M26 33C28 27 36 27 38 33 36 37 28 37 26 33z" fill={PAPER} />
      <path d="M29 31Q32 29 35 31" strokeWidth="0.5" />
    </>
  ),
  salmon: (
    <>
      <Fish id="salmon" x={6} y={34} len={52} h={17} />
      <path d="M12 44Q16 48 20 44" strokeWidth="0" />
    </>
  ),
  sardines: (
    <>
      <Fish id="sard1" x={6} y={24} len={50} h={8} />
      <Fish id="sard2" x={8} y={42} len={50} h={8} flip />
    </>
  ),
  seaweed: (
    <>
      <path d="M26 62C28 58 32 58 36 62M22 61L28 57M40 61L34 57" strokeWidth="0.8" />
      <Ribbon x={32} y={58} len={48} amp={5} w={4.5} phase={0.5} a={-10} />
      <Ribbon x={30} y={58} len={40} amp={4} w={4} phase={2} a={-28} />
      <Ribbon x={34} y={58} len={42} amp={4} w={4} phase={3.5} a={18} />
    </>
  ),
  "sweet potatoes": (
    <>
      <g transform="rotate(-20 32 40)">
        <Solid id="sweet" d="M2 42C12 28 38 24 62 34 40 50 14 54 2 42z" from={22} n={16} step={2} slant={6} y0={24} y1={56} />
        <path d="M8 40C18 34 36 32 54 35M10 44C22 42 38 42 52 38" strokeWidth="0.5" />
        <path d="M14 38Q16 41 14 44M26 36Q28 39 26 43M38 37Q40 40 38 44M48 38Q50 40 48 42" strokeWidth="0.5" />
        <path d="M2 42C0 43 -2 43 -3 44M62 34C63 34 65 33 66 32" strokeWidth="1" />
      </g>
      <path d="M14 36C10 28 12 20 18 14" strokeWidth="0.9" />
      <path d="M18 14C10 13 8 5 12 2 14 5 18 5 20 3 25 7 24 12 18 14z" fill={PAPER} />
      <path d="M18 14L15 5M18 14L12 8M18 14L22 7" strokeWidth="0.5" />
    </>
  ),
  thyme: (
    <>
      <path d="M12 60C20 48 28 34 34 14" strokeWidth="1" />
      {Array.from({ length: 8 }, (_, i) => {
        const t = (i + 1) / 9;
        const x = 12 + t * 22 - Math.sin(t * 3) * 1;
        const y = 60 - t * 46;
        return (
          <g key={i}>
            <Leaf x={x} y={y} a={-165 + i * 5} l={7} w={2.2} />
            <Leaf x={x} y={y} a={-15 - i * 5} l={7} w={2.2} />
          </g>
        );
      })}
      <path d="M44 38C46 30 50 26 54 24M40 48C44 42 50 40 56 40" strokeWidth="0.8" />
      <Leaf x={46} y={32} a={-60} l={6} w={1.8} />
      <Leaf x={50} y={41} a={-30} l={6} w={1.8} />
    </>
  ),
  "tomatoes and tomato sauce": (
    <>
      <Solid id="tom" d="M32 18C46 16 56 26 56 38 56 50 45 58 32 58 19 58 8 50 8 38 8 26 18 16 32 18z" from={30} n={13} />
      <path d="M32 19C26 28 25 44 29 57M32 19C38 28 39 44 35 57" strokeWidth="0.5" opacity=".7" />
      <path d="M32 18C28 14 22 14 18 17 23 17 27 20 32 21zM32 18C36 14 42 14 46 17 41 17 37 20 32 21zM32 18C30 14 30 10 32 8 34 10 34 14 32 18z" fill={PAPER} />
      <path d="M32 18V10" strokeWidth="1.2" />
    </>
  ),
  turmeric: (
    <>
      <g transform="rotate(-32 32 36)">
        <Solid
          id="tur1"
          d="M8 28C8 24 12 22 16 22H44C50 22 54 24 54 28 54 32 50 34 44 34H16C12 34 8 32 8 28z"
          from={26}
          n={14}
          step={2}
          slant={5}
          y0={20}
          y1={36}
        />
        <Solid
          id="tur2"
          d="M10 46C10 42 14 40 18 40H44C50 40 54 42 54 46 54 50 50 52 44 52H18C14 52 10 50 10 46z"
          from={28}
          n={14}
          step={2}
          slant={5}
          y0={38}
          y1={54}
        />
        <path d="M18 24V32M26 24V32M34 24V32M42 24V32M20 42V50M28 42V50M36 42V50M44 42V50" strokeWidth="0.5" />
      </g>
      <Leaf x={50} y={20} a={-70} l={18} w={5} veins={3} />
    </>
  ),
  walnuts: (
    <>
      <Solid id="wal" d="M24 12C36 10 44 18 44 28 44 40 36 48 24 48 14 48 8 40 8 30 8 20 14 14 24 12z" from={20} n={9} />
      <path d="M24 12C20 24 20 36 24 48" strokeWidth="0.8" />
      <g strokeWidth="0.9">
        {ticks([
          [14, 22, 15, 23],
          [14, 34, 15, 35],
          [32, 20, 33, 21],
          [34, 36, 35, 37],
          [30, 28, 31, 29],
        ])}
      </g>
      <path d="M36 44C36 38 42 36 46 38 50 36 56 38 56 44 56 52 50 56 46 54 42 56 36 52 36 44z" fill={PAPER} />
      <path d="M46 38V54M40 42Q43 44 46 42M52 42Q49 44 46 42M40 48Q43 50 46 48M52 48Q49 50 46 48" strokeWidth="0.55" />
    </>
  ),
  watermelon: (
    <>
      <path d="M6 24H58C58 42 46 56 32 56 18 56 6 42 6 24z" fill={PAPER} />
      <clipPath id="art-wm">
        <path d="M6 24H58C58 42 46 56 32 56 18 56 6 42 6 24z" />
      </clipPath>
      <g clipPath="url(#art-wm)" strokeWidth="0.7">
        {Array.from({ length: 14 }, (_, i) => (
          <line key={i} x1={6 + i * 4 + 6} y1={44} x2={6 + i * 4 - 6} y2={60} />
        ))}
      </g>
      <path d="M10 24C10 38 20 51 32 51 44 51 54 38 54 24" strokeWidth="0.7" />
      <path d="M6 24H58" />
      <g strokeWidth="1.6">
        {ticks([
          [18, 30, 18.5, 32],
          [28, 34, 28.5, 36],
          [38, 31, 38.5, 33],
          [47, 33, 47.5, 35],
          [24, 42, 24.5, 44],
          [34, 43, 34.5, 45],
          [42, 41, 42.5, 43],
        ])}
      </g>
      <path d="M32 24V14M22 24L18 16M42 24L46 16" strokeWidth="0" />
    </>
  ),
  "aged cheese": (
    <>
      <Solid id="cheese" d="M6 48L58 48 58 30 6 48z" from={28} n={12} step={2} slant={6} y0={26} y1={52} />
      <path d="M58 30L48 24 6 42" fill={PAPER} />
      <path d="M6 42L6 48M6 42L48 24" />
      <circle cx="22" cy="46" r="2.2" fill={PAPER} />
      <circle cx="34" cy="44" r="3" fill={PAPER} />
      <circle cx="46" cy="40" r="2.4" fill={PAPER} />
      <circle cx="40" cy="28" r="1.6" fill={PAPER} />
      <path d="M6 48H58" strokeWidth="1.6" />
    </>
  ),
};

/** Keys that borrow another food's drawing. */
export const MORE_ALIAS: Record<string, string> = {
  "green grapes": "grapes",
};
