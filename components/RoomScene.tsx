// The pixel world behind everything. Layers from back to front:
// sky and clouds, mountains, forest, buildings, water, grass, small details.
//
// What it shows comes from a theme: a scene name, a palette, weather, and a list of decorations.
// The theme is plain configuration (see shared/events.ts and config/events.ts), so a new
// festival needs no change here. Names are looked up in features/events/event-registry.tsx.
import type { ReactNode } from "react";
import { EventDecorations } from "@/features/events/event-renderer";
import { resolveScene, resolveWeather } from "@/features/events/event-registry";
import { mountains, pond, sprite } from "@/lib/sceneSprites";
import { VALLEY_THEME, type EventTheme } from "@/shared/events";
import { PixelImg } from "./pixel/ui";
import { HORIZON, HorizonStrip, OnGrass, OnHorizon, PixelCloud, RIVER_HEIGHT, RIVER_TOP, Scatter, type SceneContext } from "./scene/parts";

const Ripples = ({ spots }: { spots: readonly (readonly [number, number])[] }) =>
  spots.map(([left, top], i) => <div key={i} className="ripple absolute h-1 w-8" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${-i * 0.55}s` }} />);

export function PixelPond({ night, children }: { night: boolean; children?: ReactNode }) {
  return (
    <div className="absolute top-[26%] left-1/2 w-[min(88%,640px)] -translate-x-1/2 sm:left-[56%] sm:w-[min(52%,680px)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={pond(night).url} alt="" aria-hidden draggable={false} className="pixel-art h-auto w-full" />
      <Ripples spots={[[22, 30], [58, 22], [40, 58], [68, 66]]} />
      {children}
    </div>
  );
}

function PixelRiver({ children }: { children?: ReactNode }) {
  return (
    <div className="scene-river absolute inset-x-0 overflow-hidden" style={{ top: `${RIVER_TOP}%`, height: `${RIVER_HEIGHT}%` }}>
      <Ripples spots={[[6, 20], [28, 62], [47, 30], [63, 78], [82, 44], [92, 14]]} />
      {children}
    </div>
  );
}

/** Things that are always on the grass around the pond. */
function PondDetails({ night }: { night: boolean }) {
  return (
    <>
      <Scatter name="fence" night={night} spots={[[0, 2], [86, 2, 4, true]]} />
      <Scatter name="lantern" night={night} spots={[[24, 3], [88, 34, 4, true]]} />
      <OnGrass name="bridge" night={night} left={12} top={36} className="hidden md:block" />
      <Scatter name="bush" night={night} spots={[[3, 22], [92, 16]]} />
      <Scatter name="rock" night={night} spots={[[20, 64], [80, 78, 3, true]]} />
      <OnGrass name="stump" night={night} left={8} top={52} className="hidden sm:block" />
      <Scatter name="mushroom" night={night} spots={[[13, 74, 3], [94, 58, 3, true]]} />
      <OnGrass name="radio" night={night} left={82} top={8} className="hidden sm:block" />
      <Scatter name="flowerA" night={night} spots={[[6, 40, 3], [30, 12, 3], [72, 10, 3], [66, 88, 3], [96, 86, 3]]} />
      <Scatter name="flowerB" night={night} spots={[[16, 20, 3], [46, 8, 3], [90, 44, 3], [28, 82, 3]]} />
    </>
  );
}

/** Things that are always on the near bank of the river. */
function RiverDetails({ night }: { night: boolean }) {
  return (
    <>
      <OnGrass name="bush" night={night} left={90} top={60} />
      <OnGrass name="rock" night={night} left={22} top={84} scale={3} className="hidden sm:block" />
      <OnGrass name="radio" night={night} left={80} top={72} className="hidden sm:block" />
      <Scatter name="flowerA" night={night} spots={[[12, 58, 3], [52, 60, 3], [96, 78, 3], [44, 88, 3]]} />
      <Scatter name="flowerB" night={night} spots={[[34, 64, 3], [68, 66, 3], [8, 86, 3]]} />
    </>
  );
}

export function RoomScene({ night, theme = VALLEY_THEME }: { night: boolean; theme?: EventTheme }) {
  const scene = resolveScene(theme.scene);
  const weather = resolveWeather(theme.weather);
  const palette = (night ? theme.nightPalette : theme.dayPalette) ?? scene.palette ?? weather.palette;
  const context: SceneContext = { night, layout: scene.layout };
  const decorations = theme.decorations ?? [];
  const layer = (name: "sky" | "horizon" | "ground" | "water") => <EventDecorations items={decorations} layer={name} context={context} />;

  return (
    <div className="absolute inset-0 overflow-hidden" data-palette={palette} aria-hidden>
      {/* Layer 1: sky and clouds */}
      <div className="scene-sky absolute inset-x-0 top-0" style={{ height: `${HORIZON}%` }} />
      {night && <div className="stars absolute inset-0" />}
      {(night || !weather.hideSun) && <PixelImg image={sprite("sun", night)} scale={5} className="absolute top-[9%] right-[12%]" />}
      {layer("sky")}
      <PixelCloud night={night} top="5%" scale={7} seconds={90} delay={-20} />
      <PixelCloud night={night} top="15%" scale={5} seconds={64} delay={-45} />
      <PixelCloud night={night} top="24%" scale={4} seconds={48} delay={-8} />

      {/* Layer 2: mountains. Layer 3: forest */}
      <HorizonStrip image={mountains(night)} scale={5} />
      <HorizonStrip image={sprite("pineFar", night)} scale={5} />
      <OnHorizon name="pine" night={night} left="2%" scale={6} className="hidden sm:block" />
      <OnHorizon name="pine" night={night} left="26%" scale={5} />
      <OnHorizon name="pine" night={night} left="33%" scale={4} className="hidden sm:block" />
      <OnHorizon name="pine" night={night} left="62%" scale={6} className="hidden sm:block" />
      <OnHorizon name="pine" night={night} left="78%" scale={5} />
      <OnHorizon name="pine" night={night} left="90%" scale={4} />

      {/* Layer 4: buildings, and whatever the theme puts on the horizon */}
      <OnHorizon name="cottage" night={night} left="9%" scale={5} />
      {layer("horizon")}

      {/* Layer 5: grass, water and small things */}
      <div
        className="scene-ground absolute inset-x-0 bottom-0"
        style={{ top: `${HORIZON}%`, backgroundImage: `url("${sprite(palette === "snow" ? "snowGround" : "grass", night).url}")` }}
      >
        {scene.layout === "river" ? (
          <>
            <PixelRiver>{layer("water")}</PixelRiver>
            <RiverDetails night={night} />
          </>
        ) : (
          <>
            <PixelPond night={night}>{layer("water")}</PixelPond>
            <PondDetails night={night} />
          </>
        )}
        {layer("ground")}
      </div>
    </div>
  );
}
