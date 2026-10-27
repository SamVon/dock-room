// Pixel art from text. Each sprite is a list of rows, and each character is one pixel.
// The result is an SVG data URL with hard edges, so it stays crisp at any size.

export type Palette = Record<string, string> | ((char: string, x: number, y: number) => string | undefined);
export type PixelImage = { url: string; width: number; height: number };

const cache = new Map<string, PixelImage>();

/** `rows` side by side become frames of a sprite sheet when you pass several grids. */
export function pixelArt(grids: string[][] | string[], palette: Palette, cacheKey?: string): PixelImage {
  const cached = cacheKey && cache.get(cacheKey);
  if (cached) return cached;

  const frames = (typeof grids[0] === "string" ? [grids] : grids) as string[][];
  const frameWidth = Math.max(...frames.flatMap((rows) => rows.map((row) => row.length)));
  const height = Math.max(...frames.map((rows) => rows.length));
  const color = typeof palette === "function" ? palette : (char: string) => palette[char];

  // One <path> per color, built from horizontal runs of the same pixel.
  const paths = new Map<string, string>();
  frames.forEach((rows, frame) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; ) {
        const fill = color(row[x], x, y);
        let end = x + 1;
        while (end < row.length && color(row[end], end, y) === fill) end++;
        if (fill) paths.set(fill, `${paths.get(fill) ?? ""}M${frame * frameWidth + x} ${y}h${end - x}v1h${x - end}z`);
        x = end;
      }
    });
  });

  const width = frameWidth * frames.length;
  const body = [...paths].map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${body}</svg>`;
  const image = { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, width, height };
  if (cacheKey) cache.set(cacheKey, image);
  return image;
}
