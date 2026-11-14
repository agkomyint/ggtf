"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { diag, installDiagHandlers } from "@/lib/ggtf/diag";
import { randomStationId, stationLabel } from "@/lib/ggtf/format";
import type {
  ChatMessage,
  LinkStateName,
  LogLine,
  ProfileInfo,
  ProfileName,
  StationEvent,
  StationStats,
} from "@/lib/ggtf/types";

export interface StationView {
  started: boolean;
  starting: boolean;
  error: string | null;
  id: number;
  sampleRate: number | null;
  state: LinkStateName;
  role: "caller" | "answerer" | null;
  peer: number | null;
  profile: ProfileName;
  sas: string[] | null;
  localConfirmed: boolean;
  peerConfirmed: boolean;
  answer: boolean;
  incoming: number | null;
  /** Hex tag the incoming caller attached (Séance OS puts the spirit's app id here). */
  incomingTag: string;
  /** Tag of the call we answered, for the session's lifetime. */
  sessionTag: string;
  messages: ChatMessage[];
  log: LogLine[];
  stats: StationStats | null;
  profiles: ProfileInfo[];
  txKind: string | null;
  audioState: string | null;
  outLevel: number;
  outputDevice: string | null;
  band: number;
  ml: boolean;
  mlAvailable: boolean;
  volume: number;
  bands: BandInfo[];
  beam: { sending: boolean; id: number | null; round: number; chunks: number; text: string | null; bytes: number; startedAt: number; lastRoundSec: number | null; caught: number[] };
  /** Reply "caught it" to beams we receive. */
  beamReply: boolean;
  beamProgress: { id: number; from: number; have: number; count: number; got: string; firstAt: number } | null;
  beamInbox: { key: string; id: number; from: number; text: string; b64: string; bytes: number; at: number; seconds: number | null }[];
}

export interface BandInfo {
  id: number;
  name: "low" | "mid" | "high";
  lo_hz: number;
  hi_hz: number;
}

const MAX_LOG = 200;

