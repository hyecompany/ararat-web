/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

import type {
  SpicePortBackend,
  SpicePortBackendContext,
} from './session';
import type {
  SessionPortDataPayload,
  SessionPortEventPayload,
  SessionPortInitPayload,
} from './runtime/messages';
import { SpicePortEvent } from './runtime/constants';
import {
  encodeWebDavHttpResponse,
  WebDavHttpRequestStream,
  type WebDavHttpRequest,
  type WebDavHttpResponse,
} from './webdav-http';

type FileSystemPermissionMode = 'read' | 'readwrite';

export interface WebDavFileSystemWritable {
  write(data: BufferSource | Blob | string): Promise<void> | void;
  close(): Promise<void> | void;
}

export interface WebDavFileSystemFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable?(): Promise<WebDavFileSystemWritable>;
  queryPermission?(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionState>;
}

export interface WebDavFileSystemDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<WebDavFileSystemDirectoryHandle | WebDavFileSystemFileHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<WebDavFileSystemFileHandle>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<WebDavFileSystemDirectoryHandle>;
  removeEntry?(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionState>;
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: FileSystemPermissionMode;
  }) => Promise<WebDavFileSystemDirectoryHandle>;
}

export interface WebDavDirectoryShare {
  handle: WebDavFileSystemDirectoryHandle;
  name: string;
  writable: boolean;
}

interface ResolvedEntry {
  segments: string[];
  handle: WebDavFileSystemDirectoryHandle | WebDavFileSystemFileHandle;
}

const textEncoder = new TextEncoder();
const XML_CONTENT_TYPE = 'application/xml; charset=utf-8';
const DAV_ALLOW =
  'OPTIONS, PROPFIND, HEAD, GET, PUT, MKCOL, DELETE, MOVE, COPY, LOCK, UNLOCK';
const WEBDAV_MUX_HEADER_BYTES = 10;
const WEBDAV_MUX_MAX_DATA_BYTES = 0xffff;

export function clientWebDavFileSystemAccessAvailable(win = globalThis) {
  const maybeWindow = win as unknown as Partial<WindowWithDirectoryPicker>;
  return typeof maybeWindow.showDirectoryPicker === 'function';
}

export async function requestWebDavDirectoryShare(
  win: WindowWithDirectoryPicker = window as WindowWithDirectoryPicker,
): Promise<WebDavDirectoryShare> {
  if (typeof win.showDirectoryPicker !== 'function') {
    throw new Error('File System Access directory picker is unavailable.');
  }

  const handle = await win.showDirectoryPicker({
    id: 'spice-webdav-share',
    mode: 'readwrite',
  });
  const writable = await verifyFileSystemPermission(handle, 'readwrite');
  return {
    handle,
    name: handle.name || 'Shared folder',
    writable,
  };
}

export function createWebDavPortBackend(
  share: WebDavDirectoryShare,
): SpicePortBackend {
  const servers = new Map<string, BrowserWebDavServer>();
  const serverKey = (context: SpicePortBackendContext) =>
    `${context.channelType}:${context.channelId}`;

  return {
    channel: 'webdav',
    portName: /^org\.spice-space\.webdav\./,
    autoOpen: true,
    onInit: (_payload: SessionPortInitPayload, context) => {
      servers.set(serverKey(context), new BrowserWebDavServer(share));
      return true;
    },
    onData: async (payload: SessionPortDataPayload, context) => {
      const key = serverKey(context);
      const server = servers.get(key) ?? new BrowserWebDavServer(share);
      servers.set(key, server);
      await server.push(payload.data, (data) => context.send(data));
    },
    onEvent: (payload: SessionPortEventPayload, context) => {
      if (payload.event === SpicePortEvent.CLOSED) {
        servers.delete(serverKey(context));
      }
    },
  };
}

export class BrowserWebDavServer {
  private pendingMuxBytes = new Uint8Array(0);
  private readonly clients = new Map<string, {
    id: bigint;
    requests: WebDavHttpRequestStream;
  }>();

  constructor(private readonly share: WebDavDirectoryShare) {}

