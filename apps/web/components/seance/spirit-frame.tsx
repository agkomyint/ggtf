"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { SpiritRun } from "@/lib/seance/run";
import { cn } from "@/lib/utils";

/**
 * Renders a spirit in a sandboxed iframe: scripts only, opaque origin, CSP inside the document.
 * The host is attached before the document loads, so the spirit's first calls aren't lost.
 */
export function SpiritFrame({ run, title, className }: { run: SpiritRun; title: string; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useLayoutEffect(() => {
    run.host.attach(ref.current?.contentWindow ?? null);
    return () => run.host.attach(null);
  }, [run]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => run.host.handle(e);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [run]);

  return (
    <iframe
      ref={ref}
      title={title}
      // allow-forms only lets submit events fire; the CSP's form-action 'none' still blocks real posts.
      sandbox="allow-scripts allow-forms"
      srcDoc={run.srcdoc}
      referrerPolicy="no-referrer"
      className={cn("h-full w-full rounded-lg border border-border bg-[#07120c]", className)}
    />
  );
}
