import { describe, expect, test } from 'bun:test';

import { routeIncusEventToStore } from './events';
import { instanceKey } from './keys';
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

    expect(
      store.getSnapshot().state.instances.items[key].files.items['/empty'].children,
    ).toEqual({
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
});
