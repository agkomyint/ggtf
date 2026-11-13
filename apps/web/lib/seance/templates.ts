// Starter spirits for the studio. Each is small on purpose: every byte is sent through sound.

import type { SpiritSource } from "./bundle";

export interface Template {
  key: string;
  title: string;
  blurb: string;
  source: SpiritSource;
}

const fortune: SpiritSource = {
  manifest: { name: "Fortune Teller", version: 1, icon: "🔮", description: "Ask the spirits a question. Works alone, offline.", peers: 0, permissions: [] },
  files: {
    "index.html": `<h1>🔮 Fortune Teller</h1>
<p class="muted">Ask a yes-or-no question, then summon an answer.</p>
<input id="q" placeholder="Will my code compile?" style="width:100%">
<p><button id="ask">Summon an answer</button></p>
<h2 id="out"></h2>`,
    "app.js": `const answers = ["It is certain.", "The dead say yes.", "Ask again at midnight.", "The fog is too thick.", "Don't count on it.", "The raven nods.", "Absolutely not.", "Signs point to yes."];
const out = document.getElementById("out");
document.getElementById("ask").onclick = () => {
  const text = answers[Math.floor(Math.random() * answers.length)];
  out.textContent = "";
  [...text].forEach((ch, i) => setTimeout(() => (out.textContent += ch), 60 * i));
};`,
    "style.css": `#out{color:var(--accent2);min-height:2em;letter-spacing:.04em}`,
  },
};

const grid: SpiritSource = {
  manifest: { name: "Ghost Grid", version: 1, icon: "👻", description: "Tic-tac-toe for two devices, played over sound.", peers: 2, permissions: ["peer"] },
  files: {
    "index.html": `<h1>👻 Ghost Grid</h1>
<p id="status" class="muted">Press Play together to find an opponent.</p>
<div id="board"></div>
<p><button id="again" class="ghost">New game</button></p>`,
    "app.js": `const board = document.getElementById("board"), status = document.getElementById("status");
let cells = Array(9).fill(""), mine = "", turn = "👻";
const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const winner = () => lines.map(l => l.map(i => cells[i])).find(([a,b,c]) => a && a === b && b === c)?.[0];
function draw() {
  board.innerHTML = "";
  cells.forEach((c, i) => {
    const b = document.createElement("button");
    b.textContent = c || "·";
    b.disabled = !!c || !!winner() || turn !== mine || !spirit.peer.connected;
    b.onclick = () => play(i, mine, true);
    board.append(b);
  });
  const w = winner();
  status.textContent = !spirit.peer.connected ? "Waiting for the other device…"
    : w ? (w === mine ? "You win!" : "The other side wins.")
    : cells.every(Boolean) ? "A draw. The spirits are bored."
    : turn === mine ? "Your move (" + mine + ")" : "Their move…";
}
function play(i, who, send) {
  if (cells[i] || who !== turn) return;
  cells[i] = who;
  turn = who === "👻" ? "🎃" : "👻";
  if (send) spirit.peer.send("move", { i });
  draw();
}
function reset(send) { cells = Array(9).fill(""); turn = "👻"; if (send) spirit.peer.send("reset"); draw(); }
spirit.peer.on("move", m => play(m.i, mine === "👻" ? "🎃" : "👻", false));
spirit.peer.on("reset", () => reset(false));
spirit.on("peer:join", p => { mine = spirit.me.device < p.device ? "👻" : "🎃"; reset(false); });
spirit.on("peer:leave", draw);
document.getElementById("again").onclick = () => reset(true);
draw();`,
    "style.css": `#board{display:grid;grid-template-columns:repeat(3,64px);gap:6px}
#board button{height:64px;font-size:30px;background:#0f2419;color:var(--fg);border:1px solid var(--line)}
#board button:not(:disabled):hover{border-color:var(--accent)}`,
  },
};

const board: SpiritSource = {
  manifest: { name: "Spirit Board", version: 1, icon: "🪧", description: "Shared notes. Write offline; they sync when two devices connect.", peers: 2, permissions: ["peer", "db"] },
  files: {
    "index.html": `<h1>🪧 Spirit Board</h1>
<form id="f"><input id="t" maxlength="140" placeholder="Leave a note for the other side" style="width:70%"> <button>Pin</button></form>
<p id="who" class="muted"></p>
<ul id="notes"></ul>`,
    "app.js": `const list = document.getElementById("notes");
async function render() {
  const notes = await spirit.db.list("note:");
  list.innerHTML = "";
  notes.reverse().forEach(({ key, value }) => {
    const li = document.createElement("li");
    li.textContent = value.text + " ";
    const x = document.createElement("button");
    x.className = "ghost"; x.textContent = "✕";
    x.onclick = () => spirit.db.del(key);
    li.append(x);
    list.append(li);
  });
  document.getElementById("who").textContent = spirit.peer.connected ? "Synced with the other device." : "Offline. Notes sync when you Play together.";
}
document.getElementById("f").onsubmit = async (e) => {
  e.preventDefault();
  const t = document.getElementById("t");
  if (!t.value.trim()) return;
  await spirit.db.put("note:" + Date.now() + "-" + spirit.me.device, { text: t.value.trim() });
  t.value = "";
};
spirit.db.watch("note:", render);
spirit.on("peer:join", render);
spirit.on("peer:leave", render);
render();`,
    "style.css": `ul{padding:0;list-style:none}li{background:#0f2419;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;display:flex;justify-content:space-between;gap:8px;align-items:center}`,
  },
};

