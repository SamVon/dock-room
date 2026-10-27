import type { SynthPreset } from "./stations";

/** Something to play: a URL (stream or uploaded song), or generated music when `url` is null. */
export type Sound = { url: string | null; synth: SynthPreset };

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const ARP_PATTERN = [0, 2, 1, 3, 2, 1, 3, 2];
// Scheduling far ahead keeps the music going when the tab is in the background.
const LOOKAHEAD_S = 1.5;
const SYNTH_BOOST = 5;

export class MusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Where generated music goes in: boosted and compressed before the volume control. */
  private synthIn: GainNode | null = null;
  private bus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private volume = 0.6;

  get ready() {
    return this.ctx?.state === "running";
  }

  /**
   * Call from a click, tap or key press: browsers block audio before that.
   * Returns whether sound can play now. Safe to call again and again.
   */
  async unlock(): Promise<boolean> {
    if (this.ctx?.state === "running") return true;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);

      // The raw synth mix is quiet. Boost it, and let a compressor keep the loud parts
      // (kick drum, chord changes) from clipping, so it plays at a normal music level.
      this.synthIn = this.ctx.createGain();
      this.synthIn.gain.value = SYNTH_BOOST;
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.2;
      this.synthIn.connect(compressor).connect(this.master);

      const length = this.ctx.sampleRate * 2;
      this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    // If the browser does not accept this gesture, resume() can stay pending forever,
    // so never wait on it for long: the next click simply tries again.
    await Promise.race([this.ctx.resume().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 400))]);
    return this.ctx.state === "running";
  }

  setVolume(volume: number) {
    this.volume = volume;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    if (this.audioEl) this.audioEl.volume = volume;
  }

  play(sound: Sound, onError?: () => void) {
    this.stop();
    if (sound.url) {
      this.audioEl = new Audio(sound.url);
      this.audioEl.loop = true;
      this.audioEl.volume = this.volume;
      this.audioEl.onerror = () => onError?.();
      this.audioEl.play().catch(() => {});
      return;
    }
    if (!this.ctx || !this.synthIn) return;
    this.startSynth(this.ctx, this.synthIn, sound.synth);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.audioEl?.pause();
    this.audioEl = null;
    this.noiseSource?.stop();
    this.noiseSource = null;

    const bus = this.bus;
    this.bus = null;
    if (bus && this.ctx) {
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      setTimeout(() => bus.disconnect(), 500);
    }
  }

  private startSynth(ctx: AudioContext, output: GainNode, p: SynthPreset) {
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
    bus.connect(output);
    this.bus = bus;

    const padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = p.cutoff;
    padFilter.connect(bus);

    if (p.noise > 0) {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = p.noiseCutoff;
      const gain = ctx.createGain();
      gain.gain.value = p.noise;
      source.connect(filter).connect(gain).connect(bus);
      source.start();
      this.noiseSource = source;
    }

    const stepLength = 30 / p.bpm; // one eighth note
    let step = 0;
    let nextTime = ctx.currentTime + 0.1;

    const tone = (midi: number, at: number, length: number, peak: number, attack: number, out: AudioNode) => {
      const osc = ctx.createOscillator();
      osc.type = p.wave;
      osc.frequency.value = freq(midi);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(peak, at + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.connect(gain).connect(out);
      osc.start(at);
      osc.stop(at + length + 0.05);
    };

    const hit = (at: number, length: number, peak: number, type: BiquadFilterType, cutoff: number) => {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = cutoff;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peak, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      source.connect(filter).connect(gain).connect(bus);
      source.start(at, Math.random());
      source.stop(at + length + 0.05);
    };

    const kick = (at: number) => {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(120, at);
      osc.frequency.exponentialRampToValueAtTime(40, at + 0.15);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.45, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      osc.connect(gain).connect(bus);
      osc.start(at);
      osc.stop(at + 0.3);
    };

    const schedule = () => {
      while (nextTime < ctx.currentTime + LOOKAHEAD_S) {
        const inBar = step % 8;
        const chord = p.chords[Math.floor(step / 8) % p.chords.length];
        const at = nextTime + (inBar % 2 ? p.swing * stepLength : 0);

        if (inBar === 0) {
          for (const note of chord) {
            tone(note, at, stepLength * 8.5, p.pad, 0.25, padFilter);
            // The same note an octave up: small laptop and phone speakers cannot play the low one.
            tone(note + 12, at, stepLength * 8.5, p.pad * 0.6, 0.25, padFilter);
          }
        }
        if (p.arp > 0) {
          tone(chord[ARP_PATTERN[inBar] % chord.length] + 12, at, 1.1, p.arp, 0.01, bus);
        }
        if (p.drums) {
          if (inBar === 0 || inBar === 5) kick(at);
          if (inBar === 2 || inBar === 6) hit(at, 0.16, 0.12, "bandpass", 1800);
          hit(at, 0.04, 0.035, "highpass", 7000);
        }

        step++;
        nextTime += stepLength;
      }
    };

    schedule();
    this.timer = setInterval(schedule, 200);
  }
}
