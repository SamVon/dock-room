"use client";

// Draws the shared animation for each pair of ducks the server has matched.
import { FLOOR_HEIGHT, FLOOR_TOP } from "@/components/Duck";
import type { RoomUser } from "@/shared/protocol";
import type { StickerMatchPayload } from "@/shared/protocol";
import { STICKERS } from "@/shared/stickers";
import { stickerInteractions } from "./interaction-registry";

type Props = {
  interactions: readonly StickerMatchPayload[];
  users: readonly RoomUser[];
  /** Reduced motion: show a short, still "duck, sticker, duck" badge instead of the animation. */
  calm: boolean;
};

/** A point above a duck's head, in percent of the scene. */
const above = (user: RoomUser) => ({ left: user.x * 100, top: FLOOR_TOP + user.y * FLOOR_HEIGHT });

export function StickerInteractionRenderer({ interactions, users, calm }: Props) {
  return interactions.map((interaction) => {
    const a = users.find((user) => user.id === interaction.userA);
    const b = users.find((user) => user.id === interaction.userB);
    const sticker = STICKERS[interaction.stickerId];
    const effect = stickerInteractions[sticker.interaction];
    if (!a || !b || !effect) return null; // a duck left, or an interaction with no art: nothing to draw

    const [pa, pb] = [above(a), above(b)];
    const middle = { left: (pa.left + pb.left) / 2, top: (pa.top + pb.top) / 2 };
    // Effects sit just above the ducks' heads and stay below the top HUD and above the radio.
    const lift = "translate(-50%, calc(-100% - var(--size) * 1.15))";
    const zIndex = 1001;

    if (calm) {
      return (
        <div key={interaction.interactionId} className="fx-fade pixel-tag pointer-events-none absolute px-2 py-1 text-base" style={{ left: `${middle.left}%`, top: `${middle.top}%`, transform: lift, zIndex }}>
          🦆 {sticker.icon} 🦆
        </div>
      );
    }

    if (interaction.mode === "together") {
      return (
        <div key={interaction.interactionId} className="pointer-events-none absolute" style={{ left: `${middle.left}%`, top: `${middle.top}%`, transform: lift, zIndex }}>
          <effect.Effect small={false} icon={sticker.icon} />
        </div>
      );
    }

    // Far apart: each duck gets a small version, joined by a trail of the sticker between them.
    return (
      <div key={interaction.interactionId} className="pointer-events-none absolute inset-0" style={{ zIndex }}>
        {[pa, pb].map((point, i) => (
          <div key={i} className="absolute" style={{ left: `${point.left}%`, top: `${point.top}%`, transform: lift }}>
            <effect.Effect small icon={sticker.icon} />
          </div>
        ))}
        {[0.25, 0.5, 0.75].map((t, i) => (
          <span
            key={t}
            className="fx-twinkle absolute text-sm"
            style={{
              left: `${pa.left + (pb.left - pa.left) * t}%`,
              top: `${pa.top + (pb.top - pa.top) * t}%`,
              transform: "translate(-50%, calc(-100% - var(--size) * 0.6))",
              animationDelay: `${i * 0.2}s`,
            }}
          >
            {sticker.icon}
          </span>
        ))}
      </div>
    );
  });
}
