"use client";

import type { DuckColorId } from "@/shared/protocol";
import { DuckSprite } from "../Duck";
import { PixelPanel } from "../pixel/ui";

type Props = { name: string; color: DuckColorId; head: string | null; code: string; online: boolean; copied: boolean; onCopy: () => void; onWardrobe: () => void };

/** The corner HUD: who you are, which room this is, and whether you are connected. */
export function UserHUD({ name, color, head, code, online, copied, onCopy, onWardrobe }: Props) {
  return (
    <PixelPanel className="pointer-events-auto flex items-center gap-2.5 p-1.5 pr-3">
      {/* Your duck is also the button that opens the wardrobe. */}
      <button
        onClick={onWardrobe}
        title="Change your outfit"
        aria-label="Open the wardrobe"
        className="pixel-focus grid size-12 shrink-0 place-items-center bg-[var(--field)] shadow-[inset_0_0_0_2px_var(--line)] hover:brightness-95"
      >
        <DuckSprite color={color} equipment={{ head }} size={32} className="mt-2" />
      </button>
      <div className="min-w-0">
        {/* Name and room code are one big button, so copying the invite is easy to tap. */}
        <button onClick={onCopy} title="Copy the invite link" className="pixel-focus group block min-h-11 text-left">
          <span className="font-pixel block max-w-28 truncate text-base leading-tight sm:max-w-36">{name}</span>
          <span className="font-pixel block text-xs leading-tight whitespace-nowrap text-[var(--muted)] uppercase group-hover:text-[var(--coral)]">
            <span className="hidden sm:inline">Room </span>
            <span className="tracking-widest text-[var(--text)]">{code}</span> {copied ? "✓ copied" : "→ copy"}
          </span>
        </button>
        <p className="text-xs leading-tight font-bold" aria-live="polite">
          <span style={{ color: online ? "var(--online)" : "var(--coral)" }}>●</span> {online ? "Online" : "Reconnecting…"}
        </p>
      </div>
    </PixelPanel>
  );
}
