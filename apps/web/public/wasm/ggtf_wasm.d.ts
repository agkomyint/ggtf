/* tslint:disable */
/* eslint-disable */

/**
 * Two real stations on simulated air. Events come back tagged with `side` 0 (A) or 1 (B).
 */
export class WasmDuo {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Station A calls B; both sides confirm automatically.
     */
    connect(): void;
    hangup(side: number): void;
    link(side: number): string;
    constructor(seed: number);
    now(): number;
    /**
     * Advances simulated time by `ms`.
     */
    run(ms: number): void;
    send(side: number, kind: number, data: Uint8Array | number[]): number;
    /**
     * Band for the next call (0 low, 1 mid, 2 high). The answerer adopts the caller's band.
     */
    set_band(b: number): void;
    set_loss(p: number): void;
    set_noise(sigma: number): void;
    state(side: number): string;
    take_events(): string;
}

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
    /**
     * Calls with a tag (up to 16 bytes) that the answerer sees with the incoming call.
     */
    call_tagged(tag: Uint8Array | number[], now: number): void;
    confirm(now: number): void;
    decline(): void;
    hangup(now: number): void;
    id(): number;
    constructor(id: number, seed: number);
    poll_tx(now: number): Float32Array | undefined;
    push_samples(samples: Float32Array | number[], now: number): void;
    reject(now: number): void;
    /**
     * Sends a binary message (kind 0 text, 1 GGTP). Returns the message id, or -1.
     */
    send_bytes(kind: number, data: Uint8Array | number[], now: number): number;
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
     * Keep-alive interval in ms while connected and idle; 0 turns it off.
     */
    set_keepalive(ms: number): void;
    /**
     * Turns the ML symbol decoder on or off. Returns whether ML is now active.
     */
    set_ml(on: boolean): boolean;
    /**
     * Lets the link pick the experimental Turbo profile (off by default).
     */
    set_turbo(on: boolean): void;
    stats(): string;
    take_events(): string;
    tick(now: number): void;
    tx_done(now: number): void;
}

/**
 * Public key (32 bytes) for a 32-byte author secret. Empty if the secret has the wrong length.
 */
export function author_public(secret: Uint8Array | number[]): Uint8Array;

/**
 * The 4 author words for a public key, as a JSON array.
 */
export function author_words(_public: Uint8Array | number[]): string;

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

/**
 * Verifies and unpacks a bundle: `{ok, error?, author, words, hash, source, bytes}`.
 */
export function bundle_open(data: Uint8Array | number[]): string;

/**
 * Compresses and signs a spirit source. Empty on failure (bad secret, source over 256 KB).
 */
export function bundle_pack(secret: Uint8Array | number[], source: string): Uint8Array;

export function is_bundle(data: Uint8Array | number[]): boolean;

export function ml_available(): boolean;

export function profiles_json(): string;

export function scenarios_json(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmduo_free: (a: number, b: number) => void;
    readonly __wbg_wasmstation_free: (a: number, b: number) => void;
    readonly author_public: (a: number, b: number) => [number, number];
    readonly author_words: (a: number, b: number) => [number, number];
    readonly bands_json: () => [number, number];
    readonly beam_round_seconds: (a: number, b: number, c: number) => number;
    readonly bench_run: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly bench_sample: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly bundle_open: (a: number, b: number) => [number, number];
    readonly bundle_pack: (a: number, b: number, c: number, d: number) => [number, number];
    readonly is_bundle: (a: number, b: number) => number;
    readonly ml_available: () => number;
    readonly profiles_json: () => [number, number];
    readonly scenarios_json: () => [number, number];
    readonly wasmduo_connect: (a: number) => void;
    readonly wasmduo_hangup: (a: number, b: number) => void;
    readonly wasmduo_link: (a: number, b: number) => [number, number];
    readonly wasmduo_new: (a: number) => number;
    readonly wasmduo_now: (a: number) => number;
    readonly wasmduo_run: (a: number, b: number) => void;
    readonly wasmduo_send: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly wasmduo_set_band: (a: number, b: number) => void;
    readonly wasmduo_set_loss: (a: number, b: number) => void;
    readonly wasmduo_set_noise: (a: number, b: number) => void;
    readonly wasmduo_state: (a: number, b: number) => [number, number];
    readonly wasmduo_take_events: (a: number) => [number, number];
    readonly wasmstation_accept: (a: number, b: number) => number;
    readonly wasmstation_beam_start: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly wasmstation_beam_start_bytes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly wasmstation_beam_stop: (a: number) => void;
    readonly wasmstation_call: (a: number, b: number) => void;
    readonly wasmstation_call_tagged: (a: number, b: number, c: number, d: number) => void;
    readonly wasmstation_confirm: (a: number, b: number) => void;
    readonly wasmstation_decline: (a: number) => void;
    readonly wasmstation_hangup: (a: number, b: number) => void;
    readonly wasmstation_id: (a: number) => number;
    readonly wasmstation_new: (a: number, b: number) => number;
    readonly wasmstation_poll_tx: (a: number, b: number) => [number, number];
    readonly wasmstation_push_samples: (a: number, b: number, c: number, d: number) => void;
    readonly wasmstation_reject: (a: number, b: number) => void;
    readonly wasmstation_send_bytes: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly wasmstation_send_text: (a: number, b: number, c: number, d: number) => number;
    readonly wasmstation_set_answer: (a: number, b: number) => void;
    readonly wasmstation_set_band: (a: number, b: number) => void;
    readonly wasmstation_set_keepalive: (a: number, b: number) => void;
    readonly wasmstation_set_ml: (a: number, b: number) => number;
    readonly wasmstation_set_turbo: (a: number, b: number) => void;
    readonly wasmstation_stats: (a: number) => [number, number];
    readonly wasmstation_take_events: (a: number) => [number, number];
    readonly wasmstation_tick: (a: number, b: number) => void;
    readonly wasmstation_tx_done: (a: number, b: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
