/* tslint:disable */
/* eslint-disable */

/**
 * Native ACK/window state for a SPICE channel.
 *
 * JS owns the socket handle, but the protocol decision of when an ACK is due
 * belongs here.
 */
export class SpiceAckState {
    free(): void;
    [Symbol.dispose](): void;
    configure(generation: number, window: number): number;
    constructor();
    observe_packet(): number;
    readonly ack_count: bigint;
    readonly ack_sync_count: bigint;
    readonly generation: number;
    readonly packet_serial: bigint;
    readonly packets_since_ack: number;
    readonly window: number;
}

/**
 * Native cache epoch table.
 *
 * Browser storage and GPU adapters may retain bytes/resources, but this table
 * decides whether a cached object is legal for current protocol state.
 */
export class SpiceCacheEpochs {
    free(): void;
    [Symbol.dispose](): void;
    bump_all(): bigint;
    bump_kind(kind: number): bigint;
    bump_resource(kind: number, id: bigint): bigint;
    claim(kind: number, id: bigint): bigint;
    clear(): void;
    epoch(kind: number, id: bigint): bigint;
    global_epoch(): bigint;
    is_current(kind: number, id: bigint, epoch: bigint): boolean;
    kind_count(): number;
    kind_epoch(kind: number): bigint;
    constructor();
    resource_count(): number;
}

export class SpiceEngine {
    free(): void;
    [Symbol.dispose](): void;
    check_visual_token(token: bigint): boolean;
    commit_visual_token(token: bigint): boolean;
    control(message: any): any;
    diagnostics(): any;
    dispose(): void;
    ingest_channel_bytes(channel_key: string, bytes: Uint8Array): any;
    constructor();
    open_channel(channel_key: string, channel_type: number, channel_id: number, connection_id: number): Uint8Array;
    submit_encrypted_ticket(channel_key: string, ticket: Uint8Array): Uint8Array;
}

export class SpiceMiniHeader {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly body_size: number;
    readonly message_type: number;
}

/**
 * WASM-owned visual mutation graph.
 *
 * JS may ask for claims and later ask whether a claim is still current, but JS
 * must not be the authority for stale visual commits.
 */
export class SpiceMutationGraph {
    free(): void;
    [Symbol.dispose](): void;
    add_wait_barrier(waits: Uint8Array): bigint;
    barrier_count(): number;
    bump_surface_generation(surface_id: number): number;
    cancel_plan(plan_token: bigint): number;
    check_token(token: bigint): number;
    check_token_for_surface(token: bigint, current_generation: number): number;
    claim_rect(surface_id: number, surface_generation: number, sequence_id: bigint, plan_token: bigint, left: number, top: number, right: number, bottom: number): bigint;
    clear(): void;
    commit_token(token: bigint): boolean;
    is_barrier_satisfied(barrier_id: bigint): boolean;
    constructor();
    observe_channel_serial(channel_type: number, channel_id: number, serial: bigint): number;
    owner_count(): number;
    release_token(token: bigint): boolean;
    set_surface_generation(surface_id: number, generation: number): void;
    surface_generation(surface_id: number): number;
    tombstone_count(): number;
}

export class SpiceNativeRuntime {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    check_visual_token(token: bigint): boolean;
    commit_visual_token(token: bigint): boolean;
    control(message: any): any;
    static createForOffscreenCanvas(canvas: OffscreenCanvas, width: number, height: number): Promise<SpiceNativeRuntime>;
    diagnostics(): any;
    dispose(): void;
    flushPendingNativeBitmapUploads(max_items: number): any;
    ingest_channel_bytes(channel_key: string, bytes: Uint8Array): any;
    open_channel(channel_key: string, channel_type: number, channel_id: number, connection_id: number): Uint8Array;
    presentPrimary(): boolean;
    resizeNative(width: number, height: number): void;
    setRawBitmapCoalesceMode(enabled: boolean): void;
    submit_encrypted_ticket(channel_key: string, ticket: Uint8Array): Uint8Array;
    uploadBitmapAndCommit(token: bigint, bytes: Uint8Array, source_width: number, source_height: number, stride: number, format: number, flags: number, dest_left: number, dest_top: number, dest_right: number, dest_bottom: number, src_left: number, src_top: number, src_right: number, src_bottom: number, rop_descriptor: number, scale_mode: number, mask_present: boolean, present: boolean): boolean;
    uploadExternalImageAndCommit(token: bigint, source: any, source_width: number, source_height: number, dest_left: number, dest_top: number, dest_right: number, dest_bottom: number, src_left: number, src_top: number, src_right: number, src_bottom: number, rop_descriptor: number, scale_mode: number, mask_present: boolean, present: boolean): boolean;
    uploadRgbaAndCommit(token: bigint, bytes: Uint8Array, source_width: number, source_height: number, dest_left: number, dest_top: number, dest_right: number, dest_bottom: number, src_left: number, src_top: number, src_right: number, src_bottom: number, rop_descriptor: number, scale_mode: number, mask_present: boolean, present: boolean): boolean;
}

