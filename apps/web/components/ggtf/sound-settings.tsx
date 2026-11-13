"use client";

import { BrainCircuit, Volume1, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const BAND_INFO: Record<number, { label: string; range: string; hint: string }> = {
  0: { label: "Low", range: "0.5–4.1 kHz (Turbo to 5.3)", hint: "Warm hum. Carries through small speakers, but competes with voices and music." },
  1: { label: "Mid", range: "1.5–5.1 kHz (Turbo to 6.3)", hint: "Default. Most reliable on laptops and phones." },
  2: { label: "High", range: "14.5–18.1 kHz (Turbo to 19.3)", hint: "Quiet high whine most people barely notice. Some speakers and mics can't reach it; test first." },
};

interface Props {
  band: number;
  ml: boolean;
  mlAvailable: boolean;
  volume: number;
  started: boolean;
  disabled?: boolean;
  onBand: (b: number) => void;
  onMl: (on: boolean) => void;
  onVolume: (v: number) => void;
}

export function SoundSettings({ band, ml, mlAvailable, volume, started, disabled, onBand, onMl, onVolume }: Props) {
  const info = BAND_INFO[band] ?? BAND_INFO[1];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Waves className="size-4 text-primary" /> Sound settings
        </CardTitle>
        <CardDescription>Every station listens on all three bands at once. The band below is the one this station sends on.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Send band</Label>
          <Tabs value={String(band)} onValueChange={(v) => onBand(Number(v))}>
            <TabsList className="w-full">
              {[0, 1, 2].map((b) => (
                <TabsTrigger key={b} value={String(b)} disabled={disabled} className="flex-1">
                  {BAND_INFO[b].label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{info.range}</span> · {info.hint}
          </p>
          {disabled && <p className="text-xs text-amber-300">Band changes apply to the next call.</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="ml" className="flex items-center gap-2">
              <BrainCircuit className="size-4 text-primary" /> ML receiver
              {ml && <Badge className="text-[10px]">on</Badge>}
            </Label>
            <Switch id="ml" checked={ml} disabled={!mlAvailable && started} onCheckedChange={(v) => onMl(Boolean(v))} />
          </div>
          <p className="text-xs text-muted-foreground">
            {started && !mlAvailable
              ? "No trained model is bundled in this build, so the classic decoder is used."
              : "A small neural network reads each tone with context, ignoring beeps and echoes. If it fails a frame, the classic decoder retries. Off = classic only."}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2">
              <Volume1 className="size-4 text-primary" /> Volume
            </Label>
            <span className="font-mono text-xs text-muted-foreground">{Math.round(volume * 100)}%</span>
          </div>
          <Slider value={[Math.round(volume * 100)]} min={10} max={100} step={5} onValueChange={(v) => onVolume((Array.isArray(v) ? v[0] : v) / 100)} />
          <p className="text-xs text-muted-foreground">Softer is more comfortable; below about 40% the other device may stop hearing it.</p>
        </div>
      </CardContent>
    </Card>
  );
}