  async push(
    data: ArrayBuffer,
    send: (data: ArrayBuffer) => void,
  ): Promise<void> {
    for (const frame of this.readMuxFrames(new Uint8Array(data))) {
      const key = frame.clientId.toString();
      if (frame.data.byteLength === 0) {
        this.clients.delete(key);
        continue;
      }

      let client = this.clients.get(key);
      if (!client) {
        client = {
          id: frame.clientId,
          requests: new WebDavHttpRequestStream(),
        };
        this.clients.set(key, client);
      }

      client.requests.push(frame.data);
      for (;;) {
        const request = client.requests.next();
        if (!request) {
          break;
        }
        const response = encodeWebDavHttpResponse(await this.handleRequest(request));
        for (const chunk of encodeWebDavMuxFrames(client.id, response)) {
          send(chunk);
        }
      }
    }
  }

  reset() {
    this.pendingMuxBytes = new Uint8Array(0);
    for (const client of this.clients.values()) {
      client.requests.reset();
    }
    this.clients.clear();
  }

  async handleRequest(request: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    try {
      switch (request.method) {
        case 'OPTIONS':
          return this.options();
        case 'PROPFIND':
          return await this.propfind(request);
        case 'HEAD':
        case 'GET':
          return await this.get(request, request.method === 'HEAD');
        case 'PUT':
          return await this.put(request);
        case 'MKCOL':
          return await this.mkcol(request);
        case 'DELETE':
          return await this.delete(request);
        case 'COPY':
        case 'MOVE':
          return await this.copyOrMove(request, request.method === 'MOVE');
        case 'LOCK':
          return this.lock(request);
        case 'UNLOCK':
          return { status: 204 };
        default:
          return {
            status: 405,
            headers: { Allow: DAV_ALLOW },
          };
      }
    } catch (error) {
      if (error instanceof WebDavHttpError) {
        return { status: error.status, headers: error.headers };
      }
      return { status: 500 };
    }
  }

  private options(): WebDavHttpResponse {
    return {
      status: 204,
      headers: {
        Allow: DAV_ALLOW,
        DAV: '1, 2',
        'MS-Author-Via': 'DAV',
      },
    };
  }

  private async propfind(request: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    const segments = requestPathSegments(request.target);
    const entry = await this.resolveEntry(segments);
    if (!entry) {
      throw new WebDavHttpError(404);
    }

    const depth = request.headers.get('depth') ?? 'infinity';
    const entries = [entry];
    if (entry.handle.kind === 'directory' && depth !== '0') {
      for await (const child of entry.handle.values()) {
        entries.push({
          segments: [...segments, child.name],
          handle: child,
        });
      }
    }

    return {
      status: 207,
      headers: { 'Content-Type': XML_CONTENT_TYPE, DAV: '1, 2' },
      body: await this.multiStatus(entries),
    };
  }

