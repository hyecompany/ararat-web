/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { SessionWorkerOutbound } from '../messages.js';

type WorkerPost = (message: SessionWorkerOutbound, transfer?: Transferable[]) => void;
type PortChannelName = 'port' | 'webdav';

interface PortEndpoint {
  channelName: PortChannelName;
  portName: string;
}

export class BrowserSpicePortEvents {
  private readonly endpoints = new Map<string, PortEndpoint>();

  constructor(private readonly post: WorkerPost) {}

  apply(event: unknown) {
    if (!event || typeof event !== 'object') {
      return;
    }

    const record = event as Record<string, unknown>;
    const channelName = stringField(record, 'channelName');
    const channelType = positiveNumber(record.channelType);
    const channelId = positiveNumber(record.channelId);
    if (channelName !== 'port' && channelName !== 'webdav') {
      return;
    }

    switch (record.type) {
      case 'init':
        this.applyInit(channelName, channelType, channelId, record);
        break;
      case 'data':
        this.applyData(channelName, channelType, channelId, record);
        break;
      case 'event':
        this.applyPortEvent(channelName, channelType, channelId, record);
        break;
    }
  }

  clear() {
    this.endpoints.clear();
  }

  private applyInit(
    channelName: PortChannelName,
    channelType: number,
    channelId: number,
    record: Record<string, unknown>,
  ) {
    const key = endpointKey(channelType, channelId);
    const portName = stringField(record, 'portName') ?? '';
    this.endpoints.set(key, { channelName, portName });
    this.post({
      type: 'port_init',
      payload: {
        channelName,
        channelType,
        channelId,
        portName,
        opened: Boolean(record.opened),
      },
    });
  }

  private applyData(
    channelName: PortChannelName,
    channelType: number,
    channelId: number,
    record: Record<string, unknown>,
  ) {
    const bytes = bytesFromNativeValue(record.data);
    if (!bytes) {
      return;
    }

    const data = arrayBufferFromBytes(bytes);
    const endpoint = this.endpoints.get(endpointKey(channelType, channelId));
    this.post(
      {
        type: 'port_data',
        payload: {
          channelName: endpoint?.channelName ?? channelName,
          channelType,
          channelId,
          portName: endpoint?.portName ?? '',
          data,
        },
      },
      [data],
    );
  }

  private applyPortEvent(
    channelName: PortChannelName,
    channelType: number,
    channelId: number,
    record: Record<string, unknown>,
  ) {
    const endpoint = this.endpoints.get(endpointKey(channelType, channelId));
    this.post({
      type: 'port_event',
      payload: {
        channelName: endpoint?.channelName ?? channelName,
        channelType,
        channelId,
        portName: endpoint?.portName ?? '',
        event: positiveNumber(record.event),
      },
    });
  }
}

function endpointKey(channelType: number, channelId: number) {
  return `${channelType}:${channelId}`;
}

function bytesFromNativeValue(value: unknown): Uint8Array | ArrayBuffer | null {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry))) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function arrayBufferFromBytes(data: Uint8Array | ArrayBuffer) {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
