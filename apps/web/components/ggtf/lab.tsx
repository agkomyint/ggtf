"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FlaskConical, Play, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pct } from "@/lib/ggtf/format";
import type { ProfileInfo } from "@/lib/ggtf/types";

interface Scenario {
  index: number;
  key: string;
  name: string;
}

interface Result {
  scenario: string;
  name: string;
  profile: string;
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

export function Lab() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<string, (m: { result?: Result; samples?: Float32Array }) => void>());
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profile, setProfile] = useState("1");
  const [frames, setFrames] = useState(10);
  const [payload, setPayload] = useState(32);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
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

  const runAll = async () => {
    setRunning(true);
    setResults({});
    setDone(0);
    for (const sc of scenarios) {
      const m = await request<{ result: Result }>({
        type: "bench-run",
        scenario: sc.index,
        profile: Number(profile),
        frames,
        payload,
        seed: 42,
      });
      setResults((r) => ({ ...r, [sc.key]: m.result }));
      setDone((d) => d + 1);
    }
    setRunning(false);
  };

  const listen = async (sc: Scenario) => {
    const m = await request<{ samples: Float32Array }>({ type: "bench-sample", scenario: sc.index, profile: Number(profile), payload, seed: 7 });
    const ctx = (audioCtx.current ??= new AudioContext({ sampleRate: 48000 }));
    const buf = ctx.createBuffer(1, m.samples.length, 48000);
    buf.copyToChannel(new Float32Array(m.samples), 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  };

  const all = Object.values(results);
  const totalOk = all.reduce((a, r) => a + r.ok, 0);
  const totalFrames = all.reduce((a, r) => a + r.frames, 0);
  const corrupted = all.reduce((a, r) => a + r.corrupted, 0);
  const current = profiles.find((p) => String(p.id) === profile);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="font-display text-5xl text-primary glow flicker">Haunted lab</h1>
        <p className="max-w-3xl text-muted-foreground">
          The same Rust decoder that runs in the séance link, tested against simulated rooms: hiss, people talking, music, beeps,
          echoes, cut-outs, door slams and clock drift. Everything runs in your browser through WebAssembly, with fixed seeds.
        </p>
      </div>

      <Card className="glow-box">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="size-4 text-primary" /> Experiment
          </CardTitle>
          <CardDescription>
            {current ? `${current.name}: ${Math.round(current.raw_bps)} bps raw, ${current.lo_hz}–${current.hi_hz} Hz, ${current.parity} RS parity bytes` : "Loading the modem…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-6">
          <div className="space-y-2">
            <Label>Profile</Label>
            <Tabs value={profile} onValueChange={(v) => setProfile(String(v))}>
              <TabsList>
                {profiles.map((p) => (
                  <TabsTrigger key={p.id} value={String(p.id)}>
                    {p.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="space-y-2">
            <Label htmlFor="frames">Frames per room</Label>
            <Input id="frames" type="number" min={1} max={100} value={frames} onChange={(e) => setFrames(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="w-28" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payload">Payload bytes</Label>
            <Input id="payload" type="number" min={1} max={64} value={payload} onChange={(e) => setPayload(Math.max(1, Math.min(64, Number(e.target.value) || 1)))} className="w-28" />
          </div>
          <Button size="lg" onClick={runAll} disabled={running || scenarios.length === 0}>
            <Play /> {running ? "Running…" : "Run all rooms"}
          </Button>
          {(running || done > 0) && (
            <div className="min-w-48 flex-1">
              <Progress value={scenarios.length ? (done / scenarios.length) * 100 : 0} />
              <p className="mt-1 text-xs text-muted-foreground">
                {done}/{scenarios.length} rooms · {totalOk}/{totalFrames} frames decoded · {corrupted} silently corrupted
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room</TableHead>
                <TableHead>Success</TableHead>
                <TableHead className="text-right">Goodput</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="hidden md:table-cell">Failures</TableHead>
                <TableHead className="text-right">Hear it</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenarios.map((sc) => {
                const r = results[sc.key];
                return (
                  <TableRow key={sc.key}>
                    <TableCell className="font-medium">{sc.name}</TableCell>
                    <TableCell>{r ? <Badge variant={rateVariant(r.success)}>{pct(r.success)}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{r ? `${r.goodput_bps.toFixed(0)} bps` : "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{r && r.ok ? `${r.mean_snr_db.toFixed(1)} dB` : "—"}</TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {r ? `missed ${r.missed} · marker ${r.marker_fail} · header ${r.header_fail} · payload ${r.payload_fail}` : ""}
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
