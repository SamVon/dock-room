// What a duck's body does during each interaction: which sprite animation plays and how it moves.
// Kept apart from the effects so the Duck component can use it without pulling them in.
import type { DuckAnimation } from "@/lib/duckSprites";

export const duckMoves: Record<string, { animation: DuckAnimation; motion: string }> = {
  heart: { animation: "idle", motion: "duck-hop" },
  highfive: { animation: "dance", motion: "fx-recoil" }, // wings up, then a small bounce back
  dance: { animation: "dance", motion: "duck-sway" },
  laugh: { animation: "sleep", motion: "fx-shake" }, // eyes closed, shaking
  sparkle: { animation: "idle", motion: "duck-bob" },
  hype: { animation: "walk", motion: "duck-hop" },
  // Not a sticker: a duck bending down to set a krathong on the water.
  release: { animation: "sleep", motion: "fx-crouch" },
  "sakura-bloom": { animation: "idle", motion: "duck-hop" },
  cheer: { animation: "dance", motion: "duck-bob" },
};
