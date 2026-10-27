// The wearable catalog: every cosmetic a duck can put on. Shared by the browser and the server.
//
// Clients only ever send a wearable id. The server looks the id up here, so nobody can make
// a duck wear an image of their own. The pixel art for each id is in lib/wearableSprites.ts.
import { z } from "zod";

export const SLOTS = ["head", "face", "neck", "back"] as const;
export type WearableCategory = (typeof SLOTS)[number];
export type WearableRarity = "common" | "rare" | "event" | "special";

/** What a duck is wearing, one item per slot. Only `head` has items so far. */
export type Equipment = Record<WearableCategory, string | null>;
export const NO_EQUIPMENT: Equipment = { head: null, face: null, neck: null, back: null };

export type DuckWearable = {
  id: string;
  name: string;
  description: string;
  category: WearableCategory;
  /** Which sprite to draw (a key of lib/wearableSprites.ts). */
  sprite: string;
  anchor: WearableCategory;
  /** Position relative to the anchor, in duck pixels. 0, 0 rests the item on top of the head. */
  offsetX: number;
  offsetY: number;
  scale?: number;
  rarity: WearableRarity;
  eventId?: EventId;
  /** A small extra animation of its own. */
  effect?: "wobble" | "sparkle";
  enabled: boolean;
};

export const EVENTS = {
  halloween: "Halloween",
  christmas: "Christmas",
  valentine: "Valentine's Day",
  "pi-mai": "Pi Mai",
  "boat-festival": "the Boat Festival",
  "sakura-festival": "the Sakura Festival",
} as const;
export type EventId = keyof typeof EVENTS;

/** Where attachments go on the 16x16 duck sprite, in duck pixels. */
export const DUCK_ANCHORS: Record<WearableCategory, { x: number; y: number }> = {
  head: { x: 8.5, y: 3 }, // centre of the head; items rest with their bottom edge here
  face: { x: 11, y: 6 },
  neck: { x: 8.5, y: 11 }, // where the head meets the body
  back: { x: 3, y: 10 },
};

type Entry = Pick<DuckWearable, "id" | "name" | "description" | "rarity"> & Partial<DuckWearable>;

const head = (entry: Entry): DuckWearable => ({
  category: "head",
  anchor: "head",
  sprite: entry.id,
  offsetX: 0,
  offsetY: 0,
  enabled: true,
  ...entry,
});

