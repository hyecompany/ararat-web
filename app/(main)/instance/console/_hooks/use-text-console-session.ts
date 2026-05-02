'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InstanceClass from '../../../_lib/instance';
import { useConsoleFullscreen } from './use-console-fullscreen';
import { useTerminal } from '../useTerminal';
import { getTextConsoleShortcutSequence } from '../_lib/text-shortcuts';
import type { ConsoleSessionController, ConsoleShortcutId } from '../_lib/shortcuts';
import {
  getErrorMessage,
  isConsoleAlreadyInUseError,
} from '../_lib/console-errors';

interface UseTextConsoleSessionOptions {
  enabled: boolean;
  instanceClass: InstanceClass | null;
  isLoading: boolean;
  forceTakeoverToken?: number;
  onConsoleInUse?: (message: string) => void;
}

export function useTextConsoleSession({
  enabled,
  instanceClass,
  isLoading,
  forceTakeoverToken = 0,
  onConsoleInUse,
}: UseTextConsoleSessionOptions) {
  const {
    isReady,
    terminalRef,
    termRef,
    attachToSocket,
    closeSockets,
    setSockets,
    resetSocketState,
    sendInput,
    focusTerminal,
    fitTerminal,
    clearTerminal,
    logError,
  } = useTerminal();
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const { targetRef, isFullscreen, toggleFullscreen } = useConsoleFullscreen({
    onFullscreenChange: () => {
      requestAnimationFrame(() => fitTerminal());
    },
  });
  const sessionTokenRef = useRef(0);
  const lastForceTakeoverTokenRef = useRef(0);

  const reconnect = useCallback(() => {
    clearTerminal();
    resetSocketState();
    closeSockets();
    setReconnectNonce((value) => value + 1);
  }, [clearTerminal, closeSockets, resetSocketState]);

  useEffect(() => {
    if (!enabled) {
      resetSocketState();
      closeSockets();
      return;
    }

    if (isLoading || !instanceClass || !isReady) {
      return;
    }

    const token = ++sessionTokenRef.current;
    const force =
      forceTakeoverToken > lastForceTakeoverTokenRef.current;
    if (force) {
      lastForceTakeoverTokenRef.current = forceTakeoverToken;
    }
    let currentDataSocket: WebSocket | null = null;
    let currentControlSocket: WebSocket | null = null;
    let cancelled = false;
    let connectFrame: number | null = null;

    clearTerminal();

    const connect = async () => {
      try {
        const previousOutput = await instanceClass.getConsoleOutput();
        if (cancelled || token !== sessionTokenRef.current) {
          return;
        }

        if (previousOutput && termRef.current) {
          termRef.current.write(previousOutput);
        }
      } catch (err) {
        if (!cancelled && termRef.current) {
          termRef.current.write(
            `\r\n[console] Unable to load previous console output for this instance.\r\n` +
              `[console] Live logs may still appear below. If the problem persists, try reconnecting to the instance or refreshing the page.\r\n`,
          );
        }
        logError(err, 'getConsoleOutput');
      }

      const { data, control } = await instanceClass.openConsoleSocket('console', {
        width: termRef.current?.cols ?? 80,
        height: termRef.current?.rows ?? 24,
        force,
      });

      if (cancelled || token !== sessionTokenRef.current) {
        try {
          data.close();
        } catch (err) {
          logError(err, 'close stale data socket');
        }
        try {
          control.close();
        } catch (err) {
          logError(err, 'close stale control socket');
        }
        return;
      }

      currentDataSocket = data;
      currentControlSocket = control;
      setSockets(data, control);
      attachToSocket();
      fitTerminal();
    };

    connectFrame = window.requestAnimationFrame(() => {
      void connect().catch((err) => {
        if (cancelled || token !== sessionTokenRef.current) {
          return;
        }
        if (isConsoleAlreadyInUseError(err)) {
          onConsoleInUse?.(getErrorMessage(err));
        }
        logError(err, 'attach console sockets');
      });
    });

    return () => {
      cancelled = true;
      if (connectFrame !== null) {
        cancelAnimationFrame(connectFrame);
      }
      resetSocketState();

      if (currentDataSocket || currentControlSocket) {
        try {
          currentDataSocket?.close();
        } catch (err) {
          logError(err, 'close text data socket on cleanup');
        }
        try {
          currentControlSocket?.close();
        } catch (err) {
          logError(err, 'close text control socket on cleanup');
        }
        setSockets(null, null);
      } else {
        closeSockets();
      }
    };
  }, [
    attachToSocket,
    clearTerminal,
    closeSockets,
    enabled,
    fitTerminal,
    forceTakeoverToken,
    instanceClass,
    isLoading,
    isReady,
    logError,
    onConsoleInUse,
    reconnectNonce,
    resetSocketState,
    setSockets,
    termRef,
  ]);

  const sendShortcut = useCallback(
    (shortcut: ConsoleShortcutId) => {
      const sequence = getTextConsoleShortcutSequence(shortcut);
      if (!sequence) {
        return;
      }

      sendInput(sequence);
      focusTerminal();
    },
    [focusTerminal, sendInput],
  );

  const controller = useMemo<ConsoleSessionController>(
    () => ({
      canReconnect: enabled,
      canFullscreen: true,
      canSendShortcuts: true,
      canAttachUsb: false,
      isFullscreen,
      diagnostics: null,
      reconnect,
      toggleFullscreen,
      sendShortcut,
      attachUsbDevice: async () => {},
    }),
    [enabled, isFullscreen, reconnect, sendShortcut, toggleFullscreen],
  );

  return {
    controller,
    viewportRef: targetRef,
    terminalRef,
    focusTerminal,
  };
}
