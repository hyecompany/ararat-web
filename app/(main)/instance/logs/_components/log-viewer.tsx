'use client';

import * as React from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import { Badge } from 'ui-web/components/badge';
import {
  cn,
  dashboardMonacoOptions,
  dashboardMonacoTheme,
  defineDashboardMonacoThemes,
} from 'ui-web/lib/utils';
import { Switch } from 'ui-web/components/switch';
import { Label } from 'ui-web/components/label';
import DataTable from 'ui-web/components/data-table';
import { ColumnDef, Row } from '@tanstack/react-table';
import { Trash2Icon, ChevronDown, ChevronRight } from 'lucide-react';
import { Separator } from 'ui-web/components/separator';

import { useInstanceLogContent } from '../_hooks/logs';
import { Spinner } from 'ui-web/components/spinner';
import { Button } from 'ui-web/components/button';
import { Skeleton } from 'ui-web/components/skeleton';

// --- Date Formatting Helpers ---

const STRUCTURED_LOG_LINE_LIMIT = 20000;

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
    return ms ? formatted + '.' + ms : formatted;
  } catch (e) {
    return date.toISOString();
  }
}

function countLogLines(content: string) {
  if (!content) return 0;
  let lineCount = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) {
      lineCount++;
    }
  }

  if (content.endsWith('\n')) {
    lineCount--;
  }

  return lineCount;
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

const LXC_LOG_REGEX =
  /^lxc\s+(?:\S+\s+)?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{3})\s+(\S+)\s+(\S+)\s+-\s+([^:]+:[^:]+:\d+)\s+-\s+(.+)$/;

function parseLxcLog(content: string): LxcLogEntry[] {
  const lines = content.split('\n');
  const entries: LxcLogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(LXC_LOG_REGEX);
    if (match) {
      const [, year, month, day, hour, minute, second, ms, level, component, file, message] = match;

      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second),
        parseInt(ms),
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
  raw: string;
  payloadText: string;
}

// Using case-insensitive match for the type (QUERY/REPLY/EVENT/Event)
const QMP_LOG_REGEX = /^\[(.*?)\] (QUERY|REPLY|EVENT): (.*)$/i;

function qmpSummary(type: QmpLogEntry['type'], payloadText: string) {
  if (type === 'QUERY') {
    const command = payloadText.match(/"execute"\s*:\s*"([^"]+)"/)?.[1];
    return command ? `execute: ${command}` : payloadText.substring(0, 80);
  }

  if (type === 'EVENT') {
    const event = payloadText.match(/"event"\s*:\s*"([^"]+)"/)?.[1];
    return event ? `event: ${event}` : payloadText.substring(0, 80);
  }

  if (type === 'REPLY') {
    const errorClass = payloadText.match(/"class"\s*:\s*"([^"]+)"/)?.[1];
    if (errorClass) return `error: ${errorClass}`;
    if (payloadText.includes('"return"')) return 'success';
  }

  return payloadText.substring(0, 80);
}

function formatJsonPayload(payloadText: string) {
  try {
    return JSON.stringify(JSON.parse(payloadText), null, 2);
  } catch {
    return payloadText;
  }
}

function parseQmpLog(content: string): QmpLogEntry[] {
  const lines = content.split('\n');
  const entries: QmpLogEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(QMP_LOG_REGEX);
    if (match) {
      const [, timestampStr, typeStr, payloadStr] = match;
      const type = typeStr.toUpperCase() as QmpLogEntry['type'];
      const command =
        type === 'QUERY' || type === 'EVENT'
          ? payloadStr.match(/"(?:execute|event)"\s*:\s*"([^"]+)"/)?.[1]
          : undefined;

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
        summary: qmpSummary(type, payloadStr),
        raw: line,
        payloadText: payloadStr,
      });
    } else {
      entries.push({
        id: `qmp-${i}`,
        timestamp: '',
        type: 'UNKNOWN',
        summary: line.substring(0, 50),
        raw: line,
        payloadText: line,
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
    <Badge variant={variant} className="h-4 px-1.5 py-0 font-mono text-[10px] leading-none">
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
          <ChevronDown className="text-muted-foreground size-3" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3" />
        )}
      </div>
    ),
  },
  {
    accessorKey: 'timestamp',
    header: 'Timestamp',
    size: 110,
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-[10px] whitespace-nowrap">
        {row.original.timestamp}
      </span>
    ),
  },
  {
    accessorKey: 'level',
    header: 'Level',
    size: 60,
    cell: ({ row }) => <LevelBadge level={row.original.level} />,
  },
  {
    accessorKey: 'component',
    header: 'Comp',
    size: 70,
    cell: ({ row }) => (
      <span className="text-muted-foreground truncate font-mono text-[10px]">
        {row.original.component}
      </span>
    ),
  },
  {
    accessorKey: 'message',
    header: 'Message',
    // No size -> flexible
    cell: ({ row }) => (
      <div className="pr-4 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap">
        {row.original.message}
      </div>
    ),
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
          <ChevronDown className="text-muted-foreground size-3" />
        ) : (
          <ChevronRight className="text-muted-foreground size-3" />
        )}
      </div>
    ),
  },
  {
    accessorKey: 'timestamp',
    header: 'Timestamp',
    size: 110,
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-[10px] whitespace-nowrap">
        {row.original.timestamp}
      </span>
    ),
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
      return (
        <Badge variant={variant} className="h-4 px-1.5 py-0 text-[10px] leading-none">
          {row.original.type}
        </Badge>
      );
    },
  },
  {
    accessorKey: 'summary',
    header: 'Summary',
    // No size -> flexible
    cell: ({ row }) => (
      <div className="text-foreground pr-4 font-mono text-[10px] break-words whitespace-pre-wrap">
        {row.original.summary}
      </div>
    ),
  },
];

