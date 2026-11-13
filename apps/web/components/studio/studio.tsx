"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeftRight, BookOpen, FilePlus2, Link2, Link2Off, Play, RotateCcw, Square, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SpiritFrame } from "@/components/seance/spirit-frame";
import type { EditorFile } from "@/components/studio/code-editor";
import { BEAM_PROFILES, CHUNK_LARGE, beamRoundSeconds } from "@/lib/ggtf/beam";
import { FILE_NAMES, sourceToJson, validateManifest, type SpiritSource } from "@/lib/seance/bundle";
import type { HostLog } from "@/lib/seance/host";
import { install, library, pack, toInstalled, type Packed } from "@/lib/seance/library";
import { SpiritRun } from "@/lib/seance/run";
import type { SessionState } from "@/lib/seance/session";
import { SimAir, type AirLine, type AirStatus } from "@/lib/seance/sim-air";
import { dbStates, persister, projects, type Project } from "@/lib/seance/store";
import { TEMPLATES } from "@/lib/seance/templates";
import { traceRow, type TraceRow } from "@/lib/seance/trace";
import { instantPair } from "@/lib/seance/transport";

const CodeEditor = dynamic(() => import("@/components/studio/code-editor").then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <div className="h-full rounded-lg border border-border bg-[#050a07]" />,
});

const EDITOR_FILES: EditorFile[] = ["spirit.json", "index.html", "app.js", "style.css"];
const SIDE_LABEL = ["A", "B"];
const SPEEDS = [
  { v: 1, label: "1×" },
  { v: 4, label: "4×" },
  { v: 0, label: "max" },
];
const BANDS = [
  { v: 0, label: "Low", hint: "0.5–4.1 kHz" },
  { v: 1, label: "Mid", hint: "1.5–5.1 kHz" },
  { v: 2, label: "High", hint: "14.5–18.1 kHz" },
];

interface Line {
  key: number;
  side: number;
  level: HostLog["level"];
  text: string;
  at: number;
}
interface NetRow extends TraceRow {
  key: number;
  side: number;
  t: number;
}
interface Running {
  runs: SpiritRun[];
  two: boolean;
  transport: "instant" | "air";
  pair: ReturnType<typeof instantPair> | null;
  air: SimAir | null;
  t0: number;
}

function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), (x) => x.toString(16).padStart(2, "0")).join("");
}

function projectFrom(source: SpiritSource): Project {
  return { id: newId(), manifestText: JSON.stringify(source.manifest, null, 2), files: { ...source.files }, updatedAt: Date.now() };
}

function parseDraft(p: Project): { ok: true; source: SpiritSource } | { ok: false; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(p.manifestText);
  } catch (e) {
    return { ok: false, errors: [`spirit.json is not valid JSON: ${e instanceof Error ? e.message : e}`] };
  }
  const m = validateManifest(raw);
  if (!m.ok) return { ok: false, errors: m.errors.map((x) => `spirit.json: ${x}`) };
  return { ok: true, source: { manifest: m.manifest, files: p.files } };
}

const fmtS = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const LEVEL_TONE: Record<HostLog["level"], string> = { log: "text-foreground", info: "text-foreground", warn: "text-amber-300", error: "text-destructive", os: "text-primary" };

