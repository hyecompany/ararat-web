import { jsonFetcher } from './fetcher';
import type { ConfigurableOptions, Server, ConfigOption } from './server.d';

export async function getServerConfiguration() {
  return jsonFetcher<Server>('/1.0').then((data) => data.metadata);
}

export async function getConfigurableOptions() {
  return jsonFetcher<ConfigurableOptions>('/1.0/metadata/configuration').then((data) => {
    const config = data.metadata;
    processConfigurableOptions(config);
    return config;
  });
}

function processConfigurableOptions(config: ConfigurableOptions) {
  type OptionKeyGroup = Record<string, ConfigOption>;
  type OptionCategory = { keys?: OptionKeyGroup[] };
  type ConfigsShape = {
    instance?: Record<string, OptionCategory>;
    devices?: Record<string, OptionCategory>;
    project?: Record<string, OptionCategory>;
  };

  // Centralized pattern configuration for instance type detection
  // NOTE: This uses string matching on description fields to infer supported instance types.
  // This is a heuristic approach that may break if description formatting changes.
  // If the API ever provides explicit metadata for supported types, use that instead.
  const TYPE_PATTERNS = {
    container: ['(only for containers)', '(container only)', 'containers only'],
    vm: [
      '(only for virtual machines)',
      '(vm only)',
      'virtual machines only',
      'vms only',
      'for vms',
    ],
  };

  const REQUIRED_PATTERNS = {
    universal: ['yes', 'true'],
    container: ['container'],
    vm: ['virtual machine', 'vm'],
  };

  const CONFIG_REFERENCE_REGEX = /\{config:option\}`([^:]+):([^`]+)`/g;
  const DOC_REFERENCE_REGEX = /\{ref\}`([^`]+)`/g;
  const POSSIBLE_VALUES_REGEX = /Possible values are\s+([^\n.]+?)(?:\.|\n|$)/i;
  const VALID_VALUES_REGEX = /Valid values are:?\s+([^\n.]+?)(?:\.|\n|$)/i;
  const CAN_BE_ONE_OF_REGEX = /can be one of\s+([^\n.;)]+?)(?:;|\)|\.|\n|$)/i;
  const CSV_LIST_REGEX = /\bcomma[- ](?:separated|delimited)\s+list\b/i;
  const AVAILABLE_MODES_REGEX = /Available Modes:\s*([\s\S]+?)(?:\n\s*\n|$)/i;
  const IF_CONFIG_VALUE_REGEX = /If\s+\{config:option\}`([^:]+):([^`]+)`\s+is set to\s+`([^`]+)`/i;
  const COMMA_LIST_TEXT_REGEX =
    /\bcomma(?:-and-space|-separated|-delimited| and space separated)\b/i;

  const FIELD_OVERRIDES: Record<string, Partial<ConfigOption>> = {
    'restricted.cluster.groups': {
      editor_kind: 'resource_selector',
      selector_source: 'cluster_groups',
      list_kind: 'csv',
    },
    'restricted.networks.access': {
      editor_kind: 'resource_selector',
      selector_source: 'networks',
      list_kind: 'csv',
    },
    'restricted.networks.integrations': {
      editor_kind: 'resource_selector',
      selector_source: 'network_integrations',
      list_kind: 'csv',
    },
    'restricted.networks.zones': {
      editor_kind: 'resource_selector',
      selector_source: 'network_zones',
      list_kind: 'csv',
    },
    'boot.host_shutdown_action': {
      enum_options: ['stop', 'force-stop', 'stateful-stop'],
    },
    'cluster.evacuate': {
      enum_options: ['auto', 'live-migrate', 'migrate', 'stop', 'stateful-stop', 'force-stop'],
      default: 'auto',
    },
    'limits.memory.enforce': {
      enum_options: ['hard', 'soft'],
    },
    propagation: {
      enum_options: [
        'private',
        'shared',
        'slave',
        'unbindable',
        'rshared',
        'rslave',
        'runbindable',
        'rprivate',
      ],
    },
    'limits.disk.priority': {
      disable_unit_input: true,
    },
    'security.syscalls.allow': {
      editor_kind: 'newline_list',
    },
    'security.syscalls.deny': {
      editor_kind: 'newline_list',
    },
    'snapshots.schedule': {
      editor_kind: 'schedule_autocomplete',
      suggestions: [
        '@startup',
        '@hourly',
        '@daily',
        '@midnight',
        '@weekly',
        '@monthly',
        '@annually',
        '@yearly',
      ],
    },
    'raw.lxc': {
      editor_kind: 'monaco',
      editor_language: 'ini',
    },
    'raw.qemu.conf': {
      editor_kind: 'monaco',
      editor_language: 'ini',
    },
    'raw.qemu.scriptlet': {
      editor_kind: 'monaco',
      editor_language: 'python',
    },
    'raw.qemu.qmp.early': {
      editor_kind: 'monaco',
      editor_language: 'json',
    },
    'raw.qemu.qmp.post-start': {
      editor_kind: 'monaco',
      editor_language: 'json',
    },
    'raw.qemu.qmp.pre-start': {
      editor_kind: 'monaco',
      editor_language: 'json',
    },
    'cloud-init.user.network-config': {
      editor_kind: 'monaco',
      editor_language: 'yaml',
    },
    'cloud-init.user.user-data': {
      editor_kind: 'monaco',
      editor_language: 'yaml',
    },
    'cloud-init.user.vendor-data': {
      editor_kind: 'monaco',
      editor_language: 'yaml',
    },
  };

  const formatDocReferenceLabel = (value: string) =>
    value
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

  const normalizeBacktickValue = (value?: string) => {
    if (!value) return value;
    const normalized =
      value.startsWith('`') && value.endsWith('`') ? value.slice(1, -1) : value;
    return normalized.toLowerCase() === 'empty' ? undefined : normalized;
  };

  const normalizeOptionKey = (
    configSection: keyof ConfigsShape,
    categoryName: string,
    key: string,
  ) => {
    if (configSection === 'devices') {
      return key;
    }

    if (key.includes('.') && key.startsWith(`${categoryName}.`)) {
      return key;
    }

    if (categoryName === 'cloud-init') {
      return key.startsWith('cloud-init.') ? key : `cloud-init.${key}`;
    }

    const firstSegment = key.split('.')[0];
    const knownRootPrefixes = new Set([
      'backups',
      'boot',
      'cloud-init',
      'cluster',
      'environment',
      'features',
      'image',
      'images',
      'limits',
      'linux',
      'migration',
      'nvidia',
      'raw',
      'restricted',
      'security',
      'snapshots',
      'user',
      'volatile',
    ]);

    if (key.includes('.') && knownRootPrefixes.has(firstSegment)) {
      return key;
    }

    if (key === categoryName) {
      return key;
    }

    return `${categoryName}.${key}`;
  };

  const parseScopedDefaults = (value?: string) => {
    if (!value) return undefined;

    const scopedDefaults: Partial<Record<'container' | 'virtual-machine', string | undefined>> = {};
    const matches = Array.from(
      value.matchAll(/`?([^`,]+?)`?\s*\((containers?|vms?|virtual machines?)\)/gi),
    );

    matches.forEach((match) => {
      const rawValue = normalizeBacktickValue(match[1]?.trim());
      const normalizedScope = match[2]?.toLowerCase();
      const normalizedValue =
        rawValue?.toLowerCase() === 'unset' ? undefined : rawValue;

      if (!normalizedScope) return;

      if (normalizedScope.includes('container')) {
        scopedDefaults.container = normalizedValue;
      }

      if (normalizedScope.includes('vm') || normalizedScope.includes('virtual machine')) {
        scopedDefaults['virtual-machine'] = normalizedValue;
      }
    });

    return Object.keys(scopedDefaults).length ? scopedDefaults : undefined;
  };

  const getCloudInitLanguage = (key: string) => {
    if (key === 'cloud-init.network-config') {
      return 'yaml';
    }

    return 'yaml';
  };

  const buildDisabledReason = (key: string, operator: 'truthy' | 'equals', value?: string) => {
    if (operator === 'truthy') {
      return `Enable \`${key}\` to configure this setting.`;
    }

    return `Set \`${key}\` to \`${value}\` to configure this setting.`;
  };

  const sanitizeDescription = (
    text: string | undefined,
    configSection: keyof ConfigsShape,
    startIndex = 0,
  ) => {
    if (!text) {
      return {
        text: undefined,
        referenceTokens: [] as NonNullable<ConfigOption['reference_tokens']>,
      };
    }

    const referenceTokens: NonNullable<ConfigOption['reference_tokens']> = [];
    let currentText = text.replace(CONFIG_REFERENCE_REGEX, (raw, namespace, key) => {
      const placeholder = `@@ref:${startIndex + referenceTokens.length}@@`;
      const fullReferenceKey = normalizeOptionKey(configSection, namespace, key);
      referenceTokens.push({
        raw,
        kind: 'config_option',
        namespace,
        key: fullReferenceKey,
        label: key,
        placeholder,
      });
      return placeholder;
    });

    currentText = currentText.replace(DOC_REFERENCE_REGEX, (raw, key) => {
      const placeholder = `@@ref:${startIndex + referenceTokens.length}@@`;
      referenceTokens.push({
        raw,
        kind: 'doc_ref',
        key,
        label: formatDocReferenceLabel(key),
        placeholder,
      });
      return placeholder;
    });

    return {
      text: currentText,
      referenceTokens,
    };
  };

  const parseEnumValues = (text: string, regex: RegExp) => {
    const match = text.match(regex);
    if (!match) return undefined;

    const valuesSection = match[1];
    const values = Array.from(valuesSection.matchAll(/`([^`]+)`/g)).map((entry) => entry[1]);
    if (!values.length) return undefined;

    const stripped = valuesSection.replace(/`[^`]+`/g, '').replace(/[,\s]|or|and/gi, '');
    if (stripped.length > 0) return undefined;

    return values;
  };

  const parsePlainEnumValues = (text: string, regex: RegExp) => {
    const match = text.match(regex);
    if (!match) return undefined;

    const valuesSection = match[1]
      .replace(/\([^)]*\)/g, ' ')
      .replace(/see\s+the\s+Linux Kernel[\s\S]*$/i, ' ')
      .replace(/\bthe default\b/gi, ' ')
      .trim();

    const candidates = valuesSection
      .split(/\s*,\s*|\s+or\s+/i)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => /^[a-z][a-z0-9-]*$/i.test(value));

    return candidates.length ? Array.from(new Set(candidates)) : undefined;
  };

  const parseBulletedEnumValues = (text: string) => {
    const values = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.match(/`([^`]+)`/))
      .flatMap((match) => (match?.[1] ? [match[1]] : []));

    return values.length >= 2 ? Array.from(new Set(values)) : undefined;
  };

  const getStructuredEnumValues = (option: ConfigOption) => {
    const candidates = [
      option.enum_options,
      option.choices,
      option.values,
      option.valid_values,
      option.possible_values,
    ];

    for (const values of candidates) {
      if (!Array.isArray(values)) continue;

      const normalizedValues = values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));

      if (normalizedValues.length >= 2) {
        return Array.from(new Set(normalizedValues));
      }
    }

    return undefined;
  };

  const parseEnumOptions = (option: ConfigOption) => {
    const sourceText = [option.shortdesc, option.longdesc].filter(Boolean).join('\n');
    if (option.type !== 'string') return undefined;

    // Prefer structured enum metadata when the backend provides it.
    // Description parsing is only a compatibility fallback for the current Incus metadata.
    const structuredValues = getStructuredEnumValues(option);
    if (structuredValues) return structuredValues;
    if (!sourceText) return undefined;

    return (
      parseEnumValues(sourceText, POSSIBLE_VALUES_REGEX) ??
      parseEnumValues(sourceText, VALID_VALUES_REGEX) ??
      parseEnumValues(sourceText, CAN_BE_ONE_OF_REGEX) ??
      parsePlainEnumValues(sourceText, CAN_BE_ONE_OF_REGEX) ??
      parseBulletedEnumValues(sourceText)
    );
  };

  const parseAvailableModes = (option: ConfigOption) => {
    if (option.type !== 'string' || !option.longdesc) return undefined;

    const match = option.longdesc.match(AVAILABLE_MODES_REGEX);
    if (!match) return undefined;

    const values = match[1]
      .split('\n')
      .map((line) => line.trim())
      .map((line) => line.match(/^-\s+`([^`]+)`/))
      .flatMap((lineMatch) => (lineMatch?.[1] ? [lineMatch[1]] : []));

    return values.length ? values : undefined;
  };

  // Helper to process a single option
  const MATCHED_TYPE_BOTH = 'both' as const;

  const annotateUnitOptions = (
    option: ConfigOption,
    key: string,
    categoryName: string,
    textToCheck: string,
  ) => {
    const context = `${categoryName}.${key} ${textToCheck}`;
    const looksLikeUnitLimitedField =
      textToCheck.includes('instances-limit-units') ||
      key === 'limits.disk' ||
      key.startsWith('limits.disk.') ||
      context.includes('maximum disk space used by the project') ||
      context.includes('disk size in bytes');

    if (!looksLikeUnitLimitedField) return;
    if (option.disable_unit_input) return;

    if (
      categoryName.includes('nic') ||
      context.includes('network') ||
      context.includes('bandwidth')
    ) {
      option.unit_options = ['kbit', 'Mbit', 'Gbit'];
      option.default_unit = 'Mbit';
      return;
    }

    if (context.includes('memory')) {
      option.unit_options = ['MiB', 'GiB', 'TiB'];
      option.default_unit = 'GiB';
      return;
    }

    if (
      categoryName.includes('disk') ||
      context.includes('disk') ||
      context.includes('storage') ||
      key === 'size'
    ) {
      option.unit_options = ['MB', 'GB', 'TB', 'MiB', 'GiB', 'TiB'];
      option.default_unit = 'GiB';
    }
  };

  const processOption = (
    option: ConfigOption,
    key: string,
    categoryName: string,
    configSection: keyof ConfigsShape,
  ) => {
    const fullKey = normalizeOptionKey(configSection, categoryName, key);
    const normalizedCondition = option.condition?.toLowerCase().trim();
    const textToCheck = [option.condition, option.shortdesc, option.longdesc]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const shortdescSanitized = sanitizeDescription(option.shortdesc, configSection);
    const longdescSanitized = sanitizeDescription(
      option.longdesc,
      configSection,
      shortdescSanitized.referenceTokens.length,
    );

    // Default to supporting both types
    option.fullKey = fullKey;
    option.key = fullKey;
    option.supported_types = ['container', 'virtual-machine'];
    let typeMatchCategory: 'both' | 'container' | 'virtual-machine' = MATCHED_TYPE_BOTH;
    if (
      normalizedCondition &&
      normalizedCondition.includes('container') &&
      !normalizedCondition.includes('virtual machine') &&
      !normalizedCondition.includes('vm')
    ) {
      option.supported_types = ['container'];
      typeMatchCategory = 'container';
    }
    else if (
      normalizedCondition &&
      (normalizedCondition.includes('virtual machine') || normalizedCondition.includes('vm'))
    ) {
      option.supported_types = ['virtual-machine'];
      typeMatchCategory = 'virtual-machine';
    }
    // Check for container-only patterns
    else if (TYPE_PATTERNS.container.some((pattern) => textToCheck.includes(pattern))) {
      option.supported_types = ['container'];
      typeMatchCategory = 'container';
    }
    // Check for VM-only patterns
    else if (TYPE_PATTERNS.vm.some((pattern) => textToCheck.includes(pattern))) {
      option.supported_types = ['virtual-machine'];
      typeMatchCategory = 'virtual-machine';
    }
    // Warn if no pattern matched and falling back to both
    if (typeMatchCategory === MATCHED_TYPE_BOTH && process.env.NODE_ENV === 'development') {
      console.warn(
        `[processOption] Option ${option.name || option.key || '[unknown key]'} uses the default 'both' instance types due to unmatched pattern:`,
        textToCheck,
      );
    }

    // Determine required types
    option.required_for = [];
    if (option.required) {
      const req = option.required.toLowerCase();

      if (REQUIRED_PATTERNS.universal.some((pattern) => req === pattern)) {
        option.required_for = ['container', 'virtual-machine'];
      } else if (REQUIRED_PATTERNS.container.some((pattern) => req.includes(pattern))) {
        option.required_for = ['container'];
      } else if (REQUIRED_PATTERNS.vm.some((pattern) => req.includes(pattern))) {
        option.required_for = ['virtual-machine'];
      }
    }

    option.display_shortdesc = shortdescSanitized.text;
    option.display_longdesc = longdescSanitized.text;
    option.reference_tokens = [
      ...shortdescSanitized.referenceTokens,
      ...longdescSanitized.referenceTokens,
    ];
    option.scoped_defaults = parseScopedDefaults(option.defaultdesc);
    option.reset_value = normalizeBacktickValue(
      option.initialvaluedesc ?? option.defaultdesc ?? option.default,
    );
    option.enum_options = parseEnumOptions(option) ?? parseAvailableModes(option);
    const fullDescription = [option.shortdesc, option.longdesc].filter(Boolean).join(' ');
    option.list_kind =
      CSV_LIST_REGEX.test(fullDescription) || COMMA_LIST_TEXT_REGEX.test(fullDescription)
        ? 'csv'
        : undefined;
    option.depends_on = [];
    option.disabled_reason = undefined;
    option.editor_kind = undefined;
    option.editor_language = undefined;
    option.selector_source = undefined;
    option.suggestions = undefined;
    option.disable_unit_input = undefined;

    if (fullKey.startsWith('restricted.')) {
      option.depends_on.push({
        key: 'restricted',
        operator: 'truthy',
      });
      option.disabled_reason = buildDisabledReason('restricted', 'truthy');
    }

    const exactValueDependencies = Array.from(
      option.longdesc?.matchAll(new RegExp(IF_CONFIG_VALUE_REGEX.source, 'gi')) ?? [],
    );
    exactValueDependencies.forEach((match) => {
      const [, namespace, dependencyKey, dependencyValue] = match;
      const fullDependencyKey = normalizeOptionKey(
        configSection,
        namespace,
        dependencyKey,
      );
      option.depends_on?.push({
        key: fullDependencyKey,
        operator: 'equals',
        value: dependencyValue,
      });
      option.disabled_reason =
        option.disabled_reason ||
        buildDisabledReason(fullDependencyKey, 'equals', dependencyValue);
    });

    if (!option.depends_on.length) {
      option.depends_on = undefined;
    }

    if (fullKey.startsWith('cloud-init.')) {
      option.editor_kind = 'monaco';
      option.editor_language = getCloudInitLanguage(fullKey);
    }

    if (fullKey.startsWith('limits.hugepages.')) {
      option.group_members = undefined;
    }

    const override = FIELD_OVERRIDES[fullKey];
    if (override) {
      Object.assign(option, override);
    }

    annotateUnitOptions(option, fullKey, categoryName.toLowerCase(), textToCheck);
  };

  const configs = config.configs as ConfigsShape;

  const traverseCategories = (
    collection: Record<string, OptionCategory> | undefined,
    configSection: keyof ConfigsShape,
  ) => {
    if (!collection) return;
    Object.entries(collection).forEach(([categoryName, category]) => {
      category.keys?.forEach((keyObj) => {
        Object.entries(keyObj).forEach(([key, opt]) =>
          processOption(opt, key, categoryName, configSection),
        );
      });
    });
  };

  // Traverse the structure
  // 1. Instance configs (flat objects with keys array)
  traverseCategories(configs.instance, 'instance');

  // 2. Device configs (nested under devices -> type -> keys)
  traverseCategories(configs.devices, 'devices');

  // 3. Project configs (used for project creation/editing UI)
  traverseCategories(configs.project, 'project');
}