export class SpiceSetAck {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly generation: number;
    readonly window: number;
}

export class WgpuSpiceRuntime {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    configureSurface(width: number, height: number): void;
    copySurfaceRect(dest_left: number, dest_top: number, dest_right: number, dest_bottom: number, src_left: number, src_top: number): boolean;
    static createForOffscreenCanvas(canvas: OffscreenCanvas, width: number, height: number): Promise<WgpuSpiceRuntime>;
    diagnostics(): any;
    fillRect(left: number, top: number, right: number, bottom: number, color: number): void;
    presentPrimary(): void;
    resize(width: number, height: number): void;
    submitBatch(batch: any): void;
    uploadAndPresentBitmapRect(bytes: Uint8Array, source_width: number, source_height: number, stride: number, format: number, flags: number, dest_left: number, dest_top: number, dest_right: number, dest_bottom: number, src_left: number, src_top: number, src_right: number, src_bottom: number, rop_descriptor: number, scale_mode: number, mask_present: boolean): boolean;
    uploadAndPresentRgbaRect(bytes: Uint8Array, source_width: number, source_height: number, dest_left: number, dest_top: number, dest_right: number, dest_bottom: number, src_left: number, src_top: number, src_right: number, src_bottom: number, rop_descriptor: number, scale_mode: number, mask_present: boolean): boolean;
    uploadExternalImageAndPresent(source: any, source_width: number, source_height: number, dest_left: number, dest_top: number, dest_right: number, dest_bottom: number, src_left: number, src_top: number, src_right: number, src_bottom: number, rop_descriptor: number, scale_mode: number, mask_present: boolean): boolean;
}

export function apply_alpha_mask_rgba(input: Uint8Array, alpha_mask: Uint8Array): Uint8Array;

export function apply_draw_copy_rop_rgba(rop_descriptor: number, source: Uint8Array, dest: Uint8Array): Uint8Array;

export function apply_lz_alpha_mask_rgba(input: Uint8Array, alpha_lz: Uint8Array, width: number, height: number): Uint8Array;

export function apply_rop_rgba(rop_descriptor: number, source: Uint8Array, dest: Uint8Array): Uint8Array;

export function bitmap_decode(input: Uint8Array, width: number, height: number, stride: number, format: number, flags: number): Uint8Array;

export function bitmap_plt_decode(input: Uint8Array, width: number, height: number, stride: number, format: number, flags: number, palette: Uint32Array): Uint8Array;

export function build_spice_ack_packet(): Uint8Array;

export function build_spice_ack_sync_packet(generation: number): Uint8Array;

export function build_spice_mini_packet(message_type: number, body: Uint8Array): Uint8Array;

export function build_spice_pong_packet(raw_ping: Uint8Array): Uint8Array;

export function glz_rgb_decode(input: Uint8Array, dictionary: any): any;

export function lz4_decode(input: Uint8Array, width: number, height: number): Uint8Array;

export function lz_alpha_mask_decode(input: Uint8Array, width: number, height: number): Uint8Array;

export function lz_plt_decode(input: Uint8Array, width: number, height: number, stride: number, type_val: number, top_down: boolean, palette: Uint32Array): Uint8Array;

export function lz_rgb_decode(input: Uint8Array, width: number, height: number, stride: number, type_val: number, opaque: boolean, top_down: boolean): Uint8Array;

export function lz_rgb_image_decode(input: Uint8Array, expected_width: number, expected_height: number): Uint8Array;

export function mono_cursor_to_rgba(input: Uint8Array, width: number, height: number): Uint8Array;

export function parse_spice_mini_header(input: Uint8Array): SpiceMiniHeader;

export function parse_spice_set_ack(input: Uint8Array): SpiceSetAck;

export function quic_decode(input: Uint8Array, width: number, height: number): Uint8Array;

export function spice_ack_decision_none(): number;

export function spice_ack_decision_sync(): number;

export function spice_ack_decision_window(): number;

export function spice_cache_resource_cursor(): number;

export function spice_cache_resource_decode(): number;

export function spice_cache_resource_glz(): number;

export function spice_cache_resource_gpu(): number;

