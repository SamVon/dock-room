"use client";

import { itemIcon, itemLabel } from "@/lib/duckSprites";
import { HELD_ITEMS, type HeldItemId } from "@/shared/protocol";
import { PixelImg } from "./pixel/ui";

/** Buttons to choose what your duck holds. */
export function ItemPicker({ value, onChange }: { value: HeldItemId; onChange: (item: HeldItemId) => void }) {
  return (
    <div className="grid grid-cols-5 gap-3">
      {HELD_ITEMS.map((item) => {
        const image = itemIcon(item);
        return (
          <button
            key={item}
            type="button"
            title={itemLabel(item)}
            aria-label={itemLabel(item)}
            aria-pressed={value === item}
            onClick={() => onChange(item)}
            className={`pixel-btn aspect-square !p-0 ${value === item ? "pixel-btn-coral" : "pixel-btn-cream"}`}
          >
            {image ? (
              <PixelImg image={image} scale={3} />
            ) : (
              <span aria-hidden>✕</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
