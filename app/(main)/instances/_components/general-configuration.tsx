'use client';

import * as React from 'react';
import { Input } from 'ui-web/components/input';
import { Switch } from 'ui-web/components/switch';
import { Button } from 'ui-web/components/button';
import { IconRotateClockwise } from '@tabler/icons-react';
import { useConfigurableOptions } from '@/app/_hooks/server';
import { ConfigOption } from '@/app/_lib/server.d';
import { UnitInput } from '@/app/(main)/_components/unit-input';
import { ScrollArea } from 'ui-web/components/scroll-area';
import { SearchIcon } from 'lucide-react';
import { VerticalTabsLayout } from '@/app/_components/layout/vertical-tabs-layout';
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldContent,
} from 'ui-web/components/field';

interface GeneralConfigurationProps {
  config: Record<string, string>;
  expandedConfig?: Record<string, string>;
  onConfigChange: (config: Record<string, string>) => void;
  readOnly?: boolean;
  instanceType?: 'virtual-machine' | 'container';
}

type ConfigCategory = {
  name: string;
  keys: {
    key: string;
    metadata: ConfigOption;
  }[];
};

export default function GeneralConfiguration({
  config,
  expandedConfig = {},
  onConfigChange,
  readOnly = false,
  instanceType = 'container',
}: GeneralConfigurationProps) {
  const { data: configurableOptions } = useConfigurableOptions();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(
    null,
  );

  // Parse and group configuration options
  const categories = React.useMemo(() => {
    if (!configurableOptions?.configs?.instance) return [];

    const instanceConfig = configurableOptions.configs.instance;
    const cats: ConfigCategory[] = [];

    Object.entries(instanceConfig).forEach(([categoryName, categoryData]) => {
      // The 'volatile' category contains system-managed configuration that should not be exposed to users.
      if (categoryName === 'volatile') return;
      if (
        typeof categoryData !== 'object' ||
        !categoryData ||
        !('keys' in categoryData)
      ) {
        return;
      }

      const keys = (
        categoryData as { keys: Record<string, ConfigOption>[] }
      ).keys.flatMap((keyObj) =>
        Object.entries(keyObj).map(([key, metadata]) => ({
          key,
          metadata,
        })),
      );

      const validKeys = keys.filter((k) => {
        if (!k.metadata.supported_types) return true;
        return k.metadata.supported_types.includes(instanceType);
      });

      if (validKeys.length > 0) {
        cats.push({
          name: categoryName,
          keys: validKeys,
        });
      }
    });

    return cats.sort((a, b) => a.name.localeCompare(b.name));
  }, [configurableOptions, instanceType]);

  // Select first category by default
  React.useEffect(() => {
    if (!selectedCategory && categories.length > 0) {
      setSelectedCategory(categories[0].name);
    }
  }, [categories, selectedCategory]);

  // Filter keys within the selected category based on search
  const filteredCategories = React.useMemo(() => {
    if (!searchQuery) return categories;

    const lowerQuery = searchQuery.toLowerCase();
    return categories
      .map((cat) => ({
        ...cat,
        keys: cat.keys.filter(
          (k) =>
            k.key.toLowerCase().includes(lowerQuery) ||
            (k.metadata.shortdesc &&
              k.metadata.shortdesc.toLowerCase().includes(lowerQuery)) ||
            (k.metadata.longdesc &&
              k.metadata.longdesc.toLowerCase().includes(lowerQuery)),
        ),
      }))
      .filter((cat) => cat.keys.length > 0);
  }, [categories, searchQuery]);

  const handleValueChange = (key: string, value: string | undefined) => {
    if (readOnly) return;
    const newConfig = { ...config };
    if (value === undefined) {
      delete newConfig[key];
    } else {
      newConfig[key] = value;
    }
    onConfigChange(newConfig);
  };

  const renderInput = (
    fullKey: string,
    metadata: ConfigOption,
    label?: string,
  ) => {
    const hasLocalValue = Object.prototype.hasOwnProperty.call(config, fullKey);
    const hasInheritedValue = Object.prototype.hasOwnProperty.call(
      expandedConfig,
      fullKey,
    );
    const isOverridden = hasLocalValue && hasInheritedValue;

    const localValue = config[fullKey];
    const inheritedValue = expandedConfig[fullKey];
    const effectiveValue = hasLocalValue ? localValue : inheritedValue;

    let defaultValueDisplay = metadata.default;
    if (
      defaultValueDisplay &&
      defaultValueDisplay.startsWith('`') &&
      defaultValueDisplay.endsWith('`')
    ) {
      defaultValueDisplay = defaultValueDisplay.slice(1, -1);
    }

    const canReset = hasLocalValue && !readOnly;
    const hasUnitOptions =
      metadata.unit_options &&
      metadata.unit_options.length > 0 &&
      metadata.default_unit;

    return (
      <Field key={fullKey} className="pb-6 border-b last:border-0 last:pb-0">
        <div className="flex items-start justify-between gap-4">
          <FieldContent>
            <FieldLabel
              htmlFor={fullKey}
              className="text-sm font-medium flex items-center gap-2"
            >
              {label || fullKey}
              {isOverridden && (
                <div
                  className="h-2 w-2 rounded-full bg-orange-500"
                  title="Overridden"
                />
              )}
            </FieldLabel>
            <FieldDescription>{metadata.shortdesc}</FieldDescription>
          </FieldContent>
          {canReset && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => handleValueChange(fullKey, undefined)}
              title="Reset to inherited/default"
            >
              <IconRotateClockwise className="h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            {metadata.type === 'bool' ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={fullKey}
                  checked={effectiveValue === 'true'}
                  onCheckedChange={(checked) =>
                    handleValueChange(fullKey, checked.toString())
                  }
                  disabled={readOnly}
                />
                <span className="text-xs text-muted-foreground">
                  {effectiveValue === 'true' ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            ) : hasUnitOptions ? (
              <UnitInput
                id={fullKey}
                value={effectiveValue}
                unitOptions={metadata.unit_options!}
                defaultUnit={metadata.default_unit!}
                onValueChange={(value) => handleValueChange(fullKey, value)}
                disabled={readOnly}
                placeholder={defaultValueDisplay}
                inputClassName="text-sm"
                selectClassName="h-9 w-24 shrink-0"
                wrapperClassName="flex max-w-md items-center gap-2"
              />
            ) : metadata.type === 'integer' ? (
              <Input
                id={fullKey}
                type="number"
                value={effectiveValue || ''}
                placeholder={defaultValueDisplay}
                onChange={(e) => handleValueChange(fullKey, e.target.value)}
                disabled={readOnly}
                className="text-sm max-w-md"
              />
            ) : (
              <Input
                id={fullKey}
                value={effectiveValue || ''}
                placeholder={defaultValueDisplay}
                onChange={(e) => handleValueChange(fullKey, e.target.value)}
                disabled={readOnly}
                className="text-sm max-w-md"
              />
            )}
          </div>
        </div>
        {metadata.longdesc && (
          <FieldDescription className="text-xs">
            {metadata.longdesc}
          </FieldDescription>
        )}
      </Field>
    );
  };

  const activeCategoryData = filteredCategories.find(
    (c) => c.name === selectedCategory,
  );

  const formatCategoryName = (name: string) => {
    return name
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const tabs = React.useMemo(() => {
    return filteredCategories.map((category) => ({
      value: category.name,
      label: formatCategoryName(category.name),
      count: searchQuery ? category.keys.length : undefined,
    }));
  }, [filteredCategories, searchQuery]);

  return (
    <VerticalTabsLayout
      tabs={tabs}
      selectedTab={selectedCategory || ''}
      onTabSelect={setSelectedCategory}
      controls={
        <div className="relative">
          <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
      }
      sidebarSize={25}
      contentSize={75}
    >
      <div className="h-full flex flex-col">
        <div className="p-4 border-b h-[57px] flex items-center">
          <h3 className="font-semibold text-sm">
            {selectedCategory ? formatCategoryName(selectedCategory) : ''}
          </h3>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {activeCategoryData ? (
              (() => {
                // Helper to group keys into a tree structure
                type ConfigNode = {
                  keys: {
                    fullKey: string;
                    leafName: string;
                    metadata: ConfigOption;
                  }[];
                  children: Record<string, ConfigNode>;
                };

                const buildTree = (
                  items: { key: string; metadata: ConfigOption }[],
                ) => {
                  const root: ConfigNode = { keys: [], children: {} };

                  items.forEach(({ key: fullKey, metadata }) => {
                    // Strip the category prefix (e.g. "boot.")
                    const categoryPrefix = activeCategoryData.name + '.';
                    const relativeKey = fullKey.startsWith(categoryPrefix)
                      ? fullKey.slice(categoryPrefix.length)
                      : fullKey;

                    const parts = relativeKey.split('.');
                    const leafName = parts.pop()!;

                    let currentNode = root;
                    parts.forEach((part) => {
                      if (!currentNode.children[part]) {
                        currentNode.children[part] = { keys: [], children: {} };
                      }
                      currentNode = currentNode.children[part];
                    });

                    currentNode.keys.push({ fullKey, leafName, metadata });
                  });

                  return root;
                };

                const renderNode = (node: ConfigNode, level = 0) => {
                  return (
                    <div className="space-y-6">
                      {/* Render keys at this level */}
                      {node.keys.map(({ fullKey, leafName, metadata }) =>
                        renderInput(fullKey, metadata, leafName),
                      )}

                      {/* Render children (sub-categories) */}
                      {Object.entries(node.children).map(
                        ([name, childNode]) => (
                          <div key={name} className="pt-2">
                            <h4 className="font-semibold text-base mb-4">
                              {formatCategoryName(name)}
                            </h4>
                            <div className="space-y-6">
                              {renderNode(childNode, level + 1)}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  );
                };

                const tree = buildTree(activeCategoryData.keys);
                return renderNode(tree);
              })()
            ) : (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Select a category to view settings
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </VerticalTabsLayout>
  );
}
