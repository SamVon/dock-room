// Interaction zones and carried items: places in the world where a duck can do something,
// and things a duck can carry. Shared by the browser (to show the right button) and the server
// (to decide whether the action is really allowed).
//
// The first use is the Loy Krathong festival: take a krathong at the stall, carry it to the
// river's edge, and set it afloat.
import { z } from "zod";

/** Kinds of zone. Only the two krathong kinds do something so far; the others are reserved for later events. */
export type InteractionZoneType = "krathong-pickup" | "krathong-release" | "music" | "photo" | "festival-stall";

/** A rectangle in room coordinates (0 to 1, the same as duck positions). */
export type InteractionZone = {
  id: string;
  type: InteractionZoneType;
  x: number;
  y: number;
  width: number;
  height: number;
  /** For release zones: where on the water (y) a krathong starts floating. */
  waterY?: number;
};

// In the river scene the water runs across the middle: roughly y 0.13 to 0.79.
// The far bank is above it and the near bank below.
export const INTERACTION_ZONES: Record<string, InteractionZone> = {
  "krathong-stall-01": { id: "krathong-stall-01", type: "krathong-pickup", x: 0.34, y: 0, width: 0.24, height: 0.16 },
  "river-release-01": { id: "river-release-01", type: "krathong-release", x: 0.08, y: 0.68, width: 0.84, height: 0.32, waterY: 0.7 },
  "river-release-02": { id: "river-release-02", type: "krathong-release", x: 0.64, y: 0, width: 0.32, height: 0.22, waterY: 0.22 },
};

/** How close counts as "at" a zone, so a duck does not have to stand exactly inside the box. */
export const ZONE_MARGIN = 0.03;

export function inZone(zone: InteractionZone, x: number, y: number, margin = ZONE_MARGIN) {
  return x >= zone.x - margin && x <= zone.x + zone.width + margin && y >= zone.y - margin && y <= zone.y + zone.height + margin;
}

/** Krathong designs. Each is the same little boat in different colors; the art is in lib/krathongSprites.ts. */
export const KRATHONGS = {
  "lotus-pink": { label: "Pink lotus", carryAnchor: { x: 9, y: 7 } },
  "lotus-white": { label: "White lotus", carryAnchor: { x: 9, y: 7 } },
  "banana-leaf": { label: "Banana leaf", carryAnchor: { x: 9, y: 7 } },
  "gold-flower": { label: "Golden flower", carryAnchor: { x: 9, y: 7 } },
  "purple-flower": { label: "Purple flower", carryAnchor: { x: 9, y: 7 } },
} as const;
export type KrathongVariant = keyof typeof KRATHONGS;
export const isKrathongVariant = (value: string): value is KrathongVariant => value in KRATHONGS;

/** What a duck is carrying. The server owns this; a client can never claim to be carrying something. */
export type CarriedItem = { type: "krathong"; variant: KrathongVariant };

/**
 * A krathong on the water. The server sends this once. Every client then works out where it is
 * from the start position, direction, speed and time, so nothing is sent while it drifts.
 */
export type FloatingKrathong = {
  id: string;
  ownerUserId: string;
  variant: KrathongVariant;
  startX: number;
  startY: number;
  driftX: number;
  driftY: number;
  driftSpeed: number;
  /** Server time when it touches the water (a moment after the release begins). */
  createdAt: number;
  expiresAt: number;
};

/** Where a krathong is at a given moment (server time). */
export function krathongPosition(krathong: FloatingKrathong, at: number) {
  const elapsed = Math.max(0, Math.min(at, krathong.expiresAt) - krathong.createdAt) / 1000;
  return { x: krathong.startX + krathong.driftX * krathong.driftSpeed * elapsed, y: krathong.startY + krathong.driftY * krathong.driftSpeed * elapsed };
}

/** How long the duck is busy setting a krathong down, and when in that time it touches the water. */
export const RELEASE_MS = 1800;
export const PLACE_MS = 800;

// Payloads name a zone and a design, nothing else. The server works out who, where, speed and timing.
const key = z.string().regex(/^[a-z0-9-]{1,40}$/);
// `commandId` makes a retry safe: the same id never takes or floats a second krathong.
export const PickupSchema = z.strictObject({ commandId: z.uuid(), stallId: key, variant: key });
export const ReleaseSchema = z.strictObject({ commandId: z.uuid(), zoneId: key });

/** The part of an event's configuration that switches this interaction on and sets its limits. */
export const KrathongConfigSchema = z.strictObject({
  enabled: z.boolean(),
  pickupZones: z.array(key).max(8),
  releaseZones: z.array(key).max(8),
  variants: z.array(key).min(1).max(8),
  floatDurationMs: z.number().int().min(5000).max(120_000),
  maxFloatingPerRoom: z.number().int().min(1).max(100),
  userCooldownMs: z.number().int().min(0).max(600_000),
});
export type KrathongConfig = z.infer<typeof KrathongConfigSchema>;