export const WEARABLES: DuckWearable[] = [
  // Common: everyone has these
  head({ id: "broken-egg", name: "Broken Egg", rarity: "common", effect: "wobble", description: "A cracked shell for a freshly hatched duck." }),
  head({ id: "blue-cap", name: "Blue Cap", rarity: "common", offsetX: 1, offsetY: 1, description: "A plain cap for sunny ponds." }),
  head({ id: "red-cap", name: "Red Cap", rarity: "common", offsetX: 1, offsetY: 1, description: "Like the blue one, but faster." }),
  head({ id: "bucket-hat", name: "Bucket Hat", rarity: "common", offsetY: 1, description: "Soft, floppy, and ready for a fishing trip." }),
  head({ id: "headphones", name: "Headphones", rarity: "common", offsetY: 4, description: "For ducks who really listen to the radio." }),
  head({ id: "straw-hat", name: "Straw Hat", rarity: "common", offsetY: 1, description: "Keeps the sun off during a long waddle." }),
  head({ id: "flower", name: "Flower", rarity: "common", offsetX: -2, description: "Picked fresh from the valley." }),

  // Rare and special
  head({ id: "rainbow-cap", name: "Rainbow Cap", rarity: "rare", offsetX: 1, offsetY: 1, description: "Every color at once. Hosts only." }),
  head({ id: "duck-headband", name: "Duck Headband", rarity: "rare", description: "A duck, wearing a duck." }),
  head({ id: "gold-crown", name: "Gold Crown", rarity: "special", effect: "sparkle", description: "For the duck who leads the flock." }),

  // Halloween
  head({ id: "witch-hat", name: "Witch Hat", rarity: "event", eventId: "halloween", offsetY: 1, description: "Pointy, purple, and a little spooky." }),
  head({ id: "pumpkin-hat", name: "Pumpkin Hat", rarity: "event", eventId: "halloween", description: "A grinning pumpkin with room for a duck." }),
  head({ id: "ghost-hood", name: "Ghost Hood", rarity: "event", eventId: "halloween", description: "Boo. It is only a bedsheet." }),

  // Christmas
  head({ id: "santa-hat", name: "Santa Hat", rarity: "event", eventId: "christmas", offsetX: 1, description: "Warm, red, and jolly." }),
  head({ id: "reindeer-antlers", name: "Reindeer Antlers", rarity: "event", eventId: "christmas", description: "Not real antlers. Probably." }),
  head({ id: "snowman-hat", name: "Snowman Hat", rarity: "event", eventId: "christmas", description: "A top hat with snow still on it." }),

  // Valentine
  head({ id: "heart-headband", name: "Heart Headband", rarity: "event", eventId: "valentine", description: "Two hearts that bounce as you waddle." }),
  head({ id: "rose-crown", name: "Rose Crown", rarity: "event", eventId: "valentine", offsetY: 1, description: "A ring of tiny roses." }),
  head({ id: "pink-bow", name: "Pink Bow", rarity: "event", eventId: "valentine", description: "Tied with care." }),

  // Pi Mai
  head({ id: "flower-garland", name: "Flower Garland", rarity: "event", eventId: "pi-mai", offsetY: 1, description: "Golden flowers for the new year." }),
  head({ id: "festival-headband", name: "Festival Headband", rarity: "event", eventId: "pi-mai", offsetX: 1, offsetY: 1, description: "A woven band with a blossom on the side." }),
  head({ id: "floral-hat", name: "Floral Hat", rarity: "event", eventId: "pi-mai", offsetY: 1, description: "A straw hat dressed up for the water festival." }),

  // Boat Festival
  head({ id: "racing-headband", name: "Racing Headband", rarity: "event", eventId: "boat-festival", offsetX: -1, offsetY: 1, description: "Tied tight for the big race." }),
  head({ id: "festival-scarf", name: "Festival Scarf", rarity: "event", eventId: "boat-festival", offsetY: 1, description: "A checked cloth wrapped around the head." }),
  head({ id: "boat-captain-hat", name: "Boat Captain Hat", rarity: "event", eventId: "boat-festival", offsetX: 1, offsetY: 1, description: "For the duck who calls the stroke." }),
];

// Other slots use the same shape. The scarf is the first item that is not for the head.
WEARABLES.push(
  head({ id: "sakura-flower-crown", name: "Sakura Flower Crown", rarity: "event", eventId: "sakura-festival", offsetY: 1, description: "A ring of cherry blossoms, pink and white." }),
  head({ id: "sakura-hair-clip", name: "Sakura Hair Clip", rarity: "event", eventId: "sakura-festival", offsetX: -3, offsetY: 2, description: "One perfect blossom, clipped on the side." }),
  head({ id: "pink-ribbon", name: "Pink Ribbon", rarity: "event", eventId: "sakura-festival", offsetY: 2, description: "A soft ribbon with long tails." }),
  { ...head({ id: "spring-scarf", name: "Spring Scarf", rarity: "event", eventId: "sakura-festival", offsetX: -1, offsetY: 2, description: "Light, striped, and just warm enough for a spring evening." }), category: "neck", anchor: "neck" },
);

const BY_ID = new Map(WEARABLES.map((wearable) => [wearable.id, wearable]));
export const findWearable = (id: string | null | undefined) => (id ? BY_ID.get(id) : undefined);

/** Why a locked item is locked, in words the player can act on. */
export function lockReason(wearable: DuckWearable) {
  if (wearable.rarity === "event" && wearable.eventId) return `Available during ${EVENTS[wearable.eventId]}.`;
  if (wearable.rarity === "special") return "Only the leader of a room can wear this.";
  if (wearable.rarity === "rare") return "Host a room of your own to unlock this.";
  return "Not available right now.";
}

// Payloads carry ids only. Strict objects reject extra fields such as a sprite URL.
const WearableIdSchema = z.string().min(1).max(40).regex(/^[a-z0-9-]+$/);
export const EquipSchema = z.strictObject({ slot: z.enum(SLOTS), wearableId: WearableIdSchema });
export const UnequipSchema = z.strictObject({ slot: z.enum(SLOTS) });
/** What a duck asks to wear when it joins. Only the head slot exists for now. */
export const JoinEquipmentSchema = z.strictObject({ head: WearableIdSchema.nullable() });
