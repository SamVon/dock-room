// The voice chat in one browser: the microphone, and one direct connection to every other duck
// that is talking. The server never hears anything. It only says who is in the voice chat and
// passes each pair what they need to find each other (see shared/voice.ts).
//
// It is tuned to feel like talking in a room, not like a broadcast:
// - sound goes straight from browser to browser, with no server in between to add delay
// - incoming sound is played as soon as it arrives, without holding it back to smooth it out
// - a muted microphone stays open, so unmuting takes effect at once
// - "who is speaking" is measured here from the sound itself, so it lights up without a round trip
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/shared/protocol";
import { VOICE_LIMITS, type IceServer, type VoiceIceCandidate, type VoiceSignal } from "@/shared/voice";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** "joining" covers asking for the microphone and waiting for the server's answer. */
export type VoiceStatus = "off" | "joining" | "on";

type Callbacks = {
  onStatus: (status: VoiceStatus) => void;
  /** The user ids making sound right now, ours included. Called only when the list changes. */
  onSpeaking: (userIds: string[]) => void;
  onError: (message: string) => void;
};

/** Listens to one stream to tell whether someone is speaking on it. */
type Meter = { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; loudAt: number };

type Peer = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  /** We called them. Only the caller ever makes an offer, so two offers can never cross. */
  caller: boolean;
  /** Paths that arrived before the description they belong to. */
  early: VoiceIceCandidate[];
  /** Our own paths, waiting to be sent together. */
  outbox: VoiceIceCandidate[];
  flushTimer?: ReturnType<typeof setTimeout>;
  /** Steps of the handshake run one after another, never interleaved. */
  queue: Promise<void>;
  meter?: Meter;
};

/** Paths are found in a quick burst. Waiting this long sends them in one message instead of a dozen. */
const CANDIDATE_BATCH_MS = 40;
const METER_INTERVAL_MS = 50;
/** Louder than this counts as speaking (0 is silence, 1 is as loud as it gets). */
const SPEAKING_LEVEL = 0.02;
/** Stays lit this long after the last loud moment, so it does not flicker between words. */
const SPEAKING_HOLD_MS = 350;

const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

/** Asks the browser to play this sound the moment it arrives. The setting has an older name in some browsers. */
function playWithoutDelay(receiver: RTCRtpReceiver) {
  const tuned = receiver as unknown as Record<"jitterBufferTarget" | "playoutDelayHint", number | null>;
  try {
    if ("jitterBufferTarget" in receiver) tuned.jitterBufferTarget = 0;
    else if ("playoutDelayHint" in receiver) tuned.playoutDelayHint = 0;
  } catch {
    // only a hint: the default still works
  }
}

export class VoiceClient {
  private status: VoiceStatus = "off";
  private selfId = "";
  private muted = false;
  private deafened = false;
  private stream: MediaStream | null = null;
  private iceServers: IceServer[] = [];
  private peers = new Map<string, Peer>();
  /** Grows each time we ask the server to let us in, so a late answer to an older request is ignored. */
  private attempt = 0;
  private ctx: AudioContext | null = null;
  private ownMeter: Meter | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private speaking = "";

  constructor(
    private readonly socket: AppSocket,
    private readonly callbacks: Callbacks,
  ) {
    socket.on("voice:signal", this.onSignal);
  }

