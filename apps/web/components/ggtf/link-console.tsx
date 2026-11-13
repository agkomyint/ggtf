"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, PhoneCall, PhoneIncoming, PhoneOff, Radio, Send, ShieldCheck, Skull, Volume2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ConnectGhost } from "@/components/ggtf/ghost";
import { SoundSettings } from "@/components/ggtf/sound-settings";
import { Spectrogram } from "@/components/ggtf/spectrogram";
import { useStation } from "@/hooks/use-station";
import { STATE_LABEL, stateTone, stationLabel } from "@/lib/ggtf/format";
import type { ChatMessage, LogLine } from "@/lib/ggtf/types";

const BUSY_STATES = new Set(["calling", "ringing", "training", "key_exchange"]);

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function StatusBadge({ m }: { m: ChatMessage }) {
  if (m.dir === "in") return null;
  const variant = m.status === "delivered" ? "default" : m.status === "failed" ? "destructive" : "secondary";
  return (
    <Badge variant={variant} className="text-[10px]">
      {m.status}
    </Badge>
  );
}

const LOG_TONE: Record<LogLine["tone"], string> = {
  info: "text-muted-foreground",
  tx: "text-secondary-foreground",
  rx: "text-primary",
  warn: "text-amber-300",
  good: "text-primary glow",
};

