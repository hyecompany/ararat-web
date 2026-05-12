'use client';

import * as React from 'react';
import {
  ExternalLinkIcon,
  LoaderCircleIcon,
  SparklesIcon,
} from 'lucide-react';

import type { ConfigOption } from '@/app/_lib/server.d';
import {
  getDocumentationReferenceBase,
  getDocumentationReferencePreview,
  summarizeDocumentationReference,
  type DocumentationReferenceBase,
  type DocumentationReferencePreview,
} from '@/app/_lib/documentation';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function normalizeDefaultValue(value?: string) {
  if (!value) return value;
  if (value.startsWith('`') && value.endsWith('`')) {
    return value.slice(1, -1);
  }
  return value;
}

function useDocumentationReference(key: string | null, loadPreview: boolean) {
  const [reference, setReference] = React.useState<DocumentationReferenceBase | null>(null);
  const [preview, setPreview] = React.useState<DocumentationReferencePreview | null>(null);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);
  const [isSummarizing, setIsSummarizing] = React.useState(false);

  React.useEffect(() => {
    if (!key) return;

    let cancelled = false;

    getDocumentationReferenceBase(key)
      .then((base) => {
        if (!cancelled) {
          setReference(base);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReference(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  React.useEffect(() => {
    if (!key || !loadPreview) return;

    let cancelled = false;
    setIsLoadingPreview(true);

    getDocumentationReferencePreview(key)
      .then((nextPreview) => {
        if (!cancelled) {
          setPreview(nextPreview);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPreview(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key, loadPreview]);

  React.useEffect(() => {
    if (!key || !loadPreview || !preview?.preview) return;

    let cancelled = false;
    setIsSummarizing(true);

    summarizeDocumentationReference({
      key,
      summarySource: preview.summarySource,
    })
      .then((nextSummary) => {
        if (!cancelled) {
          setSummary(nextSummary);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSummarizing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key, loadPreview, preview?.preview, preview?.summarySource]);

  return {
    reference,
    preview,
    summary,
    isLoadingPreview,
    isSummarizing,
  };
}

function ReferenceTokenBadge({
  token,
  referencedOption,
  onConfigOptionClick,
}: {
  token: NonNullable<ConfigOption['reference_tokens']>[number];
  referencedOption?: ConfigOption;
  onConfigOptionClick?: (key: string) => boolean | void;
}) {
  const [open, setOpen] = React.useState(false);
  const docReference = useDocumentationReference(token.kind === 'doc_ref' ? token.key : null, open);

  const referenceResetValue =
    referencedOption?.reset_value ||
    normalizeDefaultValue(
      referencedOption?.initialvaluedesc ??
        referencedOption?.defaultdesc ??
        referencedOption?.default,
    );
  const configReferenceText =
    referencedOption?.display_shortdesc ||
    referencedOption?.shortdesc ||
    referencedOption?.display_longdesc ||
    referencedOption?.longdesc ||
    'Referenced setting';
  const docSummary = docReference.summary?.trim();
  const docPreview = docReference.preview?.preview?.trim();
  const docHref = docReference.reference?.href || docReference.preview?.href;
  const docTitle = docReference.preview?.title || docReference.reference?.title || token.label;
  const isSummarizingPreview = docReference.isSummarizing && !docSummary;
  const displayDocText = docSummary || docPreview;

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        {token.kind === 'doc_ref' ? (
          <a
            href={docHref || '#'}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (!docHref) {
                event.preventDefault();
              }
            }}
            className="hover:bg-muted inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-xs select-none"
          >
            <span>{token.label}</span>
            <ExternalLinkIcon className="size-3" />
          </a>
        ) : (
          <button
            type="button"
            className="hover:bg-muted focus-visible:ring-0 focus-visible:outline-none rounded px-1 py-0.5 font-mono text-xs outline-none select-none"
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={(event) => {
              onConfigOptionClick?.(token.key);
              event.currentTarget.blur();
            }}
          >
            {token.label}
          </button>
        )}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96">
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{token.kind === 'doc_ref' ? docTitle : token.label}</span>
            <span className="text-muted-foreground text-xs">
              {token.kind === 'config_option' ? token.namespace : 'Documentation'}
            </span>
          </div>

          {token.kind === 'doc_ref' ? (
            <>
              {docReference.isLoadingPreview ? (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Loading documentation preview...
                </p>
              ) : displayDocText ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    {docSummary ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground inline-flex items-center">
                            <SparklesIcon className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6}>
                          AI-generated summary. It may be inaccurate.
                        </TooltipContent>
                      </Tooltip>
                    ) : isSummarizingPreview ? (
                      <LoaderCircleIcon className="text-muted-foreground size-3 animate-spin" />
                    ) : null}
                    <span className="text-muted-foreground text-[11px] font-medium">
                      {docSummary ? 'Summarized' : isSummarizingPreview ? 'Summarizing' : ''}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'text-muted-foreground text-xs leading-relaxed transition-opacity',
                      isSummarizingPreview ? 'freshness-shimmer' : '',
                    )}
                  >
                    {displayDocText}
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Open the documentation for more details.
                </p>
              )}

              {docHref ? (
                <a
                  href={docHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
                >
                  Open documentation
                  <ExternalLinkIcon className="size-3" />
                </a>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {configReferenceText.replace(/@@ref:\d+@@/g, '')}
              </p>
              {referenceResetValue ? (
                <p className="text-muted-foreground text-xs">
                  Default: <code>{referenceResetValue}</code>
                </p>
              ) : null}
            </>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function collectReferenceOptions(source: unknown) {
  const optionsByKey = new Map<string, ConfigOption>();

  const walkNode = (node: unknown) => {
    if (!node || typeof node !== 'object') return;

    if ('keys' in node && Array.isArray((node as { keys?: unknown[] }).keys)) {
      (node as { keys: Array<Record<string, ConfigOption>> }).keys.forEach((keyGroup) => {
        Object.entries(keyGroup).forEach(([key, option]) => {
          if (!optionsByKey.has(key)) {
            optionsByKey.set(key, option);
          }

          const normalizedKey = option.fullKey ?? option.key;
          if (normalizedKey && !optionsByKey.has(normalizedKey)) {
            optionsByKey.set(normalizedKey, option);
          }
        });
      });
    }

    Object.values(node as Record<string, unknown>).forEach((value) => {
      if (value && typeof value === 'object') {
        walkNode(value);
      }
    });
  };

  walkNode(source);

  return optionsByKey;
}

export function ConfigDescription({
  text,
  metadata,
  referenceOptions,
  onConfigOptionClick,
}: {
  text?: string;
  metadata?: ConfigOption;
  referenceOptions: Map<string, ConfigOption>;
  onConfigOptionClick?: (key: string) => boolean | void;
}) {
  if (!text) return null;

  const tokenMap = new Map((metadata?.reference_tokens ?? []).map((token) => [token.placeholder, token]));
  const lines = text.split('\n').filter((line) => line.trim().length > 0);

  const renderInline = (line: string) => {
    const chunks = line.split(/(@@ref:\d+@@|`[^`]+`)/g).filter(Boolean);
    return chunks.map((chunk, index) => {
      const referenceToken = tokenMap.get(chunk);
      if (referenceToken) {
        const referencedOption =
          referenceToken.kind === 'config_option'
            ? referenceOptions.get(referenceToken.key)
            : undefined;

        return (
          <ReferenceTokenBadge
            key={`${chunk}-${index}`}
            token={referenceToken}
            referencedOption={referencedOption}
            onConfigOptionClick={onConfigOptionClick}
          />
        );
      }

      if (chunk.startsWith('`') && chunk.endsWith('`')) {
        return (
          <code key={`${chunk}-${index}`} className="bg-muted rounded px-1 py-0.5 text-xs">
            {chunk.slice(1, -1)}
          </code>
        );
      }

      return <React.Fragment key={`${chunk}-${index}`}>{chunk}</React.Fragment>;
    });
  };

  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-xs leading-relaxed">
      {lines.map((line, index) => {
        const isBullet = line.trim().startsWith('- ');
        const content = isBullet ? line.trim().slice(2) : line;

        return (
          <div key={`${line}-${index}`} className={cn('flex gap-2', isBullet ? 'pl-2' : '')}>
            {isBullet ? <span>&bull;</span> : null}
            <span>{renderInline(content)}</span>
          </div>
        );
      })}
    </div>
  );
}
