"use client";

import { PixelButton, PixelIconButton } from "../pixel/ui";

type Props = {
  title: string;
  playing: boolean;
  /** May this user control the shared radio? Decided by the server; this only chooses which buttons to show. */
  canControl: boolean;
  /** One line under the station name: who is playing it, or who controls it. */
  status: string;
  /** Shown to members without control: ask the owner for DJ access. */
  onRequestDJ?: () => void;
  requestSent: boolean;
  volume: number;
  muted: boolean;
  songsOpen: boolean;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSongs: () => void;
  onVolume: (volume: number) => void;
  onMute: () => void;
};

const STEPS = [0.2, 0.4, 0.6, 0.8, 1];

/** The pixel radio. Shared playback buttons appear for the owner, DJs, or everyone, as the room allows; volume is always local. */
export function MusicRadio(props: Props) {
  const { title, playing, canControl, status, volume, muted } = props;
  const level = muted ? 0 : volume;

  return (
    // On a phone the playback buttons move to their own row, so the station name stays readable.
    <div className="flex flex-wrap items-center justify-end gap-2.5">
      <div
        className={`flex min-w-0 flex-1 items-center gap-2.5 bg-[var(--panel)] px-2.5 py-1.5 shadow-[inset_0_0_0_2px_var(--outline)] ${canControl || props.onRequestDJ ? "basis-full sm:basis-0" : ""}`}
      >
        <div className="flex h-6 shrink-0 items-end gap-0.5" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={`w-1.5 bg-[var(--coral)] ${playing ? "eq-bar h-6" : "h-1.5"}`} style={{ animationDelay: `${-i * 0.17}s` }} />
          ))}
        </div>
        <div className="min-w-0 flex-1 text-[var(--text)]">
          <p className="font-pixel truncate text-sm leading-tight uppercase">♪ {title}</p>
          <p className="truncate text-xs leading-tight text-[var(--muted)]">{status}</p>
        </div>
      </div>

      {!canControl && props.onRequestDJ && (
        <PixelButton onClick={props.onRequestDJ} disabled={props.requestSent} variant="cream" className="text-xs">
          🎧 {props.requestSent ? "Asked" : "Request DJ"}
        </PixelButton>
      )}

      {canControl && (
        <>
          <PixelIconButton label="Previous station" onClick={props.onPrevious} className="hidden sm:inline-flex">
            ◀
          </PixelIconButton>
          <PixelIconButton label={playing ? "Pause music" : "Play music"} onClick={props.onToggle} variant="coral">
            {playing ? "❚❚" : "▶"}
          </PixelIconButton>
          <PixelIconButton label="Next station" onClick={props.onNext}>
            ▶▶
          </PixelIconButton>
          <PixelIconButton label="Stations and songs" onClick={props.onSongs} aria-expanded={props.songsOpen}>
            ♫
          </PixelIconButton>
        </>
      )}

      <div className="hidden items-end gap-1 sm:flex" role="group" aria-label="Volume">
        {STEPS.map((step, i) => (
          <button
            key={step}
            onClick={() => props.onVolume(step)}
            aria-label={`Volume ${step * 100}%`}
            aria-pressed={level >= step}
            className="pixel-focus flex h-11 w-3 items-end"
          >
            <span
              className="w-full shadow-[inset_0_0_0_2px_var(--outline)]"
              style={{ height: 10 + i * 6, background: level >= step - 0.01 ? "var(--coral)" : "var(--wood-dark)" }}
            />
          </button>
        ))}
      </div>
      <PixelIconButton label={muted ? "Unmute" : "Mute"} onClick={props.onMute} variant="cream" aria-pressed={muted}>
        {level === 0 ? "✕" : "♪"}
      </PixelIconButton>
    </div>
  );
}
