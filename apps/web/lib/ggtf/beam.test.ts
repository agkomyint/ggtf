import { describe, expect, test } from "bun:test";
import { CHUNK_LARGE, beamChunks, beamRoundSeconds, decodeImage, parseWifi, safeLink, wifiString } from "./beam";

describe("beam helpers", () => {
  test("wifi strings round-trip, including special characters", () => {
    const s = wifiString('Haunted; "House"', "p@ss:word,\\x", "WPA");
    expect(s).toBe('WIFI:T:WPA;S:Haunted\\; \\"House\\";P:p@ss\\:word\\,\\\\x;;');
    expect(parseWifi(s)).toEqual({ ssid: 'Haunted; "House"', password: "p@ss:word,\\x", security: "WPA" });
  });

  test("open networks have no password", () => {
    expect(parseWifi(wifiString("Cafe", "ignored", "nopass"))).toEqual({ ssid: "Cafe", password: "", security: "nopass" });
  });

  test("only http(s) links can be opened", () => {
    expect(safeLink("https://github.com/agkomyint/ggtf")).toBe("https://github.com/agkomyint/ggtf");
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("file:///etc/passwd")).toBeNull();
    expect(safeLink("hello world")).toBeNull();
  });

  test("airtime grows with length and shrinks with speed", () => {
    expect(beamChunks(44)).toBe(1);
    expect(beamChunks(45)).toBe(2);
    expect(beamRoundSeconds(100, 2)).toBeLessThan(beamRoundSeconds(100, 1));
    expect(beamRoundSeconds(100, 1)).toBeLessThan(beamRoundSeconds(100, 0));
    expect(beamRoundSeconds(200, 1)).toBeGreaterThan(beamRoundSeconds(50, 1));
    expect(beamRoundSeconds(3000, 3, CHUNK_LARGE)).toBeLessThan(beamRoundSeconds(3000, 2, CHUNK_LARGE));
    expect(beamRoundSeconds(3000, 2, CHUNK_LARGE)).toBeLessThan(beamRoundSeconds(3000, 2));
  });

  test("airtime matches the Rust modem (frame_samples for one 52-byte payload, specter)", () => {
    // 5280 + 4800 + 19*1440 + 72*1440 + 120 + 960 = 142200 samples
    expect(beamRoundSeconds(44, 1)).toBeCloseTo(142200 / 48000, 6);
  });

  test("text is never mistaken for an image", () => {
    expect(decodeImage(new TextEncoder().encode("GI hello"))).toBeNull();
    expect(decodeImage(new Uint8Array([0, 0x47, 0x49, 9, 1, 1, 0]))).toBeNull();
  });
});
