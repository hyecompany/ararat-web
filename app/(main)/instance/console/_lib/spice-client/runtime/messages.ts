/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { ConsoleShortcutId, SpiceRuntimeDiagnostics } from './contracts';

export type SessionShortcutId = ConsoleShortcutId;

export type SessionStage =
  | 'idle'
  | 'connecting-control'
  | 'connecting-main'
  | 'main-authenticated'
  | 'main-init'
  | 'channels-list'
  | 'connecting-display'
  | 'display-authenticated'
  | 'display-initialized'
  | 'first-frame'
  | 'error'
  | 'closed';

export interface SessionChannelStatus {
  control: boolean;
  main: boolean;
  display: boolean;
  cursor: boolean;
  inputs: boolean;
  playback: boolean;
  record: boolean;
  port: boolean;
  webdav: boolean;
}

export interface SessionStateSnapshot {
  stage: SessionStage;
  channels: SessionChannelStatus;
  sessionId: number | null;
  currentMouseMode: number | null;
  multimediaTime: number | null;
  lastNotify: string | null;
  waitCount: number;
}

export interface SpiceWorkerDiagnostics extends SpiceRuntimeDiagnostics {
  session: SessionStateSnapshot;
  unsupported: string[];
  trace: string[];
}

export interface RuntimeFastPathToggles {
  qxlFrameBands: boolean;
  rawBitmapCoalesce: boolean;
  artifactSentinel: boolean;
  presentPacing: boolean;
  zeroCopyIngress: boolean;
  gpuUploadReuse: boolean;
  sharedMemoryBuffers: boolean;
  browserImageDecode: boolean;
  browserVideoDecode: boolean;
  forceWasmDecode: boolean;
  dropStaleStreamFrames: boolean;
  revalidateDecode: boolean;
  revalidateGpu: boolean;
  revalidatePresent: boolean;
  disableReadbackFallback: boolean;
}

export interface SessionInitPayload {
  websockets: Record<string, string>;
  canvas: OffscreenCanvas;
  controlPort: MessagePort;
  cacheScope?: string;
  runtimeToggles?: Partial<RuntimeFastPathToggles>;
  migration?: {
    semiSeamless?: boolean;
    seamless?: boolean;
  };
  capabilityProbe?: {
    imageDecoder?: boolean;
    imageBitmap?: boolean;
    jpegImageDecoder?: boolean;
    jpegImageBitmap?: boolean;
    videoDecoder?: boolean;
    audioDecoder?: boolean;
    audioEncoder?: boolean;
    videoCodecs?: Partial<Record<'mjpeg' | 'h264' | 'vp8' | 'vp9' | 'h265', boolean>>;
    audioCodecs?: Partial<Record<'opus', boolean>>;
    audioEncodeCodecs?: Partial<Record<'opus', boolean>>;
    nativeSpiceRuntime?: boolean;
    nativeCodecs?: Partial<Record<string, boolean>>;
    webgpu?: boolean;
    webusb?: boolean;
    webdav?: boolean;
    sharedMemory?: boolean;
  };
  backendPolicy?: {
    disableWebGpu?: boolean;
    disableWebGl2?: boolean;
  };
  portBridge?: {
    port?: boolean;
    webdav?: boolean;
  };
  webUsbRedirection?: boolean;
}

export interface SessionMigrationDestinationInfo {
  host: string;
  port: number;
  sport: number;
  certSubject: string;
  srcMigrationVersion: number | null;
  kind: 'begin' | 'begin-seamless' | 'switch-host';
}

export interface SessionMigrationDestination {
  websockets: Record<string, string>;
}

export interface SessionReplayInitPayload {
  canvas: OffscreenCanvas;
  capabilityProbe?: SessionInitPayload['capabilityProbe'];
  backendPolicy?: SessionInitPayload['backendPolicy'];
}

export interface SessionReplayDisplayPacket {
  type: number;
  body: ArrayBuffer;
}

export interface SessionReplayDisplayPacketsPayload {
  packets: SessionReplayDisplayPacket[];
}

export interface SessionAudioChunk {
  pcm: ArrayBuffer;
  channels: number;
  sampleRate: number;
  mode: number;
  multimediaTime: number | null;
}

export interface SessionAudioControl {
  volume?: number[] | null;
  muted?: boolean | null;
  latencyMs?: number | null;
}

export interface SessionRecordControl {
  volume?: number[] | null;
  muted?: boolean | null;
}

export interface SessionMonitorHead {
  monitorId: number;
  surfaceId: number;
  width: number;
  height: number;
  x: number;
  y: number;
  flags: number;
}

export interface SessionMonitorsConfig {
  count: number;
  maxAllowed: number;
  origin: { x: number; y: number };
  width: number;
  height: number;
  heads: SessionMonitorHead[];
}

export type SessionPortChannelName = 'port' | 'webdav';

export interface SessionPortEndpoint {
  channelName: SessionPortChannelName;
  channelType: number;
  channelId: number;
  portName: string;
}

export interface SessionPortInitPayload extends SessionPortEndpoint {
  opened: boolean;
}

export interface SessionPortDataPayload extends SessionPortEndpoint {
  data: ArrayBuffer;
}

export interface SessionPortEventPayload extends SessionPortEndpoint {
  event: number;
}

