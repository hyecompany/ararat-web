import { describe, expect, test } from 'bun:test';

import type { ConfigurableOptions } from './server.d';
import { processConfigurableOptions } from './server';

function configurableOptionsWithDeviceDescriptions() {
  return {
    configs: {
      instance: {
        miscellaneous: {
          keys: [
            {
              'agent.nic_config': {
                type: 'bool',
                shortdesc:
                  'Whether to use the name and MTU of the default network interfaces',
                longdesc:
                  'For containers, the name and MTU of the default network interfaces is used for the instance devices. For virtual machines, set this option to `true` to set the name and MTU of the default network interfaces to be the same as the instance devices.',
              },
            },
            {
              'cluster.evacuate': {
                type: 'string',
                longdesc:
                  'Live migration will be used only for virtual machines with the `migration.stateful` setting enabled and for which all its devices can be migrated as well.',
              },
            },
          ],
        },
      },
      devices: {
        disk: {
          keys: [
            {
              'boot.priority': {
                type: 'string',
                shortdesc: 'Boot priority (only for VMs)',
              },
            },
            {
              'io.bus': {
                type: 'string',
                longdesc:
                  'For block devices (disks), this is one of: `nvme`, `virtio-blk`. For file systems (shared directories or custom volumes), this is one of: `9p`, `auto`.',
              },
            },
            {
              'raw.mount.options': {
                type: 'string',
                shortdesc: 'File system specific mount options',
              },
            },
            {
              uid: {
                type: 'string',
                longdesc: 'UID ownership for containers only.',
              },
            },
            {
              path: {
                type: 'string',
                required: 'yes',
                shortdesc:
                  'Path inside the instance where the disk will be mounted (only for file system disk devices)',
              },
            },
          ],
        },
      },
      project: {},
    },
  } as unknown as ConfigurableOptions;
}

describe('processConfigurableOptions', () => {
  test('infers supported types from only-for wording', () => {
    const options = configurableOptionsWithDeviceDescriptions();

    processConfigurableOptions(options);

    const diskKeys = options.configs.devices.disk.keys;
    expect(diskKeys[0]['boot.priority'].supported_types).toEqual([
      'virtual-machine',
    ]);
    expect(diskKeys[3].uid.supported_types).toEqual(['container']);
  });

  test('infers VM support from Incus for VMs wording', () => {
    const options = configurableOptionsWithDeviceDescriptions();
    options.configs.devices.disk.keys[0]['boot.priority'].shortdesc =
      'Boot priority for VMs (higher value boots first)';

    processConfigurableOptions(options);

    expect(options.configs.devices.disk.keys[0]['boot.priority'].supported_types).toEqual([
      'virtual-machine',
    ]);
  });

  test('keeps comparative VM and container descriptions available to both types', () => {
    const options = configurableOptionsWithDeviceDescriptions();

    processConfigurableOptions(options);

    const instanceKeys = options.configs.instance.miscellaneous.keys;
    expect(instanceKeys[0]['agent.nic_config'].supported_types).toEqual([
      'container',
      'virtual-machine',
    ]);
    expect(instanceKeys[1]['cluster.evacuate'].supported_types).toEqual([
      'container',
      'virtual-machine',
    ]);
  });

  test('infers disk content type support from metadata wording', () => {
    const options = configurableOptionsWithDeviceDescriptions();

    processConfigurableOptions(options);

    const diskKeys = options.configs.devices.disk.keys;
    expect(diskKeys[2]['raw.mount.options'].supported_disk_content_types).toEqual([
      'filesystem',
    ]);
    expect(diskKeys[4].path.supported_disk_content_types).toEqual([
      'filesystem',
    ]);
    expect(diskKeys[1]['io.bus'].supported_disk_content_types).toBeUndefined();
  });
});
