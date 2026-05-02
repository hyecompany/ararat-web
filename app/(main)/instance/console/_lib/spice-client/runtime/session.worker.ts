/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { BrowserSpiceSession } from './engine/browser-spice-session.js';
import type {
  SessionControlMessage,
  SessionWorkerInbound,
  SessionWorkerOutbound,
} from './messages.js';

let session: BrowserSpiceSession | null = null;
let controlPort: MessagePort | null = null;

function post(message: SessionWorkerOutbound, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

function handleControlMessage(event: MessageEvent<SessionControlMessage>) {
  session?.handleControl(event.data);
}

self.onmessage = (event: MessageEvent<SessionWorkerInbound>) => {
  const message = event.data;
  switch (message.type) {
    case 'init': {
      session?.dispose();
      controlPort?.removeEventListener('message', handleControlMessage);
      controlPort = message.payload.controlPort;
      controlPort.addEventListener('message', handleControlMessage);
      controlPort.start();
      session = new BrowserSpiceSession(message.payload, post);
      void session.start().catch((error) => {
        post({
          type: 'error',
          payload: {
            message: error instanceof Error ? error.message : 'Unable to start SPICE session.',
            stack: error instanceof Error ? error.stack : undefined,
          },
        });
      });
      break;
    }
    case 'dispose':
      session?.dispose();
      session = null;
      controlPort?.removeEventListener('message', handleControlMessage);
      controlPort = null;
      break;
    case 'init_replay':
    case 'replay_display_packets':
    case 'migration_resolve_result':
      break;
  }
};
