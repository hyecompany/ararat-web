'use client';

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useInstanceContext } from '../_context/instance';
import { useTerminal } from './useTerminal';
import InstanceClass from '../../_lib/instance';
import { Button } from 'ui-web/components/button';
import { Input } from 'ui-web/components/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from 'ui-web/components/dialog';

interface InstanceExecProps {
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: (open: () => void) => ReactNode;
}

export default function InstanceExec({
  hideTrigger = false,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: InstanceExecProps = {}) {
  const { name, project } = useInstanceContext();
  const instanceClass = useMemo(
    () => (name ? new InstanceClass(name, project) : null),
    [name, project],
  );
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

  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
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
      const args =
        command
          .trim()
          .match(/(".*?"|'.*?'|[^"'\s]+)+/g)
          ?.map((arg) => arg.replace(/^[\"']|[\"']$/g, '')) || [];
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
      {!hideTrigger &&
        (trigger ? (
          trigger(() => setOpen(true))
        ) : (
          <Button variant="outline" onClick={() => setOpen(true)}>
            Execute Command
          </Button>
        ))}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="w-full sm:max-w-3xl">
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
              {error && <p className="text-destructive text-sm">{error}</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={isConnecting || !command.trim()}>
                  {isConnecting ? 'Connecting...' : 'Run'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex w-full flex-col" style={{ height: '400px' }}>
                <div className="bg-card relative min-h-0 flex-1 overflow-hidden rounded-lg border font-mono shadow-sm">
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
                <div className="bg-muted text-muted-foreground flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>Session ended</span>
                  <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
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
