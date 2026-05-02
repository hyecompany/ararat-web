/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type {
  SessionWorkerOutbound,
  SpiceWorkerDiagnostics,
} from '../messages.js';

type WorkerPost = (message: SessionWorkerOutbound, transfer?: Transferable[]) => void;

export class BrowserSpiceRecordEvents {
  constructor(private readonly post: WorkerPost) {}

  apply(event: unknown, diagnostics: SpiceWorkerDiagnostics | null) {
    if (!event || typeof event !== 'object' || !diagnostics) {
      return;
    }

    const record = event as Record<string, unknown>;
    switch (record.type) {
      case 'start': {
        const channels = positiveNumber(record.channels);
        const sampleRate = positiveNumber(record.frequency);
        const format = positiveNumber(record.format);
        diagnostics.session.channels.record = true;
        this.post({
          type: 'record_start',
          payload: { channels, sampleRate, format },
        });
        break;
      }
      case 'volume':
        if (Array.isArray(record.volumes)) {
          this.post({
            type: 'record_control',
            payload: {
              volume: record.volumes.filter(
                (value): value is number => typeof value === 'number',
              ),
            },
          });
        }
        break;
      case 'mute':
        this.post({
          type: 'record_control',
          payload: { muted: positiveNumber(record.mute) !== 0 },
        });
        break;
      case 'stop':
        this.post({ type: 'record_stop' });
        break;
    }
  }
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
