/// <reference types="bun-types" />
/**
 * @file Development server that somewhat simulates how Ararat is served in production by the Incus web server (does not simulate SPA serving behavior)
 * @author Joseph Maldjian <joseph.maldjian@hyecompany.com>
 */
import { existsSync, readFileSync } from 'node:fs';
import forge from 'node-forge';

const LISTEN_PORT = 3001;

type ListenerMode = 'auto' | 'http' | 'https';

const TLS_CERT_PATH = './server.crt';
const TLS_KEY_PATH = './server.key';
const API_TARGET = process.env.DEV_PROXY_API_TARGET ?? 'https://localhost:8443';
const UPSTREAM_CLIENT_PFX_ENABLED = process.env.DEV_PROXY_UPSTREAM_CLIENT_PFX === '1';
const UPSTREAM_CLIENT_PFX_PATH = process.env.DEV_PROXY_UPSTREAM_CLIENT_PFX_PATH ?? './ararat.pfx';
const UPSTREAM_CLIENT_PFX_PASSPHRASE = process.env.DEV_PROXY_UPSTREAM_CLIENT_PFX_PASSPHRASE ?? '';
const LISTENER_MODE = parseListenerMode(process.env.DEV_PROXY_LISTENER_MODE);

const API_HTTP_TARGET = getHttpTargetUrl(API_TARGET).toString();
const API_WS_TARGET = getWsTargetUrl(API_TARGET).toString();

const APP_HTTP_TARGET = 'http://localhost:3000';
const APP_WS_TARGET = 'ws://localhost:3000';

// Development only: allow proxying to self-signed TLS upstreams (e.g. localhost:8443).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function parseListenerMode(value: string | undefined): ListenerMode {
  if (!value) {
    return 'auto';
  }

  const normalizedValue = value.toLowerCase();
  if (normalizedValue === 'auto' || normalizedValue === 'http' || normalizedValue === 'https') {
    return normalizedValue;
  }

  throw new Error(
    `Invalid DEV_PROXY_LISTENER_MODE value ${value}. Expected auto, http, or https.`,
  );
}

function shouldUseHttpsListener(): boolean {
  // HTTP-first mode is fine for browser tooling, but OIDC relies on HTTPS-only
  // browser behavior, so the non-HTTPS path is intentionally not auth-parity.
  if (LISTENER_MODE === 'https') {
    return true;
  }

  if (LISTENER_MODE === 'http') {
    return false;
  }

  return !UPSTREAM_CLIENT_PFX_ENABLED;
}

function getListenerScheme(): 'http' | 'https' {
  return shouldUseHttpsListener() ? 'https' : 'http';
}

function isSelfSignedDevApiTarget(url: URL): boolean {
  return (
    (url.protocol === 'https:' || url.protocol === 'wss:') &&
    url.hostname === 'localhost' &&
    url.port === '8443'
  );
}

function getHttpTargetUrl(value: string): URL {
  return parseTargetUrl(value, 'https:');
}

function getWsTargetUrl(value: string): URL {
  const httpTarget = getHttpTargetUrl(value);
  const wsProtocol = httpTarget.protocol === 'https:' ? 'wss:' : 'ws:';
  return new URL(`${wsProtocol}//${httpTarget.host}`);
}

function parseTargetUrl(value: string, defaultProtocol: 'http:' | 'https:'): URL {
  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value);
  return new URL(hasProtocol ? value : `${defaultProtocol}//${value}`);
}

function parsePfxToTlsMaterial(
  pfxPath: string,
  passphrase: string,
): { certPem: string; keyPem: string } {
  const pfxBuffer = readFileSync(pfxPath);
  const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] as
    | forge.pkcs12.Bag[]
    | undefined;

  const keyBags = p12.getBags({
    bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
  })[forge.pki.oids.pkcs8ShroudedKeyBag] as forge.pkcs12.Bag[] | undefined;

  const cert = certBags?.[0]?.cert;
  const key = keyBags?.[0]?.key;

  if (!cert || !key) {
    throw new Error(`No certificate/private key pair found in ${pfxPath}`);
  }

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(key),
  };
}

let upstreamClientTlsMaterial: { certPem: string; keyPem: string } | undefined;

