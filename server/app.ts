// Wires the pieces together. Used by the real server (with Next.js as the fallback) and by the tests.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Config } from "./config";
import { DEFAULT_EVENTS } from "../config/events";
import { CosmeticService, MemoryCosmeticRepository } from "./cosmetics";
import { EventService, MemoryEventRepository, type EventRepository } from "./events";
import { MemoryAdminStore, type AdminStore } from "./adminStore";
import { createHttpHandler, ipReader, originCheck } from "./http";
import type { Logger } from "./logger";
import { RateLimiter } from "./rateLimit";
import { createRealtime, type Limiters, type Realtime } from "./realtime";
import { MemoryRoomRepository, RoomService } from "./rooms";
import { deleteUpload } from "./uploads";

type Options = {
  log: Logger;
  fallback?: (req: IncomingMessage, res: ServerResponse) => void;
  /** Where event configs are kept. Defaults to memory, seeded with the built-in calendar. */
  eventRepository?: EventRepository;
  /** The clock used to decide which event is active. Tests replace it. */
  now?: () => number;
  /** Admin accounts. Without one there are no admins, and the admin page is off. */
  adminStore?: AdminStore;
};

const notFound = (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(404);
  res.end();
};

export function createApp(config: Config, { log, fallback = notFound, eventRepository, now, adminStore = new MemoryAdminStore() }: Options) {
  const limiters = Object.fromEntries(
    Object.entries(config.limits).map(([name, rule]) => [name, new RateLimiter(rule)]),
  ) as Limiters;

  const repository = new MemoryRoomRepository();
  const rooms = new RoomService(repository, config, log, (room) => {
    for (const url of room.uploads) deleteUpload(url);
  });

  const events = new EventService(eventRepository ?? new MemoryEventRepository(DEFAULT_EVENTS), { log, now, forceSlug: config.forceEvent });
  const cosmetics = new CosmeticService(new MemoryCosmeticRepository(), events);

  let realtime: Realtime;
  const httpServer = createServer(createHttpHandler({ config, rooms, cosmetics, events, log, limiters, admins: adminStore, realtime: () => realtime, fallback }));
  realtime = createRealtime(httpServer, {
    config,
    rooms,
    cosmetics,
    events,
    log,
    limiters,
    isAllowedOrigin: originCheck(config),
    clientIp: ipReader(config),
  });

  // Events start and end by the clock, so the calendar is checked regularly.
  const calendar = setInterval(() => events.tick(), 15_000);
  calendar.unref();

  return {
    httpServer,
    io: realtime.io,
    rooms,
    events,
    close: () => {
      clearInterval(calendar);
      return realtime.close();
    },
  };
}
