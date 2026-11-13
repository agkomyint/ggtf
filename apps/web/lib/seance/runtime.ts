// Builds the sandboxed document a spirit runs in, including the `window.spirit` SDK.
// The iframe gets `sandbox="allow-scripts"` (an opaque origin) and this CSP, so a spirit can't
// read the OS's storage or reach the network. It talks to the OS only through postMessage.

import type { Manifest, SpiritFiles } from "./bundle";

export const SPIRIT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

export interface SpiritMe {
  device: string;
  /** "a" or "b" in the studio's two-peer preview; "me" on a real device. */
  side: string;
  name: string;
  version: number;
  peers: number;
}

/** Default look so a spirit is readable without any CSS. Not part of the bundle. */
const BASE_CSS = `
:root{color-scheme:dark;--bg:#07120c;--fg:#d9f7e5;--muted:#7fa891;--accent:#4ade80;--accent2:#c084fc;--line:#1f3a2b}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:15px/1.45 ui-sans-serif,system-ui,sans-serif;padding:14px}
button{font:inherit;color:var(--bg);background:var(--accent);border:0;border-radius:8px;padding:6px 12px;cursor:pointer}
button:disabled{opacity:.45;cursor:default}button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
input,textarea,select{font:inherit;color:var(--fg);background:#0b1a12;border:1px solid var(--line);border-radius:8px;padding:6px 8px}
h1,h2,h3{margin:.2em 0 .4em;font-weight:600}a{color:var(--accent)}.muted{color:var(--muted)}
`;

/** Runs inside the iframe. Kept dependency-free and small. */
const SDK = String.raw`
(function () {
  var ME = __ME__;
  var seq = 0, pending = {}, handlers = {}, topics = {}, served = {}, watches = {}, dbw = [], progress = {};
  function post(m) { parent.postMessage(m, "*"); }
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      post({ t: "call", id: id, fn: fn, args: args });
    });
  }
  function emit(name, data) {
    (handlers[name] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } });
  }
  function on(map, key, fn) {
    (map[key] = map[key] || []).push(fn);
    return function () { map[key] = (map[key] || []).filter(function (f) { return f !== fn; }); };
  }
  function fmt(a) {
    if (typeof a === "string") return a;
    if (a instanceof Error) return a.message;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }
  ["log", "info", "warn", "error"].forEach(function (level) {
    var orig = console[level].bind(console);
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      post({ t: "log", level: level, text: args.map(fmt).join(" ") });
      orig.apply(null, args);
    };
  });
  window.addEventListener("error", function (e) { post({ t: "log", level: "error", text: (e.message || "error") + (e.lineno ? " (line " + e.lineno + ")" : "") }); });
  window.addEventListener("unhandledrejection", function (e) { post({ t: "log", level: "error", text: "unhandled: " + fmt(e.reason) }); });
  window.addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var m = e.data || {};
    if (m.t === "ret") {
      var p = pending[m.id]; if (!p) return; delete pending[m.id];
      m.ok ? p.resolve(m.value) : p.reject(new Error(m.error));
    } else if (m.t === "evt") {
      if (m.name === "peer:msg") (topics[m.data.topic] || []).slice().forEach(function (fn) { try { fn(m.data.body); } catch (err) { console.error(err); } });
      else if (m.name === "db:change") dbw.forEach(function (w) { if (m.data.key.indexOf(w.p) === 0) { try { w.fn(m.data); } catch (err) { console.error(err); } } });
      else if (m.name === "ggtp:notify") { var w = watches[m.data.wid]; if (w) { try { w(m.data.body); } catch (err) { console.error(err); } } }
      else if (m.name === "peer:progress") { var pf = progress[m.data.pid]; if (pf) { try { pf(m.data.sent, m.data.total); } catch (err) { console.error(err); } } }
      else {
        if (m.name === "peer:join") { spirit.peer.connected = true; spirit.peer.info = m.data; }
        if (m.name === "peer:leave") { spirit.peer.connected = false; spirit.peer.info = null; }
        emit(m.name, m.data);
      }
    } else if (m.t === "serve") {
      var fn = served[m.key];
      Promise.resolve().then(function () { if (!fn) throw new Error("no handler"); return fn(m.req); })
        .then(function (v) { post({ t: "served", id: m.id, ok: true, value: v === undefined ? null : v }); },
              function (err) { post({ t: "served", id: m.id, ok: false, error: fmt(err) }); });
    }
  });
  var spirit = {
    me: ME,
    on: function (name, fn) { return on(handlers, name, fn); },
    log: function () { console.log.apply(console, arguments); },
    peer: {
      connected: false,
      info: null,
      send: function (topic, data, opts) {
        var fn = opts && opts.onProgress, pid = null;
        if (fn) { pid = "p" + (++seq); progress[pid] = fn; }
        var p = call("peer.send", topic, data === undefined ? null : data, pid);
        if (pid) p.then(function () { delete progress[pid]; }, function () { delete progress[pid]; });
        return p;
      },
      on: function (topic, fn) { return on(topics, topic, fn); }
    },
    db: {
      get: function (k) { return call("db.get", k); },
      put: function (k, v) { return call("db.put", k, v); },
      del: function (k) { return call("db.del", k); },
      list: function (prefix) { return call("db.list", prefix || ""); },
      watch: function (prefix, fn) { var w = { p: prefix || "", fn: fn }; dbw.push(w); return function () { dbw = dbw.filter(function (x) { return x !== w; }); }; }
    },
    ggtp: {
      get: function (path, opts) { return call("ggtp.request", "GET", path, null, opts || {}); },
      post: function (path, body, opts) { return call("ggtp.request", "POST", path, body === undefined ? null : body, opts || {}); },
      put: function (path, body, opts) { return call("ggtp.request", "PUT", path, body === undefined ? null : body, opts || {}); },
      del: function (path, opts) { return call("ggtp.request", "DELETE", path, null, opts || {}); },
      watch: function (path, fn) {
        return call("ggtp.watch", path).then(function (r) {
          if (r.wid) watches[r.wid] = fn;
          return { status: r.status, ok: r.ok, body: r.body, cancel: function () { delete watches[r.wid]; return call("ggtp.unwatch", r.wid); } };
        });
      }
    },
    serve: function (method, path, fn) {
      var key = String(method).toUpperCase() + " " + path;
      served[key] = fn;
      return call("serve", String(method).toUpperCase(), path);
    },
    notify: function (path, body) { return call("notify", path, body === undefined ? null : body); }
  };
  window.spirit = spirit;
  post({ t: "hello" });
})();
`;

const escapeScript = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1");
const escapeStyle = (s: string) => s.replace(/<\/(style)/gi, "<\\/$1");

/** The full srcdoc for a spirit. */
export function buildSrcdoc(files: SpiritFiles, manifest: Manifest, me: SpiritMe): string {
  const meJson = JSON.stringify(me).replace(/</g, "\\u003c");
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    `<meta http-equiv="Content-Security-Policy" content="${SPIRIT_CSP}">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${manifest.name.replace(/[<>&"]/g, "")}</title>`,
    `<style>${BASE_CSS}</style>`,
    `<style>${escapeStyle(files["style.css"])}</style>`,
    `<script>${SDK.replace("__ME__", () => meJson)}</script>`,
    "</head><body>",
    files["index.html"],
    `<script>${escapeScript(files["app.js"])}\n</script>`,
    "</body></html>",
  ].join("\n");
}
