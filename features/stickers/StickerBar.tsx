"use client";

import { STICKERS, type StickerId } from "@/shared/stickers";

type Props = {
  /** Which stickers to offer. Seasonal ones are only in this list while their event is on. */
  stickers: readonly StickerId[];
  onSend: (stickerId: StickerId) => void;
  /** Greys the bar out for a moment after sending (one sticker a second). */
  resting: boolean;
  className?: string;
};

export function StickerBar({ stickers, onSend, resting, className = "" }: Props) {
  return (
    <div className={`gap-1 ${className}`} role="group" aria-label="Stickers">
      {stickers.map((id) => (
        <button
          key={id}
          type="button"
          disabled={resting}
          onClick={() => onSend(id)}
          title={`${STICKERS[id].label} (send the same sticker as another duck to react together)`}
          aria-label={`Send ${STICKERS[id].label} sticker`}
          className="pixel-focus grid size-11 place-items-center text-xl hover:-translate-y-0.5 active:translate-y-0.5 disabled:opacity-50"
        >
          {STICKERS[id].icon}
        </button>
      ))}
    </div>
  );
}
