// The registries that turn an event's configuration into something on screen.
//
// An event config only lists names ("lanterns", "snow", "rain"). Each name is looked up here.
// To add a decoration: draw its sprite, add one entry below, and it can be used by any event.
// A name with no entry is simply skipped, so a wrong config can never break the room.
import type { ReactNode } from "react";
import { DuckSprite } from "@/components/Duck";
import { PixelImg } from "@/components/pixel/ui";
import {
  GrassStrip,
  HorizonStrip,
  OnGrass,
  OnHorizon,
  PixelCloud,
  RIVER_HEIGHT,
  RIVER_TOP,
  Scatter,
  SheetSprite,
  type SceneContext,
  type SceneLayout,
  type Spot,
} from "@/components/scene/parts";
import { firework, racingBoat, sprite, type SpriteName } from "@/lib/sceneSprites";
import type { DuckColorId } from "@/shared/protocol";
import { SakuraPetalParticles } from "./SakuraPetalParticles";

// --- Scenes -------------------------------------------------------------------------

/** A scene is a layout plus a palette. The palette's colors are in globals.css ([data-palette]). */
export const sceneRegistry: Record<string, { layout: SceneLayout; palette?: string }> = {
  "duck-valley": { layout: "pond" },
  "riverside-festival": { layout: "river", palette: "festival" },
  "haunted-duck-village": { layout: "pond", palette: "spooky" },
  "snowy-duck-village": { layout: "pond", palette: "snow" },
  "rainy-duck-valley": { layout: "pond", palette: "rainy" },
  "flower-garden": { layout: "pond", palette: "blossom" },
  "pi-mai-festival": { layout: "river", palette: "bright" },
  "festival-town-night": { layout: "pond", palette: "gala" },
  "moonlit-pond": { layout: "pond", palette: "moonlit" },
  "sakura-duck-valley": { layout: "pond", palette: "sakura" },
  "loy-krathong-river": { layout: "river", palette: "krathong" },
};

/** Unknown scene names fall back to plain Duck Valley. */
export const resolveScene = (name: string | undefined) => sceneRegistry[name ?? ""] ?? sceneRegistry["duck-valley"];

// --- Decorations --------------------------------------------------------------------

/** Where a decoration is drawn. One decoration can have parts in several layers. */
export type DecorationLayer = "sky" | "horizon" | "ground" | "water";
type Decoration = Partial<Record<DecorationLayer, (context: SceneContext) => ReactNode>>;

const scatter = (name: SpriteName, spots: readonly Spot[]) => ({ night }: SceneContext) => <Scatter name={name} night={night} spots={spots} />;
const overHorizon = (name: SpriteName, scale: number) => ({ night }: SceneContext) => <HorizonStrip image={sprite(name, night)} scale={scale} lift={64} />;
const standing = (name: SpriteName, places: readonly (readonly [left: string, scale: number, desktopOnly?: boolean])[]) => ({ night }: SceneContext) =>
  places.map(([left, scale, desktopOnly]) => <OnHorizon key={left} name={name} night={night} left={left} scale={scale} className={desktopOnly ? "hidden md:block" : ""} />);

// Lantern poles: along the far river bank, or around the pond. [left %, hide on phones]
const BANK_LANTERNS: [number, boolean][] = [
  [5, false],
  [22, true],
  [40, false],
  [58, true],
  [76, false],
  [93, true],
];
const POND_LANTERNS: Spot[] = [
  [14, 4],
  [44, 2, 4, true],
  [84, 6],
  [93, 46, 4, true],
  [4, 60, 4, true],
];

function BankLanterns({ night, name }: { night: boolean; name: SpriteName }) {
  const image = sprite(name, night);
  return BANK_LANTERNS.map(([left, desktopOnly]) => (
    <PixelImg
      key={left}
      image={image}
      scale={4}
      className={`absolute ${desktopOnly ? "hidden sm:block" : ""}`}
      style={{ left: `${left}%`, top: `calc(${RIVER_TOP}% - ${image.height * 4 - 6}px)` }}
    />
  ));
}

