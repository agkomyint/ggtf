import { describe, expect, test } from "bun:test";
import { Format, GgtpEndpoint, MsgType, STATUS, decode, encode, isSuccess, packBody, statusText, unpackBody } from "./ggtp";

/** Two endpoints wired together, delivering on the next tick like a real transport. */
function pair(timeoutMs = 1000) {
  const box: { a?: GgtpEndpoint; b?: GgtpEndpoint } = {};
  const a = new GgtpEndpoint({ send: (x) => setTimeout(() => box.b!.receive(x), 0), timeoutMs });
  const b = new GgtpEndpoint({ send: (x) => setTimeout(() => box.a!.receive(x), 0), timeoutMs });
  box.a = a;
  box.b = b;
  return { a, b };
}

describe("GGTP codec", () => {
  test("round trip keeps every field", () => {
    const m = { type: MsgType.Req, code: 2, token: 77, format: Format.Json, path: "/page/vampire?lang=en", body: new TextEncoder().encode('{"a":1}') };
    expect(decode(encode(m))).toEqual(m);
  });

  test("header is 5 bytes plus the path", () => {
    expect(encode({ type: MsgType.Msg, code: 0, token: 0, format: Format.None, path: "move", body: new Uint8Array() }).length).toBe(9);
  });

  test("malformed input returns null", () => {
    expect(decode(new Uint8Array([]))).toBeNull();
    expect(decode(new Uint8Array([0x40, 1, 1, 0]))).toBeNull();
    expect(decode(new Uint8Array([0x80, 1, 1, 0, 0]))).toBeNull(); // wrong version
    expect(decode(new Uint8Array([0x47, 1, 1, 0, 0]))).toBeNull(); // unknown type
    expect(decode(new Uint8Array([0x40, 1, 1, 9, 0]))).toBeNull(); // unknown format
    expect(decode(new Uint8Array([0x40, 1, 1, 0, 9, 65]))).toBeNull(); // path runs past the end
    expect(decode(new Uint8Array([0x40, 1, 1, 0, 1, 0xff]))).toBeNull(); // invalid UTF-8
  });

  test("bodies pick the smallest format", () => {
    expect(packBody(undefined).format).toBe(Format.None);
    expect(packBody("boo").format).toBe(Format.Text);
    expect(packBody({ x: 1 }).format).toBe(Format.Json);
    expect(packBody(new Uint8Array([1])).format).toBe(Format.Bytes);
    expect(unpackBody({ ...packBody({ x: [1, 2] }) })).toEqual({ x: [1, 2] });
  });

  test("status text", () => {
    expect(statusText(STATUS.CONTENT)).toBe("2.05 Content");
    expect(statusText(STATUS.NOT_FOUND)).toBe("4.04 Not Found");
    expect(isSuccess(STATUS.CREATED)).toBe(true);
    expect(isSuccess(STATUS.TIMEOUT)).toBe(false);
  });
});

describe("GGTP endpoint", () => {
  test("request, response, query and status mapping", async () => {
    const { a, b } = pair();
    b.route("GET", "/page/*", (req) => ({ title: req.path.slice(6), lang: req.query.lang }));
    b.route("POST", "/notes", (req) => ({ status: 201, body: { saved: req.body } }));
    const r = await a.request("GET", "/page/vampire?lang=en");
    expect(r.status).toBe(STATUS.CONTENT);
    expect(r.body).toEqual({ title: "vampire", lang: "en" });
    const p = await a.request("POST", "/notes", "boo");
    expect(p.status).toBe(STATUS.CREATED);
    expect(p.body).toEqual({ saved: "boo" });
  });

  test("not found, method not allowed, handler error", async () => {
    const { a, b } = pair();
    b.route("GET", "/only-get", () => "ok");
    b.route("GET", "/broken", () => {
      throw new Error("the ghost tripped");
    });
    expect((await a.request("GET", "/nope")).status).toBe(STATUS.NOT_FOUND);
    expect((await a.request("DELETE", "/only-get")).status).toBe(STATUS.NOT_ALLOWED);
    const e = await a.request("GET", "/broken");
    expect(e.status).toBe(STATUS.SERVER_ERROR);
    expect(e.body).toBe("the ghost tripped");
  });

  test("both sides serve at once", async () => {
    const { a, b } = pair();
    a.route("GET", "/who", () => "a");
    b.route("GET", "/who", () => "b");
    const [x, y] = await Promise.all([a.request("GET", "/who"), b.request("GET", "/who")]);
    expect([x.body, y.body]).toEqual(["b", "a"]);
  });

  test("concurrent requests match their own responses", async () => {
    const { a, b } = pair();
    b.route("GET", "/echo/*", async (req) => {
      await new Promise((r) => setTimeout(r, Number(req.path.slice(6))));
      return req.path;
    });
    const rs = await Promise.all([30, 5, 15].map((d) => a.request("GET", `/echo/${d}`)));
    expect(rs.map((r) => r.body)).toEqual(["/echo/30", "/echo/5", "/echo/15"]);
  });

  test("watch gets the first value, then notifications, until cancelled", async () => {
    const { a, b } = pair();
    let score = 0;
    b.route("GET", "/score", () => score);
    const seen: unknown[] = [];
    const w = await a.watch("/score", (v) => seen.push(v));
    expect(w.body).toBe(0);
    score = 3;
    expect(b.notify("/score", score)).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([3]);
    w.cancel();
    await new Promise((r) => setTimeout(r, 5));
    expect(b.notify("/score", 9)).toBe(0);
  });

  test("silence times out; closing fails pending requests", async () => {
    const lost = new GgtpEndpoint({ send: () => {}, timeoutMs: 20 });
    expect((await lost.request("GET", "/x")).status).toBe(STATUS.TIMEOUT);
    const closing = new GgtpEndpoint({ send: () => {}, timeoutMs: 10_000 });
    const p = closing.request("GET", "/x");
    closing.close("link lost");
    const r = await p;
    expect(r.status).toBe(STATUS.UNAVAILABLE);
    expect(r.body).toBe("link lost");
    expect((await closing.request("GET", "/x")).status).toBe(STATUS.UNAVAILABLE);
  });

  test("messages and hello reach their callbacks", async () => {
    const got: unknown[] = [];
    const box: { b?: GgtpEndpoint } = {};
    const a = new GgtpEndpoint({ send: (x) => box.b!.receive(x) });
    box.b = new GgtpEndpoint({ send: () => {}, onMsg: (t, body) => got.push([t, body]), onHello: (h) => got.push(h) });
    a.sendMsg("move", { x: 1, y: 2 });
    a.sendHello({ a: "app" });
    expect(got).toEqual([["move", { x: 1, y: 2 }], { a: "app" }]);
  });
});
