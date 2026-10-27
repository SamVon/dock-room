// Built-in music stations (server side).
//
// Set a *_STREAM_URL environment variable to a trusted, royalty-free stream or file to use it.
// When a station has no URL, browsers generate its music themselves (see lib/stations.ts),
// so the app works with no audio files at all.
//
// Users can never submit audio URLs. The room owner can only upload audio files.
import type { Station } from "../shared/protocol";

const url = (value: string | undefined) => (value && /^https:\/\//.test(value) ? value : null);

export const loadStations = (env: NodeJS.ProcessEnv): Station[] => [
  { id: "lofi", name: "Lofi", url: url(env.LOFI_STREAM_URL) },
  { id: "jazz", name: "Jazz", url: url(env.JAZZ_STREAM_URL) },
  { id: "rain", name: "Rain", url: url(env.RAIN_STREAM_URL) },
  { id: "piano", name: "Piano", url: url(env.PIANO_STREAM_URL) },
];
