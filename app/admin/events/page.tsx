"use client";

// Admin: create and edit seasonal events. Everything here goes through /api/admin/*,
// which needs the admin password (an account made on the server with `npm run admin set <name>`). Room users never see this page's data.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PixelButton, PixelInput, PixelPanel } from "@/components/pixel/ui";
import { RoomScene } from "@/components/RoomScene";
import { EventParticles } from "@/features/events/event-renderer";
import { useNight } from "@/lib/profile";
import type { ActiveEventState, SeasonalEvent } from "@/shared/events";

type Row = { event: SeasonalEvent; problems: string[]; status: string };
type Options = { scenes: string[]; decorations: string[]; particles: string[]; weathers: string[]; minigames: string[]; accessories: string[] };
type Listing = { active: ActiveEventState; events: Row[]; options: Options };

const HEADERS = { "content-type": "application/json", "x-duck-room": "1" };

const blankEvent = (): SeasonalEvent => ({
  id: `evt-${Date.now().toString(36)}`,
  slug: "",
  name: "",
  enabled: false,
  startAt: new Date().toISOString(),
  endAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  priority: 50,
  theme: { scene: "duck-valley" },
});

// <input type="datetime-local"> works in local time without a zone; events are stored as full ISO times.
const toLocal = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (value: string) => (value ? new Date(value).toISOString() : "");

/** Drops empty text and empty lists, so the saved config stays tidy and passes validation. */
function tidy<T>(value: T): T {
  if (Array.isArray(value)) return value as T;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, inner]) => [key, tidy(inner)] as const)
      .filter(([, inner]) => inner !== "" && inner !== undefined && !(Array.isArray(inner) && inner.length === 0) && !(inner && typeof inner === "object" && !Array.isArray(inner) && Object.keys(inner).length === 0));
    return Object.fromEntries(entries) as T;
  }
  return value;
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-2">
    <span className="font-pixel text-xs uppercase">{label}</span>
    {children}
  </label>
);

const Select = ({ value, options, onChange, empty }: { value: string; options: string[]; onChange: (value: string) => void; empty?: string }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="pixel-input w-full text-base">
    {empty !== undefined && <option value="">{empty}</option>}
    {options.map((option) => (
      <option key={option} value={option}>
        {option}
      </option>
    ))}
  </select>
);

