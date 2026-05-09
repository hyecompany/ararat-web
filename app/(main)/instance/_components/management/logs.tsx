'use client';

import * as React from 'react';
import { LogsIcon } from 'lucide-react';

import { ScrollArea } from 'ui-web/components/scroll-area';
import { cn } from 'ui-web/lib/utils';

import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { ManagementFooter } from './footer';
import { ManagementShell } from './shell';
import { useInstanceLogs } from '../../_hooks/logs';
import { useIncusClient } from '@/app/_incus/provider';
import { LogViewer } from './log-viewer';
import { Spinner } from 'ui-web/components/spinner';
import { Skeleton } from 'ui-web/components/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from 'ui-web/components/empty';

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
  instance,
  onBack,
}: {
  instance: Instance;
  onBack?: () => void;
}) {
  const { data: logs, isLoading, error: logsError, mutate } = useInstanceLogs(instance);
  const client = useIncusClient();
  const [selectedLog, setSelectedLog] = React.useState<string | null>(null);
  const [logToDelete, setLogToDelete] = React.useState<string | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleBack = React.useCallback(() => {
    onBack?.();
  }, [onBack]);

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
        instanceName: instance.name,
        project: instance.project,
        filename: logToDelete,
      });

      await mutate();

      if (selectedLog === logToDelete) {
        setSelectedLog(null);
      }
      setLogToDelete(null);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Unable to delete log file.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <ManagementShell
      error={logsError?.message || deleteError}
      footer={
        <ManagementFooter
          backLabel="Back"
          onBack={handleBack}
          primaryLabel="Done"
          onPrimary={handleBack}
        />
      }
    >
      <div className="flex h-full flex-row overflow-hidden rounded-xl border relative">
        {/* Left Pane: Log List */}
        <div className="flex w-64 flex-col border-r bg-muted/30">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <LogsIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Instance Logs</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-1 p-2">
              {isLoading ? (
                <LogsListSkeleton />
              ) : logs?.map((filename) => {
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
                    <span className="text-sm font-medium leading-tight">
                      {title || filename}
                    </span>
                    {title && (
                      <span className={cn(
                        "text-[10px] font-mono mt-0.5",
                        selectedLog === filename ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}>
                        {filename}
                      </span>
                    )}
                  </button>
                );
              })}
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
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          {selectedLog ? (
            <LogViewer
              instance={instance}
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
              This will permanently delete the log file <span className="font-mono font-bold text-foreground">{logToDelete}</span>.
              This action cannot be undone.
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
    </ManagementShell>
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
