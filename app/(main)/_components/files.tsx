'use client';

import React from 'react';
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
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import Editor from '@monaco-editor/react';
import DataTable from 'ui-web/components/data-table';
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
import { cn } from 'ui-web/lib/utils';

interface FileBrowserProps {
  files: (string | FileItem)[];
  isLoading: boolean;
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
}

export interface FileItem {
  name: string;
  type?: string;
  size?: number;
  mode?: string;
  uid?: string;
  gid?: string;
}

function normalizedPathKey(p: string): string {
  return normalizeAbsPath(p.trim() || '/');
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
}: {
  name: string;
  isDirectory: boolean;
}) {
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

function BreadcrumbDirPeek({
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
        const expanded = expandedChildPaths.has(childFullPath);
        return (
          <li key={`${dirPath}:${item.name}`} className="list-none">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="hover:bg-muted flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                onClick={() => onActivate(item, item.name, dirPath)}
              >
                <FileEntryIcon name={item.name} isDirectory={isDir} />
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
                  dirPath={childFullPath}
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
}

export function FileBrowser({
  files,
  isLoading,
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
}: FileBrowserProps) {
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isCreateDirOpen, setIsCreateDirOpen] = React.useState(false);
  const [isCreateFileOpen, setIsCreateFileOpen] = React.useState(false);
  const [isUploadOpen, setIsUploadOpen] = React.useState(false);

  const [binaryOffer, setBinaryOffer] = React.useState<{
    buffer: ArrayBuffer;
    basename: string;
  } | null>(null);

  const [selectedRows, setSelectedRows] = React.useState<Row<object>[]>([]);
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
  const [fileContent, setFileContent] = React.useState<string>('');
  const [syncedContent, setSyncedContent] = React.useState<string>('');
  const [fileMode, setFileMode] = React.useState<string | undefined>(undefined);
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

  const [pathJumpOpen, setPathJumpOpen] = React.useState(false);
  const [pathJumpValue, setPathJumpValue] = React.useState(currentPath);
  const [pathJumpZoneHover, setPathJumpZoneHover] = React.useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [deleteConfirmPaths, setDeleteConfirmPaths] = React.useState<string[]>(
    [],
  );
  const [deleteBusy, setDeleteBusy] = React.useState(false);

  const entryFullPath = React.useCallback(
    (name: string) => joinAbsPath(currentPath, name),
    [currentPath],
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
    fetchDirectoryEntries,
  );

  const moveSubmitBlocked =
    moveDestListingLoading ||
    !moveDestLiveOptions.some(
      (o) => normalizedPathKey(o) === normalizedPathKey(moveDestPath),
    );

  React.useEffect(() => {
    setSelectedRows([]);
  }, [currentPath]);

  const isDragOverlay =
    dragDepth > 0 || dropUploading || dropProgressPct !== null;

  const fileData: FileItem[] = React.useMemo(() => {
    return files.map((f: unknown) => {
      if (typeof f === 'string') return { name: f };
      return f as FileItem;
    });
  }, [files]);

  const isDirty = editingFile !== null && fileContent !== syncedContent;

  const confirmLeaveEditor = React.useCallback(() => {
    if (!isDirty) return true;
    return window.confirm('Discard unsaved changes?');
  }, [isDirty]);

  const navigateOrDiscard = React.useCallback(
    (path: string) => {
      if (!confirmLeaveEditor()) return;
      setEditingFile(null);
      setFileContent('');
      setSyncedContent('');
      setFileMode(undefined);
      onNavigate(path);
    },
    [confirmLeaveEditor, onNavigate],
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
    if (item.type === 'file' || item.type === 'symlink') return false;
    return !item.name.includes('.');
  };

  const handleOpenEntry = async (
    item: FileItem,
    fileName: string,
    entryParentPath: string = currentPath,
  ) => {
    const fullPath = joinAbsPath(entryParentPath, fileName);
    setActionError(null);

    if (rowIsDirectory(item)) {
      navigateOrDiscard(fullPath);
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

    setEditingFile(fullPath);
    setIsFetchingContent(true);
    try {
      const raw = await onFetchRaw(fullPath);
      const isBin = classifyBufferIsBinary(fileName, raw.buffer);
      if (isBin) {
        setEditingFile(null);
        setBinaryOffer({ buffer: raw.buffer, basename: fileName });
        return;
      }
      const content = new TextDecoder('utf-8', { fatal: false }).decode(
        raw.buffer,
      );
      setFileContent(content);
      setSyncedContent(content);
      setFileMode(raw.mode);
      setEditingFile(fullPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('IS_DIRECTORY')) {
        navigateOrDiscard(fullPath);
        return;
      }
      setActionError(message);
      setEditingFile(null);
      setSyncedContent('');
      setFileMode(undefined);
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
    if (!pathJumpOpen) setPathJumpValue(currentPath);
  }, [currentPath, pathJumpOpen]);

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
      setPathJumpValue(currentPath);
      setPathJumpOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [currentPath]);

  const requestDeletePaths = React.useCallback((paths: string[]) => {
    if (!paths.length) return;
    setDeleteConfirmPaths(paths);
    setDeleteConfirmOpen(true);
  }, []);

  const executeConfirmedDelete = React.useCallback(async () => {
    setDeleteBusy(true);
    setActionError(null);
    try {
      for (const p of deleteConfirmPaths) {
        await onDelete(p);
      }
      setSelectedRows([]);
      setDeleteConfirmOpen(false);
      setDeleteConfirmPaths([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteConfirmPaths, onDelete]);

  const handleSave = React.useCallback(async () => {
    if (!editingFile) return;
    setIsSaving(true);
    setActionError(null);
    try {
      await onSaveContent(editingFile, fileContent, fileMode);
      setSyncedContent(fileContent);
      setShowSaved(true);
      window.setTimeout(() => setShowSaved(false), 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
    } finally {
      setIsSaving(false);
    }
  }, [editingFile, fileContent, fileMode, onSaveContent]);

  const handleCancel = () => {
    setEditingFile(null);
    setFileContent('');
    setSyncedContent('');
    setFileMode(undefined);
  };

  const breadcrumbs = React.useMemo(() => {
    const path = editingFile ? editingFile : currentPath;
    const parts = path.split('/').filter(Boolean);
    return parts.map((part, index) => {
      const crumbPath = '/' + parts.slice(0, index + 1).join('/');
      return { name: part, path: crumbPath };
    });
  }, [currentPath, editingFile]);

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

  const columns: ColumnDef<FileItem>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const item = row.original;
        const name = item.name;
        const isDirectory = rowIsDirectory(item);

        return (
          <div className="flex items-center gap-2">
            <FileEntryIcon name={name} isDirectory={isDirectory} />
            <span
              className="cursor-pointer font-medium hover:underline"
              onClick={() => openRow(item)}
            >
              {name}
            </span>
          </div>
        );
      },
    },
    {
      id: 'size',
      header: 'Size',
      cell: ({ row }) => {
        if (row.original.type === 'directory') return '—';
        return formatBytes(row.original.size);
      },
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => {
        const name = row.original.name;
        const type = row.original.type?.toLowerCase();
        if (type === 'directory') return 'Directory';
        if (type === 'symlink') return 'Symlink';
        if (type === 'file') return 'File';
        return !name.includes('.') ? 'Directory' : 'File';
      },
    },
    {
      id: 'actions',
      size: 50,
      cell: ({ row }) => {
        const item = row.original;
        const name = item.name;
        const isDirectory = rowIsDirectory(item);
        const fullPath = joinAbsPath(currentPath, name);

        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {!isDirectory && (
                  <DropdownMenuItem
                    onClick={() => void handleOpenEntry(item, name)}
                  >
                    <PencilIcon className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => onDownload(fullPath)}>
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Download
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    isDirectory
                      ? onNavigate(fullPath)
                      : void handleOpenEntry(item, name)
                  }
                >
                  <FolderIcon className="mr-2 h-4 w-4" />
                  Open
                </DropdownMenuItem>
                {!isDirectory ? (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        setRenameTarget({ fullPath, baseName: name });
                        setRenameOpen(true);
                      }}
                    >
                      <PenLine className="mr-2 h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openMoveDialogForFile(item)}
                    >
                      <ArrowRightLeft className="mr-2 h-4 w-4" />
                      Move
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => requestDeletePaths([fullPath])}
                  className="text-red-600"
                >
                  <TrashIcon className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
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
      for (let i = 0; i < list.length; i++) {
        const file = list.item(i);
        if (!file) continue;
        setDropPhaseLabel(`Uploading ${file.name} (${i + 1}/${list.length})`);
        await onUpload(file, (pct) => setDropProgressPct(pct));
      }
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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
                  fetchDirectoryEntries={fetchDirectoryEntries}
                  rowIsDirectory={rowIsDirectory}
                  onActivate={(item, name, parent) =>
                    void handleOpenEntry(item, name, parent)
                  }
                />
              </HoverCardContent>
            </HoverCard>
          ) : null}
          <div
            className="flex min-w-0 items-center gap-1"
            onMouseEnter={() => setPathJumpZoneHover(true)}
            onMouseLeave={() => setPathJumpZoneHover(false)}
          >
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  {showRootBreadcrumbPeek ? (
                    <HoverCard openDelay={250} closeDelay={80}>
                      <HoverCardTrigger asChild>
                        <BreadcrumbLink
                          onClick={() => navigateOrDiscard('/')}
                          className="cursor-pointer"
                        >
                          /
                        </BreadcrumbLink>
                      </HoverCardTrigger>
                      <HoverCardContent align="start" className="w-72 p-2" side="bottom">
                        <BreadcrumbDirPeek
                          dirPath="/"
                          fetchDirectoryEntries={fetchDirectoryEntries}
                          rowIsDirectory={rowIsDirectory}
                          onActivate={(item, name, parent) =>
                            void handleOpenEntry(item, name, parent)
                          }
                        />
                      </HoverCardContent>
                    </HoverCard>
                  ) : (
                    <BreadcrumbLink
                      onClick={() => navigateOrDiscard('/')}
                      className="cursor-pointer"
                    >
                      /
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={crumb.path}>
                    <BreadcrumbSeparator />
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
                              className="cursor-pointer"
                            >
                              {crumb.name}
                            </BreadcrumbLink>
                          </HoverCardTrigger>
                          <HoverCardContent
                            align="start"
                            className="w-72 p-2"
                            side="bottom"
                          >
                            <BreadcrumbDirPeek
                              dirPath={crumb.path}
                              fetchDirectoryEntries={fetchDirectoryEntries}
                              rowIsDirectory={rowIsDirectory}
                              onActivate={(item, name, parent) =>
                                void handleOpenEntry(item, name, parent)
                              }
                            />
                          </HoverCardContent>
                        </HoverCard>
                      ) : (
                        <BreadcrumbLink
                          onClick={() => navigateOrDiscard(crumb.path)}
                          className="cursor-pointer"
                        >
                          {crumb.name}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </React.Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
            <Popover
              open={pathJumpOpen}
              onOpenChange={(open) => {
                setPathJumpOpen(open);
                if (open) setPathJumpValue(currentPath);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title="Go to path (Ctrl+K)"
                  className={cn(
                    'text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-9 shrink-0 items-center justify-center rounded-md transition-[color,opacity] select-none hover:bg-muted/60 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                    !(pathJumpOpen || pathJumpZoneHover) && 'opacity-0',
                  )}
                >
                  <TextCursorInput
                    className="size-4 shrink-0 transition-opacity"
                    aria-hidden="true"
                  />
                  <span className="sr-only">Go to path</span>
                </button>
              </PopoverTrigger>
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
          </div>
        </div>

        {editingFile ? (
          <div className="flex items-center gap-2">
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
          <div className="flex flex-wrap items-center gap-2">
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
          <div className="flex flex-wrap items-center gap-2">
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
                  New file
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setIsCreateDirOpen(true)}
                >
                  New folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <CreateFileDialog
              currentPath={currentPath}
              open={isCreateFileOpen}
              onOpenChange={setIsCreateFileOpen}
              onCreate={(name) =>
                onCreateEmptyFile(name).catch((e: Error) =>
                  setActionError(e.message),
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
                onCreateDirectory(name).catch((e: Error) =>
                  setActionError(e.message),
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
                onUpload(file, onProgress).catch((e: Error) =>
                  setActionError(e.message),
                )
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
            <AlertDialogDescription className="space-y-2">
              <p>This cannot be undone.</p>
              {deleteConfirmPaths.length === 1 ? (
                <p className="text-foreground font-mono text-xs break-all">
                  {deleteConfirmPaths[0]}
                </p>
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
        open={!!binaryOffer}
        onOpenChange={(open) => {
          if (!open) setBinaryOffer(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Binary file</DialogTitle>
            <DialogDescription>
              This file looks binary. Save the copy that was downloaded to your
              machine (no extra server request).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setBinaryOffer(null)}>
              Close
            </Button>
            <Button
              onClick={() => {
                if (!binaryOffer) return;
                downloadArrayBufferAsFile(
                  binaryOffer.buffer,
                  binaryOffer.basename,
                );
                setBinaryOffer(null);
              }}
            >
              <DownloadIcon className="mr-2 h-4 w-4" />
              Save to disk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        onRename={onRenameFile}
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
          <div className="h-[600px] w-full">
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
                theme="vs-dark"
                onMount={(editor, monaco) => {
                  editor.addCommand(
                    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                    () => void handleSave(),
                  );
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                }}
              />
            )}
          </div>
        ) : (
          <>
            {isLoading ? (
              <div className="flex justify-center p-8">
                <Spinner />
              </div>
            ) : isError ? (
              <Alert variant="destructive" className="m-4">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>Failed to load files.</AlertDescription>
              </Alert>
            ) : (
              <DataTable
                key={currentPath}
                data={fileData}
                cols={columns as ColumnDef<object, unknown>[]}
                enableSelection
                onSelectionChange={(rows) => setSelectedRows(rows)}
                wrapTableRow={(row, rowEl) => {
                  const item = row.original as FileItem;
                  const name = item.name;
                  const isDirectory = rowIsDirectory(item);
                  const fullPath = joinAbsPath(currentPath, name);

                  return (
                    <ContextMenu>
                      <ContextMenuTrigger asChild>{rowEl}</ContextMenuTrigger>
                      <ContextMenuContent>
                        {!isDirectory && (
                          <ContextMenuItem
                            onClick={() => void handleOpenEntry(item, name)}
                          >
                            <PencilIcon className="mr-2 h-4 w-4" />
                            Edit
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem onClick={() => onDownload(fullPath)}>
                          <DownloadIcon className="mr-2 h-4 w-4" />
                          Download
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() =>
                            isDirectory
                              ? onNavigate(fullPath)
                              : void handleOpenEntry(item, name)
                          }
                        >
                          <FolderIcon className="mr-2 h-4 w-4" />
                          Open
                        </ContextMenuItem>
                        {!isDirectory ? (
                          <>
                            <ContextMenuItem
                              onClick={() => {
                                setRenameTarget({ fullPath, baseName: name });
                                setRenameOpen(true);
                              }}
                            >
                              <PenLine className="mr-2 h-4 w-4" />
                              Rename
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() => openMoveDialogForFile(item)}
                            >
                              <ArrowRightLeft className="mr-2 h-4 w-4" />
                              Move
                            </ContextMenuItem>
                          </>
                        ) : null}
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => requestDeletePaths([fullPath])}
                        >
                          <TrashIcon className="mr-2 h-4 w-4" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                }}
                disablePagination
              />
            )}
          </>
        )}
      </div>
    </div>
  );
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
