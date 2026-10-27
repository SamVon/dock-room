// Pixel art for every wearable in shared/cosmetics.ts, drawn as text like the rest of the game.
// One character is one duck pixel, so items line up with the 16x16 duck at any size.
import { pixelArt, type Palette, type PixelImage } from "./pixel";

const K = "#21191B";
const RAINBOW = ["#F0605A", "#FFA552", "#FFD84A", "#7FD66B", "#6FB4F2", "#B28CF5"];

const CAP = [
  "...KKKKKK....",
  "..KBBBBBBK...",
  ".KBbBBBBBBK..",
  ".KBBBBBBBBBKK",
  ".KKKKKKKKKDDK",
  ".........KKK.",
];
const BRIMMED = [
  "....KKKKKKK....",
  "...KYYYYYYYK...",
  "...KRRRRRRRK...",
  ".KKKKKKKKKKKKK.",
  "KYyYYyYYYyYYyYK",
  ".KKKKKKKKKKKKK.",
];

const SPRITES: Record<string, { rows: string[]; colors: Palette }> = {
  "broken-egg": {
    rows: ["...KKKKKKK...", "..KWWWWWWWK..", ".KWWWWWWwWWK.", "KWWWWWWWWWwWK", "KWWKWWWKWWWKK", ".KK.KKK.KKK.."],
    colors: { K, W: "#FFFDF5", w: "#E4DCC8" },
  },
  "blue-cap": { rows: CAP, colors: { K, B: "#4F8FE0", b: "#9CC8FF", D: "#2F62A8" } },
  "red-cap": { rows: CAP, colors: { K, B: "#EF6D64", b: "#FFB0A8", D: "#B84A47" } },
  "rainbow-cap": {
    rows: CAP,
    // Striped across the cap, one color per two pixels.
    colors: (char, x) => (char === "K" ? K : char === "D" ? "#7E58C9" : char === "B" || char === "b" ? RAINBOW[Math.min(5, Math.floor((x - 1) / 2))] : undefined),
  },
  "bucket-hat": {
    rows: ["...KKKKKKK...", "..KCCCCCCCK..", "..KCcCCCCCK..", ".KKKKKKKKKKK.", "KCCCCCCCCCCCK", ".KKKKKKKKKKK."],
    colors: { K, C: "#E9D6A8", c: "#FFF3D0" },
  },
  headphones: {
    rows: [".kkkkkkk.", "k.......k", "k........", "KKKK.....", "KRrK.....", "KRRK.....", "KKKK....."],
    colors: { K, k: "#3A3040", R: "#EF6D64", r: "#FFB0A8" },
  },
  "straw-hat": { rows: BRIMMED, colors: { K, Y: "#F2CF7A", y: "#D9A94E", R: "#EF6D64" } },
  "floral-hat": {
    rows: BRIMMED.map((row, y) => (y === 2 ? "...KpwpgpwpK..." : row)),
    colors: { K, Y: "#F2CF7A", y: "#D9A94E", p: "#FF8FBA", w: "#FFFDF5", g: "#4FA545" },
  },
  flower: {
    rows: ["..p.p..", ".ppypp.", "..ppp..", "...g...", "..gg..."],
    colors: { p: "#FF8FBA", y: "#FFD84A", g: "#2F6B34" },
  },
  "duck-headband": {
    rows: ["...KKK...", "..KYYYK..", "..KYWKOK.", "..KYYYK..", "KKKKKKKKK", "KbbbbbbbK", "KKKKKKKKK"],
    colors: { K, Y: "#FFD84A", W: "#FFFFFF", O: "#F58A1F", b: "#6FB4F2" },
  },
  "gold-crown": {
    rows: ["K...K...K", "KY.KYK.YK", "KYYYYYYYK", "KYRYBYRYK", "KKKKKKKKK"],
    colors: { K, Y: "#FFD84A", R: "#EF6D64", B: "#6FB4F2" },
  },
  "witch-hat": {
    rows: [
      ".......KK....",
      "......KPPK...",
      ".....KPPPK...",
      "....KPpPPK...",
      "...KPPPPPPK..",
      "...KOOOYOOK..",
      "KKKKPPPPPPKKK",
      "KPPPPPPPPPPPK",
      ".KKKKKKKKKKK.",
    ],
    colors: { K, P: "#6B4AA8", p: "#9B7BD8", O: "#F58A1F", Y: "#FFD84A" },
  },
  "pumpkin-hat": {
    rows: ["....Kgg....", "....KgK....", "..KKKKKKK..", ".KOoOOoOOK.", "KOoOOoOOoOK", "KOKKOOOKKOK", "KOoOKKKOoOK", ".KKKKKKKKK."],
    colors: { K, O: "#F58A1F", o: "#FFB04A", g: "#4FA545" },
  },
  "ghost-hood": {
    rows: ["...KKKKKKK...", "..KWWWWWWWK..", ".KWWKWWWKWWK.", "KWWWKWWWKWWWK", "KWWWWWWWWWWWK", "KKWKKKWKKKWKK"],
    colors: { K, W: "#F4F1FF" },
  },
  "santa-hat": {
    rows: ["........KKK..", ".....KKKRRKWW", "...KKRRRRRKWW", "..KRRRRRRKKK.", ".KRRRRRRRRK..", "KWWWWWWWWWWK.", "KKKKKKKKKKKK."],
    colors: { K, R: "#E0443E", W: "#FFFDF5" },
  },
  "reindeer-antlers": {
    rows: ["..b.b...b.b..", "..bbb...bbb..", "...b.....b...", "...b.....b...", ".KKKKKKKKKKK.", ".KrrrrrrrrrK."],
    colors: { K, b: "#8A5A3C", r: "#E0443E" },
  },
  "snowman-hat": {
    rows: [".KwKwKwK.", ".KkkkkkK.", ".KkkkkkK.", ".KRRRRRK.", "KKKKKKKKK", "KkkkkkkkK", "KKKKKKKKK"],
    colors: { K, k: "#3A3040", R: "#E0443E", w: "#FFFDF5" },
  },
  "heart-headband": {
    rows: [".r.r...r.r.", "rRrrr.rRrrr", ".rrr...rrr.", "..r.....r..", "..k.....k..", ".ppppppppp."],
    colors: { r: "#EF4D6E", R: "#FFB0C0", k: "#3A3040", p: "#FF8FBA" },
  },
  "rose-crown": {
    rows: [".rr.rr.rr.rr.", "rRrgrRrgrRrgr", ".rr.rr.rr.rr.", "ggggggggggggg"],
    colors: { r: "#E0443E", R: "#FF8F8A", g: "#2F6B34" },
  },
  "pink-bow": {
    rows: ["KK.....KK", "KpK.K.KpK", "KpPKPKPpK", "KpK.K.KpK", "KK.....KK"],
    colors: { K, p: "#FF8FBA", P: "#E0699B" },
  },
  "flower-garland": {
    rows: [".yy.ww.yy.ww.", "yoyywoyyoyywo", ".yy.ww.yy.ww.", "ggggggggggggg"],
    colors: { y: "#FFD84A", o: "#F58A1F", w: "#FFFDF5", g: "#4FA545" },
  },
  "festival-headband": {
    rows: [".........p.p.", "KKKKKKKKKpypK", "KaAaAaAaAppp.", "KKKKKKKKKK..."],
    colors: { K, a: "#F58A1F", A: "#FFD84A", p: "#FF8FBA", y: "#FFFDF5" },
  },
  "racing-headband": {
    rows: ["rr...........", ".rrKKKKKKKKKK", "rr.KRRwRRwRRK", "r..KKKKKKKKKK"],
    colors: { K, r: "#E0443E", R: "#E0443E", w: "#FFFDF5" },
  },
  "festival-scarf": {
    rows: ["...KKKKKKK...", "..KcCcCcCcK..", "KKCcCcCcCcCK.", "KcKKKKKKKKKK.", "KK..........."],
    colors: { K, c: "#4F8FE0", C: "#FFFDF5" },
  },
  "boat-captain-hat": {
    rows: ["...KKKKKKKK..", "..KWWWWWWWWK.", "..KWWWGGWWWK.", ".KKKKKKKKKKKK", ".KNNNNNNNNNNK", ".KKKKKKKKKKK."],
    colors: { K, W: "#FFFDF5", G: "#FFD84A", N: "#2F3F78" },
  },
  "sakura-flower-crown": {
    rows: [".pp.ww.pp.ww.", "pyppwywwpyppw", ".pp.ww.pp.ww.", "ggggggggggggg"],
    colors: { p: "#F4A6C5", w: "#FFD7E5", y: "#FFD84A", g: "#5E9A4A" },
  },
  "sakura-hair-clip": {
    rows: [".p.p.", "ppypp", ".ppp.", "..p.."],
    colors: { p: "#F4A6C5", y: "#FFD84A" },
  },
  "pink-ribbon": {
    rows: ["KK.....KK..", "KpK.K.KpK..", "KpPKPKPpK..", "KpK.K.KpK..", "KK.pKp.KK..", "..p...p...."],
    colors: { K, p: "#F4A6C5", P: "#D978A5" },
  },
  "spring-scarf": {
    rows: [".ssSssSssSs", ".SssSssSssS", "KsSK.......", "KSsK.......", "KKKK......."],
    colors: { K, s: "#9FD8A0", S: "#FFD7E5" },
  },
  // A small padlock for items the player cannot use yet.
  lock: {
    rows: [".KKK.", "K...K", "KKKKK", "KYYYK", "KYKYK", "KKKKK"],
    colors: { K, Y: "#FFD84A" },
  },
};

/** The sprite for a wearable id, or null when there is no art for it. */
export function wearableImage(spriteId: string): PixelImage | null {
  const art = SPRITES[spriteId];
  return art ? pixelArt(art.rows, art.colors, `wearable:${spriteId}`) : null;
}

export const hasWearableArt = (spriteId: string) => spriteId in SPRITES;
