import type { ConfigOption } from '@/app/_lib/server.d';
import type { StorageVolume } from '@/app/_incus/types';
import type { Device } from '@/app/(main)/instances/_lib/instances.d';

type InstanceType = 'container' | 'virtual-machine';
type DiskContentType = 'filesystem' | 'block';

export function hasValidRootDisk(
  devices: Record<string, Device>,
  inheritedDevices: Record<string, Device>,
) {
  const allDevices = { ...inheritedDevices, ...devices };
  const rootDisk = Object.values(allDevices).find(
    (device) => device.type === 'disk' && device.path === '/',
  );
  return rootDisk !== undefined && Boolean(rootDisk.pool);
}

export function isRootDiskScaffold(device: Device | undefined) {
  if (!device) return false;
  const keys = Object.keys(device).sort();
  return (
    device.type === 'disk' &&
    device.path === '/' &&
    keys.length === 2 &&
    keys[0] === 'path' &&
    keys[1] === 'type'
  );
}

export function deviceMatchesTab(device: Device, tab: string) {
  if (tab === 'nic') {
    return device.type === 'nic' || device.type.startsWith('nic_');
  }

  if (tab === 'gpu') {
    return device.type === 'gpu' || device.type.startsWith('gpu_');
  }

  return device.type === tab;
}

export function getSourceVolumeName(source?: string) {
  return source?.split('/')[0]?.trim() ?? '';
}

export function getSelectedStorageVolume(
  source: string | undefined,
  storageVolumes: StorageVolume[] | null | undefined,
) {
  const sourceVolumeName = getSourceVolumeName(source);
  if (!sourceVolumeName) return null;
  return (
    storageVolumes?.find((volume) => volume.name === sourceVolumeName) ?? null
  );
}

export function shouldRequireDiskPath({
  isRoot,
  properties,
  selectedStorageVolume,
}: {
  isRoot: boolean;
  properties: Record<string, string>;
  selectedStorageVolume?: StorageVolume | null;
}) {
  if (isRoot) return false;
  if (!properties.source) return true;
  if (!selectedStorageVolume) return true;
  return selectedStorageVolume.content_type === 'filesystem';
}

function selectedDiskContentType(
  selectedStorageVolume?: StorageVolume | null,
): DiskContentType | null {
  if (!selectedStorageVolume) return null;
  return selectedStorageVolume.content_type === 'filesystem'
    ? 'filesystem'
    : 'block';
}

function optionText(config: ConfigOption) {
  return [
    config.condition,
    config.shortdesc,
    config.longdesc,
    config.display_shortdesc,
    config.display_longdesc,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function inferSupportedTypesFromText(text: string): InstanceType[] | null {
  const isContainerOnly =
    /\bonly\s+for\s+containers?\s*(?::|\)|$)/i.test(text) ||
    /\bcontainers?\s+only\b/i.test(text) ||
    /\bcontainer\s+only\b/i.test(text) ||
    /\bfor\s+containers?\s+only\b/i.test(text);
  const isVmOnly =
    /\bonly\s+for\s+(?:virtual\s+machines?|vms?)\s*(?::|\)|$)/i.test(text) ||
    /\b(?:virtual\s+machines?|vms?)\s+only\b/i.test(text) ||
    /\bvm\s+only\b/i.test(text) ||
    /\bfor\s+(?:virtual\s+machines?|vms?)\s+only\b/i.test(text);

  if (isContainerOnly && !isVmOnly) return ['container'];
  if (isVmOnly && !isContainerOnly) return ['virtual-machine'];
  return null;
}

export function configOptionSupportsInstanceType(
  config: ConfigOption,
  instanceType: InstanceType,
) {
  if (Array.isArray(config.supported_types)) {
    return config.supported_types.includes(instanceType);
  }

  const normalizedCondition = config.condition?.toLowerCase().trim();
  if (
    normalizedCondition?.includes('container') &&
    !normalizedCondition.includes('virtual machine') &&
    !normalizedCondition.includes('vm')
  ) {
    return instanceType === 'container';
  }
  if (
    normalizedCondition?.includes('virtual machine') ||
    normalizedCondition?.includes('vm')
  ) {
    return instanceType === 'virtual-machine';
  }

  const inferredTypes = inferSupportedTypesFromText(optionText(config));
  return inferredTypes ? inferredTypes.includes(instanceType) : true;
}

