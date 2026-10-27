"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { Duck, DuckSprite, FLOOR_HEIGHT, FLOOR_TOP } from "@/components/Duck";
import { PixelButton, PixelDialog, PixelIconButton, PixelInput, PixelPanel } from "@/components/pixel/ui";
import { CosmeticInventory } from "@/components/cosmetics/CosmeticInventory";
import { ItemPicker } from "@/components/ItemPicker";
import { ProfileFields } from "@/components/ProfileFields";
import { ChatPanel } from "@/components/room/ChatPanel";
import { MusicRadio } from "@/components/room/MusicRadio";
import { UserHUD } from "@/components/room/UserHUD";
import { RoomScene } from "@/components/RoomScene";
import { themeFor, useEventPreview } from "@/features/events/event-provider";
import { EventBanner, EventParticles } from "@/features/events/event-renderer";
import { FloatingKrathongs } from "@/features/krathong/FloatingKrathongs";
import { createKrathongTimeline } from "@/lib/krathongTimeline";
import { StickerBar } from "@/features/stickers/StickerBar";
import { StickerInteractionRenderer } from "@/features/stickers/StickerInteractionRenderer";
import { VoiceDock } from "@/features/voice/VoiceDock";
import { VoiceClient, type VoiceStatus } from "@/features/voice/voice-client";
import { ensureSession } from "@/lib/api";
import { MusicEngine } from "@/lib/audio";
import { loadProfile, saveProfile, useCalm, useNight, type Profile } from "@/lib/profile";
import { stationLook } from "@/lib/stations";
import type { WearableCategory } from "@/shared/cosmetics";
import { NO_EVENT, stationName, type EventSnapshot } from "@/shared/events";
import { INTERACTION_ZONES, PLACE_MS, inZone, type FloatingKrathong, type KrathongVariant } from "@/shared/interactions";
import { classifyVersion, clockOffset as offsetFrom, newCommandId as commandId, newer, walkDurationMs } from "@/shared/sync";
import type { DeltaEvent, RoomResyncPayload, SocketAck, StickerMatchPayload } from "@/shared/protocol";
import { STICKERS, STICKER_IDS, isSeasonalSticker, stickerAvailable, type StickerId } from "@/shared/stickers";
import type { VoiceParticipant } from "@/shared/voice";
import {
  LIMITS,
  canControlMusic,
  type MusicControlMode,
  type RoomMusicSettings,
  type ChatMessage,
  type ClientToServerEvents,
  type HeldItemId,
  type MusicState,
  type RoomUser,
  type SceneId,
  type ServerToClientEvents,
  type SocketError,
  type Station,
} from "@/shared/protocol";

const BUBBLE_MS = 5000;
const MAX_MESSAGES = 100;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_SESSION_RETRIES = 3;
const STICKER_MS = 2500;
/** A duck that has not moved or talked for this long falls asleep (when no music is playing). */
const SLEEP_AFTER_MS = 60_000;
/** While someone is speaking in the voice chat, the radio plays this much quieter so they can be heard. */
const MUSIC_UNDER_VOICE = 0.3;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

type Bubble = { id: string; text: string };
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const JOIN_ERROR_TITLES: Partial<Record<SocketError["code"], string>> = {
  ROOM_NOT_FOUND: "This pond is empty",
  ROOM_FULL: "This pond is full",
  RATE_LIMITED: "Slow down, duck",
  UNAUTHENTICATED: "You waddled off",
  CONFLICT: "You waddled off",
  NOT_IN_ROOM: "You waddled off",
};