/** At night each lantern on the bank throws a warm, flickering reflection onto the river. */
const lanternGlow = ({ night, layout }: SceneContext) =>
  night &&
  layout === "river" &&
  BANK_LANTERNS.map(([left, desktopOnly], i) => (
    <div key={left} className={`lantern-glow absolute top-0 h-[70%] w-3 ${desktopOnly ? "hidden sm:block" : ""}`} style={{ left: `calc(${left}% + 16px)`, animationDelay: `${-i * 0.4}s` }} />
  ));

const lanterns = (name: SpriteName) => ({ night, layout }: SceneContext) =>
  layout === "river" ? <BankLanterns night={night} name={name} /> : <Scatter name={name} night={night} spots={POND_LANTERNS} />;

// Racing boats: [team color by day, by night, lane as % of the river, seconds to cross, start delay]
const BOATS: [string, string, number, number, number][] = [
  ["#EF6D64", "#B8504E", 4, 17, -3],
  ["#3F82C9", "#4A6FA8", 34, 21, -12],
  ["#4FA545", "#4E7F4A", 64, 15, -8],
];
// Ducks cheering from the far side: [color, left %, hide on phones]
const CROWD: [DuckColorId, number, boolean][] = [
  ["white", 14, false],
  ["orange", 31, true],
  ["purple", 49, false],
  ["mint", 66, true],
  ["red", 84, false],
];

const stalls: Decoration = { horizon: standing("stall", [["40%", 4], ["66%", 4, true]]) };

