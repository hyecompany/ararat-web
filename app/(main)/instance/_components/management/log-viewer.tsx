'use client';

import * as React from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import { Badge } from 'ui-web/components/badge';
import { Switch } from 'ui-web/components/switch';
import { Label } from 'ui-web/components/label';
import DataTable from 'ui-web/components/data-table';
import { ColumnDef, Row } from '@tanstack/react-table';
import { Trash2Icon, ChevronDown, ChevronRight } from 'lucide-react';
import { Separator } from 'ui-web/components/separator';

import { useInstanceLogContent } from '../../_hooks/logs';
import type { Instance } from '@/app/(main)/instances/_lib/instances.d';
import { Spinner } from 'ui-web/components/spinner';
import { Button } from 'ui-web/components/button';
import { cn } from 'ui-web/lib/utils';
import { Skeleton } from 'ui-web/components/skeleton';

// --- Date Formatting Helpers ---

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatTimestamp(date: Date, ms?: string) {
  try {
    const formatted = timestampFormatter.format(date);
    return ms ? formatted + "." + ms : formatted;
  } catch (e) {
    return date.toISOString();
  }
}

// --- LXC Log Parsing ---

interface LxcLogEntry {
  id: string;
  timestamp: string;
  level: string;
  component: string;
  file: string;
  message: string;
  raw: string;
}

const LXC_LOG_REGEX = /^lxc\s+(?:\S+\s+)?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{3})\s+(\S+)\s+(\S+)\s+-\s+([^:]+:[^:]+:\d+)\s+-\s+(.+)$/;

function parseLxcLog(content: string): LxcLogEntry[] {
  const lines = content.split('\n');
  const entries: LxcLogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(LXC_LOG_REGEX);
    if (match) {
      const [
        ,
        year, month, day, hour, minute, second, ms,
        level,
        component,
        file,
        message,
      ] = match;

      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second),
        parseInt(ms)
      );

      entries.push({
        id: `lxc-${i}`,
        timestamp: formatTimestamp(date, ms),
        level: level.trim().toUpperCase(),
        component,
        file,
        message,
        raw: line,
      });
    } else {
      // Fallback for lines that don't match or are continuations
      entries.push({
        id: `lxc-${i}`,
        timestamp: '',
        level: 'RAW',
        component: '',
        file: '',
        message: line,
        raw: line,
      });
    }
  }

  return entries.reverse();
}

// --- QMP Log Parsing ---

interface QmpLogEntry {
  id: string;
  timestamp: string;
  type: 'QUERY' | 'REPLY' | 'EVENT' | 'UNKNOWN';
  command?: string;
  summary: string;
  payload: any;
  rawPayload: string;
  raw: string;
}

// Using case-insensitive match for the type (QUERY/REPLY/EVENT/Event)
const QMP_LOG_REGEX = /^\[(.*?)\] (QUERY|REPLY|EVENT): (.*)$/i;

function parseQmpLog(content: string): QmpLogEntry[] {
  const lines = content.split('\n');
  const entries: QmpLogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(QMP_LOG_REGEX);
    if (match) {
      const [, timestampStr, typeStr, payloadStr] = match;
      let payload = null;
      let command = undefined;
      let summary = '';
      const type = typeStr.toUpperCase() as QmpLogEntry['type'];

      try {
        payload = JSON.parse(payloadStr);
        if (type === 'QUERY' && payload.execute) {
          command = payload.execute;
          summary = `execute: ${command}`;
        } else if (type === 'REPLY') {
          if (payload.return) {
            summary = 'success';
            if (Array.isArray(payload.return)) summary = `return ${payload.return.length} items`;
            else if (typeof payload.return === 'object') summary = `return {${Object.keys(payload.return).join(', ')}}`;
          } else if (payload.error) {
            summary = `error: ${payload.error.class || 'unknown'}`;
          }
        } else if (type === 'EVENT' && payload.event) {
          command = payload.event;
          summary = `event: ${command}`;
        }
      } catch (e) {
        payload = { error: 'Failed to parse JSON', content: payloadStr };
        summary = payloadStr.substring(0, 50);
      }

      // Parse QMP timestamp which is ISO8601-like: [2026-04-22T14:20:37-05:00]
      let displayTimestamp = timestampStr;
      try {
        const date = new Date(timestampStr);
        if (!isNaN(date.getTime())) {
          displayTimestamp = formatTimestamp(date);
        }
      } catch (e) {}

      entries.push({
        id: `qmp-${i}`,
        timestamp: displayTimestamp,
        type,
        command,
        summary: summary || payloadStr.substring(0, 50),
        payload,
        rawPayload: payloadStr,
        raw: line,
      });
    } else {
      entries.push({
        id: `qmp-${i}`,
        timestamp: '',
        type: 'UNKNOWN',
        summary: line.substring(0, 50),
        payload: null,
        rawPayload: line,
        raw: line,
      });
    }
  }

  return entries.reverse();
}

