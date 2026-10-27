// Songs uploaded by a room owner. Stored on this server's disk and removed with the track or the room.
import { randomUUID } from "node:crypto";
import { createReadStream, mkdirSync, statSync, unlink } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_TRACKS = 20;

const UPLOAD_DIR = path.join(tmpdir(), "duck-room-uploads");
const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
};
const FILE_NAME = /^[0-9a-f-]{36}\.[a-z0-9]{3,4}$/;

mkdirSync(UPLOAD_DIR, { recursive: true });

export const audioExtension = (contentType: string | undefined) => AUDIO_TYPES[contentType ?? ""];

/** Checks the first bytes, so a file that only claims to be audio is refused. */
export function looksLikeAudio(file: Buffer) {
  const text = (start: number, end: number) => file.toString("latin1", start, end);
  return (
    text(0, 3) === "ID3" || // MP3 with tags
    (file[0] === 0xff && (file[1] & 0xe0) === 0xe0) || // MP3 / AAC frame
    text(0, 4) === "OggS" ||
    (text(0, 4) === "RIFF" && text(8, 12) === "WAVE") ||
    text(4, 8) === "ftyp" || // M4A
    file.readUInt32BE(0) === 0x1a45dfa3 // WebM
  );
}

/** Saves the file and returns its URL on this server. */
export async function saveUpload(extension: string, file: Buffer) {
  const name = `${randomUUID()}.${extension}`;
  await writeFile(path.join(UPLOAD_DIR, name), file);
  return `/uploads/${name}`;
}

export function deleteUpload(url: string) {
  const name = path.basename(url);
  if (FILE_NAME.test(name)) unlink(path.join(UPLOAD_DIR, name), () => {});
}

/** GET /uploads/<file>, with Range support so every browser can play it. */
export function serveUpload(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const name = pathname.slice("/uploads/".length);
  let size: number;
  try {
    if (!FILE_NAME.test(name)) throw new Error("bad name");
    size = statSync(path.join(UPLOAD_DIR, name)).size;
  } catch {
    res.writeHead(404);
    return res.end();
  }
  const extension = name.split(".")[1];
  const headers = {
    "content-type": Object.keys(AUDIO_TYPES).find((type) => AUDIO_TYPES[type] === extension) ?? "application/octet-stream",
    "accept-ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  let start = 0;
  let end = size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
  } else {
    res.writeHead(200, { ...headers, "content-length": size });
  }
  createReadStream(path.join(UPLOAD_DIR, name), { start, end }).pipe(res);
}
