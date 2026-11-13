"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, ExternalLink, Gauge, ImageIcon, Mic, Radio, RadioTower, Square, Volume2, Wifi } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SoundSettings } from "@/components/ggtf/sound-settings";
import { Spectrogram } from "@/components/ggtf/spectrogram";
import { useStation } from "@/hooks/use-station";
import {
  BEAM_PROFILES,
  CHUNK_LARGE,
  CHUNK_SMALL,
  IMAGE_PRESETS,
  base64ToBytes,
  beamChunks,
  beamRoundSeconds,
  decodeImage,
  encodeImage,
  parseWifi,
  safeLink,
  utf8Length,
  wifiString,
  type WifiSecurity,
} from "@/lib/ggtf/beam";
import { stationLabel } from "@/lib/ggtf/format";

const MAX_BYTES = 16 * 1024;

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check /> : <Copy />} {done ? "Copied" : label}
    </Button>
  );
}

function Received({ text, b64 }: { text: string; b64: string }) {
  const image = useMemo(() => (b64 ? decodeImage(base64ToBytes(b64)) : null), [b64]);
  if (image) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-medium">
          <ImageIcon className="size-4 text-primary" /> Image {image.w}×{image.h} ({image.mime.split("/")[1]})
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt="Image received over sound" className="w-48 rounded-md border border-border" style={{ imageRendering: "pixelated" }} />
        <a href={image.url} download={`ggtf-beam.${image.mime.split("/")[1]}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
          <Download /> Save image
        </a>
      </div>
    );
  }
  const wifi = parseWifi(text);
  const link = safeLink(text);
  if (b64.startsWith("AEdTAQ")) {
    return (
      <div className="space-y-2">
        <p className="font-medium">A Séance OS spirit (an app sent over sound).</p>
        <Link href="/seance" className={buttonVariants({ size: "sm" })}>
          Open Séance OS to install it
        </Link>
      </div>
    );
  }
  if (wifi) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-medium">
          <Wifi className="size-4 text-primary" /> Wi-Fi: <span className="font-mono">{wifi.ssid}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {wifi.security === "nopass" ? "Open network, no password." : <>Password: <span className="font-mono text-foreground">{wifi.password}</span></>}
        </p>
        <div className="flex flex-wrap gap-2">
          {wifi.password && <CopyButton value={wifi.password} label="Copy password" />}
          <CopyButton value={wifi.ssid} label="Copy name" />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap break-words font-mono text-sm">{text}</p>
      <div className="flex flex-wrap gap-2">
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm" })}>
            <ExternalLink /> Open link
          </a>
        )}
        <CopyButton value={text} />
      </div>
    </div>
  );
}

/** One square per chunk: lit once that chunk has been heard. */
export function ChunkMap({ got }: { got: string }) {
  return (
    <div className="flex flex-wrap gap-1" aria-label={`${[...got].filter((c) => c === "1").length} of ${got.length} chunks received`}>
      {[...got].map((c, i) => (
        <span key={i} className={`size-3 rounded-sm ${c === "1" ? "bg-primary shadow-[0_0_6px_oklch(0.86_0.19_150/70%)]" : "bg-muted"}`} />
      ))}
    </div>
  );
}

export function BeamConsole() {
  const { view, analyser, start, testSpeaker, setBand, setMl, setVolume, beamStart, beamStop } = useStation();
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("https://github.com/agkomyint/ggtf");
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [security, setSecurity] = useState<WifiSecurity>("WPA");
  const [profile, setProfile] = useState(1);
  const [bigChunks, setBigChunks] = useState(false);
  const [forever, setForever] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState("small");
  const [gray, setGray] = useState(false);
  const [image, setImage] = useState<{ bytes: Uint8Array; url: string; w: number; h: number } | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setImage(null);
      return;
    }
    let cancelled = false;
    encodeImage(file, IMAGE_PRESETS.find((p) => p.key === preset)!, gray)
      .then((r) => {
        if (!cancelled) {
          setImage(r);
          setImgError(null);
        }
      })
      .catch(() => !cancelled && setImgError("Couldn't read that image."));
    return () => {
      cancelled = true;
    };
  }, [file, preset, gray]);

  const isImage = mode === "image";
  const chunk = bigChunks || isImage ? CHUNK_LARGE : CHUNK_SMALL;
  const textPayload = useMemo(() => (mode === "wifi" ? (ssid ? wifiString(ssid, password, security) : "") : text.trim()), [mode, text, ssid, password, security]);
  const bytes = isImage ? (image?.bytes.length ?? 0) : utf8Length(textPayload);
  const ready = isImage ? !!image : !!textPayload;
  const tooLong = bytes > MAX_BYTES;
  const round = beamRoundSeconds(bytes || 1, profile, chunk);
  const chunks = beamChunks(bytes || 1, chunk);
  const sending = view.beam.sending;
  const busyLink = view.state !== "idle";
  const prog = view.beamProgress;

  const go = () => {
    if (isImage && image) beamStart(image.bytes, profile, forever ? 0 : 3, chunk);
    else beamStart(textPayload, profile, forever ? 0 : 3, chunk);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-primary glow flicker">Haunted QR</h1>
          <p className="max-w-2xl text-muted-foreground">
            Like a QR code, but heard instead of scanned. Beam a link, a note, a Wi-Fi login or a tiny picture to every device in the room. No camera,
            no pairing, no network. Receivers can start listening at any time: the message repeats until it&apos;s caught.
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

      {!view.started && (
        <Card className="glow-box">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <p className="text-muted-foreground">Open the séance on every device: the sender and all receivers. Then send from one.</p>
            <Button size="lg" onClick={start} disabled={view.starting}>
              <Mic /> {view.starting ? "Opening…" : "Open the séance (allow mic)"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glow-box">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RadioTower className="size-4 text-primary" /> Send
            </CardTitle>
            <CardDescription>Plain broadcast: anyone in earshot can read it, just like a printed QR code. Don&apos;t beam secrets you wouldn&apos;t print.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs
              value={mode}
              onValueChange={(v) => {
                setMode(String(v));
                // Fast + big chunks is what worked best for images over real air.
                if (v === "image" && profile === 3) setProfile(2);
              }}
            >
              <TabsList>
                <TabsTrigger value="text" disabled={sending}>Link or text</TabsTrigger>
                <TabsTrigger value="wifi" disabled={sending}>Wi-Fi login</TabsTrigger>
                <TabsTrigger value="image" disabled={sending}>Image</TabsTrigger>
              </TabsList>
              <TabsContent value="text" className="pt-3">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="https://… or any note" aria-label="Text to beam" disabled={sending} />
              </TabsContent>
              <TabsContent value="wifi" className="space-y-3 pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="ssid">Network name</Label>
                    <Input id="ssid" value={ssid} onChange={(e) => setSsid(e.target.value)} disabled={sending} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pw">Password</Label>
                    <Input id="pw" value={password} onChange={(e) => setPassword(e.target.value)} disabled={sending || security === "nopass"} />
                  </div>
                </div>
                <Tabs value={security} onValueChange={(v) => setSecurity(v as WifiSecurity)}>
                  <TabsList>
                    <TabsTrigger value="WPA">WPA/WPA2/WPA3</TabsTrigger>
                    <TabsTrigger value="WEP">WEP</TabsTrigger>
                    <TabsTrigger value="nopass">Open</TabsTrigger>
                  </TabsList>
                </Tabs>
              </TabsContent>
              <TabsContent value="image" className="space-y-3 pt-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  aria-label="Choose an image"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={sending}>
                    <ImageIcon /> {file ? "Choose another image" : "Choose an image"}
                  </Button>
                  <div className="flex items-center gap-2">
                    <Switch id="gray" checked={gray} onCheckedChange={(v) => setGray(Boolean(v))} disabled={sending} />
                    <Label htmlFor="gray">Black & white (smaller)</Label>
                  </div>
                </div>
                <Tabs value={preset} onValueChange={(v) => setPreset(String(v))}>
                  <TabsList>
                    {IMAGE_PRESETS.map((p) => (
                      <TabsTrigger key={p.key} value={p.key} disabled={sending}>
                        {p.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                {imgError && <p className="text-xs text-destructive">{imgError}</p>}
                {image && (
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt="Image to beam, after compression" className="w-28 rounded-md border border-border" style={{ imageRendering: "pixelated" }} />
                    <p className="text-sm text-muted-foreground">
                      {image.w}×{image.h} px, <span className="text-foreground">{image.bytes.length.toLocaleString()} bytes</span> after compression.
                      Images always use big chunks.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label>Speed</Label>
              <Tabs value={String(profile)} onValueChange={(v) => setProfile(Number(v))}>
                <TabsList className="w-full">
                  {BEAM_PROFILES.map((p, i) => (
                    <TabsTrigger key={p.name} value={String(i)} disabled={sending} className="flex-1">
                      {p.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {profile === 3 && (
                <p className="text-xs text-amber-300">
                  Turbo (experimental) sends three tones at once. In a real-room test it delivered short links in 1.2 s, but long frames such as image chunks
                  often failed. For images, use Fast.
                </p>
              )}
            </div>

            {!isImage && (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="big" className="flex flex-col items-start gap-0.5">
                  <span>Big chunks ({CHUNK_LARGE} bytes per frame)</span>
                  <span className="text-xs font-normal text-muted-foreground">Less overhead and faster for long messages; a lost frame costs more.</span>
                </Label>
                <Switch id="big" checked={bigChunks} onCheckedChange={(v) => setBigChunks(Boolean(v))} disabled={sending} />
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="forever">Repeat until I stop</Label>
              <Switch id="forever" checked={forever} onCheckedChange={(v) => setForever(Boolean(v))} disabled={sending} />
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-background/40 p-3 text-center">
              <div>
                <p className="font-mono text-lg">{bytes.toLocaleString()}</p>
                <p className="text-[11px] text-muted-foreground">bytes</p>
              </div>
              <div>
                <p className="font-mono text-lg">{chunks}</p>
                <p className="text-[11px] text-muted-foreground">chunks of {chunk} B</p>
              </div>
              <div>
                <p className="font-mono text-lg text-primary">{round.toFixed(1)} s</p>
                <p className="text-[11px] text-muted-foreground">per round · {bytes ? (bytes / round).toFixed(0) : 0} B/s</p>
              </div>
            </div>
            {tooLong && <p className="text-xs text-destructive">Too big: beams hold up to {MAX_BYTES / 1024} KB. Pick a smaller image size.</p>}

            {sending ? (
              <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/10 p-4">
                <p className="flex items-center gap-2 text-sm">
                  <Radio className="size-4 animate-pulse text-primary" /> Beaming… round {view.beam.round + 1}
                  {!forever && " of 3"}
                </p>
                {view.beam.lastRoundSec && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Gauge className="size-4 text-primary" /> Measured: {view.beam.lastRoundSec.toFixed(1)} s per round ={" "}
                    <span className="text-foreground">{(view.beam.bytes / view.beam.lastRoundSec).toFixed(1)} B/s</span>
                  </p>
                )}
                <Button variant="destructive" onClick={beamStop}>
                  <Square /> Stop beaming
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="lg" disabled={!view.started || !ready || tooLong || busyLink} onClick={go}>
                  <RadioTower /> Start beaming
                </Button>
                <Button size="lg" variant="outline" onClick={testSpeaker} disabled={!view.started}>
                  <Volume2 /> Test speaker
                </Button>
              </div>
            )}
            {busyLink && <p className="text-xs text-amber-300">A séance call is active on this tab; hang up there to beam.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="size-4 text-primary" /> Receive
            </CardTitle>
            <CardDescription>Always listening once the séance is open. Chunks heard in any order, across rounds, are stitched together and checked with a CRC.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {prog ? (
              <div className="space-y-2">
                <p className="text-sm">
                  Catching a beam from <span className="font-mono">{stationLabel(prog.from)}</span>: {prog.have}/{prog.count} chunks ·{" "}
                  {((Date.now() - prog.firstAt) / 1000).toFixed(0)} s
                </p>
                <Progress value={(prog.have / prog.count) * 100} />
                <ChunkMap got={prog.got} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{view.started ? "Listening on low, mid and high bands…" : "Open the séance to listen."}</p>
            )}
            {view.beamInbox.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing caught yet.</p>
            ) : (
              <ul className="space-y-3">
                {view.beamInbox.map((b) => (
                  <li key={b.key} className="rounded-lg border border-border bg-background/40 p-3">
                    <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      from <span className="font-mono">{stationLabel(b.from)}</span> · {new Date(b.at).toLocaleTimeString()} · {b.bytes.toLocaleString()} bytes
                      {b.seconds !== null && b.seconds > 0.5 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {b.seconds.toFixed(1)} s · {(b.bytes / b.seconds).toFixed(1)} B/s
                        </Badge>
                      )}
                    </p>
                    <Received text={b.text} b64={b.b64} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SoundSettings
          band={view.band}
          ml={view.ml}
          mlAvailable={view.mlAvailable}
          volume={view.volume}
          started={view.started}
          disabled={sending}
          onBand={setBand}
          onMl={setMl}
          onVolume={setVolume}
        />
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>The air</CardTitle>
            <CardDescription>Microphone spectrogram.</CardDescription>
          </CardHeader>
          <CardContent>
            <Spectrogram analyser={analyser} active={view.started} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
