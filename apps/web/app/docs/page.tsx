import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Spirit SDK docs · GGTF" };

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-border bg-[#050a07] p-3 font-mono text-xs leading-relaxed">{children.trim()}</pre>;
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="font-display text-3xl text-primary">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed [&_li]:ml-5 [&_li]:list-disc">{children}</CardContent>
    </Card>
  );
}

const TOC = [
  ["start", "Your first spirit"],
  ["files", "Files and manifest"],
  ["sdk", "The spirit SDK"],
  ["ggtp", "GGTP"],
  ["db", "GhostDB"],
  ["bundle", "Bundles and sharing"],
  ["security", "Security model"],
  ["link", "The link underneath"],
];

export default function DocsPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[14rem_1fr]">
      <nav className="space-y-1 lg:sticky lg:top-20 lg:self-start">
        <p className="font-display text-2xl text-primary glow">Spirit SDK</p>
        {TOC.map(([id, t]) => (
          <a key={id} href={`#${id}`} className="block text-sm text-muted-foreground hover:text-foreground">
            {t}
          </a>
        ))}
        <div className="flex flex-col gap-2 pt-3">
          <Link href="/studio" className={buttonVariants({ size: "sm" })}>
            Open Spirit Studio
          </Link>
          <Link href="/seance" className={buttonVariants({ size: "sm", variant: "outline" })}>
            Open Séance OS
          </Link>
        </div>
      </nav>

      <div className="space-y-6">
        <div>
          <h1 className="font-display text-5xl text-primary glow flicker">Building spirits</h1>
          <p className="text-muted-foreground">
            A spirit is a small web app that travels through sound. You write it in the browser, share it with people nearby, and it runs on their device with no network.
            Two people with the same spirit can connect over sound and use it together. There is no server: either device can answer the other.
          </p>
        </div>

        <Section id="start" title="Your first spirit">
          <ol className="ml-5 list-decimal space-y-1">
            <li className="list-decimal">
              Open <Link href="/studio" className="text-primary underline">Spirit Studio</Link> and pick a template with <b>New</b>.
            </li>
            <li className="list-decimal">Edit the files and press <b>Run</b>. Spirits for two devices run as two previews, A and B, already connected.</li>
            <li className="list-decimal">Switch the connection to <b>Sim air</b> to run the real modem with noise and dropouts, and watch the Network tab.</li>
            <li className="list-decimal">
              Press <b>Publish</b>. The spirit is signed with your author key and added to your <Link href="/seance" className="text-primary underline">Séance OS</Link> library.
            </li>
            <li className="list-decimal">In Séance OS, press <b>Share over sound</b>. Nearby devices on the Receive tab get it, check the signature and ask to install.</li>
            <li className="list-decimal">Both devices open the spirit; one presses <b>Play together</b>, the other accepts and both compare four words.</li>
          </ol>
        </Section>

        <Section id="files" title="Files and manifest">
          <p>A spirit has four files. The runtime adds a dark default stylesheet, so plain HTML already looks right.</p>
          <ul>
            <li>
              <code>spirit.json</code>: the manifest.
            </li>
            <li>
              <code>index.html</code>: the body of the page (no <code>&lt;html&gt;</code> or <code>&lt;head&gt;</code>).
            </li>
            <li>
              <code>app.js</code>: runs after the body. <code>window.spirit</code> is ready.
            </li>
            <li>
              <code>style.css</code>: your styles.
            </li>
          </ul>
          <Code>{`
{
  "name": "Ghost Grid",          // up to 32 characters; with your key, it identifies the spirit
  "version": 1,                  // raise it when you change the code
  "icon": "👻",
  "description": "Tic-tac-toe for two devices.",
  "peers": 2,                    // 0 = alone, 2 = can connect to one other device
  "permissions": ["peer", "db"]  // peer: messages and GGTP; db: GhostDB
}`}</Code>
          <p>Every byte goes through the air at roughly 20–40 bytes per second, so keep spirits small. The Budget tab shows the signed size and how long one sharing round takes.</p>
        </Section>

        <Section id="sdk" title="The spirit SDK">
          <Code>{`
spirit.me                 // { device, side, name, version, peers }
spirit.on("peer:join", p => …)    // p = { device, name, version }
spirit.on("peer:leave", e => …)   // e = { reason }
spirit.log("hello")       // same as console.log; shows in the studio console

// peer messages (needs "peer")
spirit.peer.connected     // true while another device is in the session
await spirit.peer.send("move", { i: 4 })
spirit.peer.on("move", data => …)

// GhostDB (needs "db")
await spirit.db.put("note:1", { text: "boo" })
await spirit.db.get("note:1")
await spirit.db.list("note:")      // [{ key, value }], sorted by key
await spirit.db.del("note:1")
spirit.db.watch("note:", change => …)  // { key, value, deleted, origin: "local" | "peer" }

// GGTP (needs "peer")
spirit.serve("GET", "/search", req => results)    // req = { method, path, query, body }
spirit.serve("GET", "/page/*", req => page || { status: 404 })
const r = await spirit.ggtp.get("/search?q=bat")  // { ok, status: "2.05 Content", code, body }
await spirit.ggtp.post("/notes", { text: "hi" })
const w = await spirit.ggtp.watch("/score", score => …); w.cancel()
spirit.notify("/score", 3)        // tells everyone watching /score`}</Code>
          <p>All calls return promises. Errors (no peer, missing permission, value too big) reject with a readable message.</p>
        </Section>

        <Section id="ggtp" title="GGTP">
          <p>
            Ghost Gibberlink Transfer Protocol is a request/response protocol in the style of CoAP. HTTP headers would cost seconds of airtime, so every GGTP message has a
            5-byte header:
          </p>
          <Code>{`
[0] 0x40 | type   0 REQ  1 RES  2 NOTIFY  3 MSG  4 CANCEL  5 HELLO
[1] code          REQ: 1 GET 2 POST 3 PUT 4 DELETE 5 WATCH
                  RES: status, class.detail (2.05 Content, 4.04 Not Found …)
[2] token         pairs a response with its request
[3] format        0 none  1 text  2 json  3 bytes
[4] path length   then the path, then the body`}</Code>
          <ul>
            <li>Both devices can serve and request at the same time. There is no host.</li>
            <li>A handler&apos;s return value becomes a 2.05 response. Return <code>{"{ status: 404 }"}</code> (or 201, 400, 403…) to choose the status.</li>
            <li>Requests time out after 120 s (5.04). When the link drops, open requests fail with 5.03.</li>
            <li>WATCH runs the GET handler, then every <code>spirit.notify(path)</code> sends a NOTIFY until the watcher cancels.</li>
            <li>Paths starting with <code>/~</code> belong to Séance OS (GhostDB sync uses them).</li>
          </ul>
        </Section>

        <Section id="db" title="GhostDB">
          <ul>
            <li>Each spirit gets its own store on each device. It works offline.</li>
            <li>
              When two devices connect, each pulls only what changed since it last synced with that device, then live writes are pushed as they happen. Changes travel on:
              data written on A reaches C through B.
            </li>
            <li>
              Conflicts: every write carries a Lamport clock and the device id. The higher <code>(clock, device)</code> wins on every device, so both copies end up identical.
            </li>
            <li>Deletes are kept as tombstones so they sync too.</li>
            <li>
              Keys starting with <code>local:</code> never leave the device. Use them for private data the other side should ask for over GGTP (see the Ghost Wiki template).
            </li>
            <li>Limits: keys up to 128 characters, values up to 4,000 bytes of JSON, 2,000 keys per spirit.</li>
          </ul>
        </Section>

        <Section id="bundle" title="Bundles and sharing">
          <Code>{`
0    4 bytes   magic 00 47 53 01
4   32 bytes   author Ed25519 public key
36  64 bytes   signature over "ggtf-spirit-v1" + body
100 …          body: DEFLATE of {"manifest": …, "files": …}`}</Code>
          <ul>
            <li>Your author key is made in this browser the first time you publish and never leaves it. People see it as four words.</li>
            <li>The app id is a hash of your public key and the spirit name. A spirit with the same name from someone else is a different spirit, and the install screen warns about it.</li>
            <li>Anyone can share a spirit they received. Changing a single byte breaks the signature, so the copy C gets from B is exactly what A published.</li>
            <li>Sharing uses Haunted QR beams: the bundle is cut into 196-byte pieces that repeat in rounds, so listeners who miss a piece get it next round.</li>
            <li>Two devices only play together when their bundle hashes match. Raise the version when you change a spirit.</li>
          </ul>
        </Section>

        <Section id="security" title="Security model">
          <ul>
            <li>
              Spirits run in an iframe with <code>sandbox=&quot;allow-scripts allow-forms&quot;</code>: an opaque origin with no access to Séance OS, its storage, cookies or
              other spirits. Forms fire submit events, but the policy below blocks any real form post.
            </li>
            <li>
              A content security policy blocks fetch, XHR, WebSockets, external images and fonts, and form posts. A spirit can&apos;t reach the internet, only the device it is
              playing with.
            </li>
            <li>Every call goes through Séance OS and is checked against the spirit&apos;s permissions.</li>
            <li>The link between devices is encrypted (X25519, ChaCha20-Poly1305). Both people compare four words to rule out someone in the middle.</li>
            <li>
              Known limit: a spirit can still navigate its own frame to a web address. It can only carry what the spirit itself holds, which is its own data.
            </li>
          </ul>
        </Section>

        <Section id="link" title="The link underneath">
          <ul>
            <li>Messages up to 12,000 bytes, tagged as chat (kind 0) or GGTP (kind 1).</li>
            <li>Fragments are sized by the trained speed: 56 bytes on Sturdy, up to 176 on Fast. After a hard-won fragment the size halves; after clean ones it grows back.</li>
            <li>When a reply is ready within 350 ms, the acknowledgement rides inside it, so a request and its response take 3 frames instead of 4.</li>
            <li>Idle links send a keep-alive every 45 s and notice when the other device has gone.</li>
            <li>Play together sends the spirit&apos;s app id inside the call, so the other device knows which spirit you mean before answering.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
