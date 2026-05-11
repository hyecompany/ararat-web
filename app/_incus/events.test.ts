import { describe, expect, test } from 'bun:test';

import { routeIncusEventToStore } from './events';
import { instanceKey, storageVolumeKey } from './keys';
import { IncusStore } from './store';
import type { IncusEvent } from '@/app/_context/events';

type TestInstanceFileItem = ReturnType<IncusStore['ensureInstanceFile']> & {
  children?: {
    status: 'missing' | 'ready' | 'stale' | 'error';
    names: string[];
    error?: string;
  };
};

function readyFileStore() {
  const store = new IncusStore();
  const key = instanceKey('default', 'test');
  const instance = store.ensureInstance(key);
  instance.metadata = { status: 'ready' };
  instance.state = { status: 'ready' };
  instance.access = { status: 'ready' };
  (store.ensureInstanceFile(key, '/etc') as TestInstanceFileItem).children = {
    status: 'ready',
    names: ['foo', 'bar'],
  };
  store.ensureInstanceFile(key, '/etc/foo').metadata = {
    status: 'ready',
    data: { path: '/etc/foo' },
  };
  return { store, key };
}

describe('routeIncusEventToStore', () => {
  test('routes file operation events to file cache without staling the instance shell', () => {
    const { store, key } = readyFileStore();
    const event: IncusEvent = {
      type: 'operation',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        id: 'op-1',
        description: 'Deleting file',
        status: 'Running',
        resources: {
          instances: ['/1.0/instances/test?project=default'],
        },
        metadata: {
          path: '/etc/foo',
        },
      },
    };

    routeIncusEventToStore(store, event);

    const instance = store.getSnapshot().state.instances.items[key];
    expect(instance.metadata.status).toBe('ready');
    expect(instance.state.status).toBe('ready');
    expect(instance.access.status).toBe('ready');
    expect(instance.files.items['/etc'].children?.status).toBe('stale');
    expect(instance.files.items['/etc/foo'].metadata.status).toBe('stale');
  });

  test('removes deleted file names from the parent listing from the lifecycle event', () => {
    const { store, key } = readyFileStore();
    const event: IncusEvent = {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'instance-file-deleted',
        source: '/1.0/instances/test?project=default',
        context: {
          path: '/etc/foo',
        },
      },
    };

    routeIncusEventToStore(store, event);

    const instance = store.getSnapshot().state.instances.items[key];
    expect(instance.files.items['/etc/foo']).toBeUndefined();
    expect(instance.files.items['/etc'].children).toEqual({
      status: 'ready',
      names: ['bar'],
    });
    expect(instance.metadata.status).toBe('ready');
  });

  test('removes deleted instance logs from log lifecycle events', () => {
    const store = new IncusStore();
    const key = instanceKey('default', 'test');
    const instance = store.ensureInstance(key);
    instance.logs.collection = { status: 'ready' };
    instance.logs.items['lxc.log'] = {
      metadata: { status: 'ready', data: { name: 'lxc.log' } },
      content: { status: 'ready', data: 'log content' },
    };

    routeIncusEventToStore(store, {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'instance-log-deleted',
        source: '/1.0/instances/test/logs/lxc.log?project=default',
      },
    });

    expect(store.getSnapshot().state.instances.items[key].logs.items['lxc.log']).toBeUndefined();
    expect(store.getSnapshot().state.instances.items[key].logs.collection.status).toBe('stale');
  });

  test('routes exec-output instance log lifecycle paths to log cache entries', () => {
    const store = new IncusStore();
    const key = instanceKey('default', 'test');
    const instance = store.ensureInstance(key);
    instance.logs.collection = { status: 'ready' };
    instance.logs.items['exec-output/exec-1.stdout'] = {
      metadata: {
        status: 'ready',
        data: { name: 'exec-output/exec-1.stdout' },
      },
      content: { status: 'ready', data: 'stdout' },
    };

    routeIncusEventToStore(store, {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'instance-log-retrieved',
        source: '/1.0/instances/test/logs/exec-output/exec-1.stdout?project=default',
      },
    });

    const log =
      store.getSnapshot().state.instances.items[key].logs.items['exec-output/exec-1.stdout'];
    expect(log.metadata.status).toBe('stale');
    expect(log.content.status).toBe('stale');
    expect(store.getSnapshot().state.instances.items[key].logs.collection.status).toBe('stale');
  });

  test('ignores root logging events for instance log file caches', () => {
    const store = new IncusStore();
    const key = instanceKey('default', 'test');
    const instance = store.ensureInstance(key);
    instance.logs.collection = { status: 'ready' };
    instance.logs.items['lxc.log'] = {
      metadata: { status: 'ready', data: { name: 'lxc.log' } },
      content: { status: 'ready', data: 'log content' },
    };

    routeIncusEventToStore(store, {
      type: 'logging',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        message: 'server log message',
        level: 'info',
        context: {},
      },
    });

    const log = store.getSnapshot().state.instances.items[key].logs.items['lxc.log'];
    expect(log.metadata.status).toBe('ready');
    expect(log.content.status).toBe('ready');
    expect(store.getSnapshot().state.instances.items[key].logs.collection.status).toBe('ready');
  });

  test('keeps an established empty parent listing ready after event deletion', () => {
    const store = new IncusStore();
    const key = instanceKey('default', 'test');
    (store.ensureInstanceFile(key, '/empty') as TestInstanceFileItem).children = {
      status: 'ready',
      names: ['foo'],
    };
    store.ensureInstanceFile(key, '/empty/foo').metadata = {
      status: 'ready',
      data: { path: '/empty/foo' },
    };

    routeIncusEventToStore(store, {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'instance-file-deleted',
        source: '/1.0/instances/test?project=default',
        context: {
          path: '/empty/foo',
        },
      },
    });

    expect(store.getSnapshot().state.instances.items[key].files.items['/empty'].children).toEqual({
      status: 'ready',
      names: [],
    });
  });

  test('applies pushed file lifecycle events to the destination listing and metadata', () => {
    const store = new IncusStore();
    const key = instanceKey('default', 'test');
    (store.ensureInstanceFile(key, '/tmp') as TestInstanceFileItem).children = {
      status: 'stale',
      names: ['alpha.txt'],
    };

    routeIncusEventToStore(store, {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'instance-file-pushed',
        source: '/1.0/instances/test?project=default',
        context: {
          'file-source': '/Users/joseph/Desktop/local.txt',
          'file-destination': '/tmp/new.txt',
          info: {
            type: 'file',
            size: 12,
            uid: 0,
            gid: 0,
            mode: '0644',
          },
        },
      },
    });

    const instance = store.getSnapshot().state.instances.items[key];
    expect(instance.files.items['/tmp'].children).toEqual({
      status: 'ready',
      names: ['alpha.txt', 'new.txt'],
    });
    expect(instance.files.items['/tmp/new.txt'].metadata).toEqual({
      status: 'ready',
      data: {
        path: '/tmp/new.txt',
        type: 'file',
        size: 12,
        uid: '0',
        gid: '0',
        mode: '0644',
      },
    });
    expect(instance.files.items['/Users/joseph/Desktop']).toBeUndefined();
  });

  test('treats created directory file events as a ready empty child listing', () => {
    const store = new IncusStore();
    const key = instanceKey('default', 'test');
    (store.ensureInstanceFile(key, '/tmp') as TestInstanceFileItem).children = {
      status: 'ready',
      names: [],
    };

    routeIncusEventToStore(store, {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'instance-file-created',
        source: '/1.0/instances/test?project=default',
        context: {
          'file-destination': '/tmp/new-folder',
          info: JSON.stringify({
            type: 'directory',
            uid: '0',
            gid: '0',
            mode: '0755',
          }),
        },
      },
    });

    const instance = store.getSnapshot().state.instances.items[key];
    expect(instance.files.items['/tmp'].children).toEqual({
      status: 'ready',
      names: ['new-folder'],
    });
    expect(instance.files.items['/tmp/new-folder'].metadata.status).toBe('ready');
    expect(instance.files.items['/tmp/new-folder'].children).toEqual({
      status: 'ready',
      names: [],
    });
  });

  test('adds a stale storage volume shell when a loaded collection receives a create event', () => {
    const store = new IncusStore();
    const pool = store.ensureStoragePool('default');
    pool.volumes.collection.byProject.default = { status: 'ready' };
    pool.volumes.collection.byProject.all = { status: 'ready' };

    routeIncusEventToStore(store, {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'storage-volume-created',
        source: '/1.0/storage-pools/default/volumes/custom/testVol?project=default',
      },
    });

    const key = storageVolumeKey('default', 'custom', 'testVol');
    const volumes = store.getSnapshot().state.storagePools.items.default.volumes;
    expect(volumes.collection.byProject.default.status).toBe('stale');
    expect(volumes.collection.byProject.all.status).toBe('stale');
    expect(volumes.items[key].metadata.status).toBe('missing');
  });

  test('updates all-projects storage volume collections from concrete project events', () => {
    const store = new IncusStore();
    const pool = store.ensureStoragePool('default');
    pool.volumes.collection.byProject.all = { status: 'ready' };

    routeIncusEventToStore(store, {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'storage-volume-created',
        source: '/1.0/storage-pools/default/volumes/custom/testVol?project=default',
      },
    });

    const key = storageVolumeKey('default', 'custom', 'testVol');
    const volumes = store.getSnapshot().state.storagePools.items.default.volumes;
    expect(volumes.collection.byProject.all.status).toBe('stale');
    expect(volumes.items[key].metadata.status).toBe('missing');
  });

  test('removes deleted storage volumes from a loaded collection', () => {
    const store = new IncusStore();
    const key = storageVolumeKey('default', 'custom', 'testVol');
    const pool = store.ensureStoragePool('default');
    pool.volumes.collection.byProject.default = { status: 'ready' };
    pool.volumes.collection.byProject.all = { status: 'ready' };
    store.ensureStorageVolume('default', key).metadata = {
      status: 'ready',
      data: {
        name: 'testVol',
        type: 'custom',
        project: 'default',
        content_type: 'block',
      },
    };

    routeIncusEventToStore(store, {
      type: 'lifecycle',
      timestamp: new Date(0).toISOString(),
      project: 'default',
      metadata: {
        action: 'storage-volume-deleted',
        source: '/1.0/storage-pools/default/volumes/custom/testVol?project=default',
      },
    });

    const volumes = store.getSnapshot().state.storagePools.items.default.volumes;
    expect(volumes.items[key]).toBeUndefined();
    expect(volumes.collection.byProject.default.status).toBe('stale');
    expect(volumes.collection.byProject.all.status).toBe('stale');
  });
});