  private async get(
    request: WebDavHttpRequest,
    headOnly: boolean,
  ): Promise<WebDavHttpResponse> {
    const entry = await this.resolveEntry(requestPathSegments(request.target));
    if (!entry) {
      throw new WebDavHttpError(404);
    }
    if (entry.handle.kind !== 'file') {
      throw new WebDavHttpError(405, { Allow: DAV_ALLOW });
    }

    const file = await entry.handle.getFile();
    const range = parseRange(request.headers.get('range'), file.size);
    if (range?.invalid) {
      throw new WebDavHttpError(416, {
        'Content-Range': `bytes */${file.size}`,
      });
    }

    const body = range
      ? new Uint8Array(await file.slice(range.start, range.end + 1).arrayBuffer())
      : new Uint8Array(await file.arrayBuffer());
    const headers: Record<string, string | number> = {
      'Accept-Ranges': 'bytes',
      'Content-Length': range ? range.end - range.start + 1 : file.size,
      'Content-Type': file.type || mimeTypeForPath(entry.segments.at(-1) ?? ''),
      'Last-Modified': new Date(file.lastModified || Date.now()).toUTCString(),
    };
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${file.size}`;
    }

    return {
      status: range ? 206 : 200,
      headers,
      body: headOnly ? undefined : body,
    };
  }

  private readMuxFrames(bytes: Uint8Array) {
    const merged = new Uint8Array(this.pendingMuxBytes.byteLength + bytes.byteLength);
    merged.set(this.pendingMuxBytes);
    merged.set(bytes, this.pendingMuxBytes.byteLength);

    const frames: Array<{ clientId: bigint; data: ArrayBuffer }> = [];
    let offset = 0;
    while (merged.byteLength - offset >= WEBDAV_MUX_HEADER_BYTES) {
      const view = new DataView(
        merged.buffer,
        merged.byteOffset + offset,
        merged.byteLength - offset,
      );
      const size = view.getUint16(8, true);
      const frameBytes = WEBDAV_MUX_HEADER_BYTES + size;
      if (merged.byteLength - offset < frameBytes) {
        break;
      }

      const payload = merged.slice(
        offset + WEBDAV_MUX_HEADER_BYTES,
        offset + frameBytes,
      );
      frames.push({
        clientId: view.getBigInt64(0, true),
        data: arrayBufferForBytes(payload),
      });
      offset += frameBytes;
    }

    this.pendingMuxBytes = merged.slice(offset);
    return frames;
  }

  private async put(request: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    const segments = requestPathSegments(request.target);
    const { parent, name } = await this.resolveParent(segments);
    const existed = (await this.resolveEntry(segments)) !== null;
    const file = await parent.getFileHandle(name, { create: true });
    if (!file.createWritable) {
      throw new WebDavHttpError(403);
    }

    const writable = await file.createWritable();
    await writable.write(arrayBufferForBytes(request.body));
    await writable.close();
    return { status: existed ? 204 : 201 };
  }

  private async mkcol(request: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    const segments = requestPathSegments(request.target);
    if (segments.length === 0) {
      throw new WebDavHttpError(405, { Allow: DAV_ALLOW });
    }
    if ((await this.resolveEntry(segments)) !== null) {
      throw new WebDavHttpError(405, { Allow: DAV_ALLOW });
    }
    const { parent, name } = await this.resolveParent(segments);
    await parent.getDirectoryHandle(name, { create: true });
    return { status: 201 };
  }

  private async delete(request: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    const segments = requestPathSegments(request.target);
    if (segments.length === 0) {
      throw new WebDavHttpError(403);
    }
    const { parent, name } = await this.resolveParent(segments);
    if (!parent.removeEntry) {
      throw new WebDavHttpError(403);
    }
    await parent.removeEntry(name, { recursive: true });
    return { status: 204 };
  }

  private async copyOrMove(
    request: WebDavHttpRequest,
    move: boolean,
  ): Promise<WebDavHttpResponse> {
    const sourceSegments = requestPathSegments(request.target);
    const destination = request.headers.get('destination');
    if (!destination) {
      throw new WebDavHttpError(400);
    }
    const destinationSegments = requestPathSegments(destination);
    if (destinationSegments.length === 0) {
      throw new WebDavHttpError(403);
    }

    const source = await this.resolveEntry(sourceSegments);
    if (!source) {
      throw new WebDavHttpError(404);
    }

    const overwrite = (request.headers.get('overwrite') ?? 'T').toUpperCase() !== 'F';
    const existingDestination = await this.resolveEntry(destinationSegments);
    if (existingDestination && !overwrite) {
      throw new WebDavHttpError(412);
    }
    if (existingDestination) {
      await this.removeEntry(destinationSegments);
    }

    const { parent, name } = await this.resolveParent(destinationSegments);
    await this.copyEntry(source.handle, parent, name);
    if (move) {
      await this.removeEntry(sourceSegments);
    }
    return { status: existingDestination ? 204 : 201 };
  }

  private lock(request: WebDavHttpRequest): WebDavHttpResponse {
    const token = `opaquelocktoken:${crypto.randomUUID?.() ?? Date.now().toString(16)}`;
    return {
      status: 200,
      headers: {
        'Content-Type': XML_CONTENT_TYPE,
        'Lock-Token': `<${token}>`,
      },
      body: `<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>${escapeXml(request.headers.get('depth') ?? '0')}</D:depth><D:timeout>Second-604800</D:timeout><D:locktoken><D:href>${escapeXml(token)}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`,
    };
  }

  private async multiStatus(entries: ResolvedEntry[]) {
    const responses = await Promise.all(
      entries.map(async (entry) => {
        const properties = await this.propertiesFor(entry);
        return `<D:response><D:href>${escapeXml(hrefForEntry(entry))}</D:href><D:propstat><D:prop>${properties}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
      }),
    );
    return `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">${responses.join('')}</D:multistatus>`;
  }

  private async propertiesFor(entry: ResolvedEntry) {
    const displayName = entry.segments.at(-1) ?? this.share.name;
    if (entry.handle.kind === 'directory') {
      return `<D:displayname>${escapeXml(displayName)}</D:displayname><D:resourcetype><D:collection/></D:resourcetype><D:getcontentlength>0</D:getcontentlength>`;
    }

    const file = await entry.handle.getFile();
    return `<D:displayname>${escapeXml(displayName)}</D:displayname><D:resourcetype/><D:getcontentlength>${file.size}</D:getcontentlength><D:getcontenttype>${escapeXml(file.type || mimeTypeForPath(displayName))}</D:getcontenttype><D:getlastmodified>${new Date(file.lastModified || Date.now()).toUTCString()}</D:getlastmodified><D:getetag>${escapeXml(weakEtag(file))}</D:getetag>`;
  }

  private async resolveEntry(segments: string[]): Promise<ResolvedEntry | null> {
    let directory = this.share.handle;
    if (segments.length === 0) {
      return { segments, handle: directory };
    }

    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index]!;
      const isLeaf = index === segments.length - 1;
      if (isLeaf) {
        const child = await getChild(directory, name);
        return child ? { segments, handle: child } : null;
      }
      const childDirectory = await getDirectoryChild(directory, name);
      if (!childDirectory) {
        return null;
      }
      directory = childDirectory;
    }

    return null;
  }

  private async resolveParent(segments: string[]) {
    if (segments.length === 0) {
      throw new WebDavHttpError(403);
    }
    const parentSegments = segments.slice(0, -1);
    const name = segments.at(-1);
    const parent = await this.resolveEntry(parentSegments);
    if (!name || !parent || parent.handle.kind !== 'directory') {
      throw new WebDavHttpError(409);
    }
    return { parent: parent.handle, name };
  }

  private async removeEntry(segments: string[]) {
    if (segments.length === 0) {
      throw new WebDavHttpError(403);
    }
    const { parent, name } = await this.resolveParent(segments);
    if (!parent.removeEntry) {
      throw new WebDavHttpError(403);
    }
    await parent.removeEntry(name, { recursive: true });
  }

  private async copyEntry(
    source: WebDavFileSystemDirectoryHandle | WebDavFileSystemFileHandle,
    destinationParent: WebDavFileSystemDirectoryHandle,
    destinationName: string,
  ) {
    if (source.kind === 'file') {
      const destination = await destinationParent.getFileHandle(destinationName, {
        create: true,
      });
      if (!destination.createWritable) {
        throw new WebDavHttpError(403);
      }
      const writable = await destination.createWritable();
      await writable.write(await source.getFile().then((file) => file.arrayBuffer()));
      await writable.close();
      return;
    }

    const destinationDirectory = await destinationParent.getDirectoryHandle(
      destinationName,
      { create: true },
    );
    for await (const child of source.values()) {
      await this.copyEntry(child, destinationDirectory, child.name);
    }
  }
}