export const decorationRegistry: Record<string, Decoration> = {
  lanterns: { ground: lanterns("paperLantern"), water: lanternGlow },
  heartLanterns: { ground: lanterns("heartLantern"), water: lanternGlow },
  sakuraLanterns: { ground: lanterns("sakuraLantern"), water: lanternGlow },
  // Cherry trees along the horizon in front of the pines, and two large ones framing the grass.
  sakuraTrees: {
    horizon: standing("sakuraTree", [["16%", 6], ["36%", 5, true], ["50%", 7], ["70%", 5], ["84%", 6, true]]),
    ground: ({ night }) => (
      <>
        <Scatter name="petalPatch" night={night} spots={[[6, 30, 3], [20, 70, 3], [34, 14, 3], [62, 84, 3, true], [78, 22, 3], [90, 66, 3], [48, 92, 3, true]]} />
      </>
    ),
    // A few petals rest on the water.
    water: ({ night }) => <PixelImg image={sprite("petalPatch", night)} scale={3} className="absolute top-[30%] left-[24%]" />,
  },
  sakuraBranches: {
    sky: ({ night }) => (
      <>
        <PixelImg image={sprite("sakuraBranch", night)} scale={6} className="wind-sway absolute top-0 left-0 hidden sm:block" />
        <PixelImg image={sprite("sakuraBranch", night)} scale={5} className="wind-sway absolute top-0 right-0 hidden -scale-x-100 md:block" style={{ transformOrigin: "100% 0" }} />
      </>
    ),
  },
  flowerGarden: {
    ground: ({ night }) => (
      <>
        <Scatter name="flowerA" night={night} spots={[[4, 18, 3], [10, 8, 3], [16, 14, 3], [88, 6, 3], [94, 14, 3], [82, 12, 3]]} />
        <Scatter name="flowerB" night={night} spots={[[7, 12, 3], [13, 20, 3], [91, 9, 3], [85, 18, 3]]} />
      </>
    ),
  },
  // The valley already has a bridge by the pond; the festival adds a second, smaller one.
  woodenBridge: { ground: scatter("bridge", [[60, 84, 3]]) },
  // Off to the side of the walking area: a blanket, a basket, tea, a bench, and a tea stand behind.
  sakuraPicnicArea: {
    horizon: standing("teaStand", [["60%", 4, true]]),
    ground: ({ night }) => (
      <>
        <OnGrass name="picnicBlanket" night={night} left={86} top={66} className="hidden sm:block" />
        <OnGrass name="basket" night={night} left={93} top={58} scale={3} className="hidden sm:block" />
        <OnGrass name="teaSet" night={night} left={88} top={70} scale={3} className="hidden sm:block" />
        <OnGrass name="bench" night={night} left={4} top={52} />
      </>
    ),
  },
  festivalFlags: {
    horizon: overHorizon("bunting", 4),
    // By a river, a second line of flags marks the near bank.
    ground: ({ night, layout }) => layout === "river" && <GrassStrip image={sprite("bunting", night)} scale={3} top={RIVER_TOP + RIVER_HEIGHT + 2} />,
  },
  flowerGarlands: { horizon: overHorizon("garland", 4) },
  stringLights: { horizon: overHorizon("bulbs", 4) },
  fairyLights: { horizon: overHorizon("fairyBulbs", 4) },
  racingBoats: {
    // Boats need a river; on a pond scene this decoration quietly does nothing.
    water: ({ night, layout }) =>
      layout === "river" &&
      BOATS.map(([day, dark, lane, seconds, delay]) => (
        <div key={day} className="boat-race absolute left-0" style={{ top: `${lane}%`, animationDuration: `${seconds}s`, animationDelay: `${delay}s` }}>
          <SheetSprite sheet={racingBoat(night ? dark : day, night)} scale={4} seconds={0.5} />
        </div>
      )),
  },
  drums: {
    ground: ({ night, layout }) => <Scatter name="drum" night={night} spots={layout === "river" ? [[24, 3], [71, 3, 4, true], [4, 62]] : [[6, 60], [88, 72, 4, true]]} />,
  },
  // Where ducks take a krathong. It stands at the same spot as the "krathong-stall-01" zone in shared/interactions.ts.
  krathongStall: { horizon: standing("krathongStall", [["40%", 4]]) },
  foodStalls: stalls,
  streetStalls: stalls,
  crowd: {
    ground: () =>
      CROWD.map(([color, left, desktopOnly]) => (
        <div key={color} className={`duck-sway absolute ${desktopOnly ? "hidden sm:block" : ""}`} style={{ left: `${left}%`, top: "1%" }}>
          <DuckSprite color={color} animation="dance" size={40} />
        </div>
      )),
  },
  fireworks: {
    // Only against a dark sky.
    sky: ({ night }) =>
      night && (
        <>
          <SheetSprite sheet={firework("#FF8A3C")} scale={5} seconds={5} className="absolute top-[5%] left-[14%]" />
          <SheetSprite sheet={firework("#FFE9A8")} scale={6} seconds={7} delay={-3} className="absolute top-[2%] left-[48%]" />
          <SheetSprite sheet={firework("#FF9EC4")} scale={4} seconds={6} delay={-1.5} className="absolute top-[16%] left-[70%] hidden sm:block" />
        </>
      ),
  },
  rainClouds: {
    sky: ({ night }) => (
      <>
        <PixelCloud name="rainCloud" night={night} top="2%" scale={8} seconds={70} delay={-30} />
        <PixelCloud name="rainCloud" night={night} top="10%" scale={6} seconds={52} delay={-5} />
        <PixelCloud name="rainCloud" night={night} top="18%" scale={7} seconds={84} delay={-60} />
      </>
    ),
  },
  moonReflections: {
    water: ({ night }) => night && <div className="moon-glow absolute top-[10%] right-[18%] h-[80%] w-10" />,
  },
  spookyTrees: { horizon: standing("deadTree", [["18%", 6], ["52%", 5, true], ["84%", 6]]) },
  christmasTree: { horizon: standing("xmasTree", [["46%", 6]]) },
  countdownClock: { horizon: standing("clockTower", [["52%", 5]]) },
  pumpkins: { ground: scatter("pumpkin", [[10, 28], [28, 72, 3], [72, 12], [90, 66, 4, true], [52, 86, 3, true], [20, 6, 3]]) },
  graveyard: { ground: scatter("tombstone", [[78, 4], [86, 9, 3], [70, 16, 3, true], [4, 10, 3]]) },
  candles: { ground: scatter("candle", [[18, 18], [34, 8], [64, 62], [44, 90, 4, true], [82, 30], [8, 76, 4, true]]) },
  snowman: { ground: scatter("snowman", [[72, 4], [6, 44, 3, true]]) },
  gifts: {
    ground: ({ night }) => (
      <>
        <Scatter name="gift" night={night} spots={[[41, 12], [55, 10, 3], [14, 66, 3, true]]} />
        <Scatter name="giftBlue" night={night} spots={[[48, 14, 3], [86, 58, 3, true]]} />
      </>
    ),
  },
  puddles: { ground: scatter("puddle", [[10, 62], [30, 86, 3, true], [76, 80], [86, 26, 3], [22, 12, 3]]) },
  waterBuckets: { ground: scatter("bucket", [[16, 60], [60, 64, 3], [86, 74, 4, true], [36, 4, 3]]) },
  flowers: {
    ground: ({ night }) => (
      <>
        <Scatter name="flowerA" night={night} spots={[[4, 20, 3], [12, 48, 3], [24, 6, 3], [36, 78, 3], [58, 6, 3], [70, 90, 3], [82, 20, 3], [94, 70, 3]]} />
        <Scatter name="flowerB" night={night} spots={[[8, 82, 3], [18, 30, 3], [44, 92, 3], [64, 14, 3], [78, 62, 3], [90, 40, 3], [50, 2, 3]]} />
      </>
    ),
  },
};

