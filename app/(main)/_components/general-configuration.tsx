'use client';

import * as React from 'react';
import {
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { IconRotateClockwise } from '@tabler/icons-react';
import Editor from '@monaco-editor/react';
import { useTheme } from 'next-themes';

import { Input } from 'ui-web/components/input';
import { Switch } from 'ui-web/components/switch';
import { Button } from 'ui-web/components/button';
import { ScrollArea } from 'ui-web/components/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'ui-web/components/select';

import { useConfigurableOptions } from '@/app/_hooks/server';
import { useStoragePools } from '@/app/(main)/_hooks/storagePools';
import {
  useAllNetworks,
  useClusterGroups,
  useNetworkIntegrations,
  useNetworkZones,
} from '@/app/(main)/_hooks/configResources';
import { ConfigOption, ConfigOptionCollection } from '@/app/_lib/server.d';
import type {
  ClusterGroup,
  NetworkIntegration,
  NetworkZone,
} from '@/app/(main)/_lib/configResources.d';
import type { Network } from '@/app/(main)/_hooks/networks';
import { UnitInput } from '@/app/(main)/_components/unit-input';
import { VerticalTabsLayout } from '@/app/_components/layout/vertical-tabs-layout';
import { ConfigDescription, collectReferenceOptions } from '@/app/(main)/_components/config-description';
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxTrigger,
} from 'ui-web/components/combobox';
import { Field, FieldContent, FieldDescription, FieldLabel } from 'ui-web/components/field';
import { cn } from 'ui-web/lib/utils';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface GeneralConfigurationProps {
  config: Record<string, string>;
  expandedConfig?: Record<string, string>;
  onConfigChange: (config: Record<string, string>) => void;
  readOnly?: boolean;
  instanceType?: 'virtual-machine' | 'container';
  configTarget?: 'instance' | 'project';
  projectMode?: 'create' | 'edit';
}

type ConfigCategory = {
  name: string;
  keys: {
    key: string;
    metadata: ConfigOption;
  }[];
};

type ConfigKeyItem = {
  fullKey: string;
  leafName: string;
  metadata: ConfigOption;
  templateParts?: string[];
};

type CollectionRow = {
  id: string;
  segments: string[];
  value: string;
};

type HugepageRow = {
  id: string;
  size: string;
  value: string;
};

type ResourceOption = {
  value: string;
  label: string;
  description?: string;
};

type ConfigNode = {
  keys: ConfigKeyItem[];
  children: Record<string, ConfigNode>;
};

function isTemplateSegment(segment: string) {
  return (
    segment === '*' ||
    /^<[^>]+>$/.test(segment) ||
    (/^[A-Z0-9_]+$/.test(segment) && segment.includes('_'))
  );
}

