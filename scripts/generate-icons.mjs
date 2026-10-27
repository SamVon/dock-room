// Generate the site's icons from its original pixel duck, keeping the brand consistent.
// Run: node scripts/generate-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const source = await readFile(new URL('../lib/duckSprites.ts', import.meta.url), 'utf8');
const base = source.match(/const BASE = \[([\s\S]*?)\];/);
if (!base) throw new Error('Duck sprite not found');
const rows = [...base[1].matchAll(/"([.A-Z]+)"/g)].map((match) => match[1]);
const palette = { K: '#21191B', B: '#FFD84A', S: '#E9A92C', H: '#FFF3A6', W: '#FFFFFF', O: '#F58A1F', D: '#C9620F', C: '#FF8FA3' };
const pixels = rows.flatMap((row, y) => [...row].flatMap((pixel, x) => palette[pixel]
  ? [`<rect x="${x + 4}" y="${y + 4}" width="1" height="1" fill="${palette[pixel]}"/>`]
  : [])).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 24 24"><title>Duck Room</title><path fill="#B8E2C5" d="M0 0h24v24H0z"/><g shape-rendering="crispEdges"><path fill="#83BDA2" d="M6 20h12v1H6z"/>${pixels}</g></svg>\n`;
await writeFile(new URL('../app/icon.svg', import.meta.url), svg);
await sharp(Buffer.from(svg)).resize(180, 180).png().toFile(new URL('../app/apple-icon.png', import.meta.url).pathname);
// ICO supports PNG entries; include small sizes for browser tabs and Windows shortcuts.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((png, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index];
  header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(new URL('../app/favicon.ico', import.meta.url), Buffer.concat([header, ...images]));
console.log('Generated SVG, Apple touch icon, and favicon.');
