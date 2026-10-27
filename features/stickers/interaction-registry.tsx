// The effect drawn for each kind of sticker interaction. To add one: draw it here, give it an
// entry below, and point a sticker at it in shared/stickers.ts. Nothing in the room page changes.
import type { CSSProperties, ReactNode } from "react";
import { pixelArt } from "@/lib/pixel";
import { sprite } from "@/lib/sceneSprites";

const HEART = pixelArt(
  [".KK...KK.", "KrRK.KrrK", "KRrrKrrrK", "KrrrrrrrK", ".KrrrrrK.", "..KrrrK..", "...KrK...", "....K...."],
  { K: "#21191B", r: "#EF4D6E", R: "#FFB0C0" },
  "fx:heart",
);
const SPARK = pixelArt(["...y...", "...y...", ".y.w.y.", "yywwwyy", ".y.w.y.", "...y...", "...y..."], { y: "#FFD84A", w: "#FFFFFF" }, "fx:spark");
const PETAL = pixelArt([".pp..", "pppp.", ".ppp.", "..p.."], { p: "#F4A6C5" }, "fx:petal");
const PETAL_PALE = pixelArt([".pp..", "pppp.", ".ppp.", "..p.."], { p: "#FFD7E5" }, "fx:petal-pale");
const FLAME = pixelArt(["...o...", "..oo...", ".ooyo..", ".oyyoo.", "ooyyyoo", "oyywyyo", ".oyyyo.", "..ooo.."], { o: "#F58A1F", y: "#FFD84A", w: "#FFFFFF" }, "fx:flame");

/** A sprite sized relative to the ducks, so effects shrink with them on a phone. */
function Fx({ image, size, className = "", style }: { image: { url: string; width: number; height: number }; size: number; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`pixel-art ${className}`}
      style={{ width: `calc(var(--size) * ${size})`, aspectRatio: `${image.width} / ${image.height}`, backgroundImage: `url("${image.url}")`, backgroundSize: "100% 100%", ...style }}
    />
  );
}

const Word = ({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) => (
  <span className={`font-pixel text-[#fff7e6] [text-shadow:2px_2px_0_var(--outline)] ${className}`} style={{ fontSize: "calc(var(--size) * 0.3)", ...style }}>
    {children}
  </span>
);

/** Small copies drifting upward, one after another. */
const Rising = ({ children, count = 3 }: { children: (i: number) => ReactNode; count?: number }) =>
  Array.from({ length: count }, (_, i) => (
    <div key={i} className="duck-note absolute" style={{ left: `${20 + i * 30}%`, top: 0, animationDelay: `${0.5 + i * 0.35}s` }}>
      {children(i)}
    </div>
  ));

type Interaction = {
  /** Drawn between the two ducks (or above each one, when they are far apart). `small` is the far-apart size. */
  Effect: (props: { small: boolean; icon: string }) => ReactNode;
};

export const stickerInteractions: Record<string, Interaction> = {
  heart: {
    Effect: ({ small }) => (
      <div className="relative flex justify-center">
        <Fx image={HEART} size={small ? 0.45 : 0.8} className="fx-pop" />
        <Rising>{() => <Fx image={HEART} size={0.22} />}</Rising>
      </div>
    ),
  },
  highfive: {
    Effect: ({ small }) => (
      <div className="relative flex justify-center">
        <Fx image={SPARK} size={small ? 0.4 : 0.7} className="fx-pop" style={{ animationDelay: "0.35s" }} />
      </div>
    ),
  },
  dance: {
    Effect: () => (
      <div className="flex justify-center gap-[calc(var(--size)*0.4)]">
        <Word className="duck-note">♪</Word>
        <Word className="duck-note" style={{ animationDelay: "0.4s" }}>
          ♫
        </Word>
        <Word className="duck-note" style={{ animationDelay: "0.8s" }}>
          ♪
        </Word>
      </div>
    ),
  },
  laugh: {
    Effect: () => (
      <div className="flex items-end justify-center gap-[calc(var(--size)*0.25)]">
        <Word className="fx-pop">HA</Word>
        <Word className="fx-pop -translate-y-2" style={{ animationDelay: "0.3s" }}>
          HA
        </Word>
        <Word className="fx-pop" style={{ animationDelay: "0.6s" }}>
          HA
        </Word>
      </div>
    ),
  },
  sparkle: {
    Effect: ({ small }) => (
      <div className="relative" style={{ width: `calc(var(--size) * ${small ? 1 : 2.2})`, height: "calc(var(--size) * 1.1)" }}>
        {[
          [0, 0],
          [100, 10],
          [8, 100],
          [92, 90],
        ].map(([left, top], i) => (
          <Fx key={i} image={SPARK} size={0.3} className="fx-twinkle absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${-i * 0.25}s` }} />
        ))}
      </div>
    ),
  },
  // A small cherry tree springs up between the ducks, and petals burst upward and fall around them.
  "sakura-bloom": {
    Effect: ({ small }) => (
      <div className="relative flex justify-center">
        <Fx image={sprite("sakuraTree", false)} size={small ? 0.7 : 1.2} className="fx-pop" />
        {[-70, -30, 20, 60, 100, 140].map((left, i) => (
          <div key={left} className="duck-note absolute" style={{ left: `${left}%`, top: `${(i % 3) * 18}%`, animationDelay: `${0.4 + i * 0.22}s` }}>
            <Fx image={i % 2 === 0 ? PETAL_PALE : PETAL} size={0.16} />
          </div>
        ))}
      </div>
    ),
  },
  // A general-purpose one for any sticker: its own icon pops up large and small copies drift upward.
  cheer: {
    Effect: ({ small, icon }) => (
      <div className="relative flex justify-center">
        <span className="fx-pop block leading-none" style={{ fontSize: `calc(var(--size) * ${small ? 0.45 : 0.75})` }}>
          {icon}
        </span>
        <Rising>{() => <span style={{ fontSize: "calc(var(--size) * 0.25)" }}>{icon}</span>}</Rising>
      </div>
    ),
  },
  hype: {
    Effect: ({ small }) => (
      <div className="relative flex items-end justify-center gap-1">
        <Fx image={FLAME} size={small ? 0.3 : 0.45} className="fx-pop" />
        <Word className="fx-pop" style={{ animationDelay: "0.2s" }}>
          !!
        </Word>
        <Fx image={FLAME} size={small ? 0.3 : 0.45} className="fx-pop" style={{ animationDelay: "0.1s" }} />
        <Rising count={2}>{() => <Fx image={FLAME} size={0.2} />}</Rising>
      </div>
    ),
  },
};
