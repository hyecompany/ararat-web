'use client';

import React, { ViewTransition, addTransitionType, startTransition } from 'react';
import { Spinner } from 'ui-web/components/spinner';
import { Button } from 'ui-web/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'ui-web/components/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from 'ui-web/components/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'ui-web/components/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from 'ui-web/components/input';
import { Label } from 'ui-web/components/label';
import { Progress } from 'ui-web/components/progress';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from 'ui-web/components/breadcrumb';
import {
  FileIcon,
  FolderIcon,
  MoreHorizontal,
  UploadIcon,
  PlusIcon,
  TrashIcon,
  DownloadIcon,
  HomeIcon,
  SaveIcon,
  XIcon,
  PencilIcon,
  FileCode,
  FileText,
  Image as ImageIcon,
  Braces,
  ChevronDown,
  ChevronRight,
  TextCursorInput,
  ArrowRightLeft,
  AlertTriangle,
  PenLine,
  ClipboardCopy,
  Link2,
  SearchIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import DataTable from 'ui-web/components/data-table';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from 'ui-web/components/empty';
import { FreshnessSurface, StaleShimmer } from 'ui-web/components/freshness';
import { LoadableSurface } from 'ui-web/components/loadable-surface';
import { Skeleton } from 'ui-web/components/skeleton';
import { ColumnDef, Row } from '@tanstack/react-table';
import {
  absPathParent,
  classifyBufferIsBinary,
  downloadArrayBufferAsFile,
  joinAbsPath,
  LARGE_FILE_CONFIRM_BYTES,
  normalizeAbsPath,
  pathDirectoryListingContext,
  preflightOpen,
} from '../_lib/files';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  dashboardMonacoOptions,
  dashboardMonacoTheme,
  defineDashboardMonacoThemes,
  cn,
} from 'ui-web/lib/utils';

interface FileBrowserProps {
  files: (string | FileItem)[];
  isLoading: boolean;
  /** Next.js router transition (URL not committed yet); show immediate toolbar feedback on navigate. */
  isRoutePending?: boolean;
  /** The data client is refetching the folder listing while the previous listing remains visible. */
  isListingRevalidating?: boolean;
  /** True while per-file HEAD metadata (size/type) is still being merged for the current listing. */
  isMetadataLoading?: boolean;
  isError: any;
  homePath?: string;
  currentPath: string;
  onNavigate: (path: string) => void;
  onUpload: (
    file: File,
    onProgress?: (percent: number | null) => void,
  ) => Promise<void>;
  onMoveFiles: (
    sources: { sourcePath: string; fileName: string }[],
    destParentPath: string,
    onProgress?: (
      phase: 'download' | 'upload',
      percent: number | null,
      detail: { index: number; total: number; label: string },
    ) => void,
  ) => Promise<void>;
  onRenameFile: (fullPath: string, newBaseName: string) => Promise<void>;
  onCreateEmptyFile: (name: string) => Promise<void>;
  onCreateDirectory: (name: string) => Promise<void>;
  onDelete: (path: string) => Promise<void>;
  onDownload: (path: string) => void;
  onFetchContent: (path: string) => Promise<{ content: string; mode?: string }>;
  onFetchRaw: (
    path: string,
  ) => Promise<{ buffer: ArrayBuffer; mode?: string }>;
  onSaveContent: (path: string, content: string, mode?: string) => Promise<void>;
  listChildDirectories: (parentAbsPath: string) => Promise<string[]>;
  /** Supplied by the host (e.g. instance vs volume API): classify an absolute path. */
  probePathKind: (
    absPath: string,
  ) => Promise<'directory' | 'file' | 'missing'>;
  fetchDirectoryEntries: (dirPath: string) => Promise<FileItem[]>;
  /** HEAD fetch size/type only for names the table viewport needs (large directories). */
  requestMetadataForNames?: (names: string[]) => void;
  /** Resolve symlink GET body to a navigation target (instance files API). */
  resolveSymlinkNavTarget?: (
    linkFullPath: string,
  ) => Promise<{ directoryPath: string; fileBasename?: string }>;
}

export interface FileItem {
  name: string;
  type?: string;
  size?: number;
  mode?: string;
  uid?: string;
  gid?: string;
  symlinkTargetKind?: 'directory' | 'file' | 'missing';
  symlinkTargetPath?: string;
}

type FileRowPresence = 'entering' | 'exiting';
type RenderedFileItem = FileItem & {
  __rowPresence?: FileRowPresence;
};

// Measured from tr[data-index] at 1201x979, 1920x1080, and 390x844.
// If file row padding, font size, border, icon size, or wrapping changes,
// rerun the row measurement pass and update this estimate plus the matching
// h-[49px] row class below.
const FILE_TABLE_ROW_HEIGHT_PX = 49;
const FILE_TABLE_VIRTUAL_OVERSCAN = 10;
const FILE_TABLE_ROW_PRESENCE_MS = 140;
const FILE_EDITOR_CLOSE_EXIT_MS = 260;
const FILE_EDITOR_RETURN_ENTER_MS = 220;

function normalizedPathKey(p: string): string {
  return normalizeAbsPath(p.trim() || '/');
}

function fileViewTransitionName(path: string) {
  return `file-${normalizeAbsPath(path).replace(/[^a-zA-Z0-9_-]/g, (char) =>
    `_${char.charCodeAt(0).toString(16)}_`,
  )}`;
}

function filterFileItemsByName(items: FileItem[], rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => item.name.toLowerCase().includes(query));
}

function reconcileRenderedFileRows(
  previousRows: RenderedFileItem[],
  nextRows: FileItem[],
): RenderedFileItem[] {
  const previousNames = new Set(previousRows.map((item) => item.name));
  const nextByName = new Map(nextRows.map((item) => [item.name, item]));
  const hasRemovedRows = previousRows.some((item) => !nextByName.has(item.name));

  if (!hasRemovedRows) {
    return nextRows.map((item) => ({
      ...item,
      __rowPresence: previousNames.has(item.name) ? undefined : 'entering',
    }));
  }

  const stagedRows: RenderedFileItem[] = previousRows.map((item) => {
    const nextItem = nextByName.get(item.name);
    if (nextItem) return nextItem;
    return { ...item, __rowPresence: 'exiting' as const };
  });

  const stagedNames = new Set(stagedRows.map((item) => item.name));
  for (const item of nextRows) {
    if (!stagedNames.has(item.name)) {
      stagedRows.push({ ...item, __rowPresence: 'entering' });
    }
  }

  return stagedRows;
}

/** One file or folder name — not a path with slashes. */
function isValidSinglePathSegment(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (t.includes('/') || t.includes('\\')) return false;
  if (t === '.' || t === '..') return false;
  return true;
}

function useDirectoryPathOptions(
  value: string,
  enabled: boolean,
  listChildDirectories: (parent: string) => Promise<string[]>,
) {
  const listingParent = React.useMemo(
    () => pathDirectoryListingContext(value).listingParent,
    [value],
  );

  const [rawChildren, setRawChildren] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) {
      setRawChildren([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const raw = await listChildDirectories(listingParent);
        if (!cancelled) setRawChildren(raw);
      } catch {
        if (!cancelled) setRawChildren([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, listingParent, listChildDirectories]);

  const options = React.useMemo(() => {
    const { segmentPrefix } = pathDirectoryListingContext(value);
    const filtered = segmentPrefix
      ? rawChildren.filter((fullPath) => {
          const bn = fullPath.slice(fullPath.lastIndexOf('/') + 1);
          return bn.toLowerCase().startsWith(segmentPrefix.toLowerCase());
        })
      : rawChildren;
    const uniq = new Set(filtered);
    uniq.add(listingParent);
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [rawChildren, value, listingParent]);

  return { options, loading };
}

/** Path bar: suggests files and directories under the listing parent (move/rename uses directories-only hook). */
function usePathEntryAutocompleteOptions(
  value: string,
  enabled: boolean,
  fetchDirectoryEntries: (parent: string) => Promise<FileItem[]>,
) {
  const listingParent = React.useMemo(
    () => pathDirectoryListingContext(value).listingParent,
    [value],
  );

  const [rawEntries, setRawEntries] = React.useState<FileItem[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) {
      setRawEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const entries = await fetchDirectoryEntries(listingParent);
        if (!cancelled) setRawEntries(entries);
      } catch {
        if (!cancelled) setRawEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, listingParent, fetchDirectoryEntries]);

  const options = React.useMemo(() => {
    const { segmentPrefix } = pathDirectoryListingContext(value);
    const fullPaths = rawEntries.map((e) =>
      joinAbsPath(listingParent, e.name),
    );
    const filtered = segmentPrefix
      ? fullPaths.filter((fullPath) => {
          const bn = fullPath.slice(fullPath.lastIndexOf('/') + 1);
          return bn.toLowerCase().startsWith(segmentPrefix.toLowerCase());
        })
      : fullPaths;
    const uniq = new Set(filtered);
    uniq.add(listingParent);
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [rawEntries, value, listingParent]);

  return { options, loading };
}

function FileDetailFade({
  show,
  children,
  className,
}: {
  show: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block transition-opacity duration-500 ease-out',
        show ? 'opacity-100' : 'opacity-0',
        className,
      )}
    >
      {children}
    </span>
  );
}

function FileMetadataViewTransition({
  stateKey,
  children,
}: {
  stateKey: string;
  children: React.ReactNode;
}) {
  return (
    <ViewTransition
      key={stateKey}
      enter="file-metadata-enter"
      exit="file-metadata-exit"
      default="none"
    >
      <span className="inline-block">{children}</span>
    </ViewTransition>
  );
}

function formatBytes(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  if (value === 0) return '0 B';
  const exponent = Math.min(
    Math.max(Math.floor(Math.log(value) / Math.log(1024)), 0),
    units.length - 1,
  );
  const num = value / Math.pow(1024, exponent);
  return `${num.toFixed(num >= 10 ? 0 : 1)} ${units[exponent]}`;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase();
}

function basenameFromPath(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** Exact basename match (lowercased), e.g. `Dockerfile`, `Makefile`. */
const FILENAME_MONACO_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  rakefile: 'ruby',
  gemfile: 'ruby',
  jenkinsfile: 'groovy',
  vagrantfile: 'ruby',
  containerfile: 'dockerfile',
};

/** Longest suffix wins; order in the array does not matter. */
const COMPOUND_SUFFIX_LANG: { suffix: string; lang: string }[] = [
  { suffix: '.d.ts', lang: 'typescript' },
  { suffix: '.d.mts', lang: 'typescript' },
  { suffix: '.d.cts', lang: 'typescript' },
  { suffix: '.test.tsx', lang: 'typescriptreact' },
  { suffix: '.spec.tsx', lang: 'typescriptreact' },
  { suffix: '.test.ts', lang: 'typescript' },
  { suffix: '.spec.ts', lang: 'typescript' },
  { suffix: '.test.jsx', lang: 'javascriptreact' },
  { suffix: '.spec.jsx', lang: 'javascriptreact' },
  { suffix: '.test.js', lang: 'javascript' },
  { suffix: '.spec.js', lang: 'javascript' },
];

const COMPOUND_SUFFIX_SORTED = [...COMPOUND_SUFFIX_LANG].sort(
  (a, b) => b.suffix.length - a.suffix.length,
);

/** Final path segment extension → Monaco built-in language id. */
const EXTENSION_MONACO_LANG: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'markdown',
  svx: 'markdown',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  xml: 'xml',
  svg: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  sql: 'sql',
  prisma: 'sql',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rb: 'ruby',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  go: 'go',
  mod: 'go',
  work: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  cs: 'csharp',
  fs: 'fsharp',
  fsx: 'fsharp',
  swift: 'swift',
  php: 'php',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erl',
  hrl: 'erl',
  clj: 'clojure',
  cljs: 'clojure',
  edn: 'clojure',
  lua: 'lua',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  properties: 'ini',
  env: 'plaintext',
  gitignore: 'plaintext',
  dockerignore: 'plaintext',
  graphql: 'plaintext',
  gql: 'plaintext',
};

