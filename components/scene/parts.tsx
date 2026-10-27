// Small building blocks shared by the scene and by event decorations.
import type { CSSProperties } from "react";
import type { PixelImage } from "@/lib/pixel";
import { sprite, type SpriteName } from "@/lib/sceneSprites";
import { PixelImg } from "../pixel/ui";

/** Where the sky ends and the grass begins, in percent from the top. */
export const HORIZON = 42;
/** The river of the "river" layout, in percent of the grass area. */
export const RIVER_TOP = 17;
export const RIVER_HEIGHT = 34;

/** A scene is laid out around a pond or around a river. Decorations adapt to it. */
export type SceneLayout = "pond" | "river";
export type SceneContext = { night: boolean; layout: SceneLayout };

const stripStyle = (image: PixelImage, scale: number): CSSProperties => ({
  height: image.height * scale,
  backgroundImage: `url("${image.url}")`,
  backgroundSize: `${image.width * scale}px ${image.height * scale}px`,
  backgroundRepeat: "repeat-x",
});

/** A sprite repeated across the screen, hanging `lift` pixels above the horizon (mountains, flags, lights). */
export function HorizonStrip({ image, scale, lift = 0 }: { image: PixelImage; scale: number; lift?: number }) {
  return <div className="pixel-art absolute inset-x-0" style={{ ...stripStyle(image, scale), bottom: `calc(${100 - HORIZON}% + ${lift}px)` }} />;
}

/** A sprite repeated across the grass, at `top` percent of the grass area. */
export function GrassStrip({ image, scale, top }: { image: PixelImage; scale: number; top: number }) {
  return <div className="pixel-art absolute inset-x-0" style={{ ...stripStyle(image, scale), top: `${top}%` }} />;
}

export function PixelCloud({ night, top, scale, seconds, delay, name = "cloud" }: { night: boolean; top: string; scale: number; seconds: number; delay: number; name?: SpriteName }) {
  return (
    <div className="cloud-drift absolute left-0" style={{ top, animationDuration: `${seconds}s`, animationDelay: `${delay}s` }}>
      <PixelImg image={sprite(name, night)} scale={scale} />
    </div>
  );
}

/** Something standing on the horizon line (trees, the cottage, food stalls). */
export function OnHorizon({ name, night, left, scale, className = "" }: { name: SpriteName; night: boolean; left: string; scale: number; className?: string }) {
  return <PixelImg image={sprite(name, night)} scale={scale} className={`absolute ${className}`} style={{ left, bottom: `calc(${100 - HORIZON}% - 8px)` }} />;
}

/** Something lying on the grass. `left` and `top` are percentages of the grass area. */
export function OnGrass({ name, night, left, top, scale = 4, className = "" }: { name: SpriteName; night: boolean; left: number; top: number; scale?: number; className?: string }) {
  return <PixelImg image={sprite(name, night)} scale={scale} className={`absolute ${className}`} style={{ left: `${left}%`, top: `${top}%` }} />;
}

/** A sprite sheet whose frames play one after another, like the duck sprites. */
export function SheetSprite({ sheet, scale, seconds, delay = 0, className = "" }: { sheet: PixelImage & { frames: number }; scale: number; seconds: number; delay?: number; className?: string }) {
  return (
    <div
      className={`sprite-sheet pixel-art ${className}`}
      style={
        {
          "--w": `${(sheet.width / sheet.frames) * scale}px`,
          "--h": `${sheet.height * scale}px`,
          "--frames": sheet.frames,
          "--duration": `${seconds}s`,
          backgroundImage: `url("${sheet.url}")`,
          animationDelay: `${delay}s`,
        } as CSSProperties
      }
    />
  );
}

/** Several copies of one sprite on the grass: [left %, top %, scale?, hide on phones?]. */
export type Spot = readonly [left: number, top: number, scale?: number, desktopOnly?: boolean];
export function Scatter({ name, night, spots }: { name: SpriteName; night: boolean; spots: readonly Spot[] }) {
  return spots.map(([left, top, scale, desktopOnly]) => (
    <OnGrass key={`${left}-${top}`} name={name} night={night} left={left} top={top} scale={scale ?? 4} className={desktopOnly ? "hidden sm:block" : ""} />
  ));
}
