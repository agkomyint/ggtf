import { describe, expect, test } from "bun:test";
import { appIdFor, callTag, compareInstall, parseSource, sourceToJson, validateManifest, type InstalledSpirit, type Manifest } from "./bundle";
import { SPIRIT_CSP, buildSrcdoc } from "./runtime";

const manifest: Manifest = { name: "Ghost Grid", version: 2, icon: "👻", description: "", peers: 2, permissions: ["peer"] };
const files = { "index.html": "<div id=grid></div>", "app.js": "spirit.log('</script> boo')", "style.css": "body{}" };

describe("manifest", () => {
  test("defaults and normalisation", () => {
    const r = validateManifest({ name: "  Fortune  " });
    expect(r.ok && r.manifest).toEqual({ name: "Fortune", version: 1, icon: "👻", description: "", peers: 0, permissions: [] });
  });

  test("lists every problem", () => {
    const r = validateManifest({ name: "", version: 0, peers: 3, permissions: ["camera"], extra: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(5);
    const p = validateManifest({ name: "x", peers: 2 });
    expect(p.ok).toBe(false);
  });
});

describe("source", () => {
  test("round trip", () => {
    const r = parseSource(sourceToJson({ manifest, files }));
    expect(r.ok && r.source).toEqual({ manifest, files });
  });

  test("rejects junk", () => {
    expect(parseSource("nope").ok).toBe(false);
    expect(parseSource(JSON.stringify({ manifest: { name: "" }, files: {} })).ok).toBe(false);
    expect(parseSource(JSON.stringify({ manifest, files: { "app.js": 5 } })).ok).toBe(false);
  });
});

describe("identity", () => {
  test("app id depends on author and name; tag is 8 bytes", async () => {
    const a = await appIdFor("11".repeat(32), "Ghost Grid");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await appIdFor("11".repeat(32), "Ghost Grid")).toBe(a);
    expect(await appIdFor("22".repeat(32), "Ghost Grid")).not.toBe(a);
    expect(await appIdFor("11".repeat(32), "Spirit Board")).not.toBe(a);
    expect(callTag(a).length).toBe(8);
  });

  test("install verdicts", () => {
    const lib = [{ appId: "aa", hash: "h1", manifest } as InstalledSpirit];
    expect(compareInstall(lib, { appId: "aa", hash: "h1", manifest }).kind).toBe("same");
    expect(compareInstall(lib, { appId: "aa", hash: "h2", manifest: { ...manifest, version: 3 } }).kind).toBe("update");
    expect(compareInstall(lib, { appId: "aa", hash: "h2", manifest: { ...manifest, version: 1 } }).kind).toBe("older");
    expect(compareInstall(lib, { appId: "bb", hash: "h3", manifest }).kind).toBe("other-author");
    expect(compareInstall(lib, { appId: "cc", hash: "h4", manifest: { ...manifest, name: "Other" } }).kind).toBe("new");
  });
});

describe("runtime document", () => {
  test("has the CSP before any script, and escapes closing tags", () => {
    const doc = buildSrcdoc(files, manifest, { device: "d", side: "a", name: "Ghost Grid", version: 2, peers: 2 });
    const csp = doc.indexOf(SPIRIT_CSP);
    expect(csp).toBeGreaterThan(0);
    expect(csp).toBeLessThan(doc.indexOf("<script>"));
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("<\\/script> boo");
    expect(doc).toContain("<div id=grid></div>");
  });
});
