'use client';

import { use, useState, type FormEvent } from 'react';
import { InstanceContext } from '../_context/instance';
import { useTerminal } from './useTerminal';
import { Button } from 'ui-web/components/button';
import { Input } from 'ui-web/components/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from 'ui-web/components/dialog';

export default function InstanceExec() {
  const { instanceClass } = use(InstanceContext);
  const {
    terminalRef,
    termRef,
    dataSocketRef,
    controlSocketRef,
    inputDisposableRef,
    socketAttachedRef,
    socketAttachingRef,
    logError,
  } = useTerminal();

  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState('');
  const [phase, setPhase] = useState<'input' | 'running'>('input');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!instanceClass || !command.trim() || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    try {
      const args = command.trim().match(/(".*?"|'.*?'|[^"'\s]+)+/g)?.map(arg => arg.replace(/^[\"']|[\"']$/g, '')) || [];
      const { data, control } = await instanceClass.openExecSocket(args);

      // Detect session end. Incus sends a text WebSocket frame (string, not Blob)
      // when the process exits — it sends ""
      // addEventListener fires alongside the hook's onmessage without overwriting it.
      data.addEventListener('message', async (ev: MessageEvent) => {
        try {
          const text =
            typeof ev.data === 'string'
              ? ev.data
              : ev.data instanceof Blob
                ? await ev.data.text()
                : null;
          if (text === '') setSessionEnded(true);
        } catch (err) {
          logError(err, 'Failed to detect exec session end');
        }
      });

      dataSocketRef.current = data;
      controlSocketRef.current = control;
      // No explicit attachToSocket call is needed here: changing to the running phase
      // causes the terminal element to mount, and useTerminal's effect automatically
      // calls attachToSocket once that terminal DOM node is available.
      setPhase('running');
      // useTerminal's terminal-creation effect calls attachToSocket once the terminal div mounts
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setIsConnecting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      try {
        inputDisposableRef.current?.dispose();
      } catch (err) {
        logError(err, 'dispose input on exec dialog close');
      }
      try {
        dataSocketRef.current?.close();
        controlSocketRef.current?.close();
      } catch (err) {
        logError(err, 'close sockets on exec dialog close');
      }
      socketAttachedRef.current = false;
      socketAttachingRef.current = false;
      setPhase('input');
      setCommand('');
      setError(null);
      setIsConnecting(false);
      setSessionEnded(false);
    }
    setOpen(next);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Execute Command
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-3xl w-full">
          <DialogHeader>
            <DialogTitle>Execute Command</DialogTitle>
          </DialogHeader>
          {phase === 'input' ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. ls -la /tmp"
                autoFocus
                disabled={isConnecting}
                className="font-mono"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={isConnecting || !command.trim()}>
                  {isConnecting ? 'Connecting...' : 'Run'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="w-full flex flex-col" style={{ height: '400px' }}>
                <div className="flex-1 min-h-0 rounded-lg border bg-card shadow-sm font-mono overflow-hidden relative">
                  <div
                    ref={terminalRef}
                    className="absolute inset-3"
                    tabIndex={0}
                    role="application"
                    aria-label="Command Execution Terminal"
                    onClick={() => {
                      try {
                        termRef.current?.focus();
                      } catch (err) {
                        logError(err, 'focus exec terminal');
                      }
                    }}
                  />
                </div>
              </div>
              {sessionEnded && (
                <div className="flex items-center justify-between rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <span>Session ended</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenChange(false)}
                  >
                    Close
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
