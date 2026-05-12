/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

import type { ReactNode } from 'react';
import { FolderUpIcon, Maximize2Icon, RotateCcwIcon, WaypointsIcon } from 'lucide-react';
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { CONSOLE_SHORTCUTS, type ConsoleSessionController } from '../_lib/shortcuts';

interface SharedMemoryFastPathControl {
  enabled: boolean;
  active: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

interface WebUsbRedirectionControl {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

interface WebDavShareControl {
  supported: boolean;
  active: boolean;
  label: string;
  onToggle: () => void | Promise<void>;
}

interface ConsoleToolbarProps {
  controller: ConsoleSessionController;
  actions?: ReactNode;
  // Runtime support remains wired by callers, but the visible performance menu
  // is intentionally hidden from the graphical console toolbar.
  sharedMemoryFastPath?: SharedMemoryFastPathControl;
  // Runtime support remains wired by callers, but the visible USB option is
  // intentionally hidden from the graphical console toolbar.
  webUsbRedirection?: WebUsbRedirectionControl;
  webDavShare?: WebDavShareControl;
}

export default function ConsoleToolbar({ controller, actions, webDavShare }: ConsoleToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>Console</MenubarTrigger>
          <MenubarContent align="end">
            {actions}
            {actions && <MenubarSeparator />}
            <MenubarItem
              disabled={!controller.canReconnect}
              onSelect={() => controller.reconnect()}
            >
              <RotateCcwIcon />
              Reconnect
            </MenubarItem>
            <MenubarItem
              disabled={!controller.canFullscreen}
              onSelect={() => {
                void controller.toggleFullscreen();
              }}
            >
              <Maximize2Icon />
              {controller.isFullscreen ? 'Exit full screen' : 'Full screen'}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        {webDavShare && (
          <MenubarMenu>
            <MenubarTrigger>Devices</MenubarTrigger>
            <MenubarContent align="end">
              <MenubarItem
                disabled={!webDavShare.supported}
                title={
                  webDavShare.supported
                    ? webDavShare.active
                      ? `Stop sharing ${webDavShare.label} over SPICE WebDAV`
                      : 'Share a folder over SPICE WebDAV'
                    : 'SPICE WebDAV requires Chromium File System Access support'
                }
                onSelect={() => {
                  void webDavShare.onToggle();
                }}
              >
                <FolderUpIcon />
                {webDavShare.active ? 'Stop folder share' : 'Share folder'}
              </MenubarItem>
              {/*
                USB attach UI intentionally removed for now. The controller path
                stays available for future re-enablement:

                <MenubarItem
                  disabled={!controller.canAttachUsb}
                  onSelect={() => {
                    void controller.attachUsbDevice().catch((error) => {
                      console.warn('[spice-usb] attach failed', error);
                    });
                  }}
                >
                  <UsbIcon />
                  Attach USB device
                </MenubarItem>
              */}
            </MenubarContent>
          </MenubarMenu>
        )}

        <MenubarMenu>
          <MenubarTrigger disabled={!controller.canSendShortcuts}>Shortcuts</MenubarTrigger>
          <MenubarContent align="end">
            {CONSOLE_SHORTCUTS.map((shortcut) => (
              <MenubarItem
                key={shortcut.id}
                onSelect={() => {
                  void controller.sendShortcut(shortcut.id);
                }}
              >
                <WaypointsIcon />
                {shortcut.label}
              </MenubarItem>
            ))}
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  );
}