if (UPSTREAM_CLIENT_PFX_ENABLED) {
  if (!existsSync(UPSTREAM_CLIENT_PFX_PATH)) {
    throw new Error(
      `DEV_PROXY_UPSTREAM_CLIENT_PFX=1 but PFX file was not found at ${UPSTREAM_CLIENT_PFX_PATH}`,
    );
  }

  try {
    upstreamClientTlsMaterial = parsePfxToTlsMaterial(
      UPSTREAM_CLIENT_PFX_PATH,
      UPSTREAM_CLIENT_PFX_PASSPHRASE,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse upstream client PFX at ${UPSTREAM_CLIENT_PFX_PATH}. If the file is password-protected, set DEV_PROXY_UPSTREAM_CLIENT_PFX_PASSPHRASE. Details: ${message}`,
    );
  }
}

type ProxySocketData = {
  targetUrl: string;
  upstreamHeaders: Record<string, string>;
  pendingMessages: Array<string | Blob | BufferSource>;
  upstream?: WebSocket;
};

function toWebSocketSendPayload(message: string | ArrayBuffer | Uint8Array | Blob): string | Blob | BufferSource {
  if (message instanceof Uint8Array) {
    return new Uint8Array(message);
  }

  return message;
}

function isApiPath(pathname: string): boolean {
  return !pathname.startsWith('/ui');
}

function getHttpTarget(url: URL): URL {
  const isApi = isApiPath(url.pathname);
  const base = isApi ? API_HTTP_TARGET : APP_HTTP_TARGET;
  // Pass the full pathname as-is (app routes keep /ui, api routes don't have /ui)
  return new URL(`${url.pathname}${url.search}`, base);
}

function getWsTarget(url: URL): URL {
  const isApi = isApiPath(url.pathname);
  const base = isApi ? API_WS_TARGET : APP_WS_TARGET;
  return new URL(`${url.pathname}${url.search}`, base);
}

async function proxyHttpRequest(req: Request): Promise<Response> {
  const incomingUrl = new URL(req.url);
  const targetUrl = getHttpTarget(incomingUrl);
  const isAppRoute = !isApiPath(incomingUrl.pathname);

  const headers = new Headers(req.headers);

  const init: RequestInit & { tls?: Bun.TLSOptions } = {
    method: req.method,
    headers,
    redirect: 'manual',
  };

  if (
    upstreamClientTlsMaterial &&
    targetUrl.protocol === 'https:' &&
    isApiPath(incomingUrl.pathname)
  ) {
    init.tls = {
      ...(init.tls ?? {}),
      cert: upstreamClientTlsMaterial.certPem,
      key: upstreamClientTlsMaterial.keyPem,
    };
  }

  if (isSelfSignedDevApiTarget(targetUrl)) {
    init.tls = {
      ...(init.tls ?? {}),
      rejectUnauthorized: false,
    };
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
  }

  try {
    const upstreamResponse = await fetch(targetUrl, init);

    const responseHeaders = new Headers(upstreamResponse.headers);

    const location = responseHeaders.get('location');
    if (location) {
      try {
        const resolvedLocation = new URL(location, targetUrl);
        if (
          resolvedLocation.protocol === targetUrl.protocol &&
          resolvedLocation.host === targetUrl.host
        ) {
          let redirectPath = `${resolvedLocation.pathname}${resolvedLocation.search}${resolvedLocation.hash}`;
          // For app routes, ensure /ui prefix is present (but don't double it)
          if (isAppRoute && !redirectPath.startsWith('/ui')) {
            redirectPath = `/ui${redirectPath}`;
          }
          const rewrittenLocation = new URL(redirectPath, incomingUrl.origin);
          responseHeaders.set('location', rewrittenLocation.toString());
        }
      } catch {
        // Keep upstream Location header as-is when parsing fails.
      }
    }

    // No rewriting needed - upstream 3000 already has basePath: '/ui' configured,
    // so it generates paths with /ui/ prefix already included.
    // Read the body and create a fresh response to ensure proper handling of gzip/encoding

    // Read the entire body to a buffer. This automatically decompresses gzip.
    const bodyBuffer = await upstreamResponse.arrayBuffer();

    // Remove content-encoding since we've already decompressed
    responseHeaders.delete('content-encoding');
    // Let browser auto-detect the content length
    responseHeaders.delete('transfer-encoding');

    return new Response(bodyBuffer, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown upstream error';
    return new Response(`Proxy error: ${message}`, { status: 502 });
  }
}

const useHttpsListener = shouldUseHttpsListener();

if (useHttpsListener && (!existsSync(TLS_CERT_PATH) || !existsSync(TLS_KEY_PATH))) {
  console.error(
    `TLS certificate or key not found at ${TLS_CERT_PATH} and ${TLS_KEY_PATH}. Please copy /var/lib/incus/server.crt and /var/lib/server.key from your Incus host to these paths, or set DEV_PROXY_LISTENER_MODE=http.`,
  );
  process.exit(1);
}

const serverOptions: Parameters<typeof Bun.serve<ProxySocketData>>[0] = {
  port: LISTEN_PORT,
  async fetch(req, server) {
    const isWebSocketUpgrade = req.headers.get('upgrade')?.toLowerCase() === 'websocket';

    if (isWebSocketUpgrade) {
      const requestUrl = new URL(req.url);
      const targetUrl = getWsTarget(requestUrl);
      const isApiWs = isApiPath(requestUrl.pathname);
      const upstreamHeaders: Record<string, string> = {};
      if (isApiWs) {
        for (const name of [
          'cookie',
          'authorization',
          'user-agent',
          'sec-websocket-protocol',
        ]) {
          const value = req.headers.get(name);
          if (value) {
            upstreamHeaders[name] = value;
          }
        }
      }

      const upgraded = server.upgrade(req, {
        data: {
          targetUrl: targetUrl.toString(),
          upstreamHeaders,
          pendingMessages: [],
        },
      });

      if (upgraded) {
        return;
      }

      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    return proxyHttpRequest(req);
  },
  websocket: {
    open(client) {
      const wsOptions: {
        headers?: Record<string, string>;
        tls?: Bun.TLSOptions;
      } = {};

      if (Object.keys(client.data.upstreamHeaders).length > 0) {
        wsOptions.headers = client.data.upstreamHeaders;
      }

      if (isSelfSignedDevApiTarget(new URL(client.data.targetUrl))) {
        wsOptions.tls = {
          ...(wsOptions.tls ?? {}),
          rejectUnauthorized: false,
        };
      }

      const wsTarget = new URL(client.data.targetUrl);
      if (
        upstreamClientTlsMaterial &&
        wsTarget.protocol === 'wss:' &&
        isApiPath(wsTarget.pathname)
      ) {
        wsOptions.tls = {
          ...(wsOptions.tls ?? {}),
          cert: upstreamClientTlsMaterial.certPem,
          key: upstreamClientTlsMaterial.keyPem,
        };
      }

      const upstream =
        wsOptions.headers || wsOptions.tls
          ? new WebSocket(client.data.targetUrl, wsOptions as any)
          : new WebSocket(client.data.targetUrl);
      upstream.binaryType = 'arraybuffer';
      client.data.upstream = upstream;

      upstream.onopen = () => {
        for (const message of client.data.pendingMessages) {
          upstream.send(message);
        }
        client.data.pendingMessages = [];
      };

      upstream.onmessage = (event) => {
        if (typeof event.data === 'string') {
          client.send(event.data);
          return;
        }

        if (event.data instanceof ArrayBuffer) {
          client.send(event.data);
          return;
        }

        if (event.data instanceof Uint8Array) {
          client.send(event.data);
          return;
        }

        if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buffer) => {
            client.send(buffer);
          });
        }
      };

      upstream.onerror = (event) => {
        client.close(1011, 'Upstream WebSocket error');
      };

      upstream.onclose = (event) => {
        client.close(event.code || 1000, event.reason);
      };
    },
    message(client, message) {
      const upstream = client.data.upstream;

      if (!upstream) {
        return;
      }

      if (upstream.readyState === WebSocket.CONNECTING) {
        client.data.pendingMessages.push(toWebSocketSendPayload(message));
        return;
      }

      if (upstream.readyState !== WebSocket.OPEN) {
        return;
      }

      upstream.send(toWebSocketSendPayload(message));
    },
    close(client, code, reason) {
      const upstream = client.data.upstream;

      if (!upstream) {
        return;
      }

      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close(code, reason);
      }
    },
  },
};

if (useHttpsListener) {
  serverOptions.tls = {
    cert: Bun.file(TLS_CERT_PATH),
    key: Bun.file(TLS_KEY_PATH),
  };
}

const server = Bun.serve<ProxySocketData>(serverOptions);

console.log(
  `Hye Ararat listening on ${getListenerScheme()}://localhost:${server.port} (listener mode: ${LISTENER_MODE}${UPSTREAM_CLIENT_PFX_ENABLED ? ', upstream TLS client auth enabled' : ''})`,
);
if (UPSTREAM_CLIENT_PFX_ENABLED) {
  console.log(
    `Development server PFX auto-authentication (TLS) enabled for API target using ${UPSTREAM_CLIENT_PFX_PATH}`,
  );
}
if (!useHttpsListener && UPSTREAM_CLIENT_PFX_ENABLED) {
  console.log(
    'HTTP-first browser mode is active because upstream TLS client-auth is enabled. Use DEV_PROXY_LISTENER_MODE=https only when the browser can trust the local certificate and you want auth-parity testing.',
  );
}