// --- Table Components ---

function LevelBadge({ level }: { level: string }) {
  let variant: 'default' | 'destructive' | 'outline' | 'secondary';
  switch (level) {
    case 'ERROR':
      variant = 'destructive';
      break;
    case 'WARN':
    case 'WARNING':
      variant = 'secondary';
      break;
    case 'INFO':
      variant = 'default';
      break;
    case 'DEBUG':
    case 'TRACE':
      variant = 'outline';
      break;
    case 'RAW':
      variant = 'outline';
      break;
    default:
      variant = 'outline';
  }
  return (
    <Badge variant={variant} className="font-mono text-[10px] px-1.5 py-0 leading-none h-4">
      {level}
    </Badge>
  );
}

const lxcColumns: ColumnDef<LxcLogEntry>[] = [
  {
    id: 'expander',
    header: () => null,
    size: 30,
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        {row.getIsExpanded() ? (
          <ChevronDown className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground" />
        )}
      </div>
    ),
  },
  {
    accessorKey: 'timestamp',
    header: 'Timestamp',
    size: 110,
    cell: ({ row }) => <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">{row.original.timestamp}</span>
  },
  {
    accessorKey: 'level',
    header: 'Level',
    size: 60,
    cell: ({ row }) => <LevelBadge level={row.original.level} />
  },
  {
    accessorKey: 'component',
    header: 'Comp',
    size: 70,
    cell: ({ row }) => <span className="text-[10px] font-mono text-muted-foreground truncate">{row.original.component}</span>
  },
  {
    accessorKey: 'message',
    header: 'Message',
    // No size -> flexible
    cell: ({ row }) => (
      <div className="font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap pr-4">
        {row.original.message}
      </div>
    )
  },
];

const qmpColumns: ColumnDef<QmpLogEntry>[] = [
  {
    id: 'expander',
    header: () => null,
    size: 30,
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        {row.getIsExpanded() ? (
          <ChevronDown className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground" />
        )}
      </div>
    ),
  },
  {
    accessorKey: 'timestamp',
    header: 'Timestamp',
    size: 110,
    cell: ({ row }) => <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">{row.original.timestamp}</span>
  },
  {
    accessorKey: 'type',
    header: 'Type',
    size: 60,
    cell: ({ row }) => {
      let variant: 'default' | 'secondary' | 'outline' = 'outline';
      if (row.original.type === 'QUERY') variant = 'default';
      if (row.original.type === 'REPLY') variant = 'secondary';
      if (row.original.type === 'EVENT') variant = 'outline';
      return <Badge variant={variant} className="text-[10px] px-1.5 py-0 leading-none h-4">{row.original.type}</Badge>;
    }
  },
  {
    accessorKey: 'summary',
    header: 'Summary',
    // No size -> flexible
    cell: ({ row }) => (
      <div className="font-mono text-[10px] break-words whitespace-pre-wrap text-foreground pr-4">
        {row.original.summary}
      </div>
    )
  },
];

// --- Main Viewer ---

