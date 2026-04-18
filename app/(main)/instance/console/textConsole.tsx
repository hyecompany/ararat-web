'use client';

import { use, useEffect, useRef, useState } from 'react';
import { InstanceContext } from '../_context/instance';
import { useTerminal } from './useTerminal';

export default function InstanceTextConsole() {
  const { instanceClass, isLoading } = use(InstanceContext);
  const {
    terminalRef,
    termRef,
    dataSocketRef,
    controlSocketRef,
    inputDisposableRef,
    socketAttachedRef,
    socketAttachingRef,
    attachToSocket,
    logError,
  } = useTerminal();

  const [retryTrigger, setRetryTrigger] = useState(0);
  const connectedNameRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const instanceTokenRef = useRef(0);

  // Open sockets once when instance is ready
  useEffect(() => {
    if (isLoading || !instanceClass) return;

    const token = ++instanceTokenRef.current;

    // Reset on instance name change
    if (connectedNameRef.current !== instanceClass.name) {
      initializedRef.current = false;
      try {
        dataSocketRef.current?.close();
      } catch (err) {
        logError(err, 'close data socket on name change');
      }
      try {
        controlSocketRef.current?.close();
      } catch (err) {
        logError(err, 'close control socket on name change');
      }
      connectedNameRef.current = instanceClass.name;
    }

    if (initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      try {
        const previousOutput = await instanceClass.getConsoleOutput();
        if (token !== instanceTokenRef.current) return;
        if (previousOutput && termRef.current) {
          termRef.current.write(previousOutput);
        }
      } catch (err) {
        if (termRef.current) {
          termRef.current.write(
            `\r\n[console] Unable to load previous console output for this instance.\r\n` +
              `[console] Live logs may still appear below. If the problem persists, try reconnecting to the instance or refreshing the page.\r\n`,
          );
        }
        logError(err, 'getConsoleOutput');
      }

      const { data, control } = await instanceClass.openConsoleSocket('console', {
        width: termRef.current?.cols,
        height: termRef.current?.rows,
      });
      if (token !== instanceTokenRef.current) {
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
      dataSocketRef.current = data;
      controlSocketRef.current = control;
      attachToSocket();
    })().catch((err) => {
      logError(err, 'attach console sockets');
      initializedRef.current = false;
    });
  }, [isLoading, instanceClass, attachToSocket, logError, retryTrigger]);

  return (
    <div className="w-full flex flex-col" style={{ height: '60vh', minHeight: '300px' }}>
      {/* Outer visual container controls padding/border without affecting terminal fit */}
      <div className="flex-1 min-h-0 rounded-lg border bg-card shadow-sm font-mono p-3 box-border overflow-hidden">
        {/* Host element must be padding-free to let FitAddon calculate width correctly */}
        <div
          ref={terminalRef}
          className="h-full w-full"
          tabIndex={0}
          role="application"
          aria-label="Instance Console"
          onClick={() => {
            try {
              termRef.current?.focus();
            } catch (err) {
              logError(err, 'focus terminal');
            }
          }}
        />
      </div>
      {/* Simple retry control - outside overflow container */}
      <div className="mt-2 text-xs text-muted-foreground">
        <button
          type="button"
          aria-label="Retry console connection"
          className="underline"
          onClick={() => {
            try {
              inputDisposableRef.current?.dispose();
            } catch (err) {
              logError(err, 'dispose input on retry');
            }
            try {
              initializedRef.current = false;
              socketAttachedRef.current = false;
              socketAttachingRef.current = false;
              const sock = dataSocketRef.current;
              if (sock) {
                sock.close();
              }
              setRetryTrigger((n) => n + 1);
            } catch (err) {
              logError(err, 'retry attach');
            }
          }}
        >
          Retry attach
        </button>
      </div>
    </div>
  );
}
