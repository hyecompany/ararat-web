/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { expect, test } from 'bun:test';

import {
  BrowserWebDavServer,
  type WebDavDirectoryShare,
  type WebDavFileSystemDirectoryHandle,
  type WebDavFileSystemFileHandle,
  type WebDavFileSystemWritable,
  webDavMuxFrame,
  webDavTextRequest,
} from './webdav-fs-access';
import {
  encodeWebDavHttpResponse,
  WebDavHttpRequestStream,
} from './webdav-http';

class FakeWritable implements WebDavFileSystemWritable {
  private chunks: Uint8Array[] = [];

  constructor(private readonly commit: (bytes: Uint8Array) => void) {}

  write(data: BufferSource | Blob | string) {
    if (typeof data === 'string') {
      this.chunks.push(new TextEncoder().encode(data));
    } else if (data instanceof Blob) {
      throw new Error('blob writes are not used in these tests');
    } else {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.chunks.push(bytes.slice());
    }
  }

  close() {
    const size = this.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.commit(merged);
  }
}

class FakeFileHandle implements WebDavFileSystemFileHandle {
  readonly kind = 'file' as const;
  private bytes: Uint8Array;
  private lastModified = 1_762_000_000_000;

  constructor(
    readonly name: string,
    text: string,
    private readonly type = 'text/plain',
  ) {
    this.bytes = new TextEncoder().encode(text);
  }

  async getFile() {
    return new File([arrayBufferForBytes(this.bytes)], this.name, {
      type: this.type,
      lastModified: this.lastModified,
    });
  }

  async createWritable() {
    return new FakeWritable((bytes) => {
      this.bytes = bytes;
      this.lastModified += 1;
    });
  }
}

class FakeDirectoryHandle implements WebDavFileSystemDirectoryHandle {
  readonly kind = 'directory' as const;
  private readonly children = new Map<
    string,
    FakeDirectoryHandle | FakeFileHandle
  >();

  constructor(readonly name: string) {}

  add<T extends FakeDirectoryHandle | FakeFileHandle>(handle: T) {
    this.children.set(handle.name, handle);
    return handle;
  }

  async *values() {
    for (const child of this.children.values()) {
      yield child;
    }
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const child = this.children.get(name);
    if (child?.kind === 'file') {
      return child;
    }
    if (!child && options?.create) {
      return this.add(new FakeFileHandle(name, ''));
    }
    throw new Error('not-found');
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const child = this.children.get(name);
    if (child?.kind === 'directory') {
      return child;
    }
    if (!child && options?.create) {
      return this.add(new FakeDirectoryHandle(name));
    }
    throw new Error('not-found');
  }

  async removeEntry(name: string) {
    if (!this.children.delete(name)) {
      throw new Error('not-found');
    }
  }
}

function fixtureShare(): WebDavDirectoryShare {
  const root = new FakeDirectoryHandle('share');
  root.add(new FakeFileHandle('hello.txt', 'hello world'));
  const docs = root.add(new FakeDirectoryHandle('docs'));
  docs.add(new FakeFileHandle('readme.md', '# readme', 'text/markdown'));
  return { handle: root, name: 'share', writable: true };
}

function headerText(response: ArrayBuffer) {
  return new TextDecoder().decode(response).split('\r\n\r\n')[0] ?? '';
}

test('WebDavHttpRequestStream parses fragmented requests', () => {
  const stream = new WebDavHttpRequestStream();
  const request = webDavTextRequest(
    'PUT /hello.txt HTTP/1.1\r\nContent-Length: 5\r\n\r\nhello',
  );
  const bytes = new Uint8Array(request);
  stream.push(bytes.slice(0, 12));
  expect(stream.next()).toBe(null);
  stream.push(bytes.slice(12));
  const parsed = stream.next();
  expect(parsed?.method).toBe('PUT');
  expect(parsed?.target).toBe('/hello.txt');
  expect(new TextDecoder().decode(parsed?.body)).toBe('hello');
});

test('BrowserWebDavServer answers PROPFIND with root and child resources', async () => {
  const server = new BrowserWebDavServer(fixtureShare());
  const response = await server.handleRequest({
    method: 'PROPFIND',
    target: '/',
    version: 'HTTP/1.1',
    headers: new Map([['depth', '1']]),
    body: new Uint8Array(0),
  });

  expect(response.status).toBe(207);
  expect(response.body?.toString()).toContain('<D:href>/hello.txt</D:href>');
  expect(response.body?.toString()).toContain('<D:collection/>');
});

test('BrowserWebDavServer writes files and serves ranged reads', async () => {
  const server = new BrowserWebDavServer(fixtureShare());
  const put = await server.handleRequest({
    method: 'PUT',
    target: '/new.txt',
    version: 'HTTP/1.1',
    headers: new Map([['content-length', '6']]),
    body: new TextEncoder().encode('abcdef'),
  });
  expect(put.status).toBe(201);

  const get = await server.handleRequest({
    method: 'GET',
    target: '/new.txt',
    version: 'HTTP/1.1',
    headers: new Map([['range', 'bytes=2-4']]),
    body: new Uint8Array(0),
  });
  expect(get.status).toBe(206);
  expect(new TextDecoder().decode(get.body as Uint8Array)).toBe('cde');
});

test('BrowserWebDavServer demuxes SPICE WebDAV client frames', async () => {
  const server = new BrowserWebDavServer(fixtureShare());
  const sent: ArrayBuffer[] = [];
  await server.push(
    webDavMuxFrame(
      BigInt(7),
      webDavTextRequest('GET /hello.txt HTTP/1.1\r\nHost: spice\r\n\r\n'),
    ),
    (data) => sent.push(data),
  );

  expect(sent.length).toBeGreaterThan(0);
  const frame = new Uint8Array(sent[0]!);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  expect(view.getBigInt64(0, true)).toBe(BigInt(7));
  const size = view.getUint16(8, true);
  const response = new TextDecoder().decode(frame.slice(10, 10 + size));
  expect(response).toContain('HTTP/1.1 200 OK');
  expect(response).toContain('hello world');
});

test('BrowserWebDavServer rejects traversal paths', async () => {
  const server = new BrowserWebDavServer(fixtureShare());
  const response = await server.handleRequest({
    method: 'GET',
    target: '/%2e%2e/secret.txt',
    version: 'HTTP/1.1',
    headers: new Map(),
    body: new Uint8Array(0),
  });
  expect(response.status).toBe(403);
});

test('encodeWebDavHttpResponse emits content length', () => {
  const response = encodeWebDavHttpResponse({
    status: 200,
    body: 'ok',
  });
  expect(headerText(response)).toContain('Content-Length: 2');
});

function arrayBufferForBytes(bytes: Uint8Array) {
  return bytes.byteOffset === 0 &&
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : (bytes.slice().buffer as ArrayBuffer);
}
