import Link from "next/link";
import { AudioWaveform, Cpu, FlaskConical, KeyRound, Laptop, Radio, ShieldCheck, Speaker } from "lucide-react";
import { GhostSvg } from "@/components/ggtf/ghost";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  { icon: Speaker, title: "Speaker", text: "Your message becomes a 1960s-style screech: tones in 16 pitches, two at a time." },
  { icon: AudioWaveform, title: "Air", text: "A chirp says “frame starts here”. Reed-Solomon codes repair what noise breaks." },
  { icon: Radio, title: "Microphone", text: "The other station finds the chirp, reads the tones and sends an ACK back by sound." },
];

const parts = [
  { icon: Cpu, title: "Rust → WebAssembly", text: "One modem core: MFSK, chirp sync, Reed-Solomon, CRC, link state machine, room simulator." },
  { icon: KeyRound, title: "Dial-up handshake", text: "CALL, ANSWER, a line test from slowest to fastest profile, then the fastest one that works." },
  { icon: ShieldCheck, title: "Modern crypto", text: "X25519 key exchange over sound, four spooky words to compare, ChaCha20-Poly1305 for every frame." },
  { icon: FlaskConical, title: "Measured, not guessed", text: "A seeded simulator throws talking, music, echoes and cut-outs at the decoder in the lab." },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="grid items-center gap-10 py-16 md:grid-cols-[1fr_auto]">
        <div className="space-y-6">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">Kiroween 2026 · Frankenstein</p>
          <h1 className="font-display text-6xl leading-none text-primary glow md:text-8xl">GGTF</h1>
          <p className="font-display text-3xl text-foreground md:text-4xl">Ghost Gibberlink Transmission Framework</p>
          <p className="max-w-xl text-lg text-muted-foreground">
            Talk to machines through the dead air. Two browsers pair, encrypt and chat using nothing but a speaker and a microphone.
            No Wi-Fi, no Bluetooth, no cable.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/link" className={buttonVariants({ size: "lg" })}>
              Open the séance link
            </Link>
            <Link href="/lab" className={buttonVariants({ size: "lg", variant: "outline" })}>
              Visit the haunted lab
            </Link>
          </div>
        </div>
        <GhostSvg className="mx-auto hidden size-56 text-primary/80 drop-shadow-[0_0_50px_oklch(0.86_0.19_150/40%)] flicker md:block" />
      </section>

      <section className="grid gap-4 pb-12 md:grid-cols-3">
        {steps.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-2xl text-primary">
                <s.icon className="size-5" /> {s.title}
              </CardTitle>
              <CardDescription>{s.text}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="pb-12">
        <Card className="glow-box">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-3xl text-primary">
              <Laptop className="size-6" /> Try it on one computer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
              <li>Turn the speaker volume up and don&apos;t use headphones. The microphone has to hear the speaker.</li>
              <li>Open the séance link in two browser tabs (Chrome or Edge work best) and press “Open the séance” in both.</li>
              <li>Press “Call” in one tab. An “Accept” button appears in the other tab; press it.</li>
              <li>When both tabs show the same four words, press “They match” in both, then chat.</li>
            </ol>
            <p className="mt-4 text-sm text-muted-foreground">
              Every station ignores its own echo, so both tabs can share one speaker and one mic. Two separate devices in the same room work too.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 pb-16 sm:grid-cols-2">
        {parts.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <p.icon className="size-4 text-primary" /> {p.title}
              </CardTitle>
              <CardDescription>{p.text}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  );
}
