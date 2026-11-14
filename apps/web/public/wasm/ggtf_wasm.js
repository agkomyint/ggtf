/* @ts-self-types="./ggtf_wasm.d.ts" */

/**
 * Two real stations on simulated air. Events come back tagged with `side` 0 (A) or 1 (B).
 */
export class WasmDuo {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmDuoFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmduo_free(ptr, 0);
    }
    /**
     * Station A calls B; both sides confirm automatically.
     */
    connect() {
        wasm.wasmduo_connect(this.__wbg_ptr);
    }
    /**
     * @param {number} side
     */
    hangup(side) {
        wasm.wasmduo_hangup(this.__wbg_ptr, side);
    }
    /**
     * @param {number} side
     * @returns {string}
     */
    link(side) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmduo_link(this.__wbg_ptr, side);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} seed
     */
    constructor(seed) {
        const ret = wasm.wasmduo_new(seed);
        this.__wbg_ptr = ret;
        WasmDuoFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    now() {
        const ret = wasm.wasmduo_now(this.__wbg_ptr);
        return ret;
    }
    /**
     * Advances simulated time by `ms`.
     * @param {number} ms
     */
    run(ms) {
        wasm.wasmduo_run(this.__wbg_ptr, ms);
    }
    /**
     * @param {number} side
     * @param {number} kind
     * @param {Uint8Array | number[]} data
     * @returns {number}
     */
    send(side, kind, data) {
        const val2 = +side;
        const val3 = +kind;
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmduo_send(this.__wbg_ptr, val2, val3, ptr0, len0);
        return ret;
    }
    /**
     * Band for the next call (0 low, 1 mid, 2 high). The answerer adopts the caller's band.
     * @param {number} b
     */
    set_band(b) {
        wasm.wasmduo_set_band(this.__wbg_ptr, b);
    }
    /**
     * @param {number} p
     */
    set_loss(p) {
        wasm.wasmduo_set_loss(this.__wbg_ptr, p);
    }
    /**
     * @param {number} sigma
     */
    set_noise(sigma) {
        wasm.wasmduo_set_noise(this.__wbg_ptr, sigma);
    }
    /**
     * @param {number} side
     * @returns {string}
     */
    state(side) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmduo_state(this.__wbg_ptr, side);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    take_events() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmduo_take_events(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmDuo.prototype[Symbol.dispose] = WasmDuo.prototype.free;

export class WasmStation {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmStationFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmstation_free(ptr, 0);
    }
    /**
     * Picks up a pending incoming call. Returns false if there is none (or it expired).
     * @param {number} now
     * @returns {boolean}
     */
    accept(now) {
        const ret = wasm.wasmstation_accept(this.__wbg_ptr, now);
        return ret !== 0;
    }
    /**
     * Starts broadcasting `text`. `rounds` 0 = until stopped. Returns the beam id, or -1.
     * @param {string} text
     * @param {number} profile_id
     * @param {number} band_id
     * @param {number} rounds
     * @returns {number}
     */
    beam_start(text, profile_id, band_id, rounds) {
        const val2 = +profile_id;
        const val3 = +band_id;
        const val4 = +rounds;
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstation_beam_start(this.__wbg_ptr, ptr0, len0, val2, val3, val4);
        return ret;
    }
    /**
     * Broadcasts raw bytes (used for images). `chunk` is the bytes per frame (16 to 196).
     * @param {Uint8Array | number[]} data
     * @param {number} profile_id
     * @param {number} band_id
     * @param {number} rounds
     * @param {number} chunk
     * @returns {number}
     */
    beam_start_bytes(data, profile_id, band_id, rounds, chunk) {
        const val2 = +profile_id;
        const val3 = +band_id;
        const val4 = +rounds;
        const val5 = +chunk;
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstation_beam_start_bytes(this.__wbg_ptr, ptr0, len0, val2, val3, val4, val5);
        return ret;
    }
    beam_stop() {
        wasm.wasmstation_beam_stop(this.__wbg_ptr);
    }
    /**
     * @param {number} now
     */
    call(now) {
        wasm.wasmstation_call(this.__wbg_ptr, now);
    }
    /**
     * Calls with a tag (up to 16 bytes) that the answerer sees with the incoming call.
     * @param {Uint8Array | number[]} tag
     * @param {number} now
     */
    call_tagged(tag, now) {
        const val2 = +now;
        const ptr0 = passArray8ToWasm0(tag, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmstation_call_tagged(this.__wbg_ptr, ptr0, len0, val2);
    }
    /**
     * @param {number} now
     */
    confirm(now) {
        wasm.wasmstation_confirm(this.__wbg_ptr, now);
    }
    decline() {
        wasm.wasmstation_decline(this.__wbg_ptr);
    }
    /**
     * @param {number} now
     */
    hangup(now) {
        wasm.wasmstation_hangup(this.__wbg_ptr, now);
    }
    /**
     * @returns {number}
     */
    id() {
        const ret = wasm.wasmstation_id(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} id
     * @param {number} seed
     */
    constructor(id, seed) {
        const ret = wasm.wasmstation_new(id, seed);
        this.__wbg_ptr = ret;
        WasmStationFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} now
     * @returns {Float32Array | undefined}
     */
    poll_tx(now) {
        const ret = wasm.wasmstation_poll_tx(this.__wbg_ptr, now);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        }
        return v1;
    }
    /**
     * @param {Float32Array | number[]} samples
     * @param {number} now
     */
    push_samples(samples, now) {
        const val2 = +now;
        const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmstation_push_samples(this.__wbg_ptr, ptr0, len0, val2);
    }
    /**
     * @param {number} now
     */
    reject(now) {
        wasm.wasmstation_reject(this.__wbg_ptr, now);
    }
    /**
     * Sends a binary message (kind 0 text, 1 GGTP). Returns the message id, or -1.
     * @param {number} kind
     * @param {Uint8Array | number[]} data
     * @param {number} now
     * @returns {number}
     */
    send_bytes(kind, data, now) {
        const val2 = +kind;
        const val3 = +now;
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstation_send_bytes(this.__wbg_ptr, val2, ptr0, len0, val3);
        return ret;
    }
    /**
     * Returns the message id, or -1 when the link isn't connected.
     * @param {string} text
     * @param {number} now
     * @returns {number}
     */
    send_text(text, now) {
        const val2 = +now;
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmstation_send_text(this.__wbg_ptr, ptr0, len0, val2);
        return ret;
    }
    /**
     * @param {boolean} on
     */
    set_answer(on) {
        wasm.wasmstation_set_answer(this.__wbg_ptr, on);
    }
    /**
     * Band for outgoing calls and beams: 0 low, 1 mid, 2 high.
     * @param {number} b
     */
    set_band(b) {
        wasm.wasmstation_set_band(this.__wbg_ptr, b);
    }
    /**
     * Reply "caught it" to beams this station receives (on by default).
     * @param {boolean} on
     */
    set_beam_reply(on) {
        wasm.wasmstation_set_beam_reply(this.__wbg_ptr, on);
    }
    /**
     * Stop our beam when the first receiver replies.
     * @param {boolean} on
     */
    set_beam_stop_on_catch(on) {
        wasm.wasmstation_set_beam_stop_on_catch(this.__wbg_ptr, on);
    }
    /**
     * Keep-alive interval in ms while connected and idle; 0 turns it off.
     * @param {number} ms
     */
    set_keepalive(ms) {
        wasm.wasmstation_set_keepalive(this.__wbg_ptr, ms);
    }
    /**
     * Turns the ML symbol decoder on or off. Returns whether ML is now active.
     * @param {boolean} on
     * @returns {boolean}
     */
    set_ml(on) {
        const ret = wasm.wasmstation_set_ml(this.__wbg_ptr, on);
        return ret !== 0;
    }
    /**
     * Lets the link pick the experimental Turbo profile (off by default).
     * @param {boolean} on
     */
    set_turbo(on) {
        wasm.wasmstation_set_turbo(this.__wbg_ptr, on);
    }
    /**
     * @returns {string}
     */
    stats() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmstation_stats(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    take_events() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmstation_take_events(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {number} now
     */
    tick(now) {
        wasm.wasmstation_tick(this.__wbg_ptr, now);
    }
    /**
     * @param {number} now
     */
    tx_done(now) {
        wasm.wasmstation_tx_done(this.__wbg_ptr, now);
    }
}
if (Symbol.dispose) WasmStation.prototype[Symbol.dispose] = WasmStation.prototype.free;

/**
 * Public key (32 bytes) for a 32-byte author secret. Empty if the secret has the wrong length.
 * @param {Uint8Array | number[]} secret
 * @returns {Uint8Array}
 */
export function author_public(secret) {
    const ptr0 = passArray8ToWasm0(secret, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.author_public(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * The 4 author words for a public key, as a JSON array.
 * @param {Uint8Array | number[]} _public
 * @returns {string}
 */
export function author_words(_public) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(_public, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.author_words(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @returns {string}
 */
export function bands_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.bands_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Seconds of airtime for one beam round, computed by the real modem.
 * @param {number} bytes
 * @param {number} profile_id
 * @param {number} chunk
 * @returns {number}
 */
export function beam_round_seconds(bytes, profile_id, chunk) {
    const ret = wasm.beam_round_seconds(bytes, profile_id, chunk);
    return ret;
}

/**
 * @param {number} scenario_index
 * @param {number} profile_id
 * @param {number} band_id
 * @param {boolean} ml_on
 * @param {number} frames
 * @param {number} payload_len
 * @param {number} seed
 * @returns {string}
 */
export function bench_run(scenario_index, profile_id, band_id, ml_on, frames, payload_len, seed) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.bench_run(scenario_index, profile_id, band_id, ml_on, frames, payload_len, seed);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * One degraded test frame as audio, for the "listen" button in the lab.
 * @param {number} scenario_index
 * @param {number} profile_id
 * @param {number} band_id
 * @param {number} payload_len
 * @param {number} seed
 * @returns {Float32Array}
 */
export function bench_sample(scenario_index, profile_id, band_id, payload_len, seed) {
    const ret = wasm.bench_sample(scenario_index, profile_id, band_id, payload_len, seed);
    var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * Verifies and unpacks a bundle: `{ok, error?, author, words, hash, source, bytes}`.
 * @param {Uint8Array | number[]} data
 * @returns {string}
 */
export function bundle_open(data) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bundle_open(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Compresses and signs a spirit source. Empty on failure (bad secret, source over 256 KB).
 * @param {Uint8Array | number[]} secret
 * @param {string} source
 * @returns {Uint8Array}
 */
export function bundle_pack(secret, source) {
    let ptr0, len0, ptr1, len1;
    try {
        ptr0 = passArray8ToWasm0(secret, wasm.__wbindgen_malloc);
        len0 = WASM_VECTOR_LEN;
        ptr1 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        len1 = WASM_VECTOR_LEN;
    } catch (e) {
        if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
        if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
        throw e;
    }
    const ret = wasm.bundle_pack(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array | number[]} data
 * @returns {boolean}
 */
export function is_bundle(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_bundle(ptr0, len0);
    return ret !== 0;
}

/**
 * @returns {boolean}
 */
export function ml_available() {
    const ret = wasm.ml_available();
    return ret !== 0;
}

/**
 * @returns {string}
 */
export function profiles_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.profiles_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @returns {string}
 */
export function scenarios_json() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.scenarios_json();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_8b968c3ab8e96595: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_fc456fee5d3317de: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_crypto_23f565a907d30078: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_d2908e0b99612b91: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_d5f06fad6bf1409b: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_with_length_01b143a7e5dd5a3e: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_86166ff8ce1f2002: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_process_91f425a63f58e399: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_34b023059e3363de: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_9a7d8cc2e1d275c0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_58f388a9247ac0bb: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_6e128a981b0df859: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./ggtf_wasm_bg.js": import0,
    };
}

const WasmDuoFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmduo_free(ptr, 1));
const WasmStationFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmstation_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('ggtf_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
