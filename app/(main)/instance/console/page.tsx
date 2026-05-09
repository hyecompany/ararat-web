/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ExternalLinkIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MenubarItem } from 'ui-web/components/menubar';
import { useInstanceContext } from '../_context/instance';
import { useInstance } from '../_hooks/instance';
import InstanceExec from './instanceExec';
import ConsoleShell from './_components/console-shell';
import ConsoleToolbar from './_components/console-toolbar';
import TextConsoleView from './_components/text-console-view';
import { useTextConsoleSession } from './_hooks/use-text-console-session';
import type { Instance } from '../../instances/_lib/instances.d';
import InstanceClass from '../../_lib/instance';
import {
  createDisabledConsoleController,
  type ConsoleMode,
  type ConsoleSessionController,
} from './_lib/shortcuts';
import {
  SHARED_MEMORY_FAST_PATH_QUERY,
  SHARED_MEMORY_FAST_PATH_STORAGE_KEY,
  detectSharedMemoryRuntimeCapability,
  sharedMemoryFastPathCookieValue,
  sharedMemoryFastPathFromSearchParams,
  parseBooleanFlag,
} from './_lib/spice-client/runtime/shared-memory-policy';
import {
  clientWebDavFileSystemAccessAvailable,
  requestWebDavDirectoryShare,
  type WebDavDirectoryShare,
} from './_lib/spice-client/webdav-fs-access';
import { getSpiceStreamingTuningStatus, instanceHasQxlGraphics } from './_lib/qxl-graphics';

const GraphicalConsoleView = dynamic(() => import('./_components/graphical-console-view'), {
  ssr: false,
});

const WEBUSB_REDIRECTION_QUERY = 'spice_webusb';
const WEBUSB_REDIRECTION_ALIAS_QUERY = 'webusb';
const WEBUSB_REDIRECTION_STORAGE_KEY = 'ararat:spice-webusb-redirection';
const CONSOLE_MODE_QUERY = 'console_mode';
const CONSOLE_MODE_ALIAS_QUERY = 'console';
const DIAGNOSTICS_OVERLAY_QUERY = 'spice_diagnostics';
const DIAGNOSTICS_OVERLAY_ALIAS_QUERY = 'diag';

