/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

const CR = 13;
const LF = 10;

export interface WebDavHttpRequest {
  method: string;
  target: string;
  version: string;
  headers: Map<string, string>;
  body: Uint8Array;
}

export interface WebDavHttpResponse {
  status: number;
  reason?: string;
  headers?: Record<string, string | number>;
  body?: string | Uint8Array | ArrayBuffer;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  206: 'Partial Content',
  207: 'Multi-Status',
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  411: 'Length Required',
  412: 'Precondition Failed',
  416: 'Range Not Satisfiable',
  423: 'Locked',
  500: 'Internal Server Error',
  501: 'Not Implemented',
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function appendBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength === 0) {
    return right.slice();
  }
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left);
  merged.set(right, left.byteLength);
  return merged;
}

function findHeaderEnd(buffer: Uint8Array) {
  for (let i = 0; i <= buffer.byteLength - 4; i += 1) {
    if (
      buffer[i] === CR &&
      buffer[i + 1] === LF &&
      buffer[i + 2] === CR &&
      buffer[i + 3] === LF
    ) {
      return i;
    }
  }
  return -1;
}

export class WebDavHttpRequestStream {
  private buffer = new Uint8Array(0);

  push(data: ArrayBuffer | Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.buffer = appendBytes(this.buffer, bytes);
  }

  next() {
    const headerEnd = findHeaderEnd(this.buffer);
    if (headerEnd < 0) {
      return null;
    }

    const headerText = textDecoder.decode(this.buffer.slice(0, headerEnd));
    const lines = headerText.split('\r\n');
    const requestLine = lines.shift();
    if (!requestLine) {
      throw new Error('webdav.http.empty-request');
    }
    const [method, target, version] = requestLine.split(/\s+/);
    if (!method || !target || !version?.startsWith('HTTP/')) {
      throw new Error('webdav.http.bad-request-line');
    }

    const headers = new Map<string, string>();
    for (const line of lines) {
      const splitAt = line.indexOf(':');
      if (splitAt <= 0) {
        continue;
      }
      headers.set(
        line.slice(0, splitAt).trim().toLowerCase(),
        line.slice(splitAt + 1).trim(),
      );
    }

    const contentLengthHeader = headers.get('content-length');
    const contentLength =
      contentLengthHeader === undefined ? 0 : Number.parseInt(contentLengthHeader, 10);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      throw new Error('webdav.http.bad-content-length');
    }

    const bodyStart = headerEnd + 4;
    const totalLength = bodyStart + contentLength;
    if (this.buffer.byteLength < totalLength) {
      return null;
    }

    const body = this.buffer.slice(bodyStart, totalLength);
    this.buffer = this.buffer.slice(totalLength);
    return {
      method: method.toUpperCase(),
      target,
      version,
      headers,
      body,
    } satisfies WebDavHttpRequest;
  }

  reset() {
    this.buffer = new Uint8Array(0);
  }
}

export function encodeWebDavHttpResponse(response: WebDavHttpResponse) {
  const bodyBytes =
    typeof response.body === 'string'
      ? textEncoder.encode(response.body)
      : response.body instanceof ArrayBuffer
        ? new Uint8Array(response.body)
        : response.body ?? new Uint8Array(0);
  const headers = {
    Date: new Date().toUTCString(),
    Server: 'ararat-spice-webdav',
    Connection: 'keep-alive',
    'Content-Length': bodyBytes.byteLength,
    ...(response.headers ?? {}),
  };
  const headerText = [
    `HTTP/1.1 ${response.status} ${response.reason ?? STATUS_TEXT[response.status] ?? 'OK'}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    '',
  ].join('\r\n');
  const headerBytes = textEncoder.encode(headerText);
  const bytes = new Uint8Array(headerBytes.byteLength + bodyBytes.byteLength);
  bytes.set(headerBytes);
  bytes.set(bodyBytes, headerBytes.byteLength);
  return bytes.buffer;
}