function inferSupportedDiskContentTypesFromText(
  text: string,
): DiskContentType[] | null {
  const isFilesystemOnly =
    /\bonly\s+for\s+file\s*systems?\b/i.test(text) ||
    /\bonly\s+for\s+file\s*system\s+disk\s+devices?\b/i.test(text) ||
    /\bfile\s*system\s+disk\s+devices?\s+only\b/i.test(text) ||
    /\bfile\s*system\s+specific\b/i.test(text);
  const isBlockOnly =
    /\bonly\s+for\s+block\s+devices?\b/i.test(text) ||
    /\bonly\s+for\s+block\s+disk\s+devices?\b/i.test(text) ||
    /\bblock\s+devices?\s+only\b/i.test(text) ||
    /\bblock\s+specific\b/i.test(text);

  if (isFilesystemOnly && !isBlockOnly) return ['filesystem'];
  if (isBlockOnly && !isFilesystemOnly) return ['block'];
  return null;
}

export function configOptionSupportsSelectedDiskContent({
  config,
  selectedStorageVolume,
}: {
  config: ConfigOption;
  selectedStorageVolume?: StorageVolume | null;
}) {
  const supportedContentTypes =
    config.supported_disk_content_types ??
    inferSupportedDiskContentTypesFromText(optionText(config));
  if (!supportedContentTypes) return true;

  const contentType = selectedDiskContentType(selectedStorageVolume);
  return contentType ? supportedContentTypes.includes(contentType) : true;
}

export function isDeviceFieldRequired({
  key,
  config,
  deviceType,
  properties,
  isRoot,
  instanceType,
  selectedStorageVolume,
}: {
  key: string;
  config: ConfigOption;
  deviceType: string;
  properties: Record<string, string>;
  isRoot: boolean;
  instanceType: 'container' | 'virtual-machine';
  selectedStorageVolume?: StorageVolume | null;
}) {
  if (!configOptionSupportsInstanceType(config, instanceType)) {
    return false;
  }
  if (
    deviceType === 'disk' &&
    !configOptionSupportsSelectedDiskContent({ config, selectedStorageVolume })
  ) {
    return false;
  }

  let isRequired = false;
  if (Array.isArray(config.required_for)) {
    isRequired = config.required_for.includes(instanceType);
  } else if (config.required === 'yes') {
    isRequired = true;
  }
  if (!isRequired) return false;

  if (
    deviceType === 'disk' &&
    (key === 'path' || key.startsWith('path.'))
  ) {
    return shouldRequireDiskPath({
      isRoot,
      properties,
      selectedStorageVolume,
    });
  }

  return true;
}

export function shouldOmitEmptyDeviceProperty({
  deviceType,
  config,
  selectedStorageVolume,
  key,
  value,
}: {
  deviceType: string;
  config?: ConfigOption;
  selectedStorageVolume?: StorageVolume | null;
  key: string;
  value: string | undefined;
}) {
  if (
    deviceType === 'disk' &&
    config &&
    !configOptionSupportsSelectedDiskContent({ config, selectedStorageVolume })
  ) {
    return true;
  }

  return deviceType === 'disk' && key === 'path' && !value;
}

export function deviceHasRequiredFieldIssues({
  device,
  deviceConfig,
  instanceType,
  selectedStorageVolume,
}: {
  device: Device;
  deviceConfig?: { keys: Array<Record<string, ConfigOption>> };
  instanceType: 'container' | 'virtual-machine';
  selectedStorageVolume?: StorageVolume | null;
}) {
  const isRoot = device.path === '/' && device.type === 'disk';

  if (isRoot && !device.pool) {
    return true;
  }

  if (!deviceConfig?.keys) return false;

  for (const keyObj of deviceConfig.keys) {
    for (const [key, config] of Object.entries(keyObj)) {
      const required = isDeviceFieldRequired({
        key,
        config,
        deviceType: device.type,
        properties: device,
        isRoot,
        instanceType,
        selectedStorageVolume,
      });
      if (!required) continue;

      if (isRoot) {
        if (key.startsWith('path') || key.startsWith('source')) continue;
        if (key === 'pool') continue;
      }

      if (!device[key]) {
        return true;
      }
    }
  }

  return false;
}
