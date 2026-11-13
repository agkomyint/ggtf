import { describe as group, expect, test } from "bun:test";
import { INITIAL_ROOM, applyAction, encodeCommand, parseCommand, type HauntAction } from "./haunt";

group("haunt commands", () => {
  const all: HauntAction[] = [
    { kind: "lamp", color: "#ff3355" },
    { kind: "lamp_off" },
    { kind: "door", open: true },
    { kind: "door", open: false },
    { kind: "ghost", show: true },
    { kind: "candle", lit: false },
    { kind: "sound", name: "howl" },
    { kind: "mirror", text: "GET OUT" },
    { kind: "reset" },
  ];

  test("every action round-trips and stays short", () => {
    for (const a of all) {
      const s = encodeCommand("4821", a);
      expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(44); // one 48-byte beam chunk with the CRC
      expect(parseCommand(s)).toEqual({ ok: true, code: "4821", action: a });
    }
  });

  test("anything outside the allow-list is rejected", () => {
    for (const s of ["H1 4821 exec rm -rf /", "H1 4821 lamp red", "H1 482 lamp #ffffff", "hello", "H1 4821 sound scream", "H2 4821 reset"]) {
      expect(parseCommand(s).ok).toBe(false);
    }
  });

  test("mirror text is trimmed to printable ASCII and 24 chars", () => {
    const p = parseCommand("H1 1234 mirror <script>👻 this is a very long message for a mirror");
    expect(p.ok && p.action.kind === "mirror" && p.action.text).toBe("<script> this is a very ");
  });

  test("actions update the room", () => {
    let s = applyAction(INITIAL_ROOM, { kind: "lamp", color: "#a66bff" });
    s = applyAction(s, { kind: "door", open: true });
    expect(s).toMatchObject({ lamp: "#a66bff", door: true });
    expect(applyAction(s, { kind: "reset" })).toEqual(INITIAL_ROOM);
  });
});
