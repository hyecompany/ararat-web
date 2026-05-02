'use client';
import '@xterm/xterm/css/xterm.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { DARK_THEME, LIGHT_THEME } from './terminalThemes';

export function useTerminal() {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const dataSocketRef = useRef<WebSocket | null>(null);
  const controlSocketRef = useRef<WebSocket | null>(null);
  const inputDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const socketAttachedRef = useRef(false);
  const socketAttachingRef = useRef(false);
  const textEncoderRef = useRef(new TextEncoder());
  const [isReady, setIsReady] = useState(false);

  // Callback ref so terminal init fires exactly when the DOM element mounts,
  // which is critical for dialogs where the element may not exist at hook init.
  const [terminalEl, setTerminalEl] = useState<HTMLDivElement | null>(null);
  const terminalRef = useCallback((node: HTMLDivElement | null) => {
    setTerminalEl(node);
  }, []);

  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  const terminalTheme = useMemo(() => (isDark ? DARK_THEME : LIGHT_THEME), [isDark]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const mediaHandler = () => update();
    media.addEventListener('change', mediaHandler);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', mediaHandler);
    };
  }, []);

  const logError = useCallback((err: unknown, context: string) => {
    if (process.env.NODE_ENV === 'production') return;
    console.error(`[console] ${context}`, err);
  }, []);

  const sendResizeMetadata = useCallback(() => {
    const ctrl = controlSocketRef.current;
    if (ctrl && ctrl.readyState === WebSocket.OPEN && termRef.current) {
      try {
        ctrl.send(
          JSON.stringify({
            type: 'window-resize',
            metadata: { width: termRef.current.cols, height: termRef.current.rows },
          }),
        );
      } catch (err) {
        logError(err, 'send resize metadata');
      }
    }
  }, [logError]);

  const fitTerminal = useCallback(() => {
    const fit = fitRef.current;
    const terminalEl = termRef.current?.element?.parentElement;

    if (!fit || !terminalEl) {
      return;
    }

    try {
      if (terminalEl.clientWidth > 0 && terminalEl.clientHeight > 0) {
        fit.fit();
        sendResizeMetadata();
      }
    } catch (err) {
      logError(err, 'fit terminal');
    }
  }, [logError, sendResizeMetadata]);

  const focusTerminal = useCallback(() => {
    try {
      termRef.current?.focus();
    } catch (err) {
      logError(err, 'focus terminal');
    }
  }, [logError]);

  const clearTerminal = useCallback(() => {
    try {
      termRef.current?.reset();
    } catch (err) {
      logError(err, 'clear terminal');
    }
  }, [logError]);

  const resetSocketState = useCallback(() => {
    socketAttachedRef.current = false;
    socketAttachingRef.current = false;
    try {
      inputDisposableRef.current?.dispose();
    } catch (err) {
      logError(err, 'dispose terminal input');
    }
    inputDisposableRef.current = null;
  }, [logError]);

  const closeSockets = useCallback(() => {
    try {
      dataSocketRef.current?.close();
    } catch (err) {
      logError(err, 'close data socket');
    }
    try {
      controlSocketRef.current?.close();
    } catch (err) {
      logError(err, 'close control socket');
    }
    dataSocketRef.current = null;
    controlSocketRef.current = null;
  }, [logError]);

  const setSockets = useCallback((data: WebSocket | null, control: WebSocket | null) => {
    dataSocketRef.current = data;
    controlSocketRef.current = control;
  }, []);

  const sendInput = useCallback(
    (data: string | Uint8Array) => {
      const sock = dataSocketRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        sock.send(typeof data === 'string' ? textEncoderRef.current.encode(data) : data);
      } catch (err) {
        logError(err, 'send terminal data');
      }
    },
    [logError],
  );

  const attachToSocket = useCallback(() => {
    const sock = dataSocketRef.current;
    const term = termRef.current;
    if (!sock || !term || socketAttachedRef.current || socketAttachingRef.current) return;

    const readyState = sock.readyState;
    if (readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED) return;

    socketAttachingRef.current = true;

    const setupSocket = () => {
      socketAttachingRef.current = false;
      if (socketAttachedRef.current) return;
      socketAttachedRef.current = true;

      sock.onmessage = async (ev: MessageEvent) => {
        try {
          if (typeof ev.data === 'string') {
            term.write(ev.data);
          } else if (ev.data instanceof Blob) {
            const buffer = await ev.data.arrayBuffer();
            term.write(new Uint8Array(buffer));
          } else if (ev.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(ev.data));
          }
        } catch (err) {
          try {
            term.writeln("\r\n[console] Failed to process incoming console output.");
          } catch (writeErr) {
            logError(writeErr, 'write data socket onmessage error');
          }
          logError(err, 'data socket onmessage');
        }
      };

      sock.onerror = (err) => {
        socketAttachedRef.current = false;
        try {
          term.writeln("\r\n[console] Data socket error. Try clicking 'Reconnect' above.");
        } catch (writeErr) {
          logError(writeErr, 'write data socket error message');
        }
        logError(err, 'data socket error');
      };

      sock.onclose = () => {
        socketAttachedRef.current = false;
        socketAttachingRef.current = false;
        try {
          term.writeln("[console] Connection closed. Click 'Reconnect' above to reconnect.");
        } catch (err) {
          logError(err, 'write data socket closed');
        }
      };

      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = term.onData((data: string) => {
        sendInput(data);
      });

      focusTerminal();
    };

    if (readyState === WebSocket.OPEN) {
      setupSocket();
    } else {
      const onOpen = () => {
        setupSocket();
        sock.removeEventListener('open', onOpen);
      };
      const clearInFlight = () => {
        socketAttachingRef.current = false;
        sock.removeEventListener('close', clearInFlight);
        sock.removeEventListener('error', clearInFlight);
      };
      sock.addEventListener('close', clearInFlight);
      sock.addEventListener('error', clearInFlight);
      sock.addEventListener('open', onOpen);
    }
  }, [focusTerminal, logError, sendInput]);

  // Create and wire the terminal when the DOM element becomes available
  useEffect(() => {
    if (!terminalEl) return;
    if (termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      disableStdin: false,
      fontFamily: 'var(--font-geist-mono), monospace',
      fontSize: 13,
      lineHeight: 1.4,
      theme: terminalTheme,
    });
    const fit = new FitAddon();
    termRef.current = term;
    fitRef.current = fit;
    setIsReady(true);

    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalEl);

    const handleResize = () => {
      fitTerminal();
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalEl);
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleResize);

    fitTerminal();
    requestAnimationFrame(() => requestAnimationFrame(handleResize));

    attachToSocket();
    const retryTimer = window.setTimeout(attachToSocket, 50);

    if (dataSocketRef.current && dataSocketRef.current.readyState === WebSocket.OPEN) {
      try {
        inputDisposableRef.current?.dispose();
      } catch (err) {
        logError(err, 'dispose input before reattach');
      }
      socketAttachedRef.current = false;
      attachToSocket();
    }

    return () => {
      clearTimeout(retryTimer);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleResize);
      resetSocketState();
      try {
        termRef.current?.dispose();
      } catch (err) {
        logError(err, 'dispose terminal on unmount');
      }
      termRef.current = null;
      fitRef.current = null;
      setIsReady(false);
    };
    // terminalTheme intentionally omitted — updated separately to avoid full recreation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalEl, attachToSocket, fitTerminal, logError, resetSocketState]);

  // Update theme without recreating the terminal
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = terminalTheme;
    }
  }, [terminalTheme]);

  // Close sockets on unmount
  useEffect(() => {
    return () => {
      closeSockets();
    };
  }, [closeSockets]);

  return {
    isReady,
    terminalRef,
    termRef,
    fitRef,
    dataSocketRef,
    controlSocketRef,
    inputDisposableRef,
    socketAttachedRef,
    socketAttachingRef,
    attachToSocket,
    closeSockets,
    setSockets,
    resetSocketState,
    sendInput,
    focusTerminal,
    fitTerminal,
    clearTerminal,
    logError,
  };
}
