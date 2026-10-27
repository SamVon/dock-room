// How the built-in stations sound and look in the browser.
//
// The list of stations comes from the server (config/music.ts). When a station has a stream URL
// the browser plays that; otherwise it generates the music itself with the preset below,
// so the app needs no audio files.

export type SynthPreset = {
  bpm: number;
  chords: number[][]; // MIDI notes, one chord per bar
  wave: OscillatorType;
  pad: number; // chord volume
  cutoff: number; // low-pass filter on chords (Hz)
  arp: number; // plucked melody volume, 0 = off
  swing: number; // 0..0.5, delays off-beat notes
  drums: boolean;
  noise: number; // vinyl crackle / rain volume
  noiseCutoff: number;
};

type StationLook = { emoji: string; synth: SynthPreset };

const LOOKS: Record<string, StationLook> = {
  lofi: {
    emoji: "🎧",
    synth: {
      bpm: 74,
      chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
      wave: "triangle",
      pad: 0.11,
      cutoff: 900,
      arp: 0.05,
      swing: 0.15,
      drums: true,
      noise: 0.012,
      noiseCutoff: 5000,
    },
  },
  jazz: {
    emoji: "🎷",
    synth: {
      bpm: 104,
      chords: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 49, 52, 55]],
      wave: "sine",
      pad: 0.1,
      cutoff: 1400,
      arp: 0.12,
      swing: 0.33,
      drums: true,
      noise: 0.004,
      noiseCutoff: 4000,
    },
  },
  rain: {
    emoji: "🌧️",
    synth: {
      bpm: 50,
      chords: [[45, 52, 57, 60], [41, 48, 53, 57]],
      wave: "sine",
      pad: 0.07,
      cutoff: 600,
      arp: 0,
      swing: 0,
      drums: false,
      noise: 0.16,
      noiseCutoff: 1800,
    },
  },
  piano: {
    emoji: "🎹",
    synth: {
      bpm: 80,
      chords: [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]],
      wave: "triangle",
      pad: 0.03,
      cutoff: 1200,
      arp: 0.2,
      swing: 0,
      drums: false,
      noise: 0,
      noiseCutoff: 4000,
    },
  },
};

// Stations that belong to seasonal events. Each is a variation of a built-in sound.
Object.assign(LOOKS, {
  "festival-lofi": { emoji: "🥁", synth: { ...LOOKS.jazz.synth, bpm: 116, arp: 0.14 } },
  "new-year-lofi": { emoji: "🎆", synth: { ...LOOKS.jazz.synth, bpm: 110, noise: 0 } },
  "spooky-lofi": { emoji: "🎃", synth: { ...LOOKS.lofi.synth, bpm: 64, chords: [[45, 48, 52, 57], [41, 45, 48, 53], [43, 46, 50, 55], [40, 44, 47, 52]] } },
  "winter-lofi": { emoji: "🎄", synth: { ...LOOKS.piano.synth, bpm: 72 } },
  "rain-lofi": { emoji: "🌧️", synth: { ...LOOKS.rain.synth, arp: 0.06 } },
  "night-lofi": { emoji: "🌙", synth: { ...LOOKS.lofi.synth, bpm: 62, drums: false } },
  "sakura-lofi": { emoji: "🌸", synth: { ...LOOKS.piano.synth, bpm: 70, pad: 0.07, drums: true, noise: 0.006 } },
  "soft-lofi": { emoji: "💗", synth: { ...LOOKS.piano.synth, bpm: 68, pad: 0.06 } },
} satisfies Record<string, StationLook>);

/** Emoji and generated sound for a station id. Unknown ids (uploaded songs) get the default. */
export const stationLook = (id: string): StationLook => LOOKS[id] ?? { emoji: "🎵", synth: LOOKS.lofi.synth };
