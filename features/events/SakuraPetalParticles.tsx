"use client";

// Falling cherry blossom petals. They are decoration only and run on this screen alone:
// nothing about them is sent to the server or shared between users.
import { useEffect, useState, type CSSProperties } from "react";
import { SheetSprite } from "@/components/scene/parts";
import { sakuraPetal } from "@/lib/sceneSprites";

/** The breeze: which way petals drift and how strongly. It moves petals and branches, never ducks. */
export const WIND = { direction: "right", strength: 0.3 } as const;
const windPx = (WIND.direction === "right" ? 1 : -1) * WIND.strength * 260;

// The same "random" numbers on the server and in the browser, so the first paint matches.
const random = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

// 30 petals on a desktop, 20 on a tablet, 12 on a phone: the later ones are hidden on small screens.
const PETALS = Array.from({ length: 30 }, (_, i) => ({
  left: random(i + 1) * 104 - 8,
  seconds: 9 + random(i + 40) * 9,
  delay: -random(i + 80) * 18,
  drift: windPx + (random(i + 120) - 0.5) * 120,
  scale: 3 + Math.round(random(i + 160)),
  turn: 0.9 + random(i + 200) * 0.9,
  pale: i % 3 === 0,
  hide: i >= 20 ? "hidden lg:block" : i >= 12 ? "hidden sm:block" : "",
}));

const GUST = Array.from({ length: 10 }, (_, i) => ({ top: 8 + random(i + 300) * 60, delay: random(i + 340) * 0.9, drop: 30 + random(i + 380) * 90, pale: i % 2 === 0, hide: i >= 5 ? "hidden sm:block" : "" }));

export function SakuraPetalParticles({ night }: { night: boolean }) {
  // Every 30 to 90 seconds a gust carries a handful of petals across the scene for a few seconds.
  const [gust, setGust] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.calm === "true") return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setGust((n) => n + 1);
        schedule();
      }, 30_000 + Math.random() * 60_000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {PETALS.map((petal, i) => (
        <div
          key={i}
          className={`petal absolute ${petal.hide}`}
          style={{ left: `${petal.left}%`, animationDuration: `${petal.seconds}s`, animationDelay: `${petal.delay}s`, "--drift": `${petal.drift}px` } as CSSProperties}
        >
          <SheetSprite sheet={sakuraPetal(petal.pale, night)} scale={petal.scale} seconds={petal.turn} delay={petal.delay} />
        </div>
      ))}
      {gust > 0 &&
        GUST.map((petal, i) => (
          // The key changes with every gust, which starts the one-shot animation again.
          <div key={`${gust}-${i}`} className={`petal-gust absolute ${petal.hide}`} style={{ top: `${petal.top}%`, left: "-8%", animationDelay: `${petal.delay}s`, "--drop": `${petal.drop}px` } as CSSProperties}>
            <SheetSprite sheet={sakuraPetal(petal.pale, night)} scale={4} seconds={0.6} />
          </div>
        ))}
    </>
  );
}
