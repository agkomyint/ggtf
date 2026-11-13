// Human-readable lines for GGTP traffic (Séance OS activity strip, Studio network tab).

import { Format, MsgType, statusText, unpackBody, type TraceEntry } from "./ggtp";

const METHOD: Record<number, string> = { 1: "GET", 2: "POST", 3: "PUT", 4: "DELETE", 5: "WATCH" };
const TYPE: Record<number, string> = { 0: "REQ", 1: "RES", 2: "NOTIFY", 3: "MSG", 4: "CANCEL", 5: "HELLO" };

export interface TraceRow {
  dir: "out" | "in";
  type: string;
  summary: string;
  token: number;
  bytes: number;
  preview: string;
  os: boolean;
}

function preview(t: TraceEntry): string {
  if (t.msg.format === Format.None) return "";
  if (t.msg.format === Format.Bytes) return `${t.msg.body.length} raw bytes`;
  const v = unpackBody(t.msg);
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

export function traceRow(t: TraceEntry): TraceRow {
  const m = t.msg;
  let summary: string;
  switch (m.type) {
    case MsgType.Req:
      summary = `${METHOD[m.code] ?? m.code} ${m.path}`;
      break;
    case MsgType.Res:
      summary = statusText(m.code);
      break;
    case MsgType.Msg:
      summary = `topic "${m.path}"`;
      break;
    case MsgType.Notify:
      summary = `update #${m.code}`;
      break;
    case MsgType.Hello:
      summary = "who are you?";
      break;
    default:
      summary = "";
  }
  const os = m.type === MsgType.Hello || m.path.startsWith("/~") || m.path.startsWith("~");
  return { dir: t.dir, type: TYPE[m.type] ?? "?", summary, token: m.token, bytes: t.bytes, preview: preview(t), os };
}