const wiki: SpiritSource = {
  manifest: { name: "Ghost Wiki", version: 1, icon: "📖", description: "Your own pages, plus search across the other device's wiki over GGTP.", peers: 2, permissions: ["peer", "db"] },
  files: {
    "index.html": `<h1>📖 Ghost Wiki</h1>
<form id="s"><input id="q" placeholder="Search…"> <button>Search mine</button> <button type="button" id="ask" class="ghost">Ask the other device</button></form>
<ul id="hits"></ul>
<article id="page"></article>
<details><summary>Write a page</summary>
<form id="w"><input id="title" placeholder="Title" required><br><textarea id="body" rows="4" style="width:100%" placeholder="What do you know?"></textarea><br><button>Save</button></form></details>`,
    "app.js": `// Pages live under "local:" so they stay on this device; the other device asks for them over GGTP.
const slug = t => t.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
const $ = id => document.getElementById(id);
async function pages() { return (await spirit.db.list("local:page:")).map(e => e.value); }
async function search(q) { q = q.toLowerCase(); return (await pages()).filter(p => (p.title + " " + p.body).toLowerCase().includes(q)).map(p => ({ title: p.title, slug: slug(p.title) })); }
function show(p, theirs) {
  $("page").innerHTML = "";
  const h = document.createElement("h2"); h.textContent = p.title;
  const b = document.createElement("p"); b.textContent = p.body;
  $("page").append(h, b);
  if (theirs) { const c = document.createElement("button"); c.textContent = "Copy to my wiki"; c.onclick = () => save(p); $("page").append(c); }
}
function hits(list, theirs) {
  $("hits").innerHTML = list.length ? "" : "<li class=muted>Nothing found.</li>";
  list.forEach(h => {
    const li = document.createElement("li"), a = document.createElement("a");
    a.href = "#"; a.textContent = h.title + (theirs ? " (theirs)" : "");
    a.onclick = async e => {
      e.preventDefault();
      if (!theirs) return show((await pages()).find(p => slug(p.title) === h.slug));
      const r = await spirit.ggtp.get("/page/" + h.slug);
      r.ok ? show(r.body, true) : spirit.log("page fetch failed: " + r.status);
    };
    li.append(a); $("hits").append(li);
  });
}
const save = p => spirit.db.put("local:page:" + slug(p.title), { title: p.title, body: p.body });
spirit.serve("GET", "/search", async req => search(req.query.q || ""));
spirit.serve("GET", "/page/*", async req => (await pages()).find(p => slug(p.title) === req.path.slice(6)) || { status: 404 });
$("s").onsubmit = async e => { e.preventDefault(); hits(await search($("q").value), false); };
$("ask").onclick = async () => {
  if (!spirit.peer.connected) return spirit.log("Play together first, then ask.");
  $("hits").innerHTML = "<li class=muted>Asking through the air…</li>";
  const r = await spirit.ggtp.get("/search?q=" + encodeURIComponent($("q").value));
  r.ok ? hits(r.body, true) : ($("hits").innerHTML = "<li class=muted>" + r.status + "</li>");
};
$("w").onsubmit = async e => { e.preventDefault(); await save({ title: $("title").value, body: $("body").value }); e.target.reset(); };
(async () => { if (!(await pages()).length) await save({ title: "Banshee", body: "A wailing spirit. Also the name of GGTF's fast modem profile." }); })();`,
    "style.css": `#hits{padding-left:18px}article{border-left:3px solid var(--accent2);padding-left:10px;margin:10px 0}details{margin-top:12px}`,
  },
};

export const TEMPLATES: Template[] = [
  { key: "fortune", title: "Fortune Teller", blurb: "Offline toy. No permissions.", source: fortune },
  { key: "grid", title: "Ghost Grid", blurb: "Two-player game with peer messages.", source: grid },
  { key: "board", title: "Spirit Board", blurb: "Shared notes with GhostDB sync.", source: board },
  { key: "wiki", title: "Ghost Wiki", blurb: "Serve and fetch pages over GGTP.", source: wiki },
];
