import { textFetcher } from '@/app/_lib/fetcher';

type InventoryEntry = {
  name: string;
  role: string;
  uri: string;
  title: string;
};

export type DocumentationReferenceBase = {
  key: string;
  title: string;
  href: string;
  sourceHref: string;
};

export type DocumentationReferencePreview = DocumentationReferenceBase & {
  preview: string;
  summarySource: string;
};

type BrowserSummarizer = {
  summarize: (input: string, options?: { context?: string }) => Promise<string>;
};

type BrowserSummarizerConstructor = {
  availability: () => Promise<string>;
  create: (options?: Record<string, unknown>) => Promise<BrowserSummarizer>;
};

const INVENTORY_MARKER = '# The remainder of this file is compressed using zlib.\n';

let inventoryPromise: Promise<Map<string, InventoryEntry>> | null = null;
const referenceBasePromiseCache = new Map<string, Promise<DocumentationReferenceBase | null>>();
const referencePreviewPromiseCache = new Map<
  string,
  Promise<DocumentationReferencePreview | null>
>();
const referenceSummaryPromiseCache = new Map<string, Promise<string | null>>();

function formatDocReferenceLabel(value: string) {
  return value
    .split(':')
    .pop()!
    .split('-')
    .filter(Boolean)
    .map((part) =>
      ['cpu', 'bpf', 'qemu', 'incus'].includes(part.toLowerCase())
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ');
}

function trimDocumentationPath(path: string) {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

async function inflateInventory(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder().decode(bytes.subarray(0, 256));
  const markerIndex = header.indexOf(INVENTORY_MARKER);

  if (markerIndex === -1 || typeof DecompressionStream === 'undefined') {
    throw new Error('Unable to read the local documentation inventory.');
  }

  const compressed = bytes.subarray(markerIndex + INVENTORY_MARKER.length);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).text();
}

function buildReferenceHref(entry: InventoryEntry) {
  return `/documentation/${entry.uri.replace('$', entry.name)}`;
}

function buildReferenceSourceHref(entry: InventoryEntry) {
  const sourcePath = trimDocumentationPath(entry.uri.split('#')[0]);
  return `/documentation/_sources/${sourcePath}.md.txt`;
}

function pickInventoryEntry(current: InventoryEntry | undefined, next: InventoryEntry) {
  if (!current) return next;
  if (current.role === 'std:label') return current;
  if (next.role === 'std:label') return next;
  if (current.role === 'std:doc') return current;
  if (next.role === 'std:doc') return next;
  return current;
}

async function getInventory() {
  if (!inventoryPromise) {
    inventoryPromise = (async () => {
      const response = await fetch('/documentation/objects.inv');
      if (!response.ok) {
        throw new Error('Failed to fetch documentation inventory.');
      }

      const lines = (await inflateInventory(await response.arrayBuffer())).split('\n');
      const inventory = new Map<string, InventoryEntry>();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const match = trimmed.match(/^(\S+)\s+(\S+)\s+(-?\d+)\s+(\S+)\s+(.*)$/);
        if (!match) continue;

        const [, name, role, , uri, displayName] = match;
        const entry: InventoryEntry = {
          name,
          role,
          uri,
          title: displayName === '-' ? formatDocReferenceLabel(name) : displayName,
        };

        inventory.set(name, pickInventoryEntry(inventory.get(name), entry));
      }

      return inventory;
    })();
  }

  return inventoryPromise;
}

function extractSection(markdown: string, anchor: string | null) {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const anchorMatches = [...normalized.matchAll(/^\(([^)]+)\)=\s*$/gm)];

  if (!anchor) {
    return normalized;
  }

  const currentAnchor = anchorMatches.find((match) => match[1] === anchor);
  if (!currentAnchor || currentAnchor.index === undefined) {
    return normalized;
  }

  const currentIndex = anchorMatches.indexOf(currentAnchor);
  const nextAnchor = anchorMatches[currentIndex + 1];
  const endIndex = nextAnchor?.index ?? normalized.length;

  return normalized.slice(currentAnchor.index, endIndex);
}

