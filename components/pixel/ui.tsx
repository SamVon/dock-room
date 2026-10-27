"use client";

// The pixel UI kit: cream RPG panels, wooden sign buttons, chunky inputs.
import { useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import type { PixelImage } from "@/lib/pixel";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/** A sprite from lib/pixel.ts, drawn `scale` times bigger with hard edges. */
export function PixelImg({ image, scale = 4, className, style }: { image: PixelImage; scale?: number; className?: string; style?: React.CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt=""
      aria-hidden
      draggable={false}
      width={image.width * scale}
      height={image.height * scale}
      className={cx("pixel-art max-w-none", className)}
      style={style}
    />
  );
}

export function PixelPanel({ className, ref, ...props }: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  return <div ref={ref} className={cx("pixel-box pixel-panel", className)} {...props} />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "wood" | "coral" | "cream";
  /** Adds the sign-post arrow on the right. */
  arrow?: boolean;
};

export function PixelButton({ variant = "wood", arrow, className, children, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cx("pixel-btn", variant !== "wood" && `pixel-btn-${variant}`, className)} {...props}>
      {children}
      {arrow && <span aria-hidden>→</span>}
    </button>
  );
}

/** A square button for one icon. Always at least 44x44 so it is easy to tap. */
export function PixelIconButton({ label, className, ...props }: ButtonProps & { label: string }) {
  return <PixelButton aria-label={label} title={label} className={cx("size-11 !p-0 text-base", className)} {...props} />;
}

export function PixelInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("pixel-input w-full text-base", className)} {...props} />;
}

export function PixelBadge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("pixel-tag inline-flex items-center gap-1", className)} {...props} />;
}

/** White bubble with a thick outline and a small stepped pointer. */
export function PixelSpeechBubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("pop-in relative", className)}>
      <div className="pixel-box bg-[var(--field)] px-2.5 py-1 text-center text-sm font-bold wrap-anywhere text-[var(--text)] [--hard-shadow:transparent]">
        {children}
      </div>
      <div className="mx-auto mt-1 h-1 w-3 bg-[var(--outline)]" />
      <div className="mx-auto h-1 w-1 bg-[var(--outline)]" />
    </div>
  );
}

type DialogProps = { title: string; onClose: () => void; children: ReactNode; className?: string; closeLabel?: string };

/** A game-menu dialog. Escape or a click outside closes it. */
export function PixelDialog({ title, onClose, children, className, closeLabel = "Close" }: DialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-[300] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <PixelPanel
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("pop-in flex max-h-full w-full max-w-sm flex-col gap-4 overflow-y-auto p-4", className)}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="font-pixel text-center text-xl uppercase">{title}</h2>
        {children}
        <PixelButton onClick={onClose} variant="cream">
          {closeLabel}
        </PixelButton>
      </PixelPanel>
    </div>
  );
}
