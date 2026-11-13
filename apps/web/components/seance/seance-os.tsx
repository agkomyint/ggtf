"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Ear, Mic, PhoneCall, PhoneOff, RadioTower, Share2, Skull, Square, Trash2, Wand2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChunkMap } from "@/components/ggtf/beam-console";
import { BAND_INFO, SoundSettings } from "@/components/ggtf/sound-settings";
import { Spectrogram } from "@/components/ggtf/spectrogram";
import { InstallDialog, type Offer } from "@/components/seance/install-dialog";
import { SpiritWindow } from "@/components/seance/spirit-window";
import { useStation } from "@/hooks/use-station";
import { BEAM_PROFILES, CHUNK_LARGE, base64ToBytes, beamRoundSeconds } from "@/lib/ggtf/beam";
import { stationLabel } from "@/lib/ggtf/format";
import { compareInstall, type InstalledSpirit } from "@/lib/seance/bundle";
import { install, library, remove } from "@/lib/seance/library";
import { onLibrary } from "@/lib/seance/store";
import { forgetStarter, installStarters } from "@/lib/seance/starters";
import { author, isBundle, openBundle } from "@/lib/seance/tools";

const SHARE_PROFILES = [0, 1, 2];

function fmtSeconds(s: number) {
  return s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`;
}

export function SeanceOS() {
  const station = useStation();
  const { view } = station;
  const [lib, setLib] = useState<InstalledSpirit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState<InstalledSpirit | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [sharing, setSharing] = useState<InstalledSpirit | null>(null);
  const [profile, setProfile] = useState(2);
  const [removing, setRemoving] = useState<InstalledSpirit | null>(null);
  const [tab, setTab] = useState("spirits");
  const seen = useRef(new Set<string>());
  const libRef = useRef(lib);
  useEffect(() => {
    libRef.current = lib;
  }, [lib]);

  const reload = useCallback(() => {
    library().then((l) => {
      setLib(l);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    library().then(async (l) => {
      setLib(l);
      setLoaded(true);
      if (await installStarters(l).catch(() => 0)) reload();
    });
    author()
      .then((a) => setMe(a.publicHex))
      .catch(() => {});
    return onLibrary(reload);
  }, [reload]);

  const restoreStarters = async () => {
    const n = await installStarters(libRef.current, true);
    toast(n ? `Restored ${n} starter spirit${n === 1 ? "" : "s"}` : "All starter spirits are already here");
  };

  // Spirits arriving inside beams.
  useEffect(() => {
    for (const b of view.beamInbox) {
      if (seen.current.has(b.key)) continue;
      seen.current.add(b.key);
      const bytes = base64ToBytes(b.b64);
      if (!isBundle(bytes)) continue;
      openBundle(bytes).then((r) => {
        if (!r.ok) {
          toast.error("A spirit arrived but failed its check", { description: r.error });
          return;
        }
        const verdict = compareInstall(libRef.current, { appId: r.bundle.appId, hash: r.bundle.hash, manifest: r.bundle.source.manifest });
        setOffers((o) => [...o, { key: b.key, opened: r.bundle, bytes, from: b.from, verdict }]);
      });
    }
  }, [view.beamInbox]);

  const doInstall = async (o: Offer) => {
    const s: InstalledSpirit = {
      appId: o.opened.appId,
      hash: o.opened.hash,
      author: o.opened.author,
      words: o.opened.words,
      manifest: o.opened.source.manifest,
      files: o.opened.source.files,
      bundle: o.bytes,
      installedAt: Date.now(),
      from: o.from,
      origin: "sound",
    };
    await install(s);
    setOffers((xs) => xs.filter((x) => x.key !== o.key));
    setTab("spirits");
    toast.success(`${s.manifest.name} is bound to this device`, { description: "It opens offline from now on." });
  };

  const incomingSpirit = view.incomingTag ? lib.find((s) => s.appId === view.incomingTag) ?? null : null;
  const incomingOpen = view.incoming !== null && view.state === "idle" && !!view.incomingTag;

  const acceptIncoming = () => {
    if (!incomingSpirit) return;
    station.accept();
    setOpen(incomingSpirit);
  };

  const shareSeconds = sharing ? beamRoundSeconds(sharing.bundle.length, profile, CHUNK_LARGE) : 0;
  const prog = view.beamProgress;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl text-primary glow flicker">Séance OS</h1>
          <p className="text-muted-foreground">Apps that travel through sound. Receive one, run it offline, pass it on, or play it with someone nearby.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono">
            station {stationLabel(view.id)}
          </Badge>
          {view.started ? (
            <Badge>
              <Ear /> listening
            </Badge>
          ) : (
            <Button onClick={station.start} disabled={view.starting}>
              <Mic /> {view.starting ? "Opening…" : "Turn on sound"}
            </Button>
          )}
          <Link href="/studio" className={buttonVariants({ variant: "outline" })}>
            <Wand2 /> Spirit Studio
          </Link>
        </div>
      </div>

      {view.error && (
        <Alert variant="destructive">
          <Skull />
          <AlertTitle>The spirits can&apos;t hear you</AlertTitle>
          <AlertDescription>{view.error}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="spirits">Spirits ({lib.length})</TabsTrigger>
          <TabsTrigger value="receive">
            Receive {prog && <span className="ml-1 font-mono text-xs">{Math.round((prog.have / prog.count) * 100)}%</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spirits" className="pt-4">
          {loaded && lib.length === 0 ? (
            <Card>
              <CardContent className="space-y-3 py-10 text-center">
                <p className="text-5xl">🕯️</p>
                <p className="font-display text-3xl text-primary">No spirits yet</p>
                <p className="text-muted-foreground">Receive one from a nearby device, or make your own in Spirit Studio.</p>
                <div className="flex justify-center gap-2">
                  <Button onClick={() => setTab("receive")}>
                    <Ear /> Receive
                  </Button>
                  <Link href="/studio" className={buttonVariants({ variant: "outline" })}>
                    <Wand2 /> Open Spirit Studio
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {lib.map((s) => (
                <Card key={s.appId} className="glow-box">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <span className="text-4xl">{s.manifest.icon}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-display text-2xl text-primary">{s.manifest.name}</span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          v{s.manifest.version} · {s.bundle.length.toLocaleString()} B · {s.manifest.peers === 2 ? "2 devices" : "alone"}
                        </span>
                      </span>
                    </CardTitle>
                    <CardDescription className="line-clamp-2">{s.manifest.description || "No description."}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      by <span className="text-foreground">{s.words.join(" · ")}</span>
                      {s.author === me ? " (you)" : ""}
                      <br />
                      {s.origin === "studio" ? "published on this device" : s.origin === "preloaded" ? "comes with Séance OS" : `received from ${stationLabel(s.from)}`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setOpen(s)}>
                        Open
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSharing(s)}>
                        <Share2 /> Share over sound
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(s)} aria-label={`Remove ${s.manifest.name}`}>
                        <Trash2 />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <div className="pt-3">
            <Button size="xs" variant="ghost" onClick={restoreStarters}>
              Restore starter spirits
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="receive" className="pt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ear className="size-4 text-primary" /> Listening for spirits
                  </CardTitle>
                  <CardDescription>Hold this device near one that is sharing. A spirit arrives in rounds; missed pieces are filled in on the next round.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!view.started ? (
                    <Button size="lg" onClick={station.start} disabled={view.starting}>
                      <Mic /> {view.starting ? "Opening…" : "Turn on sound (allow the mic)"}
                    </Button>
                  ) : prog ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>
                          Receiving from <span className="font-mono">{stationLabel(prog.from)}</span>
                        </span>
                        <span className="font-mono">
                          {prog.have}/{prog.count} pieces
                        </span>
                      </div>
                      <Progress value={(prog.have / prog.count) * 100} />
                      <ChunkMap got={prog.got} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nothing in the air yet. On the other device, open a spirit card and press Share over sound.</p>
                  )}
                  <Spectrogram analyser={station.analyser} active={view.started} />
                </CardContent>
              </Card>
            </div>
            <SoundSettings
              band={view.band}
              ml={view.ml}
              mlAvailable={view.mlAvailable}
              volume={view.volume}
              started={view.started}
              disabled={view.state !== "idle"}
              onBand={station.setBand}
              onMl={station.setMl}
              onVolume={station.setVolume}
            />
          </div>
        </TabsContent>
      </Tabs>

      <InstallDialog offer={offers[0] ?? null} mine={me} onInstall={doInstall} onDismiss={() => setOffers((o) => o.slice(1))} />

      <Dialog open={!!sharing} onOpenChange={(o) => !o && setSharing(null)}>
        <DialogContent>
          {sharing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 font-display text-3xl text-primary glow">
                  <RadioTower /> Share {sharing.manifest.name}
                </DialogTitle>
                <DialogDescription>
                  Every device listening nearby gets an exact copy, still signed by its author ({sharing.words.join(" · ")}). {sharing.bundle.length.toLocaleString()} bytes.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Frequency</p>
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((b) => (
                    <Button key={b} variant={view.band === b ? "default" : "outline"} onClick={() => station.setBand(b)} disabled={view.beam.sending}>
                      <span className="flex flex-col items-center leading-tight">
                        {BAND_INFO[b].label}
                        <span className="text-[10px] opacity-80">{BAND_INFO[b].range.split(" (")[0]}</span>
                      </span>
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{BAND_INFO[view.band]?.hint} Listeners hear all three bands at once, so they don&apos;t need to change anything.</p>
              </div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Speed</p>
              <div className="grid grid-cols-3 gap-2">
                {SHARE_PROFILES.map((p) => (
                  <Button key={p} variant={profile === p ? "default" : "outline"} onClick={() => setProfile(p)} disabled={view.beam.sending}>
                    <span className="flex flex-col items-center leading-tight">
                      {BEAM_PROFILES[p].label}
                      <span className="text-[10px] opacity-80">{fmtSeconds(beamRoundSeconds(sharing.bundle.length, p, CHUNK_LARGE))}/round</span>
                    </span>
                  </Button>
                ))}
              </div>
              {view.beam.sending ? (
                <p className="text-sm">
                  Beaming… round {view.beam.round + 1}. Keep going until every listener has it (about {fmtSeconds(shareSeconds)} per round).
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">One round takes about {fmtSeconds(shareSeconds)}. It repeats until you stop, so late listeners catch up.</p>
              )}
              <DialogFooter>
                {!view.started ? (
                  <Button onClick={station.start} disabled={view.starting}>
                    <Mic /> Turn on sound first
                  </Button>
                ) : view.beam.sending ? (
                  <Button variant="destructive" onClick={station.beamStop}>
                    <Square /> Stop
                  </Button>
                ) : (
                  <Button onClick={() => station.beamStart(sharing.bundle, profile, 0, CHUNK_LARGE)} disabled={view.state !== "idle"}>
                    <RadioTower /> Start beaming
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.manifest.name}?</DialogTitle>
            <DialogDescription>The spirit and the data it saved on this device are deleted. You can receive it again later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (removing) {
                  if (removing.origin === "preloaded") forgetStarter(removing.appId);
                  await remove(removing.appId);
                }
                setRemoving(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={incomingOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-3xl text-primary glow">
              <PhoneCall className="animate-pulse" /> {incomingSpirit ? `Play ${incomingSpirit.manifest.name}?` : "Someone wants to play"}
            </DialogTitle>
            <DialogDescription>
              Station <span className="font-mono text-foreground">{stationLabel(view.incoming)}</span>{" "}
              {incomingSpirit
                ? `wants to play ${incomingSpirit.manifest.icon} ${incomingSpirit.manifest.name} with you.`
                : "is calling for a spirit you don't have. Ask them to share it with you first."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" onClick={station.decline}>
              <PhoneOff /> Decline
            </Button>
            {incomingSpirit && (
              <Button onClick={acceptIncoming}>
                <PhoneCall /> Accept and open
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {open && <SpiritWindow spirit={open} station={station} onClose={() => setOpen(null)} />}
    </div>
  );
}
