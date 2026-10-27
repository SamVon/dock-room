// The duck, drawn by hand on a 16x16 grid, facing right.
//   K outline   B body   S wing / shade   H highlight   W eye shine
//   O beak and feet   D beak shade   C cheek
import type { DuckColorId, HeldItemId } from "@/shared/protocol";
import { pixelArt, type Palette, type PixelImage } from "./pixel";

const BASE = [
  "................",
  ".....KKKKKKK....",
  "....KBBBBBBBK...",
  "...KBHHBBBBBBK..",
  "...KBHBBBBWKBK..",
  "...KBBBBBBKKBKKK",
  "...KBBBBBCBBBOOK",
  "...KBBBBBBBBBDDK",
  "...KBBBBBBBBBKKK",
  "..KKBBBBBBBBK...",
  ".KBBBSSSSBBBBK..",
  ".KBBSSSSSSBBBK..",
  ".KBBBSSSSBBBBK..",
  "..KBBBBBBBBBK...",
  "...KKKKKKKKK....",
  "....OO...OO.....",
];

/** A copy of BASE with some rows replaced. */
const frame = (changes: Record<number, string>) => BASE.map((row, y) => changes[y] ?? row);

const BLINK = frame({ 4: "...KBHBBBBBBBK.." });
const STEP_OUT = frame({ 15: "...OO.....OO...." });
const STEP_IN = frame({ 15: "......OO.OO....." });
const QUACK = frame({ 7: "...KBBBBBBBBBKK.", 8: "...KBBBBBBBBBDDK", 9: "..KKBBBBBBBBKKKK" });
const WING_UP = frame({ 10: ".KBSSSSSSBBBBK..", 11: ".KBBBSSSBBBBBK..", 12: ".KBBBBBBBBBBBK.." });

/** Each animation is a strip of frames, played with CSS steps(). */
const ANIMATIONS = {
  idle: [BASE, BASE, BASE, BASE, BASE, BASE, BASE, BLINK],
  walk: [STEP_OUT, STEP_IN],
  quack: [BASE, QUACK, BASE, QUACK],
  dance: [BASE, WING_UP],
  sleep: [BLINK],
} as const;
export type DuckAnimation = keyof typeof ANIMATIONS;

const OUTLINE = "#21191B";
const COMMON = { K: OUTLINE, W: "#FFFFFF", O: "#F58A1F", D: "#C9620F", C: "#FF8FA3" };

// A hand-picked palette per color: body, shade, highlight.
const BODIES: Record<Exclude<DuckColorId, "rainbow">, [string, string, string]> = {
  yellow: ["#FFD84A", "#E9A92C", "#FFF3A6"],
  white: ["#FBF7EC", "#D5CDBB", "#FFFFFF"],
  pink: ["#FF9EC4", "#E0699B", "#FFD3E4"],
  blue: ["#6FB4F2", "#3F82C9", "#BBDFFF"],
  mint: ["#8EE6C4", "#4FBF98", "#D3FFF1"],
  purple: ["#B28CF5", "#7E58C9", "#DDCDFF"],
  orange: ["#FFA552", "#D97328", "#FFD6A8"],
  red: ["#F0605A", "#BC3A3A", "#FFA9A1"],
  black: ["#57526A", "#38344A", "#8A84A3"],
  brown: ["#B07A52", "#7E5034", "#D9A77E"],
  gold: ["#F7C531", "#B9820A", "#FFF7C7"],
};

// Rainbow ducks are striped from head to tail.
const RAINBOW = ["#F0605A", "#FFA552", "#FFD84A", "#7FD66B", "#6FB4F2", "#B28CF5"];
const RAINBOW_SHADE = ["#BC3A3A", "#D97328", "#E9A92C", "#4FA545", "#3F82C9", "#7E58C9"];
const band = (y: number) => Math.min(RAINBOW.length - 1, Math.floor((y - 1) / 2.2));

function paletteFor(color: DuckColorId): Palette {
  if (color === "rainbow") {
    return (char, _x, y) => (char === "B" ? RAINBOW[band(y)] : char === "S" ? RAINBOW_SHADE[band(y)] : char === "H" ? "#FFFFFF" : COMMON[char as keyof typeof COMMON]);
  }
  const [body, shade, highlight] = BODIES[color];
  return { ...COMMON, B: body, S: shade, H: highlight };
}

export const DUCK_PIXELS = 16;

export function duckSheet(color: DuckColorId, animation: DuckAnimation): PixelImage & { frames: number } {
  const frames = ANIMATIONS[animation] as readonly string[][];
  return { ...pixelArt(frames as string[][], paletteFor(color), `duck:${color}:${animation}`), frames: frames.length };
}

// Things a duck can hold. They are drawn on the duck's own 16x16 grid, in front of the wing,
// so they sit in the right place at any size and flip with the duck.
const ITEMS: Record<Exclude<HeldItemId, "none">, { label: string; rows: string[]; colors: Record<string, string> }> = {
  beer: {
    label: "Beer",
    rows: [
      "", "", "", "", "", "",
      "...........www..",
      "..........wwwww.",
      "..........KKKKK.",
      "..........KYyYKK",
      "..........KYyYKK",
      "..........KYYYK.",
      "..........KKKKK.",
    ],
    colors: { K: OUTLINE, w: "#FFF7E6", Y: "#F2A51D", y: "#FFD84A" },
  },
  sword: {
    label: "Sword",
    rows: [
      "",
      ".............K..",
      "............KsK.",
      "............KsK.",
      "............KSK.",
      "............KsK.",
      "............KsK.",
      "............KSK.",
      "............KsK.",
      "...........KGGGK",
      "............KbK.",
      "............KbK.",
      ".............K..",
    ],
    colors: { K: OUTLINE, s: "#E6EEF5", S: "#B9C6D3", G: "#FFD84A", b: "#8A5A3C" },
  },
  flower: {
    label: "Flower",
    rows: [
      "", "", "",
      "............p.p.",
      "...........ppypp",
      "............ppp.",
      ".............g..",
      ".............g..",
      "............gg..",
      ".............g..",
      ".............gg.",
      ".............g..",
    ],
    colors: { p: "#EF6D64", y: "#FFD84A", g: "#2F6B34" },
  },
  gun: {
    label: "Gun",
    rows: [
      "", "", "", "", "", "", "", "",
      "..........KKKKKK",
      "..........KmmmMK",
      "..........KmKKKK",
      "..........KbK...",
      "..........KKK...",
    ],
    colors: { K: OUTLINE, m: "#9AA1AE", M: "#5C6370", b: "#8A5A3C" },
  },
};

export const itemLabel = (item: HeldItemId) => (item === "none" ? "Nothing" : ITEMS[item].label);

/** The item as a full 16x16 overlay for a duck sprite, or null for empty wings. */
export function itemOverlay(item: HeldItemId): PixelImage | null {
  if (item === "none") return null;
  const { rows, colors } = ITEMS[item];
  const full = Array.from({ length: DUCK_PIXELS }, (_, y) => (rows[y] ?? "").padEnd(DUCK_PIXELS, "."));
  return pixelArt(full, colors, `item:${item}`);
}

/** Just the item, cropped to its own pixels, for buttons and menus. */
export function itemIcon(item: HeldItemId): PixelImage | null {
  if (item === "none") return null;
  const { rows, colors } = ITEMS[item];
  const used = rows.filter((row) => /[^.]/.test(row));
  const left = Math.min(...used.map((row) => row.search(/[^.]/)));
  return pixelArt(used.map((row) => row.slice(left).replace(/\.+$/, "")), colors, `icon:${item}`);
}
