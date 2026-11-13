export type LinkStateName =
  | "idle"
  | "calling"
  | "ringing"
  | "training"
  | "key_exchange"
  | "awaiting_confirm"
  | "connected"
  | "closing";

export type ProfileName = "wraith" | "specter" | "banshee" | "poltergeist";
export type MsgStatusName = "queued" | "sending" | "delivered" | "failed";

export type StationEvent =
  | { type: "state"; state: LinkStateName; role: "caller" | "answerer" | null; peer: number | null; profile: ProfileName }
  | { type: "sas"; words: string[] }
  | { type: "peer_confirmed" }
  | { type: "trained"; mask: number; profile: ProfileName }
  | { type: "msg_status"; id: number; status: MsgStatusName }
  | { type: "msg_rx"; kind: number; text: string; b64: string; bytes: number }
  | { type: "retry"; what: string; attempt: number; profile: ProfileName }
  | { type: "log"; text: string }
  | { type: "ended"; reason: string }
  | { type: "incoming"; from: number; tag: string }
  | { type: "answering"; from: number; tag: string }
  | { type: "incoming_gone" }
  | { type: "beam_progress"; id: number; from: number; have: number; count: number; got: string }
  | { type: "beam_rx"; id: number; from: number; text: string; b64: string; bytes: number }
  | { type: "beam_round"; id: number; round: number; chunks: number }
  | { type: "beam_stopped"; id: number; rounds: number }
  | { type: "detect"; score: number }
  | { type: "rx_failed"; stage: string }
  | { type: "rx_frame"; kind: string; profile: ProfileName; snr: number; from: number; own: boolean }
  | { type: "tx"; kind: string; profile: ProfileName; ms: number };

export interface StationStats {
  detections: number;
  frames: number;
  marker_fail: number;
  header_fail: number;
  payload_fail: number;
  last_snr: number;
  last_score: number;
  tx_frames: number;
  rx_frames: number;
  own_frames: number;
  busy: boolean;
  peak: number;
  transmitting: boolean;
  beaming?: boolean;
  decoder?: string;
  band?: string;
  link?: LinkInfo;
}

/** Link-layer details from the Rust link (fragment size adapts to the profile and retries). */
export interface LinkInfo {
  frag: number;
  frag_limit: number;
  acks: number;
  piggybacked: number;
  pings: number;
  backlog: number;
  state: LinkStateName;
  profile: ProfileName;
}

export interface ProfileInfo {
  id: number;
  name: ProfileName;
  raw_bps: number;
  lo_hz: number;
  hi_hz: number;
  parity: number;
}

export interface ChatMessage {
  key: string;
  id: number | null;
  dir: "out" | "in";
  text: string;
  status: MsgStatusName | "received";
  at: number;
}

export interface LogLine {
  key: number;
  at: number;
  text: string;
  tone: "info" | "tx" | "rx" | "warn" | "good";
}
