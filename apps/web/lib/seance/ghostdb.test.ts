import { describe, expect, test } from "bun:test";
import { GhostDB, type WireRec } from "./ghostdb";

/** Full exchange both ways, the way two sessions sync on connect. */
function syncBoth(x: GhostDB, y: GhostDB) {
  const fromX = x.changesSince(y.cursor(x.device), y.device, 1e9);
  y.merge(fromX.recs);
  y.setCursor(x.device, fromX.top);
  const fromY = y.changesSince(x.cursor(y.device), x.device, 1e9);
  x.merge(fromY.recs);
  x.setCursor(y.device, fromY.top);
}

const view = (d: GhostDB) => d.list();

describe("GhostDB", () => {
  test("put, get, list by prefix, delete", () => {
    const d = new GhostDB("a");
    d.put("note:1", { text: "boo" });
    d.put("note:2", "hi");
    d.put("score", 3);
    expect(d.get("note:1")).toEqual({ text: "boo" });
    expect(d.list("note:").map((e) => e.key)).toEqual(["note:1", "note:2"]);
    d.del("note:1");
    expect(d.get("note:1")).toBeUndefined();
    expect(d.size).toBe(2);
  });

  test("values are copies, limits are enforced", () => {
    const d = new GhostDB("a");
    const v = { n: 1 };
    d.put("k", v);
    v.n = 2;
    expect(d.get("k")).toEqual({ n: 1 });
    expect(() => d.put("", 1)).toThrow();
    expect(() => d.put("~db", 1)).toThrow();
    expect(() => d.put("big", "x".repeat(5000))).toThrow();
  });

  test("concurrent edits converge to the same winner on both sides", () => {
    const a = new GhostDB("dev-a");
    const b = new GhostDB("dev-b");
    a.put("title", "from a");
    b.put("title", "from b");
    a.put("only-a", 1);
    b.put("only-b", 2);
    syncBoth(a, b);
    expect(view(a)).toEqual(view(b));
    // Same clock: the larger device id wins.
    expect(a.get("title")).toBe("from b");
  });

  test("a later write beats an earlier one, deletes sync as tombstones", () => {
    const a = new GhostDB("a");
    const b = new GhostDB("b");
    a.put("k", 1);
    syncBoth(a, b);
    b.put("k", 2);
    syncBoth(a, b);
    expect(a.get("k")).toBe(2);
    a.del("k");
    syncBoth(a, b);
    expect(b.get("k")).toBeUndefined();
    expect(view(a)).toEqual(view(b));
  });

  test("delta sync only sends what changed since the last sync", () => {
    const a = new GhostDB("a");
    const b = new GhostDB("b");
    for (let i = 0; i < 20; i++) a.put(`k${i}`, i);
    syncBoth(a, b);
    a.put("k3", "changed");
    const delta = a.changesSince(b.cursor("a"), "b", 1e9);
    expect(delta.recs.map((r) => r[0])).toEqual(["k3"]);
    // Nothing to send back to a: b's copies came from a.
    expect(b.changesSince(a.cursor("b"), "a", 1e9).recs).toEqual([]);
  });

  test("changes spread A → B → C through the middle device", () => {
    const a = new GhostDB("a");
    const b = new GhostDB("b");
    const c = new GhostDB("c");
    a.put("from-a", "hello");
    syncBoth(a, b);
    syncBoth(b, c);
    expect(c.get("from-a")).toBe("hello");
  });

  test("pages stay under the size budget and resume with `more`", () => {
    const a = new GhostDB("a");
    for (let i = 0; i < 40; i++) a.put(`page:${i}`, "x".repeat(100));
    const b = new GhostDB("b");
    let rounds = 0;
    for (;;) {
      const r = a.changesSince(b.cursor("a"), "b", 1500);
      expect(JSON.stringify(r.recs).length).toBeLessThan(1700);
      b.merge(r.recs);
      b.setCursor("a", r.top);
      rounds++;
      if (!r.more) break;
    }
    expect(rounds).toBeGreaterThan(2);
    expect(view(b)).toEqual(view(a));
  });

  test("local: keys never leave the device", () => {
    const a = new GhostDB("a");
    const b = new GhostDB("b");
    a.put("local:draft", "secret");
    a.put("shared", "hi");
    syncBoth(a, b);
    expect(b.get("local:draft")).toBeUndefined();
    expect(b.get("shared")).toBe("hi");
    expect(b.merge([["local:x", 1, 99, "a", 0, 1]])).toBe(0);
  });

  test("merge ignores junk", () => {
    const d = new GhostDB("a");
    expect(d.merge([["", 1, 1, "x", 0, 1], ["~db", 1, 1, "x", 0, 1], [5, 1, 1, "x", 0, 1] as unknown as WireRec, "nope" as unknown as WireRec])).toBe(0);
  });

  test("watch fires for local and peer changes under its prefix", () => {
    const a = new GhostDB("a");
    const b = new GhostDB("b");
    const seen: string[] = [];
    b.watch("note:", (c) => seen.push(`${c.origin}:${c.key}`));
    b.put("note:mine", 1);
    b.put("other", 1);
    a.put("note:theirs", 2);
    syncBoth(a, b);
    expect(seen).toEqual(["local:note:mine", "peer:note:theirs"]);
  });
});