// --- Particles and weather ----------------------------------------------------------

/**
 * Each particle effect is one element: a small tile of pixels that repeats and scrolls.
 * `motion` picks the CSS animation; bats and fog are drawn in their own way.
 */
export type ParticleConfig =
  | { kind: "tile"; motion: "fall" | "rise" | "twinkle"; seconds: number; drift?: boolean; nightOnly?: boolean; /** Spread the tile out, for effects that should be sparse. */ sparse?: boolean }
  | { kind: "custom"; render: (night: boolean) => ReactNode };

export const particleRegistry: Record<string, ParticleConfig> = {
  snow: { kind: "tile", motion: "fall", seconds: 9, drift: true },
  rain: { kind: "tile", motion: "fall", seconds: 0.8 },
  hearts: { kind: "tile", motion: "rise", seconds: 16, sparse: true },
  confetti: { kind: "tile", motion: "fall", seconds: 6, drift: true },
  sparkles: { kind: "tile", motion: "twinkle", seconds: 2.4, sparse: true },
  fireflies: { kind: "tile", motion: "twinkle", seconds: 3.2, nightOnly: true, sparse: true },
  petals: { kind: "tile", motion: "fall", seconds: 18, drift: true, sparse: true },
  flowers: { kind: "tile", motion: "fall", seconds: 22, drift: true, sparse: true },
  "falling-leaves": { kind: "tile", motion: "fall", seconds: 10, drift: true },
  "water-splash": { kind: "tile", motion: "fall", seconds: 3.5, sparse: true },
  // Individual petals rather than a tile: each has its own speed, drift and size.
  sakuraPetals: { kind: "custom", render: (night) => <SakuraPetalParticles night={night} /> },
  bats: {
    kind: "custom",
    render: (night) => (
      <>
        <PixelCloud name="bat" night={night} top="8%" scale={4} seconds={26} delay={-4} />
        <PixelCloud name="bat" night={night} top="20%" scale={3} seconds={34} delay={-19} />
      </>
    ),
  },
  fog: {
    kind: "custom",
    render: () => (
      <>
        <div className="fog-band absolute inset-x-[-10%] top-[44%] h-10" />
        <div className="fog-band absolute inset-x-[-10%] top-[62%] h-14" style={{ animationDelay: "-6s" }} />
      </>
    ),
  },
};

/** Weather is a bundle: which particles fall, which palette tints the world, and a few extras. */
export const weatherRegistry: Record<string, { particles: string[]; palette?: string; hideSun?: boolean; lightning?: boolean }> = {
  clear: { particles: [] },
  rain: { particles: ["rain"], palette: "rainy", hideSun: true },
  storm: { particles: ["rain"], palette: "rainy", hideSun: true, lightning: true },
  snow: { particles: ["snow"], palette: "snow" },
  mist: { particles: ["fog"] },
  wind: { particles: ["falling-leaves"] },
  "night-stars": { particles: ["sparkles"] },
};

export const resolveWeather = (name: string | undefined) => weatherRegistry[name ?? "clear"] ?? weatherRegistry.clear;
