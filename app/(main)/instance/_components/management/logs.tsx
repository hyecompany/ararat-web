'use client';

import * as React from 'react';
import { Trash2Icon, LogsIcon } from 'lucide-react';
import { useSWRConfig } from 'swr';

import { Button } from 'ui-web/components/button';
import { ScrollArea } from 'ui-web/components/scroll-area';
import { Separator } from 'ui-web/components/separator';
import { cn } from 'ui-web/lib/utils';

import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { ManagementFooter } from './footer';
import { ManagementShell } from './shell';
import { useInstanceLogs } from '../../_hooks/logs';
import { deleteInstanceLog } from '../../_lib/logs';
import { LogViewer } from './log-viewer';
import { Spinner } from 'ui-web/components/spinner';

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
  const { data: logs, isLoading, error: logsError } = useInstanceLogs(instance);
  const { mutate } = useSWRConfig();
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
      await deleteInstanceLog(instance, logToDelete);
      
      await mutate(`/1.0/instances/${instance.name}/logs`);
      
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
        {isLoading && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-[1px]">
            <Spinner className="size-6" />
          </div>
        )}
        {/* Left Pane: Log List */}
        <div className="flex w-64 flex-col border-r bg-muted/30">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <LogsIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Instance Logs</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-1 p-2">
              {logs?.map((filename) => {
                const title = LOG_TITLES[filename];
                return (
                  <button
                    key={filename}
                    type="button"
                    className={cn(
                      'group flex flex-col items-start rounded-md px-3 py-2 text-left transition-colors',
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
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No log files found.
                </div>
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
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a log file to view its content.
            </div>
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
