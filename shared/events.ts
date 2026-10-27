// Seasonal events: one generic engine, driven by configuration. Shared by browser and server.
//
// An event does not add code to the room. It is a record that says which scene, decorations,
// particles, weather, music and duck accessories to use between two dates. The server decides
// which event is active; browsers only draw what the server tells them.
import { z } from "zod";
import { KrathongConfigSchema } from "./interactions";

/** Scenes, decorations, particles and weather that have art. Unknown names are skipped, never fatal. */
export const EVENT_SCENES = [
  "duck-valley",
  "riverside-festival",
  "haunted-duck-village",
  "snowy-duck-village",
  "rainy-duck-valley",
  "flower-garden",
  "pi-mai-festival",
  "festival-town-night",
  "moonlit-pond",
  "sakura-duck-valley",
  "loy-krathong-river",
] as const;

export const DECORATIONS = [
  "lanterns",
  "festivalFlags",
  "racingBoats",
  "drums",
  "foodStalls",
  "streetStalls",
  "crowd",
  "fireworks",
  "pumpkins",
  "graveyard",
  "spookyTrees",
  "candles",
  "christmasTree",
  "stringLights",
  "fairyLights",
  "gifts",
  "snowman",
  "puddles",
  "rainClouds",
  "heartLanterns",
  "flowers",
  "flowerGarlands",
  "waterBuckets",
  "countdownClock",
  "moonReflections",
  "sakuraTrees",
  "sakuraBranches",
  "sakuraLanterns",
  "flowerGarden",
  "woodenBridge",
  "sakuraPicnicArea",
  "krathongStall",
] as const;

export const PARTICLES = ["snow", "rain", "hearts", "confetti", "sparkles", "fireflies", "petals", "flowers", "falling-leaves", "bats", "fog", "water-splash", "sakuraPetals"] as const;
export const WEATHERS = ["clear", "rain", "storm", "snow", "mist", "wind", "night-stars"] as const;
export const MINIGAMES = ["boat-race", "countdown", "collect-gifts", "find-pumpkins", "umbrella-challenge"] as const;

const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/;
const text = (max: number) => z.string().trim().min(1).max(max).refine((value) => !UNSAFE_CHARS.test(value));
const key = z.string().regex(/^[a-zA-Z0-9-]{1,40}$/);
const keys = (max: number) => z.array(key).max(max);

export const SeasonalEventSchema = z
  .strictObject({
    id: key,
    slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
    name: text(60),
    description: text(300).optional(),
    enabled: z.boolean(),
    startAt: z.iso.datetime({ offset: true }),
    endAt: z.iso.datetime({ offset: true }),
    /** When events overlap, the highest priority wins. */
    priority: z.number().int().min(0).max(1000),
    theme: z.strictObject({
      scene: key,
      dayPalette: key.optional(),
      nightPalette: key.optional(),
      decorations: keys(20).optional(),
      particles: keys(6).optional(),
      weather: key.optional(),
      ambientSound: key.optional(),
      musicStation: key.optional(),
    }),
    ducks: z.strictObject({ accessories: keys(30).optional(), specialColors: keys(12).optional() }).optional(),
    ui: z.strictObject({ icon: text(8).optional(), bannerTitle: text(40).optional(), bannerSubtitle: text(80).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).optional(),
    /** Things ducks can do during this event, with their limits. */
    interactions: z.strictObject({ krathong: KrathongConfigSchema.optional() }).optional(),
    features: z.strictObject({ quests: z.boolean().optional(), rewards: z.boolean().optional(), leaderboard: z.boolean().optional(), minigame: key.optional() }).optional(),
  })
  .refine((event) => Date.parse(event.endAt) > Date.parse(event.startAt), { message: "The event must end after it starts" });

export type SeasonalEvent = z.infer<typeof SeasonalEventSchema>;
export type EventTheme = SeasonalEvent["theme"];

/** What every client is told. `version` grows with each change; ignore anything older than you have. */
export type ActiveEventState = { eventId: string | null; slug: string | null; version: number; startAt?: string; endAt?: string };
export type EventSnapshot = { state: ActiveEventState; event: SeasonalEvent | null };
export const NO_EVENT: EventSnapshot = { state: { eventId: null, slug: null, version: 0 }, event: null };

/** The everyday world, and the look a room owner can switch on by hand when no event is running. */
export const VALLEY_THEME: EventTheme = { scene: "duck-valley" };
export const FESTIVAL_THEME: EventTheme = {
  scene: "riverside-festival",
  decorations: ["racingBoats", "festivalFlags", "lanterns", "drums", "foodStalls", "crowd", "fireworks"],
};

const known = (list: readonly string[], value: string) => list.includes(value);

/** Names in a config that have no art or meaning yet. They are skipped at runtime; this is for logs and the admin page. */
export function eventConfigProblems(event: SeasonalEvent, stationIds: readonly string[] = [], wearableIds: readonly string[] = []): string[] {
  const problems: string[] = [];
  if (!known(EVENT_SCENES, event.theme.scene)) problems.push(`unknown scene "${event.theme.scene}" (Duck Valley will be used)`);
  for (const name of event.theme.decorations ?? []) if (!known(DECORATIONS, name)) problems.push(`unknown decoration "${name}" (skipped)`);
  for (const name of event.theme.particles ?? []) if (!known(PARTICLES, name)) problems.push(`unknown particle "${name}" (skipped)`);
  if (event.theme.weather && !known(WEATHERS, event.theme.weather)) problems.push(`unknown weather "${event.theme.weather}" (clear will be used)`);
  if (event.features?.minigame && !known(MINIGAMES, event.features.minigame)) problems.push(`unknown minigame "${event.features.minigame}"`);
  if (wearableIds.length) for (const id of event.ducks?.accessories ?? []) if (!wearableIds.includes(id)) problems.push(`unknown accessory "${id}" (skipped)`);
  void stationIds;
  return problems;
}

/** Display name for an event's own radio station, from its id: "winter-lofi" -> "Winter Lofi". */
export const stationName = (id: string) =>
  id
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