class WebDavHttpError extends Error {
  constructor(
    readonly status: number,
    readonly headers?: Record<string, string | number>,
  ) {
    super(`webdav.http.${status}`);
  }
}

async function getChild(
  directory: WebDavFileSystemDirectoryHandle,
  name: string,
) {
  return (
    (await getFileChild(directory, name)) ??
    (await getDirectoryChild(directory, name))
  );
}

async function getFileChild(
  directory: WebDavFileSystemDirectoryHandle,
  name: string,
) {
  try {
    return await directory.getFileHandle(name);
  } catch {
    return null;
  }
}

async function getDirectoryChild(
  directory: WebDavFileSystemDirectoryHandle,
  name: string,
) {
  try {
    return await directory.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

function requestPathSegments(target: string) {
  const path = target
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '')
    .split(/[?#]/, 1)[0];
  const decoded = decodeURIComponent(path || '/');
  const segments = decoded
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  if (
    segments.some(
      (segment) =>
        segment === '..' ||
        segment.includes('\\') ||
        segment.includes('\0') ||
        segment.includes('/'),
    )
  ) {
    throw new WebDavHttpError(403);
  }
  return segments;
}

function hrefForEntry(entry: ResolvedEntry) {
  const path = `/${entry.segments.map(encodeURIComponent).join('/')}`;
  if (entry.handle.kind === 'directory') {
    return path.endsWith('/') ? path : `${path}/`;
  }
  return path;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => {
    switch (character) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return character;
    }
  });
}

function weakEtag(file: File) {
  return `W/"${file.size.toString(16)}-${Math.round(file.lastModified || 0).toString(16)}"`;
}

async function verifyFileSystemPermission(
  handle: WebDavFileSystemDirectoryHandle,
  mode: FileSystemPermissionMode,
) {
  const descriptor = { mode };
  if (typeof handle.queryPermission === 'function') {
    const queried = await handle.queryPermission(descriptor);
    if (queried === 'granted') {
      return mode === 'readwrite';
    }
  }
  if (typeof handle.requestPermission === 'function') {
    const requested = await handle.requestPermission(descriptor);
    return requested === 'granted' && mode === 'readwrite';
  }
  return mode === 'readwrite';
}

function mimeTypeForPath(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'avif':
      return 'image/avif';
    case 'css':
      return 'text/css';
    case 'gif':
      return 'image/gif';
    case 'htm':
    case 'html':
      return 'text/html';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'js':
      return 'text/javascript';
    case 'json':
      return 'application/json';
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'svg':
      return 'image/svg+xml';
    case 'txt':
      return 'text/plain; charset=utf-8';
    case 'wasm':
      return 'application/wasm';
    case 'webp':
      return 'image/webp';
    case 'xml':
      return 'application/xml';
    default:
      return 'application/octet-stream';
  }
}