// --- Main Viewer ---

export function LogViewer({
  instanceName,
  project,
  filename,
  onDelete,
  isDeleting,
}: {
  instanceName: string;
  project?: string | null;
  filename: string;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const {
    data: content,
    isLoading,
    error,
  } = useInstanceLogContent(instanceName, project, filename);
  const [isRawView, setIsRawView] = React.useState(false);

  const isLxcLog = filename.endsWith('lxc.log');
  const isQmpLog = filename.endsWith('qemu.qmp.log');
  const showToggle = isLxcLog || isQmpLog;
  const lineCount = React.useMemo(() => (content ? countLogLines(content) : 0), [content]);
  const canUseStructuredView = showToggle && lineCount <= STRUCTURED_LOG_LINE_LIMIT;
  const shouldShowStructuredView = canUseStructuredView && !isRawView;

  React.useEffect(() => {
    setIsRawView(false);
  }, [filename]);

  const parsedEntries = React.useMemo(() => {
    if (!content || !canUseStructuredView) return [];
    if (isLxcLog) return parseLxcLog(content);
    if (isQmpLog) return parseQmpLog(content);
    return [];
  }, [canUseStructuredView, isLxcLog, isQmpLog, content]);

  if (isLoading) {
    return <LogViewerSkeleton filename={filename} />;
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center">
        <div className="text-destructive mb-4 text-sm font-medium">
          Error loading log content: {error.message}
        </div>
        <Button variant="outline" size="sm" onClick={onDelete} disabled={isDeleting}>
          <Trash2Icon className="mr-2 size-4" />
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
        <div className="bg-muted/30 border-muted-foreground/10 flex flex-col gap-2 border-y p-3 font-mono text-[10px]">
          {entry.file && (
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16 shrink-0 font-bold tracking-tighter uppercase">
                Source:
              </span>
              <span className="text-foreground">{entry.file}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-muted-foreground w-16 shrink-0 font-bold tracking-tighter uppercase">
              Raw:
            </span>
            <span className="text-foreground break-all whitespace-pre-wrap">{entry.raw}</span>
          </div>
        </div>
      );
    }
    if (isQmpLog) {
      const entry = data as QmpLogEntry;
      return (
        <div className="bg-muted/30 border-muted-foreground/10 flex flex-col gap-3 border-y p-3 font-mono text-[10px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-16 shrink-0 font-bold tracking-tighter uppercase">
              Type:
            </span>
            <Badge variant="outline" className="h-4 text-[10px] leading-none">
              {entry.type}
            </Badge>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground font-bold tracking-tighter uppercase">
              Payload:
            </span>
            <div className="bg-background/50 max-h-[400px] overflow-auto rounded border p-2">
              <pre className="text-foreground">{formatJsonPayload(entry.payloadText)}</pre>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-16 shrink-0 font-bold tracking-tighter uppercase">
              Raw:
            </span>
            <span className="text-foreground break-all whitespace-pre-wrap opacity-70">
              {entry.raw}
            </span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="bg-muted/20 flex shrink-0 items-center justify-between border-b px-4 py-1">
        <div className="mr-4 flex items-center gap-3 overflow-hidden">
          <span className="text-muted-foreground truncate font-mono text-[10px] font-medium">
            {filename}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive h-5 px-2 text-[10px]"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Spinner className="mr-2 size-3" />
            ) : (
              <Trash2Icon className="mr-2 size-3" />
            )}
            Delete
          </Button>

          {canUseStructuredView && (
            <>
              <Separator orientation="vertical" className="h-3" />
              <div className="flex items-center space-x-2">
                <Switch
                  id="raw-view"
                  checked={isRawView}
                  onCheckedChange={setIsRawView}
                  className="h-3.5 w-6.5 [&>span]:h-2.5 [&>span]:w-2.5 [&>span]:data-[state=checked]:translate-x-3"
                />
                <Label
                  htmlFor="raw-view"
                  className="cursor-pointer text-[10px] font-medium select-none"
                >
                  Raw View
                </Label>
              </div>
            </>
          )}
          {showToggle && !canUseStructuredView ? (
            <span className="text-muted-foreground text-[10px]">
              Structured view disabled for {lineCount.toLocaleString()} lines
            </span>
          ) : null}
        </div>
      </div>

      <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden">
        {shouldShowStructuredView ? (
          <div className="relative h-full w-0 min-w-full flex-1 overflow-hidden">
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
              getRowClassName={(row) =>
                cn(
                  row.getIsExpanded() && 'bg-muted/50',
                  'border-b border-muted/30 last:border-b-0 hover:bg-muted/20',
                )
              }
              fixedLayout={true}
              wrapTableRow={(row, rowElement) => (
                <React.Fragment key={row.id}>
                  {rowElement}
                  {row.getIsExpanded() && (
                    <tr>
                      <td colSpan={row.getVisibleCells().length} className="border-none p-0">
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
              beforeMount={defineDashboardMonacoThemes}
              theme={dashboardMonacoTheme(resolvedTheme)}
              options={{
                ...dashboardMonacoOptions,
                readOnly: true,
                minimap: { enabled: true },
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
      <div className="bg-muted/20 flex items-center justify-between border-b px-4 py-1">
        <Skeleton className="h-3 w-40 max-w-[50%]" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <div className="bg-background min-h-0 flex-1 space-y-2 overflow-hidden p-4 font-mono text-xs">
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