export function LinkConsole() {
  const { view, analyser, start, call, accept, decline, hangup, reject, confirm, setAnswer, send, testSpeaker, setBand, setMl, setVolume } = useStation();
  const [draft, setDraft] = useState("");
  const [ghost, setGhost] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const connected = view.state === "connected";

  useEffect(() => {
    if (!connected) return;
    setGhost(true);
    const t = setTimeout(() => setGhost(false), 2200);
    return () => clearTimeout(t);
  }, [connected]);
  useEffect(() => {
    const el = logEnd.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.log.length]);
  useEffect(() => {
    const el = chatEnd.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.messages.length]);

  const sasOpen = view.sas !== null && view.state === "awaiting_confirm";
  const s = view.stats;
  const level = Math.min(1, (s?.peak ?? 0) * 1.5);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    send(text);
    setDraft("");
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <ConnectGhost show={ghost} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-primary glow flicker">Séance link</h1>
          <p className="text-muted-foreground">Two stations, one room, no network. Open this page in a second tab or on another device.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">station {stationLabel(view.id)}</Badge>
          <Badge variant={stateTone(view.state)}>{STATE_LABEL[view.state]}</Badge>
          {view.state !== "idle" && <Badge variant="secondary">{view.profile}</Badge>}
          {view.peer && <Badge variant="outline" className="font-mono">peer {stationLabel(view.peer)}</Badge>}
        </div>
      </div>

      {view.error && (
        <Alert variant="destructive">
          <Skull />
          <AlertTitle>The spirits can&apos;t hear you</AlertTitle>
          <AlertDescription>{view.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card className="glow-box">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Radio className="size-4 text-primary" /> Controls
              </CardTitle>
              <CardDescription>Turn your volume up. Headphones won&apos;t work: the mic has to hear the speaker.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!view.started ? (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    <li>Open this page in a second tab (or another device).</li>
                    <li>Click the button below in <b>both</b> tabs.</li>
                    <li>In one tab press <b>Call</b>; in the other press <b>Accept</b>.</li>
                  </ol>
                  <Button className="w-full" size="lg" onClick={start} disabled={view.starting}>
                    <Mic /> {view.starting ? "Opening the séance…" : "Step 1 · Open the séance (allow mic)"}
                  </Button>
                </>
              ) : view.incoming !== null && view.state === "idle" ? (
                <div className="space-y-3 rounded-lg border border-primary/50 bg-primary/10 p-4">
                  <p className="flex items-center gap-2 font-display text-2xl text-primary glow">
                    <PhoneIncoming className="size-5 animate-pulse" /> Incoming call
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Station <span className="font-mono text-foreground">{stationLabel(view.incoming)}</span> is summoning you.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="lg" onClick={accept}>
                      <PhoneCall /> Accept
                    </Button>
                    <Button size="lg" variant="destructive" onClick={decline}>
                      <PhoneOff /> Decline
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="lg" onClick={call} disabled={view.state !== "idle"}>
                      <PhoneCall /> Call
                    </Button>
                    <Button size="lg" variant="destructive" onClick={hangup} disabled={view.state === "idle"}>
                      <PhoneOff /> Hang up
                    </Button>
                  </div>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    {BUSY_STATES.has(view.state) && <AudioLines className="size-4 animate-pulse text-primary" />}
                    {view.state === "idle"
                      ? "Waiting. Press Call here, or press Call in the other tab and an Accept button appears here."
                      : view.state === "calling"
                        ? "Calling… the other tab should show Accept. You'll hear screeching tones."
                        : BUSY_STATES.has(view.state)
                          ? "Handshaking over sound (line test, then key swap)…"
                          : view.state === "awaiting_confirm"
                            ? "Compare the four words on both screens."
                            : view.state === "connected"
                              ? "Connected. Type a message on the right."
                              : "Hanging up…"}
                  </p>
                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <Label htmlFor="answer" className="text-muted-foreground">Auto-accept calls</Label>
                    <Switch id="answer" checked={view.answer} onCheckedChange={(v) => setAnswer(Boolean(v))} />
                  </div>
                </>
              )}
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>mic level (what this tab hears)</span>
                    <span>{s?.busy ? "receiving a frame" : "listening"}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${level * 100}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>speaker level (what this tab plays)</span>
                    <span>{view.outLevel > 0.02 ? `playing ${view.txKind ?? ""}` : "silent"}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-chart-2 transition-[width] duration-100" style={{ width: `${Math.min(1, view.outLevel * 1.4) * 100}%` }} />
                  </div>
                </div>
                {view.started && view.audioState && view.audioState !== "running" && (
                  <Alert variant="destructive">
                    <AlertTitle>Audio is paused by the browser ({view.audioState})</AlertTitle>
                    <AlertDescription>Click Test speaker or Call to wake it up.</AlertDescription>
                  </Alert>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground" title={view.outputDevice ?? undefined}>
                    {view.outputDevice ? `Output: ${view.outputDevice}` : "Output: system default"}
                  </span>
                  <Button size="sm" variant="outline" onClick={testSpeaker}>
                    <Volume2 /> Test speaker
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <SoundSettings
            band={view.band}
            ml={view.ml}
            mlAvailable={view.mlAvailable}
            volume={view.volume}
            started={view.started}
            disabled={view.state !== "idle"}
            onBand={setBand}
            onMl={setMl}
            onVolume={setVolume}
          />

          <Card>
            <CardHeader>
              <CardTitle>Link status</CardTitle>
            </CardHeader>
            <CardContent>
              <Stat label="Role" value={view.role ?? "—"} />
              <Stat label="Profile" value={view.state === "idle" ? "—" : view.profile} />
              <Stat label="Band" value={view.stats?.band ?? "—"} />
              <Stat label="Decoder" value={view.stats?.decoder ?? (view.ml ? "ml" : "classic")} />
              <Stat label="Signal margin" value={s && s.frames > 0 ? `${s.last_snr.toFixed(1)} dB` : "—"} />
              <Separator className="my-2" />
              <Stat label="Fragment size" value={s?.link && view.state !== "idle" ? `${s.link.frag} B` : "—"} />
              <Stat label="ACKs carried on replies" value={s?.link ? `${s.link.piggybacked} of ${s.link.piggybacked + s.link.acks}` : "—"} />
              <Stat label="Keep-alives" value={s?.link?.pings ?? 0} />
              <Separator className="my-2" />
              <Stat label="Frames sent" value={s?.tx_frames ?? 0} />
              <Stat label="Frames heard" value={s?.rx_frames ?? 0} />
              <Stat label="Own echoes ignored" value={s?.own_frames ?? 0} />
              <Stat label="Preambles detected" value={s?.detections ?? 0} />
              <Stat label="Decode failures" value={(s?.marker_fail ?? 0) + (s?.header_fail ?? 0) + (s?.payload_fail ?? 0)} />
              <Stat label="Sample rate" value={view.sampleRate ? `${view.sampleRate} Hz` : "—"} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>The air</CardTitle>
              <CardDescription>Live spectrogram of the microphone. Dashed lines mark the GGTF band.</CardDescription>
            </CardHeader>
            <CardContent>
              <Spectrogram analyser={analyser} active={view.started} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Messages
              </CardTitle>
              <CardDescription>Encrypted with ChaCha20-Poly1305. Each message is acknowledged over sound.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div ref={chatEnd} className="h-56 overflow-y-auto rounded-lg border border-border bg-background/40 p-3">
                {view.messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{connected ? "Say something to the other side." : "Connect to start talking."}</p>
                ) : (
                  <ul className="space-y-2">
                    {view.messages.map((m) => (
                      <li key={m.key} className={m.dir === "out" ? "flex justify-end" : "flex justify-start"}>
                        <div
                          className={
                            "max-w-[80%] rounded-lg px-3 py-2 text-sm " +
                            (m.dir === "out" ? "bg-secondary text-secondary-foreground" : "bg-primary/15 text-foreground")
                          }
                        >
                          <p className="whitespace-pre-wrap break-words">{m.text}</p>
                          <div className="mt-1 flex justify-end">
                            <StatusBadge m={m} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <form onSubmit={submit} className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={connected ? "Whisper into the static…" : "Not connected"}
                  disabled={!connected}
                  maxLength={500}
                  aria-label="Message"
                />
                <Button type="submit" disabled={!connected || !draft.trim()}>
                  <Send /> Send
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event log</CardTitle>
        </CardHeader>
        <CardContent>
          <div ref={logEnd} className="h-48 overflow-y-auto rounded-lg border border-border bg-[#050a07] p-3 font-mono text-xs">
            {view.log.map((l) => (
              <div key={l.key} className={LOG_TONE[l.tone]}>
                <span className="text-muted-foreground/60">{new Date(l.at).toLocaleTimeString()} </span>
                {l.text}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={sasOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="font-display text-3xl text-primary glow">Do the words match?</DialogTitle>
            <DialogDescription>
              Both screens should show the same four words. If they don&apos;t, someone else may be in the middle. Hang up.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-4">
            {view.sas?.map((w, i) => (
              <div key={i} className="rounded-lg border border-primary/30 bg-primary/10 py-3 text-center font-display text-2xl text-primary">
                {w}
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {view.localConfirmed
              ? view.peerConfirmed
                ? "Both confirmed, opening the line…"
                : "Confirmed. Waiting for the other side…"
              : view.peerConfirmed
                ? "The other side already confirmed."
                : "Compare with the other screen, then confirm."}
          </p>
          <DialogFooter>
            <Button variant="destructive" onClick={reject}>
              They don&apos;t match
            </Button>
            <Button onClick={confirm} disabled={view.localConfirmed}>
              They match
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
