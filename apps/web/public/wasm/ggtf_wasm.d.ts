/* tslint:disable */
/* eslint-disable */

export class WasmStation {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Picks up a pending incoming call. Returns false if there is none (or it expired).
     */
    accept(now: number): boolean;
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
    stats(): string;
    take_events(): string;
    tick(now: number): void;
    tx_done(now: number): void;
}

export function bench_run(scenario_index: number, profile: number, frames: number, payload_len: number, seed: number): string;

/**
 * One degraded test frame as audio, for the "listen" button in the lab.
 */
export function bench_sample(scenario_index: number, profile: number, payload_len: number, seed: number): Float32Array;

export function profiles_json(): string;

export function scenarios_json(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmstation_free: (a: number, b: number) => void;
    readonly bench_run: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly bench_sample: (a: number, b: number, c: number, d: number) => [number, number];
    readonly profiles_json: () => [number, number];
    readonly scenarios_json: () => [number, number];
    readonly wasmstation_accept: (a: number, b: number) => number;
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