export interface SessionWebUsbStatus {
  available: boolean;
  enabled: boolean;
  attached: boolean;
  devices: Array<{
    vendorId: number;
    productId: number;
    productName?: string | null;
    manufacturerName?: string | null;
    serialNumber?: string | null;
  }>;
  message?: string | null;
}

export interface SessionDebugEvent {
  atMs: number;
  scope: string;
  event: string;
  data?: Record<string, unknown>;
}

export interface SessionCursorImage {
  unique: string;
  type: number;
  width: number;
  height: number;
  hotSpotX: number;
  hotSpotY: number;
  flags: number;
  kind: 'alpha' | 'mono' | 'bitmap' | 'url' | 'unknown';
  bitmapFormat?: number;
  data: ArrayBuffer;
  url: string | null;
}

export type SessionCursorState =
  | {
      action: 'set';
      position: { x: number; y: number };
      visible: boolean;
      trail: { length: number; frequency: number } | null;
      cursor: SessionCursorImage | null;
    }
  | { action: 'move'; position: { x: number; y: number } }
  | { action: 'trail'; trail: { length: number; frequency: number } }
  | { action: 'invalidate-one'; unique: string }
  | { action: 'invalidate-all' }
  | { action: 'hide' }
  | { action: 'reset' };

export type SessionControlMessage =
  | {
      type: 'mouse_move';
      payload: {
        x: number;
        y: number;
        movementX: number;
        movementY: number;
        buttons: number;
      };
    }
  | {
      type: 'mouse_button';
      payload: { button: number; pressed: boolean; buttons: number };
    }
  | {
      type: 'mouse_wheel';
      payload: { direction: 'up' | 'down'; buttons: number };
    }
  | { type: 'mouse_leave' }
  | { type: 'record_chunk'; payload: { pcm: ArrayBuffer; multimediaTime: number } }
  | { type: 'record_error'; payload: { message: string } }
  | {
      type: 'key';
      payload: {
        code: string;
        key: string;
        down: boolean;
        repeat: boolean;
        modifiers?: number;
      };
    }
  | { type: 'shortcut'; payload: { shortcut: SessionShortcutId } }
  | { type: 'resize'; payload: { width: number; height: number } }
  | {
      type: 'file_transfer_upload';
      payload: {
        files: Array<{
          name: string;
          size: number;
          type?: string;
          lastModified?: number;
          blob: Blob;
        }>;
      };
    }
  | {
      type: 'port_event';
      payload: { channelType: number; channelId: number; event: number };
    }
  | {
      type: 'port_data';
      payload: { channelType: number; channelId: number; data: ArrayBuffer };
    }
  | { type: 'webusb_attach'; payload: SessionWebUsbStatus['devices'][number] }
  | {
      type: 'debug_config';
      payload: { liveLogging: boolean; diagnosticReadbacks?: boolean };
    }
  | { type: 'runtime_toggles'; payload: Partial<RuntimeFastPathToggles> };

export type SessionWorkerInbound =
  | { type: 'init'; payload: SessionInitPayload }
  | { type: 'init_replay'; payload: SessionReplayInitPayload }
  | { type: 'replay_display_packets'; payload: SessionReplayDisplayPacketsPayload }
  | {
      type: 'migration_resolve_result';
      payload: {
        requestId: number;
        destination: SessionMigrationDestination | null;
        error?: string;
      };
    }
  | { type: 'dispose' };

export type SessionWorkerOutbound =
  | { type: 'ready' }
  | { type: 'disposed' }
  | {
      type: 'error';
      payload: {
        message: string;
        stack?: string;
        recoverableBackend?: 'webgpu' | 'webgl2' | 'offscreen-2d' | null;
        fallbackBackend?: 'webgl2' | 'offscreen-2d' | null;
      };
    }
  | { type: 'resolution'; payload: { width: number; height: number } }
  | { type: 'monitors_config'; payload: SessionMonitorsConfig }
  | { type: 'diagnostics'; payload: SpiceWorkerDiagnostics }
  | { type: 'debug_event'; payload: SessionDebugEvent }
  | { type: 'cursor'; payload: SessionCursorState }
  | { type: 'audio'; payload: SessionAudioChunk }
  | { type: 'audio_control'; payload: SessionAudioControl }
  | { type: 'audio_stop' }
  | {
      type: 'file_transfer';
      payload: {
        id: number;
        name: string;
        size: number;
        transferred: number;
        direction?: 'upload' | 'download';
        status: 'queued' | 'waiting' | 'sending' | 'complete' | 'cancelled' | 'error' | 'disabled';
        result?: number | null;
        message?: string;
      };
    }
  | {
      type: 'file_transfer_download';
      payload: {
        id: number;
        name: string;
        size: number;
        received: number;
        status: 'start' | 'data' | 'complete' | 'cancelled' | 'error' | 'disabled';
        result?: number | null;
        message?: string;
        data?: ArrayBuffer;
      };
    }
  | { type: 'port_init'; payload: SessionPortInitPayload }
  | { type: 'port_data'; payload: SessionPortDataPayload }
  | { type: 'port_event'; payload: SessionPortEventPayload }
  | { type: 'record_start'; payload: { channels: number; sampleRate: number; format: number } }
  | { type: 'record_control'; payload: SessionRecordControl }
  | { type: 'record_stop' }
  | { type: 'webusb_status'; payload: SessionWebUsbStatus }
  | {
      type: 'migration_resolve_request';
      payload: {
        requestId: number;
        dstInfo: SessionMigrationDestinationInfo;
      };
    };