export function Studio() {
  const [list, setList] = useState<Project[]>([]);
  const [draft, setDraft] = useState<Project | null>(null);
  const [file, setFile] = useState<EditorFile>("app.js");
  const [newOpen, setNewOpen] = useState(false);
  const [transport, setTransport] = useState<"instant" | "air">("instant");
  const [noise, setNoise] = useState(0.02);
  const [loss, setLoss] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [band, setBand] = useState(1);
  const restartForBand = useRef(false);
  const [running, setRunning] = useState<Running | null>(null);
  const [states, setStates] = useState<{ state: SessionState; detail?: string }[]>([{ state: "offline" }, { state: "offline" }]);
  const [lines, setLines] = useState<Line[]>([]);
  const [net, setNet] = useState<NetRow[]>([]);
  const [air, setAir] = useState<AirLine[]>([]);
  const [airStatus, setAirStatus] = useState<AirStatus | null>(null);
  const [showFrames, setShowFrames] = useState(false);
  const [dbTick, setDbTick] = useState(0);
  const [panel, setPanel] = useState("console");
  const [mobile, setMobile] = useState<"code" | "run" | "panels">("code");
  const [budget, setBudget] = useState<{ source: number; bytes: number } | null>(null);
  const [ask, setAsk] = useState<{ packed: Packed; current: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(0);
  const runningRef = useRef<Running | null>(null);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  // ---------- projects ----------
  useEffect(() => {
    projects.all().then(async (ps) => {
      if (ps.length === 0) {
        const p = projectFrom(TEMPLATES[1].source);
        await projects.put(p);
        ps = [p];
      }
      ps.sort((a, b) => b.updatedAt - a.updatedAt);
      setList(ps);
      setDraft(ps[0]);
    });
  }, []);

  useEffect(() => {
    if (!draft) return;
    const t = setTimeout(() => {
      void projects.put(draft);
      setList((l) => l.map((p) => (p.id === draft.id ? draft : p)));
    }, 500);
    return () => clearTimeout(t);
  }, [draft]);

  const parsed = useMemo(() => (draft ? parseDraft(draft) : null), [draft]);
  const manifest = parsed?.ok ? parsed.source.manifest : null;

  const edit = useCallback(
    (f: EditorFile, v: string) => setDraft((d) => (d ? { ...d, updatedAt: Date.now(), ...(f === "spirit.json" ? { manifestText: v } : { files: { ...d.files, [f]: v } }) } : d)),
    [],
  );

  const createFrom = async (source: SpiritSource) => {
    const p = projectFrom(source);
    await projects.put(p);
    setList((l) => [p, ...l]);
    stop();
    setDraft(p);
    setNewOpen(false);
    setFile("app.js");
  };

  const deleteProject = async () => {
    if (!draft || list.length <= 1) return;
    await projects.del(draft.id);
    await dbStates.del(`studio:${draft.id}:a`);
    await dbStates.del(`studio:${draft.id}:b`);
    stop();
    const rest = list.filter((p) => p.id !== draft.id);
    setList(rest);
    setDraft(rest[0]);
  };

  // ---------- running ----------
  const stop = useCallback(() => {
    const r = runningRef.current;
    if (!r) return;
    r.air?.stop();
    r.runs.forEach((x) => x.dispose());
    setRunning(null);
    setStates([{ state: "offline" }, { state: "offline" }]);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const measure = useCallback(async (source: SpiritSource) => {
    const r = await pack(source);
    if (r.ok) setBudget({ source: new TextEncoder().encode(sourceToJson(source)).length, bytes: r.packed.bytes.length });
    return r;
  }, []);

  const run = async () => {
    if (!draft || !parsed) return;
    if (!parsed.ok) {
      toast.error("Fix spirit.json first", { description: parsed.errors[0] });
      return;
    }
    stop();
    const { manifest: m, files } = parsed.source;
    const two = m.peers === 2;
    const t0 = performance.now();
    setLines([]);
    setNet([]);
    setAir([]);
    setAirStatus(null);
    const sides = two ? [0, 1] : [0];
    const now = () => (runningRef.current?.air ? runningRef.current.air.now : performance.now() - t0);
    const runs = await Promise.all(
      sides.map(async (side) => {
        const dbKey = `studio:${draft.id}:${side ? "b" : "a"}`;
        const r = new SpiritRun({
          manifest: m,
          files,
          identity: { appId: `studio-${draft.id}`, hash: "studio", version: m.version, name: m.name },
          me: { device: `studio-${side ? "b" : "a"}`, side: side ? "b" : "a", name: m.name, version: m.version, peers: m.peers },
          dbState: await dbStates.get(dbKey),
          persist: persister(dbKey),
          onLog: (l) => setLines((xs) => [...xs, { key: key.current++, side, ...l }].slice(-300)),
          onTrace: (t) => setNet((xs) => [...xs, { ...traceRow(t), key: key.current++, side, t: now() }].slice(-300)),
          events: { state: (state, detail) => setStates((s) => s.map((x, i) => (i === side ? { state, detail } : x))) },
        });
        r.db.watch("", () => setDbTick((x) => x + 1));
        return r;
      }),
    );
    let pair: Running["pair"] = null;
    let simAir: SimAir | null = null;
    if (two && transport === "instant") {
      pair = instantPair();
      runs[0].session.attach(pair.a);
      runs[1].session.attach(pair.b);
      setTimeout(() => pair!.connect(), 300);
    } else if (two) {
      simAir = new SimAir();
      simAir.onLine = (l) => setAir((xs) => [...xs, l].slice(-400));
      simAir.onStatus = setAirStatus;
      runs[0].session.attach(simAir.a);
      runs[1].session.attach(simAir.b);
      simAir.start({ noise, loss, speed, band });
    }
    setRunning({ runs, two, transport, pair, air: simAir, t0 });
    setMobile("run");
    void measure(parsed.source);
  };

  useEffect(() => {
    running?.air?.config({ noise, loss, speed });
  }, [noise, loss, speed, running]);

  // A new band needs a new call: restart the sim-air run on it.
  useEffect(() => {
    if (!restartForBand.current) return;
    restartForBand.current = false;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band]);

  const pickBand = (b: number) => {
    if (b === band) return;
    restartForBand.current = runningRef.current?.transport === "air";
    setBand(b);
  };

  const wipe = async () => {
    if (!draft) return;
    await dbStates.del(`studio:${draft.id}:a`);
    await dbStates.del(`studio:${draft.id}:b`);
    running?.runs.forEach((r) => r.db.clear());
    toast("Both GhostDB copies wiped");
  };

  // ---------- publishing ----------
  const publish = async (bumpTo?: number) => {
    if (!draft || !parsed?.ok) return;
    setBusy(true);
    try {
      let source = parsed.source;
      if (bumpTo) {
        source = { ...source, manifest: { ...source.manifest, version: bumpTo } };
        const text = JSON.stringify({ ...JSON.parse(draft.manifestText), version: bumpTo }, null, 2);
        setDraft({ ...draft, manifestText: text, updatedAt: Date.now() });
      }
      const r = await measure(source);
      if (!r.ok) {
        toast.error("Couldn't pack the spirit", { description: r.error });
        return;
      }
      const existing = (await library()).find((s) => s.appId === r.packed.opened.appId);
      if (!bumpTo && existing && existing.hash !== r.packed.opened.hash && existing.manifest.version >= source.manifest.version) {
        setAsk({ packed: r.packed, current: existing.manifest.version });
        return;
      }
      await install(toInstalled(r.packed, null, "studio"));
      setAsk(null);
      toast.success(`${source.manifest.name} v${source.manifest.version} is in your Séance OS library`, {
        description: `${r.packed.bytes.length.toLocaleString()} bytes, signed by ${r.packed.opened.words.join(" · ")}`,
        action: { label: "Open Séance OS", onClick: () => window.open("/seance", "_self") },
      });
    } finally {
      setBusy(false);
    }
  };

  const publishAnyway = async () => {
    if (!ask) return;
    await install(toInstalled(ask.packed, null, "studio"));
    setAsk(null);
    toast.success("Published without a new version", { description: "Devices with the old copy can't play with this one until they get it." });
  };

  if (!draft) return <div className="mx-auto max-w-6xl px-4 py-8 text-muted-foreground">Opening the studio…</div>;

  const value = file === "spirit.json" ? draft.manifestText : draft.files[file as (typeof FILE_NAMES)[number]];
  const two = running?.two ?? manifest?.peers === 2;
  const linkUp = states.slice(0, running?.runs.length ?? 1).every((s) => s.state === "ready");
  const visible = (k: typeof mobile) => (mobile === k ? "flex" : "hidden lg:flex");
  const records = running?.runs.map((r) => r.db.records()) ?? [];
  void dbTick;

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 font-display text-4xl text-primary glow">Spirit Studio</h1>
        <select
          aria-label="Project"
          className="h-8 max-w-56 rounded-md border border-border bg-background px-2 text-sm"
          value={draft.id}
          onChange={(e) => {
            stop();
            setDraft(list.find((p) => p.id === e.target.value) ?? draft);
          }}
        >
          {list.map((p) => {
            let name = "untitled";
            try {
              name = JSON.parse(p.manifestText).name || name;
            } catch {}
            return (
              <option key={p.id} value={p.id}>
                {name}
              </option>
            );
          })}
        </select>
        <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
          <FilePlus2 /> New
        </Button>
        <Button size="sm" variant="ghost" onClick={deleteProject} disabled={list.length <= 1} aria-label="Delete project">
          <Trash2 />
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {running ? (
            <Button size="sm" variant="destructive" onClick={stop}>
              <Square /> Stop
            </Button>
          ) : null}
          <Button size="sm" onClick={run} disabled={!parsed?.ok}>
            {running ? <RotateCcw /> : <Play />} {running ? "Restart" : "Run"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => publish()} disabled={!parsed?.ok || busy}>
            <Upload /> Publish
          </Button>
          <Link href="/docs" className={buttonVariants({ size: "sm", variant: "ghost" })}>
            <BookOpen /> Docs
          </Link>
        </div>
      </div>

      {manifest?.peers === 2 && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Two peers over</span>
          <div className="flex gap-1">
            {(["instant", "air"] as const).map((t) => (
              <Button key={t} size="xs" variant={transport === t ? "default" : "outline"} onClick={() => setTransport(t)}>
                {t === "instant" ? "Instant" : "Sim air (real modem)"}
              </Button>
            ))}
          </div>
          {transport === "air" && (
            <>
              <div className="flex w-40 items-center gap-2">
                <Label className="shrink-0 text-xs text-muted-foreground">noise</Label>
                <Slider value={[noise]} min={0} max={0.15} step={0.005} onValueChange={(v) => setNoise(Array.isArray(v) ? v[0] : v)} />
                <span className="w-10 font-mono text-xs">{noise.toFixed(3)}</span>
              </div>
              <div className="flex w-40 items-center gap-2">
                <Label className="shrink-0 text-xs text-muted-foreground">dropouts</Label>
                <Slider value={[loss]} min={0} max={0.05} step={0.002} onValueChange={(v) => setLoss(Array.isArray(v) ? v[0] : v)} />
                <span className="w-10 font-mono text-xs">{(loss * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">band</span>
                {BANDS.map((b) => (
                  <Button key={b.v} size="xs" variant={band === b.v ? "secondary" : "ghost"} onClick={() => pickBand(b.v)} title={b.hint}>
                    {b.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">speed</span>
                {SPEEDS.map((s) => (
                  <Button key={s.v} size="xs" variant={speed === s.v ? "secondary" : "ghost"} onClick={() => setSpeed(s.v)}>
                    {s.label}
                  </Button>
                ))}
              </div>
            </>
          )}
          {running?.two && (
            <div className="ml-auto flex items-center gap-2">
              {running.air && airStatus && (
                <span className="font-mono text-xs text-muted-foreground">
                  sim {(airStatus.now / 1000).toFixed(1)} s
                  {airStatus.links ? ` · ${airStatus.links[0].state} · ${airStatus.links[0].band ?? ""} band · ${airStatus.links[0].profile} · ${airStatus.links[0].frag} B` : ""}
                </span>
              )}
              {linkUp ? (
                <Button size="xs" variant="outline" onClick={() => (running.pair ? running.pair.disconnect("B walked away") : running.air?.hangup())}>
                  <Link2Off /> Disconnect
                </Button>
              ) : (
                <Button size="xs" variant="outline" onClick={() => (running.pair ? running.pair.connect() : running.air?.reconnect())}>
                  <Link2 /> Connect
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1 lg:hidden">
        {(["code", "run", "panels"] as const).map((k) => (
          <Button key={k} size="sm" className="flex-1" variant={mobile === k ? "default" : "outline"} onClick={() => setMobile(k)}>
            {k === "code" ? "Code" : k === "run" ? "Preview" : "Panels"}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${visible("code")} h-[62vh] flex-col gap-2`}>
          <div className="flex gap-1 overflow-x-auto">
            {EDITOR_FILES.map((f) => (
              <Button key={f} size="xs" variant={file === f ? "secondary" : "ghost"} className="font-mono" onClick={() => setFile(f)}>
                {f}
              </Button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor key={`${draft.id}:${file}`} file={file} value={value} onChange={(v) => edit(file, v)} />
          </div>
          {parsed && !parsed.ok && (
            <p className="text-xs text-destructive">{parsed.errors.join(" · ")}</p>
          )}
        </div>

        <div className={`${visible("run")} h-[62vh] flex-col gap-2`}>
          {!running ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center">
              <p className="text-5xl">{manifest?.icon ?? "👻"}</p>
              <p className="text-muted-foreground">
                {two ? "Run starts two copies, A and B, connected to each other." : "Run starts your spirit here."}
              </p>
              <Button onClick={run} disabled={!parsed?.ok}>
                <Play /> Run
              </Button>
            </div>
          ) : (
            <div className={`grid h-full min-h-0 gap-2 ${running.two ? "grid-rows-2 sm:grid-cols-2 sm:grid-rows-1" : ""}`}>
              {running.runs.map((r, i) => (
                <div key={i} className="flex min-h-0 flex-col gap-1">
                  {running.two && (
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="font-mono">
                        device {SIDE_LABEL[i]}
                      </Badge>
                      <Badge variant={states[i].state === "ready" ? "default" : states[i].state === "mismatch" ? "destructive" : "secondary"}>{states[i].state}</Badge>
                      {i === 0 && <ArrowLeftRight className="ml-auto size-3 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="min-h-0 flex-1">
                    <SpiritFrame run={r} title={`${manifest?.name ?? "spirit"} ${SIDE_LABEL[i]}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`${visible("panels")} flex-col`}>
        <Tabs value={panel} onValueChange={(v) => setPanel(String(v))} className="w-full">
          <TabsList>
            <TabsTrigger value="console">Console {lines.some((l) => l.level === "error") && <span className="ml-1 size-2 rounded-full bg-destructive" />}</TabsTrigger>
            <TabsTrigger value="network">Network ({net.length})</TabsTrigger>
            <TabsTrigger value="db">GhostDB</TabsTrigger>
            <TabsTrigger value="budget">Budget</TabsTrigger>
          </TabsList>
          <TabsContent value="console">
            <div className="h-56 overflow-y-auto rounded-lg border border-border bg-[#050a07] p-2 font-mono text-xs">
              {lines.length === 0 ? (
                <p className="text-muted-foreground">console.log and errors from the spirit show up here.</p>
              ) : (
                lines.map((l) => (
                  <div key={l.key} className={LEVEL_TONE[l.level]}>
                    {running?.two && <span className="text-muted-foreground">[{SIDE_LABEL[l.side]}] </span>}
                    {l.level === "os" && <span className="text-muted-foreground">os: </span>}
                    {l.text}
                  </div>
                ))
              )}
            </div>
          </TabsContent>
          <TabsContent value="network">
            <div className="mb-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span>Every GGTP message between A and B, with its size. Time is {running?.air ? "simulated air time" : "real time"}.</span>
              {running?.air && (
                <label className="ml-auto flex items-center gap-1">
                  <input type="checkbox" checked={showFrames} onChange={(e) => setShowFrames(e.target.checked)} /> show radio frames
                </label>
              )}
            </div>
            <div className="h-56 overflow-y-auto rounded-lg border border-border bg-[#050a07] p-2 font-mono text-xs">
              {net.length === 0 && !showFrames ? (
                <p className="text-muted-foreground">{running?.two ? "No messages yet." : "This spirit doesn't use the network."}</p>
              ) : (
                (showFrames
                  ? [...net.map((n) => ({ t: n.t, k: `n${n.key}`, n })), ...air.map((a, i) => ({ t: a.at, k: `a${i}`, a }))].sort((x, y) => x.t - y.t)
                  : net.filter((n) => n.dir === "out").map((n) => ({ t: n.t, k: `n${n.key}`, n }))
                ).map((row) =>
                  "n" in row && row.n ? (
                    <div key={row.k} className={`grid grid-cols-[4.5rem_3rem_4.5rem_1fr_3.5rem] gap-2 ${row.n.os ? "text-muted-foreground" : ""}`}>
                      <span>{(row.t / 1000).toFixed(2)}s</span>
                      <span>{row.n.dir === "out" ? `${SIDE_LABEL[row.n.side]}→${SIDE_LABEL[1 - row.n.side]}` : `${SIDE_LABEL[row.n.side]}←`}</span>
                      <span className="text-primary">{row.n.type}</span>
                      <span className="truncate" title={row.n.preview}>
                        {row.n.summary} <span className="text-muted-foreground">{row.n.preview}</span>
                      </span>
                      <span className="text-right">{row.n.bytes} B</span>
                    </div>
                  ) : "a" in row && row.a ? (
                    <div key={row.k} className="grid grid-cols-[4.5rem_3rem_1fr] gap-2 text-muted-foreground/80">
                      <span>{(row.t / 1000).toFixed(2)}s</span>
                      <span>{SIDE_LABEL[row.a.side]} 📻</span>
                      <span className={row.a.tone === "warn" ? "text-amber-300" : ""}>{row.a.text}</span>
                    </div>
                  ) : null,
                )
              )}
            </div>
          </TabsContent>
          <TabsContent value="db">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Each device has its own copy. Keys starting with local: never leave the device. Deleted keys stay as tombstones so deletes sync.</span>
              <Button size="xs" variant="outline" onClick={wipe}>
                <Trash2 /> Wipe both
              </Button>
            </div>
            <div className={`grid gap-2 ${records.length > 1 ? "md:grid-cols-2" : ""}`}>
              {(records.length ? records : [[]]).map((recs, i) => (
                <div key={i} className="h-52 overflow-y-auto rounded-lg border border-border bg-[#050a07] p-2 font-mono text-xs">
                  <p className="mb-1 text-muted-foreground">
                    device {SIDE_LABEL[i]} · {recs.filter((r) => !r.x).length} keys
                  </p>
                  {recs.map((r) => (
                    <div key={r.k} className={`grid grid-cols-[1fr_1.4fr_5rem] gap-2 ${r.x ? "text-muted-foreground line-through" : ""}`}>
                      <span className="truncate" title={r.k}>
                        {r.k}
                      </span>
                      <span className="truncate" title={JSON.stringify(r.v)}>
                        {JSON.stringify(r.v)}
                      </span>
                      <span className="text-right text-muted-foreground">
                        c{r.c}@{r.d.replace("studio-", "")}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="budget">
            <div className="grid gap-4 rounded-lg border border-border p-3 text-sm md:grid-cols-2">
              <div className="space-y-1">
                <p>
                  Source <span className="font-mono">{budget ? budget.source.toLocaleString() : "—"} B</span> → signed bundle{" "}
                  <span className="font-mono text-primary">{budget ? budget.bytes.toLocaleString() : "—"} B</span>
                  {budget && <span className="text-muted-foreground"> ({Math.round((budget.bytes / budget.source) * 100)}%, 100 B of it is the signature)</span>}
                </p>
                <p className="text-muted-foreground">Everything here travels through sound, so small is kind. Under 2 KB shares in about a minute on Fast.</p>
                {budget && budget.bytes > 4096 && <p className="text-amber-300">Over 4 KB: sharing will take several minutes per round.</p>}
                <Button size="xs" variant="outline" onClick={() => parsed?.ok && measure(parsed.source)} disabled={!parsed?.ok}>
                  Measure now
                </Button>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">One sharing round</p>
                {[0, 1, 2].map((p) => (
                  <div key={p} className="flex justify-between font-mono text-xs">
                    <span>{BEAM_PROFILES[p].label}</span>
                    <span>{budget ? fmtS(beamRoundSeconds(budget.bytes, p, CHUNK_LARGE)) : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl text-primary">Start a new spirit</DialogTitle>
            <DialogDescription>Pick a template. Everything is editable.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {TEMPLATES.map((t) => (
              <Card key={t.key} className="cursor-pointer transition-colors hover:border-primary" onClick={() => createFrom(t.source)}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-2xl">{t.source.manifest.icon}</span> {t.title}
                  </CardTitle>
                  <CardDescription>{t.blurb}</CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {t.source.manifest.peers === 2 ? "two devices" : "alone"} · {t.source.manifest.permissions.join(", ") || "no permissions"}
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise the version?</DialogTitle>
            <DialogDescription>
              Your library already has version {ask?.current} with different code. Devices only play together when their copies match, so a changed spirit should get a new
              version number.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={publishAnyway}>
              Keep version {ask?.current}
            </Button>
            <Button onClick={() => ask && publish(ask.current + 1)}>Publish as version {(ask?.current ?? 0) + 1}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {running?.two && running.transport === "air" && !linkUp && (
        <Alert>
          <AlertTitle>Pairing over simulated air…</AlertTitle>
          <AlertDescription>
            The two stations run the real handshake (call, line test, key swap). This takes about 20 seconds of simulated time and runs at full speed. Turn on &quot;show
            radio frames&quot; in Network to watch it.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