export function useStation() {
  const [view, setView] = useState<StationView>(() => ({
    started: false,
    starting: false,
    error: null,
    id: 0,
    sampleRate: null,
    state: "idle",
    role: null,
    peer: null,
    profile: "wraith",
    sas: null,
    localConfirmed: false,
    peerConfirmed: false,
    answer: false,
    incoming: null,
    incomingTag: "",
    sessionTag: "",
    messages: [],
    log: [],
    stats: null,
    profiles: [],
    txKind: null,
    audioState: null,
    outLevel: 0,
    outputDevice: null,
    band: 1,
    ml: true,
    mlAvailable: false,
    volume: 1,
    bands: [],
    beam: { sending: false, id: null, round: 0, chunks: 0, text: null, bytes: 0, startedAt: 0, lastRoundSec: null, caught: [] },
    beamReply: true,
    beamProgress: null,
    beamInbox: [],
  }));
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const logKey = useRef(0);
  const msgKey = useRef(0);
  const listeners = useRef(new Set<(e: StationEvent) => void>());
  const pendingSends = useRef(new Map<string, (id: number) => void>());

  /** Raw station events for code that isn't React state (the Séance OS link transport). */
  const subscribe = useCallback((fn: (e: StationEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    installDiagHandlers();
    setView((v) => ({ ...v, id: randomStationId() }));
    return () => {
      workerRef.current?.terminate();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close();
    };
  }, []);

  const addLog = useCallback((text: string, tone: LogLine["tone"] = "info") => {
    diag("log", { text });
    setView((v) => {
      const line: LogLine = { key: logKey.current++, at: Date.now(), text, tone };
      return { ...v, log: [...v.log, line].slice(-MAX_LOG) };
    });
  }, []);

  const handleEvent = useCallback(
    (e: StationEvent) => {
      for (const fn of listeners.current) {
        try {
          fn(e);
        } catch (err) {
          console.error(err);
        }
      }
      switch (e.type) {
        case "state":
          setView((v) => ({
            ...v,
            state: e.state,
            role: e.role,
            peer: e.peer,
            profile: e.profile,
            ...(e.state === "idle" ? { sas: null, localConfirmed: false, peerConfirmed: false, sessionTag: "" } : { incoming: null }),
          }));
          addLog(`state → ${e.state}${e.peer ? ` with ${stationLabel(e.peer)}` : ""}`, e.state === "connected" ? "good" : "info");
          if (e.state === "connected") toast.success("Connected through the dead air", { description: `Encrypted link, ${e.profile} profile` });
          break;
        case "sas":
          setView((v) => ({ ...v, sas: e.words }));
          addLog(`pairing words: ${e.words.join(" · ")}`, "good");
          break;
        case "peer_confirmed":
          setView((v) => ({ ...v, peerConfirmed: true }));
          addLog("the other side confirmed the words", "good");
          break;
        case "trained":
          addLog(`line test passed for ${["wraith", "specter", "banshee", "poltergeist"].filter((_, i) => e.mask & (1 << i)).join(", ") || "nothing"}; using ${e.profile}`, "good");
          break;
        case "msg_status":
          setView((v) => ({
            ...v,
            messages: v.messages.map((m) => (m.dir === "out" && m.id === e.id ? { ...m, status: e.status } : m)),
          }));
          if (e.status === "failed") toast.error("A message didn't make it across");
          break;
        case "msg_rx":
          if (e.kind !== 0) {
            addLog(`← message kind ${e.kind} (${e.bytes} bytes)`, "rx");
            break;
          }
          setView((v) => ({
            ...v,
            messages: [...v.messages, { key: `in-${msgKey.current++}`, id: null, dir: "in", text: e.text, status: "received", at: Date.now() }],
          }));
          break;
        case "retry":
          addLog(`no reply, resending ${e.what} (attempt ${e.attempt}, ${e.profile})`, "warn");
          break;
        case "log":
          addLog(e.text);
          break;
        case "ended":
          addLog(`session ended: ${e.reason}`, "warn");
          toast(e.reason.charAt(0).toUpperCase() + e.reason.slice(1));
          break;
        case "incoming":
          setView((v) => ({ ...v, incoming: e.from, incomingTag: e.tag }));
          addLog(`incoming call from ${stationLabel(e.from)}${e.tag ? ` (tag ${e.tag})` : ""}`, "good");
          break;
        case "answering":
          setView((v) => ({ ...v, sessionTag: e.tag }));
          break;
        case "incoming_gone":
          setView((v) => ({ ...v, incoming: null, incomingTag: "" }));
          break;
        case "beam_progress":
          setView((v) => ({
            ...v,
            beamProgress: {
              id: e.id,
              from: e.from,
              have: e.have,
              count: e.count,
              got: e.got,
              firstAt: v.beamProgress && v.beamProgress.id === e.id && v.beamProgress.from === e.from ? v.beamProgress.firstAt : Date.now(),
            },
          }));
          break;
        case "beam_rx":
          setView((v) =>
            v.beamInbox.some((b) => b.id === e.id && b.from === e.from)
              ? v
              : {
                  ...v,
                  beamProgress: null,
                  beamInbox: [
                    {
                      key: `${e.from}-${e.id}`,
                      id: e.id,
                      from: e.from,
                      text: e.text,
                      b64: e.b64,
                      bytes: e.bytes,
                      at: Date.now(),
                      seconds: v.beamProgress && v.beamProgress.id === e.id ? (Date.now() - v.beamProgress.firstAt) / 1000 : null,
                    },
                    ...v.beamInbox,
                  ],
                },
          );
          addLog(`beam received from ${stationLabel(e.from)} (${e.bytes} bytes)`, "good");
          toast.success("Caught a beam from the ether", { description: e.b64.startsWith("AEdJ") ? `an image, ${e.bytes} bytes` : e.text.length > 60 ? e.text.slice(0, 60) + "…" : e.text });
          break;
        case "beam_round":
          setView((v) => {
            const sec = (Date.now() - v.beam.startedAt) / 1000 / Math.max(1, e.round);
            return { ...v, beam: { ...v.beam, round: e.round, chunks: e.chunks, lastRoundSec: sec } };
          });
          break;
        case "beam_stopped":
          setView((v) => ({ ...v, beam: { ...v.beam, sending: false } }));
          addLog(`beam stopped after ${e.rounds} round${e.rounds === 1 ? "" : "s"}`);
          break;
        case "beam_caught":
          setView((v) => (v.beam.id !== e.id || v.beam.caught.includes(e.by) ? v : { ...v, beam: { ...v.beam, caught: [...v.beam.caught, e.by] } }));
          addLog(`station ${stationLabel(e.by)} caught the beam`, "good");
          toast.success("Your beam was caught", { description: `by station ${stationLabel(e.by)}` });
          break;
        case "detect":
          break;
        case "rx_failed":
          addLog(`heard a ${e.stage === "marker" ? "preamble" : e.stage} but couldn't decode it`, "warn");
          break;
        case "rx_frame":
          if (!e.own) addLog(`← ${e.kind} from ${stationLabel(e.from)} (${e.profile}, ${e.band} band, ${e.snr.toFixed(1)} dB)`, "rx");
          break;
        case "tx":
          setView((v) => ({ ...v, txKind: e.kind }));
          addLog(`→ ${e.kind} (${e.profile}, ${(e.ms / 1000).toFixed(2)} s)`, "tx");
          break;
      }
    },
    [addLog],
  );

  const start = useCallback(async () => {
    if (workerRef.current || view.starting) return;
    setView((v) => ({ ...v, starting: true, error: null }));
    try {
      if (!window.isSecureContext) throw new Error("The microphone needs HTTPS or localhost.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      streamRef.current = stream;
      navigator.mediaDevices.enumerateDevices().then((ds) => {
        const out = ds.find((d) => d.kind === "audiooutput" && d.deviceId === "default") ?? ds.find((d) => d.kind === "audiooutput");
        setView((v) => ({ ...v, outputDevice: out?.label || null }));
      }).catch(() => {});

      let ctx: AudioContext;
      let src: MediaStreamAudioSourceNode;
      try {
        ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
        src = ctx.createMediaStreamSource(stream);
      } catch {
        // Some browsers refuse a context rate that differs from the mic; the worklet resamples instead.
        ctx = new AudioContext({ latencyHint: "interactive" });
        src = ctx.createMediaStreamSource(stream);
      }
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/audio/ggtf-processor.js");
      const node = new AudioWorkletNode(ctx, "ggtf-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 1,
        channelCountMode: "explicit",
      });
      src.connect(node);
      node.connect(ctx.destination);
      nodeRef.current = node;
      node.port.postMessage({ type: "volume", value: view.volume });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      src.connect(analyser);
      analyserRef.current = analyser;
      // Output meter: lets the UI (and tests) confirm sound really leaves the speaker.
      const outMeter = ctx.createAnalyser();
      outMeter.fftSize = 2048;
      node.connect(outMeter);
      (window as unknown as { __ggtf?: object }).__ggtf = { ctx, node, outMeter, inMeter: analyser, stream };
      const track = stream.getAudioTracks()[0];
      diag("mic", { label: track?.label, settings: track?.getSettings(), ctxRate: ctx.sampleRate, baseLatency: ctx.baseLatency });

      const worker = new Worker("/audio/ggtf-worker.js", { type: "module" });
      workerRef.current = worker;
      const channel = new MessageChannel();
      node.port.postMessage({ type: "port", port: channel.port1 }, [channel.port1]);

      await new Promise<void>((resolve, reject) => {
        worker.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === "ready") {
            setView((v) => ({ ...v, profiles: m.profiles, bands: m.bands, mlAvailable: !!m.mlAvailable, ml: v.ml && !!m.mlAvailable }));
            resolve();
          } else if (m.type === "events") {
            (m.events as StationEvent[]).forEach(handleEvent);
          } else if (m.type === "stats") {
            setView((v) => ({ ...v, stats: m.stats, txKind: m.stats.transmitting ? v.txKind : null }));
          } else if (m.type === "ml") {
            setView((v) => ({ ...v, ml: !!m.on }));
          } else if (m.type === "beam-started") {
            setView((v) => ({ ...v, beam: { ...v.beam, sending: m.id >= 0, id: m.id >= 0 ? m.id : null, round: 0, bytes: m.bytes ?? 0, startedAt: Date.now(), lastRoundSec: null, caught: [] } }));
          } else if (m.type === "sent-bytes") {
            pendingSends.current.get(m.ref)?.(m.id);
            pendingSends.current.delete(m.ref);
          } else if (m.type === "sent") {
            setView((v) => ({
              ...v,
              messages:
                m.id >= 0
                  ? v.messages.map((x) => (x.key === m.ref ? { ...x, id: m.id } : x))
                  : v.messages.map((x) => (x.key === m.ref ? { ...x, status: "failed" } : x)),
            }));
          } else if (m.type === "error") {
            addLog(`worker error: ${m.message}`, "warn");
            reject(new Error(m.message));
          }
        };
        worker.onerror = (err) => reject(new Error(err.message || "worker failed to load"));
        worker.postMessage(
          { type: "init-station", id: view.id, seed: view.id * 7919 + Date.now() % 100000, answer: view.answer, band: view.band, ml: view.ml, beamReply: view.beamReply, port: channel.port2 },
          [channel.port2],
        );
      });
      await ctx.resume();
      setView((v) => ({ ...v, started: true, starting: false, sampleRate: ctx.sampleRate }));
      addLog(`station ${stationLabel(view.id)} listening at ${ctx.sampleRate} Hz`, "good");
      if (ctx.sampleRate !== 48000) addLog(`device runs at ${ctx.sampleRate} Hz; resampling to 48 kHz`, "warn");
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the address bar and try again."
          : err instanceof Error
            ? err.message
            : String(err);
      workerRef.current?.terminate();
      workerRef.current = null;
      diag("start_failed", { message: msg, name: err instanceof Error ? err.name : typeof err });
      setView((v) => ({ ...v, starting: false, error: msg }));
    }
  }, [view.starting, view.id, view.answer, view.band, view.ml, view.beamReply, view.volume, handleEvent, addLog]);

  const post = useCallback((m: Record<string, unknown>) => {
    diag("action", { action: m.type, hasWorker: !!workerRef.current, audio: ctxRef.current?.state ?? null });
    workerRef.current?.postMessage(m);
  }, []);

  // Snapshot every 2 s so problems can be diagnosed from the server log.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const t = setInterval(() => {
      const v = viewRef.current;
      diag("snapshot", {
        started: v.started, error: v.error, state: v.state, audio: ctxRef.current?.state ?? null, rate: v.sampleRate,
        outLevel: Number(v.outLevel.toFixed(3)), micPeak: v.stats ? Number(v.stats.peak.toFixed(3)) : null,
        transmitting: v.stats?.transmitting ?? null, busy: v.stats?.busy ?? null, tx: v.stats?.tx_frames ?? null,
        detections: v.stats?.detections ?? null, frames: v.stats?.frames ?? null, out: v.outputDevice, visible: document.visibilityState,
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  // Browsers may suspend audio (tab switch, device change). Every button press resumes it.
  const wake = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== "running") {
      ctx.resume().then(() => setView((v) => ({ ...v, audioState: ctx.state })));
    }
  }, []);

  // Poll the speaker output and audio engine state for the meters.
  useEffect(() => {
    if (!view.started) return;
    const t = setInterval(() => {
      const g = (window as unknown as { __ggtf?: { ctx: AudioContext; outMeter: AnalyserNode } }).__ggtf;
      if (!g) return;
      const d = new Float32Array(g.outMeter.fftSize);
      g.outMeter.getFloatTimeDomainData(d);
      let peak = 0;
      for (const x of d) peak = Math.max(peak, Math.abs(x));
      setView((v) => (v.audioState === g.ctx.state && Math.abs(v.outLevel - peak) < 0.01 ? v : { ...v, audioState: g.ctx.state, outLevel: peak }));
    }, 100);
    return () => clearInterval(t);
  }, [view.started]);

  /** Plays a 0.6 s two-tone beep straight to the speaker, bypassing the modem. */
  const testSpeaker = useCallback(async () => {
    const ctx = ctxRef.current ?? new AudioContext();
    if (!ctxRef.current) ctxRef.current = ctx;
    await ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(1500, ctx.currentTime);
    osc.frequency.setValueAtTime(3000, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    const g = (window as unknown as { __ggtf?: { outMeter: AnalyserNode } }).__ggtf;
    if (g) gain.connect(g.outMeter);
    osc.start();
    osc.stop(ctx.currentTime + 0.65);
    addLog(`test beep played (audio engine ${ctx.state})`, "tx");
  }, [addLog]);

  const call = useCallback(() => {
    wake();
    post({ type: "call" });
  }, [post, wake]);
  /** Calls with a tag (up to 16 bytes) shown to the answerer. */
  const callTagged = useCallback(
    (tag: Uint8Array) => {
      wake();
      post({ type: "call", tag });
    },
    [post, wake],
  );
  /** Sends a binary message over the connected link. Resolves to the link message id, or -1. */
  const sendBytes = useCallback(
    (kind: number, bytes: Uint8Array) =>
      new Promise<number>((resolve) => {
        if (!workerRef.current) return resolve(-1);
        const ref = `b-${msgKey.current++}`;
        pendingSends.current.set(ref, resolve);
        workerRef.current.postMessage({ type: "send-bytes", kind, bytes, ref });
      }),
    [],
  );
  const accept = useCallback(() => {
    wake();
    setView((v) => ({ ...v, incoming: null }));
    post({ type: "accept" });
  }, [post, wake]);
  const decline = useCallback(() => {
    setView((v) => ({ ...v, incoming: null }));
    post({ type: "decline" });
  }, [post]);
  const hangup = useCallback(() => post({ type: "hangup" }), [post]);
  const reject = useCallback(() => post({ type: "reject" }), [post]);
  const confirm = useCallback(() => {
    setView((v) => ({ ...v, localConfirmed: true }));
    post({ type: "confirm" });
  }, [post]);
  const setAnswer = useCallback(
    (on: boolean) => {
      setView((v) => ({ ...v, answer: on }));
      post({ type: "answer", on });
    },
    [post],
  );
  const setBand = useCallback(
    (band: number) => {
      setView((v) => ({ ...v, band }));
      post({ type: "band", band });
    },
    [post],
  );
  const setMl = useCallback(
    (on: boolean) => {
      setView((v) => ({ ...v, ml: on }));
      post({ type: "ml", on });
    },
    [post],
  );
  const setVolume = useCallback((value: number) => {
    setView((v) => ({ ...v, volume: value }));
    nodeRef.current?.port.postMessage({ type: "volume", value });
  }, []);
  /** Starts a beam of text or raw bytes (images). `chunk` = bytes per frame. `stopOnCatch` ends it on the first reply. */
  const beamStart = useCallback(
    (content: string | Uint8Array, profile: number, rounds = 0, chunk = 48, stopOnCatch = false) => {
      wake();
      const text = typeof content === "string" ? content : null;
      setView((v) => ({ ...v, beam: { sending: true, id: null, round: 0, chunks: 0, text, bytes: 0, startedAt: Date.now(), lastRoundSec: null, caught: [] } }));
      if (typeof content === "string") post({ type: "beam-start", text: content, profile, band: viewRef.current.band, rounds, chunk, stopOnCatch });
      else post({ type: "beam-start", bytes: content, profile, band: viewRef.current.band, rounds, chunk, stopOnCatch });
    },
    [post, wake],
  );
  const beamStop = useCallback(() => post({ type: "beam-stop" }), [post]);
  const setBeamReply = useCallback(
    (on: boolean) => {
      setView((v) => ({ ...v, beamReply: on }));
      post({ type: "beam-reply", on });
    },
    [post],
  );
  const send = useCallback(
    (text: string) => {
      const ref = `out-${msgKey.current++}`;
      setView((v) => ({
        ...v,
        messages: [...v.messages, { key: ref, id: null, dir: "out", text, status: "queued", at: Date.now() }],
      }));
      post({ type: "send", text, ref });
    },
    [post],
  );

  return { view, analyser: analyserRef, start, call, callTagged, accept, decline, hangup, reject, confirm, setAnswer, send, sendBytes, subscribe, testSpeaker, setBand, setMl, setVolume, beamStart, beamStop, setBeamReply };
}
