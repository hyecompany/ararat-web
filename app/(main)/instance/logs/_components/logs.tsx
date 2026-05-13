'use client';

import * as React from 'react';
import { addTransitionType } from 'react';
import { LogsIcon } from 'lucide-react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ListItemTransition } from '@/components/ui/view-transitions';

import { useInstanceLogs } from '../_hooks/logs';
import { useIncusClient } from '@/app/_incus/provider';
import { LogViewer, LogViewerSkeleton } from './log-viewer';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

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

const LOG_TITLES: Record<string, string> = {
  'lxc.log': 'System Events',
  'qemu.log': 'System Output',
  'qemu.early.log': 'Initialization Log',
  'qemu.qmp.log': 'System Commands',
};

export default function Logs({
  instanceName,
  project,
}: {
  instanceName: string;
  project?: string | null;
}) {
  const {
    data: logs,
    isLoading,
    error: logsError,
    mutate,
  } = useInstanceLogs(instanceName, project);
  const client = useIncusClient();
  const [selectedLog, setSelectedLog] = React.useState<string | null>(null);
  const [logToDelete, setLogToDelete] = React.useState<string | null>(null);
  const [hiddenLogs, setHiddenLogs] = React.useState<Set<string>>(() => new Set());
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const visibleLogs = React.useMemo(
    () => logs?.filter((filename) => !hiddenLogs.has(filename)) ?? [],
    [hiddenLogs, logs],
  );
  const defaultLog = React.useMemo(
    () => visibleLogs.find((filename) => filename.endsWith('lxc.log')) ?? visibleLogs[0] ?? null,
    [visibleLogs],
  );
  const effectiveSelectedLog =
    selectedLog && visibleLogs.includes(selectedLog) ? selectedLog : defaultLog;

  const selectLog = React.useCallback((filename: string | null) => {
    React.startTransition(() => {
      addTransitionType('side-tab-select');
      setSelectedLog(filename);
    });
  }, []);

  React.useEffect(() => {
    if (selectedLog && !visibleLogs.includes(selectedLog)) {
      selectLog(null);
    }
  }, [visibleLogs, selectedLog, selectLog]);

  const confirmDelete = async () => {
    if (!logToDelete) return;
    const filename = logToDelete;
    let hidDeletedLog = false;

    try {
      setDeleteError(null);
      setIsDeleting(true);
      await client.instanceLogs.delete({
        instanceName,
        project,
        filename,
      });

      React.startTransition(() => {
        addTransitionType('side-tab-select');
        setHiddenLogs((current) => new Set(current).add(filename));
        hidDeletedLog = true;
        if (effectiveSelectedLog === filename) {
          setSelectedLog(null);
        }
        setLogToDelete(null);
      });

      await mutate();
      setHiddenLogs((current) => {
        const next = new Set(current);
        next.delete(filename);
        return next;
      });
    } catch (error) {
      if (hidDeletedLog) {
        setHiddenLogs((current) => {
          const next = new Set(current);
          next.delete(filename);
          return next;
        });
      }
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete log file.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {logsError?.message || deleteError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Log operation failed</AlertTitle>
          <AlertDescription>{logsError?.message || deleteError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="relative flex h-full flex-row overflow-hidden rounded-xl border">
          {/* Left Pane: Log List */}
          <div className="bg-muted/30 flex w-64 flex-col border-r">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <LogsIcon className="text-muted-foreground size-4" />
              <span className="text-sm font-semibold">Instance Logs</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-1 p-2">
                {isLoading ? (
                  <LogsListSkeleton />
                ) : (
                  visibleLogs.map((filename) => {
                    const title = LOG_TITLES[filename];
                    return (
                      <ListItemTransition
                        key={filename}
                        transitionKey={filename}
                      >
                        <button
                          type="button"
                          className={cn(
                            'group flex flex-col items-start rounded-md px-3 py-2 text-left transition-colors select-none',
                            effectiveSelectedLog === filename
                              ? 'bg-primary text-primary-foreground'
                              : 'hover:bg-accent hover:text-accent-foreground',
                          )}
                          onClick={() => selectLog(filename)}
                        >
                          <span className="text-sm leading-tight font-medium">
                            {title || filename}
                          </span>
                          {title && (
                            <span
                              className={cn(
                                'mt-0.5 font-mono text-[10px]',
                                effectiveSelectedLog === filename
                                  ? 'text-primary-foreground/70'
                                  : 'text-muted-foreground',
                              )}
                            >
                              {filename}
                            </span>
                          )}
                        </button>
                      </ListItemTransition>
                    );
                  })
                )}
                {!isLoading && visibleLogs.length === 0 && (
                  <Empty className="min-h-40 border-0 p-4">
                    <EmptyHeader>
                      <EmptyTitle>No log files</EmptyTitle>
                      <EmptyDescription>
                        Logs will appear here once the instance writes them.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right Pane: Log Viewer */}
          <div className="bg-background flex flex-1 flex-col overflow-hidden">
            {effectiveSelectedLog ? (
              <LogViewer
                instanceName={instanceName}
                project={project}
                filename={effectiveSelectedLog}
                onDelete={() => setLogToDelete(effectiveSelectedLog)}
                isDeleting={isDeleting && logToDelete === effectiveSelectedLog}
              />
            ) : isLoading ? (
              <LogViewerSkeleton filename={defaultLog} />
            ) : (
              <Empty className="h-full min-h-0 border-0">
                <EmptyHeader>
                  <EmptyTitle>No log selected</EmptyTitle>
                  <EmptyDescription>
                    Choose a log from the list to view its content.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>

        <AlertDialog open={!!logToDelete} onOpenChange={(open) => !open && setLogToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the log file{' '}
                <span className="text-foreground font-mono font-bold">{logToDelete}</span>. This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  confirmDelete();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={isDeleting}
              >
                {isDeleting ? <Spinner className="mr-2 size-4" /> : null}
                Delete File
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function LogsListSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            'space-y-1 rounded-md px-3 py-2',
            index === 0 && 'bg-primary',
          )}
        >
          <Skeleton
            className={cn(
              'h-4 w-28',
              index === 0 && 'bg-primary-foreground/35',
            )}
          />
          <Skeleton
            className={cn(
              'h-3 w-20',
              index === 0 && 'bg-primary-foreground/25',
            )}
          />
        </div>
      ))}
    </>
  );
}