function formatDisplayName(name: string) {
  const normalized = name.replace(/[<>]/g, '');
  if (normalized === '*') return 'Key';

  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function resolveTemplateKey(fullKey: string, segments: string[]) {
  const resolvedParts: string[] = [];
  let segmentIndex = 0;

  for (const part of fullKey.split('.')) {
    if (isTemplateSegment(part)) {
      const value = segments[segmentIndex]?.trim();
      if (!value) return null;
      resolvedParts.push(value);
      segmentIndex += 1;
      continue;
    }

    resolvedParts.push(part);
  }

  return resolvedParts.join('.');
}

function extractTemplateSegments(fullKey: string, candidateKey: string) {
  const templateParts = fullKey.split('.');
  const candidateParts = candidateKey.split('.');

  if (templateParts.length !== candidateParts.length) {
    return null;
  }

  const segments: string[] = [];

  for (let index = 0; index < templateParts.length; index += 1) {
    const templatePart = templateParts[index];
    const candidatePart = candidateParts[index];

    if (isTemplateSegment(templatePart)) {
      segments.push(candidatePart);
      continue;
    }

    if (templatePart !== candidatePart) {
      return null;
    }
  }

  return segments;
}

function getCollectionRowsFromConfig(fullKey: string, config: Record<string, string>) {
  return Object.entries(config).flatMap(([key, value]) => {
    const segments = extractTemplateSegments(fullKey, key);
    if (!segments) return [];

    return [
      {
        id: key,
        segments,
        value,
      },
    ];
  });
}

function isPoolTemplatePart(part: string) {
  const normalized = part.replace(/[<>]/g, '').toLowerCase();
  return normalized === 'pool' || normalized === 'pool_name';
}

function normalizeDefaultValue(value?: string) {
  if (!value) return value;
  const normalized = value.startsWith('`') && value.endsWith('`') ? value.slice(1, -1) : value;
  return normalized.toLowerCase() === 'empty' ? undefined : normalized;
}

function buildConfigTree(categoryName: string, items: { key: string; metadata: ConfigOption }[]) {
  const root: ConfigNode = { keys: [], children: {} };

  items.forEach(({ key: fullKey, metadata }) => {
    const categoryPrefix = `${categoryName}.`;
    const relativeKey = fullKey.startsWith(categoryPrefix)
      ? fullKey.slice(categoryPrefix.length)
      : fullKey;

    const parts = relativeKey.split('.');
    const placeholderIndex = parts.findIndex(isTemplateSegment);
    const staticParts = placeholderIndex === -1 ? parts.slice(0, -1) : parts.slice(0, placeholderIndex);
    const templateParts = placeholderIndex === -1 ? undefined : parts.slice(placeholderIndex);
    const leafName =
      placeholderIndex === -1 ? parts[parts.length - 1]! : templateParts![templateParts!.length - 1]!;

    let currentNode = root;
    staticParts.forEach((part) => {
      if (!currentNode.children[part]) {
        currentNode.children[part] = { keys: [], children: {} };
      }
      currentNode = currentNode.children[part];
    });

    currentNode.keys.push({ fullKey, leafName, metadata, templateParts });
  });

  return root;
}

function renderConfigTree(
  node: ConfigNode,
  renderInput: (
    fullKey: string,
    metadata: ConfigOption,
    label?: string,
    templateParts?: string[],
  ) => React.ReactNode,
  formatCategoryName: (name: string) => string,
): React.ReactNode {
  const leafNames = new Set(node.keys.map((entry) => entry.leafName));

  return (
    <div className="space-y-6">
      {node.keys.map(({ fullKey, leafName, metadata, templateParts }) =>
        renderInput(fullKey, metadata, leafName, templateParts),
      )}

      {Object.entries(node.children).map(([name, childNode]) => {
        const duplicatedHeading = leafNames.has(name);

        return (
          <div key={name} className={duplicatedHeading ? '' : 'pt-2'}>
            {!duplicatedHeading ? (
              <h4 className="mb-4 text-base font-semibold">{formatCategoryName(name)}</h4>
            ) : null}
            <div className="space-y-6">{renderConfigTree(childNode, renderInput, formatCategoryName)}</div>
          </div>
        );
      })}
    </div>
  );
}

function isProjectFeatureOption(metadata: ConfigOption) {
  return /^features?\./.test(metadata.fullKey ?? metadata.key ?? '');
}

function getProjectInitialValue(metadata: ConfigOption) {
  return normalizeDefaultValue(
    metadata.initialvaluedesc ?? metadata.defaultdesc ?? metadata.default,
  );
}

function getProjectDefaultValue(metadata: ConfigOption) {
  return normalizeDefaultValue(metadata.defaultdesc ?? metadata.default);
}

function getProjectDisplayValue(
  metadata: ConfigOption,
  projectMode: 'create' | 'edit',
  hasExplicitProjectFeatureOverrides: boolean,
) {
  if (
    isProjectFeatureOption(metadata) &&
    (projectMode === 'edit' || hasExplicitProjectFeatureOverrides)
  ) {
    return getProjectDefaultValue(metadata) ?? 'false';
  }

  return getProjectInitialValue(metadata);
}

function getProjectResetValue(
  metadata: ConfigOption,
  projectMode: 'create' | 'edit',
  hasExplicitProjectFeatureOverrides: boolean,
) {
  if (
    isProjectFeatureOption(metadata) &&
    (projectMode === 'edit' || hasExplicitProjectFeatureOverrides)
  ) {
    return getProjectDefaultValue(metadata) ?? 'false';
  }

  return getProjectInitialValue(metadata);
}

function shouldPersistProjectResetValue(
  metadata: ConfigOption,
  projectMode: 'create' | 'edit',
  hasExplicitProjectFeatureOverrides: boolean,
) {
  const initialValue = normalizeDefaultValue(metadata.initialvaluedesc);
  const defaultValue = normalizeDefaultValue(metadata.defaultdesc ?? metadata.default);
  const resetValue = getProjectResetValue(metadata, projectMode, hasExplicitProjectFeatureOverrides);

  if (
    isProjectFeatureOption(metadata) &&
    (projectMode === 'edit' || hasExplicitProjectFeatureOverrides)
  ) {
    return resetValue !== undefined;
  }

  return initialValue !== undefined && initialValue !== defaultValue;
}

function getUnsetValue({
  metadata,
  configTarget,
  instanceType,
  projectMode,
  hasExplicitProjectFeatureOverrides,
}: {
  metadata: ConfigOption;
  configTarget: 'instance' | 'project';
  instanceType: 'virtual-machine' | 'container';
  projectMode: 'create' | 'edit';
  hasExplicitProjectFeatureOverrides: boolean;
}) {
  if (configTarget === 'project') {
    return getProjectDisplayValue(metadata, projectMode, hasExplicitProjectFeatureOverrides);
  }

  if (metadata.scoped_defaults && Object.keys(metadata.scoped_defaults).length > 0) {
    return normalizeDefaultValue(metadata.scoped_defaults[instanceType]);
  }

  return normalizeDefaultValue(metadata.defaultdesc ?? metadata.default);
}

function splitCsvValue(value?: string) {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitNewlineValue(value?: string) {
  if (!value) return [];
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeConfigValue(value: string | undefined, metadata: ConfigOption) {
  if (value === undefined) return undefined;
  if (metadata.type === 'bool') {
    return value.toLowerCase() === 'true' ? 'true' : 'false';
  }
  return value;
}

function doesDependencyMatch(
  dependency: NonNullable<ConfigOption['depends_on']>[number],
  value: string | undefined,
) {
  const normalizedValue = value?.trim();

  if (dependency.operator === 'truthy') {
    return normalizedValue === 'true';
  }

  return normalizedValue === dependency.value;
}

function CsvListInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState('');
  const items = React.useMemo(() => splitCsvValue(value), [value]);

  const commitDraft = React.useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (items.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...items, trimmed].join(','));
    setDraft('');
  }, [draft, items, onChange]);

  const removeItem = React.useCallback(
    (item: string) => {
      onChange(items.filter((current) => current !== item).join(','));
    },
    [items, onChange],
  );

  return (
    <div className="flex max-w-xl flex-col gap-3">
      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={item}
              className="bg-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
            >
              <code>{item}</code>
              {!disabled ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => removeItem(item)}
                  aria-label={`Remove ${item}`}
                >
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder || 'Add value and press Enter'}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commitDraft();
            }
          }}
          onBlur={commitDraft}
          className="max-w-md text-sm"
        />
        {!disabled ? (
          <Button type="button" variant="outline" size="sm" onClick={commitDraft}>
            Add
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function NewlineListInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  id: string;
  value: string | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const [rows, setRows] = React.useState<Array<{ id: string; value: string }>>(() =>
    splitNewlineValue(value).map((item, index) => ({
      id: `${id}-${index}-${item}`,
      value: item,
    })),
  );

  React.useEffect(() => {
    const items = splitNewlineValue(value);
    const serializedRows = rows.map((row) => row.value.trim()).filter(Boolean).join('\n');
    const serializedValue = items.join('\n');
    if (serializedRows === serializedValue) return;

    setRows(
      items.map((item, index) => ({
        id: `${id}-${index}-${item}`,
        value: item,
      })),
    );
  }, [id, rows, value]);

  const commitRows = React.useCallback(
    (nextRows: Array<{ id: string; value: string }>) => {
      onChange(
        nextRows
          .map((row) => row.value.trim())
          .filter(Boolean)
          .join('\n'),
      );
    },
    [onChange],
  );

  const addRow = React.useCallback(() => {
    const nextRows = [
      ...rows,
      {
        id: createSyntheticRowId(id),
        value: '',
      },
    ];
    setRows(nextRows);
  }, [id, rows]);

  const removeRow = React.useCallback(
    (rowId: string) => {
      const nextRows = rows.filter((row) => row.id !== rowId);
      setRows(nextRows);
      commitRows(nextRows);
    },
    [commitRows, rows],
  );

  const hasRows = rows.length > 0;

  return (
    <div className="flex max-w-xl flex-col gap-3">
      {hasRows ? (
        rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              id={`${id}-${index}`}
              value={row.value}
              placeholder={placeholder || 'Add one entry per line'}
              disabled={disabled}
              onChange={(event) => {
                const nextRows = rows.map((current) =>
                  current.id === row.id ? { ...current, value: event.target.value } : current,
                );
                setRows(nextRows);
                commitRows(nextRows);
              }}
              className="max-w-md text-sm"
            />
            {!disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(row.id)}
                aria-label={`Remove entry ${index + 1}`}
              >
                <Trash2Icon className="size-4" />
              </Button>
            ) : null}
          </div>
        ))
      ) : (
        <div className="border-border/60 text-muted-foreground rounded-md border border-dashed px-4 py-4 text-sm">
          Add one entry per line.
        </div>
      )}

      {!disabled ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <PlusIcon className="mr-2 size-4" />
            Add entry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ResourceSelectorInput({
  value,
  onChange,
  disabled,
  placeholder,
  options,
  loading,
  searchPlaceholder,
  emptyLabel,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
  options: ResourceOption[];
  loading: boolean;
  searchPlaceholder: string;
  emptyLabel: string;
}) {
  const values = React.useMemo(() => splitCsvValue(value), [value]);

  return (
    <Combobox
      multiple
      values={values}
      onValuesChange={(nextValues) => onChange(nextValues.join(','))}
      disabled={disabled}
    >
      <ComboboxTrigger placeholder={placeholder || 'Select values'} />
      <ComboboxContent
        searchPlaceholder={searchPlaceholder}
        emptyLabel={emptyLabel}
        loading={loading}
      >
        {options.map((option) => (
          <ComboboxItem
            key={option.value}
            value={option.value}
            description={option.description}
          >
            {option.label}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  );
}

function MonacoValueInput({
  value,
  onChange,
  disabled,
  language,
  theme,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled: boolean;
  language?: string;
  theme: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Editor
        height="240px"
        defaultLanguage={language || 'plaintext'}
        language={language || 'plaintext'}
        theme={theme}
        value={value || ''}
        onChange={(nextValue) => onChange(nextValue ?? '')}
        options={{
          readOnly: disabled,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          tabSize: 2,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
}

export default function GeneralConfiguration({
  config,
  expandedConfig = {},
  onConfigChange,
  readOnly = false,
  instanceType = 'container',
  configTarget = 'instance',
  projectMode = 'create',
}: GeneralConfigurationProps) {
  const { resolvedTheme } = useTheme();
  const { data: configurableOptions } = useConfigurableOptions();
  const { data: storagePools } = useStoragePools();
  const { data: clusterGroups, isLoading: isLoadingClusterGroups } = useClusterGroups();
  const { data: allNetworks, isLoading: isLoadingAllNetworks } = useAllNetworks();
  const { data: networkIntegrations, isLoading: isLoadingNetworkIntegrations } =
    useNetworkIntegrations();
  const { data: networkZones, isLoading: isLoadingNetworkZones } = useNetworkZones();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);
  const [collectionRows, setCollectionRows] = React.useState<Record<string, CollectionRow[]>>({});
  const [hugepageRows, setHugepageRows] = React.useState<Record<string, HugepageRow[]>>({});
  const [highlightedKey, setHighlightedKey] = React.useState<string | null>(null);
  const [pendingNavigationKey, setPendingNavigationKey] = React.useState<string | null>(null);
  const fieldRefs = React.useRef(new Map<string, HTMLDivElement | null>());
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null);
  const scrollViewportRef = React.useRef<HTMLDivElement | null>(null);
  const lastScrollTopRef = React.useRef(0);
  const highlightTimeoutRef = React.useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const syntheticRowIdRef = React.useRef(0);
  const hasExplicitProjectFeatureOverrides = React.useMemo(
    () => Object.keys(config).some((key) => /^features?\./.test(key)),
    [config],
  );

  const createSyntheticRowId = React.useCallback((prefix: string) => {
    syntheticRowIdRef.current += 1;
    return `${prefix}-${syntheticRowIdRef.current}`;
  }, []);

  const categories = React.useMemo(() => {
    const configCollection = configurableOptions?.configs?.[configTarget] as
      | ConfigOptionCollection
      | undefined;
    if (!configCollection) return [];

    const cats: ConfigCategory[] = [];

    Object.entries(configCollection).forEach(([categoryName, categoryData]) => {
      if (configTarget === 'instance' && categoryName === 'volatile') return;
      if (typeof categoryData !== 'object' || !categoryData || !('keys' in categoryData)) {
        return;
      }

      const keys = (categoryData as { keys: Record<string, ConfigOption>[] }).keys.flatMap(
        (keyObj) =>
          Object.entries(keyObj).map(([key, metadata]) => ({
            key: metadata.fullKey || key,
            metadata,
          })),
      );

      let validKeys = keys.filter((entry) => {
        if (configTarget !== 'instance') return true;
        if (!entry.metadata.supported_types) return true;
        return entry.metadata.supported_types.includes(instanceType);
      });

      if (configTarget === 'instance') {
        const hugepageEntries = validKeys.filter((entry) => entry.key.startsWith('limits.hugepages.'));
        if (hugepageEntries.length) {
          validKeys = validKeys.filter((entry) => !entry.key.startsWith('limits.hugepages.'));
          validKeys.push({
            key: 'limits.hugepages',
            metadata: {
              ...hugepageEntries[0].metadata,
              editor_kind: 'hugepages_group',
              group_members: hugepageEntries.map((entry) => ({
                key: entry.key,
                label: entry.key.split('.').pop() || entry.key,
                metadata: entry.metadata,
              })),
            },
          });
        }
      }

      if (validKeys.length > 0) {
        cats.push({
          name: categoryName,
          keys: validKeys,
        });
      }
    });

    return cats.sort((a, b) => a.name.localeCompare(b.name));
  }, [configTarget, configurableOptions, instanceType]);

  const referenceOptions = React.useMemo(
    () => collectReferenceOptions(configurableOptions?.configs),
    [configurableOptions],
  );

  const keyTargets = React.useMemo(() => {
    const targets = new Map<string, { displayKey: string; category: string }>();

    categories.forEach((category) => {
      category.keys.forEach((entry) => {
        targets.set(entry.key, {
          displayKey: entry.key,
          category: category.name,
        });

        entry.metadata.group_members?.forEach((member) => {
          targets.set(member.key, {
            displayKey: entry.key,
            category: category.name,
          });
        });
      });
    });

    return targets;
  }, [categories]);

  const selectorSources = React.useMemo<
    Record<
      NonNullable<ConfigOption['selector_source']>,
      { options: ResourceOption[]; loading: boolean; searchPlaceholder: string; emptyLabel: string }
    >
  >(
    () => ({
      cluster_groups: {
        options:
          clusterGroups?.map((group: ClusterGroup) => ({
            value: group.name,
            label: group.name,
            description: group.description,
          })) ?? [],
        loading: isLoadingClusterGroups,
        searchPlaceholder: 'Search cluster groups...',
        emptyLabel: 'No cluster groups found.',
      },
      networks: {
        options:
          allNetworks?.map((network: Network) => ({
            value: network.name,
            label: network.name,
            description: network.description || network.type,
          })) ?? [],
        loading: isLoadingAllNetworks,
        searchPlaceholder: 'Search networks...',
        emptyLabel: 'No networks found.',
      },
      network_integrations: {
        options:
          networkIntegrations?.map((integration: NetworkIntegration) => ({
            value: integration.name,
            label: integration.name,
            description: integration.description || integration.type,
          })) ?? [],
        loading: isLoadingNetworkIntegrations,
        searchPlaceholder: 'Search integrations...',
        emptyLabel: 'No integrations found.',
      },
      network_zones: {
        options:
          networkZones?.map((zone: NetworkZone) => ({
            value: zone.name,
            label: zone.name,
            description: zone.description,
          })) ?? [],
        loading: isLoadingNetworkZones,
        searchPlaceholder: 'Search network zones...',
        emptyLabel: 'No network zones found.',
      },
    }),
    [
      allNetworks,
      clusterGroups,
      isLoadingAllNetworks,
      isLoadingClusterGroups,
      isLoadingNetworkIntegrations,
      isLoadingNetworkZones,
      networkIntegrations,
      networkZones,
    ],
  );

  React.useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]',
    );
    if (!viewport) return;

    scrollViewportRef.current = viewport;
    viewport.scrollTop = lastScrollTopRef.current;

    const handleScroll = () => {
      lastScrollTopRef.current = viewport.scrollTop;
    };

    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
    };
  }, []);

  React.useEffect(() => {
    if (!categories.length) {
      setSelectedCategory(null);
      return;
    }

    if (!selectedCategory || !categories.some((category) => category.name === selectedCategory)) {
      setSelectedCategory(categories[0].name);
    }
  }, [categories, selectedCategory]);

  React.useEffect(() => {
    const templateKeys = categories
      .flatMap((category) => category.keys)
      .map((entry) => entry.key)
      .filter((key) => key.split('.').some(isTemplateSegment));

    if (!templateKeys.length) return;

    setCollectionRows((current) => {
      let changed = false;
      const next = { ...current };

      templateKeys.forEach((fullKey) => {
        const previousRows = current[fullKey] ?? [];
        const previousRowsByResolvedKey = new Map(
          previousRows
            .map((row) => {
              const resolvedKey = resolveTemplateKey(fullKey, row.segments);
              return resolvedKey ? ([resolvedKey, row] as const) : null;
            })
            .filter((entry): entry is readonly [string, CollectionRow] => entry !== null),
        );

        const existingRows = getCollectionRowsFromConfig(fullKey, config).map((row) => {
          const previousRow = previousRowsByResolvedKey.get(row.id);
          if (!previousRow) return row;

          return {
            ...row,
            id: previousRow.id,
          };
        });
        const draftRows =
          current[fullKey]?.filter((row) => {
            const resolvedKey = resolveTemplateKey(fullKey, row.segments);
            return !resolvedKey || !Object.prototype.hasOwnProperty.call(config, resolvedKey);
          }) ?? [];
        const mergedRows = [...existingRows, ...draftRows];

        const sameLength = previousRows.length === mergedRows.length;
        const sameRows =
          sameLength &&
          previousRows.every((row, index) => {
            const other = mergedRows[index];
            return (
              row?.id === other?.id &&
              row?.value === other?.value &&
              row?.segments.join('|') === other?.segments.join('|')
            );
          });

        if (!sameRows) {
          next[fullKey] = mergedRows;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [categories, config]);

  React.useEffect(() => {
    const hugepageGroups = categories
      .flatMap((category) => category.keys)
      .filter((entry) => entry.metadata.editor_kind === 'hugepages_group');

    if (!hugepageGroups.length) return;

    setHugepageRows((current) => {
      let changed = false;
      const next = { ...current };

      hugepageGroups.forEach((entry) => {
        const previousRows = current[entry.key] ?? [];
        const previousRowsByKey = new Map(previousRows.map((row) => [`${entry.key}.${row.size}`, row]));
        const rowsFromConfig =
          entry.metadata.group_members?.flatMap((member) => {
            if (!Object.prototype.hasOwnProperty.call(config, member.key)) {
              return [];
            }

            const previousRow = previousRowsByKey.get(member.key);
            return [
              {
                id: previousRow?.id ?? member.key,
                size: member.label,
                value: config[member.key],
              },
            ];
          }) ?? [];

        const sameLength = rowsFromConfig.length === previousRows.length;
        const sameRows =
          sameLength &&
          rowsFromConfig.every((row, index) => {
            const previousRow = previousRows[index];
            return (
              previousRow?.id === row.id &&
              previousRow?.size === row.size &&
              previousRow?.value === row.value
            );
          });

        if (!sameRows) {
          next[entry.key] = rowsFromConfig;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [categories, config]);

  const navigateToField = React.useCallback((targetKey: string) => {
    const node = fieldRefs.current.get(targetKey);
    if (!node) return false;

    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedKey(targetKey);
    setPendingNavigationKey(null);

    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedKey((current) => (current === targetKey ? null : current));
      highlightTimeoutRef.current = null;
    }, 900);

    return true;
  }, []);

  const setFieldRef = React.useCallback(
    (key: string, node: HTMLDivElement | null) => {
      fieldRefs.current.set(key, node);

      if (node && pendingNavigationKey === key) {
        navigateToField(key);
      }
    },
    [navigateToField, pendingNavigationKey],
  );

  React.useEffect(() => {
    if (!pendingNavigationKey) return;

    navigateToField(pendingNavigationKey);
  }, [navigateToField, pendingNavigationKey, selectedCategory]);

  React.useEffect(
    () => () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (pendingNavigationKey) return;

    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    viewport.scrollTo({ top: 0, behavior: 'auto' });
    lastScrollTopRef.current = 0;
    setHighlightedKey(null);
  }, [pendingNavigationKey, selectedCategory]);

  const getEffectiveValue = React.useCallback(
    (key: string, metadata: ConfigOption) => {
      const hasLocalValue = Object.prototype.hasOwnProperty.call(config, key);
      if (hasLocalValue) {
        return normalizeConfigValue(config[key], metadata);
      }

      const hasInheritedValue = Object.prototype.hasOwnProperty.call(expandedConfig, key);
      if (hasInheritedValue) {
        return normalizeConfigValue(expandedConfig[key], metadata);
      }

      return normalizeConfigValue(
        getUnsetValue({
          metadata,
          configTarget,
          instanceType,
          projectMode,
          hasExplicitProjectFeatureOverrides,
        }),
        metadata,
      );
    },
    [
      config,
      configTarget,
      expandedConfig,
      hasExplicitProjectFeatureOverrides,
      instanceType,
      projectMode,
    ],
  );

  const matchesInstanceCondition = React.useCallback(
    (metadata: ConfigOption) => {
      if (configTarget !== 'instance' || !metadata.condition) return true;

      const normalizedCondition = metadata.condition.toLowerCase();

      if (
        normalizedCondition.includes('unprivileged container') ||
        normalizedCondition.includes('unprivileged containers')
      ) {
        const privilegedMetadata = referenceOptions.get('security.privileged') ?? { type: 'bool' };
        const effectivePrivileged = getEffectiveValue(
          'security.privileged',
          privilegedMetadata as ConfigOption,
        );

        return instanceType === 'container' && effectivePrivileged !== 'true';
      }

      if (
        normalizedCondition.includes('virtual machine') ||
        normalizedCondition.includes('(vm') ||
        normalizedCondition === 'vm'
      ) {
        return instanceType === 'virtual-machine';
      }

      if (
        normalizedCondition.includes('container') &&
        !normalizedCondition.includes('virtual machine')
      ) {
        return instanceType === 'container';
      }

      return true;
    },
    [configTarget, getEffectiveValue, instanceType, referenceOptions],
  );

  const filteredCategories = React.useMemo(() => {
    const applicableCategories = categories
      .map((category) => ({
        ...category,
        keys: category.keys.filter((entry) => matchesInstanceCondition(entry.metadata)),
      }))
      .filter((category) => category.keys.length > 0);

    if (!searchQuery) return applicableCategories;

    const lowerQuery = searchQuery.toLowerCase();
    return applicableCategories
      .map((category) => ({
        ...category,
        keys: category.keys.filter(
          (entry) =>
            entry.key.toLowerCase().includes(lowerQuery) ||
            entry.metadata.display_shortdesc?.toLowerCase().includes(lowerQuery) ||
            entry.metadata.shortdesc?.toLowerCase().includes(lowerQuery) ||
            entry.metadata.display_longdesc?.toLowerCase().includes(lowerQuery) ||
            entry.metadata.longdesc?.toLowerCase().includes(lowerQuery),
        ),
      }))
      .filter((category) => category.keys.length > 0);
  }, [categories, matchesInstanceCondition, searchQuery]);

  const getDisabledState = React.useCallback(
    (key: string, metadata: ConfigOption) => {
      if (readOnly) {
        return { disabled: true, reason: metadata.disabled_reason };
      }

      if (!metadata.depends_on?.length) {
        return { disabled: false, reason: metadata.disabled_reason };
      }

      for (const dependency of metadata.depends_on) {
        const dependencyMetadata =
          referenceOptions.get(dependency.key) ?? ({ type: 'string' } as ConfigOption);
        const dependencyValue = getEffectiveValue(dependency.key, dependencyMetadata);

        if (!doesDependencyMatch(dependency, dependencyValue)) {
          return {
            disabled: true,
            reason: metadata.disabled_reason || `Update \`${dependency.key}\` to use this setting.`,
          };
        }
      }

      return { disabled: false, reason: metadata.disabled_reason };
    },
    [getEffectiveValue, readOnly, referenceOptions],
  );

  const navigateToConfigKey = React.useCallback(
    (key: string) => {
      const target = keyTargets.get(key);
      if (!target) return false;

      setSearchQuery('');
      setSelectedCategory(target.category);
      setPendingNavigationKey(target.displayKey);
      return true;
    },
    [keyTargets],
  );

  const renderDescription = React.useCallback(
    (text?: string, metadata?: ConfigOption) => {
      if (!text) return null;

      return (
        <ConfigDescription
          text={text}
          metadata={metadata}
          referenceOptions={referenceOptions}
          onConfigOptionClick={navigateToConfigKey}
        />
      );
    },
    [navigateToConfigKey, referenceOptions],
  );

  const handleValueChange = (key: string, value: string | undefined, metadata?: ConfigOption) => {
    if (readOnly) return;
    const nextConfig = { ...config };
    const normalizedValue = value === '' ? undefined : value;
    const inheritedValue = expandedConfig[key];
    const isProjectResetValue =
      configTarget === 'project' &&
      metadata &&
      !Object.prototype.hasOwnProperty.call(expandedConfig, key) &&
      shouldPersistProjectResetValue(metadata, projectMode, hasExplicitProjectFeatureOverrides);
    const resetValue =
      metadata && !Object.prototype.hasOwnProperty.call(expandedConfig, key)
        ? getProjectResetValue(metadata, projectMode, hasExplicitProjectFeatureOverrides)
        : undefined;

    if (
      normalizedValue === undefined ||
      (!isProjectResetValue &&
        resetValue !== undefined &&
        normalizedValue === resetValue &&
        inheritedValue === undefined)
    ) {
      delete nextConfig[key];
    } else {
      nextConfig[key] = normalizedValue;
    }
    onConfigChange(nextConfig);
  };

  const handleCollectionRowChange = (
    fullKey: string,
    rowId: string,
    updates: Partial<CollectionRow>,
  ) => {
    const rows = collectionRows[fullKey] ?? [];
    const currentRow = rows.find((row) => row.id === rowId);
    if (!currentRow) return;

    const nextRow: CollectionRow = {
      ...currentRow,
      ...updates,
      segments: updates.segments ?? currentRow.segments,
      value: updates.value ?? currentRow.value,
    };
    const previousResolvedKey = resolveTemplateKey(fullKey, currentRow.segments);
    const nextResolvedKey = resolveTemplateKey(fullKey, nextRow.segments);

    setCollectionRows((current) => ({
      ...current,
      [fullKey]: rows.map((row) => (row.id === rowId ? nextRow : row)),
    }));

    const nextConfig = { ...config };
    if (previousResolvedKey && previousResolvedKey !== nextResolvedKey) {
      delete nextConfig[previousResolvedKey];
    }

    if (nextResolvedKey && nextRow.value !== '') {
      nextConfig[nextResolvedKey] = nextRow.value;
    } else if (nextResolvedKey) {
      delete nextConfig[nextResolvedKey];
    }

    onConfigChange(nextConfig);
  };

  const handleCollectionRowAdd = (fullKey: string, templateParts: string[]) => {
    setCollectionRows((current) => ({
      ...current,
      [fullKey]: [
        ...(current[fullKey] ?? []),
        {
          id: createSyntheticRowId(fullKey),
          segments: templateParts.map(() => ''),
          value: '',
        },
      ],
    }));
  };

  const handleCollectionRowRemove = (fullKey: string, rowId: string) => {
    const rows = collectionRows[fullKey] ?? [];
    const currentRow = rows.find((row) => row.id === rowId);
    if (!currentRow) return;

    const resolvedKey = resolveTemplateKey(fullKey, currentRow.segments);
    if (resolvedKey) {
      const nextConfig = { ...config };
      delete nextConfig[resolvedKey];
      onConfigChange(nextConfig);
    }

    setCollectionRows((current) => ({
      ...current,
      [fullKey]: rows.filter((row) => row.id !== rowId),
    }));
  };

  const handleHugepageRowAdd = (fullKey: string, metadata: ConfigOption) => {
    const usedSizes = new Set((hugepageRows[fullKey] ?? []).map((row) => row.size));
    const nextSize = metadata.group_members?.find((member) => !usedSizes.has(member.label))?.label;
    if (!nextSize) return;

    const nextRows = [
      ...(hugepageRows[fullKey] ?? []),
      {
        id: createSyntheticRowId(fullKey),
        size: nextSize,
        value: '',
      },
    ];
    setHugepageRows((current) => ({
      ...current,
      [fullKey]: nextRows,
    }));
  };

  const handleHugepageRowChange = (
    fullKey: string,
    rowId: string,
    updates: Partial<HugepageRow>,
  ) => {
    const rows = hugepageRows[fullKey] ?? [];
    const currentRow = rows.find((row) => row.id === rowId);
    if (!currentRow) return;

    const nextRow = {
      ...currentRow,
      ...updates,
    };
    const previousKey = `${fullKey}.${currentRow.size}`;
    const nextKey = `${fullKey}.${nextRow.size}`;
    const nextRows = rows.map((row) => (row.id === rowId ? nextRow : row));

    setHugepageRows((current) => ({
      ...current,
      [fullKey]: nextRows,
    }));

    const nextConfig = { ...config };
    if (previousKey !== nextKey) {
      delete nextConfig[previousKey];
    }

    if (nextRow.value.trim()) {
      nextConfig[nextKey] = nextRow.value;
    } else {
      delete nextConfig[nextKey];
    }

    onConfigChange(nextConfig);
  };

  const handleHugepageRowRemove = (fullKey: string, rowId: string) => {
    const rows = hugepageRows[fullKey] ?? [];
    const currentRow = rows.find((row) => row.id === rowId);
    if (!currentRow) return;

    const nextConfig = { ...config };
    delete nextConfig[`${fullKey}.${currentRow.size}`];
    onConfigChange(nextConfig);

    setHugepageRows((current) => ({
      ...current,
      [fullKey]: rows.filter((row) => row.id !== rowId),
    }));
  };

  const renderHugepagesGroup = (fullKey: string, metadata: ConfigOption, label: string) => {
    const rows = hugepageRows[fullKey] ?? [];
    const availableSizes = metadata.group_members ?? [];
    const usedSizes = new Set(rows.map((row) => row.size));
    const canAddMore = availableSizes.some((member) => !usedSizes.has(member.label));

    return (
      <div
        key={fullKey}
          ref={(node) => {
            setFieldRef(fullKey, node);
          }}
        className={cn(
          'rounded-md transition-[background-color,box-shadow]',
          highlightedKey === fullKey && 'bg-primary/5',
        )}
      >
      <Field className="border-b pb-6 last:border-0 last:pb-0">
        <div className="flex items-start justify-between gap-4">
          <FieldContent>
            <FieldLabel className="flex items-center gap-2 text-sm font-medium">{label}</FieldLabel>
            {renderDescription(metadata.display_shortdesc || metadata.shortdesc, metadata)}
          </FieldContent>
          {!readOnly && canAddMore ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => handleHugepageRowAdd(fullKey, metadata)}
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              Add size
            </Button>
          ) : null}
        </div>

        <div className="space-y-4">
          {rows.length ? (
            rows.map((row, index) => {
              const selectedMember =
                availableSizes.find((member) => member.label === row.size) ?? availableSizes[0];
              const sizeOptions = availableSizes.filter(
                (member) => member.label === row.size || !usedSizes.has(member.label),
              );

              return (
                <div key={row.id} className="border-border/60 bg-muted/10 rounded-md border p-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)_auto] md:items-end">
                    <div className="space-y-2">
                      <FieldLabel className="text-muted-foreground text-xs font-medium">Size</FieldLabel>
                      <Select
                        value={row.size}
                        onValueChange={(nextSize) =>
                          handleHugepageRowChange(fullKey, row.id, { size: nextSize })
                        }
                        disabled={readOnly}
                      >
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                        <SelectContent>
                          {sizeOptions.map((member) => (
                            <SelectItem key={member.key} value={member.label}>
                              {member.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <FieldLabel className="text-muted-foreground text-xs font-medium">Value</FieldLabel>
                      <div className="w-full max-w-md">
                        {selectedMember
                          ? renderValueControl({
                              id: `${row.id}-value`,
                              metadata: selectedMember.metadata,
                              value: row.value,
                              onChange: (nextValue) =>
                                handleHugepageRowChange(fullKey, row.id, { value: nextValue }),
                              disabled: readOnly,
                              placeholder: getUnsetValue({
                                metadata: selectedMember.metadata,
                                configTarget,
                                instanceType,
                                projectMode,
                                hasExplicitProjectFeatureOverrides,
                              }),
                            })
                          : null}
                      </div>
                    </div>
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => handleHugepageRowRemove(fullKey, row.id)}
                        aria-label={`Remove ${label} ${index + 1}`}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="border-border/60 text-muted-foreground rounded-md border border-dashed px-4 py-6 text-sm">
              Add one or more hugepage size limits.
            </div>
          )}
        </div>

        {renderDescription(metadata.display_longdesc || metadata.longdesc, metadata)}
      </Field>
      </div>
    );
  };

  const renderValueControl = ({
    id,
    metadata,
    value,
    onChange,
    disabled,
    placeholder,
  }: {
    id: string;
    metadata: ConfigOption;
    value: string | undefined;
    onChange: (value: string) => void;
    disabled: boolean;
    placeholder?: string;
  }) => {
    const hasUnitOptions =
      !metadata.disable_unit_input &&
      metadata.unit_options &&
      metadata.unit_options.length > 0 &&
      metadata.default_unit;

    if (metadata.type === 'bool') {
      return (
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked.toString())}
            disabled={disabled}
          />
          <span className="text-muted-foreground text-xs">
            {value === 'true' ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      );
    }

    if (metadata.enum_options?.length) {
      return (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="h-9 w-full max-w-md">
            <SelectValue placeholder={placeholder || 'Select value'} />
          </SelectTrigger>
          <SelectContent>
            {metadata.enum_options.map((optionValue) => (
              <SelectItem key={optionValue} value={optionValue}>
                {optionValue}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (metadata.selector_source) {
      const source = selectorSources[metadata.selector_source];
      return (
        <ResourceSelectorInput
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder || 'Select values'}
          options={source.options}
          loading={source.loading}
          searchPlaceholder={source.searchPlaceholder}
          emptyLabel={source.emptyLabel}
        />
      );
    }

    if (hasUnitOptions) {
      return (
        <UnitInput
          id={id}
          value={value}
          unitOptions={metadata.unit_options!}
          defaultUnit={metadata.default_unit!}
          onValueChange={(nextValue) => onChange(nextValue ?? '')}
          disabled={disabled}
          placeholder={placeholder}
          inputClassName="text-sm"
          selectClassName="h-9 w-24 shrink-0"
          wrapperClassName="flex w-full max-w-md items-center gap-2"
        />
      );
    }

    if (metadata.editor_kind === 'newline_list') {
      return (
        <NewlineListInput
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder || 'Add one entry per line'}
        />
      );
    }

    if (metadata.editor_kind === 'schedule_autocomplete') {
      return (
        <div className="max-w-md">
          <AutocompleteInput
            id={id}
            value={value || ''}
            onValueChange={onChange}
            disabled={disabled}
            className="text-sm"
            placeholder={placeholder || 'Cron expression or schedule aliases'}
            options={metadata.suggestions ?? []}
          />
        </div>
      );
    }

    if (metadata.editor_kind === 'monaco') {
      return (
        <div className="max-w-3xl">
          <MonacoValueInput
            value={value}
            onChange={onChange}
            disabled={disabled}
            language={metadata.editor_language}
            theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          />
        </div>
      );
    }

    if (metadata.list_kind === 'csv') {
      return (
        <CsvListInput
          id={id}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder || 'Add values'}
        />
      );
    }

    return (
      <Input
        id={id}
        type={metadata.type === 'integer' ? 'number' : 'text'}
        value={value || ''}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="max-w-md text-sm"
      />
    );
  };

  const renderCollectionInput = (
    fullKey: string,
    metadata: ConfigOption,
    label: string,
    templateParts: string[],
  ) => {
    const rows = collectionRows[fullKey] ?? [];
    const defaultValueDisplay = getUnsetValue({
      metadata,
      configTarget,
      instanceType,
      projectMode,
      hasExplicitProjectFeatureOverrides,
    });

    const segmentLabels = templateParts.map((part) => formatDisplayName(part));
    const isUserCollection = fullKey === 'user.*';
    const addLabel = isUserCollection ? 'Add User Key' : `Add ${label}`;

    return (
      <div
        key={fullKey}
          ref={(node) => {
            setFieldRef(fullKey, node);
          }}
        className={cn(
          'rounded-md transition-[background-color,box-shadow]',
          highlightedKey === fullKey && 'bg-primary/5',
        )}
      >
      <Field className="border-b pb-6 last:border-0 last:pb-0">
        <div className="flex items-start justify-between gap-4">
          <FieldContent>
            <FieldLabel className="flex items-center gap-2 text-sm font-medium">{label}</FieldLabel>
            {renderDescription(metadata.display_shortdesc || metadata.shortdesc, metadata, fullKey)}
          </FieldContent>
          {!readOnly ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => handleCollectionRowAdd(fullKey, templateParts)}
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              {addLabel}
            </Button>
          ) : null}
        </div>

        <div className="space-y-4">
          {rows.length ? (
            rows.map((row, index) => (
              <div key={row.id} className="border-border/60 bg-muted/10 rounded-md border p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)_auto] md:items-end">
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)]">
                    {segmentLabels.map((segmentLabel, segmentIndex) => (
                      <div key={`${row.id}-segment-${segmentIndex}`} className="space-y-2">
                        <FieldLabel
                          htmlFor={`${row.id}-segment-${segmentIndex}`}
                          className="text-muted-foreground text-xs font-medium"
                        >
                          {segmentLabel}
                        </FieldLabel>
                        {isPoolTemplatePart(templateParts[segmentIndex]) && storagePools ? (
                          <Combobox
                            value={row.segments[segmentIndex] || undefined}
                            onValueChange={(value) => {
                              const nextSegments = [...row.segments];
                              nextSegments[segmentIndex] = value;
                              handleCollectionRowChange(fullKey, row.id, {
                                segments: nextSegments,
                              });
                            }}
                            allowDeselect
                            disabled={readOnly}
                          >
                            <ComboboxTrigger placeholder="Select storage pool" />
                            <ComboboxContent
                              searchPlaceholder="Search storage pools..."
                              emptyLabel="No storage pools found."
                            >
                              {storagePools.map((pool) => (
                                <ComboboxItem
                                  key={pool.name}
                                  value={pool.name}
                                  description={pool.description}
                                >
                                  {pool.name}
                                </ComboboxItem>
                              ))}
                            </ComboboxContent>
                          </Combobox>
                        ) : (
                          <Input
                            id={`${row.id}-segment-${segmentIndex}`}
                            value={row.segments[segmentIndex] ?? ''}
                            placeholder={`Enter ${segmentLabel.toLowerCase()}`}
                            onChange={(event) => {
                              const nextSegments = [...row.segments];
                              nextSegments[segmentIndex] = event.target.value;
                              handleCollectionRowChange(fullKey, row.id, {
                                segments: nextSegments,
                              });
                            }}
                            disabled={readOnly}
                            className="w-full text-sm"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <FieldLabel
                      htmlFor={`${row.id}-value`}
                      className="text-muted-foreground text-xs font-medium"
                    >
                      Value
                    </FieldLabel>
                    <div className="w-full max-w-md">
                      {renderValueControl({
                        id: `${row.id}-value`,
                        metadata,
                        value: row.value,
                        onChange: (value) => handleCollectionRowChange(fullKey, row.id, { value }),
                        disabled: readOnly || resolveTemplateKey(fullKey, row.segments) === null,
                        placeholder: defaultValueDisplay,
                      })}
                    </div>
                  </div>
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => handleCollectionRowRemove(fullKey, row.id)}
                      aria-label={`Remove ${label} ${index + 1}`}
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="border-border/60 text-muted-foreground rounded-md border border-dashed px-4 py-6 text-sm">
              {isUserCollection
                ? 'Add one or more custom user key/value pairs.'
                : `Add one or more ${label.toLowerCase()} entries.`}
            </div>
          )}
        </div>
        {renderDescription(metadata.display_longdesc || metadata.longdesc, metadata, fullKey)}
      </Field>
      </div>
    );
  };

  const renderInput = (
    fullKey: string,
    metadata: ConfigOption,
    label?: string,
    templateParts?: string[],
  ) => {
    if (metadata.editor_kind === 'hugepages_group') {
      return renderHugepagesGroup(
        fullKey,
        metadata,
        label ? formatDisplayName(label) : formatDisplayName(fullKey),
      );
    }

    if (templateParts) {
      return renderCollectionInput(
        fullKey,
        metadata,
        label ? formatDisplayName(label) : formatDisplayName(fullKey),
        templateParts,
      );
    }

    const supportsExpandedConfig = configTarget === 'instance';
    const hasLocalValue = Object.prototype.hasOwnProperty.call(config, fullKey);
    const hasInheritedValue =
      supportsExpandedConfig && Object.prototype.hasOwnProperty.call(expandedConfig, fullKey);
    const isOverridden = supportsExpandedConfig && hasLocalValue && hasInheritedValue;
    const { disabled, reason } = getDisabledState(fullKey, metadata);

    const localValue = config[fullKey];
    const unsetValue = getUnsetValue({
      metadata,
      configTarget,
      instanceType,
      projectMode,
      hasExplicitProjectFeatureOverrides,
    });
    const effectiveValue = getEffectiveValue(fullKey, metadata);

    const defaultValueDisplay = unsetValue;

    const canReset =
      !readOnly && hasLocalValue && (configTarget === 'project' ? localValue !== unsetValue : true);
    const displayLabel = label ? formatDisplayName(label) : formatDisplayName(fullKey);
    const resetTitle =
      configTarget === 'project'
        ? projectMode === 'edit' && isProjectFeatureOption(metadata)
          ? 'Reset to default value'
          : 'Reset to initial value'
        : supportsExpandedConfig
          ? 'Reset to inherited/default'
          : 'Clear value';

    return (
      <div
        key={fullKey}
          ref={(node) => {
            setFieldRef(fullKey, node);
          }}
        className={cn(
          'rounded-md transition-[background-color,box-shadow]',
          highlightedKey === fullKey && 'bg-primary/5',
        )}
      >
      <Field className="border-b pb-6 last:border-0 last:pb-0">
        <div className="flex items-start justify-between gap-4">
          <FieldContent>
              <FieldLabel htmlFor={fullKey} className="flex items-center gap-2 text-sm font-medium">
                {displayLabel}
                {isOverridden ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        aria-label="Overridden"
                        className="h-2 w-2 rounded-full bg-orange-500"
                      />
                    </TooltipTrigger>
                    <TooltipContent>Overridden</TooltipContent>
                  </Tooltip>
                ) : null}
              </FieldLabel>
            {renderDescription(metadata.display_shortdesc || metadata.shortdesc, metadata, fullKey)}
          </FieldContent>
          {canReset ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() =>
                handleValueChange(
                  fullKey,
                  undefined,
                  metadata,
                )
              }
              title={resetTitle}
            >
              <IconRotateClockwise className="h-3 w-3" />
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            {renderValueControl({
              id: fullKey,
              metadata,
              value: effectiveValue,
              onChange: (value) => handleValueChange(fullKey, value, metadata),
              disabled,
              placeholder: defaultValueDisplay,
            })}
          </div>
        </div>
        {reason && disabled ? (
          <FieldDescription className="text-xs">{reason}</FieldDescription>
        ) : null}
        {renderDescription(metadata.display_longdesc || metadata.longdesc, metadata, fullKey)}
      </Field>
      </div>
    );
  };

  const activeCategoryData = filteredCategories.find(
    (category) => category.name === selectedCategory,
  );

  const formatCategoryName = (name: string) =>
    name
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  const tabs = React.useMemo(
    () =>
      filteredCategories.map((category) => ({
        value: category.name,
        label: formatCategoryName(category.name),
        count: searchQuery ? category.keys.length : undefined,
      })),
    [filteredCategories, searchQuery],
  );

  const activeConfigTree = React.useMemo(() => {
    if (!activeCategoryData) return null;
    return buildConfigTree(activeCategoryData.name, activeCategoryData.keys);
  }, [activeCategoryData]);

  return (
    <VerticalTabsLayout
      tabs={tabs}
      selectedTab={selectedCategory || ''}
      onTabSelect={(value) => {
        lastScrollTopRef.current = 0;
        setSelectedCategory(value);
        setHighlightedKey(null);
      }}
      controls={
        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-2.5 left-2 h-4 w-4" />
          <Input
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setHighlightedKey(null);
            }}
            className="h-9 pl-8 text-xs"
          />
        </div>
      }
      sidebarSize={25}
      contentSize={75}
      className="h-full min-h-0 overflow-hidden"
    >
      <div className="flex h-full min-h-0 overflow-hidden flex-col">
        <div className="flex h-[57px] items-center border-b p-4">
          <h3 className="text-sm font-semibold select-none">
            {selectedCategory ? formatCategoryName(selectedCategory) : ''}
          </h3>
        </div>
        <ScrollArea
          key={selectedCategory || 'empty-category'}
          ref={scrollAreaRef}
          className="min-h-0 flex-1"
        >
          <div className="space-y-6 p-6">
            {activeConfigTree ? (
              renderConfigTree(activeConfigTree, renderInput, formatCategoryName)
            ) : (
              <div className="text-muted-foreground py-12 text-center text-sm">
                Select a category to view settings
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </VerticalTabsLayout>
  );
}
