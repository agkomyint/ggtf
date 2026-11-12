import type { LinkStateName } from "./types";

export function stationLabel(id: number | null | undefined): string {
  if (id === null || id === undefined) return "—";
  return "#" + id.toString(16).toUpperCase().padStart(4, "0");
}

export function randomStationId(): number {
  const v = new Uint16Array(1);
  do {
    crypto.getRandomValues(v);
  } while (v[0] === 0 || v[0] === 0xffff);
  return v[0];
}

export const STATE_LABEL: Record<LinkStateName, string> = {
  idle: "Idle",
  calling: "Summoning…",
  ringing: "Answering…",
  training: "Tuning the line",
  key_exchange: "Swapping keys",
  awaiting_confirm: "Check the words",
  connected: "Connected",
  closing: "Hanging up",
};

export function stateTone(s: LinkStateName): "default" | "secondary" | "outline" | "destructive" {
  if (s === "connected") return "default";
  if (s === "idle") return "outline";
  return "secondary";
}

/** Success rate as a percentage string, e.g. 0.953 -> "95%". */
export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
