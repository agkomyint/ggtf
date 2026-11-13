"use client";

import { useEffect, useRef } from "react";

const MAX_HZ = 20000;
const BANDS = [
  { lo: 500, hi: 4100, label: "low" },
  { lo: 1500, hi: 5100, label: "mid" },
  { lo: 14500, hi: 18100, label: "high" },
];

/** Scrolling waterfall of the microphone input, 0 to 20 kHz, with the three GGTF bands marked. */
export function Spectrogram({ analyser, active }: { analyser: React.RefObject<AnalyserNode | null>; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      ctx.fillStyle = "#050a07";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let data: Uint8Array<ArrayBuffer> | null = null;
    const column = (v: number) => {
      // black -> violet -> phosphor green -> white
      const t = v / 255;
      const r = Math.round(t < 0.5 ? 120 * t * 2 : 120 - 60 * (t - 0.5) * 2 + 135 * Math.max(0, t - 0.85) * 6);
      const g = Math.round(t < 0.4 ? 10 * t : 255 * Math.min(1, (t - 0.4) / 0.5));
      const b = Math.round(t < 0.5 ? 200 * t * 2 : 200 - 80 * (t - 0.5) * 2);
      return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const a = analyser.current;
      const w = canvas.width;
      const h = canvas.height;
      const step = Math.max(1, Math.round(2 * dpr));
      ctx.drawImage(canvas, -step, 0);
      ctx.fillStyle = "#050a07";
      ctx.fillRect(w - step, 0, step, h);
      if (a && active) {
        if (!data || data.length !== a.frequencyBinCount) data = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(data);
        const nyq = a.context.sampleRate / 2;
        for (let y = 0; y < h; y++) {
          const hz = (1 - y / h) * MAX_HZ;
          const v = data[Math.min(data.length - 1, Math.floor((hz / nyq) * data.length))];
          if (v < 8) continue;
          ctx.fillStyle = column(v);
          ctx.fillRect(w - step, y, step, 1);
        }
      }
      // band guides
      ctx.save();
      ctx.setLineDash([4 * dpr, 6 * dpr]);
      ctx.strokeStyle = "rgba(160, 255, 190, 0.25)";
      ctx.lineWidth = dpr;
      for (const b of BANDS) {
        for (const f of [b.lo, b.hi]) {
          const y = (1 - f / MAX_HZ) * h;
          ctx.beginPath();
          ctx.moveTo(w - step, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [analyser, active]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-[#050a07] scanlines">
      <canvas ref={canvasRef} className="block h-56 w-full" aria-label="Live spectrogram of the microphone input" role="img" />
      <div className="pointer-events-none absolute inset-y-0 left-2 flex flex-col justify-between py-1 text-[10px] text-muted-foreground font-mono">
        <span>20 kHz</span>
        <span>15</span>
        <span>10</span>
        <span>5</span>
        <span>0</span>
      </div>
      {!active && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">The line is silent. Open the séance to listen.</div>
      )}
    </div>
  );
}
