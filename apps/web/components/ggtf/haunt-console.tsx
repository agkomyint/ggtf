"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bell, DoorClosed, DoorOpen, Flame, Ghost, Lightbulb, LightbulbOff, Mic, RotateCcw, Send, Square, Volume2, Wind } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GhostSvg } from "@/components/ggtf/ghost";
import { SoundSettings } from "@/components/ggtf/sound-settings";
import { useStation } from "@/hooks/use-station";
import { BEAM_PROFILES } from "@/lib/ggtf/beam";
import { stationLabel } from "@/lib/ggtf/format";
import {
  INITIAL_ROOM,
  LAMP_PRESETS,
  MAX_MIRROR,
  applyAction,
  describe,
  encodeCommand,
  parseCommand,
  randomRoomCode,
  type HauntAction,
  type RoomState,
  type SoundName,
} from "@/lib/ggtf/haunt";

/** Small synthesized sound effects, so the room needs no audio files. */
function playEffect(ctx: AudioContext, name: SoundName) {
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.connect(ctx.destination);
  if (name === "bell") {
    for (const [f, a] of [[220, 0.5], [550, 0.25], [880, 0.12]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 2.5);
    }
  } else if (name === "howl") {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(300, t);
    o.frequency.linearRampToValueAtTime(700, t + 0.6);
    o.frequency.linearRampToValueAtTime(250, t + 1.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 1200;
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 2);
  } else {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / len) * (Math.sin(i / 90) > 0.6 ? 1 : 0.15);
    const src = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 500;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    src.buffer = buf;
    src.connect(bp).connect(g).connect(out);
    src.start(t);
  }
}

