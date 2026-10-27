"use client";

import { memo, useEffect, useState, type CSSProperties } from "react";
import { duckMoves } from "@/features/stickers/duck-moves";
import { DUCK_PIXELS, duckSheet, itemOverlay, type DuckAnimation } from "@/lib/duckSprites";
import { sprite } from "@/lib/sceneSprites";
import { KRATHONG_HEIGHT, KRATHONG_WIDTH, krathongSheet } from "@/lib/krathongSprites";
import { wearableImage } from "@/lib/wearableSprites";
import { DUCK_ANCHORS, findWearable, type Equipment, type WearableCategory } from "@/shared/cosmetics";
import { KRATHONGS, type KrathongVariant } from "@/shared/interactions";
import type { DuckColorId, HeldItemId } from "@/shared/protocol";
import { walkDurationMs } from "@/shared/sync";
import { PixelImg, PixelSpeechBubble } from "./pixel/ui";

// The part of the scene ducks can walk on, in percent from the top.
export const FLOOR_TOP = 48;
export const FLOOR_HEIGHT = 30;

// How long one loop of each animation takes, and how often it repeats.
const TIMING: Record<DuckAnimation, { duration: string; loops?: string }> = {
  idle: { duration: "2.4s" },
  walk: { duration: "0.3s" },
  quack: { duration: "0.6s", loops: "2" },
  dance: { duration: "0.5s" },
  sleep: { duration: "1s" },
};

/**
 * One equipment slot, drawn on top of the duck. Where it goes comes from the catalog
 * (anchor + offset), in duck pixels, so it stays attached at any size and flips with the duck.
 */
export function DuckWearableSlot({ slot, wearableId }: { slot: WearableCategory; wearableId: string | null | undefined }) {
  const wearable = findWearable(wearableId);
  const image = wearable?.category === slot ? wearableImage(wearable.sprite) : null;
  if (!wearable || !image) return null;

  const scale = wearable.scale ?? 1;
  const anchor = DUCK_ANCHORS[wearable.anchor];
  const left = Math.round(anchor.x + wearable.offsetX - (image.width * scale) / 2);
  const top = anchor.y + wearable.offsetY - image.height * scale;
  const px = (pixels: number) => `calc(var(--size) / ${DUCK_PIXELS} * ${pixels})`;

  return (
    <div
      className={`pixel-art absolute ${wearable.effect === "wobble" ? "wear-wobble" : ""}`}
      style={{
        left: px(left),
        top: px(top),
        width: px(image.width * scale),
        height: px(image.height * scale),
        backgroundImage: `url("${image.url}")`,
        backgroundSize: "100% 100%",
      }}
    >
      {wearable.effect === "sparkle" && <span className="wear-sparkle font-pixel absolute -top-2 -right-1 text-[10px] leading-none text-white">✦</span>}
    </div>
  );
}

/** A krathong in the duck's wings: its own layer on the duck's pixel grid, so it moves and flips with the duck. */
export function KrathongCarryLayer({ variant }: { variant: KrathongVariant }) {
  const sheet = krathongSheet(variant);
  const { x, y } = KRATHONGS[variant].carryAnchor;
  const px = (pixels: number) => `calc(var(--size) / ${DUCK_PIXELS} * ${pixels})`;
  return (
    <div
      className="sprite-sheet pixel-art absolute"
      style={{ left: px(x), top: px(y), "--w": px(KRATHONG_WIDTH), "--h": px(KRATHONG_HEIGHT), "--frames": sheet.frames, "--duration": "0.9s", backgroundImage: `url("${sheet.url}")` } as CSSProperties}
    />
  );
}

type SpriteProps = {
  color: DuckColorId;
  animation?: DuckAnimation;
  item?: HeldItemId;
  equipment?: Partial<Equipment>;
  /** A krathong being carried. It takes the place of whatever is normally held in the wing. */
  carried?: KrathongVariant;
  size?: number;
  className?: string;
};

/** One duck sprite. The frames play with CSS steps(), like a classic sprite sheet. */
export function DuckSprite({ color, animation = "idle", item = "none", equipment, carried, size, className = "" }: SpriteProps) {
  const sheet = duckSheet(color, animation);
  const held = carried ? null : itemOverlay(item);
  const timing = TIMING[animation];
  return (
    <div
      aria-hidden
      className={`duck-sprite pixel-art relative shrink-0 ${className}`}
      style={
        {
          ...(size ? { "--size": `${size}px` } : {}),
          "--frames": sheet.frames,
          "--duration": timing.duration,
          "--loops": timing.loops ?? "infinite",
          backgroundImage: `url("${sheet.url}")`,
        } as CSSProperties
      }
    >
      {/* Layers above the duck body: back, neck, face, then head, then whatever is in its wing. */}
      <DuckWearableSlot slot="back" wearableId={equipment?.back} />
      <DuckWearableSlot slot="neck" wearableId={equipment?.neck} />
      <DuckWearableSlot slot="face" wearableId={equipment?.face} />
      <DuckWearableSlot slot="head" wearableId={equipment?.head} />
      {held && <div className="pixel-art absolute inset-0" style={{ backgroundImage: `url("${held.url}")`, backgroundSize: "100% 100%" }} />}
      {carried && <KrathongCarryLayer variant={carried} />}
    </div>
  );
}

/** In the voice chat: a small microphone, struck through while the duck has it switched off. */
export function VoiceMark({ muted }: { muted: boolean }) {
  return (
    <span className={`relative text-[10px] leading-none ${muted ? "opacity-60" : ""}`} role="img" aria-label={muted ? "Microphone off" : "In voice chat"}>
      🎙
      {muted && <span aria-hidden className="absolute top-1/2 left-1/2 h-0.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[var(--coral)] shadow-[0_0_0_1px_var(--panel)]" />}
    </span>
  );
}

