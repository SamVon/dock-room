"use client";

import { DUCK_COLORS } from "@/lib/colors";
import type { Profile } from "@/lib/profile";
import { LIMITS } from "@/shared/protocol";
import { CosmeticInventory } from "./cosmetics/CosmeticInventory";
import { DuckSprite } from "./Duck";
import { ItemPicker } from "./ItemPicker";
import { PixelInput } from "./pixel/ui";

/** Character selection: a name, a duck color, and a live preview. */
type Props = {
  profile: Profile;
  onChange: (profile: Profile) => void;
  /** Wearable ids this session may use, from the server. */
  inventory: readonly string[];
};

export function ProfileFields({ profile, onChange, inventory }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <div className="pixel-box grid size-24 shrink-0 place-items-center bg-[var(--field)] [--hard-shadow:transparent]">
          <div className="duck-bob">
            <DuckSprite color={profile.color} item={profile.item} equipment={{ head: profile.head }} size={64} />
          </div>
        </div>
        <label className="flex min-w-0 flex-1 flex-col gap-2.5">
          <span className="font-pixel text-sm uppercase">What should we call you?</span>
          <PixelInput
            value={profile.name}
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
            maxLength={LIMITS.displayName}
            placeholder="Quackers"
          />
        </label>
      </div>
      <fieldset>
        <legend className="font-pixel mb-3 text-sm uppercase">Choose your duck</legend>
        <div className="grid grid-cols-6 gap-3">
          {DUCK_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              title={color.label}
              aria-label={color.label}
              aria-pressed={profile.color === color.id}
              onClick={() => onChange({ ...profile, color: color.id })}
              className={`pixel-btn aspect-square !p-0 ${profile.color === color.id ? "pixel-btn-coral" : "pixel-btn-cream"}`}
            >
              <DuckSprite color={color.id} size={32} animation={profile.color === color.id ? "dance" : "sleep"} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="font-pixel mb-1.5 text-sm uppercase">Head wear</legend>
        <CosmeticInventory inventory={inventory} equipped={profile.head} onEquip={(head) => onChange({ ...profile, head })} />
      </fieldset>
      <fieldset>
        <legend className="font-pixel mb-3 text-sm uppercase">Hold something</legend>
        <ItemPicker value={profile.item} onChange={(item) => onChange({ ...profile, item })} />
      </fieldset>
    </div>
  );
}
