import { fromYaml, toYaml } from '../../_lib/yaml';
import type { Device } from '../../instances/_lib/instances.d';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getYamlSection(
  yamlString: string,
  sectionKey: 'config' | 'devices',
): Record<string, unknown> {
  const parsed = fromYaml(yamlString);

  if (!isRecord(parsed)) {
    return {};
  }

  if (sectionKey in parsed) {
    const section = parsed[sectionKey];
    if (!isRecord(section)) {
      throw new Error(`Expected "${sectionKey}" to be a YAML mapping.`);
    }
    return section;
  }

  return parsed;
}

function normalizeScalarValue(
  value: unknown,
  keyPath: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  throw new Error(`Expected "${keyPath}" to be a scalar YAML value.`);
}

export function serializeConfigYaml(config: Record<string, string>): string {
  return toYaml({ config });
}

export function parseConfigYaml(yamlString: string): Record<string, string> {
  const rawConfig = getYamlSection(yamlString, 'config');

  return Object.fromEntries(
    Object.entries(rawConfig).flatMap(([key, value]) => {
      const normalized = normalizeScalarValue(value, `config.${key}`);
      return normalized === undefined ? [] : [[key, normalized]];
    }),
  );
}

export function serializeDevicesYaml(
  devices: Record<string, Device>,
): string {
  return toYaml({ devices });
}

export function parseDevicesYaml(
  yamlString: string,
): Record<string, Device> {
  const rawDevices = getYamlSection(yamlString, 'devices');

  return Object.fromEntries(
    Object.entries(rawDevices).map(([deviceName, rawDevice]) => {
      if (!isRecord(rawDevice)) {
        throw new Error(`Expected "devices.${deviceName}" to be a YAML mapping.`);
      }

      const normalizedDevice = Object.fromEntries(
        Object.entries(rawDevice).flatMap(([key, value]) => {
          const normalized = normalizeScalarValue(
            value,
            `devices.${deviceName}.${key}`,
          );
          return normalized === undefined ? [] : [[key, normalized]];
        }),
      ) as Device;

      if (!normalizedDevice.type) {
        throw new Error(`Device "${deviceName}" must include a "type" field.`);
      }

      return [deviceName, normalizedDevice];
    }),
  );
}
