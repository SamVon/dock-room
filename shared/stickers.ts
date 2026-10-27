// Stickers, and what happens when two ducks send the same one at nearly the same time.
// Shared by the browser and the server. The server alone decides that a match happened.
import { z } from "zod";

type StickerConfig = { icon: string; label: string; interaction: string; durationMs: number; /** The seasonal event this sticker belongs to, if any. */ event?: string };

/** Each sticker has an icon and names the interaction two matching ducks perform. */
export const STICKERS = {
  heart: { icon: "❤️", label: "Heart", interaction: "heart", durationMs: 2600 },
  highfive: { icon: "🙌", label: "High five", interaction: "highfive", durationMs: 2000 },
  music: { icon: "🎵", label: "Music", interaction: "dance", durationMs: 3000 },
  laugh: { icon: "😂", label: "Laugh", interaction: "laugh", durationMs: 2400 },
  sparkle: { icon: "✨", label: "Sparkle", interaction: "sparkle", durationMs: 2400 },
  fire: { icon: "🔥", label: "Fire", interaction: "hype", durationMs: 2200 },
  // Seasonal stickers can only be sent while their event is on.
  sakura: { icon: "🌸", label: "Sakura", interaction: "sakura-bloom", durationMs: 3000, event: "sakura-festival" },
  flower: { icon: "🌺", label: "Flower", interaction: "cheer", durationMs: 2400, event: "sakura-festival" },
  tea: { icon: "🍵", label: "Tea", interaction: "cheer", durationMs: 2400, event: "sakura-festival" },
  moon: { icon: "🌙", label: "Moon", interaction: "cheer", durationMs: 2400, event: "sakura-festival" },
} as const satisfies Record<string, StickerConfig>;

export type StickerId = keyof typeof STICKERS;
export const STICKER_IDS = Object.keys(STICKERS) as [StickerId, ...StickerId[]];

const eventOf = (id: StickerId): string | undefined => (STICKERS[id] as StickerConfig).event;
/** Is this sticker usable now? Everyday stickers always; seasonal ones only during their event. */
export const stickerAvailable = (id: StickerId, activeEventSlug: string | null | undefined) => !eventOf(id) || eventOf(id) === activeEventSlug;
export const isSeasonalSticker = (id: StickerId) => !!eventOf(id);

/** Ducks closer than this (in room coordinates) walk to each other; farther apart, they react where they stand. */
export const MAX_INTERACTION_MOVE_DISTANCE = 0.2;
/** How far each duck stands from the middle when they meet. */
export const MEETING_GAP = 0.045;

// Only the sticker id. The sender is taken from the session, and the server picks who it matches,
// so fields like userId, targetUserId or interactionType make the payload invalid.
export const StickerSchema = z.strictObject({ stickerId: z.enum(STICKER_IDS) });
