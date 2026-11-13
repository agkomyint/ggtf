"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, FlaskConical, Play, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BAND_INFO } from "@/components/ggtf/sound-settings";
import { pct } from "@/lib/ggtf/format";
import type { ProfileInfo } from "@/lib/ggtf/types";

interface Scenario {
  index: number;
  key: string;
  name: string;
  tier: "easy" | "hard" | "brutal";
}

interface Result {
  scenario: string;
  decoder: string;
  frames: number;
  ok: number;
  missed: number;
  marker_fail: number;
  header_fail: number;
  payload_fail: number;
  corrupted: number;
  success: number;
  goodput_bps: number;
  mean_snr_db: number;
}

function rateVariant(v: number): "default" | "secondary" | "destructive" {
  if (v >= 0.95) return "default";
  if (v >= 0.7) return "secondary";
  return "destructive";
}

const TIER_STYLE: Record<string, string> = { easy: "text-muted-foreground", hard: "text-amber-300", brutal: "text-destructive" };

export function Lab() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<string, (m: { result?: Result; samples?: Float32Array }) => void>());
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [mlAvailable, setMlAvailable] = useState(false);
  const [profile, setProfile] = useState("1");
  const [band, setBand] = useState("1");
  const [compare, setCompare] = useState(true);
  const [frames, setFrames] = useState(10);
  const [payload, setPayload] = useState(32);
  const [results, setResults] = useState<Record<string, { classic?: Result; ml?: Result }>>({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [jobs, setJobs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  useEffect(() => {
    const w = new Worker("/audio/ggtf-worker.js", { type: "module" });
    worker.current = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "bench-ready") {
        setScenarios(m.scenarios);
        setProfiles(m.profiles);
        setMlAvailable(!!m.mlAvailable);
      } else if (m.type === "bench-result" || m.type === "bench-sample") {
        pending.current.get(m.ref)?.(m);
        pending.current.delete(m.ref);
      } else if (m.type === "error") {
        setError(m.message);
      }
    };
    w.postMessage({ type: "bench-init" });
    return () => w.terminate();
  }, []);

  const request = useCallback(<T,>(msg: Record<string, unknown>) => {
    const ref = Math.random().toString(36).slice(2);
    return new Promise<T>((resolve) => {
      pending.current.set(ref, resolve as never);
      worker.current?.postMessage({ ...msg, ref });
    });
  }, []);

  const useMl = compare && mlAvailable;

  const runAll = async () => {
    setRunning(true);
    setResults({});
    setDone(0);
    const decoders = useMl ? [false, true] : [false];
    setJobs(scenarios.length * decoders.length);
    for (const sc of scenarios) {
      for (const ml of decoders) {
        const m = await request<{ result: Result }>({ type: "bench-run", scenario: sc.index, profile: Number(profile), band: Number(band), ml, frames, payload, seed: 42 });
        setResults((r) => ({ ...r, [sc.key]: { ...r[sc.key], [ml ? "ml" : "classic"]: m.result } }));
        setDone((d) => d + 1);
      }
    }
    setRunning(false);
  };

  const listen = async (sc: Scenario) => {
    const m = await request<{ samples: Float32Array }>({ type: "bench-sample", scenario: sc.index, profile: Number(profile), band: Number(band), payload, seed: 7 });
    const ctx = (audioCtx.current ??= new AudioContext({ sampleRate: 48000 }));
    const buf = ctx.createBuffer(1, m.samples.length, 48000);
    buf.copyToChannel(new Float32Array(m.samples), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  };

  const sum = (key: "classic" | "ml", tier?: string) =>
    Object.entries(results)
      .filter(([k]) => !tier || scenarios.find((s) => s.key === k)?.tier === tier || (tier === "hard+" && scenarios.find((s) => s.key === k)?.tier !== "easy"))
      .map(([, v]) => v[key])
      .filter(Boolean)
      .reduce((a, r) => ({ ok: a.ok + r!.ok, n: a.n + r!.frames }), { ok: 0, n: 0 });
  const corrupted = Object.values(results).reduce((a, v) => a + (v.classic?.corrupted ?? 0) + (v.ml?.corrupted ?? 0), 0);
  const current = profiles.find((p) => String(p.id) === profile);
  const tot = { c: sum("classic"), m: sum("ml"), ch: sum("classic", "hard+"), mh: sum("ml", "hard+") };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-5xl text-primary glow flicker">Haunted lab</h1>
        <p className="max-w-3xl text-muted-foreground">
          The same Rust decoder that runs in the séance link, tested against {scenarios.length || "21"} simulated rooms: hiss, talking, music, beeps,
          echoes, cut-outs, door slams, drift and speaker roll-off. Runs in your browser through WebAssembly, with fixed seeds, so results are repeatable.
        </p>
      </div>

      <Card className="glow-box">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="size-4 text-primary" /> Experiment
          </CardTitle>
          <CardDescription>
            {current ? `${current.name}: ${Math.round(current.raw_bps)} bps raw, ${current.parity} RS parity bytes · ${BAND_INFO[Number(band)].label} band ${BAND_INFO[Number(band)].range}` : "Loading the modem…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-6">
          <div className="space-y-2">
            <Label>Speed profile</Label>
            <Tabs value={profile} onValueChange={(v) => setProfile(String(v))}>
              <TabsList>
                {profiles.map((p) => (
                  <TabsTrigger key={p.id} value={String(p.id)} disabled={running}>
                    {p.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="space-y-2">
            <Label>Band</Label>
            <Tabs value={band} onValueChange={(v) => setBand(String(v))}>
              <TabsList>
                {[0, 1, 2].map((b) => (
                  <TabsTrigger key={b} value={String(b)} disabled={running}>
                    {BAND_INFO[b].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="space-y-2">
            <Label htmlFor="frames">Frames per room</Label>
            <Input id="frames" type="number" min={1} max={100} value={frames} onChange={(e) => setFrames(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-24" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payload">Payload bytes</Label>
            <Input id="payload" type="number" min={1} max={64} value={payload} onChange={(e) => setPayload(Math.max(1, Math.min(64, Number(e.target.value) || 1)))} className="w-24" />
          </div>
          <div className="flex items-center gap-2 pb-1">
            <Switch id="compare" checked={useMl} disabled={!mlAvailable || running} onCheckedChange={(v) => setCompare(Boolean(v))} />
            <Label htmlFor="compare" className="flex items-center gap-1">
              <BrainCircuit className="size-4 text-primary" /> Compare with ML
            </Label>
          </div>
          <Button size="lg" onClick={runAll} disabled={running || scenarios.length === 0}>
            <Play /> {running ? "Running…" : "Run all rooms"}
          </Button>
          {(running || done > 0) && (
            <div className="min-w-56 flex-1">
              <Progress value={jobs ? (done / jobs) * 100 : 0} />
              <p className="mt-1 text-xs text-muted-foreground">
                {done}/{jobs} runs · {corrupted} corrupted frames accepted (must be 0)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {tot.c.n > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Classic decoder</CardDescription>
              <CardTitle className="font-display text-4xl">{pct(tot.c.ok / tot.c.n)}</CardTitle>
              <CardDescription>hard + brutal rooms: {tot.ch.n ? pct(tot.ch.ok / tot.ch.n) : "—"}</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>ML receiver</CardDescription>
              <CardTitle className="font-display text-4xl text-primary glow">{tot.m.n ? pct(tot.m.ok / tot.m.n) : "—"}</CardTitle>
              <CardDescription>hard + brutal rooms: {tot.mh.n ? pct(tot.mh.ok / tot.mh.n) : "—"}</CardDescription>
            </CardHeader>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Classic</TableHead>
                {useMl && <TableHead>ML</TableHead>}
                <TableHead className="text-right">Goodput</TableHead>
                <TableHead className="hidden md:table-cell">Classic failures</TableHead>
                <TableHead className="text-right">Hear it</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenarios.map((sc) => {
                const r = results[sc.key];
                const best = r?.ml && r.classic ? (r.ml.success >= r.classic.success ? r.ml : r.classic) : r?.classic;
                return (
                  <TableRow key={sc.key}>
                    <TableCell className="font-medium">{sc.name}</TableCell>
                    <TableCell className={`text-xs ${TIER_STYLE[sc.tier]}`}>{sc.tier}</TableCell>
                    <TableCell>{r?.classic ? <Badge variant={rateVariant(r.classic.success)}>{pct(r.classic.success)}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    {useMl && (
                      <TableCell>
                        {r?.ml ? (
                          <span className="flex items-center gap-1">
                            <Badge variant={rateVariant(r.ml.success)}>{pct(r.ml.success)}</Badge>
                            {r.classic && r.ml.success > r.classic.success && <span className="text-xs text-primary">▲</span>}
                            {r.classic && r.ml.success < r.classic.success && <span className="text-xs text-destructive">▼</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right font-mono tabular-nums">{best ? `${best.goodput_bps.toFixed(0)} bps` : "—"}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {r?.classic ? `missed ${r.classic.missed} · marker ${r.classic.marker_fail} · header ${r.classic.header_fail} · payload ${r.classic.payload_fail}` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon-sm" variant="ghost" onClick={() => listen(sc)} aria-label={`Play ${sc.name}`}>
                        <Volume2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
