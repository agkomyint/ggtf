"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, PhoneCall, PhoneOff, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SpiritFrame } from "@/components/seance/spirit-frame";
import type { useStation } from "@/hooks/use-station";
import { STATE_LABEL, stationLabel } from "@/lib/ggtf/format";
import { callTag, type InstalledSpirit } from "@/lib/seance/bundle";
import type { HostLog } from "@/lib/seance/host";
import { SpiritRun } from "@/lib/seance/run";
import type { SessionState } from "@/lib/seance/session";
import { dbStates, persister } from "@/lib/seance/store";
import { deviceId } from "@/lib/seance/tools";
import { traceRow, type TraceRow } from "@/lib/seance/trace";
import { LinkTransport } from "@/lib/seance/transport";

type Station = ReturnType<typeof useStation>;

const SESSION_LABEL: Record<SessionState, string> = {
  offline: "offline",
  checking: "checking the other device",
  ready: "playing together",
  mismatch: "can't play together",
};

export function SpiritWindow({ spirit, station, onClose }: { spirit: InstalledSpirit; station: Station; onClose: () => void }) {
  const { view } = station;
  const [run, setRun] = useState<SpiritRun | null>(null);
  const [session, setSession] = useState<{ state: SessionState; detail?: string }>({ state: "offline" });
  const [traces, setTraces] = useState<(TraceRow & { key: number })[]>([]);
  const [logs, setLogs] = useState<HostLog[]>([]);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const traceKey = useRef(0);
  const { subscribe, sendBytes } = station;

  useEffect(() => {
    let alive = true;
    let r: SpiritRun | null = null;
    let unsub: (() => void) | null = null;
    (async () => {
      const key = `os:${spirit.appId}`;
      const dbState = await dbStates.get(key);
      if (!alive) return;
      r = new SpiritRun({
        manifest: spirit.manifest,
        files: spirit.files,
        identity: { appId: spirit.appId, hash: spirit.hash.slice(0, 16), version: spirit.manifest.version, name: spirit.manifest.name },
        me: { device: deviceId(), side: "me", name: spirit.manifest.name, version: spirit.manifest.version, peers: spirit.manifest.peers },
        dbState,
        persist: persister(key),
        onTrace: (t) => setTraces((xs) => [...xs, { ...traceRow(t), key: traceKey.current++ }].slice(-40)),
        onLog: (l) => setLogs((xs) => [...xs, l].slice(-60)),
        events: { state: (state, detail) => setSession({ state, detail }) },
      });
      const transport = new LinkTransport(sendBytes);
      unsub = subscribe((e) => transport.handle(e));
      if (viewRef.current.state === "connected") transport.handle({ type: "state", state: "connected", role: viewRef.current.role });
      r.session.attach(transport);
      setRun(r);
    })();
    return () => {
      alive = false;
      unsub?.();
      r?.dispose();
    };
  }, [spirit, subscribe, sendBytes]);

  const two = spirit.manifest.peers === 2;
  const linkBusy = view.state !== "idle";
  const sasOpen = view.sas !== null && view.state === "awaiting_confirm";
  const lastError = [...logs].reverse().find((l) => l.level === "error");

  const close = () => {
    if (linkBusy) station.hangup();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-2xl">{spirit.manifest.icon}</span>
        <div className="mr-auto min-w-0">
          <p className="truncate font-display text-2xl leading-none text-primary glow">{spirit.manifest.name}</p>
          <p className="text-xs text-muted-foreground">
            v{spirit.manifest.version} · by {spirit.words.join(" · ")}
          </p>
        </div>
        {two && (
          <>
            <Badge variant={session.state === "ready" ? "default" : session.state === "mismatch" ? "destructive" : "outline"}>
              <Users /> {SESSION_LABEL[session.state]}
            </Badge>
            {linkBusy && <Badge variant="secondary">{STATE_LABEL[view.state]}</Badge>}
            {view.peer && <Badge variant="outline" className="font-mono">{stationLabel(view.peer)}</Badge>}
            {!view.started ? (
              <Button size="sm" onClick={station.start} disabled={view.starting}>
                {view.starting ? "Opening…" : "Turn on sound to play together"}
              </Button>
            ) : linkBusy ? (
              <Button size="sm" variant="destructive" onClick={station.hangup}>
                <PhoneOff /> Hang up
              </Button>
            ) : (
              <Button size="sm" onClick={() => station.callTagged(callTag(spirit.appId))}>
                <PhoneCall /> Play together
              </Button>
            )}
          </>
        )}
        <Button size="icon-sm" variant="ghost" onClick={close} aria-label="Close spirit">
          <X />
        </Button>
      </div>

      {session.state === "mismatch" && session.detail && (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">Can&apos;t play together: {session.detail}</p>
      )}
      {view.state === "calling" && (
        <p className="border-b border-border bg-primary/10 px-4 py-2 text-sm">
          Summoning… on the other device, open Séance OS, turn on sound and accept the call for {spirit.manifest.name}.
        </p>
      )}

      <div className="min-h-0 flex-1 p-3">{run && <SpiritFrame run={run} title={spirit.manifest.name} />}</div>

      <div className="flex items-center gap-3 overflow-x-auto border-t border-border px-4 py-2 font-mono text-xs text-muted-foreground">
        <span className="shrink-0 text-foreground">GGTP</span>
        {traces.length === 0 ? (
          <span>{two ? "no traffic yet" : "this spirit runs offline"}</span>
        ) : (
          traces.slice(-4).map((t) => (
            <span key={t.key} className="flex shrink-0 items-center gap-1">
              {t.dir === "out" ? <ArrowUp className="size-3 text-chart-2" /> : <ArrowDown className="size-3 text-primary" />}
              {t.type} {t.summary} <span className="text-muted-foreground/60">{t.bytes} B</span>
            </span>
          ))
        )}
        {view.stats?.link && linkBusy && (
          <span className="ml-auto shrink-0">
            {view.stats.link.profile} · {view.stats.link.frag} B fragments
          </span>
        )}
        {lastError && <span className="ml-auto shrink-0 text-destructive">{lastError.text}</span>}
      </div>

      <Dialog open={sasOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="font-display text-3xl text-primary glow">Do the words match?</DialogTitle>
            <DialogDescription>Both devices should show the same four words before you play {spirit.manifest.name} together.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-4">
            {view.sas?.map((w, i) => (
              <div key={i} className="rounded-lg border border-primary/30 bg-primary/10 py-3 text-center font-display text-2xl text-primary">
                {w}
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {view.localConfirmed ? (view.peerConfirmed ? "Both confirmed…" : "Waiting for the other device…") : "Compare with the other screen."}
          </p>
          <DialogFooter>
            <Button variant="destructive" onClick={station.reject}>
              They don&apos;t match
            </Button>
            <Button onClick={station.confirm} disabled={view.localConfirmed}>
              They match
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
