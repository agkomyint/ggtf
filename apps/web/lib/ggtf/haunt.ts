// Haunted-room sandbox: tiny text commands sent by beam, e.g. "H1 4821 lamp #ff3355".
// Format: "H1 <4-digit room code> <action> [argument]". Only the actions below exist;
// anything else is rejected, so a beam can never make the device do something unlisted.

export type HauntAction =
  | { kind: "lamp"; color: string }
  | { kind: "lamp_off" }
  | { kind: "door"; open: boolean }
  | { kind: "ghost"; show: boolean }
  | { kind: "candle"; lit: boolean }
  | { kind: "sound"; name: SoundName }
  | { kind: "mirror"; text: string }
  | { kind: "reset" };

export const SOUNDS = ["bell", "howl", "creak"] as const;
export type SoundName = (typeof SOUNDS)[number];
export const MAX_MIRROR = 24;

export const LAMP_PRESETS = [
  { name: "Witch green", color: "#6dff9c" },
  { name: "Blood red", color: "#ff3355" },
  { name: "Pumpkin", color: "#ff8a1f" },
  { name: "Spirit violet", color: "#a66bff" },
  { name: "Ice blue", color: "#5cd6ff" },
  { name: "Candle", color: "#ffd27a" },
];

export function randomRoomCode(): string {
  const v = new Uint16Array(1);
  crypto.getRandomValues(v);
  return String(1000 + (v[0] % 9000));
}

export function encodeCommand(code: string, a: HauntAction): string {
  const arg = (() => {
    switch (a.kind) {
      case "lamp":
        return `lamp ${a.color}`;
      case "lamp_off":
        return "lamp off";
      case "door":
        return `door ${a.open ? "open" : "close"}`;
      case "ghost":
        return `ghost ${a.show ? "show" : "hide"}`;
      case "candle":
        return `candle ${a.lit ? "on" : "off"}`;
      case "sound":
        return `sound ${a.name}`;
      case "mirror":
        return `mirror ${a.text.slice(0, MAX_MIRROR)}`;
      case "reset":
        return "reset";
    }
  })();
  return `H1 ${code} ${arg}`;
}

export type Parsed = { ok: true; code: string; action: HauntAction } | { ok: false; reason: string };

export function parseCommand(text: string): Parsed {
  const m = /^H1 (\d{4}) (\w+)(?: ([^\n]*))?$/.exec(text.trim());
  if (!m) return { ok: false, reason: "not a haunt command" };
  const [, code, verb, rawArg] = m;
  const arg = (rawArg ?? "").trim();
  const bad = (reason: string): Parsed => ({ ok: false, reason });
  const ok = (action: HauntAction): Parsed => ({ ok: true, code, action });
  switch (verb) {
    case "lamp":
      if (arg === "off") return ok({ kind: "lamp_off" });
      return /^#[0-9a-fA-F]{6}$/.test(arg) ? ok({ kind: "lamp", color: arg.toLowerCase() }) : bad("lamp needs #rrggbb or off");
    case "door":
      return arg === "open" || arg === "close" ? ok({ kind: "door", open: arg === "open" }) : bad("door needs open or close");
    case "ghost":
      return arg === "show" || arg === "hide" ? ok({ kind: "ghost", show: arg === "show" }) : bad("ghost needs show or hide");
    case "candle":
      return arg === "on" || arg === "off" ? ok({ kind: "candle", lit: arg === "on" }) : bad("candle needs on or off");
    case "sound":
      return (SOUNDS as readonly string[]).includes(arg) ? ok({ kind: "sound", name: arg as SoundName }) : bad("unknown sound");
    case "mirror": {
      // Printable characters only, short enough to fit the mirror.
      const text = arg.replace(/[^\x20-\x7e]/g, "").slice(0, MAX_MIRROR);
      return ok({ kind: "mirror", text });
    }
    case "reset":
      return ok({ kind: "reset" });
    default:
      return bad(`unknown action "${verb}"`);
  }
}

export interface RoomState {
  lamp: string | null;
  door: boolean;
  ghost: boolean;
  candle: boolean;
  mirror: string;
}

export const INITIAL_ROOM: RoomState = { lamp: "#ffd27a", door: false, ghost: false, candle: true, mirror: "" };

export function applyAction(s: RoomState, a: HauntAction): RoomState {
  switch (a.kind) {
    case "lamp":
      return { ...s, lamp: a.color };
    case "lamp_off":
      return { ...s, lamp: null };
    case "door":
      return { ...s, door: a.open };
    case "ghost":
      return { ...s, ghost: a.show };
    case "candle":
      return { ...s, candle: a.lit };
    case "mirror":
      return { ...s, mirror: a.text };
    case "reset":
      return INITIAL_ROOM;
    case "sound":
      return s;
  }
}

export function describe(a: HauntAction): string {
  switch (a.kind) {
    case "lamp":
      return `lamp → ${a.color}`;
    case "lamp_off":
      return "lamp off";
    case "door":
      return a.open ? "door opened" : "door closed";
    case "ghost":
      return a.show ? "ghost appears" : "ghost vanishes";
    case "candle":
      return a.lit ? "candle lit" : "candle out";
    case "sound":
      return `sound: ${a.name}`;
    case "mirror":
      return a.text ? `mirror reads “${a.text}”` : "mirror wiped";
    case "reset":
      return "room reset";
  }
}