export function spice_cache_resource_image(): number;

export function spice_cache_resource_palette(): number;

export function spice_cache_resource_pixmap(): number;

export function zlib_glz_rgb_decode(input: Uint8Array, dictionary: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly apply_lz_alpha_mask_rgba: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly lz_alpha_mask_decode: (a: number, b: number, c: number, d: number) => [number, number];
    readonly __wbg_spicecacheepochs_free: (a: number, b: number) => void;
    readonly spice_cache_resource_cursor: () => number;
    readonly spice_cache_resource_decode: () => number;
    readonly spice_cache_resource_glz: () => number;
    readonly spice_cache_resource_gpu: () => number;
    readonly spice_cache_resource_image: () => number;
    readonly spice_cache_resource_palette: () => number;
    readonly spice_cache_resource_pixmap: () => number;
    readonly spicecacheepochs_bump_all: (a: number) => bigint;
    readonly spicecacheepochs_bump_kind: (a: number, b: number) => bigint;
    readonly spicecacheepochs_bump_resource: (a: number, b: number, c: bigint) => bigint;
    readonly spicecacheepochs_claim: (a: number, b: number, c: bigint) => bigint;
    readonly spicecacheepochs_clear: (a: number) => void;
    readonly spicecacheepochs_global_epoch: (a: number) => bigint;
    readonly spicecacheepochs_is_current: (a: number, b: number, c: bigint, d: bigint) => number;
    readonly spicecacheepochs_kind_count: (a: number) => number;
    readonly spicecacheepochs_kind_epoch: (a: number, b: number) => bigint;
    readonly spicecacheepochs_new: () => number;
    readonly spicecacheepochs_resource_count: (a: number) => number;
    readonly spicecacheepochs_epoch: (a: number, b: number, c: bigint) => bigint;
    readonly __wbg_spiceengine_free: (a: number, b: number) => void;
    readonly __wbg_spicemutationgraph_free: (a: number, b: number) => void;
    readonly lz_plt_decode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly quic_decode: (a: number, b: number, c: number, d: number) => [number, number];
    readonly spiceengine_check_visual_token: (a: number, b: bigint) => number;
    readonly spiceengine_commit_visual_token: (a: number, b: bigint) => number;
    readonly spiceengine_control: (a: number, b: any) => any;
    readonly spiceengine_diagnostics: (a: number) => any;
    readonly spiceengine_dispose: (a: number) => void;
    readonly spiceengine_ingest_channel_bytes: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly spiceengine_new: () => number;
    readonly spiceengine_open_channel: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly spiceengine_submit_encrypted_ticket: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly spicemutationgraph_add_wait_barrier: (a: number, b: number, c: number) => bigint;
    readonly spicemutationgraph_barrier_count: (a: number) => number;
    readonly spicemutationgraph_bump_surface_generation: (a: number, b: number) => number;
    readonly spicemutationgraph_cancel_plan: (a: number, b: bigint) => number;
    readonly spicemutationgraph_check_token: (a: number, b: bigint) => number;
    readonly spicemutationgraph_check_token_for_surface: (a: number, b: bigint, c: number) => number;
    readonly spicemutationgraph_claim_rect: (a: number, b: number, c: number, d: bigint, e: bigint, f: number, g: number, h: number, i: number) => bigint;
    readonly spicemutationgraph_clear: (a: number) => void;
    readonly spicemutationgraph_commit_token: (a: number, b: bigint) => number;
    readonly spicemutationgraph_is_barrier_satisfied: (a: number, b: bigint) => number;
    readonly spicemutationgraph_new: () => number;
    readonly spicemutationgraph_observe_channel_serial: (a: number, b: number, c: number, d: bigint) => number;
    readonly spicemutationgraph_owner_count: (a: number) => number;
    readonly spicemutationgraph_release_token: (a: number, b: bigint) => number;
    readonly spicemutationgraph_set_surface_generation: (a: number, b: number, c: number) => void;
    readonly spicemutationgraph_surface_generation: (a: number, b: number) => number;
    readonly spicemutationgraph_tombstone_count: (a: number) => number;
    readonly __wbg_spiceackstate_free: (a: number, b: number) => void;
    readonly __wbg_spiceminiheader_free: (a: number, b: number) => void;
    readonly __wbg_spicesetack_free: (a: number, b: number) => void;
    readonly bitmap_decode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly bitmap_plt_decode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly build_spice_ack_packet: () => [number, number];
    readonly build_spice_ack_sync_packet: (a: number) => [number, number];
    readonly build_spice_mini_packet: (a: number, b: number, c: number) => [number, number];
    readonly build_spice_pong_packet: (a: number, b: number) => [number, number];
    readonly parse_spice_mini_header: (a: number, b: number) => [number, number, number];
    readonly parse_spice_set_ack: (a: number, b: number) => [number, number, number];
    readonly spice_ack_decision_none: () => number;
    readonly spice_ack_decision_sync: () => number;
    readonly spice_ack_decision_window: () => number;
    readonly spiceackstate_ack_count: (a: number) => bigint;
    readonly spiceackstate_ack_sync_count: (a: number) => bigint;
    readonly spiceackstate_configure: (a: number, b: number, c: number) => number;
    readonly spiceackstate_generation: (a: number) => number;
    readonly spiceackstate_new: () => number;
    readonly spiceackstate_observe_packet: (a: number) => number;
    readonly spiceackstate_packet_serial: (a: number) => bigint;
    readonly spiceackstate_packets_since_ack: (a: number) => number;
    readonly spiceackstate_window: (a: number) => number;
    readonly spiceminiheader_body_size: (a: number) => number;
    readonly spiceminiheader_message_type: (a: number) => number;
    readonly spicesetack_window: (a: number) => number;
    readonly spicesetack_generation: (a: number) => number;
    readonly __wbg_wgpuspiceruntime_free: (a: number, b: number) => void;
    readonly wgpuspiceruntime_configureSurface: (a: number, b: number, c: number) => [number, number];
    readonly wgpuspiceruntime_copySurfaceRect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly wgpuspiceruntime_createForOffscreenCanvas: (a: any, b: number, c: number) => any;
    readonly wgpuspiceruntime_diagnostics: (a: number) => any;
    readonly wgpuspiceruntime_fillRect: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wgpuspiceruntime_presentPrimary: (a: number) => [number, number];
    readonly wgpuspiceruntime_resize: (a: number, b: number, c: number) => [number, number];
    readonly wgpuspiceruntime_submitBatch: (a: number, b: any) => [number, number];
    readonly wgpuspiceruntime_uploadAndPresentBitmapRect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number) => [number, number, number];
    readonly wgpuspiceruntime_uploadAndPresentRgbaRect: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => [number, number, number];
    readonly wgpuspiceruntime_uploadExternalImageAndPresent: (a: number, b: any, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => [number, number, number];
    readonly glz_rgb_decode: (a: number, b: number, c: any) => [number, number, number];
    readonly lz4_decode: (a: number, b: number, c: number, d: number) => [number, number];
    readonly lz_rgb_decode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly lz_rgb_image_decode: (a: number, b: number, c: number, d: number) => [number, number];
    readonly zlib_glz_rgb_decode: (a: number, b: number, c: any) => [number, number, number];
    readonly __wbg_spicenativeruntime_free: (a: number, b: number) => void;
    readonly apply_alpha_mask_rgba: (a: number, b: number, c: number, d: number) => [number, number];
    readonly apply_draw_copy_rop_rgba: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly apply_rop_rgba: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly mono_cursor_to_rgba: (a: number, b: number, c: number, d: number) => [number, number];
    readonly spicenativeruntime_check_visual_token: (a: number, b: bigint) => number;
    readonly spicenativeruntime_commit_visual_token: (a: number, b: bigint) => number;
    readonly spicenativeruntime_control: (a: number, b: any) => any;
    readonly spicenativeruntime_createForOffscreenCanvas: (a: any, b: number, c: number) => any;
    readonly spicenativeruntime_diagnostics: (a: number) => any;
    readonly spicenativeruntime_dispose: (a: number) => void;
    readonly spicenativeruntime_flushPendingNativeBitmapUploads: (a: number, b: number) => any;
    readonly spicenativeruntime_ingest_channel_bytes: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly spicenativeruntime_open_channel: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly spicenativeruntime_presentPrimary: (a: number) => [number, number, number];
    readonly spicenativeruntime_resizeNative: (a: number, b: number, c: number) => [number, number];
    readonly spicenativeruntime_setRawBitmapCoalesceMode: (a: number, b: number) => void;
    readonly spicenativeruntime_submit_encrypted_ticket: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly spicenativeruntime_uploadBitmapAndCommit: (a: number, b: bigint, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number) => [number, number, number];
    readonly spicenativeruntime_uploadExternalImageAndCommit: (a: number, b: bigint, c: any, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number) => [number, number, number];
    readonly spicenativeruntime_uploadRgbaAndCommit: (a: number, b: bigint, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h5ea927a178144b66: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h210f4cec66d9e3dd: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h578ce349061f72d2: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