function sanitizeDocumentationText(section: string) {
  return section
    .replace(/^\([^)]+\)=\s*$/gm, '')
    .replace(/^%.*$/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*:\w+:\s*.*$/gm, '')
    .replace(/\{config:option\}`([^:]+):([^`]+)`/g, '$2')
    .replace(/\{ref\}`([^`]+)`/g, (_, key: string) => formatDocReferenceLabel(key))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

function extractParagraphs(section: string, fallbackTitle: string) {
  return sanitizeDocumentationText(section)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(
      (paragraph) =>
        paragraph.length > 0 &&
        !paragraph.startsWith('Include content from') &&
        !paragraph.startsWith('{include}') &&
        paragraph !== fallbackTitle,
    );
}

function buildPreviewText(paragraphs: string[], fallbackTitle: string) {
  const previewText =
    paragraphs.find((paragraph) => paragraph.length >= 60) || paragraphs[0] || fallbackTitle;

  return previewText;
}

function buildSummarySource(title: string, paragraphs: string[]) {
  const sectionText = paragraphs.join('\n\n');
  return `Section title: ${title}\n\n${sectionText}`;
}

function extractPreview(markdown: string, fallbackTitle: string, anchor: string | null) {
  const section = extractSection(markdown, anchor);
  const titleMatch = section.match(/^#{1,6}\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() || fallbackTitle;
  const paragraphs = extractParagraphs(section, fallbackTitle);

  return {
    title,
    preview: buildPreviewText(paragraphs, fallbackTitle),
    summarySource: buildSummarySource(title, paragraphs),
  };
}

function getSummarizerConstructor() {
  return (self as typeof globalThis & { Summarizer?: BrowserSummarizerConstructor }).Summarizer;
}

export async function getDocumentationReferenceBase(key: string) {
  if (!referenceBasePromiseCache.has(key)) {
    referenceBasePromiseCache.set(
      key,
      (async () => {
        const entry = (await getInventory()).get(key);
        if (!entry) return null;

        return {
          key,
          title: entry.title,
          href: buildReferenceHref(entry),
          sourceHref: buildReferenceSourceHref(entry),
        } satisfies DocumentationReferenceBase;
      })(),
    );
  }

  return referenceBasePromiseCache.get(key)!;
}

export async function getDocumentationReferencePreview(key: string) {
  if (!referencePreviewPromiseCache.has(key)) {
    referencePreviewPromiseCache.set(
      key,
      (async () => {
        const base = await getDocumentationReferenceBase(key);
        if (!base) return null;

        const markdown = await textFetcher(base.sourceHref);
        const preview = extractPreview(markdown, base.title, key);

        return {
          ...base,
          title: preview.title,
          preview: preview.preview,
          summarySource: preview.summarySource,
        } satisfies DocumentationReferencePreview;
      })(),
    );
  }

  return referencePreviewPromiseCache.get(key)!;
}

export async function summarizeDocumentationReference({
  key,
  summarySource,
}: {
  key: string;
  summarySource: string;
}) {
  if (!referenceSummaryPromiseCache.has(key)) {
    referenceSummaryPromiseCache.set(
      key,
      (async () => {
        const Summarizer = getSummarizerConstructor();
        if (!Summarizer) return null;

        try {
          const availability = await Summarizer.availability();
          if (availability !== 'available') {
            return null;
          }

          const summarizer = await Summarizer.create({
            type: 'tldr',
            format: 'plain-text',
            length: 'short',
            preference: 'auto',
          });

          const summary = await summarizer.summarize(summarySource);

          return summary.trim();
        } catch {
          return null;
        }
      })(),
    );
  }

  return referenceSummaryPromiseCache.get(key)!;
}
