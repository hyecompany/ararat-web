/** Normalize an absolute Unix-style path (leading `/`, collapsed slashes, no trailing slash except root). */
export function normalizeAbsPath(path: string): string {
  let p = path.trim();
  if (!p) return '/';
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+/g, '/');
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** Join a directory path and a single segment into an absolute path. */
export function joinAbsPath(dirPath: string, fileName: string): string {
  const dir = normalizeAbsPath(dirPath);
  const name = fileName.replace(/^\/+/g, '').replace(/\/+$/g, '');
  if (!name) throw new Error('Invalid file name');
  if (dir === '/') return `/${name}`;
  return `${dir}/${name}`;
}

/** Parent directory of an absolute file or directory path. */
export function absPathParent(filePath: string): string {
  const p = normalizeAbsPath(filePath);
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx) || '/';
}

/** Final segment of an absolute Unix path (may be empty for `/`). */
export function basenameAbsPath(filePath: string): string {
  const p = normalizeAbsPath(filePath);
  const i = p.lastIndexOf('/');
  if (i < 0) return p;
  return p.slice(i + 1) || p;
}

/**
 * Resolve a symlink target string (relative or absolute) against the symlink’s path.
 * `linkFullPath` must be the absolute path to the symlink.
 */
export function resolveSymlinkTarget(
  linkFullPath: string,
  rawTarget: string,
): string {
  const t = rawTarget.trim();
  if (!t) return normalizeAbsPath(linkFullPath);
  if (t.startsWith('/')) return normalizeAbsPath(t);
  const dir = absPathParent(normalizeAbsPath(linkFullPath));
  const parts: string[] = [...dir.split('/').filter(Boolean)];
  for (const segment of t.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return normalizeAbsPath(`/${parts.join('/')}`);
}

/**
 * Maps typed path input to which directory should be listed and the filter for
 * the trailing segment (for `/root/foo`, list `/root` filtered by `foo`).
 */
export function pathDirectoryListingContext(typed: string): {
  listingParent: string;
  segmentPrefix: string;
} {
  const t = typed.trim();
  if (!t) {
    return { listingParent: '/', segmentPrefix: '' };
  }
  if (t.endsWith('/')) {
    return { listingParent: normalizeAbsPath(t), segmentPrefix: '' };
  }
  const n = normalizeAbsPath(t);
  const lastSlash = n.lastIndexOf('/');
  if (lastSlash <= 0) {
    const leaf = n.replace(/^\//, '');
    return { listingParent: '/', segmentPrefix: leaf };
  }
  const listingParent = n.slice(0, lastSlash) || '/';
  const segmentPrefix = n.slice(lastSlash + 1);
  return {
    listingParent: normalizeAbsPath(listingParent),
    segmentPrefix,
  };
}

/**
 * Prefix paths for autocomplete: filesystem root `/` and every ancestor segment
 * of `currentPath` and `homePath` (no OS-specific preset roots).
 */
export function collectPathAutocompleteOptions(
  currentPath: string,
  homePath: string,
): string[] {
  const set = new Set<string>();
  const walk = (abs: string) => {
    const n = normalizeAbsPath(abs);
    set.add('/');
    const parts = n.split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      set.add(acc);
    }
  };
  walk(currentPath);
  walk(homePath);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
