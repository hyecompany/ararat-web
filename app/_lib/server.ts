import { jsonFetcher } from './fetcher';
import type { ConfigurableOptions, Server, ConfigOption } from './server.d';

export async function getServerConfiguration() {
  return jsonFetcher<Server>('/1.0').then((data) => data.metadata);
}

export async function getConfigurableOptions() {
  return jsonFetcher<ConfigurableOptions>('/1.0/metadata/configuration').then(
    (data) => {
      const config = data.metadata;
      processConfigurableOptions(config);
      return config;
    },
  );
}

function processConfigurableOptions(config: ConfigurableOptions) {
  type OptionKeyGroup = Record<string, ConfigOption>;
  type OptionCategory = { keys?: OptionKeyGroup[] };
  type ConfigsShape = {
    instance?: Record<string, OptionCategory>;
    devices?: Record<string, OptionCategory>;
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

  // Helper to process a single option
  const MATCHED_TYPE_BOTH = 'both' as const;

  const annotateUnitOptions = (
    option: ConfigOption,
    key: string,
    categoryName: string,
    textToCheck: string,
  ) => {
    if (!textToCheck.includes('instances-limit-units')) return;

    const context = `${categoryName}.${key} ${textToCheck}`;

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
  ) => {
    const textToCheck = [option.condition, option.shortdesc, option.longdesc]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    // Default to supporting both types
    option.supported_types = ['container', 'virtual-machine'];
    let typeMatchCategory: 'both' | 'container' | 'virtual-machine' =
      MATCHED_TYPE_BOTH;
    // Check for container-only patterns
    if (
      TYPE_PATTERNS.container.some((pattern) => textToCheck.includes(pattern))
    ) {
      option.supported_types = ['container'];
      typeMatchCategory = 'container';
    }
    // Check for VM-only patterns
    else if (
      TYPE_PATTERNS.vm.some((pattern) => textToCheck.includes(pattern))
    ) {
      option.supported_types = ['virtual-machine'];
      typeMatchCategory = 'virtual-machine';
    }
    // Warn if no pattern matched and falling back to both
    if (
      typeMatchCategory === MATCHED_TYPE_BOTH &&
      process.env.NODE_ENV === 'development'
    ) {
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
      } else if (
        REQUIRED_PATTERNS.container.some((pattern) => req.includes(pattern))
      ) {
        option.required_for = ['container'];
      } else if (
        REQUIRED_PATTERNS.vm.some((pattern) => req.includes(pattern))
      ) {
        option.required_for = ['virtual-machine'];
      }
    }

    annotateUnitOptions(option, key, categoryName.toLowerCase(), textToCheck);
  };

  const configs = config.configs as ConfigsShape;

  const traverseCategories = (collection?: Record<string, OptionCategory>) => {
    if (!collection) return;
    Object.entries(collection).forEach(([categoryName, category]) => {
      category.keys?.forEach((keyObj) => {
        Object.entries(keyObj).forEach(([key, opt]) =>
          processOption(opt, key, categoryName),
        );
      });
    });
  };

  // Traverse the structure
  // 1. Instance configs (flat objects with keys array)
  traverseCategories(configs.instance);

  // 2. Device configs (nested under devices -> type -> keys)
  traverseCategories(configs.devices);

  // Process other top-level configs if they follow the same pattern
  // For now, focusing on instance and devices as requested
}