export default function ConsolePage() {
  const { name, project } = useInstanceContext();
  const { instance, isLoading } = useInstance(name, project, {
    metadata: true,
    state: true,
  });
  const instanceClass = useMemo(
    () => (name ? new InstanceClass(name, project) : null),
    [name, project],
  );
  const isVirtualMachine = instance?.type === 'virtual-machine';
  const defaultMode = getDefaultConsoleMode(instance);
  const [modeOverride, setModeOverride] = useState<{
    instanceName: string | null;
    mode: ConsoleMode;
  } | null>(null);
  const activeMode = modeOverride?.instanceName === name ? modeOverride.mode : defaultMode;
  const [graphicalController, setGraphicalController] = useState<ConsoleSessionController>(
    createDisabledConsoleController(),
  );
  const [sharedMemoryFastPathEnabled, setSharedMemoryFastPathEnabled] = useState(() =>
    initialSharedMemoryFastPathEnabled(),
  );
  const [webUsbRedirectionEnabled, setWebUsbRedirectionEnabled] = useState(() =>
    initialWebUsbRedirectionEnabled(),
  );
  const [webDavShare, setWebDavShare] = useState<WebDavDirectoryShare | null>(null);
  const [execDialogOpen, setExecDialogOpen] = useState(false);
  const [forceTakeoverRequest, setForceTakeoverRequest] = useState<{
    mode: ConsoleMode;
    message: string;
  } | null>(null);
  const [forceTakeoverTokens, setForceTakeoverTokens] = useState({
    graphical: 0,
    text: 0,
  });
  const effectiveMode: ConsoleMode =
    isVirtualMachine && activeMode === 'graphical' ? 'graphical' : 'text';
  const effectiveModeRef = useRef<ConsoleMode>(effectiveMode);
  useEffect(() => {
    effectiveModeRef.current = effectiveMode;
  }, [effectiveMode]);

  useEffect(() => {
    const requested = readSharedMemoryFastPathSearchParam();
    if (requested !== null) {
      rememberSharedMemoryFastPath(requested);
      writeSharedMemoryFastPathCookie(requested);
    }
  }, []);

  useEffect(() => {
    const requested = readWebUsbRedirectionSearchParam();
    if (requested !== null) {
      rememberWebUsbRedirection(requested);
    }
  }, []);

  const sharedMemoryFastPathActive =
    typeof window !== 'undefined' && detectSharedMemoryRuntimeCapability().eligible;
  const webDavShareSupported =
    typeof window !== 'undefined' && clientWebDavFileSystemAccessAvailable();
  const qxlFrameBandsAllowed = instanceHasQxlGraphics(instance);
  const spiceStreamingTuning = getSpiceStreamingTuningStatus(instance);
  const diagnosticsOverlay = readDiagnosticsOverlaySearchParam();

  const handleSharedMemoryFastPathChange = useCallback((enabled: boolean) => {
    setSharedMemoryFastPathEnabled(enabled);
    rememberSharedMemoryFastPath(enabled);
    writeSharedMemoryFastPathCookie(enabled);
    if (typeof window === 'undefined') {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set(SHARED_MEMORY_FAST_PATH_QUERY, enabled ? '1' : '0');
    window.location.assign(nextUrl.toString());
  }, []);

  const handleWebUsbRedirectionChange = useCallback((enabled: boolean) => {
    setWebUsbRedirectionEnabled(enabled);
    rememberWebUsbRedirection(enabled);
    if (typeof window === 'undefined') {
      return;
    }

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set(WEBUSB_REDIRECTION_QUERY, enabled ? '1' : '0');
    window.history.replaceState(null, '', nextUrl.toString());
  }, []);

  const handleWebDavShareToggle = useCallback(async () => {
    if (webDavShare) {
      setWebDavShare(null);
      return;
    }

    try {
      setWebDavShare(await requestWebDavDirectoryShare());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.warn('[spice-webdav] folder share failed', error);
    }
  }, [webDavShare]);

  const handleConsoleInUse = useCallback((mode: ConsoleMode, message: string) => {
    if (mode !== effectiveModeRef.current) {
      return;
    }
    setForceTakeoverRequest({ mode, message });
  }, []);
  const handleTextConsoleInUse = useCallback(
    (message: string) => handleConsoleInUse('text', message),
    [handleConsoleInUse],
  );
  const handleGraphicalConsoleInUse = useCallback(
    (message: string) => handleConsoleInUse('graphical', message),
    [handleConsoleInUse],
  );
  const textSession = useTextConsoleSession({
    enabled: effectiveMode === 'text',
    instanceClass,
    isLoading,
    forceTakeoverToken: forceTakeoverTokens.text,
    onConsoleInUse: handleTextConsoleInUse,
  });

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) {
        return;
      }

      if (!name || !isVirtualMachine) {
        setModeOverride(null);
        return;
      }

      const requestedMode = readConsoleModeSearchParam();
      if (requestedMode) {
        setModeOverride({
          instanceName: name,
          mode: requestedMode,
        });
        return;
      }

      const rememberedMode = readRememberedConsoleMode(name);
      setModeOverride({
        instanceName: name,
        mode: rememberedMode ?? defaultMode,
      });
    });
    return () => {
      canceled = true;
    };
  }, [defaultMode, isVirtualMachine, name]);

  const activeController = useMemo(
    () => (effectiveMode === 'graphical' ? graphicalController : textSession.controller),
    [effectiveMode, graphicalController, textSession.controller],
  );
  const activeForceTakeoverRequest =
    forceTakeoverRequest?.mode === effectiveMode ? forceTakeoverRequest : null;

  return (
    <>
      <ConsoleShell
        activeMode={effectiveMode}
        isVirtualMachine={isVirtualMachine}
        onModeChange={(mode) => {
          setModeOverride({ instanceName: name, mode });
          rememberConsoleMode(name, mode);
        }}
        toolbar={
          <>
            <ConsoleToolbar
              controller={activeController}
              sharedMemoryFastPath={{
                enabled: sharedMemoryFastPathEnabled,
                active: sharedMemoryFastPathEnabled && sharedMemoryFastPathActive,
                onEnabledChange: handleSharedMemoryFastPathChange,
              }}
              webUsbRedirection={{
                enabled: webUsbRedirectionEnabled,
                onEnabledChange: handleWebUsbRedirectionChange,
              }}
              webDavShare={{
                supported: webDavShareSupported,
                active: webDavShare !== null,
                label: webDavShare?.name ?? 'folder',
                onToggle: handleWebDavShareToggle,
              }}
              actions={
                <>
                  <OpenConsoleWindowButton
                    enabled={isVirtualMachine}
                    instanceName={name}
                    project={project}
                    sharedMemoryFastPathEnabled={sharedMemoryFastPathEnabled}
                    webUsbRedirectionEnabled={webUsbRedirectionEnabled}
                  />
                  <MenubarItem onSelect={() => setExecDialogOpen(true)}>
                    Execute command
                  </MenubarItem>
                </>
              }
            />
            <InstanceExec hideTrigger open={execDialogOpen} onOpenChange={setExecDialogOpen} />
          </>
        }
      >
        {effectiveMode === 'graphical' && isVirtualMachine ? (
          <GraphicalConsoleView
            enabled
            forceTakeoverToken={forceTakeoverTokens.graphical}
            instanceClass={instanceClass}
            onConsoleInUse={handleGraphicalConsoleInUse}
            onControllerChange={setGraphicalController}
            sharedMemoryFastPath={sharedMemoryFastPathEnabled}
            webUsbRedirection={webUsbRedirectionEnabled}
            webDavShare={webDavShare}
            qxlFrameBands={qxlFrameBandsAllowed}
            spiceStreamingTuning={spiceStreamingTuning}
            showDiagnosticsOverlay={diagnosticsOverlay}
          />
        ) : (
          <TextConsoleView
            viewportRef={textSession.viewportRef}
            terminalRef={textSession.terminalRef}
            onFocus={textSession.focusTerminal}
          />
        )}
      </ConsoleShell>
      <AlertDialog
        open={activeForceTakeoverRequest !== null}
        onOpenChange={(open) => {
          if (!open) {
            setForceTakeoverRequest(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Console already in use</AlertDialogTitle>
            <AlertDialogDescription>
              Another client is already connected to the{' '}
              {activeForceTakeoverRequest?.mode === 'graphical' ? 'graphical' : 'text'} console.
              Taking over will disconnect that existing console session and reconnect this browser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep existing session</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const request = activeForceTakeoverRequest;
                if (!request) {
                  return;
                }

                setForceTakeoverTokens((current) => ({
                  ...current,
                  [request.mode]: current[request.mode] + 1,
                }));
                setForceTakeoverRequest(null);
              }}
            >
              Take over console
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function OpenConsoleWindowButton({
  enabled,
  instanceName,
  project,
  sharedMemoryFastPathEnabled,
  webUsbRedirectionEnabled,
}: {
  enabled: boolean;
  instanceName: string | null;
  project: string | null;
  sharedMemoryFastPathEnabled: boolean;
  webUsbRedirectionEnabled: boolean;
}) {
  return (
    <MenubarItem
      disabled={!enabled || !instanceName}
      onSelect={() => {
        if (!instanceName || typeof window === 'undefined') {
          return;
        }

        const query = new URLSearchParams({
          name: instanceName,
          takeover: '1',
        });
        if (project) {
          query.set('project', project);
        }
        if (sharedMemoryFastPathEnabled) {
          query.set(SHARED_MEMORY_FAST_PATH_QUERY, '1');
        }
        if (webUsbRedirectionEnabled) {
          query.set(WEBUSB_REDIRECTION_QUERY, '1');
        }
        const basePath = window.location.pathname.startsWith('/ui/') ? '/ui' : '';
        window.open(
          `${basePath}/instance/console/window?${query.toString()}`,
          '_blank',
          consolePopupWindowFeatures(),
        );
      }}
    >
      <ExternalLinkIcon />
      New window
    </MenubarItem>
  );
}

function consolePopupWindowFeatures() {
  const screenWidth = window.screen.availWidth || window.screen.width || 1280;
  const screenHeight = window.screen.availHeight || window.screen.height || 800;
  const width = Math.min(1400, Math.max(900, Math.floor(screenWidth * 0.9)));
  const height = Math.min(900, Math.max(640, Math.floor(screenHeight * 0.9)));
  const left = Math.max(0, Math.floor((screenWidth - width) / 2));
  const top = Math.max(0, Math.floor((screenHeight - height) / 2));

  return [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=no',
    'noopener=yes',
    'noreferrer=yes',
  ].join(',');
}

function readSharedMemoryFastPathSearchParam() {
  if (typeof window === 'undefined') {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  return sharedMemoryFastPathFromSearchParams(params);
}

function initialSharedMemoryFastPathEnabled() {
  const requested = readSharedMemoryFastPathSearchParam();
  return requested ?? readRememberedSharedMemoryFastPath() ?? false;
}

function readWebUsbRedirectionSearchParam() {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  return parseBooleanFlag(
    params.get(WEBUSB_REDIRECTION_QUERY) ?? params.get(WEBUSB_REDIRECTION_ALIAS_QUERY),
  );
}

function readDiagnosticsOverlaySearchParam() {
  if (typeof window === 'undefined') {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return readBooleanPresenceParam(
    params,
    DIAGNOSTICS_OVERLAY_QUERY,
    DIAGNOSTICS_OVERLAY_ALIAS_QUERY,
  );
}

function readBooleanPresenceParam(params: URLSearchParams, key: string, alias: string) {
  const raw = params.get(key) ?? params.get(alias);
  if (raw === null) {
    return false;
  }
  if (raw === '') {
    return true;
  }
  return parseBooleanFlag(raw) !== false;
}

function readConsoleModeSearchParam(): ConsoleMode | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const value = params.get(CONSOLE_MODE_QUERY) ?? params.get(CONSOLE_MODE_ALIAS_QUERY);
  return value === 'graphical' || value === 'text' ? value : null;
}

function initialWebUsbRedirectionEnabled() {
  const requested = readWebUsbRedirectionSearchParam();
  return requested ?? readRememberedWebUsbRedirection() ?? false;
}

function readRememberedSharedMemoryFastPath() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return parseBooleanFlag(window.localStorage.getItem(SHARED_MEMORY_FAST_PATH_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readRememberedWebUsbRedirection() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return parseBooleanFlag(window.localStorage.getItem(WEBUSB_REDIRECTION_STORAGE_KEY));
  } catch {
    return null;
  }
}

function rememberSharedMemoryFastPath(enabled: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(SHARED_MEMORY_FAST_PATH_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage can be disabled in hardened browser profiles.
  }
}

function rememberWebUsbRedirection(enabled: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(WEBUSB_REDIRECTION_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Storage can be disabled in hardened browser profiles.
  }
}

function writeSharedMemoryFastPathCookie(enabled: boolean) {
  if (typeof document === 'undefined') {
    return;
  }
  document.cookie = sharedMemoryFastPathCookieValue(enabled);
}

function getConsoleModePreferenceKey(instanceName: string | null) {
  return instanceName ? `ararat:console-mode:${instanceName}` : null;
}

function readRememberedConsoleMode(instanceName: string | null) {
  const key = getConsoleModePreferenceKey(instanceName);
  if (!key || typeof window === 'undefined') {
    return null;
  }

  try {
    const value = window.localStorage.getItem(key);
    return value === 'text' || value === 'graphical' ? value : null;
  } catch {
    return null;
  }
}

function rememberConsoleMode(instanceName: string | null, mode: ConsoleMode) {
  const key = getConsoleModePreferenceKey(instanceName);
  if (!key || typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, mode);
  } catch {
    // Storage can be disabled in hardened browser profiles.
  }
}

function getDefaultConsoleMode(instance: Instance | undefined): ConsoleMode {
  return isWindowsImage(instance) ? 'graphical' : 'text';
}

function isWindowsImage(instance: Instance | undefined) {
  const imageOs = instance?.config?.['image.os'] ?? instance?.expanded_config?.['image.os'] ?? '';

  return imageOs.toLocaleLowerCase().includes('windows');
}