function monacoLanguageForPath(filePath: string): string {
  const base = basenameFromPath(filePath);
  const lowerBase = base.toLowerCase();

  const byName = FILENAME_MONACO_LANG[lowerBase];
  if (byName) return byName;

  for (const { suffix, lang } of COMPOUND_SUFFIX_SORTED) {
    if (lowerBase.endsWith(suffix)) return lang;
  }

  const ext = extensionOf(base);
  if (!ext) return 'plaintext';

  const fromExt = EXTENSION_MONACO_LANG[ext];
  if (fromExt) return fromExt;

  return 'plaintext';
}

function FileEntryIcon({
  name,
  isDirectory,
  isSymlink,
  pending,
}: {
  name: string;
  isDirectory: boolean;
  isSymlink?: boolean;
  /** HEAD row not merged yet — show a neutral loading glyph, not a folder heuristic. */
  pending?: boolean;
}) {
  if (pending) {
    return (
      <StaleShimmer
        active
        aria-label="Loading file metadata"
        className="size-4 shrink-0 rounded-sm"
      />
    );
  }
  if (isSymlink) {
    return (
      <Link2 className="text-muted-foreground group-hover:text-foreground size-4 shrink-0" />
    );
  }
  if (isDirectory) {
    return <FolderIcon className="text-primary size-4 shrink-0" />;
  }
  const ext = extensionOf(name);
  const img = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico']);
  const code = new Set([
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'mts',
    'cts',
    'vue',
    'svelte',
    'py',
    'rb',
    'go',
    'rs',
    'java',
    'c',
    'cpp',
    'h',
    'cs',
    'php',
    'swift',
    'kt',
  ]);
  const doc = new Set(['md', 'mdx', 'txt', 'rst']);
  const data = new Set(['json', 'yaml', 'yml', 'toml', 'xml']);

  if (img.has(ext)) {
    return <ImageIcon className="text-muted-foreground size-4 shrink-0" />;
  }
  if (code.has(ext)) {
    return <FileCode className="text-muted-foreground size-4 shrink-0" />;
  }
  if (doc.has(ext)) {
    return <FileText className="text-muted-foreground size-4 shrink-0" />;
  }
  if (data.has(ext)) {
    return <Braces className="text-muted-foreground size-4 shrink-0" />;
  }
  return <FileIcon className="text-muted-foreground size-4 shrink-0" />;
}