export function LogViewer({
  instance,
  filename,
  onDelete,
  isDeleting,
}: {
  instance: Instance;
  filename: string;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const { data: content, isLoading, error } = useInstanceLogContent(instance, filename);
  const [isRawView, setIsRawView] = React.useState(false);

  const isLxcLog = filename.endsWith('lxc.log');
  const isQmpLog = filename.endsWith('qemu.qmp.log');
  const showToggle = isLxcLog || isQmpLog;

  React.useEffect(() => {
    setIsRawView(false);
  }, [filename]);

  const parsedEntries = React.useMemo(() => {
    if (!content) return [];
    if (isLxcLog) return parseLxcLog(content);
    if (isQmpLog) return parseQmpLog(content);
    return [];
  }, [isLxcLog, isQmpLog, content]);

  if (isLoading) {
    return <LogViewerSkeleton filename={filename} />;
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <div className="text-destructive mb-4 text-sm font-medium">Error loading log content: {error.message}</div>
        <Button variant="outline" size="sm" onClick={onDelete} disabled={isDeleting}>
          <Trash2Icon className="size-4 mr-2" />
          Delete Corrupt File
        </Button>
      </div>
    );
  }

  const renderExpandedContent = (row: Row<any>) => {
    const data = row.original;
    if (isLxcLog) {
      const entry = data as LxcLogEntry;
      return (
        <div className="bg-muted/30 p-3 text-[10px] font-mono border-y border-muted-foreground/10 flex flex-col gap-2">
          {entry.file && (
            <div className="flex gap-2">
              <span className="text-muted-foreground shrink-0 w-16 uppercase font-bold tracking-tighter">Source:</span>
              <span className="text-foreground">{entry.file}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0 w-16 uppercase font-bold tracking-tighter">Raw:</span>
            <span className="text-foreground whitespace-pre-wrap break-all">{entry.raw}</span>
          </div>
        </div>
      );
    }
    if (isQmpLog) {
      const entry = data as QmpLogEntry;
      return (
        <div className="bg-muted/30 p-3 text-[10px] font-mono border-y border-muted-foreground/10 flex flex-col gap-3">
          <div className="flex gap-2 items-center">
             <span className="text-muted-foreground shrink-0 w-16 uppercase font-bold tracking-tighter">Type:</span>
             <Badge variant="outline" className="text-[10px] h-4 leading-none">{entry.type}</Badge>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground uppercase font-bold tracking-tighter">Payload:</span>
            <div className="bg-background/50 rounded border p-2 overflow-auto max-h-[400px]">
              <pre className="text-foreground">
                {entry.payload ? JSON.stringify(entry.payload, null, 2) : entry.rawPayload}
              </pre>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0 w-16 uppercase font-bold tracking-tighter">Raw:</span>
            <span className="text-foreground whitespace-pre-wrap break-all opacity-70">{entry.raw}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-1 bg-muted/20 shrink-0">
        <div className="flex items-center gap-3 overflow-hidden mr-4">
          <span className="text-[10px] font-mono font-medium text-muted-foreground truncate">
            {filename}
          </span>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-muted-foreground hover:text-destructive px-2 text-[10px]"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? <Spinner className="size-3 mr-2" /> : <Trash2Icon className="size-3 mr-2" />}
            Delete
          </Button>

          {showToggle && (
            <>
              <Separator orientation="vertical" className="h-3" />
              <div className="flex items-center space-x-2">
                <Switch
                  id="raw-view"
                  checked={isRawView}
                  onCheckedChange={setIsRawView}
                  className="h-3.5 w-6.5 [&>span]:h-2.5 [&>span]:w-2.5 [&>span]:data-[state=checked]:translate-x-3"
                />
                <Label htmlFor="raw-view" className="text-[10px] font-medium cursor-pointer select-none">
                  Raw View
                </Label>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden flex flex-col bg-background">
        {showToggle && !isRawView ? (
          <div className="flex-1 w-0 min-w-full overflow-hidden relative h-full">
            <DataTable
              data={parsedEntries}
              cols={(isLxcLog ? lxcColumns : qmpColumns) as any}
              containerClassName="h-full"
              innerClassName="rounded-none border-0 h-full overflow-auto"
              virtualizeRows={true}
              disablePagination
              virtualScrollMaxHeightClassName="h-full"
              virtualRowEstimatePx={30}
              onRowClick={(row) => row.toggleExpanded()}
              getRowClassName={(row) => cn(
                row.getIsExpanded() && "bg-muted/50",
                "border-b border-muted/30 last:border-b-0 hover:bg-muted/20"
              )}
              fixedLayout={true}
              wrapTableRow={(row, rowElement) => (
                <React.Fragment key={row.id}>
                  {rowElement}
                  {row.getIsExpanded() && (
                    <tr>
                      <td colSpan={row.getVisibleCells().length} className="p-0 border-none">
                        {renderExpandedContent(row)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )}
            />
          </div>
        ) : (
          <div
            className="h-full"
            onKeyDownCapture={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
              }
            }}
          >
            <Editor
              height="100%"
              defaultLanguage="plaintext"
              language={filename.endsWith('.json') ? 'json' : 'plaintext'}
              value={content || ''}
              theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                contextmenu: true,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function LogViewerSkeleton({ filename }: { filename: string }) {
  return (
    <div className="flex h-full flex-col overflow-hidden" aria-busy="true">
      <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-1">
        <Skeleton className="h-3 w-40 max-w-[50%]" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden bg-background p-4 font-mono text-xs">
        <Skeleton className="h-3 w-52" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-5/6" />
        <span className="sr-only">Loading {filename}</span>
      </div>
    </div>
  );
}
