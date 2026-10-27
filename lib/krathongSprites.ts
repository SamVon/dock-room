// The krathong: a small lotus boat with a candle. One drawing, recolored per design.
import type { KrathongVariant } from "@/shared/interactions";
import { pixelArt, type PixelImage } from "./pixel";

export const KRATHONG_WIDTH = 9;
export const KRATHONG_HEIGHT = 8;

const BODY = ["....c....", "..p.c.p..", ".pPpcpPp.", "pPPpppPPp", ".ggggggg.", "..ggggg.."];
// The candle flame flickers: small, tall, small.
const FRAMES = [
  [".........", "....f....", ...BODY],
  ["....f....", "....F....", ...BODY],
  [".........", "....F....", ...BODY],
];

const PETALS: Record<KrathongVariant, [string, string]> = {
  "lotus-pink": ["#FF8FBA", "#FFC2D9"],
  "lotus-white": ["#E4DCF5", "#FFFFFF"],
  "banana-leaf": ["#5E9A4A", "#9FD88A"],
  "gold-flower": ["#F2B01E", "#FFF1A8"],
  "purple-flower": ["#9B7BD8", "#D8C4FF"],
};

export function krathongSheet(variant: KrathongVariant): PixelImage & { frames: number } {
  const [petal, light] = PETALS[variant] ?? PETALS["lotus-pink"];
  const colors = { p: petal, P: light, g: "#3E7240", c: "#FFF1DB", f: "#FFB347", F: "#FFE9A8" };
  return { ...pixelArt(FRAMES, colors, `krathong:${variant}`), frames: FRAMES.length };
}

/** A ring spreading on the water where a krathong is set down: three sizes, then gone. */
export function rippleSheet(): PixelImage & { frames: number } {
  const frames = [
    [".............", ".....www.....", "....w...w....", ".....www.....", "............."],
    [".............", "...wwwwwww...", "..w.......w..", "...wwwwwww...", "............."],
    ["..vvvvvvvvv..", ".v.........v.", "v...........v", ".v.........v.", "..vvvvvvvvv.."],
    [".............", ".............", ".............", ".............", "............."],
  ];
  return { ...pixelArt(frames, { w: "#FFFFFF", v: "#FFFFFF88" }, "krathong:ripple"), frames: frames.length };
}
