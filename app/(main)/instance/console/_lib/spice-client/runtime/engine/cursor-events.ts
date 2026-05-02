/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type {
  SessionCursorImage,
  SessionWorkerOutbound,
} from '../messages.js';

type WorkerPost = (message: SessionWorkerOutbound, transfer?: Transferable[]) => void;

export class BrowserSpiceCursorEvents {
  constructor(private readonly post: WorkerPost) {}

  apply(event: unknown) {
    if (!event || typeof event !== 'object') {
      return;
    }

    const record = event as Record<string, unknown>;
    switch (record.type) {
      case 'init':
      case 'set':
        this.applySet(record);
        break;
      case 'move':
        this.post({
          type: 'cursor',
          payload: { action: 'move', position: pointFromRecord(record.position) },
        });
        break;
      case 'trail':
        this.post({
          type: 'cursor',
          payload: {
            action: 'trail',
            trail: {
              length: positiveNumber(record.length),
              frequency: positiveNumber(record.frequency),
            },
          },
        });
        break;
      case 'invalidateOne':
        this.post({
          type: 'cursor',
          payload: { action: 'invalidate-one', unique: String(record.unique ?? '') },
        });
        break;
      case 'invalidateAll':
        this.post({ type: 'cursor', payload: { action: 'invalidate-all' } });
        break;
      case 'hide':
        this.post({ type: 'cursor', payload: { action: 'hide' } });
        break;
      case 'reset':
        this.post({ type: 'cursor', payload: { action: 'reset' } });
        break;
    }
  }

  private applySet(record: Record<string, unknown>) {
    const cursor = cursorImageFromRecord(record.cursor);
    this.post(
      {
        type: 'cursor',
        payload: {
          action: 'set',
          position: pointFromRecord(record.position),
          visible: record.visible !== false,
          trail: {
            length: positiveNumber(record.trailLength),
            frequency: positiveNumber(record.trailFrequency),
          },
          cursor,
        },
      },
      cursor ? [cursor.data] : undefined,
    );
  }
}

function pointFromRecord(value: unknown) {
  if (!value || typeof value !== 'object') {
    return { x: 0, y: 0 };
  }
  const record = value as Record<string, unknown>;
  return {
    x: positiveNumber(record.x),
    y: positiveNumber(record.y),
  };
}

function cursorImageFromRecord(value: unknown): SessionCursorImage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rgba = bytesFromNativeValue(record.rgba);
  if (!rgba) {
    return null;
  }
  const data = arrayBufferFromBytes(rgba);
  return {
    unique: String(record.unique ?? ''),
    type: positiveNumber(record.cursorType),
    width: positiveNumber(record.width),
    height: positiveNumber(record.height),
    hotSpotX: positiveNumber(record.hotSpotX),
    hotSpotY: positiveNumber(record.hotSpotY),
    flags: positiveNumber(record.flags),
    kind: 'alpha',
    data,
    url: null,
  };
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
