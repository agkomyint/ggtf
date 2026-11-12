import { describe, expect, test } from "bun:test";
import { pct, randomStationId, stationLabel } from "./format";

describe("format", () => {
  test("station labels are 4 hex digits", () => {
    expect(stationLabel(0xa1)).toBe("#00A1");
    expect(stationLabel(0xbeef)).toBe("#BEEF");
    expect(stationLabel(null)).toBe("—");
  });

  test("random ids avoid 0 and the broadcast id", () => {
    for (let i = 0; i < 2000; i++) {
      const id = randomStationId();
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThan(0xffff);
    }
  });

  test("percentages round", () => {
    expect(pct(0.953)).toBe("95%");
    expect(pct(1)).toBe("100%");
  });
});