function Room({ room, flash }: { room: RoomState; flash: number }) {
  const reduce = useReducedMotion();
  const lamp = room.lamp;
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-[#07060c]" style={{ aspectRatio: "16 / 10" }}>
      {/* lamp light washing the room */}
      <div
        className="absolute inset-0 transition-all duration-700"
        style={{ background: lamp ? `radial-gradient(ellipse 70% 80% at 50% 12%, ${lamp}55, transparent 70%)` : "transparent" }}
      />
      <svg viewBox="0 0 400 250" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {/* floor */}
        <rect x="0" y="200" width="400" height="50" fill="#0d0b14" />
        <line x1="0" y1="200" x2="400" y2="200" stroke="#ffffff10" />
        {/* window with moon */}
        <rect x="30" y="45" width="70" height="80" rx="4" fill="#0a1426" stroke="#2a2440" strokeWidth="4" />
        <circle cx="78" cy="68" r="12" fill="#e8e3c8" opacity="0.85" />
        <line x1="65" y1="45" x2="65" y2="125" stroke="#2a2440" strokeWidth="3" />
        <line x1="30" y1="85" x2="100" y2="85" stroke="#2a2440" strokeWidth="3" />
        {/* hanging lamp */}
        <line x1="200" y1="0" x2="200" y2="30" stroke="#3a3450" strokeWidth="2" />
        <path d="M182 30 h36 l10 18 h-56 z" fill="#2a2440" />
        <circle cx="200" cy="54" r="9" fill={lamp ?? "#2b2833"} style={{ transition: "fill .6s", filter: lamp ? `drop-shadow(0 0 14px ${lamp})` : "none" }} />
        {/* door */}
        <rect x="290" y="80" width="70" height="120" fill="#000" stroke="#2a2440" strokeWidth="4" />
        <g style={{ transformOrigin: "292px 140px", transform: room.door ? "scaleX(0.18)" : "scaleX(1)", transition: "transform .9s cubic-bezier(.3,.7,.3,1)" }}>
          <rect x="292" y="82" width="66" height="116" fill="#3b2418" />
          <rect x="300" y="92" width="50" height="40" fill="#311d13" />
          <rect x="300" y="142" width="50" height="46" fill="#311d13" />
          <circle cx="348" cy="142" r="3" fill="#c9a24a" />
        </g>
        {room.door && <rect x="306" y="82" width="52" height="116" fill="url(#doorGlow)" opacity="0.6" />}
        <defs>
          <linearGradient id="doorGlow" x1="0" x2="1">
            <stop offset="0" stopColor="#6dff9c" stopOpacity="0.25" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* table, candle */}
        <rect x="140" y="168" width="120" height="8" fill="#2a1d14" />
        <rect x="150" y="176" width="6" height="24" fill="#2a1d14" />
        <rect x="244" y="176" width="6" height="24" fill="#2a1d14" />
        <rect x="160" y="146" width="10" height="22" fill="#e9e1cf" />
        {/* mirror */}
        <ellipse cx="215" cy="118" rx="34" ry="42" fill="#121624" stroke="#7a6a3a" strokeWidth="4" />
        <text x="215" y="122" textAnchor="middle" fontFamily="var(--font-display), monospace" fontSize="11" fill="#ff5a7a" opacity={room.mirror ? 0.95 : 0}>
          {room.mirror.length > 12 ? (
            <>
              <tspan x="215" dy="-6">{room.mirror.slice(0, 12)}</tspan>
              <tspan x="215" dy="13">{room.mirror.slice(12)}</tspan>
            </>
          ) : (
            room.mirror
          )}
        </text>
      </svg>
      {/* candle flame */}
      {room.candle && (
        <motion.div
          className="absolute rounded-full bg-amber-300"
          style={{ left: "40.6%", top: "52.4%", width: "1.5%", height: "4%", boxShadow: "0 0 18px 6px #ffb84d88" }}
          animate={reduce ? {} : { scaleY: [1, 1.25, 0.9, 1.15, 1], opacity: [1, 0.85, 1, 0.9, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}
      {/* ghost */}
      <AnimatePresence>
        {room.ghost && (
          <motion.div
            key="g"
            className="absolute text-white/80"
            style={{ left: "8%", top: "34%", width: "22%" }}
            initial={{ opacity: 0, y: 30 }}
            animate={reduce ? { opacity: 0.85 } : { opacity: [0.6, 0.9, 0.6], y: [0, -12, 0], x: [0, 14, 0] }}
            exit={{ opacity: 0, y: -40 }}
            transition={{ duration: 3, repeat: reduce ? 0 : Infinity }}
          >
            <GhostSvg className="w-full drop-shadow-[0_0_24px_rgba(255,255,255,0.5)]" />
          </motion.div>
        )}
      </AnimatePresence>
      {/* flash when a command lands */}
      <AnimatePresence>
        {flash > 0 && (
          <motion.div
            key={flash}
            className="pointer-events-none absolute inset-0 border-2 border-primary"
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface LogItem {
  key: string;
  at: number;
  text: string;
  ok: boolean;
}

export function HauntConsole() {
  const { view, start, testSpeaker, setBand, setMl, setVolume, beamStart, beamStop } = useStation();
  const [role, setRole] = useState("room");
  const [code, setCode] = useState("");
  const [target, setTarget] = useState("");
  const [room, setRoom] = useState<RoomState>(INITIAL_ROOM);
  const [flash, setFlash] = useState(0);
  const [log, setLog] = useState<LogItem[]>([]);
  const [mirror, setMirror] = useState("BEHIND YOU");
  const [profile, setProfile] = useState(2);
  const [lastSent, setLastSent] = useState<{ text: string; at: number } | null>(null);
  const seen = useRef(new Set<string>());
  const fxCtx = useRef<AudioContext | null>(null);

  useEffect(() => setCode(randomRoomCode()), []);

  // Device side: obey new beams that carry this room's code.
  useEffect(() => {
    if (role !== "room") return;
    for (const b of [...view.beamInbox].reverse()) {
      if (seen.current.has(b.key)) continue;
      seen.current.add(b.key);
      const p = parseCommand(b.text);
      const entry = (text: string, ok: boolean) => setLog((l) => [{ key: b.key, at: b.at, text, ok }, ...l].slice(0, 30));
      if (!p.ok) {
        entry(`ignored a beam from ${stationLabel(b.from)}: ${p.reason}`, false);
        continue;
      }
      if (p.code !== code) {
        entry(`ignored ${describe(p.action)}: wrong room code ${p.code}`, false);
        continue;
      }
      const action: HauntAction = p.action;
      setRoom((r) => applyAction(r, action));
      setFlash((f) => f + 1);
      entry(`${describe(action)} (from ${stationLabel(b.from)})`, true);
      if (action.kind === "sound") playEffect((fxCtx.current ??= new AudioContext()), action.name);
    }
  }, [view.beamInbox, role, code]);

  const send = (a: HauntAction) => {
    if (!/^\d{4}$/.test(target)) return;
    const text = encodeCommand(target, a);
    // Each command is one chunk; two rounds give a second chance if the first is garbled.
    beamStart(text, profile, 2, 48);
    setLastSent({ text: describe(a), at: Date.now() });
  };
  const canSend = view.started && /^\d{4}$/.test(target) && view.state === "idle";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-primary glow flicker">Haunted room</h1>
          <p className="max-w-2xl text-muted-foreground">
            A sandbox for controlling things by sound. One device plays the haunted room; another is the remote. Each button beams a tiny command
            (about 20 bytes); the room only obeys commands with its room code, and only from a fixed list of actions.
          </p>
        </div>
        <Badge variant="outline" className="font-mono">station {stationLabel(view.id)}</Badge>
      </div>

      {view.error && (
        <Alert variant="destructive">
          <AlertTitle>The spirits can&apos;t hear you</AlertTitle>
          <AlertDescription>{view.error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={role} onValueChange={(v) => setRole(String(v))}>
        <TabsList>
          <TabsTrigger value="room">
            <Ghost /> I am the haunted room
          </TabsTrigger>
          <TabsTrigger value="remote">
            <Wind /> I am the remote
          </TabsTrigger>
        </TabsList>

        {!view.started && (
          <Card className="mt-4 glow-box">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
              <p className="text-muted-foreground">Open the séance on both devices first. Volume up, no headphones.</p>
              <Button size="lg" onClick={start} disabled={view.starting}>
                <Mic /> {view.starting ? "Opening…" : "Open the séance (allow mic)"}
              </Button>
            </CardContent>
          </Card>
        )}

        <TabsContent value="room" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Room room={room} flash={flash} />
            </div>
            <div className="space-y-4">
              <Card className="glow-box">
                <CardHeader>
                  <CardDescription>Room code (type this on the remote)</CardDescription>
                  <CardTitle className="font-display text-6xl tracking-[0.2em] text-primary glow">{code || "····"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">{view.started ? "Listening on all bands…" : "Not listening yet."}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setCode(randomRoomCode())}>
                      New code
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRoom(INITIAL_ROOM)}>
                      <RotateCcw /> Reset room
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>What the room heard</CardTitle>
                </CardHeader>
                <CardContent>
                  {log.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No commands yet.</p>
                  ) : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
                      {log.map((l) => (
                        <li key={l.key} className={l.ok ? "text-primary" : "text-muted-foreground"}>
                          <span className="opacity-60">{new Date(l.at).toLocaleTimeString()} </span>
                          {l.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="remote" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="glow-box lg:col-span-2">
              <CardHeader>
                <CardTitle>Remote</CardTitle>
                <CardDescription>Each press beams one command. It arrives in about 1–2 s on Fast.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="code">Room code</Label>
                    <Input
                      id="code"
                      inputMode="numeric"
                      maxLength={4}
                      value={target}
                      onChange={(e) => setTarget(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      placeholder="1234"
                      className="w-28 font-mono text-lg tracking-widest"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Speed</Label>
                    <Tabs value={String(profile)} onValueChange={(v) => setProfile(Number(v))}>
                      <TabsList>
                        {BEAM_PROFILES.map((p, i) => (
                          <TabsTrigger key={p.name} value={String(i)}>
                            {p.label}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>
                  <Button variant="outline" size="sm" onClick={testSpeaker} disabled={!view.started}>
                    <Volume2 /> Test speaker
                  </Button>
                </div>
                {!/^\d{4}$/.test(target) && view.started && <p className="text-xs text-amber-300">Enter the 4-digit code shown on the haunted room.</p>}

                <div className="space-y-2">
                  <Label>Lamp</Label>
                  <div className="flex flex-wrap gap-2">
                    {LAMP_PRESETS.map((p) => (
                      <Button key={p.color} variant="outline" disabled={!canSend} onClick={() => send({ kind: "lamp", color: p.color })}>
                        <span className="size-3 rounded-full" style={{ background: p.color, boxShadow: `0 0 8px ${p.color}` }} />
                        {p.name}
                      </Button>
                    ))}
                    <Button variant="outline" disabled={!canSend} onClick={() => send({ kind: "lamp_off" })}>
                      <LightbulbOff /> Off
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <Button variant="secondary" disabled={!canSend} onClick={() => send({ kind: "door", open: true })}>
                    <DoorOpen /> Open door
                  </Button>
                  <Button variant="secondary" disabled={!canSend} onClick={() => send({ kind: "door", open: false })}>
                    <DoorClosed /> Close door
                  </Button>
                  <Button variant="secondary" disabled={!canSend} onClick={() => send({ kind: "ghost", show: true })}>
                    <Ghost /> Summon ghost
                  </Button>
                  <Button variant="secondary" disabled={!canSend} onClick={() => send({ kind: "ghost", show: false })}>
                    <Ghost /> Banish ghost
                  </Button>
                  <Button variant="secondary" disabled={!canSend} onClick={() => send({ kind: "candle", lit: true })}>
                    <Flame /> Light candle
                  </Button>
                  <Button variant="secondary" disabled={!canSend} onClick={() => send({ kind: "candle", lit: false })}>
                    <Wind /> Blow out candle
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={!canSend} onClick={() => send({ kind: "sound", name: "bell" })}>
                    <Bell /> Bell
                  </Button>
                  <Button variant="outline" disabled={!canSend} onClick={() => send({ kind: "sound", name: "howl" })}>
                    <Wind /> Howl
                  </Button>
                  <Button variant="outline" disabled={!canSend} onClick={() => send({ kind: "sound", name: "creak" })}>
                    <DoorOpen /> Creak
                  </Button>
                  <Button variant="outline" disabled={!canSend} onClick={() => send({ kind: "reset" })}>
                    <RotateCcw /> Reset room
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="mirror">Write on the mirror</Label>
                    <Input id="mirror" value={mirror} maxLength={MAX_MIRROR} onChange={(e) => setMirror(e.target.value.replace(/[^\x20-\x7e]/g, ""))} />
                  </div>
                  <Button disabled={!canSend} onClick={() => send({ kind: "mirror", text: mirror })}>
                    <Send /> Write
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 p-3 text-sm">
                  <Lightbulb className="size-4 text-primary" />
                  {lastSent ? (
                    <span>
                      Last command: <span className="text-foreground">{lastSent.text}</span>
                      {view.beam.sending ? " · beaming…" : " · sent"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Nothing sent yet.</span>
                  )}
                  {view.beam.sending && (
                    <Button size="sm" variant="destructive" onClick={beamStop} className="ml-auto">
                      <Square /> Stop
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            <SoundSettings
              band={view.band}
              ml={view.ml}
              mlAvailable={view.mlAvailable}
              volume={view.volume}
              started={view.started}
              onBand={setBand}
              onMl={setMl}
              onVolume={setVolume}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
