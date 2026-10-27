"use client";

import { PixelButton, PixelIconButton, PixelPanel } from "@/components/pixel/ui";
import type { VoiceStatus } from "./voice-client";

type Props = {
  status: VoiceStatus;
  /** Our own microphone is switched off. */
  muted: boolean;
  /** We are not playing anyone else. */
  deafened: boolean;
  /** How many ducks are in the voice chat. */
  count: number;
  onJoin: () => void;
  onLeave: () => void;
  onMute: () => void;
  onDeafen: () => void;
  className?: string;
};

/** A line across an icon: "this is switched off". */
const Slash = () => <span aria-hidden className="absolute top-1/2 left-1/2 h-1 w-7 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[var(--outline)]" />;

/** The voice chat controls: one button to join, then microphone, sound and leave. */
export function VoiceDock({ status, muted, deafened, count, onJoin, onLeave, onMute, onDeafen, className = "" }: Props) {
  if (status !== "on") {
    return (
      <PixelButton onClick={onJoin} disabled={status === "joining"} variant="cream" className={`text-xs ${className}`}>
        <span aria-hidden>🎙</span>
        {status === "joining" ? "Connecting…" : count > 0 ? `Join voice (${count})` : "Join voice"}
      </PixelButton>
    );
  }
  return (
    <PixelPanel role="group" aria-label="Voice chat" className={`flex items-center gap-2.5 p-1.5 ${className}`}>
      <PixelIconButton label={muted ? "Turn microphone on" : "Turn microphone off"} onClick={onMute} variant={muted ? "cream" : "coral"} aria-pressed={!muted} className="relative">
        🎙{muted && <Slash />}
      </PixelIconButton>
      <PixelIconButton label={deafened ? "Hear the others again" : "Stop hearing the others"} onClick={onDeafen} variant="cream" aria-pressed={!deafened} className="relative">
        🔊{deafened && <Slash />}
      </PixelIconButton>
      <PixelButton onClick={onLeave} className="text-xs">
        Leave
      </PixelButton>
    </PixelPanel>
  );
}
