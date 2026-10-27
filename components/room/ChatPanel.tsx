"use client";

import type { CSSProperties, PointerEvent, Ref } from "react";
import { sprite } from "@/lib/sceneSprites";
import type { ChatMessage, RoomUser } from "@/shared/protocol";
import type { VoiceParticipant } from "@/shared/voice";
import { DuckSprite, VoiceMark } from "../Duck";
import { PixelImg } from "../pixel/ui";

type Props = {
  open: boolean;
  night: boolean;
  users: RoomUser[];
  ownerUserId: string;
  /** User ids to mark as DJs (empty unless the room is in DJ mode). */
  djUserIds: readonly string[];
  /** Who is in the voice chat, and who is speaking right now. */
  voiceUsers: readonly VoiceParticipant[];
  speaking: ReadonlySet<string>;
  selfId: string;
  messages: ChatMessage[];
  panelRef: Ref<HTMLElement>;
  listEndRef: Ref<HTMLDivElement>;
  style: CSSProperties;
  onClose: () => void;
  onDragStart: (event: PointerEvent<HTMLDivElement>) => void;
  onDrag: (event: PointerEvent<HTMLDivElement>) => void;
};

/**
 * The chat journal. On desktop it is a window you can drag by its title bar;
 * on a phone it is a drawer that opens above the radio and its voice chat buttons.
 */
export function ChatPanel({ open, night, users, ownerUserId, djUserIds, voiceUsers, speaking, selfId, messages, panelRef, listEndRef, style, onClose, onDragStart, onDrag }: Props) {
  return (
    <aside
      ref={panelRef}
      aria-label="Chat"
      className={`${
        open ? "flex" : "hidden"
      } pixel-box pixel-panel pop-in absolute z-[150] h-[min(26rem,calc(100%-16rem))] w-80 flex-col max-md:inset-x-3! max-md:top-auto! max-md:bottom-[14.75rem]! max-md:h-[42%]! max-sm:bottom-[18.75rem]! max-sm:h-[38%]! max-md:w-auto!`}
      style={style}
    >
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDrag}
        className="flex touch-none items-center gap-2 border-b-4 border-[var(--outline)] bg-[var(--wood)] px-3 py-1.5 select-none md:cursor-grab md:active:cursor-grabbing"
      >
        <h2 className="font-pixel flex-1 text-base text-[#fff7e6] uppercase [text-shadow:2px_2px_0_var(--outline)]">Chat</h2>
        <button
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label="Close chat"
          className="pixel-focus font-pixel -my-1.5 -mr-3 grid size-11 place-items-center text-[#fff7e6] [text-shadow:2px_2px_0_var(--outline)]"
        >
          ✕
        </button>
      </div>

      <ul className="flex gap-2 overflow-x-auto border-b-2 border-dashed border-[var(--line)] px-3 py-2" aria-label="Ducks in this room">
        {users.map((user) => (
          <li
            key={user.id}
            className={`flex shrink-0 items-center gap-1 text-xs font-bold ${user.connected ? "" : "opacity-50"} ${speaking.has(user.id) ? "text-[var(--online)]" : ""}`}
            title={user.connected ? undefined : "Away"}
          >
            <DuckSprite color={user.duckColor} size={20} animation="sleep" />
            {user.id === ownerUserId && <PixelImg image={sprite("crown", night)} scale={2} />}
            {user.id !== ownerUserId && djUserIds.includes(user.id) && (
              <span role="img" aria-label="DJ">
                🎧
              </span>
            )}
            {voiceUsers.some((voice) => voice.userId === user.id) && <VoiceMark muted={!!voiceUsers.find((voice) => voice.userId === user.id)?.muted} />}
            {user.displayName}
            {user.id === selfId && <span className="font-semibold text-[var(--muted)]">(you)</span>}
          </li>
        ))}
      </ul>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm" aria-live="polite">
        {!messages.some((message) => message.type === "user") && (
          <p className="py-4 text-center text-[var(--muted)]">No messages yet. Say hi below!</p>
        )}
        {messages.map((message) =>
          message.type === "system" ? (
            <p key={message.id} className="py-1 text-center text-xs text-[var(--muted)]">
              {message.text}
            </p>
          ) : (
            <div key={message.id} className="flex gap-2 border-b-2 border-dashed border-[var(--line)] py-1.5 last:border-0">
              <DuckSprite color={message.duckColor} size={24} animation="sleep" className="mt-0.5" />
              <div className="min-w-0">
                <p className="font-pixel text-xs leading-tight" style={{ color: message.userId === selfId ? "var(--coral)" : "var(--muted)" }}>
                  {message.displayName}
                  <time className="ml-2 font-sans text-[10px] font-semibold opacity-70">
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </time>
                </p>
                <p className="wrap-anywhere">{message.text}</p>
              </div>
            </div>
          ),
        )}
        <div ref={listEndRef} />
      </div>
    </aside>
  );
}
