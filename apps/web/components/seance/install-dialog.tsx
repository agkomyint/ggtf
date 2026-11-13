"use client";

import { Check, ShieldAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { stationLabel } from "@/lib/ggtf/format";
import { PERMISSIONS, type InstallVerdict, type Permission } from "@/lib/seance/bundle";
import type { OpenedBundle } from "@/lib/seance/tools";

export interface Offer {
  key: string;
  opened: OpenedBundle;
  bytes: Uint8Array;
  from: number | null;
  verdict: InstallVerdict;
}

const VERDICT: Partial<Record<InstallVerdict["kind"], { title: string; text: string; danger?: boolean }>> = {
  same: { title: "Already installed", text: "You have this exact copy. Nothing to do." },
  update: { title: "Update", text: "This is a newer version of a spirit you have. Its saved data is kept." },
  older: { title: "Older version", text: "You already have a newer version. Installing replaces it with this older one." },
  changed: { title: "Different copy, same version", text: "The author changed the code without raising the version. Installing replaces your copy." },
  "other-author": {
    title: "Same name, different author",
    text: "You have a spirit with this name from someone else. This one is a separate spirit and could be pretending.",
    danger: true,
  },
};

export function InstallDialog({ offer, mine, onInstall, onDismiss }: { offer: Offer | null; mine: string | null; onInstall: (o: Offer) => void; onDismiss: () => void }) {
  if (!offer) return null;
  const { manifest } = offer.opened.source;
  const v = VERDICT[offer.verdict.kind];
  const byMe = mine !== null && offer.opened.author === mine;
  return (
    <Dialog open onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 font-display text-3xl text-primary glow">
            <span className="text-4xl">{manifest.icon}</span> Summon “{manifest.name}”?
          </DialogTitle>
          <DialogDescription>
            {offer.from !== null ? <>Heard from station <span className="font-mono text-foreground">{stationLabel(offer.from)}</span>. </> : null}
            Version {manifest.version} · {offer.opened.bytes.toLocaleString()} bytes · {manifest.peers === 2 ? "two devices" : "runs alone"}
          </DialogDescription>
        </DialogHeader>
        {manifest.description && <p className="text-sm">{manifest.description}</p>}
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Made by</p>
          <div className="flex flex-wrap items-center gap-1">
            {offer.opened.words.map((w) => (
              <Badge key={w} variant="secondary" className="font-display text-base">
                {w}
              </Badge>
            ))}
            {byMe && <Badge variant="outline">that&apos;s you</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Signature checked: nobody changed it since the author published it, even if it was passed along. Hash{" "}
            <span className="font-mono">{offer.opened.hash.slice(0, 12)}</span>
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">This spirit can</p>
          <ul className="space-y-1 text-sm">
            {(Object.keys(PERMISSIONS) as Permission[]).map((p) => {
              const on = manifest.permissions.includes(p);
              return (
                <li key={p} className={`flex items-start gap-2 ${on ? "" : "text-muted-foreground line-through"}`}>
                  {on ? <Check className="mt-0.5 size-4 text-primary" /> : <X className="mt-0.5 size-4" />} {PERMISSIONS[p]}
                </li>
              );
            })}
            <li className="flex items-start gap-2 text-muted-foreground">
              <X className="mt-0.5 size-4" /> use the internet, your files, camera or other sites (always blocked)
            </li>
          </ul>
        </div>
        {v && (
          <Alert variant={v.danger ? "destructive" : "default"}>
            {v.danger && <ShieldAlert />}
            <AlertTitle>{v.title}</AlertTitle>
            <AlertDescription>{v.text}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDismiss}>
            Banish
          </Button>
          {offer.verdict.kind !== "same" && (
            <Button onClick={() => onInstall(offer)} variant={v?.danger ? "destructive" : "default"}>
              {offer.verdict.kind === "update" ? "Update" : v?.danger ? "Install anyway" : "Summon"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
