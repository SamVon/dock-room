"use client";

// Krathongs drifting on the river. The server sends each one once; from then on its position is
// worked out here from its start, direction, speed and age. Nothing is sent while it floats, and
// React does not re-render per frame: the browser runs one CSS animation per krathong.
import { useState, type CSSProperties } from "react";
import { FLOOR_HEIGHT, FLOOR_TOP } from "@/components/Duck";
import { SheetSprite } from "@/components/scene/parts";
import { krathongSheet, rippleSheet } from "@/lib/krathongSprites";
import { krathongPosition, type FloatingKrathong } from "@/shared/interactions";

const onScreen = ({ x, y }: { x: number; y: number }) => ({ left: `${x * 100}%`, top: `${FLOOR_TOP + y * FLOOR_HEIGHT}%` });

function Krathong({ krathong, serverNow, night }: { krathong: FloatingKrathong; serverNow: number; night: boolean }) {
  // Worked out once, when it first appears: how far along its journey it already is.
  // (Someone who joins late sees it part-way down the river, exactly where everyone else does.)
  const [elapsed] = useState(() => Math.max(0, serverNow - krathong.createdAt));
  const from = onScreen(krathongPosition(krathong, krathong.createdAt));
  const to = onScreen(krathongPosition(krathong, krathong.expiresAt));

  return (
    <div
      className="krathong pointer-events-none absolute"
      style={
        {
          "--x0": from.left,
          "--y0": from.top,
          "--x1": to.left,
          "--y1": to.top,
          "--drift-ms": `${krathong.expiresAt - krathong.createdAt}ms`,
          "--drift-delay": `${-elapsed}ms`,
          zIndex: Math.floor(krathong.startY * 1000) - 1, // just behind a duck standing at the same depth
        } as CSSProperties
      }
    >
      <div className="relative -translate-x-1/2 -translate-y-full">
        {/* The ring where it touched the water, only for one that has just been set down. */}
        {elapsed < 400 && <SheetSprite sheet={rippleSheet()} scale={4} seconds={0.8} className="sprite-once absolute -bottom-2 left-1/2 -translate-x-1/2" />}
        <div className="krathong-bob">
          <SheetSprite sheet={krathongSheet(krathong.variant)} scale={4} seconds={0.9} />
        </div>
        {/* At night the candle's light trembles on the water below it. */}
        {night && <div className="lantern-glow absolute top-full left-1/2 h-4 w-1 -translate-x-1/2" />}
      </div>
    </div>
  );
}

export function FloatingKrathongs({ krathongs, clockOffset, night }: { krathongs: readonly FloatingKrathong[]; clockOffset: number; night: boolean }) {
  return krathongs.map((krathong) => <Krathong key={krathong.id} krathong={krathong} serverNow={Date.now() + clockOffset} night={night} />);
}