export default function RoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = rawCode.toUpperCase();
  const router = useRouter();
  const [night, toggleNight] = useNight();
  const [calm, toggleCalm] = useCalm();
  // The system's own "reduce motion" setting counts the same as the switch in Settings.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // undefined = still reading localStorage, null = visitor has no duck yet
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [draft, setDraft] = useState<Profile>({ name: "", color: "yellow", item: "none", head: null });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(loadProfile());
    // For the dressing screen shown to someone who opens an invite link: the season's scene
    // and what this session may wear, before any room is joined.
    ensureSession().then(
      (session) => {
        setScene(session.scene);
        acceptEvent(session.event);
        setInventory(session.inventory);
      },
      () => {},
    );
  }, []);

  // Everything below mirrors what the server says. The server is the source of truth for
  // who is here, who owns the room, where ducks are, the chat and the music.
  const [selfId, setSelfId] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const [stations, setStations] = useState<Station[]>([]);
  const [music, setMusic] = useState<MusicState>({ stationId: "lofi", playing: false, changedAt: 0, changedByUserId: "", version: 0, tracks: [] });
  const [scene, setScene] = useState<SceneId>("valley");
  // The seasonal event comes from the server. An older version never replaces a newer one.
  const [eventSnapshot, setEventSnapshot] = useState<EventSnapshot>(NO_EVENT);
  const acceptEvent = (next: EventSnapshot) => setEventSnapshot((current) => (next.state.version >= current.state.version ? next : current));
  const preview = useEventPreview();
  const event = preview ?? eventSnapshot.event;
  const theme = themeFor(event, scene);
  /** Wearables the server says we may equip here. Ours only; other ducks never see this list. */
  const [inventory, setInventory] = useState<string[]>([]);
  const [musicSettings, setMusicSettings] = useState<RoomMusicSettings>({ controlMode: "OWNER_ONLY", djUserIds: [] });
  /** Members who asked the owner for DJ access and have not been answered yet. */
  const [djRequests, setDjRequests] = useState<string[]>([]);
  const [djRequestSent, setDjRequestSent] = useState(false);
  const [joinError, setJoinError] = useState<SocketError | null>(null);
  const [notice, setNotice] = useState("");
  const [unread, setUnread] = useState(0);
  // Stickers: what each duck just sent, and the shared animations the server has started.
  const [stickers, setStickers] = useState<Record<string, { id: number; icon: string }>>({});
  const [interactions, setInteractions] = useState<StickerMatchPayload[]>([]);
  const [stickersResting, setStickersResting] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  // Krathongs on the river, and ducks busy setting one down.
  const [krathongs, setKrathongs] = useState<FloatingKrathong[]>([]);
  const [releasing, setReleasing] = useState<Record<string, true>>({});
  // Voice chat. Who is in it is the server's word; who is speaking is measured in this browser from the sound.
  const [voiceUsers, setVoiceUsers] = useState<VoiceParticipant[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("off");
  const [micMuted, setMicMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(new Set());
  const voiceRef = useRef<VoiceClient | null>(null);
  /** Server clock minus ours, so an animation starts at the same moment on every screen. */
  const clockOffset = useRef(0);
  const [online, setOnline] = useState(false);
  const [asleep, setAsleep] = useState<ReadonlySet<string>>(new Set());
  /** userId -> when that duck last moved or talked */
  const lastActive = useRef(new Map<string, number>());
  const socketRef = useRef<AppSocket | null>(null);
  /** What our duck holds right now. A ref, so a reconnect rejoins with the latest choice. */
  const heldItemRef = useRef<HeldItemId>("none");
  const headRef = useRef<string | null>(null);
  const chatOpenRef = useRef(true);
  /** Where the server last said each duck is. Our own duck may be shown ahead of this for a moment (see walkTo). */
  const serverPositions = useRef(new Map<string, { x: number; y: number }>());
  /** When the last krathong request was sent and not yet answered (0 = none waiting). */
  const krathongSentAt = useRef(0);

  useEffect(() => {
    if (!profile) return;
    heldItemRef.current = profile.item;
    headRef.current = profile.head;
    let socket: AppSocket | undefined;
    let cancelled = false;
    // The krathongs on this room's river. It owns its timers, and they end when we leave the room.
    const river = createKrathongTimeline(setKrathongs, () => Date.now() + clockOffset.current);
    let sessionRetries = 0;
    let myId = "";
    let voice: VoiceClient | undefined;

    const start = async () => {
      // The server issues the anonymous session (an HttpOnly cookie) before the socket connects.
      const session = await ensureSession();
      if (cancelled) return;
      setScene(session.scene);
      setInventory(session.inventory);
      socket = io();
      socketRef.current = socket;
      const live = socket;
      const talk = new VoiceClient(live, { onStatus: setVoiceStatus, onSpeaking: (ids) => setSpeaking(new Set(ids)), onError: setNotice });
      voice = talk;
      voiceRef.current = talk;

      const active = (userId: string) => lastActive.current.set(userId, Date.now());

      // --- The synchronization contract, client side ---------------------------------------
      // A snapshot replaces everything we hold. After it, each update carries the next room
      // version: we apply the next one, ignore old ones, and if one is missing we ask for a new snapshot.
      let lastVersion: number | null = null;
      const known = new Set<string>(); // users we have been told about
      let askedAt = 0;
      const resync = (reason: RoomResyncPayload["reason"]) => {
        if (Date.now() - askedAt < 2000) return; // one request is enough; the snapshot is on its way
        askedAt = Date.now();
        live.emit("room:resync", { roomCode: code, reason });
      };
      const onDelta = <E extends DeltaEvent>(event: E, apply: (update: Parameters<ServerToClientEvents[E]>[0]) => void) => {
        const listener = (update: Parameters<ServerToClientEvents[E]>[0]) => {
          const verdict = classifyVersion(lastVersion, update.roomVersion);
          if (verdict === "ignore") return;
          if (verdict === "gap") return resync("VERSION_GAP");
          lastVersion = update.roomVersion;
          // An update about someone we have never heard of means we missed their arrival.
          if ("userId" in update && !known.has(update.userId) && event !== "room:userLeft") return resync("UNKNOWN_OBJECT");
          apply(update);
        };
        (live.on as (name: string, handler: typeof listener) => void)(event, listener);
      };

      // Runs on the first connection and after every reconnect. Either way the answer is a full snapshot.
      let wasInRoom = false;
      live.on("connect", () => {
        sessionRetries = 0;
        lastVersion = null;
        setOnline(true);
        const join = () => {
          const wish = { heldItem: heldItemRef.current, equipment: { head: headRef.current } };
          live.emit("room:join", { roomCode: code, displayName: profile.name, duckColor: profile.color, ...wish }, (res) => {
            wasInRoom = res.ok;
            setJoinError(res.ok ? null : res.error);
          });
        };
        if (!wasInRoom) return join();
        // We were in this room a moment ago: ask for our duck back. If the room no longer holds it, join as new.
        live.emit("room:resume", { roomCode: code, lastKnownVersions: {} }, (res) => {
          if (res.ok) setJoinError(null);
          else if (res.error.code === "NOT_IN_ROOM") join();
          else setJoinError(res.error);
        });
      });
      live.on("disconnect", () => setOnline(false));
      live.on("connect_error", (error) => {
        // An expired session: ask for a new one and try again, a few times at most.
        if (error.message === "UNAUTHENTICATED" && sessionRetries++ < MAX_SESSION_RETRIES) {
          ensureSession().then(() => !cancelled && live.connect(), () => {});
        } else if (error.message === "RATE_LIMITED") {
          setJoinError({ code: "RATE_LIMITED", message: "Too many connections. Wait a minute and reload." });
        }
      });

      live.on("room:snapshot", (state) => {
        myId = state.selfId;
        lastVersion = state.version;
        known.clear();
        state.users.forEach((user) => {
          known.add(user.id);
          serverPositions.current.set(user.id, { x: user.x, y: user.y });
        });
        clockOffset.current = offsetFrom(state.serverTime);
        // Anything in flight belonged to the old picture of the room.
        setInteractions([]);
        setReleasing({});
        setBubbles({});
        setStickers({});
        setSelfId(state.selfId);
        setOwnerUserId(state.ownerUserId);
        setScene(state.scene);
        acceptEvent(state.event);
        setInventory(state.inventory);
        setUsers(state.users);
        state.users.forEach((user) => active(user.id));
        setStations(state.stations);
        setMusic(state.music);
        setMusicSettings(state.musicSettings);
        river.reset(state.krathongs);
        setVoiceUsers(state.voice);
        talk.sync(state.voice.map((item) => item.userId), state.selfId);
      });
      live.on("chat:history", (history) => setMessages(history.messages));
      onDelta("room:userJoined", ({ user }) => {
        known.add(user.id);
        active(user.id);
        serverPositions.current.set(user.id, { x: user.x, y: user.y });
        // Someone returning keeps their place in the list; a new duck goes at the end.
        setUsers((list) => (list.some((u) => u.id === user.id) ? list.map((u) => (u.id === user.id ? user : u)) : [...list, user]));
      });
      onDelta("room:userLeft", ({ userId }) => {
        known.delete(userId);
        setUsers((list) => list.filter((u) => u.id !== userId));
      });
      // A connection dropped, or came back, while the duck is still held in the room.
      onDelta("room:presence", ({ userId, connected }) => setUsers((list) => list.map((u) => (u.id === userId ? { ...u, connected } : u))));
      onDelta("room:ownerChanged", (change) => setOwnerUserId(change.ownerUserId));
      onDelta("room:settingsChanged", (change) => setScene(change.settings.scene));
      live.on("event:state", acceptEvent);
      live.on("cosmetic:inventory", (change) => setInventory(change.wearableIds));
      // Appearance is separate from position: moving never touches this, and this never moves a duck.
      onDelta("duck:appearance", ({ userId, appearance }) =>
        setUsers((list) => list.map((u) => (u.id === userId ? { ...u, duckColor: appearance.color, equipment: appearance.equipment } : u))),
      );
      onDelta("duck:moved", (move) => {
        active(move.userId);
        serverPositions.current.set(move.userId, move.destination);
        setUsers((list) => list.map((u) => (u.id === move.userId ? { ...u, ...move.destination } : u)));
      });
      onDelta("duck:item", (change) => {
        active(change.userId);
        setUsers((list) => list.map((u) => (u.id === change.userId ? { ...u, heldItem: change.heldItem } : u)));
      });
      onDelta("chat:message", ({ message }) => {
        setMessages((list) => [...list.slice(1 - MAX_MESSAGES), message]);
        // Speech bubbles only ever come from chat messages the server accepted.
        if (message.type !== "user") return;
        const { userId, id } = message;
        active(userId);
        if (!chatOpenRef.current && userId !== myId) setUnread((n) => n + 1);
        setBubbles((b) => ({ ...b, [userId]: { id, text: message.text } }));
        setTimeout(() => {
          setBubbles((b) => {
            if (b[userId]?.id !== id) return b;
            const { [userId]: _gone, ...rest } = b;
            return rest;
          });
        }, BUBBLE_MS);
      });

      onDelta("sticker:sent", ({ userId, stickerId, createdAt: sentAt }) => {
        active(userId);
        setStickers((all) => ({ ...all, [userId]: { id: sentAt, icon: STICKERS[stickerId].icon } }));
        setTimeout(() => {
          setStickers((all) => {
            if (all[userId]?.id !== sentAt) return all;
            const { [userId]: _gone, ...rest } = all;
            return rest;
          });
        }, STICKER_MS);
      });
      // Krathongs. Carrying is the server's word, never ours.
      onDelta("duck:stateChanged", ({ userId, activity, carriedItem, endsAt }) => {
        active(userId);
        if (activity !== "releasing-krathong") {
          setUsers((list) => list.map((u) => (u.id === userId ? { ...u, carriedItem: carriedItem ?? undefined } : u)));
          return;
        }
        // The duck bends down, the krathong leaves its wings as it reaches the water, then the duck stands up.
        setReleasing((all) => ({ ...all, [userId]: true }));
        setTimeout(() => setUsers((list) => list.map((u) => (u.id === userId ? { ...u, carriedItem: undefined } : u))), PLACE_MS);
        setTimeout(
          () => {
            setReleasing((all) => {
              const { [userId]: _done, ...rest } = all;
              return rest;
            });
          },
          Math.max(0, (endsAt ?? 0) - (Date.now() + clockOffset.current)),
        );
      });
      // A krathong appears when it touches the water, and is forgotten when its time is up. Its
      // drifting in between needs no messages at all.
      onDelta("krathong:spawned", ({ krathong }) => river.spawn(krathong));
      onDelta("krathong:removed", ({ krathongId }) => river.remove(krathongId));

      // The server matched two ducks. It also says when to begin, so everyone starts together.
      onDelta("sticker:match", (match) => {
        const elapsed = Date.now() - (match.startedAt - clockOffset.current);
        if (elapsed > match.durationMs) return; // arrived too late: do not replay something already over
        const { positions } = match;
        for (const [id, position] of Object.entries(positions ?? {})) serverPositions.current.set(id, position);
        if (positions) setUsers((list) => list.map((u) => (positions[u.id] ? { ...u, ...positions[u.id] } : u)));
        [match.userA, match.userB].forEach(active);
        setTimeout(() => setInteractions((all) => [...all, match]), Math.max(0, -elapsed));
        setTimeout(() => setInteractions((all) => all.filter((item) => item.interactionId !== match.interactionId)), match.durationMs - elapsed);
      });
      // Someone joined or left the voice chat, or switched their microphone. The newcomer calls us;
      // all we do here is hang up on a duck that left.
      onDelta("voice:state", ({ userId, joined, muted }) => {
        setVoiceUsers((list) => [...list.filter((item) => item.userId !== userId), ...(joined ? [{ userId, muted }] : [])]);
        if (!joined) talk.drop(userId);
      });
      // Updates can arrive late or out of order: only a newer version replaces what we have.
      onDelta("music:state", (next) => setMusic((current) => newer(current, next.state)));
      onDelta("music:permissions", ({ mode, djUserIds }) => setMusicSettings({ controlMode: mode, djUserIds }));
      live.on("music:djRequest", ({ userId }) => setDjRequests((list) => (list.includes(userId) ? list : [...list, userId])));
      // Errors with no acknowledgement to carry them. Being replaced by another tab ends this one.
      live.on("socket:error", ({ error }) => (error.code === "CONFLICT" || error.code === "UNAUTHENTICATED" ? setJoinError(error) : setNotice(error.message)));
    };

    start().catch(() => setJoinError({ code: "INTERNAL_ERROR", message: "Could not reach the server. Reload to try again." }));

    return () => {
      cancelled = true;
      river.dispose();
      voice?.dispose();
      voiceRef.current = null;
      // The next connection starts with a fresh voice client: microphone on, sound on.
      setMicMuted(false);
      setDeafened(false);
      socket?.disconnect();
    };
  }, [code, profile]);

  // Quiet ducks doze off. This is only decoration, worked out locally from what the server reported.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const sleepy = [...lastActive.current].filter(([, time]) => now - time > SLEEP_AFTER_MS).map(([id]) => id);
      setAsleep((current) => (current.size === sleepy.length && sleepy.every((id) => current.has(id)) ? current : new Set(sleepy)));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  // --- Music ---------------------------------------------------------------
  const engineRef = useRef<MusicEngine | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const engine = new MusicEngine();
    engineRef.current = engine;
    // Sound never starts by itself: it waits for the first click or tap in the room.
    // These are the gestures every browser accepts for starting audio (a touch "pointerdown" is not).
    // The listeners stay on, so if the first try fails, or the phone pauses audio later, the next
    // tap turns sound back on.
    const gestures = ["click", "touchend", "keydown"] as const;
    const unlock = () => engine.unlock().then(setAudioReady);
    gestures.forEach((gesture) => document.addEventListener(gesture, unlock));
    return () => {
      gestures.forEach((gesture) => document.removeEventListener(gesture, unlock));
      engine.stop();
    };
  }, []);

  // Built-in stations first, then the songs the room owner uploaded.
  // While an event runs, its own station is on the dial too (the server allows it for the same period).
  const eventStation = eventSnapshot.event?.theme.musicStation;
  const dial = eventStation && !stations.some((item) => item.id === eventStation) ? [...stations, { id: eventStation, name: stationName(eventStation), url: null }] : stations;
  const sounds = [
    ...dial.map((item) => ({ ...item, ...stationLook(item.id), custom: false })),
    ...music.tracks.map((track) => ({ ...track, ...stationLook(track.id), custom: true })),
  ];
  const station = sounds.find((item) => item.id === music.stationId) ?? sounds[0] ?? { id: "lofi", name: "Lofi", url: null, custom: false, ...stationLook("lofi") };
  const soundKey = station.url ?? station.id;

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !audioReady) return;
    if (music.playing) engine.play(station, () => setNotice(`Can't play "${station.name}"`));
    else engine.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioReady, music.playing, soundKey]);

  // Only while we are in the voice chat ourselves, and only for other ducks: our own voice is not something we need to hear over.
  const someoneSpeaking = voiceStatus === "on" && !deafened && [...speaking].some((id) => id !== selfId);
  useEffect(() => {
    engineRef.current?.setVolume(muted ? 0 : volume * (someoneSpeaking ? MUSIC_UNDER_VOICE : 1));
  }, [volume, muted, someoneSpeaking]);

  const toggleMic = () => {
    voiceRef.current?.setMuted(!micMuted);
    setMicMuted(!micMuted);
  };
  const toggleDeafen = () => {
    voiceRef.current?.setDeafened(!deafened);
    setDeafened(!deafened);
  };

  // Showing controls is only a convenience: the server checks permission on every command.
  const isOwner = !!selfId && selfId === ownerUserId;
  const canControl = !!selfId && canControlMusic({ ownerUserId, musicSettings }, selfId);
  /** DJs are only marked while the room is in DJ mode; otherwise the role has no effect. */
  const djUserIds = musicSettings.controlMode === "DJ_ONLY" ? musicSettings.djUserIds : [];

  const setControlMode = (mode: MusicControlMode) => socketRef.current?.emit("music:permission:setMode", { commandId: commandId(), mode });
  const setDJ = (userId: string, dj: boolean) => socketRef.current?.emit(dj ? "music:permission:addDJ" : "music:permission:removeDJ", { commandId: commandId(), targetUserId: userId });
  const answerDjRequest = (userId: string, accept: boolean) => {
    setDjRequests((list) => list.filter((id) => id !== userId));
    if (!accept) return;
    // Naming a DJ only matters in DJ mode, so accepting switches an owner-only room to it.
    if (musicSettings.controlMode === "OWNER_ONLY") setControlMode("DJ_ONLY");
    setDJ(userId, true);
  };
  const requestDJ = () => {
    socketRef.current?.emit("music:requestDJ", (res) => setNotice(res.ok ? "Asked the owner for DJ access" : res.error.message));
    setDjRequestSent(true);
    setTimeout(() => setDjRequestSent(false), 30_000);
  };
  const togglePlay = () => socketRef.current?.emit(music.playing ? "music:pause" : "music:play", { commandId: commandId() });
  const pickStation = (stationId: string) => {
    socketRef.current?.emit("music:station", { stationId, commandId: commandId() });
    if (!music.playing) socketRef.current?.emit("music:play", { commandId: commandId() });
  };
  const previousStation = () => {
    const index = sounds.findIndex((item) => item.id === station.id);
    const previous = sounds[(index - 1 + sounds.length) % sounds.length];
    if (previous) socketRef.current?.emit("music:station", { stationId: previous.id, commandId: commandId() });
  };

  // --- Music admin (room owner) -------------------------------------------
  const [musicOpen, setMusicOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [wardrobeOpen, setWardrobeOpen] = useState(false);

  const holdItem = (item: HeldItemId) => {
    if (!profile) return;
    heldItemRef.current = item;
    saveProfile({ ...profile, item, head: headRef.current }); // remembered for next time
    socketRef.current?.emit("duck:item", { heldItem: item });
  };

  // Ask the server to change what we wear. It checks ownership; we only remember the choice if it agrees.
  const wear = (slot: WearableCategory, wearableId: string | null) => {
    const socket = socketRef.current;
    if (!profile || !socket) return;
    const done = (res: { ok: true } | { ok: false; error: SocketError }) => {
      if (!res.ok) return setNotice(res.error.message);
      // The head item is also remembered in this browser, for the dressing screen. Other slots
      // are remembered by the server with the session.
      if (slot !== "head") return;
      headRef.current = wearableId;
      saveProfile({ ...profile, item: heldItemRef.current, head: wearableId });
    };
    if (wearableId) socket.emit("cosmetic:equip", { slot, wearableId }, done);
    else socket.emit("cosmetic:unequip", { slot }, done);
  };

  // Tell the server right away, so the others see this duck leave without waiting for a timeout.
  const leaveRoom = () => {
    socketRef.current?.emit("room:leave", { commandId: commandId() });
    router.push("/");
  };
  const [uploading, setUploading] = useState(false);

  const uploadTrack = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) return setNotice("File is too big (max 20 MB)");
    const name = [...file.name.replace(/\.[^.]+$/, "")].slice(0, LIMITS.trackName).join("").trim() || "Song";
    setUploading(true);
    try {
      const res = await fetch(`/upload?room=${code}&name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "content-type": file.type, "x-duck-room": "1" },
        body: file,
      });
      // On success the server adds the song itself and tells the whole room.
      if (!res.ok) setNotice((await res.json()).error?.message ?? "Upload failed");
    } catch {
      setNotice("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // --- Chat ----------------------------------------------------------------
  const [text, setText] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  // null = default corner; otherwise where the user dragged the chat window
  const [chatPos, setChatPos] = useState<{ x: number; y: number } | null>(null);
  const chatRef = useRef<HTMLElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    // On a phone the chat starts closed so the pond is visible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.innerWidth < 768) setChatOpen(false);
    const reset = () => setChatPos(null);
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = chatRef.current?.getBoundingClientRect();
    if (!rect || window.innerWidth < 768) return; // on a phone the chat is a fixed drawer
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const panel = chatRef.current;
    const area = panel?.parentElement;
    if (!panel || !area || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const bounds = area.getBoundingClientRect();
    setChatPos({
      x: clamp(e.clientX - bounds.left - dragOffset.current.x, 0, bounds.width - panel.offsetWidth),
      y: clamp(e.clientY - bounds.top - dragOffset.current.y, 0, bounds.height - panel.offsetHeight),
    });
  };
  const [copied, setCopied] = useState(false);
  const [moved, setMoved] = useState(false);
  // Our own duck is on its way somewhere. Things it can do at a place (take or float a krathong) wait until it is there.
  const [walking, setWalking] = useState(false);
  const walkTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(walkTimer.current), []);
  // The "invite another duck" note is a nudge, not a fixture: it leaves after a while, or when closed.
  const [inviteHidden, setInviteHidden] = useState(false);
  useEffect(() => {
    if (!moved) return;
    const timer = setTimeout(() => setInviteHidden(true), 12_000);
    return () => clearTimeout(timer);
  }, [moved]);
  /** The little marker that shows where you asked your duck to go. */
  const [target, setTarget] = useState<{ id: number; left: number; top: number } | null>(null);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  const toggleChat = () => {
    setChatOpen((open) => !open);
    setUnread(0);
  };
  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, chatOpen]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    // The id lets the server drop a repeat of this message. A refusal (too fast, too long) comes back in the reply.
    socketRef.current?.emit("chat:message", { clientMessageId: commandId(), text }, (res) => !res.ok && setNotice(res.error.message));
    setText("");
  };

  const sendSticker = (stickerId: StickerId) => {
    socketRef.current?.emit("sticker:send", { stickerId });
    setStickersOpen(false);
    // One sticker a second, the same as the server allows.
    setStickersResting(true);
    setTimeout(() => setStickersResting(false), 1000);
  };

  // Seasonal stickers appear while their event is on (the server refuses them otherwise), and take
  // the quick row during that time. Everything is always in the full list.
  const allStickers = STICKER_IDS.filter((id) => stickerAvailable(id, eventSnapshot.event?.slug));
  const seasonal = allStickers.filter(isSeasonalSticker);
  const quickStickers = (seasonal.length ? [...seasonal, ...allStickers.filter((id) => !isSeasonalSticker(id))] : allStickers).slice(0, 6);

  /** The interaction a duck is in right now, and which way to face its partner. */
  const interactionOf = (user: RoomUser) => {
    const match = interactions.find((item) => item.userA === user.id || item.userB === user.id);
    const partner = match && users.find((other) => other.id === (match.userA === user.id ? match.userB : match.userA));
    return match && partner ? { kind: STICKERS[match.stickerId].interaction, partnerOnLeft: partner.x < user.x } : undefined;
  };

  const walkTo = (e: MouseEvent<HTMLDivElement>) => {
    // During a shared animation, or while setting a krathong down, our duck stays put; the server ignores moves then too.
    if (releasing[selfId] || interactions.some((item) => item.userA === selfId || item.userB === selfId)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (((e.clientY - rect.top) / rect.height) * 100 - FLOOR_TOP) / FLOOR_HEIGHT;
    // Only our own target position is sent; the server knows which duck is ours.
    const to = { x: clamp(x, 0.04, 0.96), y: clamp(y, 0, 1) };
    // Prediction: our own duck starts walking at once, so the room feels quick. This is only what
    // we draw. If the server refuses the move, the duck goes back to where the server has it.
    const me = selfId;
    const from = users.find((u) => u.id === me);
    setUsers((list) => list.map((u) => (u.id === me ? { ...u, ...to } : u)));
    // The same walk time the server works out, so both agree on when the duck has arrived.
    clearTimeout(walkTimer.current);
    setWalking(true);
    walkTimer.current = setTimeout(() => setWalking(false), from ? walkDurationMs(from, to) : 0);
    socketRef.current?.emit("duck:move", { clientMoveId: commandId(), destination: to }, (res) => {
      if (res.ok) return;
      clearTimeout(walkTimer.current);
      setWalking(false);
      const truth = serverPositions.current.get(me);
      if (truth) setUsers((list) => list.map((u) => (u.id === me ? { ...u, ...truth } : u)));
    });
    setMoved(true);
    setTarget({ id: Date.now(), left: to.x * 100, top: FLOOR_TOP + to.y * FLOOR_HEIGHT });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice("Copy the link from the address bar");
    }
  };

  if (profile === undefined) return null;

  if (profile === null) {
    const name = draft.name.trim();
    return (
      <main className="relative flex h-dvh items-center justify-center overflow-hidden p-4">
        <RoomScene night={night} theme={theme} />
        <PixelPanel className="pop-in relative z-10 max-h-full w-full max-w-md overflow-y-auto p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name) return;
              saveProfile({ ...draft, name });
              setProfile({ ...draft, name });
            }}
          >
            <h1 className="font-pixel text-2xl leading-none uppercase">Choose your duck</h1>
            <p className="font-pixel mt-1.5 mb-5 text-sm text-[var(--muted)] uppercase">
              Room <span className="tracking-widest text-[var(--coral)]">{code}</span>
            </p>
            <ProfileFields profile={draft} onChange={setDraft} inventory={inventory} />
            <PixelButton type="submit" variant="coral" arrow disabled={!name} className="mt-6 w-full text-lg">
              Waddle in
            </PixelButton>
          </form>
        </PixelPanel>
      </main>
    );
  }

  if (joinError) {
    return (
      <main className="relative flex h-dvh items-center justify-center overflow-hidden p-4">
        <RoomScene night={night} theme={theme} />
        <PixelPanel role="alert" className="pop-in relative z-10 flex w-full max-w-sm flex-col items-center p-6 text-center">
          <div className="-scale-x-100">
            <DuckSprite color={profile.color} size={96} animation="sleep" />
          </div>
          <h1 className="font-pixel mt-3 text-2xl leading-tight uppercase">{JOIN_ERROR_TITLES[joinError.code] ?? "Something went wrong"}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{joinError.message}</p>
          <Link href="/" className="pixel-btn pixel-btn-coral mt-6 w-full text-lg">
            Back home <span aria-hidden>→</span>
          </Link>
        </PixelPanel>
      </main>
    );
  }

  const ownerName = users.find((u) => u.id === ownerUserId)?.displayName;
  // Who last touched the radio, as the server recorded it.
  const changer = users.find((u) => u.id === music.changedByUserId);
  const changerMark = changer?.id === ownerUserId ? " 👑" : changer && djUserIds.includes(changer.id) ? " 🎧" : "";
  const radioStatus = !audioReady
    ? "Sound is off until you join the audio"
    : changer
      ? `${music.playing ? "Started" : "Paused"} by ${changer.id === selfId ? "you" : changer.displayName}${changerMark}`
      : canControl
        ? "You can control the radio"
        : musicSettings.controlMode === "DJ_ONLY"
          ? `Controlled by ${ownerName ?? "the owner"} 👑 and DJs`
          : `Controlled by ${ownerName ?? "the owner"} 👑`;
  const loading = !selfId;
  const self = users.find((u) => u.id === selfId);

  // Krathongs: which button to offer depends on where our duck stands and what it carries.
  // This only decides what to show; the server checks the same things again when asked.
  const krathongSettings = eventSnapshot.event?.interactions?.krathong?.enabled ? eventSnapshot.event.interactions.krathong : undefined;
  // While our duck is walking, it is not at any zone yet: the button appears when it arrives.
  const zoneAt = (ids: readonly string[]) => (self && !walking ? ids.find((id) => INTERACTION_ZONES[id] && inZone(INTERACTION_ZONES[id], self.x, self.y)) : undefined);
  const stallId = krathongSettings && !self?.carriedItem ? zoneAt(krathongSettings.pickupZones) : undefined;
  const releaseZoneId = krathongSettings && self?.carriedItem ? zoneAt(krathongSettings.releaseZones) : undefined;
  const busy = !!releasing[selfId];
  // One request at a time: a second press before the server has answered would only be refused
  // ("not carrying a krathong") and show an error for something that worked.
  const krathongWaiting = () => {
    if (Date.now() - krathongSentAt.current < 1500) return true;
    krathongSentAt.current = Date.now();
    return false;
  };
  const krathongReply = (res: SocketAck<unknown>) => {
    krathongSentAt.current = 0;
    if (!res.ok) setNotice(res.error.message);
  };
  const takeKrathong = () => {
    if (!krathongSettings || !stallId || krathongWaiting()) return;
    const variant = krathongSettings.variants[Math.floor(Math.random() * krathongSettings.variants.length)] as KrathongVariant;
    socketRef.current?.emit("krathong:pickup", { commandId: commandId(), stallId, variant }, krathongReply);
  };
  const floatKrathong = () => {
    if (!releaseZoneId || krathongWaiting()) return;
    socketRef.current?.emit("krathong:release", { zoneId: releaseZoneId, commandId: commandId() }, krathongReply);
  };
  const krathongPrompt =
    !krathongSettings || busy ? null : stallId ? (
      <PixelButton variant="coral" onClick={takeKrathong} className="pop-in pointer-events-auto min-h-12 px-6 text-base">
        🪷 Take krathong
      </PixelButton>
    ) : releaseZoneId ? (
      <PixelButton variant="coral" onClick={floatKrathong} className="pop-in pointer-events-auto min-h-12 px-6 text-base">
        🪷 Float krathong
      </PixelButton>
    ) : self?.carriedItem ? (
      <p className="pixel-tag pop-in px-3 py-1 uppercase">Carry it to the water&apos;s edge</p>
    ) : null;
  const alone = users.length === 1;
  const voiceOf = (userId: string) => {
    const found = voiceUsers.find((item) => item.userId === userId);
    return found && (found.muted ? "muted" : "live");
  };

  return (
    <div className="relative h-dvh overflow-hidden">
      {/* The world: tap the grass and your duck waddles there */}
      <div onClick={walkTo} className="absolute inset-0 isolate cursor-pointer select-none">
        <RoomScene night={night} theme={theme} />
        {users.map((user) => (
          <Duck
            key={user.id}
            color={user.duckColor}
            item={user.heldItem}
            equipment={user.equipment}
            carried={user.carriedItem?.variant}
            name={user.displayName}
            x={user.x}
            y={user.y}
            owner={user.id === ownerUserId}
            dj={djUserIds.includes(user.id)}
            isSelf={user.id === selfId}
            night={night}
            dancing={music.playing}
            sleeping={asleep.has(user.id) || !user.connected}
            away={!user.connected}
            bubble={bubbles[user.id]}
            sticker={stickers[user.id]}
            interaction={releasing[user.id] ? "release" : interactionOf(user)?.kind}
            partnerOnLeft={interactionOf(user)?.partnerOnLeft}
            voice={voiceOf(user.id)}
            speaking={speaking.has(user.id)}
          />
        ))}
        <FloatingKrathongs krathongs={krathongs} clockOffset={clockOffset.current} night={night} />
        <StickerInteractionRenderer interactions={interactions} users={users} calm={calm || reducedMotion} />
        <EventParticles theme={theme} night={night} />
        {target && (
          <span
            key={target.id}
            aria-hidden
            className="target-mark font-pixel pointer-events-none absolute z-[1001] text-2xl text-[#fff7e6] [text-shadow:2px_2px_0_var(--outline)]"
            style={{ left: `${target.left}%`, top: `${target.top}%` }}
          >
            ✦
          </span>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 z-[250] flex flex-col items-center justify-center gap-4 bg-black/30" role="status">
          <div className="duck-hop">
            <DuckSprite color={profile.color} size={96} animation="walk" />
          </div>
          <p className="font-pixel text-lg text-[#fff7e6] uppercase [text-shadow:2px_2px_0_var(--outline)]">Waddling into the room...</p>
        </div>
      )}

      {/* Top HUD */}
      <header className="pointer-events-none absolute inset-x-3 top-3 z-[140] flex items-start justify-between gap-3">
        <UserHUD name={profile.name} color={profile.color} head={self?.equipment.head ?? null} code={code} online={online} copied={copied} onCopy={copyLink} onWardrobe={() => setWardrobeOpen(true)} />
        <div className="pointer-events-auto flex items-center gap-3">
          <PixelPanel
            className="font-pixel flex h-11 items-center gap-2 px-3 text-sm uppercase"
            title={users.map((u) => u.displayName).join(", ")}
            aria-label={`${users.length} ducks online`}
          >
            <span className="hidden gap-0.5 sm:flex">
              {users.slice(0, 3).map((user) => (
                <DuckSprite key={user.id} color={user.duckColor} size={20} animation="sleep" />
              ))}
            </span>
            <span className="sm:hidden">
              <DuckSprite color={profile.color} size={20} animation="sleep" />
            </span>
            <span className="whitespace-nowrap">
              {users.length}
              <span className="hidden sm:inline"> {users.length === 1 ? "duck" : "ducks"}</span>
            </span>
            <span className="hidden text-[var(--muted)] lg:inline">online</span>
          </PixelPanel>
          <PixelIconButton label={night ? "Switch to day" : "Switch to night"} onClick={toggleNight} variant="cream" className="hidden sm:inline-flex">
            {night ? "☾" : "☀"}
          </PixelIconButton>
          <PixelIconButton label="Settings" onClick={() => setSettingsOpen(true)} variant="cream">
            ⚙
          </PixelIconButton>
          {/* On a phone there is no room for this button here; Exit is in Settings instead. */}
          <PixelButton onClick={() => setLeaveOpen(true)} variant="coral" className="hidden sm:inline-flex">
            Exit
          </PixelButton>
        </div>
      </header>

      {event && !loading && (
        // Under the HUD on the left, clear of the chat window (which opens on the right), so its
        // buttons can always be reached.
        <div className="pointer-events-none absolute top-[5.5rem] left-3 z-[135] flex max-w-[calc(100%-1.5rem)]">
          <EventBanner event={event} onWardrobe={() => setWardrobeOpen(true)} />
        </div>
      )}

      {notice && (
        <PixelPanel role="status" className="pop-in absolute top-36 left-1/2 z-[200] -translate-x-1/2 px-4 py-2 text-sm font-bold whitespace-nowrap">
          {notice}
        </PixelPanel>
      )}

      {/* One prompt at a time, just above the radio (on a phone, above its voice chat buttons too) */}
      {!loading && (
        <div className="pointer-events-none absolute inset-x-3 bottom-[18.75rem] z-[130] flex flex-col items-center gap-3 text-center sm:bottom-44">
          {!audioReady && (
            // The click itself is what unlocks sound (see the gesture listeners above).
            <PixelButton variant="coral" className="pop-in pointer-events-auto text-base">
              ♪ Join the room audio
            </PixelButton>
          )}
          {/* A large button for whatever can be done where our duck is standing. */}
          {krathongPrompt}
          {audioReady &&
            !krathongPrompt &&
            (!moved ? (
              <p className="pixel-tag pop-in px-3 py-1 uppercase">Tap the grass to waddle there</p>
            ) : (
              alone &&
              !inviteHidden && (
                <PixelPanel className="pop-in pointer-events-auto relative flex flex-col items-center gap-3 px-4 py-3">
                  <button onClick={() => setInviteHidden(true)} aria-label="Close" className="pixel-focus font-pixel absolute top-0 right-0 grid size-9 place-items-center text-[var(--muted)]">
                    ✕
                  </button>
                  <p className="text-sm font-bold">
                    It&apos;s quiet here...
                    <br />
                    Invite another duck!
                  </p>
                  <PixelButton arrow onClick={copyLink}>
                    {copied ? "Link copied" : "Copy invite"}
                  </PixelButton>
                </PixelPanel>
              )
            ))}
        </div>
      )}

      {/* A member asked for DJ access: only the owner sees this. */}
      {isOwner && djRequests.length > 0 && (
        <div className="absolute top-36 left-1/2 z-[170] flex w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col gap-3">
          {djRequests.map((id) => {
            const asker = users.find((u) => u.id === id);
            if (!asker) return null; // they left before being answered
            return (
              <PixelPanel key={id} role="alertdialog" aria-label={`${asker.displayName} wants DJ access`} className="pop-in flex items-center gap-3 p-2.5">
                <p className="min-w-0 flex-1 text-sm font-bold">🎧 {asker.displayName} wants DJ access</p>
                <PixelButton variant="coral" onClick={() => answerDjRequest(id, true)} className="text-xs">
                  Accept
                </PixelButton>
                <PixelButton variant="cream" onClick={() => answerDjRequest(id, false)} className="text-xs">
                  Decline
                </PixelButton>
              </PixelPanel>
            );
          })}
        </div>
      )}

      <ChatPanel
        open={chatOpen}
        night={night}
        users={users}
        ownerUserId={ownerUserId}
        djUserIds={djUserIds}
        voiceUsers={voiceUsers}
        speaking={speaking}
        selfId={selfId}
        messages={messages}
        panelRef={chatRef}
        listEndRef={listEndRef}
        style={chatPos ? { left: chatPos.x, top: chatPos.y } : { right: 12, top: 84 }}
        onClose={toggleChat}
        onDragStart={startDrag}
        onDrag={drag}
      />

      {/* The radio, with the message bar under it */}
      <div className="pixel-box absolute inset-x-3 bottom-3 z-[160] mx-auto flex max-w-2xl flex-col gap-2.5 bg-[var(--wood)] p-2.5">
        {/* During an event the radio wears that event's emblem. */}
        {event?.ui?.icon && (
          <span aria-hidden className="pointer-events-none absolute -top-5 -left-3 -rotate-12 text-2xl [text-shadow:2px_2px_0_var(--outline)]">
            {event.ui.icon}
          </span>
        )}
        <MusicRadio
          title={station.custom ? station.name : `${station.name} radio`}
          playing={music.playing}
          canControl={canControl}
          status={radioStatus}
          onRequestDJ={musicSettings.controlMode === "EVERYONE" ? undefined : requestDJ}
          requestSent={djRequestSent}
          volume={volume}
          muted={muted}
          songsOpen={musicOpen}
          onToggle={togglePlay}
          onPrevious={previousStation}
          onNext={() => socketRef.current?.emit("music:next", { commandId: commandId() })}
          onSongs={() => setMusicOpen(true)}
          onVolume={(next) => {
            setVolume(next);
            setMuted(false);
          }}
          onMute={() => setMuted((m) => !m)}
        />

        {/* The voice chat sits on the radio's left shoulder; the sticker drawer opens on its right. */}
        {!loading && (
          <VoiceDock
            status={voiceStatus}
            muted={micMuted}
            deafened={deafened}
            count={voiceUsers.length}
            onJoin={() => voiceRef.current?.join()}
            onLeave={() => voiceRef.current?.leave()}
            onMute={toggleMic}
            onDeafen={toggleDeafen}
            className="absolute bottom-full left-0 mb-3"
          />
        )}

        {stickersOpen && (
          <PixelPanel className="pop-in absolute right-0 bottom-full mb-3 max-w-full p-1">
            <StickerBar stickers={allStickers} onSend={sendSticker} resting={stickersResting} className="flex flex-wrap justify-end" />
          </PixelPanel>
        )}

        <form onSubmit={send} className="flex items-center gap-2.5">
          <PixelIconButton label={chatOpen ? "Hide chat" : "Show chat"} onClick={toggleChat} variant={chatOpen ? "coral" : "cream"} className="relative">
            ✉
            {unread > 0 && (
              <span className="font-pixel absolute -top-2.5 -right-2.5 grid h-5 min-w-5 place-items-center bg-[var(--coral)] px-1 text-[11px] text-[#fff7e6] shadow-[0_0_0_2px_var(--outline)]">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </PixelIconButton>
          <PixelInput
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={LIMITS.message}
            placeholder="Say something…"
            aria-label="Message"
            className="min-w-0 flex-1"
          />
          <StickerBar stickers={quickStickers} onSend={sendSticker} resting={stickersResting} className="hidden md:flex" />
          {/* All stickers open from this button. On a phone it is the only way in; on a desktop it holds the ones that did not fit. */}
          <PixelIconButton
            label="All stickers"
            onClick={() => setStickersOpen((open) => !open)}
            variant={stickersOpen ? "coral" : "cream"}
            aria-expanded={stickersOpen}
            className={allStickers.length > quickStickers.length ? "" : "md:hidden"}
          >
            ☺
          </PixelIconButton>
          <PixelButton type="submit" variant="coral" disabled={!text.trim()} aria-label="Send message" className="shrink-0">
            ➤
          </PixelButton>
        </form>
      </div>

      {canControl && musicOpen && (
        <PixelDialog title="Radio" onClose={() => setMusicOpen(false)}>
          <ul className="flex flex-col gap-3">
            {sounds.map((item) => (
              <li key={item.id} className="flex gap-3">
                <PixelButton
                  onClick={() => pickStation(item.id)}
                  variant={item.id === station.id ? "coral" : "cream"}
                  aria-pressed={item.id === station.id}
                  className="min-w-0 flex-1 justify-start"
                >
                  <span aria-hidden>{item.emoji}</span>
                  <span className="truncate">{item.name}</span>
                </PixelButton>
                {isOwner && item.custom && (
                  <PixelIconButton label={`Remove ${item.name}`} onClick={() => socketRef.current?.emit("music:removeTrack", { trackId: item.id })}>
                    ✕
                  </PixelIconButton>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <>
          <div className="flex flex-col gap-2.5 border-t-2 border-dashed border-[var(--line)] pt-4">
            <label className="pixel-btn has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-[var(--coral)]">
              {uploading ? "Uploading…" : "Upload a song"} <span aria-hidden>→</span>
              <input
                type="file"
                accept="audio/*"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadTrack(file);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-xs text-[var(--muted)]">MP3, OGG, WAV or M4A, max 20 MB. Only add music you have the right to use.</p>
          </div>
              <div className="flex flex-col gap-3 border-t-2 border-dashed border-[var(--line)] pt-4">
                <p className="font-pixel text-sm uppercase">Who can control the radio?</p>
                <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Who can control the radio?">
                  {(
                    [
                      ["OWNER_ONLY", "Owner only"],
                      ["DJ_ONLY", "Owner + DJs"],
                      ["EVERYONE", "Everyone"],
                    ] as const
                  ).map(([mode, label]) => (
                    <PixelButton
                      key={mode}
                      role="radio"
                      aria-checked={musicSettings.controlMode === mode}
                      onClick={() => setControlMode(mode)}
                      variant={musicSettings.controlMode === mode ? "coral" : "cream"}
                      className="!px-1 text-xs"
                    >
                      {label}
                    </PixelButton>
                  ))}
                </div>
                {musicSettings.controlMode === "DJ_ONLY" && (
                  <div className="flex flex-col gap-3">
                    <p className="font-pixel text-xs text-[var(--muted)] uppercase">DJs (tap to add or remove)</p>
                    {users.length < 2 && <p className="text-sm text-[var(--muted)]">Nobody else is here yet.</p>}
                    <div className="flex flex-wrap gap-3">
                      {users
                        .filter((user) => user.id !== ownerUserId)
                        .map((user) => {
                          const dj = musicSettings.djUserIds.includes(user.id);
                          return (
                            <PixelButton key={user.id} role="checkbox" aria-checked={dj} onClick={() => setDJ(user.id, !dj)} variant={dj ? "coral" : "cream"} className="normal-case">
                              <span aria-hidden>{dj ? "🎧" : "＋"}</span>
                              {user.displayName}
                            </PixelButton>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </PixelDialog>
      )}

      {settingsOpen && (
        <PixelDialog title="Settings" onClose={() => setSettingsOpen(false)}>
          <div className="flex flex-col gap-4">
            <label className="flex items-center justify-between gap-4">
              <span className="font-pixel text-sm uppercase">Music volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                className="pixel-focus h-11 w-40 accent-[var(--coral)]"
              />
            </label>
            <div className="flex items-center justify-between gap-4">
              <span className="font-pixel text-sm uppercase">Your duck</span>
              <PixelButton
                onClick={() => {
                  setSettingsOpen(false);
                  setWardrobeOpen(true);
                }}
                className="w-28"
              >
                Wardrobe
              </PixelButton>
            </div>
            {/* The scene is shared by the whole room, so only the owner can change it. */}
            <div className="flex items-center justify-between gap-4">
              <span className="font-pixel text-sm uppercase">Scene</span>
              {event ? (
                <span className="font-pixel text-right text-sm text-[var(--muted)] uppercase">Set by the event</span>
              ) : isOwner ? (
                <PixelButton
                  onClick={() => socketRef.current?.emit("room:scene", { scene: scene === "festival" ? "valley" : "festival" })}
                  variant={scene === "festival" ? "coral" : "wood"}
                  className="w-28"
                >
                  {scene === "festival" ? "Festival" : "Valley"}
                </PixelButton>
              ) : (
                <span className="font-pixel text-sm text-[var(--muted)] uppercase">{scene === "festival" ? "Boat festival" : "Duck valley"}</span>
              )}
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-pixel text-sm uppercase">Theme</span>
              <PixelButton onClick={toggleNight} className="w-28">
                {night ? "Night" : "Day"}
              </PixelButton>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-pixel text-sm uppercase">Reduced motion</span>
              <PixelButton onClick={toggleCalm} aria-pressed={calm} variant={calm ? "coral" : "wood"} className="w-28">
                {calm ? "On" : "Off"}
              </PixelButton>
            </div>
            <PixelButton
              variant="coral"
              arrow
              onClick={() => {
                setSettingsOpen(false);
                setLeaveOpen(true);
              }}
            >
              Exit room
            </PixelButton>
          </div>
        </PixelDialog>
      )}

      {wardrobeOpen && (
        <PixelDialog title="Wardrobe" onClose={() => setWardrobeOpen(false)} closeLabel="Done">
          <div className="flex flex-col gap-4">
            <div className="mx-auto grid size-24 place-items-center bg-[var(--field)] shadow-[inset_0_0_0_2px_var(--line)]">
              <DuckSprite color={profile.color} item={self?.heldItem} equipment={self?.equipment} size={64} className="mt-3" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-pixel text-sm uppercase">Head wear</span>
              <CosmeticInventory inventory={inventory} equipped={self?.equipment.head ?? null} onEquip={(id) => wear("head", id)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-pixel text-sm uppercase">Neck</span>
              <CosmeticInventory slot="neck" inventory={inventory} equipped={self?.equipment.neck ?? null} onEquip={(id) => wear("neck", id)} />
            </div>
            <div className="flex flex-col gap-3">
              <span className="font-pixel text-sm uppercase">Hold something</span>
              <ItemPicker value={self?.heldItem ?? "none"} onChange={holdItem} />
            </div>
          </div>
        </PixelDialog>
      )}

      {leaveOpen && (
        <PixelDialog title="Leave the pond?" onClose={() => setLeaveOpen(false)} closeLabel="Stay">
          <p className="text-center text-sm">
            {isOwner && users.length > 1
              ? "You lead this room. If you stay away, another duck will take over the music."
              : "You can come back any time with the room link."}
          </p>
          <PixelButton variant="coral" arrow onClick={leaveRoom}>
            Exit room
          </PixelButton>
        </PixelDialog>
      )}
    </div>
  );
}
