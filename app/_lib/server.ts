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
  const getOptionIdentifier = (option: ConfigOption) =>
    option.name || option.key || '[unknown key]';

  const processOption = (option: ConfigOption) => {
    const textToCheck = [option.condition, option.shortdesc, option.longdesc]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    // Default to supporting both types
    option.supported_types = ['container', 'virtual-machine'];
    let matchedType: 'both' | 'container' | 'virtual-machine' = 'both';
    // Check for container-only patterns
    if (
      TYPE_PATTERNS.container.some((pattern) => textToCheck.includes(pattern))
    ) {
      option.supported_types = ['container'];
      matchedType = 'container';
    }
    // Check for VM-only patterns
    else if (
      TYPE_PATTERNS.vm.some((pattern) => textToCheck.includes(pattern))
    ) {
      option.supported_types = ['virtual-machine'];
      matchedType = 'virtual-machine';
    }
    // Warn if no pattern matched and falling back to both
    if (matchedType === 'both' && process.env.NODE_ENV === 'development') {
      console.warn(
        `[processOption] Option ${getOptionIdentifier(option)} uses the default 'both' instance types due to unmatched pattern:`,
        textToCheck
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
  };

  const configs = config.configs as ConfigsShape;

  const traverseCategories = (collection?: Record<string, OptionCategory>) => {
    if (!collection) return;
    Object.values(collection).forEach((category) => {
      category.keys?.forEach((keyObj) => {
        Object.values(keyObj).forEach((opt) => processOption(opt));
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
