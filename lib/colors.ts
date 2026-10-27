import type { DuckColorId } from "@/shared/protocol";

// How each allowed duck color looks. The list of allowed ids lives in shared/protocol.ts,
// and the server only accepts those ids, never a raw CSS value.
export type DuckColor = { id: DuckColorId; label: string; fill?: string; gradient?: string[] };

export const DUCK_COLORS: DuckColor[] = [
  { id: "yellow", label: "Yellow", fill: "#FFD93B" },
  { id: "white", label: "White", fill: "#FAFAF5" },
  { id: "pink", label: "Pink", fill: "#FF9EC4" },
  { id: "blue", label: "Blue", fill: "#7CB8FF" },
  { id: "mint", label: "Mint", fill: "#8EE6C4" },
  { id: "purple", label: "Purple", fill: "#B79BFF" },
  { id: "orange", label: "Orange", fill: "#FFA552" },
  { id: "red", label: "Red", fill: "#FF6B6B" },
  { id: "black", label: "Black", fill: "#3A3A44" },
  { id: "brown", label: "Brown", fill: "#A9745B" },
  { id: "rainbow", label: "Rainbow", gradient: ["#FF6B6B", "#FFA552", "#FFD93B", "#8EE6C4", "#7CB8FF", "#B79BFF"] },
  { id: "gold", label: "Gold", gradient: ["#FFF3B0", "#F5C542", "#C99A1A", "#F9E27D"] },
];

export const getDuckColor = (id: string) => DUCK_COLORS.find((c) => c.id === id) ?? DUCK_COLORS[0];
