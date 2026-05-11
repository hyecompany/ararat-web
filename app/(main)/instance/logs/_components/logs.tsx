'use client';

import * as React from 'react';
import { LogsIcon } from 'lucide-react';

import { ScrollArea } from 'ui-web/components/scroll-area';
import { cn } from 'ui-web/lib/utils';

import { useInstanceLogs } from '../_hooks/logs';
import { useIncusClient } from '@/app/_incus/provider';
import { LogViewer } from './log-viewer';
import { Spinner } from 'ui-web/components/spinner';
import { Skeleton } from 'ui-web/components/skeleton';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from 'ui-web/components/empty';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from 'ui-web/components/alert-dialog';

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
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (logs && logs.length > 0 && !selectedLog) {
      const defaultLog = logs.find((l) => l.endsWith('lxc.log')) || logs[0];
      setSelectedLog(defaultLog);
    }
  }, [logs, selectedLog]);

  const confirmDelete = async () => {
    if (!logToDelete) return;

    try {
      setDeleteError(null);
      setIsDeleting(true);
      await client.instanceLogs.delete({
        instanceName,
        project,
        filename: logToDelete,
      });

      await mutate();

      if (selectedLog === logToDelete) {
        setSelectedLog(null);
      }
      setLogToDelete(null);
    } catch (error) {
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
                  logs?.map((filename) => {
                    const title = LOG_TITLES[filename];
                    return (
                      <button
                        key={filename}
                        type="button"
                        className={cn(
                          'group flex flex-col items-start rounded-md px-3 py-2 text-left transition-colors select-none',
                          selectedLog === filename
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-accent hover:text-accent-foreground',
                        )}
                        onClick={() => setSelectedLog(filename)}
                      >
                        <span className="text-sm leading-tight font-medium">
                          {title || filename}
                        </span>
                        {title && (
                          <span
                            className={cn(
                              'mt-0.5 font-mono text-[10px]',
                              selectedLog === filename
                                ? 'text-primary-foreground/70'
                                : 'text-muted-foreground',
                            )}
                          >
                            {filename}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
                {!isLoading && logs?.length === 0 && (
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
            {selectedLog ? (
              <LogViewer
                instanceName={instanceName}
                project={project}
                filename={selectedLog}
                onDelete={() => setLogToDelete(selectedLog)}
                isDeleting={isDeleting && logToDelete === selectedLog}
              />
            ) : (
              <Empty className="h-full min-h-0 border-0">
                <EmptyHeader>
                  <EmptyTitle>Select a log file</EmptyTitle>
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
        <div key={index} className="space-y-1 rounded-md px-3 py-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </>
  );
}