function TransferAlert({
  phase,
  context,
  className,
}: {
  phase: 'pending' | 'active';
  context: 'move' | 'rename' | 'page';
  className?: string;
}) {
  let description: string;
  if (phase === 'pending') {
    description =
      context === 'rename'
        ? `After you click Apply, the file is renamed on the instance. Once that has started, do not close or reload this tab—the browser may warn you; choose "Stay on page" until it completes.`
        : `After you click Move, files are copied on the instance and originals are removed only when that finishes. Once the move has started, do not close or reload this tab—the browser may warn you; choose "Stay on page" until it completes.`;
  } else {
    description =
      context === 'rename'
        ? `A rename is in progress. Closing or refreshing can interrupt the operation and leave files in an inconsistent state. The browser may also show its own warning if you try to leave—choose "Stay on page" until the rename finishes.`
        : `A file move is in progress. Closing or refreshing can interrupt the transfer and leave files in an inconsistent state. The browser may also show its own warning if you try to leave—choose "Stay on page" until the move finishes.`;
  }

  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Do not close or reload this tab</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

const BreadcrumbDirPeek = React.memo(function BreadcrumbDirPeek({
  dirPath,
  depth = 0,
  fetchDirectoryEntries,
  rowIsDirectory,
  onActivate,
}: {
  dirPath: string;
  depth?: number;
  fetchDirectoryEntries: (p: string) => Promise<FileItem[]>;
  rowIsDirectory: (item: FileItem) => boolean;
  onActivate: (item: FileItem, name: string, parentDir: string) => void;
}) {
  const [entries, setEntries] = React.useState<FileItem[] | undefined>(
    undefined,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [expandedChildPaths, setExpandedChildPaths] = React.useState<
    Set<string>
  >(new Set());

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchDirectoryEntries(dirPath)
      .then((r) => {
        if (!cancelled) setEntries(r);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load folder.');
          setEntries([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dirPath, fetchDirectoryEntries]);

  const toggleExpand = (childFullPath: string) => {
    setExpandedChildPaths((prev) => {
      const next = new Set(prev);
      if (next.has(childFullPath)) next.delete(childFullPath);
      else next.add(childFullPath);
      return next;
    });
  };

  if (entries === undefined) {
    return null;
  }
  if (error) {
    return <p className="text-muted-foreground text-xs">{error}</p>;
  }
  if (!entries.length) {
    return <p className="text-muted-foreground text-xs">Empty folder.</p>;
  }

  return (
    <ul
      className={cn(
        'max-h-56 space-y-0.5 overflow-y-auto py-0.5',
        depth > 0 && 'max-h-48',
      )}
    >
      {entries.map((item) => {
        const isDir = rowIsDirectory(item);
        const childFullPath = joinAbsPath(dirPath, item.name);
        const childListingPath =
          item.type?.toLowerCase() === 'symlink' &&
          item.symlinkTargetKind === 'directory' &&
          item.symlinkTargetPath
            ? item.symlinkTargetPath
            : childFullPath;
        const expanded = expandedChildPaths.has(childFullPath);
        return (
          <li key={`${dirPath}:${item.name}`} className="list-none">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="hover:bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                onClick={() => onActivate(item, item.name, dirPath)}
              >
                <FileEntryIcon
                  name={item.name}
                  pending={item.type === undefined}
                  isDirectory={isDir}
                  isSymlink={item.type?.toLowerCase() === 'symlink'}
                />
                <span className="truncate">{item.name}</span>
              </button>
              {isDir ? (
                <button
                  type="button"
                  title={expanded ? 'Collapse' : 'Show contents'}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground shrink-0 rounded-sm p-1.5"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleExpand(childFullPath);
                  }}
                >
                  <ChevronRight
                    className={cn(
                      'size-4 shrink-0 transition-transform',
                      expanded && 'rotate-90',
                    )}
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {expanded ? 'Collapse folder' : 'Expand folder'}
                  </span>
                </button>
              ) : null}
            </div>
            {isDir && expanded ? (
              <div className="border-muted mt-1 ml-1 border-l pl-2">
                <BreadcrumbDirPeek
                  dirPath={childListingPath}
                  depth={depth + 1}
                  fetchDirectoryEntries={fetchDirectoryEntries}
                  rowIsDirectory={rowIsDirectory}
                  onActivate={onActivate}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
});

export function FileBrowser({
  files,
  isLoading,
  isListingRevalidating = false,
  isError,
  homePath = '/',
  currentPath,
  onNavigate,
  onUpload,
  onMoveFiles,
  onRenameFile,
  onCreateEmptyFile,
  onCreateDirectory,
  onDelete,
  onDownload,
  onFetchContent,
  onFetchRaw,
  onSaveContent,
  listChildDirectories,
  probePathKind,
  fetchDirectoryEntries,
  requestMetadataForNames,
  resolveSymlinkNavTarget,
}: FileBrowserProps) {
  const { resolvedTheme } = useTheme();
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isCreateDirOpen, setIsCreateDirOpen] = React.useState(false);
  const [isCreateFileOpen, setIsCreateFileOpen] = React.useState(false);
  const [isUploadOpen, setIsUploadOpen] = React.useState(false);

  const [selectedRows, setSelectedRows] = React.useState<Row<object>[]>([]);
  const currentPathRef = React.useRef(currentPath);
  currentPathRef.current = currentPath;
  const [moveDestOpen, setMoveDestOpen] = React.useState(false);
  const [moveDestPath, setMoveDestPath] = React.useState('/');
  const [moveBusy, setMoveBusy] = React.useState(false);
  const [moveQueue, setMoveQueue] = React.useState<
    { sourcePath: string; fileName: string }[]
  >([]);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<{
    fullPath: string;
    baseName: string;
  } | null>(null);

  const [editingFile, setEditingFile] = React.useState<string | null>(null);
  const [exitingEditorBreadcrumb, setExitingEditorBreadcrumb] =
    React.useState<string | null>(null);
  const [fileContent, setFileContent] = React.useState<string>('');
  const [syncedContent, setSyncedContent] = React.useState<string>('');
  const [fileMode, setFileMode] = React.useState<string | undefined>(undefined);
  const [isEditorClosing, setIsEditorClosing] = React.useState(false);
  const [isDirectoryReturning, setIsDirectoryReturning] = React.useState(false);
  const [isFetchingContent, setIsFetchingContent] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [showSaved, setShowSaved] = React.useState(false);

  const [dragDepth, setDragDepth] = React.useState(0);
  const [dropUploading, setDropUploading] = React.useState(false);
  const [dropProgressPct, setDropProgressPct] = React.useState<number | null>(
    null,
  );
  const [dropPhaseLabel, setDropPhaseLabel] = React.useState('');

  const pendingJumpOpen = React.useRef<{ targetPath: string } | null>(null);
  const exitingEditorBreadcrumbTimerRef = React.useRef<number | null>(null);
  const editorCloseTimerRef = React.useRef<number | null>(null);
  const directoryReturnTimerRef = React.useRef<number | null>(null);

  const [pathJumpOpen, setPathJumpOpen] = React.useState(false);
  const [pathJumpValue, setPathJumpValue] = React.useState(currentPath);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [deleteConfirmPaths, setDeleteConfirmPaths] = React.useState<string[]>(
    [],
  );
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [fileNameSearch, setFileNameSearch] = React.useState('');
  const [fileNameSearchFilter, setFileNameSearchFilter] = React.useState('');
  const fileNameSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const pathZoneRef = React.useRef<HTMLDivElement | null>(null);
  const [pathZoneWidth, setPathZoneWidth] = React.useState(0);
  const previousCurrentPathRef = React.useRef(currentPath);
  const currentPathForRenderedRowsRef = React.useRef(currentPath);
  const fileNameSearchFilterRef = React.useRef(fileNameSearchFilter);
  const wasLoadingRenderedRowsRef = React.useRef(isLoading);
  const rowPresenceSettleTimerRef = React.useRef<number | null>(null);
  const settledFileRowsRef = React.useRef<FileItem[]>([]);
  const [probingLikelyDirectoryPath, setProbingLikelyDirectoryPath] =
    React.useState<string | null>(null);

  const entryFullPath = React.useCallback(
    (name: string) => joinAbsPath(currentPath, name),
    [currentPath],
  );

  /** Short-lived cache so breadcrumb hover cards don’t refetch the same folder repeatedly. */
  const peekListingCacheRef = React.useRef(
    new Map<string, { at: number; entries: FileItem[] }>(),
  );
  const PEEK_LISTING_TTL_MS = 45_000;

  React.useEffect(() => {
    peekListingCacheRef.current.clear();
  }, [currentPath]);

  const fetchPeekDirectoryEntries = React.useCallback(
    async (dirPath: string) => {
      const key = normalizedPathKey(dirPath);
      const hit = peekListingCacheRef.current.get(key);
      const now = Date.now();
      if (hit && now - hit.at < PEEK_LISTING_TTL_MS) {
        return hit.entries;
      }
      const entries = await fetchDirectoryEntries(dirPath);
      peekListingCacheRef.current.set(key, { at: now, entries });
      return entries;
    },
    [fetchDirectoryEntries],
  );

  const { options: moveDestLiveOptions, loading: moveDestListingLoading } =
    useDirectoryPathOptions(
      moveDestPath,
      moveDestOpen && !moveBusy,
      listChildDirectories,
    );

  const { options: pathJumpLiveOptions } = usePathEntryAutocompleteOptions(
    pathJumpValue,
    pathJumpOpen,
    fetchPeekDirectoryEntries,
  );

  const moveSubmitBlocked =
    moveDestListingLoading ||
    !moveDestLiveOptions.some(
      (o) => normalizedPathKey(o) === normalizedPathKey(moveDestPath),
    );

  React.useEffect(() => {
    if (previousCurrentPathRef.current === currentPath) return;
    previousCurrentPathRef.current = currentPath;
    setProbingLikelyDirectoryPath(null);
    setFileNameSearch('');
    setFileNameSearchFilter('');
    fileNameSearchFilterRef.current = '';
  }, [currentPath]);

  React.useEffect(() => {
    setSelectedRows([]);
  }, [currentPath, fileNameSearchFilter]);

  React.useEffect(() => {
    return () => {
      if (rowPresenceSettleTimerRef.current !== null) {
        window.clearTimeout(rowPresenceSettleTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (editingFile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      fileNameSearchInputRef.current?.focus();
      fileNameSearchInputRef.current?.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [editingFile]);

  React.useLayoutEffect(() => {
    const node = pathZoneRef.current;
    if (!node) return;
    const update = () => setPathZoneWidth(Math.floor(node.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const isDragOverlay =
    dragDepth > 0 || dropUploading || dropProgressPct !== null;

  const fileData: FileItem[] = React.useMemo(() => {
    return files.map((f: unknown) => {
      if (typeof f === 'string') return { name: f };
      return f as FileItem;
    });
  }, [files]);
  const [renderedFileData, setRenderedFileData] =
    React.useState<RenderedFileItem[]>(fileData);
  const filteredFileData = React.useMemo(() => {
    return filterFileItemsByName(fileData, fileNameSearchFilter);
  }, [fileData, fileNameSearchFilter]);
  React.useEffect(() => {
    const nextRows = filterFileItemsByName(
      fileData,
      fileNameSearchFilterRef.current,
    );
    const wasLoadingRows = wasLoadingRenderedRowsRef.current;
    wasLoadingRenderedRowsRef.current = isLoading;

    if (
      currentPathForRenderedRowsRef.current !== currentPath ||
      isLoading ||
      wasLoadingRows
    ) {
      currentPathForRenderedRowsRef.current = currentPath;
      settledFileRowsRef.current = nextRows;
      setRenderedFileData(nextRows);
      return;
    }

    settledFileRowsRef.current = nextRows;
    setRenderedFileData((previousRows) =>
      reconcileRenderedFileRows(previousRows, nextRows),
    );
    if (rowPresenceSettleTimerRef.current !== null) {
      window.clearTimeout(rowPresenceSettleTimerRef.current);
    }
    rowPresenceSettleTimerRef.current = window.setTimeout(() => {
      setRenderedFileData(settledFileRowsRef.current);
      rowPresenceSettleTimerRef.current = null;
    }, FILE_TABLE_ROW_PRESENCE_MS);
  }, [currentPath, fileData, isLoading]);
  const tableFileData =
    currentPathForRenderedRowsRef.current === currentPath
      ? renderedFileData
      : filteredFileData;
  const tableStatus = isLoading
    ? 'loading'
    : isError
      ? 'error'
      : probingLikelyDirectoryPath
        ? 'loading'
        : isListingRevalidating
          ? 'refreshing'
          : 'ready';
  const hasFileTableData =
    fileData.length > 0 && probingLikelyDirectoryPath === null;
  const loadableViewKey = hasFileTableData
    ? 'content'
    : tableStatus === 'ready'
      ? 'empty'
      : tableStatus === 'error'
        ? 'error'
        : 'skeleton';
  const searchResultCountPending = loadableViewKey === 'skeleton';
  const previousLoadableViewRef = React.useRef(loadableViewKey);
  const animateLoadableSurfaceForRoute =
    loadableViewKey !== 'content' || previousLoadableViewRef.current !== 'content';
  React.useEffect(() => {
    previousLoadableViewRef.current = loadableViewKey;
  }, [loadableViewKey]);
  const loadableImmediateViews = React.useMemo<
    NonNullable<React.ComponentProps<typeof LoadableSurface>['immediateViews']>
  >(() => ['skeleton'], []);
  const loadableRouteTransitionEnter = animateLoadableSurfaceForRoute
    ? {
        'file-forward': 'file-loadable-route-in',
        'file-back': 'file-loadable-route-in',
        'file-jump': 'file-loadable-route-in',
        default: 'none',
      }
    : undefined;
  const loadableRouteTransitionExit = animateLoadableSurfaceForRoute
    ? {
        'file-forward': 'file-loadable-route-out',
        'file-back': 'file-loadable-route-out',
        'file-jump': 'file-loadable-route-out',
        default: 'none',
      }
    : undefined;

  const onVirtualVisibleFileRows = React.useCallback(
    (visibleRows: Row<object>[]) => {
      requestMetadataForNames?.(
        visibleRows
          .map((r) => (r.original as FileItem).name)
          .filter((n) => n.length > 0),
      );
    },
    [requestMetadataForNames],
  );

  const isDirty = editingFile !== null && fileContent !== syncedContent;

  const confirmLeaveEditor = React.useCallback(() => {
    if (!isDirty) return true;
    return window.confirm('Discard unsaved changes?');
  }, [isDirty]);

  const showEditorForFile = React.useCallback((path: string) => {
    if (editorCloseTimerRef.current !== null) {
      window.clearTimeout(editorCloseTimerRef.current);
      editorCloseTimerRef.current = null;
    }
    if (directoryReturnTimerRef.current !== null) {
      window.clearTimeout(directoryReturnTimerRef.current);
      directoryReturnTimerRef.current = null;
    }
    if (exitingEditorBreadcrumbTimerRef.current !== null) {
      window.clearTimeout(exitingEditorBreadcrumbTimerRef.current);
      exitingEditorBreadcrumbTimerRef.current = null;
    }
    setIsEditorClosing(false);
    setIsDirectoryReturning(false);
    setExitingEditorBreadcrumb(null);
    startTransition(() => {
      addTransitionType('file-editor-open');
      setEditingFile(path);
    });
  }, []);

  const closeEditor = React.useCallback((closingPath = editingFile) => {
    const closingFile = closingPath;
    if (!closingFile) return;
    if (exitingEditorBreadcrumbTimerRef.current !== null) {
      window.clearTimeout(exitingEditorBreadcrumbTimerRef.current);
      exitingEditorBreadcrumbTimerRef.current = null;
    }
    setExitingEditorBreadcrumb(closingFile);
    setIsEditorClosing(true);
    if (editorCloseTimerRef.current !== null) {
      window.clearTimeout(editorCloseTimerRef.current);
    }
    editorCloseTimerRef.current = window.setTimeout(() => {
      setEditingFile(null);
      setFileContent('');
      setSyncedContent('');
      setFileMode(undefined);
      setIsEditorClosing(false);
      setIsDirectoryReturning(true);
      editorCloseTimerRef.current = null;
      directoryReturnTimerRef.current = window.setTimeout(() => {
        setIsDirectoryReturning(false);
        directoryReturnTimerRef.current = null;
      }, FILE_EDITOR_RETURN_ENTER_MS);
    }, FILE_EDITOR_CLOSE_EXIT_MS);
  }, [editingFile]);

  React.useEffect(() => {
    return () => {
      if (editorCloseTimerRef.current !== null) {
        window.clearTimeout(editorCloseTimerRef.current);
      }
      if (directoryReturnTimerRef.current !== null) {
        window.clearTimeout(directoryReturnTimerRef.current);
      }
      if (exitingEditorBreadcrumbTimerRef.current !== null) {
        window.clearTimeout(exitingEditorBreadcrumbTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!exitingEditorBreadcrumb || editingFile) return;
    if (exitingEditorBreadcrumbTimerRef.current !== null) {
      window.clearTimeout(exitingEditorBreadcrumbTimerRef.current);
    }
    exitingEditorBreadcrumbTimerRef.current = window.setTimeout(() => {
      setExitingEditorBreadcrumb(null);
      exitingEditorBreadcrumbTimerRef.current = null;
    }, 190);
    return () => {
      if (exitingEditorBreadcrumbTimerRef.current !== null) {
        window.clearTimeout(exitingEditorBreadcrumbTimerRef.current);
        exitingEditorBreadcrumbTimerRef.current = null;
      }
    };
  }, [editingFile, exitingEditorBreadcrumb]);

  const runFileMutationTransition = React.useCallback(<T,>(
    work: () => T | Promise<T>,
  ) => {
    return new Promise<T>((resolve, reject) => {
      startTransition(async () => {
        addTransitionType('file-mutation');
        try {
          resolve(await work());
        } catch (error) {
          reject(error);
        }
      });
    });
  }, []);

  const navigateOrDiscard = React.useCallback(
    (path: string) => {
      if (!confirmLeaveEditor()) return;
      closeEditor();
      onNavigate(path);
    },
    [closeEditor, confirmLeaveEditor, onNavigate],
  );

  const applyPathJump = React.useCallback(async () => {
    setActionError(null);
    const raw = pathJumpValue.trim();
    if (!raw) {
      setActionError('Enter a path.');
      return;
    }
    const n = normalizedPathKey(raw);
    const kind = await probePathKind(n);
    if (kind === 'directory') {
      navigateOrDiscard(n);
      setPathJumpOpen(false);
      return;
    }
    if (kind === 'file') {
      pendingJumpOpen.current = { targetPath: n };
      navigateOrDiscard(absPathParent(n));
      setPathJumpOpen(false);
      return;
    }
    setActionError('That path does not exist.');
  }, [pathJumpValue, probePathKind, navigateOrDiscard]);

  const rowIsDirectory = (item: FileItem) => {
    if (item.type === 'directory') return true;
    if (item.type === 'symlink') return false;
    if (item.type === 'file') return false;
    return !item.name.includes('.');
  };

  const rowIsTreeFolder = (item: FileItem) => {
    if (item.type?.toLowerCase() === 'symlink') {
      return item.symlinkTargetKind === 'directory';
    }
    return rowIsDirectory(item);
  };

  const handleOpenEntry = async (
    item: FileItem,
    fileName: string,
    entryParentPath?: string,
  ) => {
    const activeCurrentPath = currentPathRef.current;
    const resolvedParentPath = entryParentPath ?? activeCurrentPath;
    const fullPath = joinAbsPath(resolvedParentPath, fileName);
    setActionError(null);

    const normalizedType = item.type?.toLowerCase();

    // Some production deployments can miss/alter metadata headers; probe on-demand
    // to keep folder navigation reliable when row type is ambiguous.
    let kindFromProbe: 'directory' | 'file' | 'missing' | null = null;
    if (!normalizedType || !['directory', 'file', 'symlink'].includes(normalizedType)) {
      if (rowIsDirectory(item)) {
        setProbingLikelyDirectoryPath(fullPath);
      }
      try {
        kindFromProbe = await probePathKind(fullPath);
      } catch {
        kindFromProbe = null;
      } finally {
        setProbingLikelyDirectoryPath((pendingPath) =>
          pendingPath === fullPath ? null : pendingPath,
        );
      }
    }

    if (
      normalizedType === 'symlink' &&
      resolveSymlinkNavTarget
    ) {
      try {
        const nav = await resolveSymlinkNavTarget(fullPath);
        navigateOrDiscard(nav.directoryPath);
        if (nav.fileBasename) {
          pendingJumpOpen.current = {
            targetPath: joinAbsPath(nav.directoryPath, nav.fileBasename),
          };
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(message);
      }
      return;
    }

    if (
      kindFromProbe === 'directory' ||
      (kindFromProbe === null && rowIsDirectory(item))
    ) {
      navigateOrDiscard(fullPath);
      return;
    }

    if (kindFromProbe === 'missing') {
      setActionError('That path does not exist.');
      return;
    }

    const pf = preflightOpen(fileName);
    if (pf.kind === 'download_now') {
      onDownload(fullPath);
      return;
    }

    if (
      typeof item.size === 'number' &&
      item.size >= LARGE_FILE_CONFIRM_BYTES
    ) {
      const ok = window.confirm(
        `This file is about ${formatBytes(item.size)}. Load it in the editor?`,
      );
      if (!ok) return;
    }

    const fileParentDir = absPathParent(fullPath);
    if (
      normalizedPathKey(fileParentDir) !== normalizedPathKey(activeCurrentPath)
    ) {
      onNavigate(fileParentDir);
    }

    setIsFetchingContent(true);
    try {
      const raw = await onFetchRaw(fullPath);
      const isBin = classifyBufferIsBinary(fileName, raw.buffer);
      if (isBin) {
        downloadArrayBufferAsFile(raw.buffer, fileName);
        return;
      }
      const content = new TextDecoder('utf-8', { fatal: false }).decode(
        raw.buffer,
      );
      setFileContent(content);
      setSyncedContent(content);
      setFileMode(raw.mode);
      showEditorForFile(fullPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('IS_DIRECTORY')) {
        navigateOrDiscard(fullPath);
        return;
      }
      setActionError(message);
      closeEditor(fullPath);
    } finally {
      setIsFetchingContent(false);
    }
  };

  const handleOpenEntryRef = React.useRef(handleOpenEntry);
  React.useEffect(() => {
    handleOpenEntryRef.current = handleOpenEntry;
  });

  React.useEffect(() => {
    const pending = pendingJumpOpen.current;
    if (!pending || editingFile) return;
    const parent = absPathParent(pending.targetPath);
    if (normalizedPathKey(currentPath) !== normalizedPathKey(parent)) return;
    const baseName = pending.targetPath.slice(
      pending.targetPath.lastIndexOf('/') + 1,
    );
    pendingJumpOpen.current = null;
    void handleOpenEntryRef.current(
      { name: baseName, type: 'file' },
      baseName,
      parent,
    );
  }, [currentPath, editingFile]);

  React.useEffect(() => {
    if (pathJumpOpen) return;
    const dir = editingFile ? absPathParent(editingFile) : currentPath;
    setPathJumpValue(normalizeAbsPath(dir));
  }, [currentPath, editingFile, pathJumpOpen]);

  React.useEffect(() => {
    if (!pathJumpOpen) return;
    const id = window.requestAnimationFrame(() => {
      const el = document.getElementById('path-jump');
      if (el instanceof HTMLInputElement) {
        el.focus();
        el.select();
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [pathJumpOpen]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key.toLowerCase() !== 'k') return;
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.closest('.monaco-editor')) return;
      if (
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT') &&
        t.id !== 'path-jump'
      ) {
        return;
      }
      if (t.isContentEditable) return;
      e.preventDefault();
      setPathJumpValue(
        normalizeAbsPath(
          editingFile ? absPathParent(editingFile) : currentPath,
        ),
      );
      setPathJumpOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentPath, editingFile]);

  const requestDeletePaths = React.useCallback((paths: string[]) => {
    if (!paths.length) return;
    setDeleteConfirmPaths(paths);
    setDeleteConfirmOpen(true);
  }, []);

  const executeConfirmedDelete = React.useCallback(async () => {
    setDeleteBusy(true);
    setActionError(null);
    try {
      await runFileMutationTransition(async () => {
        for (const p of deleteConfirmPaths) {
          await onDelete(p);
        }
        setSelectedRows([]);
        setDeleteConfirmOpen(false);
        setDeleteConfirmPaths([]);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteConfirmPaths, onDelete, runFileMutationTransition]);

  const handleSave = React.useCallback(async () => {
    if (!editingFile) return;
    setIsSaving(true);
    setActionError(null);
    try {
      await onSaveContent(editingFile, fileContent, fileMode);
      setSyncedContent(fileContent);
      setShowSaved(true);
      const timer = window.setTimeout(() => setShowSaved(false), 2000);
      return () => window.clearTimeout(timer);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
    } finally {
      setIsSaving(false);
    }
  }, [editingFile, fileContent, fileMode, onSaveContent]);

  const handleCancel = () => closeEditor();

  const breadcrumbs = React.useMemo(() => {
    const path = editingFile ? editingFile : currentPath;
    const parts = path.split('/').filter(Boolean);
    return parts.map((part, index) => {
      const crumbPath = '/' + parts.slice(0, index + 1).join('/');
      return { name: part, path: crumbPath };
    });
  }, [currentPath, editingFile]);
  const exitingEditorBreadcrumbName = React.useMemo(() => {
    if (!exitingEditorBreadcrumb) return null;
    if (editingFile) return null;
    if (absPathParent(exitingEditorBreadcrumb) !== normalizeAbsPath(currentPath)) {
      return null;
    }
    return basenameFromPath(exitingEditorBreadcrumb);
  }, [currentPath, editingFile, exitingEditorBreadcrumb]);

  const collapsedBreadcrumbs = React.useMemo(() => {
    if (breadcrumbs.length <= 3) {
      return { hidden: [] as typeof breadcrumbs, visible: breadcrumbs };
    }

    /**
     * Keep breadcrumbs adaptive without measuring every item on each render.
     * The path controls live beside the list, so reserve their footprint and
     * then show as many trailing segments as the remaining width can hold.
     */
    const available = Math.max(140, pathZoneWidth || 420);
    const rootWidth = 28;
    const separatorWidth = 16;
    const ellipsisWidth = 32;
    const estimateCrumbWidth = (name: string) =>
      Math.min(120, Math.max(30, name.length * 7 + 16));

    for (let visibleCount = breadcrumbs.length; visibleCount >= 1; visibleCount--) {
      const hiddenCount = breadcrumbs.length - visibleCount;
      const visible = breadcrumbs.slice(hiddenCount);
      const visibleWidth = visible.reduce(
        (sum, crumb) => sum + separatorWidth + estimateCrumbWidth(crumb.name),
        0,
      );
      const hiddenWidth = hiddenCount > 0 ? separatorWidth + ellipsisWidth : 0;
      if (rootWidth + hiddenWidth + visibleWidth <= available) {
        return {
          hidden: breadcrumbs.slice(0, hiddenCount),
          visible,
        };
      }
    }

    return {
      hidden: breadcrumbs.slice(0, -1),
      visible: breadcrumbs.slice(-1),
    };
  }, [breadcrumbs, pathZoneWidth]);

  const showBreadcrumbPeek = React.useCallback(
    (segmentPath: string, crumbIndex: number, crumbTotal: number) => {
      const seg = normalizeAbsPath(segmentPath);
      if (editingFile) {
        return seg !== normalizeAbsPath(editingFile);
      }
      return !(
        crumbIndex === crumbTotal - 1 &&
        seg === normalizeAbsPath(currentPath)
      );
    },
    [editingFile, currentPath],
  );

  const showRootBreadcrumbPeek = React.useMemo(() => {
    if (editingFile) return true;
    return normalizeAbsPath(currentPath) !== '/';
  }, [editingFile, currentPath]);

  const openRow = (item: FileItem) => {
    void handleOpenEntry(item, item.name);
  };

  const getFileActionItems = (item: FileItem) => {
    const name = item.name;
    const isDirectory = rowIsDirectory(item);
    const isSymlink = item.type?.toLowerCase() === 'symlink';
    const fullPath = joinAbsPath(currentPath, name);

    return [
      ...(!isDirectory && !isSymlink
        ? [
            {
              key: 'edit',
              label: 'Edit',
              icon: PencilIcon,
              onSelect: () => void handleOpenEntry(item, name),
            },
          ]
        : []),
      {
        key: 'download',
        label: 'Download',
        icon: DownloadIcon,
        onSelect: () => onDownload(fullPath),
      },
      {
        key: 'open',
        label: 'Open',
        icon: FolderIcon,
        onSelect: () =>
          isDirectory
            ? navigateOrDiscard(fullPath)
            : void handleOpenEntry(item, name),
      },
      ...(!isDirectory && !isSymlink
        ? [
            {
              key: 'rename',
              label: 'Rename',
              icon: PenLine,
              onSelect: () => {
                setRenameTarget({ fullPath, baseName: name });
                setRenameOpen(true);
              },
            },
            {
              key: 'move',
              label: 'Move',
              icon: ArrowRightLeft,
              onSelect: () => openMoveDialogForFile(item),
            },
          ]
        : []),
      {
        key: 'delete',
        label: 'Delete',
        icon: TrashIcon,
        destructive: true,
        onSelect: () => requestDeletePaths([fullPath]),
      },
    ];
  };

  const renderDropdownFileActions = (item: FileItem) =>
    getFileActionItems(item).map((action) => {
      const Icon = action.icon;
      if (action.key === 'delete') {
        return (
          <React.Fragment key={action.key}>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={action.onSelect}
              variant="destructive"
            >
              <Icon className="mr-2 h-4 w-4" />
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        );
      }
      return (
        <DropdownMenuItem key={action.key} onClick={action.onSelect}>
          <Icon className="mr-2 h-4 w-4" />
          {action.label}
        </DropdownMenuItem>
      );
    });

  const renderContextFileActions = (item: FileItem) =>
    getFileActionItems(item).map((action) => {
      const Icon = action.icon;
      if (action.key === 'delete') {
        return (
          <React.Fragment key={action.key}>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={action.onSelect}
            >
              <Icon className="mr-2 h-4 w-4" />
              {action.label}
            </ContextMenuItem>
          </React.Fragment>
        );
      }
      return (
        <ContextMenuItem key={action.key} onClick={action.onSelect}>
          <Icon className="mr-2 h-4 w-4" />
          {action.label}
        </ContextMenuItem>
      );
    });

  const columns: ColumnDef<FileItem>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const item = row.original;
        const name = item.name;
        const fullPath = joinAbsPath(currentPath, name);
        const pendingMeta = item.type === undefined;
        const isSymlink = item.type?.toLowerCase() === 'symlink';
        const isDirectory = rowIsDirectory(item);

        return (
          <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
            <FileMetadataViewTransition
              stateKey={`icon:${pendingMeta ? 'pending' : item.type ?? 'unknown'}`}
            >
              <FileEntryIcon
                name={name}
                pending={pendingMeta}
                isDirectory={isDirectory}
                isSymlink={isSymlink}
              />
            </FileMetadataViewTransition>
            {/* When navigating up to a cached parent folder, this text can pair
                with the breadcrumb segment that just unmounted. Keep the shared
                target scoped to the label so the folder icon stays local. */}
            <ViewTransition
              name={fileViewTransitionName(fullPath)}
              share="file-text-shared"
              default="none"
            >
              <span
                className="block min-w-0 cursor-pointer truncate font-medium hover:underline"
                onClick={() => openRow(item)}
              >
                {name}
              </span>
            </ViewTransition>
          </div>
        );
      },
    },
    {
      id: 'size',
      header: 'Size',
      cell: ({ row }) => {
        const item = row.original;
        if (item.type === undefined) {
          return (
            <FileMetadataViewTransition stateKey="size:pending">
              <StaleShimmer
                active
                className="inline-block h-4 w-14"
                aria-label="Loading size"
              />
            </FileMetadataViewTransition>
          );
        }
        const kind = item.type.toLowerCase();
        if (kind === 'directory') {
          return (
            <FileMetadataViewTransition stateKey="size:empty">
              <span className="text-muted-foreground">
                <FileDetailFade show>—</FileDetailFade>
              </span>
            </FileMetadataViewTransition>
          );
        }
        if (typeof item.size !== 'number') {
          return (
            <FileMetadataViewTransition stateKey="size:empty">
              <span className="text-muted-foreground">
                <FileDetailFade show>—</FileDetailFade>
              </span>
            </FileMetadataViewTransition>
          );
        }
        return (
          <FileMetadataViewTransition stateKey="size:value">
            <span className="whitespace-nowrap tabular-nums">
              {formatBytes(item.size)}
            </span>
          </FileMetadataViewTransition>
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => {
        const item = row.original;
        const type = item.type?.toLowerCase();
        if (type === undefined) {
          return (
            <FileMetadataViewTransition stateKey="type:pending">
              <StaleShimmer
                active
                className="inline-block h-4 w-20"
                aria-label="Loading type"
              />
            </FileMetadataViewTransition>
          );
        }
        const label =
          type === 'directory'
            ? 'Directory'
            : type === 'symlink'
              ? 'Symlink'
              : type === 'file'
                ? 'File'
                : item.type ?? '—';
        return (
          <FileMetadataViewTransition stateKey={`type:${type}`}>
            <FileDetailFade show>
              <span className="whitespace-nowrap">{label}</span>
            </FileDetailFade>
          </FileMetadataViewTransition>
        );
      },
    },
    {
      id: 'actions',
      size: 50,
      cell: ({ row }) => {
        const item = row.original;

        return (
          <div className="flex justify-end whitespace-nowrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {renderDropdownFileActions(item)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  React.useEffect(() => {
    if (!moveBusy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [moveBusy]);

  const runBulkDownload = () => {
    const filesOnly = selectedRows.filter((row) => {
      const item = row.original as FileItem;
      return !rowIsDirectory(item);
    });
    if (!filesOnly.length) {
      setActionError('Select one or more files to download.');
      return;
    }
    setActionError(null);
    for (const row of filesOnly) {
      const item = row.original as FileItem;
      const fullPath = joinAbsPath(currentPath, item.name);
      onDownload(fullPath);
    }
  };

  const openBulkDeleteConfirm = () => {
    if (!selectedRows.length) return;
    const paths = selectedRows.map((row) => {
      const item = row.original as FileItem;
      return joinAbsPath(currentPath, item.name);
    });
    requestDeletePaths(paths);
  };

  const openMoveDialogFromToolbar = () => {
    const filesOnly = selectedRows.filter((row) => {
      const item = row.original as FileItem;
      return !rowIsDirectory(item);
    });
    if (!filesOnly.length) {
      setActionError('Select one or more files (not folders) to move.');
      return;
    }
    setActionError(null);
    setMoveQueue(
      filesOnly.map((row) => {
        const item = row.original as FileItem;
        return {
          sourcePath: entryFullPath(item.name),
          fileName: item.name,
        };
      }),
    );
    setMoveDestPath(normalizeAbsPath(currentPath));
    setMoveDestOpen(true);
  };

  const openMoveDialogForFile = (item: FileItem) => {
    setActionError(null);
    setMoveQueue([
      { sourcePath: entryFullPath(item.name), fileName: item.name },
    ]);
    setMoveDestPath(normalizeAbsPath(currentPath));
    setMoveDestOpen(true);
  };

  const runBulkMove = async () => {
    let dest = moveDestPath.trim() || '/';
    dest = normalizeAbsPath(dest);

    if (!moveQueue.length) {
      setActionError('No files to move.');
      return;
    }

    setMoveBusy(true);
    setActionError(null);
    try {
      await runFileMutationTransition(async () => {
        await onMoveFiles(moveQueue, dest, (phase, pct, detail) => {
          setDropPhaseLabel(
            `${phase === 'download' ? 'Reading' : 'Uploading'} ${detail.label} (${detail.index}/${detail.total})`,
          );
          setDropProgressPct(pct);
        });
        setMoveDestOpen(false);
        setMoveQueue([]);
        setSelectedRows([]);
        setDropProgressPct(null);
        setDropPhaseLabel('');
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
    } finally {
      setMoveBusy(false);
      setDropProgressPct(null);
      setDropPhaseLabel('');
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (!editingFile && e.dataTransfer.types.includes('Files')) {
      setDragDepth((d) => d + 1);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragDepth(0);
    if (editingFile) return;
    const list = e.dataTransfer.files;
    if (!list?.length) return;
    setActionError(null);
    setDropUploading(true);
    setDropProgressPct(null);
    try {
      await runFileMutationTransition(async () => {
        for (let i = 0; i < list.length; i++) {
          const file = list.item(i);
          if (!file) continue;
          setDropPhaseLabel(`Uploading ${file.name} (${i + 1}/${list.length})`);
          await onUpload(file, (pct) => setDropProgressPct(pct));
        }
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
    } finally {
      setDropUploading(false);
      setDropProgressPct(null);
      setDropPhaseLabel('');
    }
  };

  const editorLang = editingFile
    ? monacoLanguageForPath(editingFile)
    : 'plaintext';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 min-[960px]:flex-row min-[960px]:items-center min-[960px]:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {homePath !== '/' ? (
            <HoverCard openDelay={250} closeDelay={80}>
              <HoverCardTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  title="Working directory"
                  onClick={() => navigateOrDiscard(homePath)}
                >
                  <HomeIcon className="h-4 w-4" />
                  <span className="sr-only">Working directory</span>
                </Button>
              </HoverCardTrigger>
              <HoverCardContent align="start" className="w-72 p-2" side="bottom">
                <BreadcrumbDirPeek
                  dirPath={homePath}
                  fetchDirectoryEntries={fetchPeekDirectoryEntries}
                  rowIsDirectory={rowIsTreeFolder}
                  onActivate={(item, name, parent) =>
                    void handleOpenEntry(item, name, parent)
                  }
                />
              </HoverCardContent>
            </HoverCard>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <div ref={pathZoneRef} className="min-w-0 flex-1">
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap overflow-hidden">
                <BreadcrumbItem>
                  {showRootBreadcrumbPeek ? (
                    <HoverCard openDelay={250} closeDelay={80}>
                      <HoverCardTrigger asChild>
                        <BreadcrumbLink
                          onClick={() => navigateOrDiscard('/')}
                          className="max-w-32 cursor-pointer truncate whitespace-nowrap select-none lg:max-w-40"
                        >
                          /
                        </BreadcrumbLink>
                      </HoverCardTrigger>
                      <HoverCardContent align="start" className="w-72 p-2" side="bottom">
                        <BreadcrumbDirPeek
                          dirPath="/"
                          fetchDirectoryEntries={fetchPeekDirectoryEntries}
                          rowIsDirectory={rowIsTreeFolder}
                          onActivate={(item, name, parent) =>
                            void handleOpenEntry(item, name, parent)
                          }
                        />
                      </HoverCardContent>
                    </HoverCard>
                  ) : (
                    <BreadcrumbLink
                      onClick={() => navigateOrDiscard('/')}
                      className="max-w-32 cursor-pointer truncate whitespace-nowrap select-none lg:max-w-40"
                    >
                      /
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {collapsedBreadcrumbs.hidden.length > 0 ? (
                  <>
                    <ViewTransition
                      key="collapsed-breadcrumbs-separator"
                      enter="file-breadcrumb-enter"
                      exit="file-breadcrumb-exit"
                      default="none"
                    >
                      <BreadcrumbSeparator />
                    </ViewTransition>
                    <BreadcrumbItem>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-7"
                            title="Show hidden path segments"
                          >
                            <BreadcrumbEllipsis className="size-4" />
                            <span className="sr-only">
                              Show hidden path segments
                            </span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {collapsedBreadcrumbs.hidden.map((crumb) => (
                            <DropdownMenuItem
                              key={crumb.path}
                              className="max-w-64"
                              onSelect={() => navigateOrDiscard(crumb.path)}
                            >
                              <span className="truncate">{crumb.name}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </BreadcrumbItem>
                  </>
                ) : null}
                {collapsedBreadcrumbs.visible.map((crumb) => {
                  const index = breadcrumbs.findIndex((item) => item.path === crumb.path);
                  return (
                  <React.Fragment key={crumb.path}>
                    <ViewTransition
                      key={`${crumb.path}:separator`}
                      enter="file-breadcrumb-enter"
                      exit="file-breadcrumb-exit"
                      default="none"
                    >
                      <BreadcrumbSeparator />
                    </ViewTransition>
                    <ViewTransition
                      key={`${crumb.path}:item`}
                      enter="file-breadcrumb-enter"
                      exit="file-breadcrumb-exit"
                      default="none"
                    >
                      <BreadcrumbItem>
                        {showBreadcrumbPeek(
                          crumb.path,
                          index,
                          breadcrumbs.length,
                        ) ? (
                          <HoverCard openDelay={250} closeDelay={80}>
                            <HoverCardTrigger asChild>
                              <BreadcrumbLink
                                onClick={() => navigateOrDiscard(crumb.path)}
                                className="max-w-32 cursor-pointer truncate whitespace-nowrap select-none lg:max-w-40"
                              >
                                <span className="block truncate">
                                  {crumb.name}
                                </span>
                              </BreadcrumbLink>
                            </HoverCardTrigger>
                            <HoverCardContent
                              align="start"
                              className="w-72 p-2"
                              side="bottom"
                            >
                              <BreadcrumbDirPeek
                                dirPath={crumb.path}
                                fetchDirectoryEntries={fetchPeekDirectoryEntries}
                                rowIsDirectory={rowIsTreeFolder}
                                onActivate={(item, name, parent) =>
                                  void handleOpenEntry(item, name, parent)
                                }
                              />
                            </HoverCardContent>
                          </HoverCard>
                        ) : (
                          <BreadcrumbLink
                            onClick={() => navigateOrDiscard(crumb.path)}
                            className="max-w-32 cursor-pointer truncate whitespace-nowrap select-none lg:max-w-40"
                          >
                            <span className="block truncate">
                              {crumb.name}
                            </span>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </ViewTransition>
                  </React.Fragment>
                  );
                })}
                {exitingEditorBreadcrumbName ? (
                  <span
                    aria-hidden="true"
                    className="file-breadcrumb-manual-exit inline-flex items-center gap-1.5"
                  >
                    <BreadcrumbSeparator className="inline-flex" />
                    <BreadcrumbItem
                      aria-hidden="true"
                    >
                      <span className="block max-w-32 truncate whitespace-nowrap lg:max-w-40">
                        {exitingEditorBreadcrumbName}
                      </span>
                    </BreadcrumbItem>
                  </span>
                ) : null}
              </BreadcrumbList>
            </Breadcrumb>
            </div>
            <div className="bg-background/95 flex shrink-0 items-center gap-1 rounded-md pl-1">
            <Popover
              open={pathJumpOpen}
              onOpenChange={(open) => {
                setPathJumpOpen(open);
                if (open) {
                  setPathJumpValue(
                    normalizeAbsPath(
                      editingFile ? absPathParent(editingFile) : currentPath,
                    ),
                  );
                }
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors select-none hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                >
                  <TextCursorInput
                    className="size-4 shrink-0 transition-opacity"
                    aria-hidden="true"
                  />
                  <span className="sr-only">Go to path</span>
                </button>
              </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  Go to path
                </TooltipContent>
              </Tooltip>
            <PopoverContent className="w-[min(100vw-2rem,22rem)]" align="start">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="path-jump">Path</Label>
                  <AutocompleteInput
                    id="path-jump"
                    value={pathJumpValue}
                    onValueChange={setPathJumpValue}
                    options={pathJumpLiveOptions}
                    placeholder="/root/project"
                    autoComplete="off"
                    onSubmit={() => void applyPathJump()}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="self-end"
                  onClick={() => void applyPathJump()}
                >
                  Go
                </Button>
              </div>
            </PopoverContent>
          </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-colors select-none hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              onClick={() => {
                const path = normalizeAbsPath(editingFile ?? currentPath);
                if (
                  typeof navigator !== 'undefined' &&
                  navigator.clipboard?.writeText
                ) {
                  void navigator.clipboard.writeText(path);
                }
              }}
            >
              <ClipboardCopy className="size-4" aria-hidden />
              <span className="sr-only">Copy path</span>
            </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                Copy path
              </TooltipContent>
            </Tooltip>
            </div>
          </div>
        </div>

        {editingFile ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2 min-[960px]:w-auto">
            {showSaved ? (
              <span className="text-muted-foreground text-sm">Saved</span>
            ) : null}
            <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
              <XIcon className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? (
                <Spinner className="mr-2 h-4 w-4" />
              ) : (
                <SaveIcon className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        ) : selectedRows.length > 0 ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2 min-[960px]:w-auto">
            <span className="text-muted-foreground text-sm">
              {selectedRows.length} selected
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={openBulkDeleteConfirm}
            >
              <TrashIcon className="mr-2 h-4 w-4" />
              Delete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runBulkDownload}
            >
              <DownloadIcon className="mr-2 h-4 w-4" />
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openMoveDialogFromToolbar}
            >
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Move
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-start gap-2 min-[960px]:w-auto min-[960px]:flex-nowrap min-[960px]:justify-end">
            <InputGroup className="min-w-36 flex-[1_1_9rem] sm:min-w-48 sm:flex-[1_1_14rem] min-[960px]:w-64 min-[960px]:flex-none lg:w-72 xl:w-80">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                ref={fileNameSearchInputRef}
                type="text"
                value={fileNameSearch}
                onChange={(event) => {
                  const value = event.target.value;
                  setFileNameSearch(value);
                  startTransition(() => {
                    fileNameSearchFilterRef.current = value;
                    setFileNameSearchFilter(value);
                    const nextRows = filterFileItemsByName(fileData, value);
                    settledFileRowsRef.current = nextRows;
                    setRenderedFileData((previousRows) =>
                      reconcileRenderedFileRows(previousRows, nextRows),
                    );
                    if (rowPresenceSettleTimerRef.current !== null) {
                      window.clearTimeout(rowPresenceSettleTimerRef.current);
                    }
                    rowPresenceSettleTimerRef.current = window.setTimeout(() => {
                      setRenderedFileData(settledFileRowsRef.current);
                      rowPresenceSettleTimerRef.current = null;
                    }, FILE_TABLE_ROW_PRESENCE_MS);
                  });
                }}
                placeholder="Search files"
                aria-label="Search file names"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText
                  aria-busy={searchResultCountPending || undefined}
                  className="whitespace-nowrap text-xs tabular-nums sm:text-sm"
                >
                  {searchResultCountPending ? (
                    <>
                      <span className="sr-only">Loading result count</span>
                      <span
                        aria-hidden="true"
                        className="freshness-shimmer bg-accent inline-block h-4 w-[1ch] rounded-sm align-[-0.125em]"
                        data-slot="skeleton"
                      />
                    </>
                  ) : (
                    filteredFileData.length
                  )}{' '}
                  {!searchResultCountPending && filteredFileData.length === 1
                    ? 'result'
                    : 'results'}
                </InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <PlusIcon className="mr-2 h-4 w-4" />
                  New
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => setIsCreateFileOpen(true)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  New file
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setIsCreateDirOpen(true)}
                >
                  <FolderIcon className="mr-2 h-4 w-4" />
                  New folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <CreateFileDialog
              currentPath={currentPath}
              open={isCreateFileOpen}
              onOpenChange={setIsCreateFileOpen}
              onCreate={(name) =>
                runFileMutationTransition(() => onCreateEmptyFile(name)).catch(
                  (e: Error) => setActionError(e.message),
                )
              }
              existingFiles={fileData}
            />
            <CreateDirectoryDialog
              currentPath={currentPath}
              open={isCreateDirOpen}
              onOpenChange={setIsCreateDirOpen}
              existingFiles={fileData}
              onCreate={(name) =>
                runFileMutationTransition(() => onCreateDirectory(name)).catch(
                  (e: Error) => setActionError(e.message),
                )
              }
            />
            <Button variant="outline" onClick={() => setIsUploadOpen(true)}>
              <UploadIcon className="mr-2 h-4 w-4" />
              Upload
            </Button>
            <UploadFileDialog
              currentPath={currentPath}
              open={isUploadOpen}
              onOpenChange={setIsUploadOpen}
              onUpload={(file, onProgress) =>
                runFileMutationTransition(() =>
                  onUpload(file, onProgress),
                ).catch((e: Error) => setActionError(e.message))
              }
            />
          </div>
        )}
      </div>

      {moveBusy ? (
        <TransferAlert phase="active" context="page" />
      ) : null}

      {actionError && (
        <Alert variant="destructive">
          <AlertTitle>Action Failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (deleteBusy) return;
          setDeleteConfirmOpen(open);
          if (!open) setDeleteConfirmPaths([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteConfirmPaths.length === 1
                ? 'Delete this item?'
                : `Delete ${deleteConfirmPaths.length} items?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-muted-foreground flex flex-col gap-2 text-sm">
                <span>This cannot be undone.</span>
                {deleteConfirmPaths.length === 1 ? (
                  <span className="text-foreground font-mono text-xs break-all">
                    {deleteConfirmPaths[0]}
                  </span>
                ) : (
                  <ul className="text-foreground max-h-32 list-inside list-disc overflow-y-auto font-mono text-xs">
                    {deleteConfirmPaths.slice(0, 12).map((p) => (
                      <li key={p} className="break-all">
                        {p}
                      </li>
                    ))}
                    {deleteConfirmPaths.length > 12 ? (
                      <li className="text-muted-foreground list-none">
                        …and {deleteConfirmPaths.length - 12} more
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={deleteBusy}
              disabled={deleteBusy}
              onClick={() => void executeConfirmedDelete()}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={moveDestOpen}
        onOpenChange={(open) => {
          setMoveDestOpen(open);
          if (!open) setMoveQueue([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move files</DialogTitle>
            <DialogDescription>
              Choose the destination folder.
            </DialogDescription>
          </DialogHeader>
          <TransferAlert
            phase={moveBusy ? 'active' : 'pending'}
            context="move"
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="move-dest">Destination directory</Label>
            <AutocompleteInput
              id="move-dest"
              value={moveDestPath}
              onValueChange={setMoveDestPath}
              options={moveDestLiveOptions}
              placeholder="/var/tmp"
              disabled={moveBusy}
            />
          </div>
          {moveBusy ? (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-xs">{dropPhaseLabel}</p>
              {dropProgressPct !== null ? (
                <>
                  <Progress value={dropProgressPct} />
                  <span className="text-muted-foreground text-xs">
                    {dropProgressPct}%
                  </span>
                </>
              ) : (
                <Spinner className="size-6" />
              )}
            </div>
          ) : null}
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setMoveDestOpen(false)}
              disabled={moveBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void runBulkMove()}
              disabled={moveBusy || moveSubmitBlocked}
            >
              {moveBusy ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RenameEntryDialog
        open={renameOpen && renameTarget !== null}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) setRenameTarget(null);
        }}
        currentPath={currentPath}
        target={renameTarget}
        existingFiles={fileData}
        onRename={(path, nextName) =>
          runFileMutationTransition(() => onRenameFile(path, nextName))
        }
      />

      <div
        className="bg-background relative"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDropFiles}
      >
        {!editingFile && isDragOverlay ? (
          <div className="border-primary bg-background/90 pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-4">
            <p className="text-muted-foreground text-center text-sm font-medium">
              {dropUploading || dropProgressPct !== null
                ? dropPhaseLabel || 'Uploading…'
                : 'Drop files to upload'}
            </p>
            {dropProgressPct !== null ? (
              <div className="pointer-events-none w-full max-w-xs">
                <Progress value={dropProgressPct} />
                <span className="text-muted-foreground mt-1 block text-center text-xs">
                  {dropProgressPct}%
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {editingFile ? (
          <ViewTransition
            key="editor"
            enter={{
              'file-editor-open': 'file-editor-open-enter',
              default: 'none',
            }}
            exit={{
              'file-editor-open': 'file-editor-open-exit',
              default: 'none',
            }}
            default="none"
          >
            <div
              className={cn(
                'h-[600px] w-full overflow-hidden rounded-md border bg-card',
                isEditorClosing && 'file-editor-closing-layer',
              )}
            >
              {isFetchingContent ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner className="size-8" />
                </div>
              ) : (
                <Editor
                  key={editingFile}
                  height="100%"
                  language={editorLang}
                  value={fileContent}
                  onChange={(value) => setFileContent(value || '')}
                  beforeMount={defineDashboardMonacoThemes}
                  theme={dashboardMonacoTheme(resolvedTheme)}
                  onMount={(editor, monaco) => {
                    editor.addCommand(
                      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                      () => void handleSave(),
                    );
                  }}
                  options={{
                    ...dashboardMonacoOptions,
                    minimap: {
                      enabled: true,
                      autohide: 'none',
                      showSlider: 'always',
                    },
                    fontSize: 14,
                    lineHeight: 22,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    padding: { top: 12, bottom: 12 },
                  }}
                />
              )}
            </div>
          </ViewTransition>
        ) : null}
        {!editingFile ? (
          <ViewTransition
            key="table"
            enter={{
              'file-editor-open': 'file-editor-open-enter',
              default: 'none',
            }}
            exit={{
              'file-editor-open': 'file-editor-open-exit',
              default: 'none',
            }}
            default="none"
          >
            <div className={cn(isDirectoryReturning && 'file-directory-return-enter')}>
              <LoadableSurface
                status={tableStatus}
                hasData={hasFileTableData}
                transitionMs={90}
                immediateViews={loadableImmediateViews}
                transitionEnter={loadableRouteTransitionEnter}
                transitionExit={loadableRouteTransitionExit}
                skeleton={
                  <DataTable
                    data={[]}
                    cols={columns as ColumnDef<object, unknown>[]}
                    enableSelection
                    disablePagination
                    loading
                    skeletonRows={12}
                    virtualRowEstimatePx={FILE_TABLE_ROW_HEIGHT_PX}
                    renderSkeletonCell={renderFileTableSkeletonCell}
                  />
                }
                error={
                  <Alert variant="destructive" className="m-4">
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>Failed to load files.</AlertDescription>
                  </Alert>
                }
                empty={
                  <Empty className="min-h-[320px]">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FolderIcon />
                      </EmptyMedia>
                      <EmptyTitle>Folder is empty</EmptyTitle>
                      <EmptyDescription>
                        Upload files or create a new file to add content here.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent className="flex-row justify-center gap-2">
                      <Button onClick={() => setIsCreateFileOpen(true)}>
                        <FileText className="mr-2 h-4 w-4" />
                        New file
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setIsCreateDirOpen(true)}
                      >
                        <FolderIcon className="mr-2 h-4 w-4" />
                        New folder
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setIsUploadOpen(true)}
                      >
                        <UploadIcon className="mr-2 h-4 w-4" />
                        Upload
                      </Button>
                    </EmptyContent>
                  </Empty>
                }
              >
                <FreshnessSurface active={isListingRevalidating}>
                  <DataTable
                    data={tableFileData}
                    cols={columns as ColumnDef<object, unknown>[]}
                    enableSelection
                    disablePagination
                    onSelectionChange={(rows) => setSelectedRows(rows)}
                    getRowClassName={(row) => {
                      const presence = (row.original as RenderedFileItem)
                        .__rowPresence;
                      return cn(
                        'h-[49px]',
                        presence === 'entering' && 'file-row-presence-enter',
                        presence === 'exiting' && 'file-row-presence-exit',
                      );
                    }}
                    virtualizeRows
                    virtualRowEstimatePx={FILE_TABLE_ROW_HEIGHT_PX}
                    virtualOverscan={FILE_TABLE_VIRTUAL_OVERSCAN}
                    getVirtualRowKey={(row) => (row.original as FileItem).name}
                    onVirtualVisibleRowsChange={
                      requestMetadataForNames
                        ? onVirtualVisibleFileRows
                        : undefined
                    }
                    emptyState={
                      fileNameSearchFilter.trim()
                        ? (
                            <Empty className="min-h-56 border-0 p-6">
                              <EmptyHeader>
                                <EmptyMedia variant="icon">
                                  <SearchIcon />
                                </EmptyMedia>
                                <EmptyTitle>No matching files</EmptyTitle>
                                <EmptyDescription>
                                  No files in this folder match{' '}
                                  <span className="font-medium text-foreground">
                                    {fileNameSearchFilter.trim()}
                                  </span>
                                  .
                                </EmptyDescription>
                              </EmptyHeader>
                            </Empty>
                          )
                        : undefined
                    }
                    wrapTableRow={(row, rowEl) => {
                      const item = row.original as FileItem;
                      const rowPath = joinAbsPath(currentPath, item.name);

                      return (
                        <ViewTransition
                          key={rowPath}
                          enter={{
                            'file-forward': 'file-route-fade-in',
                            'file-back': 'file-route-fade-in',
                            'file-jump': 'file-route-fade-in',
                            default: 'none',
                          }}
                          exit={{
                            'file-forward': 'file-route-fade-out',
                            'file-back': 'file-route-fade-out',
                            'file-jump': 'file-route-fade-out',
                            default: 'none',
                          }}
                          default="none"
                        >
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              {rowEl}
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              {renderContextFileActions(item)}
                            </ContextMenuContent>
                          </ContextMenu>
                        </ViewTransition>
                      );
                    }}
                  />
                </FreshnessSurface>
              </LoadableSurface>
            </div>
          </ViewTransition>
        ) : null}
      </div>
    </div>
  );
}

function renderFileTableSkeletonCell(columnId: string) {
  if (columnId === 'select') return <Skeleton className="size-4 rounded-sm" />;
  if (columnId === 'name') {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Skeleton className="size-4 rounded-sm" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>
    );
  }
  if (columnId === 'size') return <Skeleton className="h-4 w-20" />;
  if (columnId === 'type') return <Skeleton className="h-4 w-24" />;
  if (columnId === 'actions') {
    return <Skeleton className="ml-auto size-8 rounded-md" />;
  }
  return <Skeleton className="h-4 w-28" />;
}

function RenameEntryDialog({
  open,
  onOpenChange,
  currentPath,
  target,
  existingFiles,
  onRename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPath: string;
  target: { fullPath: string; baseName: string } | null;
  existingFiles: FileItem[];
  onRename: (fullPath: string, newBaseName: string) => Promise<void>;
}) {
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (target) setName(target.baseName);
  }, [target]);

  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a file name.');
      return;
    }
    const collision = existingFiles.some(
      (f) => f.name === trimmed && trimmed !== target.baseName,
    );
    if (collision) {
      setError('Another file or folder already uses that name.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onRename(target.fullPath, trimmed);
      onOpenChange(false);
      setName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
          <DialogDescription>
            New name in <span className="font-mono">{currentPath}</span>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <TransferAlert
            phase={loading ? 'active' : 'pending'}
            context="rename"
          />
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-file-name">New name</Label>
            <Input
              id="rename-file-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? <Spinner className="mr-2 h-4 w-4" /> : null}
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateFileDialog({
  currentPath,
  open,
  onOpenChange,
  onCreate,
  existingFiles,
}: {
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
  existingFiles: FileItem[];
}) {
  const [name, setName] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const trimmed = name.trim();
  const segmentOk = isValidSinglePathSegment(name);
  const folderNameCollision =
    segmentOk &&
    existingFiles.some((f) => {
      if (f.name !== trimmed) return false;
      if (f.type === 'directory') return true;
      if (f.type === 'file' || f.type === 'symlink') return false;
      return !f.name.includes('.');
    });
  const createDisabled =
    isLoading || !segmentOk || folderNameCollision;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const conflictsDir = existingFiles.some((f) => {
      if (f.name !== trimmed) return false;
      if (f.type === 'directory') return true;
      if (f.type === 'file' || f.type === 'symlink') return false;
      return !f.name.includes('.');
    });
    if (conflictsDir) {
      setLocalError(
        'A folder with that name already exists in this directory.',
      );
      return;
    }
    setLocalError(null);
    setIsLoading(true);
    try {
      await onCreate(trimmed);
      onOpenChange(false);
      setName('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create File</DialogTitle>
          <DialogDescription>Create a new empty file in {currentPath}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {localError ? (
            <Alert variant="destructive">
              <AlertDescription>{localError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-file-name">File name</Label>
            <Input
              id="new-file-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="notes.txt"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createDisabled}>
              {isLoading && <Spinner className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateDirectoryDialog({
  currentPath,
  open,
  onOpenChange,
  onCreate,
  existingFiles,
}: {
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
  existingFiles: FileItem[];
}) {
  const [name, setName] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);

  const trimmed = name.trim();
  const segmentOk = isValidSinglePathSegment(name);
  const nameTaken =
    segmentOk && existingFiles.some((f) => f.name === trimmed);
  const createDisabled = isLoading || !segmentOk || nameTaken;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await onCreate(trimmed);
      onOpenChange(false);
      setName('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Directory</DialogTitle>
          <DialogDescription>Create a new directory in {currentPath}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Directory Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="new-folder"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createDisabled}>
              {isLoading && <Spinner className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UploadFileDialog({
  currentPath,
  open,
  onOpenChange,
  onUpload,
}: {
  currentPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (
    file: File,
    onProgress?: (percent: number | null) => void,
  ) => Promise<void>;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setIsLoading(true);
    setProgress(null);
    try {
      await onUpload(file, (p) => setProgress(p));
      onOpenChange(false);
      setFile(null);
      setProgress(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload File</DialogTitle>
          <DialogDescription>Upload a file to {currentPath}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="file">File</Label>
            <Input
              id="file"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
            />
          </div>
          {progress !== null ? (
            <div className="flex flex-col gap-2">
              <Progress value={progress} />
              <span className="text-muted-foreground text-xs">{progress}%</span>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={isLoading || !file}>
              {isLoading && <Spinner className="mr-2 h-4 w-4" />}
              Upload
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