/** Pick any number of names from a list. */
function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <fieldset>
      <legend className="font-pixel mb-2 text-xs uppercase">{label}</legend>
      <div className="flex flex-wrap gap-2.5">
        {options.map((option) => {
          const on = value.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((item) => item !== option) : [...value, option])}
              className={`pixel-tag pixel-focus cursor-pointer px-2 py-1 ${on ? "pixel-tag-self" : ""}`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function AdminEventsPage() {
  const [night] = useNight();
  const [access, setAccess] = useState<"checking" | "off" | "login" | "ok">("checking");
  const [listing, setListing] = useState<Listing | null>(null);
  const [draft, setDraft] = useState<SeasonalEvent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/events", { cache: "no-store" });
    if (res.status === 404) return setAccess("off");
    if (res.status === 401) return setAccess("login");
    setListing(await res.json());
    setAccess("ok");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setMessage("Could not reach the server"));
  }, [load]);

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/admin/login", { method: "POST", headers: HEADERS, body: JSON.stringify({ username, password }) });
    setPassword("");
    if (!res.ok) return setMessage((await res.json()).error?.message ?? "Sign-in failed");
    setMessage("");
    await load();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const res = await fetch("/api/admin/events", { method: "PUT", headers: HEADERS, body: JSON.stringify(tidy(draft)) });
    const data = await res.json();
    if (!res.ok) return setMessage(data.error?.message ?? "Could not save");
    setMessage(`Saved "${data.event.name}"`);
    setIsNew(false);
    await load();
  };

  const remove = async () => {
    if (!draft || !window.confirm(`Delete "${draft.name}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/events?slug=${encodeURIComponent(draft.slug)}`, { method: "DELETE", headers: HEADERS });
    setDraft(null);
    setMessage("Deleted");
    await load();
  };

  const signOut = async () => {
    await fetch("/api/admin/logout", { method: "POST", headers: HEADERS });
    setListing(null);
    setDraft(null);
    setAccess("login");
  };

  if (access === "checking") return null;

  if (access !== "ok" || !listing) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <PixelPanel className="w-full max-w-sm p-5">
          <h1 className="font-pixel mb-3 text-2xl uppercase">Event admin</h1>
          {access === "off" ? (
            <p className="text-sm">
              There is no admin account yet. On the server, run <code>npm run admin set yourname</code> and choose a password, then reload this page.
            </p>
          ) : (
            <form onSubmit={signIn} className="flex flex-col gap-4">
              <Field label="Admin name">
                <PixelInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} />
              </Field>
              <Field label="Password">
                <PixelInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </Field>
              <PixelButton type="submit" variant="coral" arrow disabled={!username || !password}>
                Sign in
              </PixelButton>
            </form>
          )}
          {message && (
            <p role="alert" className="mt-3 text-sm font-bold text-[var(--coral)]">
              {message}
            </p>
          )}
        </PixelPanel>
      </main>
    );
  }

  const { options } = listing;
  const row = listing.events.find((item) => item.event.slug === draft?.slug);
  const update = (change: Partial<SeasonalEvent>) => draft && setDraft({ ...draft, ...change });
  const theme = (change: Partial<SeasonalEvent["theme"]>) => draft && setDraft({ ...draft, theme: { ...draft.theme, ...change } });
  const ui = (change: NonNullable<SeasonalEvent["ui"]>) => draft && setDraft({ ...draft, ui: { ...draft.ui, ...change } });
  const features = (change: NonNullable<SeasonalEvent["features"]>) => draft && setDraft({ ...draft, features: { ...draft.features, ...change } });

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-5 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="font-pixel flex-1 text-2xl uppercase [text-shadow:2px_2px_0_var(--panel)]">Seasonal events</h1>
        <PixelButton
          onClick={() => {
            setDraft(blankEvent());
            setIsNew(true);
          }}
          variant="coral"
        >
          New event
        </PixelButton>
        <PixelButton onClick={signOut} variant="cream">
          Sign out
        </PixelButton>
      </header>

      {message && (
        <PixelPanel role="status" className="px-3 py-2 text-sm font-bold">
          {message}
        </PixelPanel>
      )}

      <div className="grid gap-5 md:grid-cols-[18rem_1fr]">
        <PixelPanel className="flex flex-col gap-1 self-start p-2">
          {listing.events.map(({ event, status, problems }) => (
            <button
              key={event.slug}
              onClick={() => {
                setDraft(event);
                setIsNew(false);
                setMessage("");
              }}
              className={`pixel-focus flex items-center gap-2 px-2 py-2 text-left ${draft?.slug === event.slug ? "bg-[var(--field)] shadow-[inset_0_0_0_2px_var(--line)]" : ""}`}
            >
              <span aria-hidden>{event.ui?.icon ?? "✦"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{event.name}</span>
                <span className="font-pixel block text-[11px] text-[var(--muted)] uppercase">
                  {listing.active.slug === event.slug ? <span className="text-[var(--online)]">● active now</span> : status} · priority {event.priority}
                  {problems.length > 0 && ` · ${problems.length} warning${problems.length > 1 ? "s" : ""}`}
                </span>
              </span>
            </button>
          ))}
        </PixelPanel>

        {draft ? (
          <PixelPanel className="p-4">
            <form onSubmit={save} className="flex flex-col gap-5">
              {/* A live look at the scene this config produces. */}
              <div className="relative h-56 overflow-hidden shadow-[0_0_0_4px_var(--outline)]">
                <RoomScene night={night} theme={draft.theme} />
                <EventParticles theme={draft.theme} night={night} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <PixelInput value={draft.name} onChange={(e) => update({ name: e.target.value })} maxLength={60} required />
                </Field>
                <Field label="Slug (used in addresses)">
                  <PixelInput value={draft.slug} onChange={(e) => update({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} readOnly={!isNew} maxLength={40} required />
                </Field>
              </div>
              <Field label="Description">
                <PixelInput value={draft.description ?? ""} onChange={(e) => update({ description: e.target.value })} maxLength={300} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Starts">
                  <PixelInput type="datetime-local" value={toLocal(draft.startAt)} onChange={(e) => update({ startAt: fromLocal(e.target.value) })} required />
                </Field>
                <Field label="Ends">
                  <PixelInput type="datetime-local" value={toLocal(draft.endAt)} onChange={(e) => update({ endAt: fromLocal(e.target.value) })} required />
                </Field>
                <Field label="Priority">
                  <PixelInput type="number" min={0} max={1000} value={draft.priority} onChange={(e) => update({ priority: Number(e.target.value) })} />
                </Field>
                <div className="flex flex-col gap-2">
                  <span className="font-pixel text-xs uppercase">Enabled</span>
                  <PixelButton onClick={() => update({ enabled: !draft.enabled })} aria-pressed={draft.enabled} variant={draft.enabled ? "coral" : "cream"}>
                    {draft.enabled ? "On" : "Off"}
                  </PixelButton>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Scene">
                  <Select value={draft.theme.scene} options={options.scenes} onChange={(scene) => theme({ scene })} />
                </Field>
                <Field label="Weather">
                  <Select value={draft.theme.weather ?? ""} options={options.weathers} onChange={(weather) => theme({ weather: weather || undefined })} empty="clear" />
                </Field>
                <Field label="Music station id">
                  <PixelInput value={draft.theme.musicStation ?? ""} onChange={(e) => theme({ musicStation: e.target.value.replace(/[^a-zA-Z0-9-]/g, "") || undefined })} placeholder="festival-lofi" />
                </Field>
              </div>

              <Chips label="Decorations" options={options.decorations} value={draft.theme.decorations ?? []} onChange={(decorations) => theme({ decorations })} />
              <Chips label="Particles" options={options.particles} value={draft.theme.particles ?? []} onChange={(particles) => theme({ particles })} />
              <Chips label="Duck accessories unlocked" options={options.accessories} value={draft.ducks?.accessories ?? []} onChange={(accessories) => update({ ducks: { ...draft.ducks, accessories } })} />

              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Banner icon">
                  <PixelInput value={draft.ui?.icon ?? ""} onChange={(e) => ui({ icon: e.target.value })} maxLength={8} />
                </Field>
                <Field label="Banner title">
                  <PixelInput value={draft.ui?.bannerTitle ?? ""} onChange={(e) => ui({ bannerTitle: e.target.value })} maxLength={40} />
                </Field>
                <Field label="Banner subtitle">
                  <PixelInput value={draft.ui?.bannerSubtitle ?? ""} onChange={(e) => ui({ bannerSubtitle: e.target.value })} maxLength={80} />
                </Field>
                <Field label="Accent color">
                  <input type="color" value={draft.ui?.accent ?? "#ef6d64"} onChange={(e) => ui({ accent: e.target.value })} className="pixel-input h-11 w-full p-1" />
                </Field>
              </div>

              <fieldset>
                <legend className="font-pixel mb-2 text-xs uppercase">Features (saved with the event; gameplay for these is not built yet)</legend>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {(["quests", "rewards", "leaderboard"] as const).map((name) => (
                    <label key={name} className="flex min-h-11 items-center gap-2">
                      <input type="checkbox" checked={!!draft.features?.[name]} onChange={(e) => features({ [name]: e.target.checked || undefined })} className="size-5 accent-[var(--coral)]" />
                      {name}
                    </label>
                  ))}
                  <div className="w-52">
                    <Select value={draft.features?.minigame ?? ""} options={options.minigames} onChange={(minigame) => features({ minigame: minigame || undefined })} empty="no minigame" />
                  </div>
                </div>
              </fieldset>

              {row && row.problems.length > 0 && (
                <div className="bg-[var(--field)] px-3 py-2 text-sm shadow-[inset_0_0_0_2px_var(--line)]">
                  <p className="font-pixel text-xs uppercase">Warnings</p>
                  <ul className="list-inside list-disc text-[var(--muted)]">
                    {row.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-4">
                <PixelButton type="submit" variant="coral" arrow>
                  Save
                </PixelButton>
                {!isNew && (
                  <>
                    <a href={`/?event=${draft.slug}`} target="_blank" rel="noreferrer" className="pixel-btn">
                      Preview <span aria-hidden>→</span>
                    </a>
                    <PixelButton onClick={remove} variant="cream">
                      Delete
                    </PixelButton>
                  </>
                )}
              </div>
            </form>
          </PixelPanel>
        ) : (
          <PixelPanel className="self-start p-4 text-sm">Pick an event on the left, or make a new one.</PixelPanel>
        )}
      </div>
    </main>
  );
}
