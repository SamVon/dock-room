// The event engine's server half: stores event configs, and decides which one is active.
// Browsers are told the result; they never decide it themselves.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WEARABLES } from "../shared/cosmetics";
import { SeasonalEventSchema, eventConfigProblems, type ActiveEventState, type EventSnapshot, type SeasonalEvent } from "../shared/events";
import type { Logger } from "./logger";

/** Where event configs live. A PostgreSQL `events` table can replace this later. */
export interface EventRepository {
  list(): SeasonalEvent[];
  save(event: SeasonalEvent): void;
  delete(slug: string): void;
}

export class MemoryEventRepository implements EventRepository {
  protected events = new Map<string, SeasonalEvent>();
  constructor(seed: SeasonalEvent[]) {
    for (const event of seed) this.events.set(event.slug, event);
  }
  list = () => [...this.events.values()];
  save(event: SeasonalEvent) {
    this.events.set(event.slug, event);
  }
  delete(slug: string) {
    this.events.delete(slug);
  }
}

/**
 * Keeps events in a JSON file, so changes made on the admin page survive a restart.
 *
 * The file holds the events and the slugs of built-in events the admin deleted. On start,
 * a built-in event that is in neither list is new (it came with an update) and is added.
 */
export class FileEventRepository extends MemoryEventRepository {
  private removed = new Set<string>();

  constructor(
    private readonly file: string,
    seed: SeasonalEvent[],
    log: Logger,
  ) {
    super(seed);
    if (!existsSync(file)) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      // Older files are a plain list of events.
      const saved = SeasonalEventSchema.array().parse(Array.isArray(raw) ? raw : raw.events);
      this.removed = new Set(Array.isArray(raw) ? [] : (raw.removed as string[]));
      this.events = new Map(saved.map((event) => [event.slug, event]));
      for (const event of seed) if (!this.events.has(event.slug) && !this.removed.has(event.slug)) this.events.set(event.slug, event);
    } catch {
      // A broken file must not stop the server: fall back to the built-in calendar.
      log("EVENT_CONFIG", { result: "error", detail: "saved events could not be read; using the built-in calendar" });
    }
  }
  private write() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ events: this.list(), removed: [...this.removed] }, null, 2));
  }
  save(event: SeasonalEvent) {
    this.removed.delete(event.slug);
    super.save(event);
    this.write();
  }
  delete(slug: string) {
    this.removed.add(slug);
    super.delete(slug);
    this.write();
  }
}

export type EventChange = "started" | "updated" | "ended";
type Options = {
  log: Logger;
  /** The clock. Tests replace it to move time forward. */
  now?: () => number;
  /** Treat this event as active whatever its dates say (for testing and for sharing a preview). */
  forceSlug?: string;
};

const WEARABLE_IDS = WEARABLES.map((wearable) => wearable.id);

export class EventService {
  private state: ActiveEventState = { eventId: null, slug: null, version: 1 };
  private current: SeasonalEvent | null = null;
  private listeners: ((change: EventChange, snapshot: EventSnapshot) => void)[] = [];
  private readonly now: () => number;

  constructor(
    private readonly repo: EventRepository,
    private readonly options: Options,
  ) {
    this.now = options.now ?? Date.now;
    for (const event of repo.list()) this.reportProblems(event);
    this.tick();
  }

  private reportProblems(event: SeasonalEvent) {
    for (const problem of eventConfigProblems(event, [], WEARABLE_IDS)) {
      this.options.log("EVENT_CONFIG", { result: "warning", detail: `${event.slug}: ${problem}` });
    }
  }

  /** The rule: enabled, inside its dates, and the highest priority among those. */
  resolve(at = this.now()): SeasonalEvent | null {
    const events = this.repo.list();
    const forced = events.find((event) => event.slug === this.options.forceSlug);
    if (forced) return forced;
    return (
      events
        .filter((event) => event.enabled && at >= Date.parse(event.startAt) && at < Date.parse(event.endAt))
        .sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug))[0] ?? null
    );
  }

  active = () => this.current;
  snapshot = (): EventSnapshot => ({ state: this.state, event: this.current });
  list = () => this.repo.list();
  onChange(listener: (change: EventChange, snapshot: EventSnapshot) => void) {
    this.listeners.push(listener);
  }

  /** Re-checks the calendar. Called on a timer and after every admin change. */
  tick() {
    const next = this.resolve();
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;

    const previous = this.current;
    const changes: EventChange[] = previous?.id === next?.id ? ["updated"] : [...(previous ? (["ended"] as const) : []), ...(next ? (["started"] as const) : [])];
    this.current = next;
    this.state = { eventId: next?.id ?? null, slug: next?.slug ?? null, version: this.state.version + 1, startAt: next?.startAt, endAt: next?.endAt };

    const snapshot = this.snapshot();
    for (const change of changes) {
      this.options.log(change === "ended" ? "EVENT_ENDED" : change === "started" ? "EVENT_STARTED" : "EVENT_UPDATED", { detail: (change === "ended" ? previous : next)?.slug });
      for (const listener of this.listeners) listener(change, snapshot);
    }
  }

  /** Creates or replaces an event. The input is validated here, whoever sent it. */
  upsert(input: unknown): SeasonalEvent {
    const event = SeasonalEventSchema.parse(input);
    this.repo.save(event);
    this.reportProblems(event);
    this.tick();
    return event;
  }

  remove(slug: string) {
    this.repo.delete(slug);
    this.tick();
  }
}
