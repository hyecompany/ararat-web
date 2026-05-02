/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { ConsoleShortcutId, SpiceRuntimeDiagnostics } from './spice-client/runtime/contracts';

export type { ConsoleShortcutId, SpiceRuntimeDiagnostics };

export type ConsoleMode = 'text' | 'graphical';

export interface ConsoleShortcut {
  id: ConsoleShortcutId;
  label: string;
}

export interface ConsoleSessionController {
  canReconnect: boolean;
  canFullscreen: boolean;
  canSendShortcuts: boolean;
  canAttachUsb: boolean;
  isFullscreen: boolean;
  diagnostics: SpiceRuntimeDiagnostics | null;
  reconnect: () => void;
  toggleFullscreen: () => Promise<void>;
  sendShortcut: (shortcut: ConsoleShortcutId) => void | Promise<void>;
  attachUsbDevice: () => Promise<void>;
}

export const CONSOLE_SHORTCUTS: ConsoleShortcut[] = [
  { id: 'ctrl-alt-delete', label: 'Ctrl+Alt+Delete' },
  { id: 'alt-tab', label: 'Alt+Tab' },
  { id: 'alt-f4', label: 'Alt+F4' },
  { id: 'ctrl-alt-1', label: 'Ctrl+Alt+1' },
  { id: 'ctrl-alt-f2', label: 'Ctrl+Alt+F2' },
  { id: 'ctrl-alt-f3', label: 'Ctrl+Alt+F3' },
  { id: 'ctrl-alt-f4', label: 'Ctrl+Alt+F4' },
];

export function createDisabledConsoleController(): ConsoleSessionController {
  return {
    canReconnect: false,
    canFullscreen: false,
    canSendShortcuts: false,
    canAttachUsb: false,
    isFullscreen: false,
    diagnostics: null,
    reconnect: () => {},
    toggleFullscreen: async () => {},
    sendShortcut: () => {},
    attachUsbDevice: async () => {},
  };
}
