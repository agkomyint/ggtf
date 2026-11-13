import { describe, expect, test } from "bun:test";
import { GhostDB } from "./ghostdb";
import { STATUS } from "./ggtp";
import { SpiritSession, type SpiritIdentity } from "./session";
import { instantPair } from "./transport";

const ID: SpiritIdentity = { appId: "a1b2c3d4e5f60718", hash: "00112233aabbccdd", version: 1, name: "Ghost Grid" };
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function setup(idB: SpiritIdentity = ID) {
  const log: string[] = [];
  const a = new SpiritSession(ID, new GhostDB("dev-a"), { state: (s) => log.push(`a:${s}`), peerJoin: (p) => log.push(`a:join:${p.device}`) });
  const b = new SpiritSession(idB, new GhostDB("dev-b"), { state: (s, d) => log.push(`b:${s}${d ? `:${d}` : ""}`) });
  const wire = instantPair();
  a.attach(wire.a);
  b.attach(wire.b);
  return { a, b, wire, log };
}

describe("SpiritSession", () => {
  test("matching HELLO makes both sides ready", async () => {
    const { a, b, wire, log } = setup();
    wire.connect();
    await wait();
    expect(a.state).toBe("ready");
    expect(b.state).toBe("ready");
    expect(a.peer?.device).toBe("dev-b");
    expect(log).toContain("a:join:dev-b");
  });

  test("a different version is a mismatch with a reason", async () => {
    const { a, b, wire } = setup({ ...ID, version: 2, hash: "ffff0000ffff0000" });
    const reasons: string[] = [];
    b.listen({ state: (s, d) => s === "mismatch" && reasons.push(d ?? "") });
    wire.connect();
    await wait();
    expect(a.state).toBe("mismatch");
    expect(b.state).toBe("mismatch");
    expect(reasons[0]).toContain("version 1");
  });

  test("a different spirit is named in the mismatch", async () => {
    const { b, wire } = setup({ appId: "ffffffffffffffff", hash: "1", version: 1, name: "Spirit Board" });
    let why = "";
    b.listen({ state: (s, d) => s === "mismatch" && (why = d ?? "") });
    wire.connect();
    await wait();
    expect(why).toContain("Ghost Grid");
  });

  test("databases sync on connect and push live writes", async () => {
    const { a, b, wire } = setup();
    a.db.put("note:1", "written offline on a");
    b.db.put("note:2", "written offline on b");
    wire.connect();
    await wait(40);
    expect(a.db.list()).toEqual(b.db.list());
    a.db.put("note:3", "live");
    await wait();
    expect(b.db.get("note:3")).toBe("live");
  });

  test("peer messages and GGTP requests work both ways; the link dropping fails requests", async () => {
    const { a, b, wire } = setup();
    const got: unknown[] = [];
    b.listen({ peerMsg: (t, body) => got.push([t, body]) });
    a.ggtp.route("GET", "/board", () => [1, 2, 3]);
    wire.connect();
    await wait();
    expect(a.send("move", { x: 1 })).toBe(true);
    await wait();
    expect(got).toEqual([["move", { x: 1 }]]);
    expect((await b.ggtp.request("GET", "/board")).body).toEqual([1, 2, 3]);
    const left: string[] = [];
    a.listen({ peerLeave: (r) => left.push(r) });
    wire.disconnect("link lost");
    expect(a.state).toBe("offline");
    expect(left).toEqual(["link lost"]);
    expect((await a.ggtp.request("GET", "/board")).status).toBe(STATUS.UNAVAILABLE);
    expect(a.send("move", {})).toBe(false);
  });

  test("reserved topics and DB routes are off limits to apps", async () => {
    const { a, wire } = setup();
    wire.connect();
    await wait();
    expect(() => a.send("~db/push", {})).toThrow();
  });
});
