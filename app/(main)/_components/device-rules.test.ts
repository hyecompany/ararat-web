import { describe, expect, test } from 'bun:test';

import type { ConfigOption } from '@/app/_lib/server.d';
import type { StorageVolume } from '@/app/_incus/types';
import {
  configOptionSupportsSelectedDiskContent,
  configOptionSupportsInstanceType,
  deviceMatchesTab,
  deviceHasRequiredFieldIssues,
  hasValidRootDisk,
  isDeviceFieldRequired,
  isRootDiskScaffold,
  shouldOmitEmptyDeviceProperty,
  shouldRequireDiskPath,
} from './device-rules';

const requiredPathConfig = {
  keys: [{ path: { required: 'yes' } as ConfigOption }],
};

function volume(contentType: string): StorageVolume {
  return {
    name: contentType,
    type: 'custom',
    content_type: contentType,
  } as StorageVolume;
}

describe('device rules', () => {
  test('recognizes the create-flow root disk scaffold', () => {
    expect(isRootDiskScaffold({ type: 'disk', path: '/' })).toBe(true);
    expect(isRootDiskScaffold({ type: 'disk', path: '/', pool: 'default' })).toBe(
      false,
    );
  });

  test('validates inherited root disks with pools', () => {
    expect(
      hasValidRootDisk({}, { root: { type: 'disk', path: '/', pool: 'default' } }),
    ).toBe(true);
    expect(hasValidRootDisk({ root: { type: 'disk', path: '/' } }, {})).toBe(
      false,
    );
  });

  test('groups nic and gpu subtypes under their parent tabs', () => {
    expect(deviceMatchesTab({ type: 'nic' }, 'nic')).toBe(true);
    expect(deviceMatchesTab({ type: 'nic_bridged' }, 'nic')).toBe(true);
    expect(deviceMatchesTab({ type: 'gpu_mdev' }, 'gpu')).toBe(true);
    expect(deviceMatchesTab({ type: 'nic_bridged' }, 'disk')).toBe(false);
  });

  test('requires path for filesystem volume attachments', () => {
    expect(
      shouldRequireDiskPath({
        isRoot: false,
        properties: { type: 'disk', source: 'files' },
        selectedStorageVolume: volume('filesystem'),
      }),
    ).toBe(true);
  });

  test('does not require path for non-filesystem volume attachments', () => {
    expect(
      shouldRequireDiskPath({
        isRoot: false,
        properties: { type: 'disk', source: 'iso' },
        selectedStorageVolume: volume('iso'),
      }),
    ).toBe(false);
    expect(
      shouldRequireDiskPath({
        isRoot: false,
        properties: { type: 'disk', source: 'block' },
        selectedStorageVolume: volume('block'),
      }),
    ).toBe(false);
  });

  test('uses the same path rule for missing-field badges', () => {
    expect(
      deviceHasRequiredFieldIssues({
        device: { type: 'disk', source: 'iso' },
        deviceConfig: requiredPathConfig,
        instanceType: 'virtual-machine',
        selectedStorageVolume: volume('iso'),
      }),
    ).toBe(false);
    expect(
      deviceHasRequiredFieldIssues({
        device: { type: 'disk', source: 'files' },
        deviceConfig: requiredPathConfig,
        instanceType: 'container',
        selectedStorageVolume: volume('filesystem'),
      }),
    ).toBe(true);
  });

  test('honors structured supported type metadata for required fields', () => {
    const vmOnlyRequired = {
      required: 'yes',
      supported_types: ['virtual-machine'],
    } as ConfigOption;

    expect(
      isDeviceFieldRequired({
        key: 'boot.priority',
        config: vmOnlyRequired,
        deviceType: 'disk',
        properties: {},
        isRoot: false,
        instanceType: 'container',
      }),
    ).toBe(false);
    expect(
      isDeviceFieldRequired({
        key: 'boot.priority',
        config: vmOnlyRequired,
        deviceType: 'disk',
        properties: {},
        isRoot: false,
        instanceType: 'virtual-machine',
      }),
    ).toBe(true);
  });

  test('falls back to only-for wording when structured type metadata is absent', () => {
    expect(
      configOptionSupportsInstanceType(
        { type: 'string', shortdesc: 'PCI address (only for VMs)' },
        'container',
      ),
    ).toBe(false);
    expect(
      configOptionSupportsInstanceType(
        { type: 'string', shortdesc: 'PCI address (only for VMs)' },
        'virtual-machine',
      ),
    ).toBe(true);
    expect(
      configOptionSupportsInstanceType(
        { type: 'string', longdesc: 'This option is for containers only.' },
        'container',
      ),
    ).toBe(true);
    expect(
      configOptionSupportsInstanceType(
        { type: 'string', longdesc: 'This option is for containers only.' },
        'virtual-machine',
      ),
    ).toBe(false);
    expect(
      configOptionSupportsInstanceType(
        {
          type: 'string',
          longdesc:
            'Live migration is used only for virtual machines with stateful migration enabled.',
        },
        'container',
      ),
    ).toBe(true);
  });

  test('respects filesystem-only disk option metadata', () => {
    const filesystemOnlyPath = {
      required: 'yes',
      supported_disk_content_types: ['filesystem'],
    } as ConfigOption;

    expect(
      configOptionSupportsSelectedDiskContent({
        config: filesystemOnlyPath,
        selectedStorageVolume: volume('filesystem'),
      }),
    ).toBe(true);
    expect(
      configOptionSupportsSelectedDiskContent({
        config: filesystemOnlyPath,
        selectedStorageVolume: volume('block'),
      }),
    ).toBe(false);
    expect(
      isDeviceFieldRequired({
        key: 'path',
        config: filesystemOnlyPath,
        deviceType: 'disk',
        properties: { source: 'testVol' },
        isRoot: false,
        instanceType: 'container',
        selectedStorageVolume: volume('block'),
      }),
    ).toBe(false);
    expect(
      shouldOmitEmptyDeviceProperty({
        deviceType: 'disk',
        config: filesystemOnlyPath,
        selectedStorageVolume: volume('block'),
        key: 'path',
        value: '/mnt/old',
      }),
    ).toBe(true);
  });

  test('falls back to filesystem-only disk wording when structured metadata is absent', () => {
    const filesystemOnlyPath = {
      required: 'yes',
      shortdesc:
        'Path inside the instance where the disk will be mounted (only for file system disk devices)',
    } as ConfigOption;

    expect(
      configOptionSupportsSelectedDiskContent({
        config: filesystemOnlyPath,
        selectedStorageVolume: volume('block'),
      }),
    ).toBe(false);
  });
});
