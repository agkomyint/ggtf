# Structure steering

```
crates/ggtf-core/src/     modem, frame, fec, receiver, link, crypto, station, beam,
                          bundle (signed spirits), duo (sim air), sim, bench, ml
crates/ggtf-core/tests/   modem, properties, session, link_upgrades
crates/ggtf-wasm/         wasm-bindgen API: WasmStation, WasmDuo, bundle_*, bench_*
apps/web/app/             routes: / link beam haunt lab seance studio docs api/diag
apps/web/components/ggtf/     link, beam, haunt, lab consoles and shared audio UI
apps/web/components/seance/   Séance OS: library, install dialog, spirit window, frame
apps/web/components/studio/   Spirit Studio and the CodeMirror editor
apps/web/hooks/use-station.ts the browser station (mic, worklet, worker, events)
apps/web/lib/ggtf/        link UI helpers, beam helpers, types
apps/web/lib/seance/      ggtp, ghostdb, session, transport, sim-air, runtime (SDK),
                          host, bundle, tools (worker client), store (IndexedDB),
                          library, starters, templates, trace
apps/web/public/audio/    AudioWorklet processor and the WASM worker
apps/web/public/wasm/     built WASM (committed)
apps/web/public/spirits/  signed starter spirits (committed)
ml/                       training script and exported model
scripts/                  build, benchmarks, Chrome checks, screenshots, starter packing
.kiro/specs/ggtf/         modem, link, beam, ML spec
.kiro/specs/seance-os/    app platform spec (link upgrades, GGTP, GhostDB, Studio, OS)
```

Where new code goes:
- Anything that touches samples, frames or keys belongs in `ggtf-core`, exposed through `ggtf-wasm`.
- Protocol logic above the link belongs in `lib/seance` as plain TypeScript with a test.
- Page UI goes in `components/<area>`; route files in `app/` stay thin.
- New starter spirits are added to `lib/seance/templates.ts`, then re-signed with `scripts/pack-starters.ts`.