type NameTagProps = { name: string; isSelf: boolean; owner: boolean; dj?: boolean; night: boolean; voice?: "live" | "muted"; speaking?: boolean };

export function DuckNameTag({ name, isSelf, owner, dj, night, voice, speaking }: NameTagProps) {
  return (
    <div className={`pixel-tag flex items-center gap-1 ${isSelf ? "pixel-tag-self" : ""} ${speaking ? "pixel-tag-speaking" : ""}`}>
      {owner && <PixelImg image={sprite("crown", night)} scale={2} />}
      {/* A small headphone mark for DJs. Deliberately plainer than the owner's crown. */}
      {dj && !owner && (
        <span className="text-[10px]" role="img" aria-label="DJ">
          🎧
        </span>
      )}
      {voice && <VoiceMark muted={voice === "muted"} />}
      {name}
    </div>
  );
}

type DuckProps = {
  color: DuckColorId;
  item: HeldItemId;
  equipment: Equipment;
  carried?: KrathongVariant;
  name: string;
  x: number;
  y: number;
  dancing: boolean;
  sleeping: boolean;
  /** The user's connection is down; the duck waits in the room for them, faded. */
  away?: boolean;
  isSelf: boolean;
  owner: boolean;
  dj: boolean;
  night: boolean;
  bubble?: { id: string; text: string };
  /** A sticker this duck just sent, shown above its head. */
  sticker?: { id: number; icon: string };
  /** The shared sticker interaction this duck is in, if any, and which way its partner is. */
  interaction?: string;
  partnerOnLeft?: boolean;
  /** In the voice chat, with the microphone on or off. */
  voice?: "live" | "muted";
  /** Making sound in the voice chat right now. */
  speaking?: boolean;
};

// Memoized: when one duck moves, the others (and their outfits) are not drawn again.
export const Duck = memo(function Duck({ color, item, equipment, carried, name, x, y, dancing, sleeping, away, isSelf, owner, dj, night, bubble, sticker, interaction, partnerOnLeft, voice, speaking }: DuckProps) {
  // Work out walk time and direction in the same render as the new position,
  // so the CSS transition starts with the right duration.
  const [motion, setMotion] = useState({ x, y, ms: 0, left: false });
  if (motion.x !== x || motion.y !== y) {
    setMotion({ x, y, ms: walkDurationMs(motion, { x, y }), left: x === motion.x ? motion.left : x < motion.x });
  }

  const [walking, setWalking] = useState(false);
  useEffect(() => {
    if (!motion.ms) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWalking(true);
    const timer = setTimeout(() => setWalking(false), motion.ms);
    return () => clearTimeout(timer);
  }, [motion]);

  // What the duck is doing is derived here from server state; nobody can set it for another duck.
  // In a sticker interaction the duck stops, faces its partner, and plays that interaction's moves.
  const shared = !walking && interaction ? duckMoves[interaction] : undefined;
  const animation: DuckAnimation = shared?.animation ?? (walking ? "walk" : bubble ? "quack" : dancing ? "dance" : sleeping ? "sleep" : "idle");
  const move = shared?.motion ?? (walking ? "duck-hop" : dancing ? "duck-sway" : sleeping ? "" : "duck-bob");
  const facingLeft = interaction ? !!partnerOnLeft : motion.left;

  return (
    <div
      className={`pointer-events-none absolute flex flex-col items-center ${away ? "opacity-50" : ""}`}
      style={{
        left: `${x * 100}%`,
        top: `${FLOOR_TOP + y * FLOOR_HEIGHT}%`,
        transform: "translate(-50%, -100%)",
        transition: `left ${motion.ms}ms linear, top ${motion.ms}ms linear`,
        zIndex: Math.floor(y * 1000), // ducks lower on the screen are in front
      }}
    >
      {sticker && !bubble && !interaction && (
        <PixelSpeechBubble key={sticker.id} className="mb-1 text-xl">
          {sticker.icon}
        </PixelSpeechBubble>
      )}
      {bubble && (
        <PixelSpeechBubble key={bubble.id} className="mb-1 w-max max-w-[200px]">
          {bubble.text}
        </PixelSpeechBubble>
      )}
      {/* Ducks closer to the viewer are drawn a little larger. */}
      <div className="relative" style={{ transform: `scale(${0.85 + y * 0.15})`, transformOrigin: "50% 100%" }}>
        <div className="absolute bottom-0 left-1/2 h-1.5 w-3/5 -translate-x-1/2 bg-black/25" />
        {dancing && !walking && <span className="duck-note font-pixel absolute -top-3 right-0 text-sm text-[var(--panel)] [text-shadow:2px_2px_0_var(--outline)]">♪</span>}
        {sleeping && !walking && !dancing && !bubble && (
          <span className="duck-note font-pixel absolute -top-3 right-0 text-sm text-[var(--panel)] [text-shadow:2px_2px_0_var(--outline)]">z</span>
        )}
        <div style={{ transform: facingLeft ? "scaleX(-1)" : undefined }}>
          <div className={move}>
            {/* The key restarts the quack animation for every new message. */}
            <DuckSprite key={`${animation}:${bubble?.id ?? ""}`} color={color} item={item} equipment={equipment} carried={carried} animation={animation} />
          </div>
        </div>
      </div>
      <div className="mt-1.5">
        <DuckNameTag name={name} isSelf={isSelf} owner={owner} dj={dj} night={night} voice={voice} speaking={speaking} />
      </div>
    </div>
  );
});

export { DUCK_PIXELS };
