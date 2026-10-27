"use client";

// Makes the active seasonal event available to anything on the page.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FESTIVAL_THEME, VALLEY_THEME, type EventTheme, type SeasonalEvent } from "@/shared/events";
import type { SceneId } from "@/shared/protocol";

const EventContext = createContext<SeasonalEvent | null>(null);

export function EventProvider({ event, children }: { event: SeasonalEvent | null; children: ReactNode }) {
  return <EventContext.Provider value={event}>{children}</EventContext.Provider>;
}

/** The seasonal event that is on right now, or null. The server decides this, never the browser's clock. */
export const useActiveEvent = () => useContext(EventContext);

/** What the world looks like: the event's theme, or the scene the room owner picked. */
export const themeFor = (event: SeasonalEvent | null, roomScene: SceneId): EventTheme => event?.theme ?? (roomScene === "festival" ? FESTIVAL_THEME : VALLEY_THEME);

/**
 * Looking at an event before it starts: add ?event=halloween to the address.
 * The server allows this only in development or for a signed-in admin, and it changes
 * nothing for anyone else: no hats unlock and nobody else sees it.
 */
export function useEventPreview(): SeasonalEvent | null {
  const [preview, setPreview] = useState<SeasonalEvent | null>(null);
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("event");
    if (!slug) return;
    fetch(`/api/events/preview?slug=${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPreview(data?.event ?? null))
      .catch(() => {});
  }, []);
  return preview;
}
