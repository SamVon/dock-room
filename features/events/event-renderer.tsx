"use client";

// Draws what an event's configuration asks for, by looking each name up in the registries.
import { useEffect, useState, type CSSProperties } from "react";
import { PixelButton, PixelDialog, PixelPanel } from "@/components/pixel/ui";
import type { SceneContext } from "@/components/scene/parts";
import { particleTile } from "@/lib/sceneSprites";
import { findWearable } from "@/shared/cosmetics";
import type { EventTheme, SeasonalEvent } from "@/shared/events";
import { decorationRegistry, particleRegistry, resolveWeather, type DecorationLayer } from "./event-registry";

const warned = new Set<string>();
/** A name with no art is skipped. Say so once in the console, so a config mistake is easy to find. */
const skip = (kind: string, name: string) => {
  if (warned.has(kind + name)) return;
  warned.add(kind + name);
  console.warn(`Duck Room event: unknown ${kind} "${name}" was skipped`);
};

/** The parts of the chosen decorations that belong to one layer of the scene. */
export function EventDecorations({ items, layer, context }: { items: readonly string[]; layer: DecorationLayer; context: SceneContext }) {
  return items.map((name) => {
    const decoration = decorationRegistry[name];
    if (!decoration) {
      skip("decoration", name);
      return null;
    }
    const part = decoration[layer]?.(context);
    return part ? <div key={name} className="contents">{part}</div> : null;
  });
}

const TILE_PX = 96;

/** Weather and particles, drawn over the whole scene. Each effect is a single element. */
export function EventParticles({ theme, night }: { theme: EventTheme; night: boolean }) {
  const weather = resolveWeather(theme.weather);
  const names = [...new Set([...weather.particles, ...(theme.particles ?? [])])];

  return (
    <div className="pointer-events-none absolute inset-0 z-[1002] overflow-hidden" aria-hidden>
      {names.map((name) => {
        const config = particleRegistry[name];
        if (!config) {
          skip("particle", name);
          return null;
        }
        if (config.kind === "custom") return <div key={name} className="contents">{config.render(night)}</div>;
        if (config.nightOnly && !night) return null;
        const tile = particleTile(name, config.sparse);
        if (!tile) return null;
        // A sparse tile is twice as wide and tall, with the same pixels and more empty space.
        const tilePx = config.sparse ? TILE_PX * 2 : TILE_PX;
        return (
          <div
            key={name}
            className={`particles particles-${config.motion} pixel-art absolute inset-0`}
            style={
              {
                "--tile": `${tilePx}px`,
                "--dx": config.drift ? `${tilePx}px` : "0px",
                backgroundImage: `url("${tile.url}")`,
                animationDuration: `${config.seconds}s`,
              } as CSSProperties
            }
          />
        );
      })}
      {weather.lightning && <div className="lightning absolute inset-0 bg-white" />}
    </div>
  );
}

/** "2d 14h", "3h 20m" or "12m" until the event ends. Display only: the server decides when it really ends. */
function useCountdown(endAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.floor((Date.parse(endAt) - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** How long the full banner stays before it folds down to a small badge. */
const BANNER_MS = 8000;
const dismissedKey = (event: SeasonalEvent) => `duck:event-banner:${event.id}:${event.startAt}`;

/**
 * The event banner. Everything on it comes from the event's configuration.
 *
 * It announces the event for a few seconds, then folds into a small badge so it is not in the
 * way. Closing it with the cross removes it for good on this device, for this run of the event.
 */
export function EventBanner({ event, onWardrobe, className = "" }: { event: SeasonalEvent; onWardrobe?: () => void; className?: string }) {
  const [view, setView] = useState<"hidden" | "full" | "badge">("hidden");
  const [open, setOpen] = useState(false);
  const endsIn = useCountdown(event.endAt);
  // Depend on the event's identity, not the object: the server re-sends the same event often.
  const key = dismissedKey(event);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(key) === "1";
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(dismissed ? "hidden" : "full");
    if (dismissed) return;
    const timer = setTimeout(() => setView((current) => (current === "full" ? "badge" : current)), BANNER_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const dismiss = () => {
    setView("hidden");
    setOpen(false);
    try {
      localStorage.setItem(key, "1");
    } catch {}
  };

  const hats = (event.ducks?.accessories ?? []).map((id) => findWearable(id)?.name).filter(Boolean);
  const title = event.ui?.bannerTitle ?? event.name;
  const icon = event.ui?.icon ?? "✦";

  return (
    <>
      {view === "full" && (
        <PixelPanel className={`pop-in pointer-events-auto flex max-w-full items-center gap-2.5 py-1.5 pr-1.5 pl-3 ${className}`} role="status">
          <span className="text-xl" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0">
            <p className="font-pixel truncate text-sm leading-tight uppercase" style={{ color: event.ui?.accent }}>
              {title}
            </p>
            <p className="truncate text-xs leading-tight text-[var(--muted)]">
              {event.ui?.bannerSubtitle ? `${event.ui.bannerSubtitle} ` : ""}Ends in {endsIn}
            </p>
          </div>
          <PixelButton onClick={() => setOpen(true)} arrow className="shrink-0 text-xs">
            Explore
          </PixelButton>
          <button onClick={dismiss} aria-label="Close the event banner" title="Close" className="pixel-focus font-pixel grid size-11 shrink-0 place-items-center text-[var(--muted)] hover:text-[var(--coral)]">
            ✕
          </button>
        </PixelPanel>
      )}

      {view === "badge" && (
        <PixelButton onClick={() => setOpen(true)} variant="cream" className={`pop-in pointer-events-auto size-11 !p-0 text-xl ${className}`} aria-label={`${title}: show details`} title={`${title} · ends in ${endsIn}`}>
          {icon}
        </PixelButton>
      )}

      {open && (
        <PixelDialog title={title} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3 text-sm">
            {event.description && <p>{event.description}</p>}
            <p className="font-pixel text-xs text-[var(--muted)] uppercase">
              Until {new Date(event.endAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · {endsIn} left
            </p>
            {hats.length > 0 && (
              <div className="bg-[var(--field)] px-3 py-2 shadow-[inset_0_0_0_2px_var(--line)]">
                <p className="font-pixel mb-1 text-xs uppercase">Event hats</p>
                <p className="text-[var(--muted)]">{hats.join(", ")}</p>
              </div>
            )}
            {onWardrobe && hats.length > 0 && (
              <PixelButton
                variant="coral"
                arrow
                onClick={() => {
                  setOpen(false);
                  onWardrobe();
                }}
              >
                Open wardrobe
              </PixelButton>
            )}
            <PixelButton variant="cream" onClick={dismiss}>
              Hide the event badge
            </PixelButton>
          </div>
        </PixelDialog>
      )}
    </>
  );
}
