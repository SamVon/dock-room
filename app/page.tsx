"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DuckSprite } from "@/components/Duck";
import { PixelButton, PixelIconButton, PixelInput, PixelPanel } from "@/components/pixel/ui";
import { ProfileFields } from "@/components/ProfileFields";
import { RoomScene } from "@/components/RoomScene";
import { EventProvider, themeFor, useEventPreview } from "@/features/events/event-provider";
import { EventBanner, EventParticles } from "@/features/events/event-renderer";
import { createRoom, ensureSession } from "@/lib/api";
import { loadProfile, saveProfile, useCalm, useNight, type Profile } from "@/lib/profile";
import type { SeasonalEvent } from "@/shared/events";
import { LIMITS, type DuckColorId, type SceneId } from "@/shared/protocol";

// Ducks that wander around the valley behind the menu: [color, left %, top %, seconds, distance].
const WANDERERS: [DuckColorId, number, number, number, string][] = [
  ["white", 6, 62, 22, "22vw"],
  ["blue", 62, 72, 28, "26vw"],
  ["pink", 30, 86, 18, "18vw"],
];

export default function Home() {
  const router = useRouter();
  const [night, toggleNight] = useNight();
  useCalm();
  const [profile, setProfile] = useState<Profile>({ name: "", color: "yellow", item: "none", head: null });
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [scene, setScene] = useState<SceneId>("valley");
  const [inventory, setInventory] = useState<string[]>([]);
  const [activeEvent, setActiveEvent] = useState<SeasonalEvent | null>(null);
  const preview = useEventPreview();
  const event = preview ?? activeEvent;
  const theme = themeFor(event, scene);

  useEffect(() => {
    const saved = loadProfile();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setProfile(saved);
    // The menu shows the same world new rooms will start in.
    ensureSession().then(
      (session) => {
        setScene(session.scene);
        setActiveEvent(session.event.event);
        setInventory(session.inventory);
      },
      () => {},
    );
  }, []);

  const name = profile.name.trim();
  const enter = (roomCode: string) => {
    saveProfile({ ...profile, name });
    router.push(`/room/${roomCode}`);
  };

  // The server creates the room and picks its code.
  const create = async () => {
    setCreating(true);
    setError("");
    try {
      enter(await createRoom());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a room");
      setCreating(false);
    }
  };

  return (
    <EventProvider event={event}>
    <main className="relative flex h-dvh items-center justify-center overflow-hidden p-4">
      <RoomScene night={night} theme={theme} />
      {WANDERERS.map(([color, left, top, seconds, walk]) => (
        <div
          key={color}
          aria-hidden
          className="duck-wander absolute hidden sm:block"
          style={{ left: `${left}%`, top: `${top}%`, "--wander": `${seconds}s`, "--walk": walk } as React.CSSProperties}
        >
          <DuckSprite color={color} animation="walk" />
        </div>
      ))}

      <EventParticles theme={theme} night={night} />
      {event && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center">
          <EventBanner event={event} />
        </div>
      )}

      <PixelPanel className="pop-in relative z-10 max-h-full w-full max-w-md overflow-y-auto p-5">
        <div className="mb-5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-pixel text-4xl leading-none uppercase">Duck Room</h1>
            <p className="font-pixel mt-1.5 text-sm text-[var(--coral)] uppercase">Chat • Chill • Listen</p>
          </div>
          <PixelIconButton label={night ? "Switch to day" : "Switch to night"} onClick={toggleNight} variant="cream">
            {night ? "☾" : "☀"}
          </PixelIconButton>
        </div>

        <ProfileFields profile={profile} onChange={setProfile} inventory={inventory} />

        <PixelButton variant="coral" arrow disabled={!name || creating} onClick={create} className="mt-6 w-full text-lg">
          {creating ? "Creating…" : "Create room"}
        </PixelButton>
        {error && (
          <p role="alert" className="mt-3 text-center text-sm font-bold text-[var(--coral)]">
            {error}
          </p>
        )}

        <p className="font-pixel mt-5 mb-2.5 text-center text-xs text-[var(--muted)] uppercase">or join a friend</p>
        <form
          className="flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name && code) enter(code);
          }}
        >
          <PixelInput
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, LIMITS.roomCode))}
            placeholder="Room code"
            aria-label="Room code"
            className="font-pixel min-w-0 flex-1 tracking-widest uppercase"
          />
          <PixelButton type="submit" arrow disabled={!name || code.length !== LIMITS.roomCode} className="shrink-0">
            Waddle in
          </PixelButton>
        </form>
      </PixelPanel>
    </main>
    </EventProvider>
  );
}