  /** Call from a click or tap: the browser asks for the microphone, and sound may only start after a gesture. */
  async join() {
    if (this.status !== "off") return;
    if (!navigator.mediaDevices?.getUserMedia) return this.callbacks.onError("Voice chat needs a secure (https) page");
    this.setStatus("joining");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false });
    } catch (error) {
      if (!this.is("joining")) return;
      this.setStatus("off");
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      return this.callbacks.onError(denied ? "Allow the microphone to join the voice chat" : "No microphone was found");
    }
    // Left again while the browser was still asking.
    if (!this.is("joining")) return stream.getTracks().forEach((track) => track.stop());
    this.stream = stream;
    this.applyMute();
    this.startMeters(stream);
    this.announce();
  }

  leave() {
    if (this.status === "off") return;
    if (this.socket.connected) this.socket.emit("voice:leave");
    this.teardown();
  }

  /** Switches our microphone. The track stays open and only goes silent, so switching back is instant. */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMute();
    if (this.status === "on") this.socket.emit("voice:mute", { muted }, () => {});
  }

  /** Stops playing everyone else. Local only: nobody is told. */
  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    for (const peer of this.peers.values()) peer.audio.muted = deafened;
  }

  /**
   * The server's full list of who is in the voice chat, from a snapshot. If we think we are in and
   * the server does not (our connection dropped for a moment), we join again from the start.
   */
  sync(voiceUserIds: readonly string[], selfId: string) {
    this.selfId = selfId;
    if (this.status === "off" || !this.stream) return;
    if (!voiceUserIds.includes(selfId)) return this.announce();
    for (const id of [...this.peers.keys()]) if (!voiceUserIds.includes(id)) this.drop(id);
  }

  /** A duck left the voice chat. */
  drop(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    this.peers.delete(userId);
    clearTimeout(peer.flushTimer);
    peer.pc.onicecandidate = peer.pc.ontrack = peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.meter?.source.disconnect();
  }

  /** Leaves and stops listening to the socket. The client cannot be used after this. */
  dispose() {
    this.leave();
    this.socket.off("voice:signal", this.onSignal);
  }

  // --- Joining ---------------------------------------------------------------------

  /** Tells the server we are in, then calls everyone who was there before us. */
  private announce() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.setStatus("joining");
    const attempt = ++this.attempt;
    // Offline: the snapshot that follows the reconnect brings us back here (see sync).
    if (!this.socket.connected) return;
    this.socket.emit("voice:join", { muted: this.muted }, (res) => {
      if (attempt !== this.attempt || this.status === "off") return;
      if (!res.ok || !res.data) {
        this.teardown();
        return this.callbacks.onError(res.ok ? "Could not join the voice chat" : res.error.message);
      }
      this.iceServers = res.data.iceServers;
      this.setStatus("on");
      for (const id of res.data.peers) this.connect(id, true);
    });
  }

  private teardown() {
    this.attempt++;
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.stopMeters();
    this.setStatus("off");
  }

  /** Asked again after every wait: the user may have left, or joined again, in the meantime. */
  private is(status: VoiceStatus) {
    return this.status === status;
  }

  private setStatus(status: VoiceStatus) {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatus(status);
  }

  private applyMute() {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !this.muted;
  }

  // --- One connection per duck -------------------------------------------------------

  private connect(userId: string, caller: boolean): Peer {
    this.drop(userId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-bundle" });
    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = this.deafened;
    const peer: Peer = { pc, audio, caller, early: [], outbox: [], queue: Promise.resolve() };
    this.peers.set(userId, peer);

    for (const track of this.stream?.getAudioTracks() ?? []) pc.addTrack(track, this.stream!);

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate?.candidate) return; // the empty one only marks the end of the list
      peer.outbox.push(candidate.toJSON() as VoiceIceCandidate);
      peer.flushTimer ??= setTimeout(() => this.flush(userId, peer), CANDIDATE_BATCH_MS);
    };
    pc.ontrack = ({ receiver, streams, track }) => {
      playWithoutDelay(receiver);
      const incoming = streams[0] ?? new MediaStream([track]);
      audio.srcObject = incoming;
      audio.play().catch(() => {});
      peer.meter?.source.disconnect();
      peer.meter = this.meter(incoming);
    };
    pc.onconnectionstatechange = () => {
      // The path broke (a network change, say). The caller looks for a new one; the other side waits for it.
      if (pc.connectionState === "failed" && caller) this.offer(userId, peer, true);
    };

    if (caller) this.offer(userId, peer);
    return peer;
  }

  private offer(userId: string, peer: Peer, iceRestart = false) {
    this.step(peer, async () => {
      await peer.pc.setLocalDescription(await peer.pc.createOffer({ iceRestart }));
      this.send(userId, { type: "offer", sdp: peer.pc.localDescription!.sdp });
    });
  }

  private onSignal = ({ from, signal }: { from: string; signal: VoiceSignal }) => {
    // While we are (re)joining, anything that arrives belongs to connections we have already dropped.
    if (this.status !== "on") return;

    if (signal.type === "offer") {
      const known = this.peers.get(from);
      if (known?.caller) return; // we call them, they never call us
      const peer = known ?? this.connect(from, false);
      return this.step(peer, async () => {
        await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await this.addEarly(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        this.send(from, { type: "answer", sdp: peer.pc.localDescription!.sdp });
      });
    }

    const peer = this.peers.get(from);
    if (!peer) return;
    if (signal.type === "answer") {
      return this.step(peer, async () => {
        await peer.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        await this.addEarly(peer);
      });
    }
    // Paths are only understood once the other side's description is in.
    peer.early.push(...signal.candidates);
    if (peer.pc.remoteDescription) this.step(peer, () => this.addEarly(peer));
  };

  private async addEarly(peer: Peer) {
    for (const candidate of peer.early.splice(0)) await peer.pc.addIceCandidate(candidate).catch(() => {});
  }

  /** Runs one step of a handshake after the ones before it. A step that fails does not block the next. */
  private step(peer: Peer, run: () => Promise<void>) {
    peer.queue = peer.queue.then(run).catch(() => {});
  }

  private flush(userId: string, peer: Peer) {
    peer.flushTimer = undefined;
    while (peer.outbox.length) this.send(userId, { type: "candidates", candidates: peer.outbox.splice(0, VOICE_LIMITS.candidatesPerSignal) });
  }

  private send(to: string, signal: VoiceSignal) {
    // The duck may have left a moment ago: a refusal here needs no message on screen.
    if (this.peers.has(to)) this.socket.emit("voice:signal", { to, signal }, () => {});
  }

  // --- Who is speaking ---------------------------------------------------------------

  private meter(stream: MediaStream): Meter | undefined {
    if (!this.ctx) return undefined;
    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser); // listened to, never played: playback is the <audio> element's job
    return { source, analyser, samples: new Float32Array(analyser.fftSize), loudAt: 0 };
  }

  private startMeters(own: MediaStream) {
    try {
      this.ctx = new AudioContext();
      void this.ctx.resume();
    } catch {
      return; // no speaking marks, but the voice chat itself still works
    }
    this.ownMeter = this.meter(own) ?? null;
    this.meterTimer = setInterval(() => {
      const now = performance.now();
      const loud = (meter: Meter | null | undefined) => {
        if (!meter) return false;
        meter.analyser.getFloatTimeDomainData(meter.samples);
        let sum = 0;
        for (const sample of meter.samples) sum += sample * sample;
        if (Math.sqrt(sum / meter.samples.length) > SPEAKING_LEVEL) meter.loudAt = now;
        return meter.loudAt > 0 && now - meter.loudAt < SPEAKING_HOLD_MS;
      };
      const ids = [...this.peers].filter(([, peer]) => loud(peer.meter)).map(([id]) => id);
      if (loud(this.ownMeter) && !this.muted && this.selfId) ids.push(this.selfId);
      const key = ids.sort().join(",");
      if (key === this.speaking) return;
      this.speaking = key;
      this.callbacks.onSpeaking(ids);
    }, METER_INTERVAL_MS);
  }

  private stopMeters() {
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.ownMeter = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    if (this.speaking) this.callbacks.onSpeaking([]);
    this.speaking = "";
  }
}
