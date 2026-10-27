"use client";

import { useEffect, useState } from "react";
import { DUCK_COLORS, HELD_ITEMS, type DuckColorId, type HeldItemId } from "@/shared/protocol";

export type Profile = { name: string; color: DuckColorId; item: HeldItemId; head: string | null };

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

export function loadProfile(): Profile | null {
  const name = read("duck:name");
  const color = DUCK_COLORS.find((id) => id === read("duck:color")) ?? "yellow";
  const item = HELD_ITEMS.find((id) => id === read("duck:item")) ?? "none";
  return name ? { name, color, item, head: read("duck:head") || null } : null;
}

export function saveProfile(profile: Profile) {
  write("duck:name", profile.name);
  write("duck:color", profile.color);
  write("duck:item", profile.item);
  write("duck:head", profile.head ?? "");
}

export function useNight() {
  const [night, setNight] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNight(read("duck:night") === "1");
  }, []);
  useEffect(() => {
    document.documentElement.dataset.night = String(night);
  }, [night]);
  const toggle = () =>
    setNight((n) => {
      write("duck:night", n ? "0" : "1");
      return !n;
    });
  return [night, toggle] as const;
}

/** "Reduced motion" from the Settings menu: stops sprite and scenery animation. */
export function useCalm() {
  const [calm, setCalm] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCalm(read("duck:calm") === "1");
  }, []);
  useEffect(() => {
    document.documentElement.dataset.calm = String(calm);
  }, [calm]);
  const toggle = () =>
    setCalm((on) => {
      write("duck:calm", on ? "0" : "1");
      return !on;
    });
  return [calm, toggle] as const;
}
