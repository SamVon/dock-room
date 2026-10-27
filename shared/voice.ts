// Voice chat. The sound itself never touches the server: it goes straight from browser to browser
// (WebRTC). The server only keeps the list of who is talking and passes each pair the connection
// details they need to find each other.
import { z } from "zod";

export const VOICE_LIMITS = { sdp: 8000, candidate: 600, candidatesPerSignal: 16 } as const;

/** A session description: the text a browser writes to say how it can send and receive audio. */
const sdp = z.string().min(1).max(VOICE_LIMITS.sdp);

/** One network path a browser can be reached on. */
const IceCandidateSchema = z.strictObject({
  candidate: z.string().min(1).max(VOICE_LIMITS.candidate),
  sdpMid: z.string().max(32).nullable(),
  sdpMLineIndex: z.number().int().min(0).max(16).nullable(),
  usernameFragment: z.string().max(256).nullable().optional(),
});
export type VoiceIceCandidate = z.infer<typeof IceCandidateSchema>;

const SignalSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("offer"), sdp }),
  z.strictObject({ type: z.literal("answer"), sdp }),
  // Paths are found a few at a time and sent in small batches, not one message each.
  z.strictObject({ type: z.literal("candidates"), candidates: z.array(IceCandidateSchema).min(1).max(VOICE_LIMITS.candidatesPerSignal) }),
]);
export type VoiceSignal = z.infer<typeof SignalSchema>;

/** `muted` is the sender's own microphone. Nobody can mute or unmute someone else with this. */
export const VoiceMuteSchema = z.strictObject({ muted: z.boolean() });
/** A target user id is allowed here because a signal is for one other duck. The server checks both are in the voice chat. */
export const VoiceSignalSchema = z.strictObject({ to: z.uuid(), signal: SignalSchema });

export type VoiceParticipant = { userId: string; muted: boolean };

/** Servers that help two browsers find a path to each other (STUN), or carry the sound when there is none (TURN). */
export type IceServer = { urls: string[]; username?: string; credential?: string };

/** The answer to `voice:join`: who is already talking, and how to reach them. The joiner calls each of them. */
export type VoiceJoinResult = { peers: string[]; iceServers: IceServer[] };
