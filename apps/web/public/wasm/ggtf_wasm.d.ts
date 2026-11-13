/* tslint:disable */
/* eslint-disable */

export class WasmStation {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Picks up a pending incoming call. Returns false if there is none (or it expired).
     */
    accept(now: number): boolean;
    /**
     * Starts broadcasting `text`. `rounds` 0 = until stopped. Returns the beam id, or -1.
     */
    beam_start(text: string, profile_id: number, band_id: number, rounds: number): number;
    /**
     * Broadcasts raw bytes (used for images). `chunk` is the bytes per frame (16 to 196).
     */
    beam_start_bytes(data: Uint8Array | number[], profile_id: number, band_id: number, rounds: number, chunk: number): number;
    beam_stop(): void;
    call(now: number): void;
    confirm(now: number): void;
    decline(): void;
    hangup(now: number): void;
    id(): number;
    constructor(id: number, seed: number);
    poll_tx(now: number): Float32Array | undefined;
    push_samples(samples: Float32Array | number[], now: number): void;
    reject(now: number): void;
    /**
     * Returns the message id, or -1 when the link isn't connected.
     */
    send_text(text: string, now: number): number;
    set_answer(on: boolean): void;
    /**
     * Band for outgoing calls and beams: 0 low, 1 mid, 2 high.
     */
    set_band(b: number): void;
    /**
     * Turns the ML symbol decoder on or off. Returns whether ML is now active.
     */
    set_ml(on: boolean): boolean;
    stats(): string;
    take_events(): string;
    tick(now: number): void;
    tx_done(now: number): void;
}

export function bands_json(): string;

/**
 * Seconds of airtime for one beam round, computed by the real modem.
 */
export function beam_round_seconds(bytes: number, profile_id: number, chunk: number): number;

export function bench_run(scenario_index: number, profile_id: number, band_id: number, ml_on: boolean, frames: number, payload_len: number, seed: number): string;

/**
 * One degraded test frame as audio, for the "listen" button in the lab.
 */
export function bench_sample(scenario_index: number, profile_id: number, band_id: number, payload_len: number, seed: number): Float32Array;

export function ml_available(): boolean;

export function profiles_json(): string;

export function scenarios_json(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmstation_free: (a: number, b: number) => void;
    readonly bands_json: () => [number, number];
    readonly beam_round_seconds: (a: number, b: number, c: number) => number;
    readonly bench_run: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly bench_sample: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly ml_available: () => number;
    readonly profiles_json: () => [number, number];
    readonly scenarios_json: () => [number, number];
    readonly wasmstation_accept: (a: number, b: number) => number;
    readonly wasmstation_beam_start: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly wasmstation_beam_start_bytes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly wasmstation_beam_stop: (a: number) => void;
    readonly wasmstation_call: (a: number, b: number) => void;
    readonly wasmstation_confirm: (a: number, b: number) => void;
    readonly wasmstation_decline: (a: number) => void;
    readonly wasmstation_hangup: (a: number, b: number) => void;
    readonly wasmstation_id: (a: number) => number;
    readonly wasmstation_new: (a: number, b: number) => number;
    readonly wasmstation_poll_tx: (a: number, b: number) => [number, number];
    readonly wasmstation_push_samples: (a: number, b: number, c: number, d: number) => void;
    readonly wasmstation_reject: (a: number, b: number) => void;
    readonly wasmstation_send_text: (a: number, b: number, c: number, d: number) => number;
    readonly wasmstation_set_answer: (a: number, b: number) => void;
    readonly wasmstation_set_band: (a: number, b: number) => void;
    readonly wasmstation_set_ml: (a: number, b: number) => number;
    readonly wasmstation_stats: (a: number) => [number, number];
    readonly wasmstation_take_events: (a: number) => [number, number];
    readonly wasmstation_tick: (a: number, b: number) => void;
    readonly wasmstation_tx_done: (a: number, b: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
