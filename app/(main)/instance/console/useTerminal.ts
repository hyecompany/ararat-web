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
          term.writeln("\r\n[console] Data socket error. Try clicking 'Retry attach' below.");
        } catch (writeErr) {
          logError(writeErr, 'write data socket error message');
        }
        logError(err, 'data socket error');
      };

      sock.onclose = () => {
        socketAttachedRef.current = false;
        socketAttachingRef.current = false;
        try {
          term.writeln("[console] Connection closed. Click 'Retry attach' to reconnect.");
        } catch (err) {
          logError(err, 'write data socket closed');
        }
      };

      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = term.onData((data: string) => {
        try {
          if (sock.readyState === WebSocket.OPEN) {
            sock.send(textEncoderRef.current.encode(data));
          }
        } catch (err) {
          logError(err, 'send terminal data');
        }
      });

      term.focus();
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
  }, [logError]);

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

    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalEl);

    const fitIfReady = () => {
      try {
        if (terminalEl.clientWidth > 0 && terminalEl.clientHeight > 0) {
          fit.fit();
        }
      } catch (err) {
        logError(err, 'fit terminal');
      }
    };
    const handleResize = () => {
      fitIfReady();
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
    };
    window.addEventListener('resize', handleResize);

    fitIfReady();
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
      window.removeEventListener('resize', handleResize);
      socketAttachedRef.current = false;
      try {
        inputDisposableRef.current?.dispose();
      } catch (err) {
        logError(err, 'dispose input on unmount');
      }
      try {
        termRef.current?.dispose();
      } catch (err) {
        logError(err, 'dispose terminal on unmount');
      }
      termRef.current = null;
      fitRef.current = null;
    };
    // terminalTheme intentionally omitted — updated separately to avoid full recreation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalEl, attachToSocket, logError]);

  // Update theme without recreating the terminal
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = terminalTheme;
    }
  }, [terminalTheme]);

  // Close sockets on unmount
  useEffect(() => {
    return () => {
      try {
        dataSocketRef.current?.close();
      } catch (err) {
        logError(err, 'close data socket on unmount');
      }
      try {
        controlSocketRef.current?.close();
      } catch (err) {
        logError(err, 'close control socket on unmount');
      }
    };
  }, [logError]);

  return {
    terminalRef,
    termRef,
    fitRef,
    dataSocketRef,
    controlSocketRef,
    inputDisposableRef,
    socketAttachedRef,
    socketAttachingRef,
    attachToSocket,
    logError,
  };
}
