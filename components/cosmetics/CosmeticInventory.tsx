"use client";

// The wardrobe: a pixel inventory of wearables with their state (equipped, available, locked).
import { useState, type CSSProperties } from "react";
import { wearableImage } from "@/lib/wearableSprites";
import { WEARABLES, findWearable, lockReason, type DuckWearable, type WearableCategory, type WearableRarity } from "@/shared/cosmetics";
import { PixelImg } from "../pixel/ui";

const RARITY: Record<WearableRarity, { label: string; color: string }> = {
  common: { label: "Common", color: "var(--muted)" },
  rare: { label: "Rare", color: "#3F82C9" },
  event: { label: "Event", color: "#8A5CD6" },
  special: { label: "Special", color: "#C9930E" },
};

type ItemProps = { wearable: DuckWearable; equipped: boolean; locked: boolean; selected: boolean; onSelect: () => void };

/** One slot in the inventory grid. */
export function CosmeticItem({ wearable, equipped, locked, selected, onSelect }: ItemProps) {
  const image = wearableImage(wearable.sprite);
  const lock = wearableImage("lock");
  const state = equipped ? "equipped" : locked ? "locked" : "available";
  return (
    <button
      type="button"
      onClick={onSelect}
      title={wearable.name}
      aria-label={`${wearable.name}, ${RARITY[wearable.rarity].label}, ${state}`}
      aria-pressed={equipped}
      className={`pixel-btn pixel-btn-cream relative aspect-square !p-0 ${selected && !equipped ? "brightness-95" : ""}`}
      // Equipped items get a green pixel border.
      style={equipped ? ({ "--outline": "var(--online)" } as CSSProperties) : undefined}
    >
      {image && <PixelImg image={image} scale={2} className={locked ? "opacity-30 grayscale" : ""} />}
      {locked && lock && <PixelImg image={lock} scale={2} className="absolute right-0.5 bottom-0.5" />}
      {wearable.rarity !== "common" && (
        <span aria-hidden className="absolute top-0.5 left-0.5 size-2" style={{ background: RARITY[wearable.rarity].color, boxShadow: "0 0 0 1px var(--outline)" }} />
      )}
    </button>
  );
}

type Props = {
  slot?: WearableCategory;
  /** Ids the server says this user may equip. Anything else is shown locked. */
  inventory: readonly string[];
  equipped: string | null;
  onEquip: (wearableId: string | null) => void;
};

/**
 * Tap an item to wear it; tap a locked one to see how to unlock it.
 * This only asks: the server checks every request again before anyone sees the change.
 */
export function CosmeticInventory({ slot = "head", inventory, equipped, onEquip }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = WEARABLES.filter((wearable) => wearable.category === slot && wearable.enabled);
  const shown = findWearable(selectedId ?? equipped);
  const shownLocked = !!shown && !inventory.includes(shown.id);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid max-h-44 grid-cols-6 gap-3 overflow-y-auto p-1.5">
        <button
          type="button"
          onClick={() => {
            setSelectedId(null);
            onEquip(null);
          }}
          title="Nothing"
          aria-label="Wear nothing"
          aria-pressed={equipped === null}
          className="pixel-btn pixel-btn-cream aspect-square !p-0"
          style={equipped === null ? ({ "--outline": "var(--online)" } as CSSProperties) : undefined}
        >
          <span aria-hidden>✕</span>
        </button>
        {items.map((wearable) => {
          const locked = !inventory.includes(wearable.id);
          return (
            <CosmeticItem
              key={wearable.id}
              wearable={wearable}
              equipped={equipped === wearable.id}
              locked={locked}
              selected={shown?.id === wearable.id}
              onSelect={() => {
                setSelectedId(wearable.id);
                if (!locked) onEquip(wearable.id);
              }}
            />
          );
        })}
      </div>

      <div className="min-h-[4.5rem] bg-[var(--field)] px-3 py-2 text-sm shadow-[inset_0_0_0_2px_var(--line)]" aria-live="polite">
        {shown ? (
          <>
            <p className="font-pixel flex flex-wrap items-center gap-x-2 uppercase">
              {shown.name}
              <span className="text-xs" style={{ color: RARITY[shown.rarity].color }}>
                {RARITY[shown.rarity].label}
              </span>
              {equipped === shown.id && <span className="text-xs text-[var(--online)]">Equipped</span>}
            </p>
            <p className="text-[var(--muted)]">{shownLocked ? `Locked. ${lockReason(shown)}` : shown.description}</p>
          </>
        ) : (
          <p className="text-[var(--muted)]">Nothing on here yet. Pick something to wear.</p>
        )}
      </div>
    </div>
  );
}