function parseRange(header: string | undefined, size: number) {
  if (!header) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) {
    return { invalid: true } as const;
  }
  const [, startText, endText] = match;
  let start = startText ? Number.parseInt(startText, 10) : 0;
  let end = endText ? Number.parseInt(endText, 10) : size - 1;
  if (!startText && endText) {
    const suffixLength = Number.parseInt(endText, 10);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true } as const;
  }
  return {
    start,
    end: Math.min(size - 1, end),
  };
}

export function webDavTextRequest(request: string) {
  return arrayBufferForBytes(textEncoder.encode(request));
}

export function webDavMuxFrame(clientId: bigint, data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > WEBDAV_MUX_MAX_DATA_BYTES) {
    throw new Error('webdav.mux.frame-too-large');
  }
  const frame = new Uint8Array(WEBDAV_MUX_HEADER_BYTES + bytes.byteLength);
  const view = new DataView(frame.buffer);
  view.setBigInt64(0, clientId, true);
  view.setUint16(8, bytes.byteLength, true);
  frame.set(bytes, WEBDAV_MUX_HEADER_BYTES);
  return arrayBufferForBytes(frame);
}

function encodeWebDavMuxFrames(clientId: bigint, data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  const frames: ArrayBuffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += WEBDAV_MUX_MAX_DATA_BYTES) {
    frames.push(
      webDavMuxFrame(
        clientId,
        bytes.slice(offset, offset + WEBDAV_MUX_MAX_DATA_BYTES),
      ),
    );
  }
  return frames;
}

function arrayBufferForBytes(bytes: Uint8Array) {
  return bytes.byteOffset === 0 &&
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : (bytes.slice().buffer as ArrayBuffer);
}
