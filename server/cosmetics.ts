// Who may wear what. The server decides: an item must exist, be enabled, match the slot,
// and be unlocked for this session. Unlocks and equipment belong to the anonymous session
// (userId), never to a socket, so they survive a reconnect.
import { NO_EQUIPMENT, WEARABLES, findWearable, type DuckWearable, type Equipment, type WearableCategory } from "../shared/cosmetics";
import { AppError } from "./auth";
import type { EventService } from "./events";
import type { Room } from "./rooms";

/** Where equipment and unlocks are stored. Swap for a database (session_equipment, session_cosmetics) later. */
export interface CosmeticRepository {
  getEquipment(userId: string): Equipment | undefined;
  saveEquipment(userId: string, equipment: Equipment): void;
  getGrants(userId: string): ReadonlySet<string>;
  grant(userId: string, wearableIds: string[]): void;
}

const MAX_SESSIONS = 20_000;
const NO_GRANTS: ReadonlySet<string> = new Set();

export class MemoryCosmeticRepository implements CosmeticRepository {
  private equipment = new Map<string, Equipment>();
  private grants = new Map<string, Set<string>>();

  getEquipment = (userId: string) => this.equipment.get(userId);

  saveEquipment(userId: string, equipment: Equipment) {
    this.equipment.delete(userId); // re-insert, so the map stays ordered by last use
    this.equipment.set(userId, equipment);
    // Memory only: forget the sessions that have gone longest without changing their outfit.
    if (this.equipment.size > MAX_SESSIONS) this.equipment.delete(this.equipment.keys().next().value!);
  }

  getGrants = (userId: string) => this.grants.get(userId) ?? NO_GRANTS;

  grant(userId: string, wearableIds: string[]) {
    const owned = this.grants.get(userId) ?? new Set();
    wearableIds.forEach((id) => owned.add(id));
    this.grants.set(userId, owned);
    if (this.grants.size > MAX_SESSIONS) this.grants.delete(this.grants.keys().next().value!);
  }
}

const RARE_IDS = WEARABLES.filter((wearable) => wearable.rarity === "rare").map((wearable) => wearable.id);

export class CosmeticService {
  constructor(
    private readonly repo: CosmeticRepository,
    private readonly events: EventService,
  ) {}

  /**
   * Is this event item available here? Yes while its event is the active one, or when the active
   * event's config lists it as an accessory. Boat Festival items also unlock in a room whose
   * owner has set the scene to the festival.
   */
  private eventUnlocks(wearable: DuckWearable, room: Room | undefined) {
    const active = this.events.active();
    if (active && (active.slug === wearable.eventId || active.ducks?.accessories?.includes(wearable.id))) return true;
    return wearable.eventId === "boat-festival" && room?.scene === "festival";
  }

  /** The unlock rules, in one place. */
  private isUnlocked(wearable: DuckWearable, userId: string, room: Room | undefined) {
    if (!wearable.enabled) return false;
    switch (wearable.rarity) {
      case "common":
        return true;
      case "event":
        return this.eventUnlocks(wearable, room);
      case "special":
        return room?.ownerUserId === userId;
      case "rare":
        return this.repo.getGrants(userId).has(wearable.id);
    }
  }

  /** Ids this user may equip right now. Sent to that user only, never to the room. */
  inventory(userId: string, room?: Room): string[] {
    return WEARABLES.filter((wearable) => this.isUnlocked(wearable, userId, room)).map((wearable) => wearable.id);
  }

  equipmentOf = (userId: string): Equipment => this.repo.getEquipment(userId) ?? NO_EQUIPMENT;

  /** Hosting a room is how a session earns the rare items. */
  rewardHost(userId: string) {
    this.repo.grant(userId, RARE_IDS);
  }

  /** Puts an item on, after every check. Throws an error that is safe to show the user. */
  equip(userId: string, room: Room, slot: WearableCategory, wearableId: string): Equipment {
    const wearable = findWearable(wearableId);
    if (!wearable || !wearable.enabled) throw new AppError("INVALID_PAYLOAD", "That item does not exist");
    if (wearable.category !== slot) throw new AppError("INVALID_PAYLOAD", "That item does not go there");
    if (!this.isUnlocked(wearable, userId, room)) throw new AppError("FORBIDDEN", "That item is locked");
    return this.save(userId, slot, wearable.id);
  }

  unequip = (userId: string, slot: WearableCategory): Equipment => this.save(userId, slot, null);

  private save(userId: string, slot: WearableCategory, wearableId: string | null) {
    const equipment = { ...this.equipmentOf(userId), [slot]: wearableId };
    this.repo.saveEquipment(userId, equipment);
    return equipment;
  }
}
